<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

use App\AgentCatalog\Application\AgentCatalogReader;
use App\Extensions\Application\PluginAvailability;
use App\Shared\Application\Actor;
use App\Shared\Application\OperationHandler;
use App\Shared\Application\Store;
use App\Shared\Domain\CustomFieldHistory;
use App\Shared\Domain\Problem;
use App\WorkManagement\Domain\AttentionLabelCatalog;
use App\WorkManagement\Domain\BoardWipPolicy;
use App\WorkManagement\Domain\TaskCompletionPolicy;
use App\WorkManagement\Domain\TaskLinkPolicy;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\Uid\Uuid;

#[AsAlias(AttentionLabelReader::class)]
final class WorkHandler implements AttentionLabelReader, OperationHandler
{
    private const TASK_FIELDS = [
        'title', 'description', 'task_type', 'priority', 'due_at', 'custom_fields', 'label_ids',
    ];

    public function __construct(
        public Store $store,
        private readonly TaskIntake $intake,
        private readonly BoardWipPolicy $wipPolicy,
        private readonly TaskCompletionPolicy $completionPolicy,
        private readonly TaskLinkPolicy $linkPolicy,
        private readonly PluginAvailability $plugins,
        private readonly AgentCatalogReader $agentCatalog,
    ) {
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'tasks_list', 'tasks_get', 'tasks_create', 'tasks_update', 'tasks_move', 'tasks_assign',
            'criteria_update', 'task_dependencies_update', 'tasks_report_blocker',
            'project_statuses_get', 'project_statuses_replace',
            'boards_list', 'boards_get', 'boards_create', 'boards_update', 'board_columns_replace', 'board_view_get',
            'labels_list', 'labels_create', 'labels_update', 'tasks_labels_set',
            'tasks_links_list', 'tasks_link_collection_create', 'tasks_link_collection_update',
            'tasks_link_collection_remove', 'tasks_link_register', 'tasks_link_update', 'tasks_link_remove',
            'evidence_list', 'evidence_get', 'evidence_register', 'evidence_review', 'tasks_link_evidence', 'criteria_review',
            'history_get', 'history_revision_get', 'history_restore',
        ], true);
    }

    /** @param array<string, mixed> $p @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'tasks_list' => $this->listTasks($p, $actor),
            'project_statuses_get' => $this->getStatuses($this->pathId($p, 'project_id'), $actor),
            'project_statuses_replace' => $this->replaceStatuses($this->pathId($p, 'project_id'), $body, $actor),
            'tasks_get' => $this->getTask($this->pathId($p, 'task_id'), $actor),
            'tasks_create' => $this->createTask($this->pathId($p, 'project_id'), $body, $actor),
            'tasks_update' => $this->updateTask($this->pathId($p, 'task_id'), $body, $actor),
            'tasks_move' => $this->moveTask($this->pathId($p, 'task_id'), $body, $actor),
            'tasks_assign' => $this->assignTask($this->pathId($p, 'task_id'), $body, $actor),
            'criteria_update' => $this->replaceCriteria($this->pathId($p, 'task_id'), $body, $actor),
            'task_dependencies_update' => $this->replaceDependencies($this->pathId($p, 'task_id'), $body, $actor),
            'tasks_report_blocker' => $this->setBlocker($this->pathId($p, 'task_id'), $body, $actor),
            'boards_list' => $this->listBoards($this->pathId($p, 'project_id'), $p, $actor),
            'boards_get' => $this->getBoard($this->pathId($p, 'board_id'), $actor),
            'boards_create' => $this->createBoard($this->pathId($p, 'project_id'), $body, $actor),
            'boards_update' => $this->updateBoard($this->pathId($p, 'board_id'), $body, $actor),
            'board_columns_replace' => $this->replaceBoardColumns($this->pathId($p, 'board_id'), $body, $actor),
            'board_view_get' => $this->boardView($this->pathId($p, 'board_id'), $p, $actor),
            'labels_list' => $this->listLabels($this->pathId($p, 'project_id'), $actor),
            'labels_create' => $this->createLabel($this->pathId($p, 'project_id'), $body, $actor),
            'labels_update' => $this->updateLabel($this->pathId($p, 'project_id'), $this->pathId($p, 'label_id'), $body, $actor),
            'tasks_labels_set' => $this->setTaskLabels($this->pathId($p, 'task_id'), $body, $actor),
            'tasks_links_list' => $this->listLinkCollections($this->pathId($p, 'task_id'), $actor),
            'tasks_link_collection_create' => $this->createLinkCollection($this->pathId($p, 'task_id'), $body, $actor),
            'tasks_link_collection_update' => $this->updateLinkCollection($this->pathId($p, 'task_id'), $this->pathId($p, 'collection_id'), $body, $actor),
            'tasks_link_collection_remove' => $this->removeLinkCollection($this->pathId($p, 'task_id'), $this->pathId($p, 'collection_id'), $actor),
            'tasks_link_register' => $this->registerLink($this->pathId($p, 'task_id'), $this->pathId($p, 'collection_id'), $body, $actor),
            'tasks_link_update' => $this->updateLink($this->pathId($p, 'task_id'), $this->pathId($p, 'collection_id'), $this->pathId($p, 'link_id'), $body, $actor),
            'tasks_link_remove' => $this->removeLink($this->pathId($p, 'task_id'), $this->pathId($p, 'collection_id'), $this->pathId($p, 'link_id'), $actor),
            'evidence_list' => $this->listEvidence($p, $actor),
            'evidence_get' => $this->getEvidence($this->pathId($p, 'evidence_id'), $actor),
            'evidence_register' => $this->registerEvidence($this->pathId($p, 'task_id'), $body, $actor),
            'evidence_review' => $this->reviewEvidence($this->pathId($p, 'evidence_id'), $body, $actor),
            'tasks_link_evidence' => $this->attachEvidence($this->pathId($p, 'task_id'), $this->pathId($p, 'criterion_id'), $body, $actor),
            'criteria_review' => $this->reviewCriterion($this->pathId($p, 'task_id'), $this->pathId($p, 'criterion_id'), $body, $actor),
            'history_get' => $this->listHistory($p, $actor),
            'history_revision_get' => $this->getRevision($this->pathId($p, 'revision_id'), $actor),
            'history_restore' => $this->restoreRevision($this->pathId($p, 'revision_id'), $body, $actor),
            default => throw new Problem(404, 'operation_not_found', 'Unbekannte Arbeitsmanagement-Operation.'),
        };
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listTasks(array $p, Actor $actor): array
    {
        $projectId = isset($p['project_id']) && is_string($p['project_id']) ? $p['project_id'] : null;
        if (null !== $projectId) {
            $actor->requireProject($projectId);
        }
        $tasks = $this->store->all('tasks', $projectId);
        $tasks = array_values(array_filter($tasks, static fn (array $task): bool => $actor->canProject($task['project_id'])));
        $filters = [
            'status_id' => 'status_id',
            'agent_profile_id' => 'agent_profile_id',
            'priority' => 'priority',
            'blocked' => 'blocked',
        ];
        foreach ($filters as $query => $field) {
            if (array_key_exists($query, $p) && '' !== $p[$query] && null !== $p[$query]) {
                $value = 'blocked' === $query ? filter_var($p[$query], FILTER_VALIDATE_BOOLEAN) : $p[$query];
                $tasks = array_values(array_filter($tasks, static fn (array $task): bool => $task[$field] === $value));
            }
        }
        if (isset($p['status_ids']) && [] !== $p['status_ids']) {
            $tasks = array_values(array_filter($tasks, static fn (array $task): bool => in_array($task['status_id'], (array) $p['status_ids'], true)));
        }
        if (isset($p['labels']) && [] !== $p['labels']) {
            $requestedKeys = (array) $p['labels'];
            $tasks = array_values(array_filter($tasks, function (array $task) use ($requestedKeys): bool {
                $labelIds = [];
                foreach ($this->labelsForProject($task['project_id']) as $label) {
                    if (in_array($label['key'], $requestedKeys, true)) {
                        $labelIds[] = $label['id'];
                    }
                }

                return [] !== array_intersect($labelIds, $this->projectedTaskLabelIds($task));
            }));
        }
        if (isset($p['label_id'])) {
            $tasks = array_values(array_filter($tasks, fn (array $task): bool => in_array($p['label_id'], $this->projectedTaskLabelIds($task), true)));
        }
        if (isset($p['human_attention_required'])) {
            $expected = filter_var($p['human_attention_required'], FILTER_VALIDATE_BOOLEAN);
            $tasks = array_values(array_filter($tasks, fn (array $task): bool => ([] !== $this->openAttentionReasons($task['id'], $task['project_id'], 'owner')) === $expected));
        }
        if (isset($p['intake_outcome'])) {
            $tasks = array_values(array_filter($tasks, static fn (array $task): bool => $task['intake_outcome'] === $p['intake_outcome']));
        }
        $query = trim((string) ($p['q'] ?? ''));
        if ('' !== $query) {
            $needle = mb_strtolower($query);
            $tasks = array_values(array_filter($tasks, static fn (array $task): bool => str_contains(mb_strtolower($task['title'].' '.$task['description'].' '.$task['key']), $needle)));
        }

        $field = in_array($p['sort'] ?? '', ['created_at', 'updated_at', 'due_at', 'priority', 'title'], true) ? $p['sort'] : 'updated_at';
        $direction = ($p['direction'] ?? 'desc') === 'asc' ? 1 : -1;
        usort($tasks, static function (array $left, array $right) use ($field, $direction): int {
            $a = $left[$field] ?? '';
            $b = $right[$field] ?? '';

            return ($a <=> $b) * $direction;
        });

        return $this->store->page(array_map(fn (array $task): array => $this->presentTask($task), $tasks), $p);
    }

    /** @return array<string, mixed> */
    private function getTask(string $id, Actor $actor): array
    {
        return $this->presentTask($this->task($id, $actor));
    }

    /** @return array<string, mixed> */
    private function getStatuses(string $projectId, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $project = $this->project($projectId);
        $statuses = $this->store->all('statuses', $projectId);
        usort($statuses, static fn (array $a, array $b): int => $a['position'] <=> $b['position']);

        return ['project_id' => $projectId, 'project_version' => $project['version'], 'items' => array_map($this->presentStatus(...), $statuses)];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function replaceStatuses(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $project = $this->project($projectId);
        $oldStatuses = $this->store->all('statuses', $projectId);
        $oldById = [];
        foreach ($oldStatuses as $status) {
            $oldById[$status['id']] = $status;
        }

        $statuses = [];
        $seenIds = [];
        $defaultCount = 0;
        foreach ($body['statuses'] as $position => $input) {
            $status = $input;
            $status['project_id'] = $projectId;
            $status['position'] = $position;
            if (!empty($status['is_default'])) {
                ++$defaultCount;
            }
            if (isset($status['id'])) {
                if (isset($seenIds[$status['id']])) {
                    throw new Problem(422, 'validation_failed', 'Status-IDs müssen eindeutig sein.');
                }
                $seenIds[$status['id']] = true;
                if (isset($oldById[$status['id']])) {
                    $this->guardUsedStatusCategory($oldById[$status['id']], $status);
                } elseif (null !== $this->store->find('statuses', $status['id'])) {
                    throw new Problem(409, 'status_id_conflict', 'Die Status-ID wird bereits in einem anderen Projekt verwendet.');
                }
            }
            $statuses[] = $status;
        }

        if (1 !== $defaultCount) {
            throw new Problem(422, 'validation_failed', 'Genau ein Projektstatus muss als Standard markiert sein.');
        }

        $byId = [];
        foreach ($statuses as $status) {
            if (isset($status['id'])) {
                $byId[$status['id']] = $status;
            }
        }

        foreach ($oldStatuses as $oldStatus) {
            if (isset($byId[$oldStatus['id']])) {
                continue;
            }
            $this->guardBoardStatusRemoval($oldStatus['id'], $statuses, $projectId);
            $replacementId = null;
            foreach (($body['reassignments'] ?? []) as $reassignment) {
                if ($reassignment['from_status_id'] === $oldStatus['id']) {
                    $replacementId = $reassignment['to_status_id'];
                    break;
                }
            }
            if (null === $replacementId || !isset($byId[$replacementId])) {
                $used = array_filter($this->store->all('tasks', $projectId), static fn (array $task): bool => $task['status_id'] === $oldStatus['id']);
                if ([] !== $used) {
                    throw new Problem(409, 'status_in_use', 'Verwendete Status benötigen vor dem Entfernen eine gültige Neuzuordnung.');
                }
                $this->store->remove('statuses', $oldStatus['id'], 'task_status.removed');
                continue;
            }
            foreach ($this->store->all('tasks', $projectId) as $task) {
                if ($task['status_id'] !== $oldStatus['id']) {
                    continue;
                }
                $task['status_id'] = $replacementId;
                $task['status_category'] = $byId[$replacementId]['category'];
                $this->assertBoardChangeAllowed($task, null);
                $this->store->save('tasks', $task, 'task.status_reassigned');
            }
            $this->store->remove('statuses', $oldStatus['id'], 'task_status.removed');
        }

        foreach ($statuses as $status) {
            $this->store->save('statuses', $status, isset($status['id']) ? 'task_status.updated' : 'task_status.created');
        }
        $project = $this->store->save('projects', $project, 'project.statuses_replaced');

        return ['project_id' => $projectId, 'project_version' => $project['version'], 'items' => array_map($this->presentStatus(...), $this->store->all('statuses', $projectId))];
    }

    /** @param array<string, mixed> $old @param array<string, mixed> $new */
    private function guardUsedStatusCategory(array $old, array $new): void
    {
        if ($old['category'] === $new['category']) {
            return;
        }
        foreach ($this->store->all('tasks', $old['project_id']) as $task) {
            if ($task['status_id'] === $old['id']) {
                throw new Problem(409, 'status_category_in_use', 'Die Kategorie eines verwendeten Status kann nicht geändert werden.');
            }
        }
    }

    /** @param list<array<string, mixed>> $statuses */
    private function guardBoardStatusRemoval(string $statusId, array $statuses, string $projectId): void
    {
        foreach ($statuses as $candidate) {
            if (($candidate['id'] ?? null) === $statusId) {
                return;
            }
        }
        foreach ($this->store->all('boards', $projectId) as $board) {
            foreach ($board['columns'] as $column) {
                if (in_array($statusId, $column['status_ids'], true) || ($column['default_drop_status_id'] ?? null) === $statusId) {
                    throw new Problem(409, 'status_in_use', 'Ein in einer Boardspalte verwendeter Status kann nicht entfernt werden.');
                }
            }
        }
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createTask(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $project = $this->project($projectId);
        if (isset($body['label_ids']) && !$actor->owner) {
            throw new Problem(403, 'forbidden', 'Technische Principals können Labels vorschlagen, aber keine Einordnung festlegen.');
        }
        $statuses = $this->store->all('statuses', $projectId);
        $status = null;
        if (isset($body['status_id'])) {
            $status = $this->findRecord($statuses, (string) $body['status_id']);
        } else {
            foreach ($statuses as $candidate) {
                if ($candidate['is_default']) {
                    $status = $candidate;
                    break;
                }
            }
        }
        if (null === $status) {
            throw new Problem(422, 'validation_failed', 'Der gewählte Ticketstatus gehört nicht zu diesem Projekt.');
        }

        $labels = $actor->owner ? $this->validateLabelIds($projectId, $body['label_ids'] ?? []) : [];
        $primaryTopic = null;
        foreach ($labels as $label) {
            if ('topic' === $label['kind']) {
                $primaryTopic ??= $label['id'];
            }
        }
        $criteria = $this->normalizeCriteria($body['criteria'] ?? []);
        $task = [
            'project_id' => $projectId,
            'key' => $this->nextTaskKey($project),
            'title' => trim((string) $body['title']),
            'description' => (string) ($body['description'] ?? ''),
            'task_type' => (string) ($body['task_type'] ?? 'task'),
            'priority' => (string) ($body['priority'] ?? 'normal'),
            'due_at' => $body['due_at'] ?? null,
            'status_id' => $status['id'],
            'status_category' => $status['category'],
            'criteria' => $criteria,
            'depends_on_task_ids' => [],
            'blocked' => false,
            'blocker_reason' => null,
            'requested_role' => $body['requested_role'] ?? null,
            'agent_profile_id' => $body['agent_profile_id'] ?? null,
            'latest_run_id' => null,
            'custom_fields' => $this->validateCustomFields($projectId, $body['custom_fields'] ?? []),
            'label_ids' => array_column($labels, 'id'),
            'primary_topic_label_id' => $primaryTopic,
            'workflow_label_id' => $this->workflowLabelId($labels),
            'human_attention' => ['required' => false, 'reasons' => []],
            'intake_outcome' => null,
            'origin' => $actor->owner ? 'manual' : ('mcp' === $actor->transport ? 'mcp' : 'technical_api'),
            'classification_required' => !$actor->owner,
            'classification_id' => null,
            'link_collection_ids' => [],
        ];
        $this->assertBoardChangeAllowed($task, null);
        $task = $this->store->save('tasks', $task, 'task.created');
        if ($actor->owner && null !== $task['workflow_label_id']) {
            $this->freezeWorkflowRoute($task, $task['workflow_label_id'], 'current_unstarted');
        }
        foreach (($body['link_collections'] ?? []) as $initial) {
            $this->createInitialCollection($this->store->get('tasks', $task['id']), $initial, $actor);
        }
        $task = $this->task($task['id'], $actor);
        if ($actor->owner && [] !== $task['label_ids']) {
            $this->store->save('classification_controls', [
                'id' => $task['id'], 'task_id' => $task['id'], 'project_id' => $task['project_id'],
                'owner_override' => true, 'reason' => 'owner_task_create',
            ], 'classification.owner_override_set');
        }

        if (!$actor->owner) {
            $suggestedLabelIds = $body['suggested_label_ids'] ?? [];
            foreach ($suggestedLabelIds as $suggestedLabelId) {
                $suggested = $this->label((string) $suggestedLabelId, $projectId);
                if ('topic' !== $suggested['kind'] || !$suggested['active']) {
                    throw new Problem(422, 'validation_failed', 'Vorgeschlagene Labels müssen aktive Topiclabels des Projekts sein.');
                }
            }

            return $this->intake->acceptTechnicalTask($task, $actor, $this->store->actionId(), $suggestedLabelIds);
        }

        $manualIntake = $this->intake->acceptManualTask($task, $actor);
        if (null !== $manualIntake) {
            return $manualIntake;
        }

        return [
            'outcome' => 'ready',
            'task_id' => $task['id'],
            'intake_id' => null,
            'action_id' => $this->store->actionId(),
            'task_version' => $task['version'],
            'missing_fields' => [],
            'human_attention' => ['required' => false, 'reasons' => []],
            'classification_id' => null,
            'poll_after_ms' => null,
        ];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateTask(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        if (isset($body['label_ids']) && !$actor->owner) {
            throw new Problem(403, 'forbidden', 'Technische Principals können Labels nicht direkt ändern.');
        }
        $before = $task;
        foreach (self::TASK_FIELDS as $field) {
            if (!array_key_exists($field, $body)) {
                continue;
            }
            if ('label_ids' === $field) {
                $task[$field] = array_column($this->validateLabelIds($task['project_id'], $body[$field]), 'id');
                $task['primary_topic_label_id'] = $this->firstKindLabel($task['project_id'], $task[$field], 'topic');
                $task['workflow_label_id'] = $this->firstKindLabel($task['project_id'], $task[$field], 'workflow');
            } else {
                $task[$field] = 'custom_fields' === $field ? $this->validateCustomFields($task['project_id'], $body[$field], $before['custom_fields'] ?? []) : $body[$field];
            }
        }
        $this->assertBoardChangeAllowed($task, $before);
        $task = $this->store->save('tasks', $task, 'task.updated');
        if (isset($body['label_ids'])) {
            if ($task['workflow_label_id'] !== $before['workflow_label_id']) {
                $this->freezeWorkflowRoute($task, $task['workflow_label_id'], 'current_unstarted');
            }
            $this->store->save('classification_controls', [
                'id' => $task['id'], 'task_id' => $task['id'], 'project_id' => $task['project_id'],
                'owner_override' => true, 'reason' => 'owner_task_update',
            ], 'classification.owner_override_set');
        }
        if (!$actor->owner && (isset($body['title']) || isset($body['description']) || isset($body['suggested_label_ids']))) {
            $this->intake->invalidateForTaskRevision($task, $actor, 'technical_task_revision_changed', $body['suggested_label_ids'] ?? []);
            $task = $this->store->get('tasks', $task['id']);
        }

        return $this->presentTask($task);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function moveTask(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        $before = $task;
        $status = $this->status((string) $body['status_id'], $task['project_id']);
        if ('done' === $status['category']) {
            $this->assertTaskCompletionPolicy($task);
        }
        $task['status_id'] = $status['id'];
        $task['status_category'] = $status['category'];
        $this->assertBoardChangeAllowed($task, $before);
        $task = $this->store->save('tasks', $task, 'task.moved');

        if (isset($body['board_id'])) {
            $board = $this->board((string) $body['board_id'], $actor);
            if ($board['project_id'] !== $task['project_id']) {
                throw new Problem(409, 'project_mismatch', 'Board und Ticket gehören zu verschiedenen Projekten.');
            }
            $this->setBoardPosition($board, $task, $status, $body['before_task_id'] ?? null, $body['after_task_id'] ?? null);
        }

        return $this->presentTask($task);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function assignTask(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        $before = $task;
        $profileId = $body['agent_profile_id'] ?? null;
        if (null !== $profileId) {
            $profile = $this->store->find('agent_profiles', (string) $profileId);
            if (null === $profile || !$this->agentCatalog->profileAllowsProject($profile, (string) $task['project_id']) || empty($profile['enabled'])) {
                throw new Problem(409, 'invalid_assignment', 'Das Rollenprofil ist für dieses Projekt nicht freigegeben.');
            }
        }
        $task['agent_profile_id'] = $profileId;
        $task['requested_role'] = $body['requested_role'] ?? null;
        $this->assertBoardChangeAllowed($task, $before);

        return $this->presentTask($this->store->save('tasks', $task, 'task.assigned'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function replaceCriteria(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        $before = $task;
        $oldById = [];
        foreach ($task['criteria'] as $criterion) {
            $oldById[$criterion['id']] = $criterion;
        }
        $task['criteria'] = $this->normalizeCriteria($body['criteria'], $oldById);
        $this->assertBoardChangeAllowed($task, $before);

        return $this->presentTask($this->store->save('tasks', $task, 'task.criteria_replaced'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function replaceDependencies(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        $dependencies = array_values(array_unique($body['depends_on_task_ids']));
        if (in_array($id, $dependencies, true)) {
            throw new Problem(409, 'dependency_cycle', 'Ein Ticket kann nicht von sich selbst abhängen.');
        }
        foreach ($dependencies as $dependencyId) {
            $dependency = $this->store->find('tasks', $dependencyId);
            if (null === $dependency || $dependency['project_id'] !== $task['project_id']) {
                throw new Problem(409, 'project_mismatch', 'Abhängigkeiten müssen zu Tickets desselben Projekts führen.');
            }
            if ($this->dependencyReachable((string) $dependencyId, $id, [])) {
                throw new Problem(409, 'dependency_cycle', 'Die Abhängigkeit würde einen Zyklus erzeugen.');
            }
        }
        $task['depends_on_task_ids'] = $dependencies;

        return $this->presentTask($this->store->save('tasks', $task, 'task.dependencies_replaced'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function setBlocker(string $id, array $body, Actor $actor): array
    {
        $task = $this->task($id, $actor);
        $before = $task;
        $task['blocked'] = (bool) $body['blocked'];
        $task['blocker_reason'] = $task['blocked'] ? trim((string) $body['reason']) : (trim((string) ($body['reason'] ?? '')) ?: null);
        $this->assertBoardChangeAllowed($task, $before);

        return $this->presentTask($this->store->save('tasks', $task, $task['blocked'] ? 'task.blocked' : 'task.unblocked'));
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listBoards(string $projectId, array $p, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $boards = $this->store->all('boards', $projectId);
        if (isset($p['archived'])) {
            $archived = filter_var($p['archived'], FILTER_VALIDATE_BOOLEAN);
            $boards = array_values(array_filter($boards, static fn (array $board): bool => $board['archived'] === $archived));
        }
        usort($boards, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return $this->store->page(array_map(fn (array $board): array => $this->presentBoard($board), $boards), $p);
    }

    /** @return array<string, mixed> */
    private function getBoard(string $id, Actor $actor): array
    {
        return $this->presentBoard($this->board($id, $actor));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createBoard(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $this->project($projectId);
        $this->validateBoardConfig($projectId, $body['config']);
        $columns = $this->normalizeColumns($projectId, $body['columns']);
        $board = $this->store->save('boards', [
            'project_id' => $projectId,
            'name' => trim($body['name']),
            'config' => $body['config'],
            'columns' => $columns,
            'archived' => false,
        ], 'board.created');
        $this->assertBoardConfigurationWithinLimits($board);

        return $this->presentBoard($board);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateBoard(string $id, array $body, Actor $actor): array
    {
        $board = $this->board($id, $actor);
        if (isset($body['name'])) {
            $board['name'] = trim($body['name']);
        }
        if (isset($body['config'])) {
            $this->validateBoardConfig($board['project_id'], $body['config']);
            $board['config'] = $body['config'];
        }
        if (array_key_exists('archived', $body)) {
            $board['archived'] = (bool) $body['archived'];
        }
        $this->assertBoardConfigurationWithinLimits($board);

        return $this->presentBoard($this->store->save('boards', $board, 'board.updated'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function replaceBoardColumns(string $id, array $body, Actor $actor): array
    {
        $board = $this->board($id, $actor);
        $board['columns'] = $this->normalizeColumns($board['project_id'], $body['columns']);
        $this->assertBoardConfigurationWithinLimits($board);

        return $this->presentBoard($this->store->save('boards', $board, 'board.columns_replaced'));
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function boardView(string $id, array $p, Actor $actor): array
    {
        $board = $this->board($id, $actor);
        $limit = max(1, min(100, (int) ($p['limit_per_column'] ?? 30)));
        $selectedColumn = $p['column_id'] ?? null;
        $initialRemaining = empty($p['cursor']) ? 500 : PHP_INT_MAX;
        $columns = [];
        $allTasks = $this->store->all('tasks', $board['project_id']);
        foreach ($board['columns'] as $column) {
            if (null !== $selectedColumn && $selectedColumn !== $column['id']) {
                continue;
            }
            $tasks = array_values(array_filter(
                $allTasks,
                fn (array $task): bool => in_array($task['status_id'], $column['status_ids'], true)
                    && $this->matchesBoardFilter($task, $board['config']['filter']),
            ));
            $this->sortBoardTasks($tasks, $board, $column);
            $total = count($tasks);
            $items = array_slice($tasks, 0, min($limit, $initialRemaining));
            $cursor = $p['cursor'] ?? null;
            if (is_string($cursor) && '' !== $cursor) {
                $offset = max(0, (int) base64_decode($cursor, true));
                $items = array_slice($tasks, $offset, $limit);
                $nextOffset = $offset + count($items);
            } else {
                $nextOffset = count($items);
                $initialRemaining -= count($items);
            }
            $columns[] = [
                'column_id' => $column['id'],
                'items' => array_map(fn (array $task): array => $this->presentTask($task), $items),
                'next_cursor' => $nextOffset < $total ? base64_encode((string) $nextOffset) : null,
                'total' => $total,
                'wip_exceeded' => null !== $column['wip_limit'] && $total > $column['wip_limit'],
            ];
        }

        return ['board' => $this->presentBoard($board), 'columns' => $columns, 'computed_at' => $this->store->now()];
    }

    /** @return array<string, mixed> */
    private function listLabels(string $projectId, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $labels = $this->labelsForProject($projectId);
        $taxonomy = $this->store->find('label_taxonomies', $projectId);

        return ['project_id' => $projectId, 'taxonomy_version' => $taxonomy['taxonomy_version'] ?? 1, 'items' => $labels];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createLabel(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $actor->requireProject($projectId);
        if (str_starts_with((string) $body['key'], 'attention:')) {
            throw new Problem(422, 'system_label_immutable', 'Der Schlüsselbereich attention: ist systemverwalteten Labels vorbehalten.');
        }
        foreach ($this->store->all('labels', $projectId) as $existing) {
            if ($existing['key'] === $body['key']) {
                throw new Problem(409, 'label_key_conflict', 'Dieser Labelschlüssel ist bereits vergeben.');
            }
        }
        $label = $this->store->save('labels', [
            'project_id' => $projectId,
            'key' => $body['key'],
            'name' => trim($body['name']),
            'color' => strtoupper($body['color']),
            'description' => trim($body['description']),
            'kind' => $body['kind'],
            'system_managed' => false,
            'active' => true,
        ], 'label.created');
        $this->incrementTaxonomy($projectId);

        return $label;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateLabel(string $projectId, string $labelId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $actor->requireProject($projectId);
        $label = $this->label($labelId, $projectId);
        $taxonomicChange = false;
        foreach (['name', 'description', 'active'] as $field) {
            if (!array_key_exists($field, $body)) {
                continue;
            }
            if ($label[$field] !== $body[$field]) {
                $taxonomicChange = true;
            }
            $label[$field] = $body[$field];
        }
        if (isset($body['color'])) {
            $label['color'] = strtoupper($body['color']);
        }
        if (!empty($label['system_managed']) && isset($body['active']) && false === $body['active']) {
            throw new Problem(409, 'system_label_immutable', 'Systemlabels können nicht deaktiviert werden.');
        }
        if ('workflow' === $label['kind'] && isset($body['active']) && false === $body['active']) {
            $routing = $this->store->find('routing_rules', $projectId);
            foreach ($routing['rules'] ?? [] as $rule) {
                if ($rule['workflow_label_id'] === $labelId) {
                    throw new Problem(409, 'label_route_in_use', 'Ein Workflowlabel mit aktiver Route kann nicht deaktiviert werden.');
                }
            }
        }
        $visibleVersion = $label['version'];
        $label = $this->store->save('labels', $label, 'label.updated');
        if ('attention' === $label['kind']) {
            // Synthetic definitions start at version 1. Materializing the first edit in Store also
            // starts its managed version at 1, so expose a distinct post-edit version to If-Match.
            $label['version'] = $visibleVersion + 1;
        }
        if ($taxonomicChange && 'attention' !== $label['kind']) {
            $this->incrementTaxonomy($projectId);
        }

        return $label;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function setTaskLabels(string $taskId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $task = $this->task($taskId, $actor);
        $before = $task;
        $labels = $this->validateLabelIds($task['project_id'], $body['label_ids']);
        $primary = $body['primary_topic_label_id'] ?? null;
        if (null !== $primary) {
            $primaryLabel = $this->label((string) $primary, $task['project_id']);
            if ('topic' !== $primaryLabel['kind'] || !in_array($primary, array_column($labels, 'id'), true)) {
                throw new Problem(422, 'validation_failed', 'Das primäre Thema muss ein zugeordnetes Topiclabel sein.');
            }
        }
        $workflowLabels = array_values(array_filter($labels, static fn (array $label): bool => 'workflow' === $label['kind']));
        if (count($workflowLabels) > 1) {
            throw new Problem(409, 'workflow_route_conflict', 'Eine Aufgabe kann höchstens ein Workflowlabel erhalten.');
        }
        if (null === $primary) {
            foreach ($labels as $label) {
                if ('topic' === $label['kind']) {
                    $primary = $label['id'];
                    break;
                }
            }
        }
        $task['label_ids'] = array_column($labels, 'id');
        $task['primary_topic_label_id'] = $primary;
        $task['workflow_label_id'] = $workflowLabels[0]['id'] ?? null;
        $this->assertBoardChangeAllowed($task, $before);
        $task = $this->store->save('tasks', $task, 'task.labels_set');
        $this->freezeWorkflowRoute($task, $task['workflow_label_id'], $body['routing_application']);
        $this->store->save('classification_controls', [
            'id' => $task['id'], 'task_id' => $task['id'], 'project_id' => $task['project_id'],
            'owner_override' => true, 'reason' => trim($body['reason']), 'routing_application' => $body['routing_application'],
        ], 'classification.owner_override_set');

        return $this->presentTask($task);
    }

    /** @return array<string, mixed> */
    private function listLinkCollections(string $taskId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);

        return [
            'task_id' => $taskId,
            'task_version' => $task['version'],
            'items' => array_map(
                fn (array $collection): array => $this->presentCollection($collection, $task['version']),
                $this->collectionsForTask($taskId),
            ),
        ];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createLinkCollection(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        if (count($task['link_collection_ids']) >= 30) {
            throw new Problem(409, 'collection_limit', 'Ein Ticket kann höchstens 30 Link-Collections enthalten.');
        }
        $collection = $this->store->save('link_collections', [
            'project_id' => $task['project_id'], 'task_id' => $taskId,
            'name' => trim($body['name']), 'kind' => $body['kind'], 'links' => [],
        ], 'task.link_collection_created');
        $task['link_collection_ids'][] = $collection['id'];
        $task = $this->store->save('tasks', $task, 'task.link_collection_added');
        $collection['task_version'] = $task['version'];
        $collection = $this->store->save('link_collections', $collection, 'task.link_collection_versioned');

        return $this->presentCollection($collection, $task['version']);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateLinkCollection(string $taskId, string $collectionId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $collection = $this->collection($taskId, $collectionId);
        $collection['name'] = trim($body['name']);
        $collection['kind'] = $body['kind'];
        $task = $this->store->save('tasks', $task, 'task.link_collection_updated');
        $collection['task_version'] = $task['version'];
        $collection = $this->store->save('link_collections', $collection, 'task.link_collection_updated');

        return $this->presentCollection($collection, $task['version']);
    }

    /** @return array<string, mixed> */
    private function removeLinkCollection(string $taskId, string $collectionId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $collection = $this->collection($taskId, $collectionId);
        $removedLinkIds = array_column($collection['links'], 'id');
        $task['link_collection_ids'] = array_values(array_filter($task['link_collection_ids'], static fn (string $id): bool => $id !== $collectionId));
        $task = $this->store->save('tasks', $task, 'task.link_collection_removed');
        $this->invalidateEvidenceForLinks($removedLinkIds);
        $this->store->remove('link_collections', $collectionId, 'task.link_collection_removed');

        return $this->presentTask($this->store->get('tasks', $taskId));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function registerLink(string $taskId, string $collectionId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $collection = $this->collection($taskId, $collectionId);
        if (count($collection['links']) >= 200) {
            throw new Problem(409, 'link_limit', 'Eine Link-Collection kann höchstens 200 Referenzen enthalten.');
        }
        $link = $this->newLink($body, $actor);
        $collection['links'][] = $link;
        $task = $this->store->save('tasks', $task, 'task.link_registered');
        $collection['task_version'] = $task['version'];
        $collection = $this->store->save('link_collections', $collection, 'work.link_registered');

        return $this->presentCollection($collection, $task['version']);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateLink(string $taskId, string $collectionId, string $linkId, array $body, Actor $actor): array
    {
        $this->task($taskId, $actor);
        $collection = $this->collection($taskId, $collectionId);
        $found = false;
        foreach ($collection['links'] as $index => $existing) {
            if ($existing['id'] !== $linkId) {
                continue;
            }
            $replacement = $this->newLink($body, $actor, $existing);
            $replacement['id'] = $linkId;
            $replacement['registered_by'] = $existing['registered_by'];
            $replacement['registered_at'] = $existing['registered_at'];
            $collection['links'][$index] = $replacement;
            $found = true;
            break;
        }
        if (!$found) {
            throw new Problem(404, 'resource_not_found', 'Link wurde in dieser Collection nicht gefunden.');
        }
        $task = $this->store->find('tasks', $taskId);
        $task = $this->store->save('tasks', $task, 'task.link_updated');
        $collection['task_version'] = $task['version'];
        $collection = $this->store->save('link_collections', $collection, 'work.link_updated');
        $this->invalidateEvidenceForLinks([$linkId]);
        $task = $this->store->get('tasks', $taskId);
        if ($collection['task_version'] !== $task['version']) {
            $collection['task_version'] = $task['version'];
            $collection = $this->store->save('link_collections', $collection, 'task.link_version_refreshed');
        }

        return $this->presentCollection($collection, $task['version']);
    }

    /** @return array<string, mixed> */
    private function removeLink(string $taskId, string $collectionId, string $linkId, Actor $actor): array
    {
        $this->task($taskId, $actor);
        $collection = $this->collection($taskId, $collectionId);
        $beforeCount = count($collection['links']);
        $collection['links'] = array_values(array_filter($collection['links'], static fn (array $link): bool => $link['id'] !== $linkId));
        if (count($collection['links']) === $beforeCount) {
            throw new Problem(404, 'resource_not_found', 'Link wurde in dieser Collection nicht gefunden.');
        }
        $task = $this->store->find('tasks', $taskId);
        $task = $this->store->save('tasks', $task, 'task.link_removed');
        $collection['task_version'] = $task['version'];
        $collection = $this->store->save('link_collections', $collection, 'work.link_removed');
        $this->invalidateEvidenceForLinks([$linkId]);
        $task = $this->store->get('tasks', $taskId);
        if ($collection['task_version'] !== $task['version']) {
            $collection['task_version'] = $task['version'];
            $collection = $this->store->save('link_collections', $collection, 'task.link_version_refreshed');
        }

        return $this->presentCollection($collection, $task['version']);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listEvidence(array $p, Actor $actor): array
    {
        $projectId = isset($p['project_id']) ? (string) $p['project_id'] : null;
        if (null !== $projectId) {
            $actor->requireProject($projectId);
        }
        $items = $this->store->all('evidence', $projectId);
        $items = array_values(array_filter($items, static fn (array $item): bool => $actor->canProject($item['project_id'])));
        if (isset($p['task_id'])) {
            $items = array_values(array_filter($items, static fn (array $item): bool => $item['task_id'] === $p['task_id']));
        }

        return $this->store->page($items, $p);
    }

    /** @return array<string, mixed> */
    private function getEvidence(string $id, Actor $actor): array
    {
        $evidence = $this->store->find('evidence', $id);
        if (null === $evidence) {
            throw new Problem(404, 'resource_not_found', 'Nachweis wurde nicht gefunden.');
        }
        $actor->requireProject($evidence['project_id']);

        return $evidence;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function registerEvidence(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        if ($body['task_id'] !== $taskId || $body['task_revision'] !== $task['version']) {
            throw new Problem(409, 'version_conflict', 'Der Nachweis bezieht sich nicht auf die aktuelle Ticketrevision.');
        }
        $artifact = $body['artifact'];
        $linkIds = array_values(array_unique($artifact['link_ids'] ?? []));
        $linkSnapshot = [];
        foreach ($linkIds as $linkId) {
            $link = $this->findLink($taskId, $linkId);
            if (null === $link) {
                throw new Problem(409, 'evidence_link_missing', 'Nachweise dürfen nur bereits registrierte Ticketlinks referenzieren.');
            }
            $linkSnapshot[] = $link;
        }
        $criterionIds = array_values(array_unique($body['criterion_ids'] ?? []));
        $this->assertCriteriaExist($task, $criterionIds);
        $run = null;
        if (($body['run_id'] ?? null) !== null) {
            $run = $this->store->find('runs', (string) $body['run_id']);
            if (null === $run || ($run['task_id'] ?? null) !== $taskId || $run['project_id'] !== $task['project_id']) {
                throw new Problem(409, 'run_context_mismatch', 'Der Run gehört nicht zu diesem Ticket.');
            }
            if (($body['attempt_no'] ?? null) !== ($run['attempt_no'] ?? null)) {
                throw new Problem(409, 'run_context_mismatch', 'Der Nachweis muss den aktuellen Runversuch referenzieren.');
            }
        }
        $evidence = $this->store->save('evidence', [
            'project_id' => $task['project_id'],
            'task_id' => $taskId,
            'run_id' => $body['run_id'] ?? null,
            'attempt_no' => $body['attempt_no'] ?? null,
            'task_revision' => $task['version'],
            'kind' => $artifact['kind'],
            'label' => trim($artifact['label']),
            'text' => $artifact['text'] ?? null,
            'link_ids' => $linkIds,
            'review_status' => 'reported',
            'reported_by' => $this->actorRef($actor),
            'reviewed_at' => null,
            'reviewed_by' => null,
            'review_reason' => null,
            'criterion_ids' => $criterionIds,
            'link_snapshot' => $linkSnapshot,
        ], 'evidence.reported');
        foreach ($criterionIds as $criterionId) {
            $index = $this->criterionIndex($task, $criterionId);
            if ('human_confirmed' !== $task['criteria'][$index]['state']) {
                $task['criteria'][$index]['state'] = 'reported';
            }
            $task['criteria'][$index]['evidence_ids'] = array_values(array_unique([...$task['criteria'][$index]['evidence_ids'], $evidence['id']]));
        }
        if ([] !== $criterionIds) {
            $task = $this->store->save('tasks', $task, 'task.evidence_reported');
            $evidence['task_revision'] = $task['version'];
            $evidence = $this->store->save('evidence', $evidence, 'evidence.revision_bound');
        }

        return $evidence;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function reviewEvidence(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $evidence = $this->store->find('evidence', $id);
        if (null === $evidence) {
            throw new Problem(404, 'resource_not_found', 'Nachweis wurde nicht gefunden.');
        }
        $actor->requireProject($evidence['project_id']);
        $task = $this->task($evidence['task_id'], $actor);
        if ('reported' !== $evidence['review_status']) {
            throw new Problem(409, 'evidence_already_reviewed', 'Der Nachweis wurde bereits bewertet.');
        }
        if ($evidence['task_revision'] !== $task['version'] || !$this->evidenceLinksCurrent($evidence)) {
            throw new Problem(409, 'evidence_stale', 'Der Nachweis bezieht sich nicht mehr auf die aktuelle Ticketrevision und Linkfassung.');
        }
        $evidence['review_status'] = $body['decision'];
        $evidence['reviewed_at'] = $this->store->now();
        $evidence['reviewed_by'] = $this->actorRef($actor);
        $evidence['review_reason'] = trim($body['reason']);
        $evidence = $this->store->save('evidence', $evidence, 'evidence.reviewed');
        if ('rejected' === $body['decision']) {
            $this->setCriterionEvidenceRejected($evidence);
        }

        return $evidence;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function attachEvidence(string $taskId, string $criterionId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $criterionIndex = $this->criterionIndex($task, $criterionId);
        foreach ($body['evidence_ids'] as $evidenceId) {
            $evidence = $this->store->find('evidence', $evidenceId);
            if (null === $evidence || $evidence['task_id'] !== $taskId || $evidence['project_id'] !== $task['project_id']) {
                throw new Problem(409, 'evidence_task_mismatch', 'Ein Nachweis gehört nicht zu diesem Ticket.');
            }
            if ($evidence['task_revision'] !== $task['version'] || !$this->evidenceLinksCurrent($evidence)) {
                throw new Problem(409, 'evidence_stale', 'Der Nachweis passt nicht zur aktuellen Ticketrevision.');
            }
        }
        $criterion = $task['criteria'][$criterionIndex];
        $criterion['evidence_ids'] = array_values(array_unique(array_merge($criterion['evidence_ids'], $body['evidence_ids'])));
        if ('human_confirmed' !== $criterion['state']) {
            $criterion['state'] = 'reported';
        }
        $criterion['reviewed_at'] = null;
        $criterion['reviewed_by'] = null;
        $criterion['review_reason'] = null;
        $task['criteria'][$criterionIndex] = $criterion;
        $task = $this->store->save('tasks', $task, 'task.evidence_attached');
        foreach ($body['evidence_ids'] as $evidenceId) {
            $evidence = $this->store->get('evidence', $evidenceId);
            $evidence['task_revision'] = $task['version'];
            $this->store->save('evidence', $evidence, 'evidence.revision_bound');
        }

        return $this->presentTask($task);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function reviewCriterion(string $taskId, string $criterionId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $task = $this->task($taskId, $actor);
        $index = $this->criterionIndex($task, $criterionId);
        foreach ($body['evidence_ids'] as $evidenceId) {
            $evidence = $this->store->find('evidence', $evidenceId);
            if (
                null === $evidence
                || $evidence['task_id'] !== $taskId
                || $evidence['project_id'] !== $task['project_id']
                || $evidence['task_revision'] !== $task['version']
                || 'rejected' === $evidence['review_status']
                || !$this->evidenceLinksCurrent($evidence)
            ) {
                throw new Problem(409, 'evidence_unavailable', 'Die Entscheidung referenziert einen fehlenden, abgelehnten oder veralteten Nachweis.');
            }
            if (!in_array($criterionId, $evidence['criterion_ids'], true) && !in_array($evidenceId, $task['criteria'][$index]['evidence_ids'], true)) {
                throw new Problem(409, 'evidence_criterion_mismatch', 'Der Nachweis wurde diesem Kriterium nicht zugeordnet.');
            }
        }
        if ('human_confirmed' === $body['decision'] && $task['criteria'][$index]['is_required'] && [] === $body['evidence_ids'] && [] === $task['criteria'][$index]['evidence_ids']) {
            throw new Problem(409, 'criterion_evidence_required', 'Ein erforderliches Kriterium kann ohne gemeldete Informationen nicht bestätigt werden.');
        }
        $task['criteria'][$index]['state'] = $body['decision'];
        $task['criteria'][$index]['evidence_ids'] = array_values(array_unique(array_merge($task['criteria'][$index]['evidence_ids'], $body['evidence_ids'])));
        $task['criteria'][$index]['reviewed_at'] = $this->store->now();
        $task['criteria'][$index]['reviewed_by'] = $this->actorRef($actor);
        $task['criteria'][$index]['review_reason'] = trim($body['reason']);
        $task = $this->store->save('tasks', $task, 'task.criterion_reviewed');
        foreach ($task['criteria'][$index]['evidence_ids'] as $evidenceId) {
            $evidence = $this->store->find('evidence', $evidenceId);
            if (null !== $evidence && $evidence['task_id'] === $taskId) {
                $evidence['task_revision'] = $task['version'];
                $this->store->save('evidence', $evidence, 'evidence.revision_bound');
            }
        }

        return $this->presentTask($task);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listHistory(array $p, Actor $actor): array
    {
        $projectId = isset($p['project_id']) ? (string) $p['project_id'] : null;
        if (null !== $projectId) {
            $actor->requireProject($projectId);
        }
        $revisions = $this->store->all('revisions', $projectId);
        if (isset($p['resource_type'])) {
            $revisions = array_values(array_filter($revisions, static fn (array $revision): bool => ($revision['resource']['resource_type'] ?? null) === $p['resource_type']));
        }
        if (isset($p['resource_id'])) {
            $revisions = array_values(array_filter($revisions, static fn (array $revision): bool => ($revision['resource']['id'] ?? null) === $p['resource_id']));
        }
        if (isset($p['action_id'])) {
            $revisions = array_values(array_filter($revisions, static fn (array $revision): bool => $revision['action_id'] === $p['action_id']));
        }
        $revisions = array_values(array_filter($revisions, static fn (array $revision): bool => null === $revision['project_id'] ? $actor->owner : $actor->canProject($revision['project_id'])
        ));
        usort($revisions, static fn (array $a, array $b): int => strcmp($b['recorded_at'], $a['recorded_at']));
        $revisions = array_map($this->presentRevision(...), $revisions);

        return $this->store->page($revisions, $p);
    }

    /** @return array<string, mixed> */
    private function getRevision(string $id, Actor $actor): array
    {
        $revision = $this->store->find('revisions', $id);
        if (null === $revision) {
            throw new Problem(404, 'resource_not_found', 'Revision wurde nicht gefunden.');
        }
        if (null === $revision['project_id'] && !$actor->owner) {
            throw new Problem(404, 'resource_not_found', 'Revision wurde nicht gefunden.');
        }
        if (null !== $revision['project_id']) {
            $actor->requireProject($revision['project_id']);
        }

        return $this->presentRevision($revision);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function restoreRevision(string $revisionId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $revision = $this->getRevision($revisionId, $actor);
        if (empty($revision['restorable']) || !isset($revision['_snapshot'])) {
            throw new Problem(409, 'revision_not_restorable', 'Diese Revision enthält keine wiederherstellbaren Fachfelder.');
        }
        $snapshot = $revision['_snapshot'];
        $type = $revision['resource']['resource_type'] ?? null;
        $resourceId = $revision['resource']['id'] ?? null;
        if (!is_string($resourceId) || !is_string($type)) {
            throw new Problem(409, 'revision_not_restorable', 'Die Zielressource der Revision ist unvollständig.');
        }
        if ('task' === $type) {
            $current = $this->task($resourceId, $actor);
            $restorableFields = ['title', 'description', 'task_type', 'priority', 'due_at', 'criteria', 'custom_fields', 'label_ids'];
            $before = $current;
            foreach ($restorableFields as $field) {
                if (array_key_exists($field, $snapshot)) {
                    $current[$field] = $snapshot[$field];
                }
            }
            $current['criteria'] = $this->normalizeRestoredCriteria($current['criteria']);
            $liveFields = $before['custom_fields'] ?? [];
            $current['custom_fields'] = CustomFieldHistory::publicFields($current['custom_fields'] ?? []) + array_diff_key($liveFields, CustomFieldHistory::publicFields($liveFields));
            $labels = $this->validateLabelIds($current['project_id'], $current['label_ids']);
            $current['label_ids'] = array_column($labels, 'id');
            $current['primary_topic_label_id'] = $this->firstKindLabel($current['project_id'], $current['label_ids'], 'topic');
            $current['workflow_label_id'] = $this->firstKindLabel($current['project_id'], $current['label_ids'], 'workflow');
            $this->assertBoardChangeAllowed($current, $before);
            $restored = $this->store->save('tasks', $current, 'task.history_restored');
            if ($restored['workflow_label_id'] !== $before['workflow_label_id']) {
                $this->freezeWorkflowRoute($restored, $restored['workflow_label_id'], 'current_unstarted');
            }
            $this->recordRestoreReason('task', $restored['id'], $restored['project_id'], (string) $body['reason']);

            return $this->store->accepted([
                'resource_type' => 'task',
                'id' => $restored['id'],
                'version' => $restored['version'],
            ]);
        }
        if ('project' === $type) {
            $current = $this->project($resourceId);
            foreach (['name', 'description', 'icon_key', 'color', 'completion_policy'] as $field) {
                if (array_key_exists($field, $snapshot)) {
                    $current[$field] = $snapshot[$field];
                }
            }
            $restored = $this->store->save('projects', $current, 'project.history_restored');
            $this->recordRestoreReason('project', $restored['id'], $restored['id'], (string) $body['reason']);

            return $this->store->accepted([
                'resource_type' => 'project',
                'id' => $restored['id'],
                'version' => $restored['version'],
            ]);
        }
        throw new Problem(409, 'revision_not_restorable', 'Diese Ressourcenart unterstützt keine fachliche Wiederherstellung.');
    }

    private function recordRestoreReason(string $resourceType, string $resourceId, string $projectId, string $reason): void
    {
        $revisions = array_reverse($this->store->all('revisions', $projectId));
        foreach ($revisions as $revision) {
            if (($revision['resource']['resource_type'] ?? null) !== $resourceType
                || ($revision['resource']['id'] ?? null) !== $resourceId
                || ($revision['action_id'] ?? null) !== $this->store->actionId()
            ) {
                continue;
            }
            $this->store->save('history_restore_notes', [
                'id' => $revision['id'],
                'project_id' => $projectId,
                'revision_id' => $revision['id'],
                'reason' => trim($reason),
            ], 'history.restore_reason_recorded');

            return;
        }
        throw new Problem(500, 'history_revision_missing', 'Die Wiederherstellungsrevision konnte nicht zugeordnet werden.');
    }

    /** @param array<string, mixed> $revision @return array<string, mixed> */
    private function presentRevision(array $revision): array
    {
        if ('task' === ($revision['resource']['resource_type'] ?? null)) {
            $revision['custom_field_values'] ??= CustomFieldHistory::snapshot($revision['_snapshot']['custom_fields'] ?? []);
        }
        $note = $this->store->find('history_restore_notes', $revision['id']);
        if (null !== $note) {
            $revision['reason'] = $note['reason'];
        }

        return $revision;
    }

    /** @param array<string, mixed> $task @return array<string, mixed> */
    private function presentTask(array $task): array
    {
        $task['allowed_actions'] = [];
        $task['latest_run'] = null;
        $task['custom_fields'] = (object) ($task['custom_fields'] ?? []);
        $ownerReasons = $this->openAttentionReasons($task['id'], $task['project_id'], 'owner');
        $task['human_attention'] = [
            'required' => [] !== $ownerReasons,
            'reasons' => array_values(array_unique(array_column($ownerReasons, 'code'))),
        ];
        $task['label_ids'] = $this->projectedTaskLabelIds($task);
        if (($task['latest_run_id'] ?? null) !== null) {
            $run = $this->store->find('runs', $task['latest_run_id']);
            if (null !== $run) {
                $profileId = $run['snapshot']['agent_profile_id'] ?? $task['agent_profile_id'] ?? null;
                $profile = is_string($profileId) ? $this->store->find('agent_profiles', $profileId) : null;
                $task['latest_run'] = [
                    'id' => $run['id'],
                    'project_id' => $run['project_id'],
                    'task_id' => $run['task_id'],
                    'task_key' => $task['key'],
                    'title' => (string) ($run['snapshot']['title'] ?? $task['title']),
                    'agent_profile_name' => (string) ($profile['name'] ?? $task['requested_role'] ?? 'Agent'),
                    'stage' => (string) ($run['stage'] ?? 'task'),
                    'state' => $run['state'],
                    'last_observed_at' => $run['last_observed_at'] ?? null,
                ];
            }
        }
        $task['link_collection_ids'] = array_values(array_filter(
            $task['link_collection_ids'] ?? [],
            fn (string $collectionId): bool => null !== $this->store->find('link_collections', $collectionId),
        ));

        return $task;
    }

    /** @param array<string, mixed> $board @return array<string, mixed> */
    private function presentBoard(array $board): array
    {
        $board['allowed_actions'] = [];

        return $board;
    }

    /** @param array<string, mixed> $status @return array<string, mixed> */
    private function presentStatus(array $status): array
    {
        return [
            'id' => $status['id'],
            'name' => $status['name'],
            'category' => $status['category'],
            'color' => $status['color'],
            'position' => $status['position'],
            'is_default' => $status['is_default'],
        ];
    }

    /** @param array<string, mixed> $task @param array<string, mixed>|null $before */
    private function assertBoardChangeAllowed(array $task, ?array $before): void
    {
        $this->wipPolicy->assertTaskChangeAllowed(
            $this->store->all('boards', $task['project_id']),
            array_map($this->withProjectedTaskLabels(...), $this->store->all('tasks', $task['project_id'])),
            null === $before ? null : $this->withProjectedTaskLabels($before),
            $this->withProjectedTaskLabels($task),
        );
    }

    /** @param array<string, mixed> $board */
    private function assertBoardConfigurationWithinLimits(array $board): void
    {
        if ($board['archived']) {
            return;
        }
        $tasks = array_map($this->withProjectedTaskLabels(...), $this->store->all('tasks', $board['project_id']));
        $this->wipPolicy->assertConfigurationAllowed($board, $tasks);
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $filter */
    private function matchesBoardFilter(array $task, array $filter): bool
    {
        return $this->wipPolicy->matchesFilter($this->withProjectedTaskLabels($task), $filter);
    }

    /** @param array<string, mixed> $board @param array<string, mixed> $column */
    private function sortBoardTasks(array &$tasks, array $board, array $column): void
    {
        $sort = $board['config']['sort'] ?? 'manual';
        if ('manual' === $sort) {
            $positions = [];
            foreach ($this->store->all('board_positions', $board['project_id']) as $position) {
                if ($position['board_id'] === $board['id'] && $position['column_id'] === $column['id']) {
                    $positions[$position['task_id']] = $position['rank'];
                }
            }
            usort($tasks, static fn (array $a, array $b): int => ($positions[$a['id']] ?? PHP_FLOAT_MAX) <=> ($positions[$b['id']] ?? PHP_FLOAT_MAX) ?: strcmp($a['created_at'], $b['created_at']));

            return;
        }
        if ('priority' === $sort) {
            $order = ['urgent' => 0, 'high' => 1, 'normal' => 2, 'low' => 3];
            usort($tasks, static fn (array $a, array $b): int => ($order[$a['priority']] ?? 4) <=> ($order[$b['priority']] ?? 4));

            return;
        }
        $field = $sort;
        usort($tasks, static fn (array $a, array $b): int => ($a[$field] ?? '') <=> ($b[$field] ?? ''));
    }

    /** @param array<string, mixed> $board @param array<string, mixed> $task @param array<string, mixed> $status */
    private function setBoardPosition(array $board, array $task, array $status, ?string $beforeId, ?string $afterId): void
    {
        $column = null;
        foreach ($board['columns'] as $candidate) {
            if (in_array($status['id'], $candidate['status_ids'], true)) {
                $column = $candidate;
                break;
            }
        }
        if (null === $column) {
            throw new Problem(409, 'board_column_mismatch', 'Der Status gehört zu keiner Boardspalte.');
        }
        $positions = $this->store->all('board_positions', $board['project_id']);
        $rankByTask = [];
        foreach ($positions as $position) {
            if ($position['board_id'] === $board['id'] && $position['column_id'] === $column['id']) {
                $rankByTask[$position['task_id']] = (float) $position['rank'];
            }
        }
        $this->assertPositionNeighbor($beforeId, $task, $column, $board);
        $this->assertPositionNeighbor($afterId, $task, $column, $board);
        $beforeRank = null === $beforeId ? null : ($rankByTask[$beforeId] ?? null);
        $afterRank = null === $afterId ? null : ($rankByTask[$afterId] ?? null);
        if (null !== $beforeRank && null !== $afterRank && $beforeRank >= $afterRank) {
            throw new Problem(409, 'invalid_position', 'Die Reihenfolge der Nachbartickets ist ungültig.');
        }
        if (null !== $beforeRank && null !== $afterRank) {
            $rank = ($beforeRank + $afterRank) / 2;
        } elseif (null !== $beforeRank) {
            $rank = $beforeRank + 1.0;
        } elseif (null !== $afterRank) {
            $rank = $afterRank - 1.0;
        } else {
            $rank = max(array_values($rankByTask) ?: [0.0]) + 1.0;
        }
        $record = null;
        foreach ($positions as $position) {
            if ($position['board_id'] === $board['id'] && $position['task_id'] === $task['id']) {
                $record = $position;
                break;
            }
        }
        $this->store->save('board_positions', [
            ...($record ?? []),
            'project_id' => $board['project_id'], 'board_id' => $board['id'], 'task_id' => $task['id'],
            'column_id' => $column['id'], 'rank' => $rank,
        ], 'board.task_positioned');
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $column @param array<string, mixed> $board */
    private function assertPositionNeighbor(?string $neighborId, array $task, array $column, array $board): void
    {
        if (null === $neighborId) {
            return;
        }
        if ($neighborId === $task['id']) {
            throw new Problem(409, 'invalid_position', 'Ein Ticket kann nicht sein eigener Nachbar sein.');
        }
        $neighbor = $this->store->find('tasks', $neighborId);
        if (
            null === $neighbor
            || $neighbor['project_id'] !== $task['project_id']
            || !in_array($neighbor['status_id'], $column['status_ids'], true)
            || !$this->matchesBoardFilter($neighbor, $board['config']['filter'])
        ) {
            throw new Problem(409, 'invalid_position', 'Nachbartickets müssen zur Zielspalte und zum Zielboard gehören.');
        }
    }

    /** @param list<array<string, mixed>> $columns @return list<array<string, mixed>> */
    private function normalizeColumns(string $projectId, array $columns): array
    {
        $result = [];
        $seenStatusIds = [];
        foreach ($columns as $position => $column) {
            $statusIds = array_values(array_unique($column['status_ids']));
            foreach ($statusIds as $statusId) {
                $status = $this->status((string) $statusId, $projectId);
                if (isset($seenStatusIds[$status['id']])) {
                    throw new Problem(409, 'duplicate_column_status', 'Ein Status kann nur einer Boardspalte zugeordnet sein.');
                }
                $seenStatusIds[$status['id']] = true;
            }
            $defaultDrop = $column['default_drop_status_id'] ?? null;
            if (null !== $defaultDrop && !in_array($defaultDrop, $statusIds, true)) {
                throw new Problem(422, 'validation_failed', 'Der Dropstatus muss zu den Status der Spalte gehören.');
            }
            $result[] = [
                'id' => $column['id'] ?? $this->store->id(), 'name' => trim($column['name']),
                'status_ids' => $statusIds, 'default_drop_status_id' => $defaultDrop,
                'wip_limit' => $column['wip_limit'] ?? null, 'wip_policy' => $column['wip_policy'], 'position' => $position,
            ];
        }

        return $result;
    }

    /** @param array<string, mixed> $task */
    private function assertTaskCompletionPolicy(array $task): void
    {
        $project = $this->project($task['project_id']);
        $evidence = $this->store->all('evidence', $task['project_id']);
        $currentEvidenceIds = [];
        foreach ($evidence as $item) {
            if ($item['task_id'] === $task['id'] && $item['task_revision'] === $task['version'] && $this->evidenceLinksCurrent($item)) {
                $currentEvidenceIds[] = $item['id'];
            }
        }
        $runs = $this->store->all('runs', $task['project_id']);
        $approvals = $this->currentCompletionApprovals($task, $runs, $this->store->all('approvals', $task['project_id']));
        $this->completionPolicy->assertSatisfied(
            $project['completion_policy'],
            $task,
            $evidence,
            $approvals,
            $runs,
            $currentEvidenceIds,
        );
    }

    /** @param list<array<string, mixed>> $runs @param list<array<string, mixed>> $approvals @return list<array<string, mixed>> */
    private function currentCompletionApprovals(array $task, array $runs, array $approvals): array
    {
        $runsById = [];
        foreach ($runs as $run) {
            $runsById[$run['id']] = $run;
        }

        $valid = [];
        foreach ($approvals as $approval) {
            if ('approved' !== $approval['status'] || 'completion' !== $approval['kind']) {
                continue;
            }
            $run = $runsById[$approval['run_id']] ?? null;
            if (null === $run || $run['task_id'] !== $task['id'] || $run['id'] !== ($task['latest_run_id'] ?? null)
                || (int) $run['attempt_no'] !== (int) $approval['attempt_no']
                || (int) $approval['task_revision'] !== (int) $task['version']
                || (int) ($run['snapshot']['task_revision'] ?? 0) !== (int) $task['version']
                || !is_string($run['result_digest'] ?? null)
                || !hash_equals((string) $run['result_digest'], (string) $approval['result_digest'])) {
                continue;
            }

            $reportIsCurrent = false;
            foreach (array_reverse($run['report_ids'] ?? []) as $reportId) {
                $report = $this->store->find('run_reports', (string) $reportId);
                if (null !== $report && (int) $report['attempt_no'] === (int) $run['attempt_no']
                    && (int) $report['task_revision'] === (int) $task['version']
                    && !empty($report['accepted_for_reconciliation'])) {
                    $reportIsCurrent = true;
                    break;
                }
            }
            if (!$reportIsCurrent) {
                continue;
            }

            $approval['task_id'] = $task['id'];
            $valid[] = $approval;
        }

        return $valid;
    }

    private function freezeWorkflowRoute(array $task, ?string $workflowLabelId, string $application): void
    {
        $current = $this->store->find('task_routing_snapshots', $task['id']);
        if (null === $workflowLabelId) {
            if (null !== $current) {
                $this->store->remove('task_routing_snapshots', $task['id'], 'task.workflow_route_cleared');
            }

            return;
        }

        if ('current_unstarted' === $application) {
            foreach ($this->store->all('workflow_instances', $task['project_id']) as $instance) {
                if ($instance['task_id'] === $task['id'] && in_array($instance['state'], ['queued', 'running', 'paused'], true)) {
                    throw new Problem(409, 'workflow_already_started', 'Eine laufende Workflowinstanz kann nicht durch eine neue Labelroute ersetzt werden.');
                }
            }
        }

        $routing = $this->store->find('routing_rules', $task['project_id']);
        $matches = array_values(array_filter($routing['rules'] ?? [], static fn (array $rule): bool => $rule['workflow_label_id'] === $workflowLabelId));
        if (1 !== count($matches)) {
            throw new Problem(409, 'workflow_route_conflict', 'Das Workflowlabel benötigt genau eine aktive, versionierte Route.');
        }
        $route = $matches[0];
        $workflow = $this->store->find('workflows', $route['workflow_id']);
        if (null === $workflow || $workflow['project_id'] !== $task['project_id'] || ($workflow['definition_version'] ?? $workflow['version']) !== $route['workflow_definition_version']) {
            throw new Problem(409, 'workflow_route_conflict', 'Die gewählte Workflowversion ist nicht mehr verfügbar.');
        }
        $this->store->save('task_routing_snapshots', [
            'id' => $task['id'],
            'project_id' => $task['project_id'],
            'task_id' => $task['id'],
            'workflow_label_id' => $workflowLabelId,
            'workflow_id' => $route['workflow_id'],
            'workflow_definition_version' => $route['workflow_definition_version'],
            'routing_rules_version' => $routing['version'] ?? 1,
            'application' => $application,
        ], 'task.workflow_route_snapshotted');
    }

    /** @param array<string, mixed> $config */
    private function validateBoardConfig(string $projectId, array $config): void
    {
        $filter = $config['filter'];
        foreach ($filter['status_ids'] ?? [] as $statusId) {
            $this->status((string) $statusId, $projectId);
        }
        foreach ($filter['label_ids'] ?? [] as $labelId) {
            $this->label((string) $labelId, $projectId);
        }
        foreach ($filter['agent_profile_ids'] ?? [] as $profileId) {
            $profile = $this->store->find('agent_profiles', (string) $profileId);
            if (null === $profile || !$this->agentCatalog->profileAllowsProject($profile, $projectId)) {
                throw new Problem(422, 'validation_failed', 'Ein Rollenfilter verweist nicht auf ein für dieses Projekt zugelassenes Profil.');
            }
        }
    }

    /** @param array<string, mixed> $values @return array<string, mixed> */
    private function validateCustomFields(string $projectId, array $values, array $existing = []): array
    {
        $definitions = $this->store->all('custom_fields', $projectId);
        $byKey = [];
        foreach ($definitions as $definition) {
            if (!empty($definition['active']) && (!isset($definition['plugin_id']) || $this->plugins->enabled($definition['plugin_id']))) {
                $byKey[$definition['key']] = $definition;
            }
        }
        $archived = array_diff_key($existing, $byKey);
        foreach ($archived as $key => $value) {
            if (array_key_exists($key, $values) && $values[$key] != $value) {
                throw new Problem(409, 'custom_field_inactive', 'Ein archiviertes Zusatzfeld bleibt schreibgeschützt.');
            }
            unset($values[$key]);
        }
        foreach ($values as $key => $typedValue) {
            $definition = $byKey[$key] ?? null;
            if (null === $definition || !is_array($typedValue) || ($typedValue['type'] ?? null) !== $definition['value_type'] || !array_key_exists('value', $typedValue)) {
                throw new Problem(422, 'validation_failed', 'Ein Zusatzfeld ist unbekannt oder hat einen unpassenden Werttyp.');
            }
            $value = $typedValue['value'];
            $valid = match ($definition['value_type']) {
                'text' => is_string($value),
                'number' => is_int($value) || is_float($value),
                'boolean' => is_bool($value),
                'date' => is_string($value) && false !== \DateTimeImmutable::createFromFormat('!Y-m-d', $value),
                'choice' => is_string($value) && in_array($value, $definition['choices'], true),
                'multi_choice' => is_array($value) && array_is_list($value) && [] === array_diff($value, $definition['choices']),
                default => false,
            };
            if (!$valid) {
                throw new Problem(422, 'validation_failed', 'Der Wert passt nicht zum definierten Zusatzfeld.');
            }
        }
        foreach ($byKey as $key => $definition) {
            if (!empty($definition['required']) && !array_key_exists($key, $values)) {
                throw new Problem(422, 'validation_failed', 'Das erforderliche Zusatzfeld '.$definition['label'].' fehlt.');
            }
        }

        return $values + $archived;
    }

    /** @param array<string, mixed> $project */
    private function nextTaskKey(array $project): string
    {
        $tasks = $this->store->all('tasks', $project['id']);
        $sequence = count($tasks) + 1;
        $prefix = strtoupper(preg_replace('/[^a-z0-9]+/i', '-', $project['slug']) ?? 'TASK');
        $key = $prefix.'-'.str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
        $existing = array_column($tasks, 'key');
        while (in_array($key, $existing, true)) {
            ++$sequence;
            $key = $prefix.'-'.str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
        }

        return $key;
    }

    /** @param list<array<string, mixed>> $inputs @param array<string, array<string, mixed>> $oldById @return list<array<string, mixed>> */
    private function normalizeCriteria(array $inputs, array $oldById = []): array
    {
        $criteria = [];
        $seen = [];
        foreach ($inputs as $input) {
            $criterionId = isset($input['id']) ? (string) $input['id'] : $this->store->id();
            if (isset($seen[$criterionId])) {
                throw new Problem(422, 'validation_failed', 'Kriterien-IDs müssen eindeutig sein.');
            }
            $seen[$criterionId] = true;
            $old = $oldById[$criterionId] ?? null;
            $sameDefinition = null !== $old && $old['text'] === trim($input['text']) && $old['is_required'] === (bool) $input['is_required'];
            $criteria[] = [
                'id' => $criterionId,
                'text' => trim($input['text']),
                'is_required' => (bool) $input['is_required'],
                'state' => $sameDefinition ? $old['state'] : 'pending',
                'evidence_ids' => $sameDefinition ? $old['evidence_ids'] : [],
                'reviewed_at' => $sameDefinition ? $old['reviewed_at'] : null,
                'reviewed_by' => $sameDefinition ? $old['reviewed_by'] : null,
                'review_reason' => $sameDefinition ? $old['review_reason'] : null,
            ];
        }

        return $criteria;
    }

    /** @param list<array<string, mixed>> $criteria @return list<array<string, mixed>> */
    private function normalizeRestoredCriteria(array $criteria): array
    {
        foreach ($criteria as &$criterion) {
            $criterion['evidence_ids'] = $criterion['evidence_ids'] ?? [];
            if (($criterion['state'] ?? null) === 'human_confirmed') {
                $criterion['state'] = 'reported';
                $criterion['reviewed_at'] = null;
                $criterion['reviewed_by'] = null;
                $criterion['review_reason'] = null;
            }
        }

        return $criteria;
    }

    /** @param array<string, mixed> $task @param list<string> $ids */
    private function assertCriteriaExist(array $task, array $ids): void
    {
        $available = array_column($task['criteria'], 'id');
        foreach ($ids as $id) {
            if (!in_array($id, $available, true)) {
                throw new Problem(409, 'criterion_not_found', 'Ein Nachweis verweist auf ein unbekanntes Kriterium.');
            }
        }
    }

    /** @param array<string, mixed> $task */
    private function criterionIndex(array $task, string $criterionId): int
    {
        foreach ($task['criteria'] as $index => $criterion) {
            if ($criterion['id'] === $criterionId) {
                return $index;
            }
        }
        throw new Problem(404, 'resource_not_found', 'Kriterium wurde nicht gefunden.');
    }

    /** @param array<string, mixed> $evidence */
    private function setCriterionEvidenceRejected(array $evidence): void
    {
        $task = $this->store->find('tasks', $evidence['task_id']);
        foreach ($task['criteria'] as &$criterion) {
            if (in_array($evidence['id'], $criterion['evidence_ids'], true) && 'human_confirmed' !== $criterion['state']) {
                $criterion['state'] = 'rejected';
            }
        }
        $this->store->save('tasks', $task, 'task.evidence_rejected');
    }

    /** @param array<string, mixed> $evidence */
    private function evidenceLinksCurrent(array $evidence): bool
    {
        $current = [];
        foreach ($evidence['link_ids'] as $linkId) {
            $link = $this->findLink($evidence['task_id'], $linkId);
            if (null === $link) {
                return false;
            }
            $current[] = $link;
        }

        return $current === $evidence['link_snapshot'];
    }

    /** @param list<string> $linkIds */
    private function invalidateEvidenceForLinks(array $linkIds): void
    {
        foreach ($this->store->all('evidence') as $evidence) {
            if ([] === array_intersect($linkIds, $evidence['link_ids']) || 'reported' === $evidence['review_status']) {
                continue;
            }
            $evidence['review_status'] = 'reported';
            $evidence['reviewed_at'] = null;
            $evidence['reviewed_by'] = null;
            $evidence['review_reason'] = null;
            $this->store->save('evidence', $evidence, 'evidence.review_invalidated');
        }
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $initial @return array<string, mixed> */
    private function createInitialCollection(array $task, array $initial, Actor $actor): array
    {
        $links = [];
        foreach ($initial['links'] as $linkData) {
            $links[] = $this->newLink($linkData, $actor);
        }
        $collection = $this->store->save('link_collections', [
            'project_id' => $task['project_id'], 'task_id' => $task['id'],
            'name' => trim($initial['name']), 'kind' => $initial['kind'], 'links' => $links,
        ], 'task.link_collection_created');
        $task['link_collection_ids'][] = $collection['id'];
        $task = $this->store->save('tasks', $task, 'task.link_collection_added');
        $collection['task_version'] = $task['version'];

        return $this->store->save('link_collections', $collection, [] === $links ? 'task.link_collection_versioned' : 'work.link_registered');
    }

    /** @param array<string, mixed> $input @param array<string, mixed>|null $existing @return array<string, mixed> */
    private function newLink(array $input, Actor $actor, ?array $existing = null): array
    {
        $url = $this->linkPolicy->validateUrl((string) $input['url']);

        return [
            'id' => $existing['id'] ?? $this->store->id(),
            'title' => trim((string) $input['title']),
            'url' => $url,
            'kind' => $input['kind'],
            'relation' => $input['relation'],
            'registered_by' => $existing['registered_by'] ?? $this->actorRef($actor),
            'registered_at' => $existing['registered_at'] ?? $this->store->now(),
            'updated_at' => $this->store->now(),
            'provenance' => 'registered_reference',
        ];
    }

    /** @return list<array<string, mixed>> */
    private function collectionsForTask(string $taskId): array
    {
        $items = $this->store->all('link_collections');
        $items = array_values(array_filter($items, static fn (array $collection): bool => $collection['task_id'] === $taskId));
        usort($items, static fn (array $a, array $b): int => strcmp($a['created_at'], $b['created_at']));

        return $items;
    }

    /** @param array<string, mixed> $collection @return array<string, mixed> */
    private function presentCollection(array $collection, int $taskVersion): array
    {
        return [
            'id' => $collection['id'],
            'task_id' => $collection['task_id'],
            'task_version' => $taskVersion,
            'name' => $collection['name'],
            'kind' => $collection['kind'],
            'links' => $collection['links'],
        ];
    }

    /** @return array<string, mixed> */
    private function collection(string $taskId, string $collectionId): array
    {
        $collection = $this->store->find('link_collections', $collectionId);
        if (null === $collection || $collection['task_id'] !== $taskId) {
            throw new Problem(404, 'resource_not_found', 'Link-Collection wurde nicht gefunden.');
        }

        return $collection;
    }

    /** @return array<string, mixed>|null */
    private function findLink(string $taskId, string $linkId): ?array
    {
        foreach ($this->collectionsForTask($taskId) as $collection) {
            foreach ($collection['links'] as $link) {
                if ($link['id'] === $linkId) {
                    return $link;
                }
            }
        }

        return null;
    }

    /** @param list<array<string, mixed>> $labels */
    private function workflowLabelId(array $labels): ?string
    {
        foreach ($labels as $label) {
            if ('workflow' === $label['kind']) {
                return $label['id'];
            }
        }

        return null;
    }

    /** @param list<string> $visited */
    private function dependencyReachable(string $startId, string $targetId, array $visited): bool
    {
        if ($startId === $targetId) {
            return true;
        }
        if (in_array($startId, $visited, true)) {
            return false;
        }
        $visited[] = $startId;
        $task = $this->store->find('tasks', $startId);
        if (null === $task) {
            return false;
        }
        foreach ($task['depends_on_task_ids'] as $dependencyId) {
            if ($this->dependencyReachable((string) $dependencyId, $targetId, $visited)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<array<string, mixed>> */
    private function validateLabelIds(string $projectId, array $ids): array
    {
        if (count($ids) !== count(array_unique($ids))) {
            throw new Problem(422, 'validation_failed', 'Labels dürfen nicht doppelt zugeordnet werden.');
        }
        $labels = [];
        foreach ($ids as $id) {
            $label = $this->label((string) $id, $projectId);
            if (!$label['active']) {
                throw new Problem(409, 'label_inactive', 'Inaktive Labels können nicht neu zugeordnet werden.');
            }
            if ('attention' === $label['kind']) {
                // The public Task representation includes derived attention labels. Echoing their IDs is safe;
                // they are omitted from the persisted owner-controlled label assignment below.
                continue;
            }
            $labels[] = $label;
        }
        if (count($labels) > 80) {
            throw new Problem(422, 'validation_failed', 'Pro Ticket können höchstens 80 bearbeitbare Labels zugeordnet werden.');
        }
        if (count(array_filter($labels, static fn (array $label): bool => 'workflow' === $label['kind'])) > 1) {
            throw new Problem(409, 'workflow_route_conflict', 'Eine Aufgabe kann höchstens ein Workflowlabel erhalten.');
        }

        return $labels;
    }

    private function firstKindLabel(string $projectId, array $ids, string $kind): ?string
    {
        foreach ($ids as $id) {
            $label = $this->label($id, $projectId);
            if ($label['kind'] === $kind) {
                return $id;
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    private function label(string $id, string $projectId): array
    {
        $label = $this->store->find('labels', $id);
        if (null === $label) {
            foreach (array_keys(AttentionLabelCatalog::definitions()) as $code) {
                if ($this->attentionLabelId($projectId, $code) === $id) {
                    return $this->attentionLabelDefinition($projectId, $code);
                }
            }
        }
        if (null === $label || $label['project_id'] !== $projectId) {
            throw new Problem(404, 'resource_not_found', 'Label gehört nicht zu diesem Projekt.');
        }
        if (($label['kind'] ?? null) === 'attention') {
            ++$label['version'];
        }

        return $label;
    }

    /** @return array<string, mixed> */
    private function taxonomy(string $projectId): array
    {
        return $this->store->find('label_taxonomies', $projectId) ?? $this->store->save('label_taxonomies', [
            'id' => $projectId, 'project_id' => $projectId, 'taxonomy_version' => 1,
        ], 'taxonomy.initialized');
    }

    private function incrementTaxonomy(string $projectId): void
    {
        $taxonomy = $this->taxonomy($projectId);
        ++$taxonomy['taxonomy_version'];
        $this->store->save('label_taxonomies', $taxonomy, 'taxonomy.updated');
    }

    /** @return list<array<string, mixed>> */
    private function labelsForProject(string $projectId): array
    {
        $labels = [];
        foreach ($this->store->all('labels', $projectId) as $label) {
            $labels[$label['id']] = $label;
        }
        foreach (array_keys(AttentionLabelCatalog::definitions()) as $code) {
            $label = $this->attentionLabelDefinition($projectId, $code);
            $labels[$label['id']] = $label;
        }
        $labels = array_values($labels);
        usort($labels, static fn (array $a, array $b): int => [$a['kind'], $a['name']] <=> [$b['kind'], $b['name']]);

        return $labels;
    }

    public function labelForReason(string $projectId, string $code): ?array
    {
        if (!isset(AttentionLabelCatalog::definitions()[$code])) {
            return null;
        }
        $label = $this->attentionLabelDefinition($projectId, $code);

        return ['name' => $label['name'], 'description' => $label['description']];
    }

    /** @return array<string, mixed> */
    private function attentionLabelDefinition(string $projectId, string $code): array
    {
        $id = $this->attentionLabelId($projectId, $code);
        $stored = $this->store->find('labels', $id);
        if (null !== $stored) {
            // The first persisted version materializes the synthetic version-1 definition.
            ++$stored['version'];

            return $stored;
        }

        $definition = AttentionLabelCatalog::definitions()[$code];
        $project = $this->project($projectId);
        $createdAt = $project['created_at'];

        return [
            'id' => $id,
            'version' => 1,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
            'allowed_actions' => [],
            'project_id' => $projectId,
            'key' => 'attention:'.$code,
            'name' => $definition['name'],
            'color' => $definition['color'],
            'description' => $definition['description'],
            'kind' => 'attention',
            'system_managed' => true,
            'active' => true,
        ];
    }

    private function attentionLabelId(string $projectId, string $code): string
    {
        return Uuid::v5(Uuid::fromString(Uuid::NAMESPACE_URL), 'https://falkenwarte.invalid/projects/'.$projectId.'/attention/'.$code)->toRfc4122();
    }

    /** @return list<array<string, mixed>> */
    private function openAttentionReasons(string $taskId, string $projectId, ?string $addressedTo = null): array
    {
        return array_values(array_filter(
            $this->store->all('attention_reasons', $projectId),
            static fn (array $reason): bool => ($reason['task_id'] ?? null) === $taskId
                && ($reason['open'] ?? false) === true
                && (null === $addressedTo || ($reason['addressed_to'] ?? null) === $addressedTo),
        ));
    }

    /** @param array<string, mixed> $task @return list<string> */
    private function projectedTaskLabelIds(array $task): array
    {
        $taskId = $task['id'] ?? null;
        if (!is_string($taskId)) {
            return array_values(array_unique($task['label_ids'] ?? []));
        }
        $attentionIds = [];
        foreach ($this->openAttentionReasons($taskId, $task['project_id']) as $reason) {
            $code = $reason['code'] ?? null;
            if (is_string($code) && isset(AttentionLabelCatalog::definitions()[$code])) {
                $attentionIds[] = $this->attentionLabelId($task['project_id'], $code);
            }
        }

        return array_values(array_unique(array_merge($task['label_ids'] ?? [], $attentionIds)));
    }

    /** @param array<string, mixed> $task @return array<string, mixed> */
    private function withProjectedTaskLabels(array $task): array
    {
        $task['label_ids'] = $this->projectedTaskLabelIds($task);
        $taskId = $task['id'] ?? null;
        $ownerReasons = is_string($taskId) ? $this->openAttentionReasons($taskId, $task['project_id'], 'owner') : [];
        $task['human_attention'] = [
            'required' => [] !== $ownerReasons,
            'reasons' => array_values(array_unique(array_column($ownerReasons, 'code'))),
        ];

        return $task;
    }

    /** @param list<array<string, mixed>> $records */
    private function findRecord(array $records, string $id): ?array
    {
        foreach ($records as $record) {
            if ($record['id'] === $id) {
                return $record;
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    private function task(string $id, Actor $actor): array
    {
        $task = $this->store->find('tasks', $id);
        if (null === $task) {
            throw new Problem(404, 'resource_not_found', 'Ticket wurde nicht gefunden.');
        }
        $actor->requireProject($task['project_id']);

        return $task;
    }

    /** @return array<string, mixed> */
    private function project(string $id): array
    {
        $project = $this->store->find('projects', $id);
        if (null === $project) {
            throw new Problem(404, 'resource_not_found', 'Projekt wurde nicht gefunden.');
        }

        return $project;
    }

    /** @return array<string, mixed> */
    private function status(string $id, string $projectId): array
    {
        $status = $this->store->find('statuses', $id);
        if (null === $status || $status['project_id'] !== $projectId) {
            throw new Problem(409, 'project_mismatch', 'Der Ticketstatus gehört nicht zu diesem Projekt.');
        }

        return $status;
    }

    /** @return array<string, mixed> */
    private function board(string $id, Actor $actor): array
    {
        $board = $this->store->find('boards', $id);
        if (null === $board) {
            throw new Problem(404, 'resource_not_found', 'Board wurde nicht gefunden.');
        }
        $actor->requireProject($board['project_id']);

        return $board;
    }

    /** @return array<string, mixed> */
    private function actorRef(Actor $actor): array
    {
        return $actor->ref();
    }

    /** @param array<string, mixed> $p */
    private function pathId(array $p, string $key): string
    {
        $value = $p[$key] ?? null;
        if (!is_string($value) || '' === $value) {
            throw new Problem(400, 'validation_failed', 'Pfad-ID fehlt.');
        }

        return $value;
    }
}
