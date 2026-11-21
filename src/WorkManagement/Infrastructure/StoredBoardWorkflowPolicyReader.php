<?php

declare(strict_types=1);

namespace App\WorkManagement\Infrastructure;

use App\AgentCatalog\Application\AgentCatalogReader;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use App\WorkManagement\Application\BoardWorkflowPolicyReader;
use App\WorkManagement\Domain\AttentionLabelCatalog;
use App\WorkManagement\Domain\BoardWipPolicy;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\Uid\Uuid;

#[AsAlias(BoardWorkflowPolicyReader::class)]
final readonly class StoredBoardWorkflowPolicyReader implements BoardWorkflowPolicyReader
{
    public function __construct(
        private Store $store,
        private BoardWipPolicy $boardWipPolicy,
        private AgentCatalogReader $agentCatalog,
    ) {
    }

    /** @param array<string, mixed> $task @return array{state: string, board_id: ?string, workflow_id: ?string, definition_version: ?int, reason: ?string} */
    public function resolve(array $task, ?string $boardId = null): array
    {
        $projectId = $task['project_id'] ?? null;
        $taskId = $task['id'] ?? null;
        if (!is_string($projectId) || !is_string($taskId)) {
            return $this->projection('unavailable', $boardId, null, null, 'Die Aufgabe ist nicht mehr verfügbar.');
        }

        $projectedTask = $this->projectTaskLabels($task, $projectId);
        $allBoards = $this->store->all('boards', $projectId);
        $candidates = [];
        if (null !== $boardId) {
            $selected = null;
            foreach ($allBoards as $board) {
                if (($board['id'] ?? null) === $boardId) {
                    $selected = $board;
                    break;
                }
            }
            if (null === $selected || !empty($selected['archived']) || !$this->boardContainsTask($selected, $projectedTask)) {
                return $this->projection('unavailable', $boardId, null, null, 'Das ausgewählte Board ist nicht aktiv oder zeigt diese Aufgabe nicht an.');
            }
            $policy = $selected['config']['workflow_policy'] ?? null;
            if (is_array($policy) && is_string($policy['workflow_id'] ?? null)) {
                $candidates[] = $this->candidate($selected, $policy);
            }
        } else {
            foreach ($allBoards as $board) {
                if (!empty($board['archived']) || !$this->boardContainsTask($board, $projectedTask)) {
                    continue;
                }
                $policy = $board['config']['workflow_policy'] ?? null;
                if (is_array($policy) && is_string($policy['workflow_id'] ?? null)) {
                    $candidates[] = $this->candidate($board, $policy);
                }
            }
            usort($candidates, static fn (array $left, array $right): int => strcasecmp($left['board_name'], $right['board_name']) ?: strcmp($left['board_id'], $right['board_id']));
        }

        $route = $this->taskRoute($task);
        if (count($candidates) > 1) {
            $names = array_values(array_unique(array_column($candidates, 'board_name')));
            $reason = 'Mehrere passende Boards haben Workflowrichtlinien: '.implode(', ', $names).'. Wähle das Board im Ticketkontext.';

            return $this->projection('ambiguous', null, $route['workflow_id'] ?? null, $route['definition_version'] ?? null, $reason);
        }

        $candidate = $candidates[0] ?? null;
        if (null !== $candidate && null !== $candidate['manual_label_id']) {
            $manualLabel = $this->store->find('labels', $candidate['manual_label_id']);
            if (null === $manualLabel || empty($manualLabel['active']) || 'topic' !== ($manualLabel['kind'] ?? null) || !empty($manualLabel['system_managed'])) {
                return $this->projection('unavailable', $candidate['board_id'], $candidate['workflow_id'], $candidate['definition_version'], 'Das konfigurierte manuelle Ausschlusslabel ist nicht mehr verfügbar.');
            }
            if (in_array($candidate['manual_label_id'], $projectedTask['label_ids'], true)) {
                return $this->projection('excluded', $candidate['board_id'], $candidate['workflow_id'], $candidate['definition_version'], 'Das Label „'.$manualLabel['name'].'“ hält die Aufgabe für Board „'.$candidate['board_name'].'“ manuell und verhindert Workflowstarts.');
            }
        }

        if (is_string($task['workflow_label_id'] ?? null) && '' !== $task['workflow_label_id'] && null === $route) {
            return $this->projection('unavailable', $candidate['board_id'] ?? $boardId, null, null, 'Die eingefrorene Aufgabenroute fehlt oder ihre Workflowversion ist nicht mehr verfügbar.');
        }
        if (null !== $route) {
            $state = null === $candidate ? 'unconfigured' : 'available';

            return $this->projection($state, $candidate['board_id'] ?? $boardId, $route['workflow_id'], $route['definition_version'], null === $candidate ? null : 'Die eingefrorene Aufgabenroute hat Vorrang vor dem Board-Standard.');
        }
        if (null === $candidate) {
            return $this->projection('unconfigured', $boardId, null, null, null);
        }

        $workflow = $this->store->find('workflows', $candidate['workflow_id']);
        if (null === $workflow || !$this->isReadyForBoard($workflow, $projectId)) {
            return $this->projection('unavailable', $candidate['board_id'], $candidate['workflow_id'], $candidate['definition_version'], 'Der Board-Workflow benötigt eine aktive Definition mit startbereiten Rollen für alle Phasen.');
        }

        return $this->projection('available', $candidate['board_id'], $candidate['workflow_id'], $candidate['definition_version'], null);
    }

    public function assertStartAllowed(array $task, ?string $boardId, string $workflowId, int $definitionVersion): void
    {
        $policy = $this->resolve($task, $boardId);
        if ('excluded' === $policy['state']) {
            throw new Problem(409, 'board_workflow_excluded', $policy['reason'] ?? 'Das manuelle Ausschlusslabel verhindert Workflowstarts.');
        }
        if ('ambiguous' === $policy['state']) {
            throw new Problem(409, 'board_workflow_ambiguous', $policy['reason'] ?? 'Mehrere passende Boards legen unterschiedliche Workflowkontexte fest.');
        }
        if ('unavailable' === $policy['state']) {
            throw new Problem(409, 'board_workflow_unavailable', $policy['reason'] ?? 'Der konfigurierte Board-Workflow ist derzeit nicht verfügbar.');
        }

        $hasTaskRoute = is_string($task['workflow_label_id'] ?? null) && '' !== $task['workflow_label_id'];
        $hasPinnedChoice = $hasTaskRoute || 'available' === $policy['state'];
        if ($hasPinnedChoice && $workflowId === $policy['workflow_id']) {
            if ($definitionVersion !== $policy['definition_version']) {
                $code = $hasTaskRoute ? 'workflow_route_conflict' : 'board_workflow_version_conflict';
                $detail = $hasTaskRoute
                    ? 'Die gespeicherte Ticketroute bindet diesen Workflow an eine andere Version.'
                    : 'Die Board-Workflowversion wurde geändert. Lade das Ticket erneut und prüfe die aktuelle Auswahl.';
                throw new Problem(409, $code, $detail);
            }

            return;
        }

        if ($hasPinnedChoice) {
            $this->assertCurrentWorkflowCanBeSelected($task, $workflowId, $definitionVersion);
        }
    }

    /** @param array<string, mixed> $task */
    private function assertCurrentWorkflowCanBeSelected(array $task, string $workflowId, int $definitionVersion): void
    {
        $workflow = $this->store->find('workflows', $workflowId);
        $currentVersion = null === $workflow ? null : ((int) ($workflow['definition_version'] ?? $workflow['version'] ?? 0) ?: null);
        if (null === $workflow
            || empty($workflow['enabled'])
            || (null !== ($workflow['project_id'] ?? null) && $workflow['project_id'] !== $task['project_id'])) {
            throw new Problem(409, 'workflow_unavailable', 'Die ausgewählte Vorlage ist nicht mehr aktiv oder gehört zu einem anderen Projekt.');
        }
        if ($currentVersion !== $definitionVersion) {
            throw new Problem(409, 'workflow_version_conflict', 'Die ausgewählte Vorlage wurde geändert. Lade das Ticket erneut und prüfe die aktuelle Version.');
        }
        if ([] === ($workflow['stages'] ?? [])) {
            throw new Problem(409, 'workflow_definition_invalid', 'Der Workflow enthält keine startbare Phase.');
        }

        $agentStages = array_values(array_filter($workflow['stages'], static fn (array $stage): bool => 'manual' !== ($stage['kind'] ?? null)));
        foreach ($agentStages as $stage) {
            if (!is_string($stage['agent_profile_id'] ?? null) || '' === $stage['agent_profile_id']) {
                return;
            }
        }
        if ([] !== $agentStages) {
            $workflow['stages'] = $agentStages;
            if (!$this->isReadyForBoard($workflow, (string) $task['project_id'])) {
                throw new Problem(409, 'workflow_unavailable', 'Die ausgewählte Vorlage benötigt startbereite Rollen für alle Agentphasen.');
            }
        }
    }

    /** @param array<string, mixed> $workflow */
    public function isReadyForBoard(array $workflow, string $projectId): bool
    {
        if ((null !== ($workflow['project_id'] ?? null) && $workflow['project_id'] !== $projectId)
            || empty($workflow['enabled'])
            || [] === ($workflow['stages'] ?? [])) {
            return false;
        }
        $binding = $this->agentCatalog->bindingForProject($projectId);
        if (null === $binding) {
            return false;
        }
        foreach ($workflow['stages'] as $stage) {
            $profileId = $stage['agent_profile_id'] ?? null;
            if (!is_string($profileId) || '' === $profileId) {
                return false;
            }
            $profile = $this->store->find('agent_profiles', $profileId);
            if (null === $profile
                || empty($profile['enabled'])
                || empty($profile['configuration_valid'])
                || ($profile['connection_id'] ?? null) !== ($binding['connection_id'] ?? null)
                || !$this->agentCatalog->profileAllowsProject($profile, $projectId)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $task @return array<string, mixed> */
    private function projectTaskLabels(array $task, string $projectId): array
    {
        $labelIds = $task['label_ids'] ?? [];
        $ownerReasons = [];
        foreach ($this->store->all('attention_reasons', $projectId) as $reason) {
            if (($reason['task_id'] ?? null) !== ($task['id'] ?? null) || empty($reason['open'])) {
                continue;
            }
            $code = $reason['code'] ?? null;
            if (is_string($code) && isset(AttentionLabelCatalog::definitions()[$code])) {
                $labelIds[] = Uuid::v5(Uuid::fromString(Uuid::NAMESPACE_URL), 'https://falkenwarte.invalid/projects/'.$projectId.'/attention/'.$code)->toRfc4122();
            }
            if (($reason['addressed_to'] ?? null) === 'owner') {
                $ownerReasons[] = $code;
            }
        }
        $task['label_ids'] = array_values(array_unique($labelIds));
        $task['human_attention'] = ['required' => [] !== $ownerReasons, 'reasons' => array_values(array_unique($ownerReasons))];

        return $task;
    }

    /** @param array<string, mixed> $board @param array<string, mixed> $task */
    private function boardContainsTask(array $board, array $task): bool
    {
        if (($board['project_id'] ?? null) !== ($task['project_id'] ?? null) || !is_array($board['config']['filter'] ?? null)) {
            return false;
        }
        foreach ($board['columns'] ?? [] as $column) {
            if (is_array($column) && in_array($task['status_id'] ?? null, $column['status_ids'] ?? [], true) && $this->boardWipPolicy->matchesFilter($task, $board['config']['filter'])) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, mixed> $task @return array{workflow_id: string, definition_version: int}|null */
    private function taskRoute(array $task): ?array
    {
        $taskId = $task['id'] ?? null;
        $workflowLabelId = $task['workflow_label_id'] ?? null;
        if (!is_string($taskId) || !is_string($workflowLabelId) || '' === $workflowLabelId) {
            return null;
        }
        $route = $this->store->find('task_routing_snapshots', $taskId);
        if (null === $route
            || ($route['task_id'] ?? null) !== $taskId
            || ($route['project_id'] ?? null) !== ($task['project_id'] ?? null)
            || ($route['workflow_label_id'] ?? null) !== $workflowLabelId
            || !is_string($route['workflow_id'] ?? null)
            || !is_int($route['workflow_definition_version'] ?? null)
            || $route['workflow_definition_version'] < 1) {
            return null;
        }
        $workflow = $this->store->find('workflows', $route['workflow_id']);
        if (null === $workflow || (null !== ($workflow['project_id'] ?? null) && $workflow['project_id'] !== ($task['project_id'] ?? null))) {
            return null;
        }
        $versionAvailable = (int) ($workflow['definition_version'] ?? $workflow['version'] ?? 0) === $route['workflow_definition_version'];
        if (!$versionAvailable) {
            foreach ($this->store->all('workflow_versions') as $candidate) {
                if (($candidate['workflow_id'] ?? null) === $route['workflow_id'] && (int) ($candidate['definition_version'] ?? 0) === $route['workflow_definition_version']) {
                    $versionAvailable = true;
                    break;
                }
            }
        }
        if (!$versionAvailable) {
            return null;
        }

        return ['workflow_id' => $route['workflow_id'], 'definition_version' => $route['workflow_definition_version']];
    }

    /** @param array<string, mixed> $board @param array<string, mixed> $policy @return array{board_id: string, board_name: string, workflow_id: string, definition_version: ?int, manual_label_id: ?string} */
    private function candidate(array $board, array $policy): array
    {
        $workflow = $this->store->find('workflows', $policy['workflow_id']);

        return [
            'board_id' => (string) $board['id'],
            'board_name' => (string) $board['name'],
            'workflow_id' => (string) $policy['workflow_id'],
            'definition_version' => null === $workflow ? null : ((int) ($workflow['definition_version'] ?? $workflow['version'] ?? 0) ?: null),
            'manual_label_id' => is_string($policy['manual_label_id'] ?? null) ? $policy['manual_label_id'] : null,
        ];
    }

    /** @return array{state: string, board_id: ?string, workflow_id: ?string, definition_version: ?int, reason: ?string} */
    private function projection(string $state, ?string $boardId, ?string $workflowId, ?int $definitionVersion, ?string $reason): array
    {
        return [
            'state' => $state,
            'board_id' => $boardId,
            'workflow_id' => $workflowId,
            'definition_version' => $definitionVersion,
            'reason' => $reason,
        ];
    }
}
