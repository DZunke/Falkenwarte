<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

use App\Shared\Application\Actor;
use App\Shared\Application\OperationHandler;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use App\WorkManagement\Application\BoardWorkflowPolicyReader;

final readonly class TaskFlowHandler implements OperationHandler
{
    public function __construct(
        private Store $store,
        private TaskFlowReader $taskFlowReader,
        private BoardWorkflowPolicyReader $boardWorkflowPolicy,
    ) {
    }

    public function handles(string $operation): bool
    {
        return 'task_flow_get' === $operation;
    }

    /** @param array<string, mixed> $parameters @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $operation, array $parameters, array $body, Actor $actor): array
    {
        $taskId = $parameters['task_id'] ?? null;
        if (!is_string($taskId) || '' === $taskId) {
            throw new Problem(422, 'validation_failed', 'Der Ressourcenbezeichner fehlt.');
        }

        return $this->getTaskFlow($taskId, $parameters, $actor);
    }

    /** @param array<string, mixed> $parameters @return array<string, mixed> */
    private function getTaskFlow(string $taskId, array $parameters, Actor $actor): array
    {
        $actor->requireOwner();
        $task = $this->store->find('tasks', $taskId);
        if (null === $task) {
            throw new Problem(404, 'resource_not_found', 'Die Aufgabe wurde nicht gefunden.');
        }
        $projectId = (string) $task['project_id'];
        $actor->requireProject($projectId);
        $boardId = $parameters['board_id'] ?? null;
        if (null !== $boardId && (!is_string($boardId) || '' === $boardId)) {
            throw new Problem(422, 'validation_failed', 'Die Boardauswahl ist ungültig.');
        }

        $taskRuns = array_values(array_filter(
            $this->taskFlowReader->runs($taskId, $projectId),
            static fn (array $run): bool => ($run['task_id'] ?? null) === $taskId && ($run['project_id'] ?? null) === $projectId,
        ));
        $runsById = [];
        foreach ($taskRuns as $run) {
            if (is_string($run['id'] ?? null)) {
                $runsById[$run['id']] = $run;
            }
        }

        $instancesById = [];
        $referencedRunIds = [];
        $references = [];
        foreach ($this->taskFlowReader->instances($taskId, $projectId) as $instance) {
            if (($instance['task_id'] ?? null) !== $taskId || ($instance['project_id'] ?? null) !== $projectId || !is_string($instance['id'] ?? null)) {
                continue;
            }
            $instancesById[$instance['id']] = $instance;
            foreach ($instance['run_ids'] ?? [] as $runId) {
                if (is_string($runId)) {
                    $referencedRunIds[$runId] = true;
                }
            }
            $references[] = [
                'kind' => 'workflow_instance',
                'id' => $instance['id'],
                'created_at' => (string) ($instance['created_at'] ?? ''),
            ];
        }

        foreach ($taskRuns as $run) {
            if (null !== ($run['workflow_instance_id'] ?? null) || isset($referencedRunIds[$run['id'] ?? ''])) {
                continue;
            }
            $references[] = [
                'kind' => 'run',
                'id' => (string) $run['id'],
                'created_at' => (string) ($run['created_at'] ?? ''),
            ];
        }

        usort($references, static fn (array $left, array $right): int => strcmp($right['created_at'], $left['created_at']) ?: strcmp($left['kind'], $right['kind']) ?: strcmp($left['id'], $right['id']));
        $page = $this->store->page($references, $parameters);

        $selectedItems = [];
        $selectedRunIds = [];
        $selectedRunsById = [];
        foreach ($page['items'] as $reference) {
            if ('workflow_instance' === $reference['kind']) {
                $instance = $instancesById[$reference['id']] ?? null;
                if (null === $instance) {
                    continue;
                }
                $runs = $this->taskFlowInstanceRuns($instance, $taskRuns);
                foreach ($runs as $run) {
                    $selectedRunIds[$run['id']] = true;
                    $selectedRunsById[$run['id']] = $run;
                }
                $selectedItems[] = ['kind' => 'workflow_instance', 'instance' => $instance, 'runs' => $runs];
                continue;
            }

            $run = $runsById[$reference['id']] ?? null;
            if (null === $run || null !== ($run['workflow_instance_id'] ?? null) || isset($referencedRunIds[$reference['id']])) {
                continue;
            }
            $selectedRunIds[$run['id']] = true;
            $selectedRunsById[$run['id']] = $run;
            $selectedItems[] = ['kind' => 'run', 'run' => $run];
        }

        $approvalsByRun = $this->taskFlowApprovals($projectId, array_keys($selectedRunIds));
        $reportsByRun = $this->taskFlowReports($projectId, array_keys($selectedRunIds), $selectedRunsById);
        $items = [];
        foreach ($selectedItems as $selected) {
            if ('workflow_instance' === $selected['kind']) {
                $items[] = $this->taskFlowWorkflowItem($selected['instance'], $selected['runs'], $runsById, $approvalsByRun, $reportsByRun);
                continue;
            }
            $items[] = [
                'kind' => 'run',
                'run' => $this->taskFlowRun($selected['run'], $runsById, $approvalsByRun, $reportsByRun),
            ];
        }
        $page['items'] = $items;

        return ['task_id' => $taskId, 'project_id' => $projectId, 'board_workflow_policy' => $this->boardWorkflowPolicy->resolve($task, $boardId)] + $page;
    }

    /** @param array<string, mixed> $instance @param list<array<string, mixed>> $allRuns @return list<array<string, mixed>> */
    private function taskFlowInstanceRuns(array $instance, array $allRuns): array
    {
        $allRunsById = [];
        foreach ($allRuns as $run) {
            if (is_string($run['id'] ?? null)) {
                $allRunsById[$run['id']] = $run;
            }
        }

        $orderedRuns = [];
        $includedIds = [];
        foreach ($instance['run_ids'] ?? [] as $runId) {
            if (!is_string($runId) || isset($includedIds[$runId]) || !isset($allRunsById[$runId])) {
                continue;
            }
            $run = $allRunsById[$runId];
            $associatedInstanceId = $run['workflow_instance_id'] ?? null;
            if (null !== $associatedInstanceId && $associatedInstanceId !== $instance['id']) {
                continue;
            }
            $orderedRuns[] = $run;
            $includedIds[$runId] = true;
        }

        $additionalRuns = [];
        foreach ($allRuns as $run) {
            if (($run['workflow_instance_id'] ?? null) !== $instance['id'] || isset($includedIds[$run['id'] ?? ''])) {
                continue;
            }
            $additionalRuns[] = $run;
        }
        usort($additionalRuns, static fn (array $left, array $right): int => strcmp((string) ($left['created_at'] ?? ''), (string) ($right['created_at'] ?? '')) ?: strcmp((string) ($left['id'] ?? ''), (string) ($right['id'] ?? '')));

        return [...$orderedRuns, ...$additionalRuns];
    }

    /** @param list<string> $runIds @return array<string, list<array<string, mixed>>> */
    private function taskFlowApprovals(string $projectId, array $runIds): array
    {
        $selectedRunIds = array_fill_keys($runIds, true);
        $approvalsByRun = [];
        foreach ($this->taskFlowReader->approvals($runIds, $projectId) as $approval) {
            $runId = $approval['run_id'] ?? null;
            if (!is_string($runId) || !isset($selectedRunIds[$runId]) || ($approval['project_id'] ?? null) !== $projectId) {
                continue;
            }
            $approvalsByRun[$runId][] = $approval;
        }

        return $approvalsByRun;
    }

    /** @param list<string> $runIds @param array<string, array<string, mixed>> $runsById @return array<string, list<array<string, mixed>>> */
    private function taskFlowReports(string $projectId, array $runIds, array $runsById): array
    {
        $reportsByRun = [];
        foreach ($this->taskFlowReader->reports($runIds, $projectId) as $report) {
            $runId = $report['run_id'] ?? null;
            if (!is_string($runId) || !isset($runsById[$runId])) {
                continue;
            }
            $run = $runsById[$runId];
            if (isset($report['project_id']) && $report['project_id'] !== ($run['project_id'] ?? null)) {
                continue;
            }
            $reportsByRun[$runId][] = $report;
        }

        return $reportsByRun;
    }

    /** @param list<array<string, mixed>> $runs @param array<string, array<string, mixed>> $runsById @param array<string, list<array<string, mixed>>> $approvalsByRun @param array<string, list<array<string, mixed>>> $reportsByRun @return array<string, mixed> */
    private function taskFlowWorkflowItem(array $instance, array $runs, array $runsById, array $approvalsByRun, array $reportsByRun): array
    {
        $definition = $this->taskFlowDefinition($instance);
        $historyStatus = $this->taskFlowHistoryStatus($instance);
        $selectedTransitions = $this->taskFlowSelectedTransitions($instance, $historyStatus);
        $transitionRecords = $selectedTransitions ?? [];
        $active = !in_array($instance['state'] ?? null, ['succeeded', 'failed', 'cancelled'], true);
        $stageRuns = [];
        foreach ($runs as $run) {
            if (is_string($run['stage'] ?? null)) {
                $stageRuns[$run['stage']][] = $run;
            }
        }
        $currentStageId = is_string($instance['current_stage_id'] ?? null) ? $instance['current_stage_id'] : null;
        $transitions = array_values(array_map(
            fn (array $transition): array => $this->taskFlowTransition($transition, $transitionRecords, $active, $historyStatus, $stageRuns, $currentStageId),
            array_filter($definition['transitions'] ?? [], 'is_array'),
        ));

        $phases = [];
        foreach (array_values(array_filter($definition['stages'] ?? [], 'is_array')) as $position => $stage) {
            $stageId = (string) ($stage['id'] ?? '');
            $phase = $this->taskFlowPhaseStatus(
                $instance,
                $stageId,
                $stageRuns[$stageId] ?? [],
                $runs,
                $transitionRecords,
                $historyStatus,
                [] !== $definition,
            );
            $phaseItem = [
                'id' => $stageId,
                'position' => $position,
                'name' => (string) ($stage['name'] ?? ''),
                'kind' => (string) ($stage['kind'] ?? ''),
                'agent_profile_id' => $stage['agent_profile_id'] ?? null,
                'entry_conditions' => array_values(array_map(
                    $this->taskFlowCondition(...),
                    array_filter($stage['entry_conditions'] ?? [], 'is_array'),
                )),
                'run_completion_policy' => $stage['run_completion_policy'] ?? [],
                'status' => $phase['status'],
                'blocker_reason' => $phase['blocker_reason'],
            ];
            if (is_string($stage['instructions'] ?? null)) {
                $phaseItem['instructions'] = $stage['instructions'];
            }
            if (is_array($stage['board_target'] ?? null)) {
                $phaseItem['board_target'] = $stage['board_target'];
            }
            $phases[] = $phaseItem;
        }

        return [
            'kind' => 'workflow_instance',
            'id' => $instance['id'],
            'workflow_id' => $instance['workflow_id'],
            'workflow_name' => is_string($definition['name'] ?? null) ? $definition['name'] : null,
            'definition_version' => (int) $instance['definition_version'],
            'definition_available' => [] !== $definition,
            'state' => $instance['state'],
            'created_at' => $instance['created_at'],
            'updated_at' => $instance['updated_at'],
            'started_at' => $instance['started_at'] ?? null,
            'ended_at' => $instance['ended_at'] ?? null,
            'current_stage_id' => $instance['current_stage_id'] ?? null,
            'repair_round' => isset($instance['repair_round']) ? (int) $instance['repair_round'] : null,
            'pause_reason' => $instance['pause_reason'] ?? null,
            'branch_history_status' => $historyStatus,
            'phases' => $phases,
            'candidate_transitions' => $transitions,
            'selected_transitions' => $selectedTransitions,
            'runs' => array_map(fn (array $run): array => $this->taskFlowRun($run, $runsById, $approvalsByRun, $reportsByRun), $runs),
        ];
    }

    /** @param array<string, mixed> $instance @return array<string, mixed> */
    private function taskFlowDefinition(array $instance): array
    {
        if (is_array($instance['definition_snapshot'] ?? null)) {
            return $instance['definition_snapshot'];
        }

        foreach ($this->store->all('workflow_versions') as $version) {
            if (($version['workflow_id'] ?? null) === $instance['workflow_id']
                && in_array($version['project_id'] ?? null, [null, $instance['project_id'] ?? null], true)
                && (int) ($version['definition_version'] ?? 0) === (int) $instance['definition_version']) {
                return $version;
            }
        }

        $current = $this->store->find('workflows', (string) $instance['workflow_id']);
        if (null !== $current
            && in_array($current['project_id'] ?? null, [null, $instance['project_id'] ?? null], true)
            && (int) ($current['definition_version'] ?? 0) === (int) $instance['definition_version']) {
            return $current;
        }

        return [];
    }

    /** @param array<string, mixed> $transition @param list<array<string, mixed>> $selectedTransitions @param array<string, list<array<string, mixed>>> $stageRuns @return array<string, mixed> */
    private function taskFlowTransition(array $transition, array $selectedTransitions, bool $active, string $historyStatus, array $stageRuns, ?string $currentStageId): array
    {
        $fromStageId = (string) ($transition['from_stage_id'] ?? '');
        $toStageId = (string) ($transition['to_stage_id'] ?? '');
        $outcome = (string) ($transition['on'] ?? '');
        $routeLabelId = $transition['route_label_id'] ?? null;
        $selected = [] !== array_filter($selectedTransitions, static fn (array $record): bool => $record['from_stage_id'] === $fromStageId
            && $record['to_stage_id'] === $toStageId && $record['outcome'] === $outcome && ($record['route_label_id'] ?? null) === $routeLabelId);
        $sourceHasRuns = [] !== ($stageRuns[$fromStageId] ?? []);
        $selectionStatus = match (true) {
            $selected => 'selected',
            $active && (!$sourceHasRuns || $fromStageId === $currentStageId || 'not_recorded' !== $historyStatus) => 'possible',
            $active => 'unknown',
            'complete' === $historyStatus => 'not_selected',
            default => 'unknown',
        };

        return [
            'from_stage_id' => $fromStageId,
            'to_stage_id' => $toStageId,
            'on' => $outcome,
            'conditions' => array_values(array_map(
                $this->taskFlowCondition(...),
                array_filter($transition['conditions'] ?? [], 'is_array'),
            )),
            'selection_status' => $selectionStatus,
        ] + (null === $routeLabelId ? [] : ['route_label_id' => $routeLabelId]);
    }

    /** @param array<string, mixed> $condition @return array<string, mixed> */
    private function taskFlowCondition(array $condition): array
    {
        return array_intersect_key($condition, array_flip(['type', 'evidence_kind']));
    }

    /** @param array<string, mixed> $instance @param list<array<string, mixed>> $matchingRuns @param list<array<string, mixed>> $allRuns @param list<array<string, mixed>> $selectedTransitions @return array{status: string, blocker_reason: string|null} */
    private function taskFlowPhaseStatus(array $instance, string $stageId, array $matchingRuns, array $allRuns, array $selectedTransitions, string $historyStatus, bool $definitionAvailable): array
    {
        $isCurrent = ($instance['current_stage_id'] ?? null) === $stageId;
        $latestRun = [] !== $matchingRuns ? $matchingRuns[array_key_last($matchingRuns)] : null;
        $state = (string) ($instance['state'] ?? '');
        if ($isCurrent) {
            $runState = (string) ($latestRun['state'] ?? '');
            $blocked = 'paused' === $state
                || in_array($state, ['failed', 'cancelled'], true)
                || in_array($runState, ['waiting_input', 'auth_blocked', 'failed', 'cancelled', 'abandoned'], true);

            return [
                'status' => $blocked ? 'blocked' : 'current',
                'blocker_reason' => $blocked ? ($instance['pause_reason'] ?? $latestRun['status_reason'] ?? null) : null,
            ];
        }

        if (null === $latestRun) {
            if ([] !== array_filter($selectedTransitions, static fn (array $record): bool => $record['from_stage_id'] === $stageId)) {
                return ['status' => 'completed', 'blocker_reason' => null];
            }
            if (in_array($state, ['succeeded', 'failed', 'cancelled'], true) && 'complete' === $historyStatus && $definitionAvailable) {
                return ['status' => 'skipped', 'blocker_reason' => null];
            }

            return ['status' => in_array($state, ['succeeded', 'failed', 'cancelled'], true) ? 'unknown' : 'open', 'blocker_reason' => null];
        }

        $latestRunId = (string) ($latestRun['id'] ?? '');
        $selectedLatestTransition = [] !== array_filter(
            $selectedTransitions,
            static fn (array $record): bool => $record['from_stage_id'] === $stageId && $record['source_run_id'] === $latestRunId,
        );
        $hasLaterRun = false;
        $latestRunIndex = null;
        foreach ($allRuns as $index => $run) {
            if (($run['id'] ?? null) === $latestRunId) {
                $latestRunIndex = $index;
                break;
            }
        }
        if (null !== $latestRunIndex) {
            foreach (array_slice($allRuns, $latestRunIndex + 1) as $run) {
                if (($run['stage'] ?? null) !== $stageId) {
                    $hasLaterRun = true;
                    break;
                }
            }
        }
        if ($selectedLatestTransition || $hasLaterRun || ('succeeded' === $state && 'succeeded' === ($latestRun['state'] ?? null))) {
            return ['status' => 'completed', 'blocker_reason' => null];
        }

        if (in_array($latestRun['state'] ?? null, ['waiting_input', 'auth_blocked', 'failed', 'cancelled', 'abandoned'], true)) {
            return ['status' => 'blocked', 'blocker_reason' => $latestRun['status_reason'] ?? null];
        }

        return ['status' => 'unknown', 'blocker_reason' => null];
    }

    /** @param array<string, mixed> $instance @return list<array{from_stage_id: string, to_stage_id: string, outcome: string, source_run_id: string, report_id: string|null, selected_at: string}>|null */
    private function taskFlowSelectedTransitions(array $instance, string $historyStatus): ?array
    {
        if (!in_array($historyStatus, ['complete', 'partial'], true) || !is_array($instance['selected_transitions'] ?? null)) {
            return null;
        }

        $transitions = [];
        foreach ($instance['selected_transitions'] as $transition) {
            if (!is_array($transition)) {
                continue;
            }
            $transitions[] = [
                'from_stage_id' => (string) ($transition['from_stage_id'] ?? ''),
                'to_stage_id' => (string) ($transition['to_stage_id'] ?? ''),
                'outcome' => (string) ($transition['outcome'] ?? ''),
                'source_run_id' => (string) ($transition['source_run_id'] ?? ''),
                'report_id' => is_string($transition['report_id'] ?? null) ? $transition['report_id'] : null,
                'selected_at' => (string) ($transition['selected_at'] ?? ''),
            ] + array_intersect_key($transition, array_flip(['owner_guidance', 'route_label_id', 'route_label_name']));
        }

        return $transitions;
    }

    /** @param array<string, mixed> $instance @return 'complete'|'partial'|'not_recorded' */
    private function taskFlowHistoryStatus(array $instance): string
    {
        $storedStatus = $instance['transition_history_status'] ?? null;
        if ('not_recorded' === $storedStatus) {
            return 'not_recorded';
        }
        if (in_array($storedStatus, ['complete', 'partial'], true) && is_array($instance['selected_transitions'] ?? null)) {
            return $storedStatus;
        }
        if (isset($instance['selected_transitions']) && is_array($instance['selected_transitions'])) {
            return 'partial';
        }

        return 'not_recorded';
    }

    /** @param array<string, mixed> $run @param array<string, array<string, mixed>> $runsById @param array<string, list<array<string, mixed>>> $approvalsByRun @param array<string, list<array<string, mixed>>> $reportsByRun @return array<string, mixed> */
    private function taskFlowRun(array $run, array $runsById, array $approvalsByRun, array $reportsByRun): array
    {
        $attempts = [];
        foreach ($run['attempts'] ?? [] as $attempt) {
            if (!is_array($attempt)) {
                continue;
            }
            $attempts[] = [
                'attempt_no' => isset($attempt['attempt_no']) ? (int) $attempt['attempt_no'] : null,
                'external_thread_id' => is_string($attempt['external_thread_id'] ?? null) ? $attempt['external_thread_id'] : null,
                'started_at' => is_string($attempt['started_at'] ?? null) ? $attempt['started_at'] : null,
                'ended_at' => is_string($attempt['ended_at'] ?? null) ? $attempt['ended_at'] : null,
                'last_observed_at' => is_string($attempt['last_observed_at'] ?? null) ? $attempt['last_observed_at'] : null,
                'remote_status' => is_string($attempt['remote_status'] ?? null) ? $attempt['remote_status'] : null,
            ];
        }

        $reports = [];
        foreach ($reportsByRun[$run['id']] ?? [] as $report) {
            $reportItem = [
                'id' => $report['id'],
                'attempt_no' => (int) $report['attempt_no'],
                'task_revision' => (int) $report['task_revision'],
                'outcome' => (string) $report['outcome'],
                'summary' => (string) $report['summary'],
                'evidence_ids' => array_values(array_filter($report['evidence_ids'] ?? [], 'is_string')),
                'open_questions' => array_values(array_filter($report['_open_questions'] ?? [], 'is_string')),
                'received_at' => (string) $report['received_at'],
                'rejection_reason' => $report['rejection_reason'] ?? null,
                'accepted_for_reconciliation' => (bool) $report['accepted_for_reconciliation'],
            ];
            if (array_key_exists('route_label_id', $report)) {
                $reportItem['route_label_id'] = is_string($report['route_label_id']) ? $report['route_label_id'] : null;
                $reportItem['route_label_name'] = is_string($report['route_label_name'] ?? null) ? $report['route_label_name'] : null;
            }
            $reports[] = $reportItem;
        }

        $approvals = [];
        foreach ($approvalsByRun[$run['id']] ?? [] as $approval) {
            $approvals[] = [
                'id' => $approval['id'],
                'attempt_no' => (int) $approval['attempt_no'],
                'task_revision' => (int) $approval['task_revision'],
                'kind' => $approval['kind'],
                'status' => $approval['status'],
                'requested_at' => $approval['requested_at'],
                'decided_at' => $approval['decided_at'] ?? null,
                'decided_by' => $approval['decided_by'] ?? null,
                'reason' => $approval['reason'] ?? null,
            ];
        }

        return [
            'id' => $run['id'],
            'stage' => (string) ($run['stage'] ?? ''),
            'state' => $run['state'],
            'task_revision' => isset($run['snapshot']['task_revision']) ? (int) $run['snapshot']['task_revision'] : null,
            'created_at' => $run['created_at'],
            'updated_at' => $run['updated_at'],
            'attempt_no' => isset($run['attempt_no']) ? (int) $run['attempt_no'] : null,
            'attempts' => $attempts,
            'reports' => $reports,
            'approvals' => $approvals,
            'handoff' => $this->taskFlowHandoff($run, $runsById),
            'status_reason' => is_string($run['status_reason'] ?? null) ? $run['status_reason'] : null,
        ];
    }

    /** @param array<string, mixed> $run @param array<string, array<string, mixed>> $runsById @return array<string, mixed>|null */
    private function taskFlowHandoff(array $run, array $runsById): ?array
    {
        $snapshot = $run['snapshot']['handoff_snapshot'] ?? null;
        if (!is_array($snapshot)) {
            return null;
        }
        $sourceRunId = $run['snapshot']['handoff_source_run_id'] ?? null;
        $sourceRun = is_string($sourceRunId) ? ($runsById[$sourceRunId] ?? null) : null;
        $collections = [];
        foreach ($snapshot['link_collections'] ?? [] as $collection) {
            if (!is_array($collection)) {
                continue;
            }
            $links = [];
            foreach ($collection['links'] ?? [] as $link) {
                if (!is_array($link)) {
                    continue;
                }
                $links[] = array_intersect_key($link, array_flip(['id', 'title', 'url', 'kind', 'relation', 'registered_by', 'registered_at', 'updated_at', 'provenance']));
            }
            $collections[] = [
                'id' => $collection['id'],
                'task_id' => $collection['task_id'],
                'task_version' => (int) ($collection['task_version'] ?? 1),
                'name' => (string) ($collection['name'] ?? ''),
                'kind' => (string) ($collection['kind'] ?? 'reference'),
                'links' => $links,
            ];
        }

        return [
            'source_run_id' => is_string($sourceRunId) ? $sourceRunId : null,
            'source_report_id' => is_string($snapshot['source_report_id'] ?? null) ? $snapshot['source_report_id'] : null,
            'source_attempt_no' => isset($snapshot['source_attempt_no']) ? (int) $snapshot['source_attempt_no'] : null,
            'task_revision' => isset($snapshot['task_revision_id']) ? (int) $snapshot['task_revision_id'] : null,
            'external_thread_id' => is_string($snapshot['external_thread_id'] ?? null) ? $snapshot['external_thread_id'] : null,
            'summary' => is_string($snapshot['summary'] ?? null) ? $snapshot['summary'] : null,
            'outcome' => is_string($snapshot['outcome'] ?? null) ? $snapshot['outcome'] : null,
            'context_summary' => is_string($snapshot['context_summary'] ?? null) ? $snapshot['context_summary'] : null,
            'open_questions' => array_values(array_filter($snapshot['open_questions'] ?? [], 'is_string')),
            'reported_evidence_ids' => array_values(array_filter($snapshot['reported_evidence_ids'] ?? [], 'is_string')),
            'link_collections' => $collections,
            'source_agent_profile_id' => is_string($sourceRun['snapshot']['agent_profile_id'] ?? null) ? $sourceRun['snapshot']['agent_profile_id'] : null,
            'target_agent_profile_id' => is_string($run['snapshot']['agent_profile_id'] ?? null) ? $run['snapshot']['agent_profile_id'] : null,
        ] + array_intersect_key($snapshot, ['owner_guidance' => true]);
    }
}
