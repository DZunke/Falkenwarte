<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

use App\AgentCatalog\Application\AgentCatalogReader;
use App\Automation\Application\WorkflowPolicy;
use App\Orchestration\Domain\DispatchRequest;
use App\Orchestration\Domain\RunCompletionEvaluator;
use App\Orchestration\Domain\RunDelegationPolicy;
use App\Orchestration\Domain\RunDelegationViolation;
use App\Shared\Application\Actor;
use App\Shared\Application\OperationHandler;
use App\Shared\Application\Store;
use App\Shared\Domain\CanonicalData;
use App\Shared\Domain\Problem;
use App\WorkManagement\Application\BoardWorkflowPolicyReader;
use App\WorkManagement\Application\TaskEvidenceEligibility;
use App\WorkManagement\Application\TaskEvidenceProjectionReader;
use Symfony\Component\Uid\Uuid;

final class RunHandler implements OperationHandler
{
    private const ACTIVE_RUN_STATES = ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested', 'result_reported', 'verifying'];

    private readonly AgentExecutionBridge $bridge;

    public function __construct(
        public Store $store,
        AgentExecutionBridge $bridge,
        private readonly AgentCatalogReader $agentCatalog,
        private readonly WorkflowPolicy $workflowPolicy,
        private readonly WorkflowStageBoardMover $stageBoardMover,
        private readonly BoardWorkflowPolicyReader $boardWorkflowPolicy,
        private readonly RunCompletionEvaluator $completionEvaluator,
        private readonly RunDelegationPolicy $delegationPolicy,
        private readonly TaskEvidenceProjectionReader $taskEvidenceProjection,
        private readonly TaskEvidenceEligibility $taskEvidenceEligibility,
    ) {
        $this->bridge = $bridge;
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'runs_list', 'runs_get', 'runs_request', 'runs_cancel', 'runs_input', 'runs_reconcile', 'runs_abandon', 'runs_report_result', 'run_result_report_get',
            'approvals_list', 'approvals_request', 'approvals_get', 'approvals_decide', 'task_handoff_get',
            'workflows_list', 'workflows_create', 'workflows_get', 'workflows_replace', 'workflow_version_get',
            'workflow_instances_start', 'workflow_instances_get', 'workflow_instances_control', 'workflow_instances_list',
            'triggers_list', 'triggers_create', 'triggers_get', 'triggers_replace',
            'recovery_inventory_get', 'recovery_inventory_decide',
        ], true);
    }

    /** @param array<string, mixed> $p @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'runs_list' => $this->listRuns($p, $actor),
            'runs_get' => $this->getRun($this->pathId($p, 'run_id'), $actor),
            'runs_request' => $this->requestRun($this->pathId($p, 'task_id'), $body, $actor),
            'runs_cancel' => $this->cancelRun($this->pathId($p, 'run_id'), $body, $actor),
            'runs_input' => $this->sendInput($this->pathId($p, 'run_id'), $body, $actor),
            'runs_reconcile' => $this->reconcileRun($this->pathId($p, 'run_id'), $body, $actor),
            'runs_abandon' => $this->abandonRun($this->pathId($p, 'run_id'), $body, $actor),
            'runs_report_result' => $this->reportResult($this->pathId($p, 'run_id'), $body, $actor),
            'run_result_report_get' => $this->getReport($this->pathId($p, 'run_id'), $this->pathId($p, 'report_id'), $actor),
            'approvals_list' => $this->listApprovals($p, $actor),
            'approvals_request' => $this->requestApproval($this->pathId($p, 'run_id'), $body, $actor),
            'approvals_get' => $this->getApproval($this->pathId($p, 'approval_id'), $actor),
            'approvals_decide' => $this->decideApproval($this->pathId($p, 'approval_id'), $body, $actor),
            'task_handoff_get' => $this->getHandoff($this->pathId($p, 'task_id'), $p, $actor),
            'workflows_list' => $this->listWorkflows($p, $actor),
            'workflows_create' => $this->writeWorkflow(null, $body, $actor),
            'workflows_get' => $this->getWorkflow($this->pathId($p, 'workflow_id'), $actor),
            'workflows_replace' => $this->writeWorkflow($this->pathId($p, 'workflow_id'), $body, $actor),
            'workflow_version_get' => $this->getWorkflowVersion($this->pathId($p, 'workflow_id'), (int) ($p['definition_version'] ?? 0), $actor),
            'workflow_instances_start' => $this->startWorkflow($this->pathId($p, 'task_id'), $body, $actor),
            'workflow_instances_get' => $this->getWorkflowInstance($this->pathId($p, 'instance_id'), $actor),
            'workflow_instances_control' => $this->controlWorkflowInstance($this->pathId($p, 'instance_id'), $body, $actor),
            'workflow_instances_list' => $this->listWorkflowInstances($p, $actor),
            'triggers_list' => $this->listTriggers($p, $actor),
            'triggers_create' => $this->writeTrigger(null, $body, $actor),
            'triggers_get' => $this->getTrigger($this->pathId($p, 'trigger_id'), $actor),
            'triggers_replace' => $this->writeTrigger($this->pathId($p, 'trigger_id'), $body, $actor),
            'recovery_inventory_get' => $this->getRecoveryInventory($actor),
            'recovery_inventory_decide' => $this->decideRecoveryInventory($body, $actor),
            default => throw new Problem(404, 'operation_not_found', 'Unbekannte Orchestrierungsoperation.'),
        };
    }

    public function work(string $kind, array $payload): void
    {
        match ($kind) {
            'run.dispatch' => $this->dispatch($this->jobId($payload, 'run_id')),
            'run.observe', 'run.reconcile' => $this->observe($this->jobId($payload, 'run_id')),
            'run.cancel' => $this->performCancel($this->jobId($payload, 'run_id')),
            'run.input' => $this->performInput($this->jobId($payload, 'run_id'), $this->jobId($payload, 'input_id')),
            'workflow.advance' => $this->store->atomic(fn () => $this->advanceWorkflow($this->jobId($payload, 'instance_id'))),
            'workflow.trigger' => $this->store->atomic(fn () => $this->fireTrigger($this->jobId($payload, 'trigger_id'), $payload)),
            'run.restore_inventory' => $this->restoreInventory($payload),
            'recovery.entry.observe' => $this->observeRecoveryEntry($this->jobId($payload, 'entry_id')),
            default => throw new Problem(422, 'unsupported_job', 'Unbekannter Orchestrierungsauftrag.'),
        };
    }

    public function scheduleDue(): void
    {
        $now = $this->store->now();
        $this->store->atomic(function () use ($now): void {
            if (null === $this->activeRecoveryGate() && !$this->maintenanceMode()) {
                foreach ($this->store->all('triggers') as $trigger) {
                    if (!$trigger['enabled'] || 'schedule' !== $trigger['spec']['type'] || null === $trigger['next_due_at'] || $trigger['next_due_at'] > $now) {
                        continue;
                    }
                    $trigger['next_due_at'] = $this->nextDue($trigger['spec']['schedule'], new \DateTimeImmutable($now));
                    $trigger['last_fired_at'] = $now;
                    $this->store->save('triggers', $trigger, 'workflow.trigger_due');
                    $this->store->enqueue('workflow.trigger', ['trigger_id' => $trigger['id'], 'scheduled_at' => $now]);
                }
                foreach ($this->store->all('triggers') as $trigger) {
                    if (!$trigger['enabled'] || ($trigger['spec']['type'] ?? null) !== 'domain_event') {
                        continue;
                    }
                    $events = $this->store->projectEventsAfter($trigger['project_id'], $trigger['spec']['event_type'], $trigger['last_event_id'] ?? null);
                    if ([] === $events) {
                        continue;
                    }
                    $fired = false;
                    foreach ($events as $event) {
                        $trigger['last_event_id'] = $event['event_id'];
                        $taskId = $event['data']['task_id'] ?? $event['data']['transition']['after']['task_id'] ?? $event['aggregate']['id'] ?? null;
                        $task = is_string($taskId) ? $this->store->find('tasks', $taskId) : null;
                        $statusId = $trigger['spec']['task_status_id'] ?? null;
                        if (null === $task || $task['project_id'] !== $trigger['project_id'] || (null !== $statusId && $task['status_id'] !== $statusId)) {
                            continue;
                        }
                        $this->store->enqueue('workflow.trigger', [
                            'trigger_id' => $trigger['id'], 'event_id' => $event['event_id'],
                            'event_type' => $event['event_type'], 'task_id' => $task['id'],
                        ]);
                        $trigger['last_fired_at'] = $now;
                        $fired = true;
                    }
                    $this->store->save('triggers', $trigger, $fired ? 'workflow.domain_event_triggered' : 'workflow.domain_event_cursor_advanced');
                }
            }
            if (null === $this->activeRecoveryGate() && !$this->maintenanceMode()) {
                foreach ($this->store->all('runs') as $run) {
                    if ((empty($run['_maintenance_deferred']) && empty($run['_provider_deferred'])) || !in_array($run['state'], ['queued', 'dispatching', 'result_reported', 'reconciling'], true)) {
                        continue;
                    }
                    $attempt = $this->attempt($run, (int) $run['attempt_no']);
                    if (!empty($run['_provider_deferred']) && !$this->providerEnabledForRun($run, $attempt)) {
                        continue;
                    }
                    if (null !== $attempt['external_thread_id']) {
                        unset($run['_maintenance_deferred']);
                        unset($run['_provider_deferred']);
                        $this->store->save('runs', $run, 'run.maintenance_dispatch_deferred_cleared');
                        continue;
                    }
                    unset($run['_maintenance_deferred']);
                    unset($run['_provider_deferred']);
                    $run['state'] = 'dispatching';
                    $run['status_reason'] = null;
                    $run = $this->store->save('runs', $run, 'run.maintenance_dispatch_resumed');
                    $this->store->enqueue('run.dispatch', ['run_id' => $run['id']]);
                }
                foreach ($this->store->all('runs') as $run) {
                    if (($run['_provider_deferred_action'] ?? null) !== 'cancel' || !in_array($run['state'], ['cancel_requested', 'reconciling'], true)) {
                        continue;
                    }
                    $attempt = $this->attempt($run, (int) $run['attempt_no']);
                    if (!$this->canSendCancellation($run, $attempt)) {
                        continue;
                    }
                    unset($run['_provider_deferred_action']);
                    $this->store->save('runs', $run, 'run.bridge_cancel_resumed');
                    $this->store->enqueue('run.cancel', ['run_id' => $run['id']]);
                }
                foreach ($this->store->all('run_inputs') as $input) {
                    if ('queued' !== $input['status'] || empty($input['_provider_deferred'])) {
                        continue;
                    }
                    $run = $this->store->find('runs', (string) $input['run_id']);
                    if (null === $run) {
                        continue;
                    }
                    $attempt = $this->attempt($run, (int) $input['attempt_no']);
                    if (!$this->providerEnabledForRun($run, $attempt)) {
                        continue;
                    }
                    unset($input['_provider_deferred']);
                    $this->store->save('run_inputs', $input, 'run.bridge_input_resumed');
                    $this->store->enqueue('run.input', ['run_id' => $run['id'], 'input_id' => $input['id']]);
                }
                foreach ($this->store->all('workflow_instances') as $instance) {
                    if ('running' === $instance['state'] && $instance['deadline_at'] <= $now) {
                        $this->advanceWorkflow($instance['id']);
                        continue;
                    }
                    if ('paused' !== $instance['state'] || (empty($instance['_paused_for_maintenance']) && empty($instance['_paused_for_provider_id']))) {
                        continue;
                    }
                    if (isset($instance['_paused_for_provider_id']) && !$this->agentCatalog->providerEnabled((string) $instance['_paused_for_provider_id'])) {
                        continue;
                    }
                    unset($instance['_paused_for_maintenance']);
                    unset($instance['_paused_for_provider_id']);
                    $instance['state'] = 'running';
                    $instance['pause_reason'] = null;
                    $instance = $this->store->save('workflow_instances', $instance, 'workflow.maintenance_resumed');
                    $this->store->enqueue('workflow.advance', ['instance_id' => $instance['id']]);
                }
            }
            foreach ($this->store->all('run_observation_schedules') as $schedule) {
                if ($schedule['next_due_at'] > $now) {
                    continue;
                }
                $run = $this->store->find('runs', (string) $schedule['run_id']);
                if (null === $run || !in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $this->store->remove('run_observation_schedules', $schedule['id'], 'run.observation_schedule_removed');
                    continue;
                }
                $schedule['next_due_at'] = (new \DateTimeImmutable($now))->modify('+5 seconds')->format(DATE_ATOM);
                $this->store->save('run_observation_schedules', $schedule, 'run.observation_scheduled');
                $this->store->enqueue('run.observe', ['run_id' => $run['id']]);
            }
            foreach ($this->store->all('recovery_observation_schedules') as $schedule) {
                if ($schedule['next_due_at'] > $now) {
                    continue;
                }
                $entry = $this->store->find('recovery_entries', (string) $schedule['entry_id']);
                if (null === $entry || in_array($entry['status'] ?? null, ['resolved', 'stopped'], true) || empty($entry['external_thread_id'])) {
                    $this->store->remove('recovery_observation_schedules', $schedule['id'], 'recovery.observation_schedule_removed');
                    continue;
                }
                $schedule['next_due_at'] = (new \DateTimeImmutable($now))->modify('+5 seconds')->format(DATE_ATOM);
                $this->store->save('recovery_observation_schedules', $schedule, 'recovery.observation_scheduled');
                $this->store->enqueue('recovery.entry.observe', ['entry_id' => $entry['id']]);
            }
        });
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listRuns(array $p, Actor $actor): array
    {
        $items = $this->store->all('runs');
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
            $items = array_values(array_filter($items, static fn (array $run): bool => $run['project_id'] === $p['project_id']));
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $run) use ($actor): bool {
                try {
                    $actor->requireProject((string) $run['project_id']);

                    return true;
                } catch (Problem) {
                    return false;
                }
            }));
        }
        foreach (['task_id', 'agent_profile_id', 'state'] as $filter) {
            if (isset($p[$filter])) {
                $items = array_values(array_filter(
                    $items,
                    static fn (array $run): bool => ('agent_profile_id' === $filter
                        ? ($run['snapshot']['agent_profile_id'] ?? null)
                        : $run[$filter] ?? null) === $p[$filter],
                ));
            }
        }
        usort($items, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $this->store->page($items, $p);
    }

    /** @return array<string, mixed> */
    private function getRun(string $id, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);

        return $run;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function requestRun(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->record('tasks', $taskId);
        $projectId = (string) $task['project_id'];
        $actor->requireProject($projectId);
        if (!$actor->owner && (!isset($body['parent_run_id']) || !in_array('runs.request', $actor->capabilities, true))) {
            throw new Problem(403, 'forbidden', 'Ein technischer Agent darf nur mit ausdrücklich gewährtem runs.request und einem passenden übergeordneten Lauf delegieren.');
        }
        $this->assertTaskCanStart($task);
        if ((int) $task['version'] !== (int) $body['task_revision']) {
            throw new Problem(412, 'version_conflict', 'Die Aufgabe hat sich seit dem gelesenen Stand geändert.');
        }

        return $this->store->atomic(function () use ($task, $body, $projectId, $actor): array {
            $task = $this->record('tasks', (string) $task['id']);
            if ((int) $task['version'] !== (int) $body['task_revision']) {
                throw new Problem(412, 'version_conflict', 'Die Aufgabe hat sich seit dem gelesenen Stand geändert.');
            }
            $this->assertTaskCanStart($task);
            if ($this->maintenanceMode()) {
                throw new Problem(409, 'maintenance_mode', 'Der Wartungsmodus hält neue Agentenläufe vorübergehend an. Beobachtung und Wiederherstellung bleiben verfügbar.');
            }
            if (null !== $this->activeRecoveryGate()) {
                throw new Problem(409, 'recovery_inventory_required', 'Nach der Wiederherstellung muss zuerst die externe T3-Inventur ausdrücklich abgeschlossen werden.');
            }
            $profile = $this->agentCatalog->profile((string) $body['agent_profile_id']);
            if (!$profile['enabled'] || !$profile['configuration_valid']) {
                throw new Problem(409, 'agent_profile_unavailable', (string) ($profile['configuration_error'] ?? 'Das Agentprofil ist nicht startbereit.'));
            }
            $providerId = $profile['bridge_plugin_id'] ?? null;
            if (!is_string($providerId) || '' === $providerId || !$this->agentCatalog->providerEnabled($providerId)) {
                throw new Problem(409, 'capability_unavailable', 'Der registrierte Ausführungsprovider nimmt keine neuen T3-Aufträge an.');
            }
            if (!$this->agentCatalog->profileAllowsProject($profile, $projectId)) {
                throw new Problem(403, 'forbidden', 'Dieses Agentprofil ist für das Projekt nicht freigegeben.');
            }
            $binding = $this->agentCatalog->bindingForProject($projectId);
            if (null === $binding) {
                throw new Problem(409, 't3_project_unbound', 'Das Projekt ist noch keinem vorhandenen T3-Projekt zugeordnet.');
            }
            $connection = $this->agentCatalog->connection((string) $binding['connection_id']);
            if ('valid' !== $connection['auth_status'] || 'incompatible' === $connection['health']) {
                throw new Problem(409, 't3_connection_unavailable', 'Die T3-Verbindung ist nicht startbereit. Prüfe Verbindung und Anmeldung.');
            }
            if (($profile['connection_id'] ?? null) !== $connection['id']) {
                throw new Problem(409, 'agent_connection_mismatch', 'Agentprofil und Projektbindung verwenden unterschiedliche T3-Verbindungen.');
            }
            $this->assertCapabilities($connection, ['t3_thread_launch', 't3_thread_read']);
            $parentRun = null;
            if (isset($body['parent_run_id'])) {
                $parentRun = $this->record('runs', (string) $body['parent_run_id']);
                if ($parentRun['project_id'] !== $projectId || $parentRun['task_id'] !== $task['id']) {
                    throw new Problem(409, 'run_context_mismatch', 'Ein delegierter Lauf muss zum selben Ticket und Projekt wie sein übergeordneter Lauf gehören.');
                }
                if (!in_array($parentRun['state'], ['succeeded', 'failed', 'cancelled', 'abandoned'], true)) {
                    throw new Problem(409, 'run_parent_active', 'Ein Lauf kann erst delegieren, wenn sein eigener T3-Ausgang geklärt ist.');
                }
            }

            foreach ($this->store->all('runs') as $existing) {
                if (($existing['snapshot']['project_binding_id'] ?? null) === $binding['id'] && in_array($existing['state'], self::ACTIVE_RUN_STATES, true)) {
                    throw new Problem(409, 'execution_slot_occupied', 'Für dieses T3-Projekt ist bereits ein Auftrag aktiv oder ungeklärt.');
                }
            }

            $workflowInstance = null;
            if (isset($body['workflow_instance_id'])) {
                $workflowInstance = $this->record('workflow_instances', (string) $body['workflow_instance_id']);
                if (
                    $workflowInstance['task_id'] !== $task['id']
                    || $workflowInstance['project_id'] !== $projectId
                    || 'running' !== $workflowInstance['state']
                    || $workflowInstance['current_stage_id'] !== $body['stage']
                ) {
                    throw new Problem(409, 'run_context_mismatch', 'Der Workflow-Auftrag gehört nicht zur aktuellen Phase dieser Aufgabe.');
                }
            }

            $delegationDepth = 0;
            if (null !== $parentRun) {
                if (null === $workflowInstance || ($parentRun['workflow_instance_id'] ?? null) !== $workflowInstance['id']) {
                    throw new Problem(409, 'run_delegation_unbounded', 'Ein delegierter Lauf benötigt dieselbe aktive, zeitlich und fachlich begrenzte Workflowinstanz.');
                }
                if ((int) $parentRun['snapshot']['task_revision'] !== (int) $task['version']) {
                    throw new Problem(409, 'run_context_mismatch', 'Der übergeordnete Lauf gehört zu einer anderen Aufgabenrevision.');
                }
                try {
                    $delegationDepth = $this->delegationPolicy->childDepth(
                        (int) ($parentRun['snapshot']['delegation_depth'] ?? 0),
                        (int) ($workflowInstance['definition_snapshot']['limits']['max_depth'] ?? 0),
                    );
                } catch (RunDelegationViolation $violation) {
                    throw new Problem(409, $violation->problemCode, $violation->getMessage());
                }
                if (new \DateTimeImmutable((string) $workflowInstance['deadline_at']) <= new \DateTimeImmutable($this->store->now())) {
                    throw new Problem(409, 'workflow_duration_limit', 'Das Zeitbudget der Workflowinstanz ist abgelaufen.');
                }
            }

            $policy = $this->defaultRunPolicy();
            $workflowVersion = null;
            $routing = null;
            $stageContext = null;
            $stageWorkflow = null;
            if (null !== $workflowInstance) {
                $workflow = $this->workflowDefinition((string) $workflowInstance['workflow_id'], (int) $workflowInstance['definition_version']);
                $stage = $this->stage($workflow, (string) $workflowInstance['current_stage_id']);
                $stageContext = $stage;
                $stageWorkflow = $workflow;
                if (null !== $stage['agent_profile_id'] && $stage['agent_profile_id'] !== $profile['id']) {
                    throw new Problem(409, 'run_context_mismatch', 'Das Agentprofil stimmt nicht mit der Version der aktiven Workflowphase überein.');
                }
                $this->assertConditions($stage['entry_conditions'] ?? [], $task, $workflowInstance);
                $policy = $stage['run_completion_policy'];
                $workflowVersion = (int) $workflowInstance['definition_version'];
            } else {
                $routing = $this->store->find('task_routing_snapshots', (string) $task['id']);
                if (!empty($task['workflow_label_id'])) {
                    if (null === $routing) {
                        throw new Problem(409, 'workflow_route_conflict', 'Die Aufgabe hat ein Workflowlabel, aber keine passende versionierte Route.');
                    }
                    $workflow = $this->workflowDefinition((string) $routing['workflow_id'], (int) $routing['workflow_definition_version']);
                    $stage = $this->stage($workflow, (string) $body['stage']);
                    $stageContext = $stage;
                    $stageWorkflow = $workflow;
                    if ($stage['agent_profile_id'] !== $profile['id']) {
                        throw new Problem(409, 'run_context_mismatch', 'Das Agentprofil stimmt nicht mit der versionierten Workflowphase überein.');
                    }
                    $this->assertConditions($stage['entry_conditions'] ?? [], $task, null);
                    $policy = $stage['run_completion_policy'];
                    $workflowVersion = (int) $routing['workflow_definition_version'];
                } else {
                    $policy = $profile['default_run_completion_policy'] ?? $policy;
                }
            }

            $source = $parentRun;
            if (null === $source && null !== $workflowInstance && isset($workflowInstance['_stage_source_run_id'])) {
                $source = $this->record('runs', $workflowInstance['_stage_source_run_id']);
            }
            $handoffSnapshot = null === $source ? [] : $this->freezeHandoff($source, $task, $workflowInstance);
            if (null !== $stageContext) {
                $task = $this->applyWorkflowStageBoardTarget($task, $stageContext, $projectId);
            }

            $runId = $this->store->id();
            $attemptNo = 1;
            $dispatchId = $this->store->id();
            $executionTarget = $profile['execution_target'];
            $snapshot = [
                'task_revision' => (int) $task['version'],
                'title' => (string) $task['title'],
                'description' => (string) $task['description'],
                'criteria' => array_values($task['criteria'] ?? []),
                'agent_profile_id' => $profile['id'],
                'agent_profile_version' => (int) $profile['version'],
                'project_binding_id' => $binding['id'],
                'workflow_version' => $workflowVersion,
                'prompt_template_version' => (int) $profile['prompt_template_version'],
                'run_completion_policy' => $policy,
                'execution_target' => $executionTarget,
                'bridge_plugin_id' => $profile['bridge_plugin_id'] ?? null,
                'delegation_depth' => $delegationDepth,
                'classification_id' => $task['classification_id'] ?? null,
                'workflow_label_id' => $task['workflow_label_id'] ?? null,
                'routing_rules_version' => $routing['routing_rules_version'] ?? $task['routing_rules_version'] ?? null,
            ];
            if (null !== $stageContext) {
                $snapshot += $this->stageSnapshot($stageContext, $stageWorkflow, $task);
            }
            $snapshot += $handoffSnapshot;
            $attempt = [
                'attempt_no' => $attemptNo,
                'dispatch_id' => $dispatchId,
                'connection_id' => $connection['id'],
                'auth_epoch' => max(1, (int) $connection['auth_epoch']),
                'external_thread_id' => null,
                'external_dispatch_run_id' => null,
                'external_observed_run_id' => null,
                'external_result_run_id' => null,
                'external_message_id' => null,
                'external_url' => null,
                'remote_status' => null,
                'last_observed_at' => null,
                'started_at' => null,
                'ended_at' => null,
                'request_sha256' => hash('sha256', ''),
            ];
            $run = $this->store->save('runs', [
                'id' => $runId,
                'project_id' => $projectId,
                'task_id' => $task['id'],
                'stage' => (string) $body['stage'],
                'state' => 'queued',
                'snapshot' => $snapshot,
                'attempt_no' => $attemptNo,
                'attempts' => [$attempt],
                'parent_run_id' => $parentRun['id'] ?? null,
                '_requested_by' => $actor->ref(),
                '_prompt_template' => (string) ($profile['prompt_template'] ?? ''),
                'workflow_instance_id' => $workflowInstance['id'] ?? null,
                'pending_input' => null,
                'result_digest' => null,
                'evidence_ids' => [],
                'report_ids' => [],
                'last_observed_at' => null,
                'status_reason' => null,
                '_dispatch_request' => null,
            ], 'run.queued');
            if (null !== $workflowInstance) {
                unset($workflowInstance['_stage_source_run_id']);
                $workflowInstance['run_ids'][] = $run['id'];
                $this->store->save('workflow_instances', $workflowInstance, 'workflow.run_attached');
            }
            $this->store->enqueue('run.dispatch', ['run_id' => $run['id']]);

            return $this->store->accepted(['resource_type' => 'run', 'id' => $run['id']], $run['id']);
        });
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function cancelRun(string $id, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);
        if (!in_array($run['state'], ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'result_reported', 'verifying'], true)) {
            throw new Problem(409, 'run_transition_invalid', 'Dieser Lauf kann aus seinem aktuellen Zustand nicht abgebrochen werden.');
        }
        $run = $this->requestCancellation($run, trim((string) $body['reason']), 'run.cancel_requested');
        $this->store->enqueue('run.cancel', ['run_id' => $id]);

        return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function sendInput(string $id, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);
        if (!in_array($run['state'], ['waiting_input', 'running'], true)) {
            throw new Problem(409, 'run_input_not_pending', 'Dieser Lauf wartet derzeit nicht auf eine Eingabe.');
        }
        if (($body['type'] ?? null) === 'answer_question') {
            if (($run['pending_input']['kind'] ?? null) === 'permission' || ($run['pending_input']['answerable_via_api'] ?? true) === false) {
                throw new Problem(403, 'run_permission_in_t3', 'Berechtigungsfreigaben müssen in der zugehörigen T3-Oberfläche entschieden werden.');
            }
            $allowed = array_column($run['pending_input']['questions'] ?? [], 'id');
            foreach ($body['answers'] as $answer) {
                if (!in_array($answer['question_id'], $allowed, true)) {
                    throw new Problem(422, 'validation_failed', 'Die Antwort enthält eine Frage, die für diesen Lauf nicht offen ist.');
                }
            }
        }
        $input = $this->store->save('run_inputs', ['run_id' => $id, 'attempt_no' => $run['attempt_no'], 'body' => $body, 'status' => 'queued'], 'run.input_queued');
        $this->store->enqueue('run.input', ['run_id' => $id, 'input_id' => $input['id']]);

        return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function reconcileRun(string $id, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);
        if (in_array($run['state'], ['succeeded', 'failed', 'cancelled'], true)) {
            throw new Problem(409, 'run_terminal', 'Ein geklärter Lauf benötigt keinen weiteren Abgleich.');
        }
        $run['state'] = 'reconciling';
        $run['status_reason'] = isset($body['reason']) ? trim((string) $body['reason']) : 'T3-Zustand wird abgeglichen.';
        $this->store->save('runs', $run, 'run.reconciliation_requested');
        $this->store->enqueue('run.reconcile', ['run_id' => $id]);

        return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function abandonRun(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $run = $this->record('runs', $id);
        if (!in_array($run['state'], ['auth_blocked', 'reconciling', 'dispatching', 'cancel_requested'], true)) {
            throw new Problem(409, 'run_transition_invalid', 'Nur ein ungeklärter externer Lauf kann lokal aufgegeben werden.');
        }
        $run['state'] = 'abandoned';
        $run['status_reason'] = trim((string) $body['reason']);
        $run = $this->store->save('runs', $run, 'run.abandoned');

        return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function reportResult(string $id, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);
        $attempt = $this->attempt($run, (int) $body['attempt_no']);
        $task = $this->record('tasks', (string) $run['task_id']);
        $encoding = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
        $digest = hash('sha256', json_encode(CanonicalData::sorted($body), $encoding));
        $reportId = (string) $body['report_id'];
        $prior = $this->store->find('run_reports', $reportId);
        if (null !== $prior) {
            $expected = isset($prior['_reporter_id']) ? $digest : hash('sha256', json_encode($body, $encoding));
            if ($prior['run_id'] !== $id || ($prior['_reporter_id'] ?? $actor->id) !== $actor->id || ($prior['_digest'] ?? null) !== $expected) {
                throw new Problem(409, 'idempotency_conflict', 'Diese Report-ID wurde bereits mit anderem Inhalt verwendet.');
            }

            return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
        }
        $routeSelectionSupplied = array_key_exists('route_label_id', $body);
        $routeLabelId = $body['route_label_id'] ?? null;
        $reportOutcome = (string) $body['outcome'];
        $workflowOutcome = 'reported_success' === $reportOutcome ? 'accepted' : $reportOutcome;
        $selectedRoute = null;
        if ($routeSelectionSupplied) {
            foreach (($run['snapshot']['workflow_routes'] ?? []) as $route) {
                if (($route['on'] ?? null) === $workflowOutcome
                    && $this->sameRouteLabelId($route['route_label_id'] ?? null, $routeLabelId)) {
                    $selectedRoute = $route;
                    $routeLabelId = $route['route_label_id'] ?? null;
                    break;
                }
            }
            if (null === $selectedRoute) {
                throw new Problem(409, 'workflow_route_unavailable', 'Die gewählte Ergebnisroute gehört nicht zu den im Run eingefrorenen Möglichkeiten. Lies den Run erneut und verwende nur eine dort angebotene route_label_id oder den angebotenen Standardweg.');
            }
        }
        $snapshotCriteriaIds = [];
        foreach (($run['snapshot']['criteria'] ?? []) as $criterion) {
            if (isset($criterion['id']) && is_string($criterion['id'])) {
                $snapshotCriteriaIds[strtolower($criterion['id'])] = $criterion['id'];
            }
        }
        $artifacts = $body['artifacts'] ?? [];
        if (!is_array($artifacts) || !array_is_list($artifacts) || count($artifacts) > 100) {
            throw new Problem(422, 'validation_failed', 'Der Bericht darf höchstens 100 Nachweise als Liste enthalten.');
        }
        $artifactCriterionIds = [];
        foreach ($artifacts as $artifact) {
            $criterionIds = $artifact['criterion_ids'] ?? [];
            if (!is_array($criterionIds) || !array_is_list($criterionIds) || count($criterionIds) > 100) {
                throw new Problem(422, 'validation_failed', 'criterion_ids muss eine Liste mit höchstens 100 UUIDs sein.');
            }
            $seenCriterionIds = [];
            $normalizedCriterionIds = [];
            foreach ($criterionIds as $criterionId) {
                if (!is_string($criterionId) || !Uuid::isValid($criterionId)) {
                    throw new Problem(422, 'validation_failed', 'criterion_ids muss eindeutige UUIDs enthalten.');
                }
                $normalizedCriterionId = strtolower($criterionId);
                if (isset($seenCriterionIds[$normalizedCriterionId])) {
                    throw new Problem(422, 'validation_failed', 'criterion_ids muss eindeutige UUIDs enthalten.');
                }
                if (!isset($snapshotCriteriaIds[$normalizedCriterionId])) {
                    throw new Problem(409, 'criterion_not_found', 'Ein Nachweis verweist auf ein unbekanntes Kriterium im eingefrorenen Run-Snapshot.');
                }
                $seenCriterionIds[$normalizedCriterionId] = true;
                $normalizedCriterionIds[] = $snapshotCriteriaIds[$normalizedCriterionId];
            }
            $artifactCriterionIds[] = $normalizedCriterionIds;
        }
        $isCurrent = (int) $body['task_revision'] === (int) $run['snapshot']['task_revision']
            && (int) $body['task_revision'] === (int) $task['version']
            && $attempt['attempt_no'] === (int) $run['attempt_no']
            && !in_array($run['state'], ['succeeded', 'failed', 'cancelled', 'abandoned'], true);
        $linksById = [];
        foreach ($artifacts as $artifact) {
            foreach (($artifact['link_ids'] ?? []) as $linkId) {
                $linksById[$linkId] ??= $this->taskLink((string) $task['id'], (string) $linkId);
            }
        }
        $evidenceIds = [];
        foreach ($artifacts as $artifactIndex => $artifact) {
            $artifactLinks = $artifact['link_ids'] ?? [];
            $evidence = $this->store->save('evidence', [
                'project_id' => $run['project_id'], 'task_id' => $run['task_id'], 'run_id' => $id,
                'attempt_no' => $attempt['attempt_no'], 'task_revision' => (int) $body['task_revision'],
                'kind' => (string) $artifact['kind'], 'label' => trim((string) $artifact['label']),
                'text' => $artifact['text'] ?? null, 'link_ids' => $artifactLinks, 'review_status' => 'reported',
                'reported_by' => $actor->ref(),
                'reviewed_at' => null, 'reviewed_by' => null, 'review_reason' => null,
                'criterion_ids' => $artifactCriterionIds[$artifactIndex],
                'link_snapshot' => array_map(static fn (string $linkId): array => $linksById[$linkId], $artifactLinks),
            ], 'evidence.reported');
            $evidenceIds[] = $evidence['id'];
        }
        $reportRecord = [
            'id' => $reportId,
            'run_id' => $id,
            'attempt_no' => (int) $body['attempt_no'],
            'task_revision' => (int) $body['task_revision'],
            'outcome' => (string) $body['outcome'],
            'summary' => trim((string) $body['summary']),
            'evidence_ids' => $evidenceIds,
            'received_at' => $this->store->now(),
            'rejection_reason' => $isCurrent ? null : 'Die Meldung bezieht sich auf einen überholten oder beendeten Versuch.',
            'accepted_for_reconciliation' => $isCurrent,
            '_digest' => $digest,
            '_reporter_id' => $actor->id,
            '_open_questions' => array_values($body['open_questions'] ?? []),
        ];
        if ($routeSelectionSupplied) {
            $reportRecord['route_label_id'] = $routeLabelId;
            $reportRecord['route_label_name'] = $selectedRoute['route_label_name'] ?? null;
        }
        $this->store->save('run_reports', $reportRecord, 'run.result_reported');
        if ($isCurrent) {
            $run['state'] = 'result_reported';
            $run['result_digest'] = $digest;
            $run['report_ids'][] = $reportId;
            $run['evidence_ids'] = array_values(array_unique(array_merge($run['evidence_ids'] ?? [], $evidenceIds)));
            $run['status_reason'] = null;
            $this->store->save('runs', $run, 'run.result_reported');
            $this->store->enqueue('run.reconcile', ['run_id' => $id]);
        }

        return $this->store->accepted(['resource_type' => 'run', 'id' => $id], $id);
    }

    /** @return array<string, mixed> */
    private function getReport(string $runId, string $reportId, Actor $actor): array
    {
        $run = $this->record('runs', $runId);
        $actor->requireProject((string) $run['project_id']);
        $report = $this->record('run_reports', $reportId);
        if ($report['run_id'] !== $runId) {
            throw new Problem(404, 'resource_not_found', 'Der Ergebnisbericht gehört nicht zu diesem Lauf.');
        }

        return $report;
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listApprovals(array $p, Actor $actor): array
    {
        $items = $this->store->all('approvals');
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
            $items = array_values(array_filter($items, static fn (array $item): bool => $item['project_id'] === $p['project_id']));
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $item) use ($actor): bool {
                try {
                    $actor->requireProject((string) $item['project_id']);

                    return true;
                } catch (Problem) {
                    return false;
                }
            }));
        }
        foreach (['run_id', 'status'] as $filter) {
            if (isset($p[$filter])) {
                $items = array_values(array_filter($items, static fn (array $item): bool => $item[$filter] === $p[$filter]));
            }
        }
        usort($items, static fn (array $a, array $b): int => strcmp((string) $b['requested_at'], (string) $a['requested_at']));

        return $this->store->page($items, $p);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function requestApproval(string $runId, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $runId);
        $actor->requireProject((string) $run['project_id']);
        if (!in_array($run['state'], ['result_reported', 'verifying', 'succeeded'], true) || !is_string($run['result_digest'])) {
            throw new Problem(409, 'approval_result_missing', 'Für diesen Lauf liegt keine aktuelle Ergebnismeldung zur Entscheidung vor.');
        }
        if (!hash_equals($run['result_digest'], (string) $body['result_digest'])) {
            throw new Problem(409, 'approval_stale', 'Die Entscheidung muss sich auf den aktuellen Ergebnisstand beziehen.');
        }
        $report = $this->currentReport($run);
        $approval = $this->store->save('approvals', [
            'project_id' => $run['project_id'], 'run_id' => $runId, 'attempt_no' => $run['attempt_no'],
            'task_revision' => $report['task_revision'], 'result_digest' => $run['result_digest'],
            'status' => 'pending', 'requested_at' => $this->store->now(), 'decided_at' => null,
            'decided_by' => null, 'reason' => $body['reason'] ?? null, 'kind' => (string) $body['kind'],
        ], 'approval.requested');
        $this->openAttention($run['task_id'], $run['project_id'], 'approval_pending', 'owner');

        return $approval;
    }

    /** @return array<string, mixed> */
    private function getApproval(string $id, Actor $actor): array
    {
        $approval = $this->record('approvals', $id);
        $actor->requireProject((string) $approval['project_id']);

        return $approval;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function decideApproval(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $approval = $this->record('approvals', $id);
        if ('pending' !== $approval['status']) {
            throw new Problem(409, 'approval_not_pending', 'Diese Entscheidung wurde bereits aufgelöst.');
        }
        $run = $this->record('runs', (string) $approval['run_id']);
        $report = $this->currentReport($run);
        $task = $this->record('tasks', (string) $run['task_id']);
        if (!hash_equals((string) $approval['result_digest'], (string) $body['result_digest'])
            || !hash_equals((string) $run['result_digest'], (string) $body['result_digest'])
            || $report['task_revision'] !== $approval['task_revision']
            || (int) $task['version'] !== (int) $approval['task_revision']) {
            $approval['status'] = 'invalidated';
            $approval['decided_at'] = $this->store->now();
            $approval['decided_by'] = $actor->ref();
            $approval['reason'] = trim((string) ($body['reason'] ?? ''));

            $approval = $this->store->save('approvals', $approval, 'approval.invalidated');
            if (!$this->hasPendingApprovalForTask((string) $run['task_id'], (string) $run['project_id'])) {
                $this->resolveAttention((string) $run['task_id'], 'approval_pending');
            }

            return $approval;
        }
        $approval['status'] = (string) $body['decision'];
        $approval['decided_at'] = $this->store->now();
        $approval['decided_by'] = $actor->ref();
        $approval['reason'] = trim((string) $body['reason']);
        $approval = $this->store->save('approvals', $approval, 'approval.'.$approval['status']);
        if (!$this->hasPendingApprovalForTask((string) $run['task_id'], (string) $run['project_id'])) {
            $this->resolveAttention((string) $run['task_id'], 'approval_pending');
        }
        if ('approved' === $approval['status']) {
            $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
        } else {
            $run['state'] = 'failed';
            $run['status_reason'] = 'Die Eigentümerentscheidung hat den gemeldeten Phasenabschluss zurückgewiesen.';
            $this->store->save('runs', $run, 'run.phase_rejected');
        }

        return $approval;
    }

    private function hasPendingApprovalForTask(string $taskId, string $projectId): bool
    {
        foreach ($this->store->all('approvals', $projectId) as $approval) {
            if ('pending' !== ($approval['status'] ?? null)) {
                continue;
            }
            $run = $this->store->find('runs', (string) ($approval['run_id'] ?? ''));
            if (($run['task_id'] ?? null) === $taskId) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listWorkflows(array $p, Actor $actor): array
    {
        $items = $this->store->all('workflows');
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
            $items = array_values(array_filter($items, static fn (array $item): bool => $item['project_id'] === $p['project_id'] || null === $item['project_id']));
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $item) use ($actor): bool {
                if (null === $item['project_id']) {
                    return true;
                }
                try {
                    $actor->requireProject((string) $item['project_id']);

                    return true;
                } catch (Problem) {
                    return false;
                }
            }));
        }
        if (isset($p['enabled'])) {
            $enabled = filter_var($p['enabled'], FILTER_VALIDATE_BOOLEAN);
            $items = array_values(array_filter($items, static fn (array $item): bool => (bool) $item['enabled'] === $enabled));
        }
        usort($items, static fn (array $a, array $b): int => strcasecmp((string) $a['name'], (string) $b['name']));

        return $this->store->page($items, $p);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function writeWorkflow(?string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $projectId = $body['project_id'] ?? null;
        if (null !== $projectId) {
            $project = $this->record('projects', (string) $projectId);
            if (!empty($project['archived']) && !empty($body['enabled'])) {
                throw new Problem(409, 'project_archived', 'Ein archiviertes Projekt kann keine aktive Workflowroute erhalten.');
            }
        }
        $this->validateWorkflowDefinition($body);
        $existing = null === $id ? null : $this->record('workflows', $id);
        if (null !== $existing && ($existing['project_id'] ?? null) !== $projectId) {
            throw new Problem(409, 'workflow_scope_immutable', 'Der Projektbereich eines Workflows bleibt nach dem Anlegen unverändert.');
        }
        $definitionVersion = null === $existing ? 1 : (int) $existing['definition_version'] + 1;
        $workflow = array_replace($existing ?? [], $body, ['definition_version' => $definitionVersion]);
        $saved = $this->store->save('workflows', $workflow, null === $existing ? 'workflow.created' : 'workflow.definition_replaced');
        $this->store->save('workflow_versions', [
            'workflow_id' => $saved['id'], 'definition_version' => $definitionVersion,
            'project_id' => $saved['project_id'], 'name' => $saved['name'], 'preset_id' => $saved['preset_id'],
            'stages' => $saved['stages'], 'transitions' => $saved['transitions'], 'limits' => $saved['limits'], 'enabled' => $saved['enabled'],
        ], 'workflow.version_recorded');

        return $saved;
    }

    /** @return array<string, mixed> */
    private function getWorkflow(string $id, Actor $actor): array
    {
        $workflow = $this->record('workflows', $id);
        if (null !== $workflow['project_id']) {
            $actor->requireProject((string) $workflow['project_id']);
        }

        return $workflow;
    }

    /** @return array<string, mixed> */
    private function getWorkflowVersion(string $id, int $version, Actor $actor): array
    {
        $workflow = $this->getWorkflow($id, $actor);
        $record = null;
        foreach ($this->store->all('workflow_versions') as $candidate) {
            if ($candidate['workflow_id'] === $id && (int) $candidate['definition_version'] === $version) {
                $record = $candidate;
                break;
            }
        }
        if (null === $record || $version < 1 || $version > (int) $workflow['definition_version']) {
            throw new Problem(404, 'resource_not_found', 'Diese Workflowversion ist nicht vorhanden.');
        }

        return array_replace($record, ['id' => $id, 'version' => $version]);
    }

    /** @param array<string, mixed> $body */
    private function validateWorkflowDefinition(array $body): void
    {
        $this->workflowPolicy->validateDefinition($body);

        foreach (($body['stages'] ?? []) as $stage) {
            if (($stage['agent_profile_id'] ?? null) !== null) {
                $this->agentCatalog->profile((string) $stage['agent_profile_id']);
            }
        }
        $routeLabelIds = [];
        foreach (($body['transitions'] ?? []) as $transition) {
            if (is_string($transition['route_label_id'] ?? null)) {
                $routeLabelIds[strtolower($transition['route_label_id'])] = true;
            }
        }
        if ([] === $routeLabelIds) {
            return;
        }
        $projectId = $body['project_id'] ?? null;
        if (!is_string($projectId)) {
            throw new Problem(422, 'workflow_route_label_invalid', 'Benannte Abzweige benötigen einen projektgebundenen Workflow, da Themenlabels zu genau einem Projekt gehören.');
        }
        $topicLabels = [];
        foreach ($this->store->all('labels', $projectId) as $label) {
            if ('topic' === ($label['kind'] ?? null) && !empty($label['active'])) {
                $topicLabels[strtolower((string) $label['id'])] = true;
            }
        }
        if ([] !== array_diff_key($routeLabelIds, $topicLabels)) {
            throw new Problem(422, 'workflow_route_label_invalid', 'Jeder benannte Abzweig muss ein aktives Themenlabel dieses Projekts verwenden.');
        }
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function startWorkflow(string $taskId, array $body, Actor $actor): array
    {
        if (!$actor->owner && 'system' !== $actor->id) {
            throw new Problem(403, 'forbidden', 'Workflowinstanzen dürfen nur vom Eigentümer oder durch einen geprüften Automation-Trigger gestartet werden.');
        }
        $task = $this->record('tasks', $taskId);
        $actor->requireProject((string) $task['project_id']);
        if ((int) $task['version'] !== (int) $body['task_revision']) {
            throw new Problem(412, 'version_conflict', 'Die Aufgabe hat sich seit dem gelesenen Stand geändert.');
        }
        $this->assertTaskCanStart($task);
        $boardId = $body['board_id'] ?? null;
        if (null !== $boardId && !is_string($boardId)) {
            throw new Problem(422, 'validation_failed', 'Die Boardauswahl ist ungültig.');
        }
        $this->boardWorkflowPolicy->assertStartAllowed($task, $boardId, (string) $body['workflow_id'], (int) $body['definition_version'], $actor->owner);
        $workflow = $this->workflowDefinition((string) $body['workflow_id'], (int) $body['definition_version']);
        if (!$workflow['enabled'] || (null !== $workflow['project_id'] && $workflow['project_id'] !== $task['project_id'])) {
            throw new Problem(409, 'workflow_unavailable', 'Der Workflow ist deaktiviert oder gehört zu einem anderen Projekt.');
        }
        if ([] === $workflow['stages']) {
            throw new Problem(409, 'workflow_definition_invalid', 'Der Workflow enthält keine startbare Phase.');
        }
        foreach ($workflow['stages'] as $stage) {
            if ('manual' !== $stage['kind'] && null === $stage['agent_profile_id']) {
                throw new Problem(409, 'workflow_profile_required', sprintf('Weise der Phase „%s“ eine Agentrolle zu und starte die neue Workflowversion.', $stage['name']));
            }
        }
        foreach ($this->store->all('workflow_instances', (string) $task['project_id']) as $instance) {
            if ($instance['task_id'] === $taskId && in_array($instance['state'], ['queued', 'running', 'paused'], true)) {
                throw new Problem(409, 'workflow_already_active', 'Für diese Aufgabe läuft bereits ein Workflow.');
            }
        }
        $firstStage = $workflow['stages'][0];
        $this->assertConditions($firstStage['entry_conditions'] ?? [], $task, null);
        $instance = $this->store->save('workflow_instances', [
            'project_id' => $task['project_id'], 'task_id' => $taskId, 'workflow_id' => $workflow['id'],
            'definition_version' => $workflow['definition_version'], 'definition_snapshot' => $workflow,
            'state' => 'running', 'current_stage_id' => $firstStage['id'], 'run_ids' => [],
            'selected_transitions' => [], 'transition_history_status' => 'complete',
            'repair_round' => 0, 'pause_reason' => null, 'started_at' => $this->store->now(), 'deadline_at' => $this->deadline((int) $workflow['limits']['max_total_seconds']),
        ], 'workflow.started');
        if (null !== $firstStage['agent_profile_id']) {
            $this->store->enqueue('workflow.advance', ['instance_id' => $instance['id']]);
        }

        return $this->store->accepted(['resource_type' => 'workflow_instance', 'id' => $instance['id'], 'version' => $instance['version']]);
    }

    /** @return array<string, mixed> */
    private function getWorkflowInstance(string $id, Actor $actor): array
    {
        $instance = $this->record('workflow_instances', $id);
        $actor->requireProject((string) $instance['project_id']);

        return $instance;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function controlWorkflowInstance(string $id, array $body, Actor $actor): array
    {
        $instance = $this->record('workflow_instances', $id);
        $actor->requireProject((string) $instance['project_id']);
        if ('pause' === $body['action']) {
            if ('running' !== $instance['state']) {
                throw new Problem(409, 'workflow_transition_invalid', 'Nur ein laufender Workflow kann pausiert werden.');
            }
            $instance['state'] = 'paused';
            $instance['pause_reason'] = trim((string) $body['reason']);
            unset($instance['_paused_for_maintenance']);
            $instance = $this->store->save('workflow_instances', $instance, 'workflow.paused');
        } elseif (in_array($body['action'], ['resume', 'authorize_repair'], true)) {
            if ('paused' !== $instance['state']) {
                throw new Problem(409, 'workflow_transition_invalid', 'Nur ein pausierter Workflow kann fortgesetzt werden.');
            }
            $decisionRunId = $instance['repair_decision_run_id'] ?? null;
            if ('authorize_repair' === $body['action']) {
                $actor->requireOwner();
                $guidance = trim((string) $body['reason']);
                if (null === $decisionRunId || $decisionRunId !== end($instance['run_ids']) || '' === $guidance) {
                    throw new Problem(409, 'workflow_repair_decision_invalid', 'Eine zusätzliche Runde benötigt eine offene Überarbeitungsentscheidung und deine Begründung.');
                }
                $instance['_authorized_repair'] = ['run_id' => $decisionRunId, 'route' => $instance['_pending_repair_route'], 'reason' => $guidance];
                unset($instance['repair_decision_run_id'], $instance['repair_decision_stage_name'], $instance['_pending_repair_route']);
                $this->resolveAttention($instance['task_id'], 'workflow_repair_limit');
            } elseif (null !== $decisionRunId) {
                throw new Problem(409, 'workflow_repair_decision_required', 'Prüfe die Übergabe und entscheide über eine weitere Überarbeitungsrunde.');
            }
            $instance['state'] = 'running';
            $instance['pause_reason'] = null;
            unset($instance['_paused_for_maintenance']);
            $this->resolveAttention($instance['task_id'], 'workflow_transition_required');
            $this->resolveAttention($instance['task_id'], 'workflow_entry_condition_unmet');
            $instance = $this->store->save('workflow_instances', $instance, 'authorize_repair' === $body['action'] ? 'workflow.repair_authorized' : 'workflow.resumed');
            $this->store->enqueue('workflow.advance', ['instance_id' => $id]);
        } else {
            if (in_array($instance['state'], ['succeeded', 'failed', 'cancelled'], true)) {
                throw new Problem(409, 'workflow_transition_invalid', 'Dieser Workflow ist bereits beendet.');
            }
            unset($instance['repair_decision_run_id'], $instance['repair_decision_stage_name'], $instance['_pending_repair_route'], $instance['_authorized_repair']);
            $instance['state'] = 'cancelled';
            $instance['pause_reason'] = trim((string) $body['reason']);
            $instance = $this->store->save('workflow_instances', $instance, 'workflow.cancelled');
            foreach (['workflow_transition_required', 'workflow_entry_condition_unmet', 'workflow_repair_limit', 'workflow_duration_limit', 'workflow_profile_unavailable'] as $reason) {
                $this->resolveAttention($instance['task_id'], $reason);
            }
            foreach ($instance['run_ids'] as $runId) {
                $run = $this->store->find('runs', (string) $runId);
                if (null !== $run && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $this->requestCancellation($run, 'Der übergeordnete Workflow wurde abgebrochen.', 'run.cancel_requested');
                    $this->store->enqueue('run.cancel', ['run_id' => $runId]);
                }
            }
        }

        return $this->store->accepted(['resource_type' => 'workflow_instance', 'id' => $instance['id'], 'version' => $instance['version']]);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listWorkflowInstances(array $p, Actor $actor): array
    {
        $items = $this->store->all('workflow_instances', isset($p['project_id']) ? (string) $p['project_id'] : null);
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $instance) use ($actor): bool {
                try {
                    $actor->requireProject((string) $instance['project_id']);

                    return true;
                } catch (Problem) {
                    return false;
                }
            }));
        }
        if (isset($p['task_id'])) {
            $items = array_values(array_filter($items, static fn (array $item): bool => $item['task_id'] === $p['task_id']));
        }
        usort($items, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $this->store->page($items, $p);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listTriggers(array $p, Actor $actor): array
    {
        $items = $this->store->all('triggers', isset($p['project_id']) ? (string) $p['project_id'] : null);
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $item) use ($actor): bool {
                try {
                    $actor->requireProject((string) $item['project_id']);

                    return true;
                } catch (Problem) {
                    return false;
                }
            }));
        }
        if (isset($p['enabled'])) {
            $enabled = filter_var($p['enabled'], FILTER_VALIDATE_BOOLEAN);
            $items = array_values(array_filter($items, static fn (array $item): bool => (bool) $item['enabled'] === $enabled));
        }

        return $this->store->page($items, $p);
    }

    /** @return array<string, mixed> */
    private function getTrigger(string $id, Actor $actor): array
    {
        $trigger = $this->record('triggers', $id);
        $actor->requireProject((string) $trigger['project_id']);

        return $trigger;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function writeTrigger(?string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $project = $this->record('projects', (string) $body['project_id']);
        if (!empty($project['archived']) && !empty($body['enabled'])) {
            throw new Problem(409, 'project_archived', 'Ein Trigger in einem archivierten Projekt kann nicht aktiviert werden.');
        }
        $workflow = $this->record('workflows', (string) $body['workflow_id']);
        $workflowVersion = (int) ($body['definition_version'] ?? $workflow['definition_version']);
        $workflow = $this->workflowDefinition((string) $body['workflow_id'], $workflowVersion);
        if (!$workflow['enabled'] || (null !== $workflow['project_id'] && $workflow['project_id'] !== $project['id'])) {
            throw new Problem(409, 'workflow_unavailable', 'Der Trigger verweist auf keinen aktiven Workflow dieses Projekts.');
        }
        $spec = $body['spec'];
        if (($spec['type'] ?? null) === 'plugin') {
            $plugin = $this->store->find('plugins', (string) $spec['plugin_id']);
            if (null === $plugin || 'enabled' !== $plugin['state']) {
                throw new Problem(409, 'capability_unavailable', 'Der konfigurierte Plugin-Trigger ist nicht aktiviert.');
            }
        }
        $trigger = null === $id ? [] : $this->record('triggers', $id);
        if (null !== $id && $trigger['project_id'] !== $body['project_id']) {
            throw new Problem(409, 'trigger_scope_immutable', 'Der Projektbereich eines Triggers bleibt nach dem Anlegen unverändert.');
        }
        $trigger = array_replace($trigger, $body, [
            'definition_version' => $workflowVersion,
            'next_due_at' => ($body['enabled'] && ($spec['type'] ?? null) === 'schedule') ? $this->nextDue($spec['schedule']) : null,
            'last_fired_at' => $trigger['last_fired_at'] ?? null,
            'last_error' => null,
            'last_event_id' => (null !== $id && $trigger['enabled'] && $trigger['spec'] === $spec && isset($trigger['last_event_id'])) ? $trigger['last_event_id'] : $this->store->latestEventId(),
        ]);
        $saved = $this->store->save('triggers', $trigger, null === $id ? 'workflow.trigger_created' : 'workflow.trigger_updated');

        return $saved;
    }

    private function dispatch(string $runId): void
    {
        $run = $this->record('runs', $runId);
        if (!in_array($run['state'], ['queued', 'dispatching', 'reconciling', 'result_reported'], true)) {
            return;
        }
        $task = $this->record('tasks', (string) $run['task_id']);
        if ((int) $task['version'] !== (int) $run['snapshot']['task_revision']) {
            $run['state'] = 'failed';
            $run['status_reason'] = 'Die Aufgabe wurde nach Annahme des Auftrags geändert. Der eingefrorene Auftrag wurde nicht gestartet.';
            $this->store->save('runs', $run, 'run.dispatch_rejected_stale_task');
            $this->openAttention($run['task_id'], $run['project_id'], 'task_changed_before_dispatch', 'owner');

            return;
        }
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        if (null !== $attempt['external_thread_id']) {
            $this->observe($runId);

            return;
        }
        if (null !== $this->activeRecoveryGate()) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Die Wiederherstellungsinventur sperrt neue T3-Starts, bis der externe Ausgang ausdrücklich geklärt ist.';
            $this->store->save('runs', $run, 'run.recovery_inventory_manual_review_required');
            $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
            $this->removeObservationSchedule($runId);

            return;
        }
        if ($this->maintenanceMode()) {
            $current = $this->record('runs', $runId);
            $current['_maintenance_deferred'] = true;
            $current['status_reason'] = 'Der Wartungsmodus hält neue T3-Starts an. Der gespeicherte Auftrag bleibt für die spätere Fortsetzung erhalten.';
            $this->store->save('runs', $current, 'run.maintenance_dispatch_deferred');
            $this->removeObservationSchedule($runId);

            return;
        }
        if (!$this->providerEnabledForRun($run, $attempt)) {
            $current = $this->record('runs', $runId);
            $current['_provider_deferred'] = true;
            $current['status_reason'] = 'Der registrierte T3-Provider wird stillgelegt. Der gespeicherte Start wird fortgesetzt, sobald der Provider wieder aktiviert ist.';
            $this->store->save('runs', $current, 'run.bridge_provider_draining');
            $this->removeObservationSchedule($runId);

            return;
        }
        $connection = $this->agentCatalog->connection((string) $attempt['connection_id']);
        if ('valid' !== $connection['auth_status']) {
            $run['state'] = 'auth_blocked';
            $run['status_reason'] = 'Die T3-Anmeldung fehlt oder ist abgelaufen. Melde dich erneut bei T3 an.';
            $this->store->save('runs', $run, 'run.auth_blocked');
            $this->openAttention($run['task_id'], $run['project_id'], 'auth_required', 'owner');

            return;
        }
        if ((int) ($attempt['auth_epoch'] ?? 0) !== (int) $connection['auth_epoch']) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Seit der ungeklärten T3-Annahme wurde eine neue OAuth-Session eingerichtet. Der alte Start darf nicht in einem anderen T3-Namespace wiederholt werden.';
            $this->store->save('runs', $run, 'run.new_auth_namespace_reconciliation_required');
            $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
            $this->removeObservationSchedule($runId);

            return;
        }
        $binding = $this->agentCatalog->binding((string) $run['snapshot']['project_binding_id']);
        $payload = $run['_dispatch_request'] ?? null;
        if (!is_array($payload)) {
            $template = $run['_prompt_template'] ?? $this->agentCatalog->profile((string) $run['snapshot']['agent_profile_id'])['prompt_template'] ?? '';
            $message = $this->dispatchMessage($run, (string) $task['key'], (string) $template);
            $payload = [
                'projectId' => (string) $binding['external_project_id'],
                'title' => 'Falkenwarte '.$task['key'].' · Versuch '.$attempt['attempt_no'],
                'message' => $message,
                'clientRequestId' => (string) $attempt['dispatch_id'],
            ];
            $target = $run['snapshot']['execution_target'];
            if (($target['mode'] ?? null) === 't3_reference_thread') {
                try {
                    $reference = $this->bridge->readThread($connection, $this->connectionToken($connection), (string) $target['reference_thread_id']);
                } catch (T3BridgeException $exception) {
                    $this->setRunBridgeFailure($run, $exception);

                    return;
                }
                if (($reference['projectId'] ?? $reference['project_id'] ?? null) !== $binding['external_project_id']) {
                    $run['state'] = 'auth_blocked';
                    $run['status_reason'] = 'Der Referenzthread gehört nicht zum gebundenen T3-Projekt.';
                    $this->store->save('runs', $run, 'run.reference_target_invalid');
                    $this->openAttention($run['task_id'], $run['project_id'], 'reference_target_invalid', 'owner');

                    return;
                }
                $modelSelection = $reference['modelSelection'] ?? null;
                if (!is_array($modelSelection)
                    || !is_string($modelSelection['instanceId'] ?? null)
                    || '' === trim($modelSelection['instanceId'])
                    || !is_string($modelSelection['model'] ?? null)
                    || '' === trim($modelSelection['model'])
                    || $modelSelection['model'] !== trim($modelSelection['model'])) {
                    $run['state'] = 'auth_blocked';
                    $run['status_reason'] = 'T3 liefert für den Referenzthread keine belegten Provider- und Modellreferenzen.';
                    $this->store->save('runs', $run, 'run.reference_target_invalid');
                    $this->openAttention($run['task_id'], $run['project_id'], 'reference_target_invalid', 'owner');

                    return;
                }
                $payload['modelSelection'] = ['instanceId' => $modelSelection['instanceId'], 'model' => $modelSelection['model']];
            } elseif (($target['mode'] ?? null) === 't3_provider_instance') {
                $instanceId = $target['provider_instance_id'] ?? null;
                $modelId = $target['model'] ?? null;
                $expectedRunVersion = (int) $run['version'];
                $expectedAttemptNo = (int) $attempt['attempt_no'];
                $expectedDispatchId = (string) $attempt['dispatch_id'];
                if (!is_string($instanceId) || '' === $instanceId || !is_string($modelId) || '' === $modelId) {
                    $this->failUnstartedProviderSelection(
                        $runId,
                        $expectedRunVersion,
                        $expectedAttemptNo,
                        $expectedDispatchId,
                    );

                    return;
                }
                $hasReasoningChoice = array_key_exists('reasoning', $target);
                $reasoningChoice = $target['reasoning'] ?? null;
                $reasoningOptionId = is_array($reasoningChoice) ? ($reasoningChoice['option_id'] ?? null) : null;
                $reasoningValue = is_array($reasoningChoice) ? ($reasoningChoice['value'] ?? null) : null;
                if ($hasReasoningChoice && (
                    !is_string($reasoningOptionId)
                    || '' === trim($reasoningOptionId)
                    || $reasoningOptionId !== trim($reasoningOptionId)
                    || mb_strlen($reasoningOptionId) > 128
                    || !is_string($reasoningValue)
                    || '' === trim($reasoningValue)
                    || $reasoningValue !== trim($reasoningValue)
                    || mb_strlen($reasoningValue) > 128
                )) {
                    $this->failUnstartedProviderSelection(
                        $runId,
                        $expectedRunVersion,
                        $expectedAttemptNo,
                        $expectedDispatchId,
                        'Die Reasoning-Auswahl der Agentrolle ist ungültig. Passe die Agentrolle an und starte einen neuen Auftrag.',
                    );

                    return;
                }

                try {
                    $token = $this->connectionToken($connection);
                    $capabilities = $this->bridge->capabilities($connection, $token);
                    $providers = $capabilities['providers'] ?? [];
                    $selection = $this->providerSelectionStatus($instanceId, $modelId, $providers);
                    if (!$selection['model_available'] && $selection['may_search']) {
                        $capabilities = $this->bridge->capabilities($connection, $token, mb_substr($modelId, 0, 200));
                        $providers = $capabilities['providers'] ?? [];
                        $selection = $this->providerSelectionStatus($instanceId, $modelId, $providers);
                    }
                } catch (T3BridgeException $exception) {
                    $currentRun = $this->currentProviderDispatchRun(
                        $runId,
                        $expectedRunVersion,
                        $expectedAttemptNo,
                        $expectedDispatchId,
                    );
                    if (null === $currentRun) {
                        return;
                    }
                    $this->setRunBridgeFailure($currentRun, $exception);
                    if (!$exception->authenticationFailure) {
                        throw $exception;
                    }

                    return;
                }

                $currentRun = $this->currentProviderDispatchRun(
                    $runId,
                    $expectedRunVersion,
                    $expectedAttemptNo,
                    $expectedDispatchId,
                );
                if (null === $currentRun) {
                    return;
                }
                if (!$selection['model_available']) {
                    $this->failUnstartedProviderSelection(
                        $runId,
                        $expectedRunVersion,
                        $expectedAttemptNo,
                        $expectedDispatchId,
                    );

                    return;
                }

                if ($hasReasoningChoice && !$this->providerModelSupportsReasoning(
                    $selection['reasoning'] ?? null,
                    (string) $reasoningOptionId,
                    (string) $reasoningValue,
                )) {
                    $this->failUnstartedProviderSelection(
                        $runId,
                        $expectedRunVersion,
                        $expectedAttemptNo,
                        $expectedDispatchId,
                        'Die gewählte Reasoning-Stufe ist für das bestätigte T3-Modell nicht mehr verfügbar. Passe die Agentrolle an und starte einen neuen Auftrag.',
                    );

                    return;
                }

                $run = $currentRun;
                $attempt = $this->attempt($run, $expectedAttemptNo);
                $payload['modelSelection'] = ['instanceId' => $instanceId, 'model' => $modelId];
                if ($hasReasoningChoice) {
                    $payload['modelSelection']['options'] = [[
                        'id' => $reasoningOptionId,
                        'value' => $reasoningValue,
                    ]];
                }
            }
            $dispatchRequest = DispatchRequest::fromPayload($payload);
            $payload = $dispatchRequest->payload;
            $attempt['request_sha256'] = $dispatchRequest->sha256();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $run['_dispatch_request'] = $payload;
            $run['state'] = 'dispatching';
            $run['status_reason'] = null;
            $run = $this->store->save('runs', $run, 'run.dispatch_prepared');
        }
        $dispatchRequest = DispatchRequest::fromPayload($payload);
        if (!hash_equals((string) $attempt['request_sha256'], $dispatchRequest->sha256())) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Der gespeicherte T3-Dispatch stimmt nicht mehr mit seinem unveränderlichen Requesthash überein.';
            $this->store->save('runs', $run, 'run.dispatch_payload_conflict');
            $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');

            return;
        }
        $payload = $dispatchRequest->payload;
        $run['state'] = 'dispatching';
        $this->store->save('runs', $run, 'run.dispatch_attempted');

        try {
            $result = $this->bridge->launch($connection, $this->connectionToken($connection), $payload);
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }

            return;
        }
        $threadId = $result['threadId'] ?? $result['thread_id'] ?? null;
        if (!is_string($threadId) || '' === $threadId) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'T3 hat die Anfrage ohne gültige Threadreferenz beantwortet.';
            $this->store->save('runs', $run, 'run.launch_response_invalid');
            throw new T3BridgeException('T3 hat keine gültige Thread-ID geliefert.');
        }
        if (($result['projectId'] ?? $result['project_id'] ?? $binding['external_project_id']) !== $binding['external_project_id']) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Die T3-Antwort verweist auf ein anderes Projekt als der eingefrorene Dispatch.';
            $this->store->save('runs', $run, 'run.launch_response_mismatch');
            throw new T3BridgeException('Die T3-Antwort stimmt nicht mit dem ProjectBinding überein.');
        }
        $current = $this->record('runs', $runId);
        $currentAttempt = $this->attempt($current, (int) $attempt['attempt_no']);
        $currentAttempt['external_thread_id'] = $threadId;
        $currentAttempt['external_dispatch_run_id'] = isset($result['runId']) ? (string) $result['runId'] : (isset($result['run_id']) ? (string) $result['run_id'] : null);
        $currentAttempt['remote_status'] = (string) ($result['status'] ?? 'unknown');
        $currentAttempt['started_at'] = $this->store->now();
        $attempts = $current['attempts'];
        $attempts[$currentAttempt['attempt_no'] - 1] = $currentAttempt;
        $current['attempts'] = $attempts;
        $current['state'] = !empty($current['report_ids']) ? 'result_reported' : 'running';
        $current['status_reason'] = null;
        $run = $this->store->save('runs', $current, 'run.external_launch_accepted');
        $this->resolveAttention($run['task_id'], 'auth_required');
        $this->scheduleObservation($runId);
        $this->store->enqueue('run.observe', ['run_id' => $runId]);
    }

    /** @param list<array<string, mixed>> $providers @return array{model_available: bool, may_search: bool, reasoning?: array<string, mixed>} */
    private function providerSelectionStatus(string $instanceId, string $modelId, array $providers): array
    {
        foreach ($providers as $provider) {
            if (($provider['provider_instance_id'] ?? null) !== $instanceId) {
                continue;
            }

            $available = true === ($provider['available'] ?? false);
            $modelAvailable = false;
            $reasoning = null;
            foreach (($provider['models'] ?? []) as $model) {
                if (is_array($model) && ($model['id'] ?? null) === $modelId) {
                    $modelAvailable = true;
                    $reasoning = is_array($model['reasoning'] ?? null) ? $model['reasoning'] : null;
                    break;
                }
            }
            $omittedModels = $provider['omitted_models'] ?? null;

            $status = [
                'model_available' => $available && $modelAvailable,
                // T3 omits the field when its complete catalog contains no more models.
                'may_search' => $available && is_int($omittedModels) && $omittedModels > 0,
            ];
            if (null !== $reasoning) {
                $status['reasoning'] = $reasoning;
            }

            return $status;
        }

        return ['model_available' => false, 'may_search' => false];
    }

    private function providerModelSupportsReasoning(mixed $reasoning, string $optionId, string $value): bool
    {
        return is_array($reasoning)
            && ($reasoning['option_id'] ?? null) === $optionId
            && is_array($reasoning['values'] ?? null)
            && in_array($value, $reasoning['values'], true);
    }

    /** @return array<string, mixed>|null */
    private function currentProviderDispatchRun(
        string $runId,
        int $expectedRunVersion,
        int $expectedAttemptNo,
        string $expectedDispatchId,
    ): ?array {
        $run = $this->store->find('runs', $runId);
        if (null === $run
            || (int) $run['version'] !== $expectedRunVersion
            || (int) $run['attempt_no'] !== $expectedAttemptNo
            || !in_array($run['state'], ['queued', 'dispatching', 'reconciling', 'result_reported'], true)
            || is_array($run['_dispatch_request'] ?? null)) {
            return null;
        }

        $attempt = $this->attempt($run, $expectedAttemptNo);
        if (($attempt['dispatch_id'] ?? null) !== $expectedDispatchId || null !== ($attempt['external_thread_id'] ?? null)) {
            return null;
        }

        return $run;
    }

    private function failUnstartedProviderSelection(
        string $runId,
        int $expectedRunVersion,
        int $expectedAttemptNo,
        string $expectedDispatchId,
        ?string $statusReason = null,
    ): void {
        $this->store->atomic(function () use ($runId, $expectedRunVersion, $expectedAttemptNo, $expectedDispatchId, $statusReason): void {
            $run = $this->currentProviderDispatchRun($runId, $expectedRunVersion, $expectedAttemptNo, $expectedDispatchId);
            if (null === $run) {
                return;
            }

            $run['state'] = 'failed';
            $run['status_reason'] = $statusReason ?? 'Die gewählte T3-Providerinstanz oder das Modell ist in der gebundenen Verbindung nicht mehr verfügbar. Passe die Agentrolle an und starte einen neuen Auftrag.';
            $attempt = $this->attempt($run, $expectedAttemptNo);
            $attempt['ended_at'] ??= $this->store->now();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $run = $this->store->save('runs', $run, 'run.dispatch_rejected_provider_selection');
            $this->openAttention($run['task_id'], $run['project_id'], 'run_failed', 'owner');
            $this->removeObservationSchedule((string) $run['id']);
            if (null !== $run['workflow_instance_id']) {
                $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
            }
        });
    }

    private function observe(string $runId): void
    {
        $run = $this->record('runs', $runId);
        if (!in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
            return;
        }
        $cancelIntent = $run['_cancel_intent'] ?? null;
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        if (
            is_array($cancelIntent)
            && 'requested' === ($cancelIntent['state'] ?? null)
            && null !== $attempt['external_thread_id']
        ) {
            return;
        }
        if (
            in_array($run['state'], ['verifying', 'result_reported'], true)
            && !is_array($cancelIntent)
            && null !== ($attempt['ended_at'] ?? null)
            && in_array(strtolower((string) $attempt['remote_status']), ['completed', 'succeeded', 'success'], true)
        ) {
            // T3 has settled this attempt. Only local reports, evidence and decisions can advance it.
            $this->store->atomic(function () use ($runId, $run): void {
                $current = $this->record('runs', $runId);
                if ($current['version'] === $run['version']) {
                    $this->completePhaseIfAllowed($current);
                }
            });

            return;
        }
        if (null === $attempt['external_thread_id']) {
            if (is_array($cancelIntent) && 'requested' === ($cancelIntent['state'] ?? null)) {
                $run['_cancel_requested_unknown_external'] = true;
                $run['_cancel_intent']['state'] = 'unknown_external';
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'Der externe Startausgang ist ungeklärt. Abbruchwirkung wird vor einer Freigabe des Ausführungsplatzes abgeglichen.';
                $this->store->save('runs', $run, 'run.cancel_reconciliation_required');
                $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                $this->store->enqueue('run.reconcile', ['run_id' => $runId]);
                $this->removeObservationSchedule($runId);

                return;
            }
            if (!empty($run['_cancel_requested_unknown_external'])) {
                // Replaying a keyed launch could start work the owner already asked to stop.
                $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                $this->removeObservationSchedule($runId);

                return;
            }
            if (in_array($run['state'], ['queued', 'dispatching'], true)) {
                return;
            }
            $connection = $this->agentCatalog->connection((string) $attempt['connection_id']);
            if (null !== $this->activeRecoveryGate()) {
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'Der externe Start besitzt keine bestätigte T3-Threadreferenz. Die Wiederherstellungsinventur benötigt eine ausdrückliche Eigentümerklärung.';
                $this->store->save('runs', $run, 'run.recovery_inventory_manual_review_required');
                $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                $this->removeObservationSchedule($runId);

                return;
            }
            if ((int) ($attempt['auth_epoch'] ?? 0) !== (int) $connection['auth_epoch']) {
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'Seit der ungeklärten T3-Annahme wurde eine neue OAuth-Session eingerichtet. Der alte Start darf nicht in einem anderen T3-Namespace wiederholt werden.';
                $this->store->save('runs', $run, 'run.new_auth_namespace_reconciliation_required');
                $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                $this->removeObservationSchedule($runId);

                return;
            }
            $this->store->enqueue('run.dispatch', ['run_id' => $runId]);

            return;
        }
        $connection = $this->agentCatalog->connection((string) $attempt['connection_id']);
        try {
            $remote = $this->bridge->readThread(
                $connection,
                $this->connectionToken($connection),
                (string) $attempt['external_thread_id'],
                isset($attempt['external_dispatch_run_id']) ? (string) $attempt['external_dispatch_run_id'] : null,
            );
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }

            return;
        }
        $readCancelIntentId = is_array($cancelIntent) ? ($cancelIntent['id'] ?? null) : null;
        $readCancelIntentState = is_array($cancelIntent) ? ($cancelIntent['state'] ?? null) : null;
        $readCancelStatus = is_array($cancelIntent) ? ($cancelIntent['interrupt_status'] ?? null) : null;
        $this->store->atomic(function () use ($runId, $remote, $readCancelIntentId, $readCancelIntentState, $readCancelStatus): void {
            $run = $this->record('runs', $runId);
            if (!in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                return;
            }
            $currentCancelIntent = $run['_cancel_intent'] ?? null;
            if (
                (is_array($currentCancelIntent) ? ($currentCancelIntent['id'] ?? null) : null) !== $readCancelIntentId
                || (is_array($currentCancelIntent) ? ($currentCancelIntent['state'] ?? null) : null) !== $readCancelIntentState
                || (is_array($currentCancelIntent) ? ($currentCancelIntent['interrupt_status'] ?? null) : null) !== $readCancelStatus
            ) {
                // The external read began before a new cancellation request or before its interrupt was sent.
                return;
            }
            $awaitingCancelConfirmation = is_array($currentCancelIntent) && 'awaiting_confirmation' === ($currentCancelIntent['state'] ?? null);
            $attempt = $this->attempt($run, (int) $run['attempt_no']);
            $observedStatus = (string) ($remote['status'] ?? $remote['run']['status'] ?? 'unknown');
            $interruptConfirmedCancellation = $awaitingCancelConfirmation && in_array($readCancelStatus, ['cancelled', 'canceled', 'interrupted'], true);
            $attempt['remote_status'] = $interruptConfirmedCancellation ? $readCancelStatus : $observedStatus;
            $attempt['external_observed_run_id'] = isset($remote['runId'])
                ? (string) $remote['runId']
                : (isset($remote['run']['id'])
                    ? (string) $remote['run']['id']
                    : $attempt['external_dispatch_run_id']);
            $attempt['last_observed_at'] = $this->store->now();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $run['last_observed_at'] = $attempt['last_observed_at'];
            $run = $this->store->save('runs', $run, 'run.external_observed');
            $status = strtolower((string) $attempt['remote_status']);
            $remoteStillActive = in_array($status, [
                'running', 'in_progress', 'streaming', 'queued', 'pending', 'accepted',
                'cancel_requested', 'interrupt_requested', 'waiting_input', 'needs_input', 'input_required',
            ], true);
            if ($awaitingCancelConfirmation && $remoteStillActive) {
                $run['state'] = 'cancel_requested';
                $run['status_reason'] = 'T3 hat den angeforderten Abbruch noch nicht bestätigt.';
            } elseif (in_array($status, ['running', 'in_progress', 'streaming'], true)) {
                $run['state'] = 'running';
                $run['status_reason'] = null;
            } elseif (in_array($status, ['queued', 'pending', 'accepted'], true)) {
                $run['state'] = 'queued';
                $run['status_reason'] = null;
            } elseif (in_array($status, ['waiting_input', 'needs_input', 'input_required'], true)) {
                $run['state'] = 'waiting_input';
                $pending = $remote['pendingInput'] ?? $remote['pending_input'] ?? null;
                if (is_array($pending)) {
                    $run['pending_input'] = $this->normalizePendingInput($pending);
                    $address = $run['pending_input'];
                    if ('permission' === $address['kind']) {
                        $this->openAttention($run['task_id'], $run['project_id'], 'run_permission_in_t3', 'owner');
                    } elseif ('owner' === $address['addressed_to']) {
                        $this->openAttention($run['task_id'], $run['project_id'], 'run_input_owner', 'owner');
                    } else {
                        $this->openAttention($run['task_id'], $run['project_id'], 'agent_question', 'requester');
                    }
                }
                $run['status_reason'] = 'T3 wartet auf eine Eingabe. Berechtigungsanfragen müssen in T3 beantwortet werden.';
            } elseif (in_array($status, ['completed', 'succeeded', 'success'], true)) {
                unset($run['_cancel_intent']);
                $run['state'] = 'verifying';
                $attempt['ended_at'] = $this->store->now();
                $attempts = $run['attempts'];
                $attempts[$attempt['attempt_no'] - 1] = $attempt;
                $run['attempts'] = $attempts;
                $run['status_reason'] = 'T3 hat den Lauf beendet. Die passende Agentmeldung und die Phasenregeln werden noch abgeglichen.';
            } elseif (in_array($status, ['failed', 'error'], true)) {
                unset($run['_cancel_intent']);
                $run['state'] = 'failed';
                $run['status_reason'] = 'T3 hat einen Fehler gemeldet.';
                $attempt['ended_at'] = $this->store->now();
                $attempts = $run['attempts'];
                $attempts[$attempt['attempt_no'] - 1] = $attempt;
                $run['attempts'] = $attempts;
            } elseif (in_array($status, ['cancelled', 'canceled', 'interrupted'], true)) {
                unset($run['_cancel_intent']);
                $run['state'] = 'cancelled';
                $run['status_reason'] = 'T3 hat den Abbruch bestätigt.';
                $attempt['ended_at'] = $this->store->now();
                $attempts = $run['attempts'];
                $attempts[$attempt['attempt_no'] - 1] = $attempt;
                $run['attempts'] = $attempts;
            } else {
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'T3 meldet einen unbekannten Zustand. Der Ausführungsplatz bleibt bis zur Klärung belegt.';
                $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
            }
            if ('waiting_input' !== $run['state']) {
                foreach (['run_permission_in_t3', 'run_input_owner', 'agent_question'] as $reason) {
                    $this->resolveAttention($run['task_id'], $reason);
                }
            }
            $this->resolveAttention($run['task_id'], 'auth_required');
            $run = $this->store->save('runs', $run, 'run.state_observed');
            if ('verifying' === $run['state']) {
                $this->completePhaseIfAllowed($run);
            } elseif (in_array($run['state'], ['failed', 'cancelled'], true) && null !== $run['workflow_instance_id']) {
                $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
            }
            $current = $this->store->find('runs', $runId);
            if (null !== $current && in_array($current['state'], self::ACTIVE_RUN_STATES, true)) {
                $this->scheduleObservation($runId);
            } else {
                $this->removeObservationSchedule($runId);
            }
        });
    }

    private function performCancel(string $runId): void
    {
        $run = $this->record('runs', $runId);
        if (!in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
            return;
        }
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        $cancelIntent = $run['_cancel_intent'] ?? null;
        if (!is_array($cancelIntent) || (int) ($cancelIntent['attempt_no'] ?? 0) !== (int) $run['attempt_no']) {
            $run = $this->requestCancellation($run, (string) ($run['status_reason'] ?? 'T3-Abbruch angefordert.'), 'run.cancel_intent_recorded');
            $cancelIntent = $run['_cancel_intent'];
        }
        if ('awaiting_confirmation' === ($cancelIntent['state'] ?? null)) {
            return;
        }
        if (null === $attempt['external_thread_id'] || null === $attempt['external_dispatch_run_id']) {
            $run['_cancel_requested_unknown_external'] = true;
            $run['_cancel_intent']['state'] = 'unknown_external';
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Der externe Startausgang ist ungeklärt. Abbruchwirkung wird vor einer Freigabe des Ausführungsplatzes abgeglichen.';
            $this->store->save('runs', $run, 'run.cancel_reconciliation_required');
            $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
            $this->store->enqueue('run.reconcile', ['run_id' => $runId]);

            return;
        }
        if (null !== $this->activeRecoveryGate()) {
            $run['_provider_deferred_action'] = 'cancel';
            $run['status_reason'] = 'Die Wiederherstellungsinventur hält externe Abbrüche an. Der bestätigbare Abbruch wird nach Freigabe fortgesetzt.';
            $this->store->save('runs', $run, 'run.cancel_deferred_for_recovery');

            return;
        }
        if (!$this->canSendCancellation($run, $attempt)) {
            $run['_provider_deferred_action'] = 'cancel';
            $run['status_reason'] = 'Der registrierte T3-Provider wird stillgelegt. Der Abbruch wird fortgesetzt, sobald der Provider wieder aktiviert ist.';
            $this->store->save('runs', $run, 'run.bridge_cancel_deferred');

            return;
        }
        $connection = $this->agentCatalog->connection((string) $attempt['connection_id']);
        try {
            $interrupt = $this->bridge->interrupt($connection, $this->connectionToken($connection), (string) $attempt['external_thread_id'], (string) $attempt['external_dispatch_run_id']);
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }

            return;
        }
        $interruptStatus = strtolower((string) ($interrupt['status'] ?? ''));
        $interruptMatchesAttempt = ($interrupt['threadId'] ?? null) === $attempt['external_thread_id']
            && ($interrupt['runId'] ?? null) === $attempt['external_dispatch_run_id'];
        $startedIntentState = $cancelIntent['state'] ?? null;
        $this->store->atomic(function () use ($runId, $attempt, $cancelIntent, $startedIntentState, $interruptStatus, $interruptMatchesAttempt): void {
            $current = $this->record('runs', $runId);
            if (!in_array($current['state'], self::ACTIVE_RUN_STATES, true)) {
                return;
            }
            $currentIntent = $current['_cancel_intent'] ?? null;
            if (!is_array($currentIntent) || ($currentIntent['id'] ?? null) !== ($cancelIntent['id'] ?? null)) {
                return;
            }
            $currentAttempt = $this->attempt($current, (int) $current['attempt_no']);
            if ($currentAttempt['external_thread_id'] !== $attempt['external_thread_id']
                || $currentAttempt['external_dispatch_run_id'] !== $attempt['external_dispatch_run_id']) {
                return;
            }
            $replyConfirmsCancellation = $interruptMatchesAttempt && in_array($interruptStatus, ['cancelled', 'canceled', 'interrupted'], true);
            if ('awaiting_confirmation' === ($currentIntent['state'] ?? null)) {
                $alreadyConfirmed = in_array($currentIntent['interrupt_status'] ?? null, ['cancelled', 'canceled', 'interrupted'], true);
                if (!$alreadyConfirmed && $replyConfirmsCancellation) {
                    $current['_cancel_intent']['interrupt_status'] = $interruptStatus;
                }
            } elseif (($currentIntent['state'] ?? null) === $startedIntentState) {
                $current['_cancel_intent']['state'] = 'awaiting_confirmation';
                $current['_cancel_intent']['interrupt_status'] = $interruptMatchesAttempt && '' !== $interruptStatus ? $interruptStatus : null;
                $current['_cancel_intent']['interrupt_sent_at'] = $this->store->now();
                $current['state'] = 'cancel_requested';
            } else {
                return;
            }
            $this->store->save('runs', $current, 'run.cancel_awaiting_confirmation');
            $this->store->enqueue('run.observe', ['run_id' => $runId]);
        });
    }

    /** @param array<string, mixed> $run @return array<string, mixed> */
    private function requestCancellation(array $run, string $reason, string $event): array
    {
        $attemptNo = (int) $run['attempt_no'];
        $intent = $run['_cancel_intent'] ?? null;
        if (!is_array($intent) || (int) ($intent['attempt_no'] ?? 0) !== $attemptNo) {
            $run['_cancel_intent'] = [
                'id' => $this->store->id(),
                'attempt_no' => $attemptNo,
                'state' => 'requested',
            ];
        }
        $run['state'] = 'cancel_requested';
        $run['status_reason'] = $reason;

        return $this->store->save('runs', $run, $event);
    }

    /** Request confirmed T3 cancellation for active runs owned by a draining provider. */
    public function requestCancelForProvider(string $providerId, string $reason): int
    {
        if (!$this->agentCatalog->providerAllowsDrainCancellation($providerId)) {
            return 0;
        }

        return $this->store->atomic(function () use ($providerId, $reason): int {
            $requested = 0;
            foreach ($this->store->all('runs') as $run) {
                if (($run['snapshot']['bridge_plugin_id'] ?? null) !== $providerId
                    || !in_array($run['state'] ?? null, self::ACTIVE_RUN_STATES, true)) {
                    continue;
                }
                if (!empty($run['_provider_drain_cancel_requested'])) {
                    continue;
                }

                $run['_provider_drain_cancel_requested'] = true;
                $this->requestCancellation($run, $reason, 'run.provider_drain_cancel_requested');
                $this->store->enqueue('run.cancel', ['run_id' => $run['id']]);
                ++$requested;
            }

            return $requested;
        });
    }

    private function performInput(string $runId, string $inputId): void
    {
        $run = $this->record('runs', $runId);
        $input = $this->record('run_inputs', $inputId);
        if ($input['run_id'] !== $runId || 'queued' !== $input['status']) {
            return;
        }
        $attempt = $this->attempt($run, (int) $input['attempt_no']);
        if (null === $attempt['external_thread_id']) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Die T3-Threadzuordnung fehlt. Die Eingabe bleibt dauerhaft gespeichert.';
            $this->store->save('runs', $run, 'run.input_reconciliation_required');
            $this->store->enqueue('run.reconcile', ['run_id' => $runId]);
            throw new T3BridgeException('Es gibt noch keine bestätigte T3-Threadzuordnung für die Eingabe.');
        }
        $body = $input['body'];
        $message = ($body['type'] ?? null) === 'message'
            ? (string) $body['message']
            : "Antwort auf die Falkenwarte-Rückfrage:\n".implode("\n", array_map(static fn (array $answer): string => $answer['question_id'].': '.implode('; ', $answer['values']), $body['answers']));
        $connection = $this->agentCatalog->connection((string) $attempt['connection_id']);
        if (!$this->providerEnabledForRun($run, $attempt)) {
            $input['_provider_deferred'] = true;
            $this->store->save('run_inputs', $input, 'run.bridge_input_deferred');

            return;
        }
        try {
            $result = $this->bridge->send($connection, $this->connectionToken($connection), (string) $attempt['external_thread_id'], $message, (string) $input['id']);
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }

            return;
        }
        $input['status'] = 'sent';
        $input['sent_at'] = $this->store->now();
        $input['external_message_id'] = $result['messageId'] ?? $result['message_id'] ?? null;
        $this->store->save('run_inputs', $input, 'run.input_sent');
        if (isset($result['runId']) || isset($result['run_id'])) {
            $attempt['external_dispatch_run_id'] = (string) ($result['runId'] ?? $result['run_id']);
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
        }
        $run['state'] = 'running';
        $run['pending_input'] = null;
        $run['status_reason'] = null;
        $this->store->save('runs', $run, 'run.input_delivered');
        foreach (['run_permission_in_t3', 'run_input_owner', 'agent_question'] as $reason) {
            $this->resolveAttention($run['task_id'], $reason);
        }
        $this->store->enqueue('run.observe', ['run_id' => $runId]);
    }

    private function completePhaseIfAllowed(array $run): void
    {
        $report = $this->currentReport($run, false);
        $policy = $run['snapshot']['run_completion_policy'] ?? $this->defaultRunPolicy();
        $task = $this->record('tasks', (string) $run['task_id']);
        $evidence = array_values(array_filter(
            $this->store->all('evidence', (string) $run['project_id']),
            static fn (array $item): bool => $item['run_id'] === $run['id']
                && (int) $item['attempt_no'] === (int) $run['attempt_no']
                && (int) $item['task_revision'] === (int) $run['snapshot']['task_revision'],
        ));
        $approvals = $this->store->all('approvals', (string) $run['project_id']);
        $decision = $this->completionEvaluator->evaluate(
            $policy,
            true,
            $report,
            $evidence,
            $approvals,
            array_values($task['criteria'] ?? []),
            (string) $run['id'],
            (int) $run['attempt_no'],
            (int) $run['snapshot']['task_revision'],
            is_string($run['result_digest'] ?? null) ? $run['result_digest'] : null,
        );

        if ('failed' === $decision->outcome) {
            $run['state'] = 'failed';
            $run['status_reason'] = $decision->reason;
            $attempt = $this->attempt($run, (int) $run['attempt_no']);
            $attempt['ended_at'] ??= $this->store->now();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $this->store->save('runs', $run, 'run.phase_not_succeeded');
            if (null !== $run['workflow_instance_id']) {
                $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
            }

            return;
        }

        if (!$decision->isSucceeded()) {
            if ('verifying' === $run['state'] && ($run['status_reason'] ?? null) === $decision->reason) {
                return;
            }
            $run['state'] = 'verifying';
            $run['status_reason'] = $decision->reason;
            $event = match ($decision->outcome) {
                'report_pending' => 'run.report_required',
                'external_pending' => 'run.external_result_pending',
                'evidence_pending' => 'run.phase_evidence_pending',
                'evidence_review_pending' => 'run.phase_review_pending',
                'approval_pending' => 'run.phase_decision_pending',
                'criteria_pending' => 'run.phase_criteria_pending',
                default => 'run.phase_verification_pending',
            };
            $this->store->save('runs', $run, $event);
            if (null !== $decision->attentionCode) {
                $this->openAttention($run['task_id'], $run['project_id'], $decision->attentionCode, 'owner');
            }

            return;
        }

        $run['state'] = 'succeeded';
        $run['status_reason'] = null;
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        $attempt['ended_at'] ??= $this->store->now();
        $attempts = $run['attempts'];
        $attempts[$attempt['attempt_no'] - 1] = $attempt;
        $run['attempts'] = $attempts;
        $run = $this->store->save('runs', $run, 'run.phase_succeeded');
        foreach ([
            'phase_evidence_pending',
            'phase_review_pending',
            'phase_decision_pending',
            'phase_criteria_pending',
            'approval_pending',
            'reconciliation_required',
            'run_permission_in_t3',
            'run_input_owner',
            'agent_question',
        ] as $reason) {
            $this->resolveAttention($run['task_id'], $reason);
        }
        if (null !== $run['workflow_instance_id']) {
            $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
        }
    }

    private function setRunBridgeFailure(array $run, T3BridgeException $exception): void
    {
        $run['state'] = $exception->authenticationFailure ? 'auth_blocked' : 'reconciling';
        $run['status_reason'] = $exception->getMessage();
        $this->store->save('runs', $run, $exception->authenticationFailure ? 'run.auth_blocked' : 'run.reconciliation_required');
        $this->openAttention($run['task_id'], $run['project_id'], $exception->authenticationFailure ? 'auth_required' : 'reconciliation_required', 'owner');
        if ($exception->authenticationFailure) {
            $this->removeObservationSchedule((string) $run['id']);
        }
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function getHandoff(string $taskId, array $p, Actor $actor): array
    {
        $task = $this->record('tasks', $taskId);
        $actor->requireProject((string) $task['project_id']);
        $projection = $this->taskEvidenceProjection->projectTasks([$task])[$taskId] ?? ['task' => $task, 'evidence' => [], 'reports' => []];
        $task = $projection['task'];
        $run = isset($p['source_run_id']) ? $this->store->find('runs', (string) $p['source_run_id']) : null;
        if (isset($p['source_run_id']) && (null === $run || $run['task_id'] !== $taskId || $run['project_id'] !== $task['project_id'])) {
            throw new Problem(404, 'resource_not_found', 'Der angeforderte Ausgangslauf gehört nicht zu dieser Aufgabe.');
        }
        $evidence = array_values(array_filter(
            $this->store->all('evidence', (string) $task['project_id']),
            fn (array $item): bool => $item['task_id'] === $taskId
                && 'rejected' !== ($item['review_status'] ?? null)
                && $this->taskEvidenceEligibility->isCurrent($item, $task, $projection),
        ));
        $collections = array_values(array_filter($this->store->all('link_collections', (string) $task['project_id']), static fn (array $collection): bool => $collection['task_id'] === $taskId));

        return [
            'task' => $task,
            'source_run_id' => $run['id'] ?? null,
            'open_questions' => null === $run ? [] : ($this->currentReport($run, false)['_open_questions'] ?? []),
            'context_summary' => trim((string) $task['title']."\n\n".(string) $task['description']),
            'reported_evidence_ids' => array_column($evidence, 'id'),
            'link_collections' => $collections,
        ];
    }

    /** @param array<string, mixed> $payload */
    private function restoreInventory(array $payload): void
    {
        $this->store->atomic(function () use ($payload): void {
            $requestId = (string) ($payload['request_id'] ?? $payload['backup_id'] ?? 'restore-unknown');
            foreach ($this->store->all('recovery_gates') as $existing) {
                if (($existing['request_id'] ?? null) === $requestId) {
                    return;
                }
            }
            $gate = $this->store->save('recovery_gates', [
                'request_id' => $requestId, 'backup_id' => $payload['backup_id'] ?? null,
                'reason' => $payload['reason'] ?? 'Wiederherstellung abgeschlossen.',
                'requested_by' => $payload['requested_by'] ?? null, 'requested_at' => $payload['requested_at'] ?? $this->store->now(),
                'completed_at' => $payload['completed_at'] ?? $this->store->now(), 'database_sha256' => $payload['database_sha256'] ?? null,
                'status' => 'inventory_required', 'inventory_confirmed_at' => null, 'released_at' => null,
            ], 'recovery.inventory_required');
            foreach ($this->store->all('runs') as $run) {
                if (!in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    continue;
                }
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'Nach einer Wiederherstellung wird der externe T3-Lauf abgeglichen.';
                $this->store->save('runs', $run, 'run.reconciliation_required');
                $attempt = $run['attempts'][$run['attempt_no'] - 1] ?? [];
                $entry = $this->store->save('recovery_entries', [
                    'gate_id' => $gate['id'], 'project_id' => $run['project_id'], 'connection_id' => $attempt['connection_id'] ?? null,
                    'bridge_plugin_id' => $run['snapshot']['bridge_plugin_id']
                        ?? (is_string($attempt['connection_id'] ?? null)
                            ? $this->agentCatalog->providerIdForConnection($attempt['connection_id'])
                            : null),
                    'run_id' => $run['id'],
                    'external_thread_id' => $attempt['external_thread_id'] ?? null,
                    'external_run_id' => $attempt['external_dispatch_run_id'] ?? null,
                    'entry_kind' => 'known_run',
                    'status' => 'pending',
                    'disposition' => null,
                    'reason' => null,
                ], 'recovery.known_run_added');
                if (is_string($attempt['external_thread_id'] ?? null) && '' !== $attempt['external_thread_id']) {
                    $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
                } else {
                    $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                }
            }
            foreach ($this->agentCatalog->activeBindings() as $binding) {
                if (!$binding['active']) {
                    continue;
                }
                $this->store->save('recovery_entries', [
                    'gate_id' => $gate['id'], 'project_id' => $binding['project_id'], 'connection_id' => $binding['connection_id'],
                    'bridge_plugin_id' => $this->agentCatalog->providerIdForConnection((string) $binding['connection_id']),
                    'external_project_id' => $binding['external_project_id'], 'entry_kind' => 'unlisted_external_activity',
                    'status' => 'owner_review_required', 'disposition' => null,
                    'reason' => 'Der T3-Vertrag stellt in der festgelegten MCP-Baseline keine allgemeine Threadinventarliste bereit. Prüfe das Projekt in T3 und registriere unbekannte aktive Aufträge.',
                ], 'recovery.external_inventory_required');
            }
        });
    }

    /** @return array<string, mixed> */
    private function getRecoveryInventory(Actor $actor): array
    {
        $actor->requireOwner();
        $gate = $this->activeRecoveryGate();
        if (null === $gate) {
            return ['status' => 'clear', 'entries' => []];
        }
        $entries = array_values(array_filter($this->store->all('recovery_entries'), static fn (array $entry): bool => $entry['gate_id'] === $gate['id']));

        return ['gate' => $this->publicRecord($gate), 'entries' => array_map($this->publicRecord(...), $entries)];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function decideRecoveryInventory(array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $gate = $this->activeRecoveryGate();
        if (null === $gate) {
            throw new Problem(409, 'recovery_not_active', 'Es ist keine Wiederherstellungsinventur offen.');
        }
        if ('register_external_start' === $body['action']) {
            $start = $body['external_start'];
            $project = $this->record('projects', (string) $start['project_id']);
            $binding = $this->agentCatalog->bindingForProject((string) $project['id']);
            if (null === $binding || $binding['connection_id'] !== $start['connection_id'] || $binding['external_project_id'] !== $start['external_project_id']) {
                throw new Problem(409, 'run_context_mismatch', 'Der registrierte T3-Lauf passt nicht zum aktiven Projektbinding.');
            }
            $entry = $this->store->save('recovery_entries', [
                'gate_id' => $gate['id'], 'project_id' => $project['id'], 'connection_id' => $binding['connection_id'],
                'bridge_plugin_id' => $this->agentCatalog->providerIdForConnection((string) $binding['connection_id']),
                'external_project_id' => $binding['external_project_id'], 'external_thread_id' => $start['thread_id'],
                'external_run_id' => $start['run_id'] ?? null, 'entry_kind' => 'registered_external_start',
                'status' => 'pending', 'disposition' => null, 'reason' => trim((string) ($body['reason'] ?? '')),
            ], 'recovery.external_start_registered');
            if (is_string($entry['external_thread_id']) && '' !== $entry['external_thread_id']) {
                $this->store->enqueue('recovery.entry.observe', ['entry_id' => $entry['id']]);
            }
        } elseif ('resolve_entry' === $body['action']) {
            $entry = $this->record('recovery_entries', (string) $body['entry_id']);
            if ($entry['gate_id'] !== $gate['id']) {
                throw new Problem(404, 'resource_not_found', 'Der Eintrag gehört nicht zur offenen Wiederherstellungsinventur.');
            }
            $disposition = (string) $body['disposition'];
            if ('known_run' === $entry['entry_kind']) {
                if (!in_array($disposition, ['confirmed_stopped_in_t3', 'confirmed_not_started'], true)) {
                    throw new Problem(422, 'validation_failed', 'Ein bekannter Lauf darf nur nach bestätigtem T3-Stopp oder bestätigtem Nichtstart aufgelöst werden.');
                }
                $run = $this->record('runs', (string) $entry['run_id']);
                if (in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    throw new Problem(409, 'run_still_active', 'Der bekannte Lauf muss zuerst über T3 abgeglichen und beendet werden.');
                }
            } elseif ('unlisted_external_activity' === $entry['entry_kind']) {
                if ('reviewed_no_additional_runs' !== $disposition) {
                    throw new Problem(422, 'validation_failed', 'Der Inventurhinweis kann nur nach manueller Prüfung der T3-Projektaktivität bestätigt werden.');
                }
            } else {
                if (!in_array($disposition, ['confirmed_stopped_in_t3', 'confirmed_not_started'], true)) {
                    throw new Problem(422, 'validation_failed', 'Ein registrierter externer Lauf benötigt eine bestätigte Klärung in T3.');
                }
                if ('stopped' !== $entry['status']) {
                    throw new Problem(409, 'run_still_active', 'Der registrierte T3-Lauf wurde noch nicht als beendet beobachtet.');
                }
            }
            $entry['status'] = 'resolved';
            $entry['disposition'] = $disposition;
            $entry['reason'] = trim((string) $body['reason']);
            $entry['resolved_by'] = $actor->ref();
            $entry['resolved_at'] = $this->store->now();
            $this->store->save('recovery_entries', $entry, 'recovery.entry_resolved');
        } elseif ('confirm_inventory' === $body['action']) {
            $entries = array_values(array_filter($this->store->all('recovery_entries'), static fn (array $entry): bool => $entry['gate_id'] === $gate['id']));
            if (array_filter($entries, static fn (array $entry): bool => 'resolved' !== $entry['status'])) {
                throw new Problem(409, 'recovery_inventory_incomplete', 'Alle bekannten Läufe und Hinweise auf unbekannte T3-Aktivität müssen zuerst geklärt werden.');
            }
            $gate['status'] = 'released';
            $gate['inventory_confirmed_at'] = $this->store->now();
            $gate['released_at'] = $this->store->now();
            $gate['resolved_by'] = $actor->ref();
            $gate['resolution_reason'] = trim((string) $body['reason']);
            $this->store->save('recovery_gates', $gate, 'recovery.inventory_released');
            foreach ($this->store->all('recovery_entries') as $entry) {
                if ($entry['gate_id'] === $gate['id'] && 'known_run' === $entry['entry_kind'] && is_string($entry['run_id'] ?? null)) {
                    $run = $this->store->find('runs', $entry['run_id']);
                    if (null !== $run) {
                        $this->resolveAttention((string) $run['task_id'], 'reconciliation_required');
                    }
                }
            }
        }

        return $this->getRecoveryInventory($actor);
    }

    private function observeRecoveryEntry(string $entryId): void
    {
        $entry = $this->record('recovery_entries', $entryId);
        if ('resolved' === $entry['status'] || !isset($entry['external_thread_id'])) {
            return;
        }
        $connection = $this->agentCatalog->connection((string) $entry['connection_id']);
        try {
            $remote = $this->bridge->readThread(
                $connection,
                $this->connectionToken($connection),
                (string) $entry['external_thread_id'],
                isset($entry['external_run_id']) ? (string) $entry['external_run_id'] : null,
            );
        } catch (T3BridgeException $exception) {
            $entry['last_error'] = $exception->getMessage();
            $this->store->save('recovery_entries', $entry, 'recovery.entry_observation_failed');
            if (!$exception->authenticationFailure) {
                throw $exception;
            }

            return;
        }
        $remoteStatus = strtolower((string) ($remote['status'] ?? $remote['run']['status'] ?? 'unknown'));
        $entry['observed_status'] = $remoteStatus;
        $entry['last_observed_at'] = $this->store->now();
        if (in_array($remoteStatus, ['completed', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'interrupted'], true)) {
            $entry['status'] = 'stopped';
        } else {
            $entry['status'] = 'pending';
        }
        $this->store->save('recovery_entries', $entry, 'recovery.external_activity_observed');
        if ('pending' === $entry['status']) {
            $this->scheduleRecoveryObservation($entryId);
        }
    }

    private function advanceWorkflow(string $instanceId): void
    {
        $instance = $this->record('workflow_instances', $instanceId);
        if ('running' === $instance['state'] && $this->maintenanceMode()) {
            $instance['state'] = 'paused';
            $instance['pause_reason'] = 'Der Wartungsmodus hält neue Workflowphasen an. Laufbeobachtung und Wiederherstellung bleiben verfügbar.';
            $instance['_paused_for_maintenance'] = true;
            $this->store->save('workflow_instances', $instance, 'workflow.maintenance_paused');

            return;
        }
        if ('running' !== $instance['state'] || new \DateTimeImmutable($instance['deadline_at']) <= new \DateTimeImmutable($this->store->now())) {
            if ('running' === $instance['state']) {
                $instance['state'] = 'paused';
                $instance['pause_reason'] = 'Die konfigurierte maximale Workflowdauer wurde erreicht.';
                $this->store->save('workflow_instances', $instance, 'workflow.duration_limit_reached');
                $this->openAttention($instance['task_id'], $instance['project_id'], 'workflow_duration_limit', 'owner');
            }

            return;
        }
        $workflow = $instance['definition_snapshot'] ?? $this->workflowDefinition((string) $instance['workflow_id'], (int) $instance['definition_version']);
        $task = $this->record('tasks', (string) $instance['task_id']);
        $runs = array_values(array_filter(array_map(fn (string $id): ?array => $this->store->find('runs', $id), $instance['run_ids']), static fn (?array $run): bool => null !== $run));
        $active = array_filter($runs, static fn (array $run): bool => in_array($run['state'], self::ACTIVE_RUN_STATES, true));
        if ([] !== $active) {
            return;
        }
        $latest = [] === $runs ? null : $runs[array_key_last($runs)];
        $stage = $this->stage($workflow, (string) $instance['current_stage_id']);
        if (null !== $latest && ($instance['_stage_source_run_id'] ?? null) === $latest['id']) {
            $this->queueWorkflowStageRun($instance, $task, $workflow, $stage, $latest);

            return;
        }
        if (null === $latest) {
            $this->assertConditions($stage['entry_conditions'] ?? [], $task, $instance);
            if (null === $stage['agent_profile_id']) {
                $this->pauseWorkflow($instance, 'Für die erste Phase ist kein Agentprofil gesetzt.');

                return;
            }
            $this->queueWorkflowStageRun($instance, $task, $workflow, $stage);

            return;
        }
        $report = $this->currentReport($latest, false);
        $outcome = match (true) {
            'succeeded' === $latest['state'] => 'accepted',
            null !== $report => (string) $report['outcome'],
            'failed' === $latest['state'] => 'failed',
            'cancelled' === $latest['state'] => 'blocked',
            default => null,
        };
        if (null === $outcome) {
            $this->pauseWorkflow($instance, 'Der letzte Phasenlauf benötigt eine menschliche Klärung.');

            return;
        }
        $stageId = (string) $instance['current_stage_id'];
        $outcomeTransitions = array_values(array_filter(
            $workflow['transitions'],
            static fn (array $candidate): bool => ($candidate['from_stage_id'] ?? null) === $stageId
                && ($candidate['on'] ?? null) === $outcome,
        ));
        $runReportSelectedRoute = null !== $report && array_key_exists('route_label_id', $report);
        $routeLabelId = $runReportSelectedRoute ? $report['route_label_id'] : null;
        $matchingTaskRoutes = [];
        if (!$runReportSelectedRoute) {
            $matchingTaskRoutes = $this->matchingTaskWorkflowRoutes($latest, $task, $outcome);
            if (count($matchingTaskRoutes) > 1) {
                $labelNames = array_map(static fn (array $route): string => (string) $route['route_label_name'], $matchingTaskRoutes);
                $this->pauseWorkflow(
                    $instance,
                    'Mehrere Ticket-Themenlabels wählen unterschiedliche Workflowphasen: '.implode(', ', array_map(static fn (string $name): string => '„'.$name.'“', $labelNames)).'. Entferne oder ändere die konkurrierenden Themenlabels, sodass genau ein benannter Abzweig passt, und setze den Workflow anschließend fort.',
                );
                $this->openAttention($task['id'], $task['project_id'], 'workflow_transition_required', 'owner');

                return;
            }
            if (1 === count($matchingTaskRoutes)) {
                $routeLabelId = $matchingTaskRoutes[0]['route_label_id'];
            }
        }
        $transition = $this->workflowPolicy->selectTransition(
            $workflow['transitions'],
            $stageId,
            $outcome,
            is_string($routeLabelId) ? $routeLabelId : null,
        );
        if (null === $transition) {
            if ('succeeded' === $latest['state'] && [] === $outcomeTransitions) {
                $instance['state'] = 'succeeded';
                $instance['current_stage_id'] = null;
                $instance['pause_reason'] = null;
                $this->store->save('workflow_instances', $instance, 'workflow.succeeded');
                $this->resolveAttention($task['id'], 'workflow_repair_limit');

                return;
            }
            $this->pauseWorkflow($instance, $this->workflowRoutePauseReason($latest, $outcome, $outcomeTransitions, $runReportSelectedRoute));
            $this->openAttention($task['id'], $task['project_id'], 'workflow_transition_required', 'owner');

            return;
        }
        $stageOrder = array_flip(array_column($workflow['stages'], 'id'));
        $targetStagePosition = $stageOrder[$transition['to_stage_id']] ?? null;
        $sourceStagePosition = $stageOrder[$transition['from_stage_id']] ?? null;
        $returnsToVisitedEarlierPhase = null !== $targetStagePosition
            && null !== $sourceStagePosition
            && $targetStagePosition < $sourceStagePosition
            && in_array($transition['to_stage_id'], array_column($runs, 'stage'), true);
        $isRepair = 'needs_changes' === $outcome || $returnsToVisitedEarlierPhase;
        $authorizedRepair = $instance['_authorized_repair'] ?? null;
        $repairRoute = array_intersect_key($transition, array_flip(['to_stage_id', 'on', 'route_label_id']));
        $hasOwnerAuthorization = ($authorizedRepair['run_id'] ?? null) === $latest['id'] && $authorizedRepair['route'] === $repairRoute;
        if ($isRepair && $instance['repair_round'] >= (int) $workflow['limits']['max_repair_rounds']
            && !$hasOwnerAuthorization) {
            $instance['repair_decision_run_id'] = $latest['id'];
            $instance['repair_decision_stage_name'] = $this->stage($workflow, $transition['to_stage_id'])['name'];
            $instance['_pending_repair_route'] = $repairRoute;
            unset($instance['_authorized_repair']);
            $this->pauseWorkflow($instance, 'Die konfigurierte Zahl der Reparaturrunden ist erreicht. Prüfe den letzten Bericht. Du kannst eine weitere Überarbeitung mit einem Hinweis freigeben oder den Workflow abbrechen.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_repair_limit', 'owner');

            return;
        }
        if (!$this->conditionsSatisfied($transition['conditions'] ?? [], $task, $instance)) {
            $this->pauseWorkflow($instance, 'Die Bedingungen für den nächsten Phasenübergang sind offen. Prüfe Nachweise, Kriterien und Freigaben im Ticket und setze den Workflow anschließend fort.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_transition_required', 'owner');

            return;
        }
        $nextStage = $this->stage($workflow, (string) $transition['to_stage_id']);
        try {
            $this->assertConditions($nextStage['entry_conditions'] ?? [], $task, $instance);
        } catch (Problem $problem) {
            $this->pauseWorkflow($instance, $problem->getMessage());
            $this->openAttention($task['id'], $task['project_id'], 'workflow_entry_condition_unmet', 'owner');

            return;
        }
        if (null === $nextStage['agent_profile_id']) {
            $this->pauseWorkflow($instance, 'Die nächste Phase benötigt ein Agentprofil oder eine menschliche Ausführung.');

            return;
        }
        if ($isRepair) {
            ++$instance['repair_round'];
        }
        $historyStatus = $instance['transition_history_status'] ?? null;
        $selectedTransitions = $instance['selected_transitions'] ?? null;
        if (!is_array($selectedTransitions)) {
            $selectedTransitions = [];
        }
        if (!in_array($historyStatus, ['complete', 'partial'], true)) {
            $historyStatus = 'partial';
        }
        $selectedTransitions[] = [
            'from_stage_id' => (string) $instance['current_stage_id'],
            'to_stage_id' => (string) $transition['to_stage_id'],
            'outcome' => $outcome,
            'route_label_id' => $transition['route_label_id'] ?? null,
            'source_run_id' => (string) $latest['id'],
            'report_id' => is_string($report['id'] ?? null) ? $report['id'] : null,
            'selected_at' => $this->store->now(),
        ] + ($hasOwnerAuthorization ? ['owner_guidance' => $authorizedRepair['reason']] : []);
        if (is_string($transition['route_label_id'] ?? null)) {
            $routeLabelName = $this->workflowRouteLabelName($latest, $outcome, $transition['route_label_id']);
            if (null !== $routeLabelName) {
                $selectedTransitions[array_key_last($selectedTransitions)]['route_label_name'] = $routeLabelName;
            }
        }
        unset($instance['_authorized_repair']);
        $instance['selected_transitions'] = $selectedTransitions;
        $instance['transition_history_status'] = $historyStatus;
        $instance['_stage_source_run_id'] = $latest['id'];
        $instance['current_stage_id'] = $nextStage['id'];
        $instance['pause_reason'] = null;
        $instance = $this->store->save('workflow_instances', $instance, 'workflow.stage_advanced');
        $this->resolveAttention($task['id'], 'workflow_transition_required');
        $this->resolveAttention($task['id'], 'workflow_entry_condition_unmet');
        $this->queueWorkflowStageRun($instance, $task, $workflow, $nextStage, $latest);
    }

    private function queueWorkflowStageRun(array $instance, array $task, array $workflow, array $stage, ?array $source = null): void
    {
        if ($this->maintenanceMode()) {
            $instance['_paused_for_maintenance'] = true;
            $this->pauseWorkflow($instance, 'Der Wartungsmodus hält neue Workflowphasen vorübergehend an.');

            return;
        }
        if ($this->hasOpenOwnerAttention((string) $task['id'], (string) $task['project_id']) || null !== $this->activeRecoveryGate()) {
            $this->pauseWorkflow($instance, null !== $this->activeRecoveryGate()
                ? 'Nach der Wiederherstellung muss die externe T3-Inventur abgeschlossen werden.'
                : 'Für diese Aufgabe ist noch eine menschliche Entscheidung offen.');

            return;
        }
        $profile = $this->agentCatalog->profile((string) $stage['agent_profile_id']);
        $providerId = $profile['bridge_plugin_id'] ?? null;
        if (is_string($providerId) && '' !== $providerId && !$this->agentCatalog->providerEnabled($providerId)) {
            $instance['_paused_for_provider_id'] = $providerId;
            $this->pauseWorkflow($instance, 'Der registrierte T3-Provider wird stillgelegt. Die Workflowphase wird nach seiner Aktivierung fortgesetzt.');

            return;
        }
        if (!$profile['enabled'] || !$profile['configuration_valid']) {
            $this->pauseWorkflow($instance, 'Das Agentprofil dieser Phase ist nicht startbereit.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_profile_unavailable', 'owner');

            return;
        }
        if (!$this->agentCatalog->profileAllowsProject($profile, (string) $task['project_id'])) {
            $this->pauseWorkflow($instance, 'Das Rollenprofil dieser Phase ist für dieses Projekt nicht mehr freigegeben. Prüfe seine Projektfreigabe oder starte nach dem Rollenwechsel eine neue Workflowversion.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_profile_unavailable', 'owner');

            return;
        }
        $binding = $this->agentCatalog->bindingForProject((string) $task['project_id']);
        if (null === $binding || $binding['connection_id'] !== $profile['connection_id']) {
            $this->pauseWorkflow($instance, 'T3-Projektbindung und Agentprofil sind nicht passend konfiguriert.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_profile_unavailable', 'owner');

            return;
        }
        $connection = $this->agentCatalog->connection((string) $binding['connection_id']);
        if ('valid' !== $connection['auth_status'] || 'incompatible' === $connection['health']) {
            $this->pauseWorkflow($instance, 'Die T3-Verbindung dieser Phase ist nicht startbereit.');
            $this->openAttention($task['id'], $task['project_id'], 'auth_required', 'owner');

            return;
        }
        foreach ($this->store->all('runs') as $existing) {
            if (($existing['snapshot']['project_binding_id'] ?? null) === $binding['id'] && in_array($existing['state'], self::ACTIVE_RUN_STATES, true)) {
                $this->pauseWorkflow($instance, 'Für dieses T3-Projekt ist ein anderer Lauf aktiv oder ungeklärt.');

                return;
            }
        }
        $handoffSnapshot = null === $source ? [] : $this->freezeHandoff($source, $task, $instance);
        try {
            $this->assertTaskCanStart($task);
            $task = $this->applyWorkflowStageBoardTarget($task, $stage, (string) $instance['project_id']);
        } catch (Problem $problem) {
            $this->pauseWorkflow($instance, $problem->getMessage());
            $this->openAttention($task['id'], $task['project_id'], 'workflow_entry_condition_unmet', 'owner');

            return;
        }
        $runId = $this->store->id();
        $dispatchId = $this->store->id();
        $run = $this->store->save('runs', [
            'id' => $runId, 'project_id' => $task['project_id'], 'task_id' => $task['id'], 'stage' => $stage['id'],
            'state' => 'queued', 'snapshot' => [
                'task_revision' => (int) $task['version'], 'title' => (string) $task['title'],
                'description' => (string) $task['description'], 'criteria' => array_values($task['criteria'] ?? []),
                'agent_profile_id' => $profile['id'], 'agent_profile_version' => (int) $profile['version'],
                'project_binding_id' => $binding['id'], 'workflow_version' => (int) $workflow['definition_version'],
                'prompt_template_version' => (int) $profile['prompt_template_version'],
                'run_completion_policy' => $stage['run_completion_policy'], 'execution_target' => $profile['execution_target'],
                'bridge_plugin_id' => $profile['bridge_plugin_id'] ?? null,
                'delegation_depth' => 0,
                'classification_id' => $task['classification_id'] ?? null, 'workflow_label_id' => $task['workflow_label_id'] ?? null,
                'routing_rules_version' => $task['routing_rules_version'] ?? null,
            ] + $this->stageSnapshot($stage, $workflow, $task) + $handoffSnapshot,
            'attempt_no' => 1, 'attempts' => [[
                'attempt_no' => 1, 'dispatch_id' => $dispatchId, 'connection_id' => $connection['id'],
                'auth_epoch' => max(1, (int) $connection['auth_epoch']), 'external_thread_id' => null,
                'external_dispatch_run_id' => null, 'external_observed_run_id' => null, 'external_result_run_id' => null,
                'external_message_id' => null, 'external_url' => null, 'remote_status' => null, 'last_observed_at' => null,
                'started_at' => null, 'ended_at' => null, 'request_sha256' => hash('sha256', ''),
            ]],
            'parent_run_id' => null, 'workflow_instance_id' => $instance['id'], '_requested_by' => ['kind' => 'system', 'id' => 'system'], 'pending_input' => null,
            'result_digest' => null, 'evidence_ids' => [], 'report_ids' => [], 'last_observed_at' => null,
            'status_reason' => null, '_dispatch_request' => null, '_prompt_template' => (string) ($profile['prompt_template'] ?? ''),
        ], 'run.queued');
        unset($instance['_stage_source_run_id']);
        $instance['run_ids'][] = $run['id'];
        $this->store->save('workflow_instances', $instance, 'workflow.run_attached');
        $this->store->enqueue('run.dispatch', ['run_id' => $run['id']]);
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $stage @return array<string, mixed> */
    private function applyWorkflowStageBoardTarget(array $task, array $stage, string $projectId): array
    {
        if (!array_key_exists('board_target', $stage)) {
            return $task;
        }

        $target = $stage['board_target'];
        if (!is_array($target) || !is_string($target['board_id'] ?? null) || !is_string($target['column_id'] ?? null)) {
            throw new Problem(409, 'workflow_stage_board_target_unavailable', 'Das Boardziel dieser Workflowphase ist unvollständig.');
        }

        return $this->stageBoardMover->move(
            (string) $task['id'],
            $projectId,
            $target['board_id'],
            $target['column_id'],
        );
    }

    /** @param array<string, mixed> $stage @return array<string, mixed> */
    private function stageSnapshot(array $stage, ?array $workflow = null, ?array $task = null): array
    {
        $snapshot = [
            'stage_name' => (string) $stage['name'],
            'stage_kind' => (string) $stage['kind'],
        ];
        if (is_string($stage['instructions'] ?? null)) {
            $snapshot['stage_instructions'] = $stage['instructions'];
        }
        if (is_array($stage['board_target'] ?? null)) {
            $snapshot['stage_board_target'] = $stage['board_target'];
        }
        if (null !== $workflow && null !== $task) {
            $snapshot['workflow_routes'] = $this->workflowRouteOptions($workflow, (string) $stage['id'], (string) $task['project_id']);
        }

        return $snapshot;
    }

    /** @return list<array{on: string, to_stage_id: string, to_stage_name: string, is_default: bool, route_label_id: string|null, route_label_name: string|null}> */
    private function workflowRouteOptions(array $workflow, string $stageId, string $projectId): array
    {
        $stagesById = array_column($workflow['stages'] ?? [], null, 'id');
        $labelsById = [];
        foreach ($this->store->all('labels', $projectId) as $label) {
            if ('topic' === ($label['kind'] ?? null) && !empty($label['active'])) {
                $labelsById[strtolower((string) $label['id'])] = $label;
            }
        }
        $options = [];
        foreach ($workflow['transitions'] ?? [] as $transition) {
            if (($transition['from_stage_id'] ?? null) !== $stageId) {
                continue;
            }
            $target = $stagesById[$transition['to_stage_id'] ?? ''] ?? null;
            if (!is_array($target)) {
                continue;
            }
            $routeLabelId = $transition['route_label_id'] ?? null;
            $routeLabelName = null;
            if (is_string($routeLabelId)) {
                $routeLabel = $labelsById[strtolower($routeLabelId)] ?? null;
                if (!is_array($routeLabel)) {
                    continue;
                }
                $routeLabelName = (string) $routeLabel['name'];
            } else {
                $routeLabelId = null;
            }
            $options[] = [
                'on' => (string) $transition['on'],
                'to_stage_id' => (string) $target['id'],
                'to_stage_name' => (string) $target['name'],
                'is_default' => null === $routeLabelId,
                'route_label_id' => $routeLabelId,
                'route_label_name' => $routeLabelName,
            ];
        }

        return $options;
    }

    /** @return list<array<string, mixed>> */
    private function matchingTaskWorkflowRoutes(array $run, array $task, string $outcome): array
    {
        $taskLabelIds = [];
        foreach ($task['label_ids'] ?? [] as $labelId) {
            if (is_string($labelId)) {
                $taskLabelIds[strtolower($labelId)] = true;
            }
        }
        if (is_string($task['primary_topic_label_id'] ?? null)) {
            $taskLabelIds[strtolower($task['primary_topic_label_id'])] = true;
        }
        if ([] === $taskLabelIds) {
            return [];
        }
        $activeTopicIds = [];
        foreach ($this->store->all('labels', (string) $task['project_id']) as $label) {
            if ('topic' === ($label['kind'] ?? null) && !empty($label['active'])) {
                $activeTopicIds[strtolower((string) $label['id'])] = true;
            }
        }
        $matches = [];
        foreach ($run['snapshot']['workflow_routes'] ?? [] as $route) {
            $routeLabelId = $route['route_label_id'] ?? null;
            if (($route['on'] ?? null) !== $outcome
                || !is_string($routeLabelId)
                || !isset($taskLabelIds[strtolower($routeLabelId)], $activeTopicIds[strtolower($routeLabelId)])) {
                continue;
            }
            $matches[strtolower($routeLabelId)] = $route;
        }

        return array_values($matches);
    }

    /** @param list<array<string, mixed>> $outcomeTransitions */
    private function workflowRoutePauseReason(array $run, string $outcome, array $outcomeTransitions, bool $reportSelectedRoute): string
    {
        if ([] === $outcomeTransitions) {
            return 'Für dieses Phasenergebnis ist keine passende Übergangsregel konfiguriert.';
        }
        if ($reportSelectedRoute) {
            return 'Die gewählte Ergebnisroute kann in der eingefrorenen Workflowversion nicht angewendet werden. Prüfe den Runbericht und die angebotenen Routen.';
        }
        $availableRoutes = array_values(array_filter(
            $run['snapshot']['workflow_routes'] ?? [],
            static fn (array $route): bool => ($route['on'] ?? null) === $outcome,
        ));
        if ([] === $availableRoutes) {
            return 'Die konfigurierten Abzweige sind im Projekt nicht mehr aktiv verfügbar. Aktiviere ein passendes Themenlabel oder aktualisiere die Workflowversion.';
        }
        $hasDefault = [] !== array_filter($availableRoutes, static fn (array $route): bool => !empty($route['is_default']));
        if ($hasDefault) {
            return 'Für dieses Ergebnis wurde kein eindeutiger Themenabzweig gewählt. Prüfe die Ticket-Themenlabels und setze den Workflow anschließend fort.';
        }

        return 'Für dieses Ergebnis ist kein Standardübergang konfiguriert und die Ticket-Themenlabels wählen keinen eindeutigen benannten Abzweig. Wähle im Runbericht eine angebotene route_label_id oder passe die Ticket-Themenlabels an und setze den Workflow anschließend fort.';
    }

    private function workflowRouteLabelName(array $run, string $outcome, string $routeLabelId): ?string
    {
        foreach ($run['snapshot']['workflow_routes'] ?? [] as $route) {
            if (($route['on'] ?? null) === $outcome && $this->sameRouteLabelId($route['route_label_id'] ?? null, $routeLabelId)) {
                return is_string($route['route_label_name'] ?? null) ? $route['route_label_name'] : null;
            }
        }

        return null;
    }

    private function sameRouteLabelId(mixed $left, mixed $right): bool
    {
        if (null === $left || null === $right) {
            return null === $left && null === $right;
        }

        return is_string($left) && is_string($right) && strtolower($left) === strtolower($right);
    }

    /** Freeze the preceding attempt before the new role can begin or the owner can edit its references. */
    private function freezeHandoff(array $source, array $task, ?array $instance = null): array
    {
        if ($source['task_id'] !== $task['id'] || $source['project_id'] !== $task['project_id']) {
            throw new Problem(409, 'run_context_mismatch', 'Die Phasenübergabe gehört nicht zu dieser Aufgabe.');
        }
        $attempt = $this->attempt($source, (int) $source['attempt_no']);
        $report = $this->currentReport($source, false);
        $projection = $this->taskEvidenceProjection->projectTasks([$task])[$task['id']] ?? ['evidence' => []];
        $currentEvidenceIds = [];
        foreach ($projection['evidence'] as $evidence) {
            if (($evidence['run_id'] ?? null) === $source['id']
                && in_array($evidence['id'] ?? null, $report['evidence_ids'] ?? [], true)) {
                $currentEvidenceIds[] = $evidence['id'];
            }
        }
        $references = [];
        foreach ($task['link_collection_ids'] ?? [] as $collectionId) {
            $collection = $this->store->find('link_collections', $collectionId);
            if (null !== $collection && $collection['task_id'] === $task['id'] && $collection['project_id'] === $task['project_id']) {
                $references[] = array_intersect_key($collection, array_flip(['id', 'task_id', 'name', 'kind', 'links'])) + ['task_version' => $task['version']];
            }
        }

        $transitions = $instance['selected_transitions'] ?? [];
        $transition = [] === $transitions ? [] : $transitions[array_key_last($transitions)];
        $ownerGuidance = ($transition['source_run_id'] ?? null) === $source['id'] ? ($transition['owner_guidance'] ?? null) : null;

        return [
            'handoff_source_run_id' => $source['id'],
            'handoff_snapshot' => [
                'source_report_id' => $report['id'] ?? null,
                'source_result_digest' => $report['_digest'] ?? null,
                'source_attempt_id' => $attempt['dispatch_id'],
                'source_attempt_no' => $attempt['attempt_no'],
                'task_revision_id' => $source['snapshot']['task_revision'],
                'external_thread_id' => $attempt['external_thread_id'],
                'summary' => $report['summary'] ?? $source['status_reason'] ?? '',
                'outcome' => $report['outcome'] ?? $source['state'],
                'context_summary' => mb_substr(trim($task['title']."\n\n".$task['description']), 0, 20000),
                'open_questions' => $report['_open_questions'] ?? [],
                'reported_evidence_ids' => array_values(array_unique($currentEvidenceIds)),
                'link_collections' => $references,
            ] + (null === $ownerGuidance ? [] : ['owner_guidance' => $ownerGuidance]),
        ];
    }

    private function pauseWorkflow(array $instance, string $reason): void
    {
        $instance['state'] = 'paused';
        $instance['pause_reason'] = $reason;
        $this->store->save('workflow_instances', $instance, 'workflow.paused');
    }

    /** @param array<string, mixed> $payload */
    private function fireTrigger(string $triggerId, array $payload = []): void
    {
        $trigger = $this->record('triggers', $triggerId);
        if (!$trigger['enabled'] || null !== $this->activeRecoveryGate() || $this->maintenanceMode()) {
            return;
        }
        $project = $this->record('projects', (string) $trigger['project_id']);
        if ($project['archived']) {
            $trigger['last_error'] = 'Archiviertes Projekt kann keine neuen automatischen Läufe starten.';
            $trigger['enabled'] = false;
            $this->store->save('triggers', $trigger, 'workflow.trigger_disabled_for_archived_project');

            return;
        }
        if ('plugin' === $trigger['spec']['type']) {
            $trigger['last_error'] = 'Plugin-Trigger werden erst ausgeführt, wenn das aktivierte Plugin einen registrierten Trigger-Handler bereitstellt.';
            $this->store->save('triggers', $trigger, 'workflow.trigger_handler_unavailable');

            return;
        }
        $tasks = [];
        if (null !== $trigger['task_id']) {
            $task = $this->store->find('tasks', (string) $trigger['task_id']);
            if (null !== $task) {
                $tasks[] = $task;
            }
        } elseif ('domain_event' === $trigger['spec']['type'] && isset($payload['task_id'])) {
            $task = $this->store->find('tasks', (string) $payload['task_id']);
            if (null !== $task && $task['project_id'] === $project['id']) {
                $tasks[] = $task;
            }
        } elseif ('domain_event' === $trigger['spec']['type'] && isset($trigger['spec']['task_status_id'])) {
            $tasks = array_values(array_filter($this->store->all('tasks', (string) $project['id']), static fn (array $task): bool => $task['status_id'] === $trigger['spec']['task_status_id']));
        }
        $started = 0;
        foreach ($tasks as $task) {
            if ('domain_event' === $trigger['spec']['type'] && isset($payload['event_type']) && $payload['event_type'] !== $trigger['spec']['event_type']) {
                continue;
            }
            try {
                $this->startWorkflow($task['id'], [
                    'workflow_id' => $trigger['workflow_id'], 'definition_version' => $trigger['definition_version'],
                    'task_revision' => $task['version'],
                ], new Actor('system', false, [$project['id']], ['automation.start']));
                ++$started;
            } catch (Problem $problem) {
                $trigger['last_error'] = mb_substr($problem->getMessage(), 0, 500);
            }
        }
        if (0 === $started && null === $trigger['last_error'] && 'manual' === $trigger['spec']['type']) {
            $trigger['last_error'] = 'Der manuelle Trigger benötigt eine konkrete Aufgabe.';
        }
        $trigger['last_fired_at'] = $this->store->now();
        $this->store->save('triggers', $trigger, $started > 0 ? 'workflow.trigger_fired' : 'workflow.trigger_skipped');
    }

    private function scheduleObservation(string $runId): void
    {
        $schedule = null;
        foreach ($this->store->all('run_observation_schedules') as $candidate) {
            if ($candidate['run_id'] === $runId) {
                $schedule = $candidate;
                break;
            }
        }
        $nextDue = (new \DateTimeImmutable($this->store->now()))->modify('+5 seconds')->format(DATE_ATOM);
        $record = [
            'run_id' => $runId,
            'next_due_at' => $nextDue,
        ];
        if (null !== $schedule) {
            $record['id'] = $schedule['id'];
        }
        $this->store->save('run_observation_schedules', $record, 'run.observation_scheduled');
    }

    private function removeObservationSchedule(string $runId): void
    {
        foreach ($this->store->all('run_observation_schedules') as $schedule) {
            if ($schedule['run_id'] === $runId) {
                $this->store->remove('run_observation_schedules', $schedule['id'], 'run.observation_schedule_removed');
            }
        }
    }

    private function scheduleRecoveryObservation(string $entryId): void
    {
        $schedule = null;
        foreach ($this->store->all('recovery_observation_schedules') as $candidate) {
            if ($candidate['entry_id'] === $entryId) {
                $schedule = $candidate;
                break;
            }
        }
        $record = [
            'entry_id' => $entryId,
            'next_due_at' => (new \DateTimeImmutable($this->store->now()))->modify('+5 seconds')->format(DATE_ATOM),
        ];
        if (null !== $schedule) {
            $record['id'] = $schedule['id'];
        }
        $this->store->save('recovery_observation_schedules', $record, 'recovery.observation_scheduled');
    }

    private function record(string $type, string $id): array
    {
        return $this->store->find($type, $id)
            ?? throw new Problem(404, 'resource_not_found', 'Der angeforderte Eintrag wurde nicht gefunden.');
    }

    private function pathId(array $parameters, string $name): string
    {
        $id = $parameters[$name] ?? null;
        if (!is_string($id) || '' === $id) {
            throw new Problem(422, 'validation_failed', 'Der Ressourcenbezeichner fehlt.');
        }

        return $id;
    }

    private function jobId(array $payload, string $name): string
    {
        $id = $payload[$name] ?? null;
        if (!is_string($id) || '' === $id) {
            throw new Problem(422, 'invalid_job', 'Der dauerhafte Auftrag enthält keine Ressourcenkennung.');
        }

        return $id;
    }

    private function publicRecord(array $record): array
    {
        return $this->store->redact($record);
    }

    private function connectionToken(array $connection): string
    {
        $token = $this->agentCatalog->accessToken((string) $connection['id']);
        if (!is_string($token) || '' === $token) {
            throw new T3BridgeException('Das lokal gespeicherte T3-Credential ist nicht verfügbar.', true);
        }

        return $token;
    }

    private function assertCapabilities(array $connection, array $required): void
    {
        $snapshotId = $connection['capability_snapshot_id'] ?? null;
        $snapshot = is_string($snapshotId) ? $this->agentCatalog->capabilitySnapshot($snapshotId) : null;
        $tools = $snapshot['tools'] ?? [];
        $missing = array_values(array_diff($required, $tools));
        if (null === $snapshot || !$snapshot['compatible'] || [] !== $missing) {
            throw new Problem(409, 'capability_unavailable', 'Die letzte T3-Prüfung bestätigt nicht alle für diesen Auftrag benötigten Fähigkeiten.');
        }
    }

    /** @param array<string, mixed> $run @param array<string, mixed> $attempt */
    private function canSendCancellation(array $run, array $attempt): bool
    {
        $providerId = $run['snapshot']['bridge_plugin_id'] ?? null;
        $drainCancellationAllowed = !empty($run['_provider_drain_cancel_requested'])
            && is_string($providerId)
            && $this->agentCatalog->providerAllowsDrainCancellation($providerId);

        return $drainCancellationAllowed || $this->providerEnabledForRun($run, $attempt);
    }

    private function providerEnabledForRun(array $run, array $attempt): bool
    {
        $providerId = $run['snapshot']['bridge_plugin_id'] ?? null;
        if (!is_string($providerId) || '' === $providerId) {
            $providerId = $this->agentCatalog->providerIdForConnection((string) $attempt['connection_id']);
        }

        return is_string($providerId) && '' !== $providerId && $this->agentCatalog->providerEnabled($providerId);
    }

    private function assertTaskCanStart(array $task): void
    {
        if ($this->maintenanceMode()) {
            throw new Problem(409, 'maintenance_mode', 'Der Wartungsmodus hält neue Agentenläufe und Workflows vorübergehend an. Beobachtung und Wiederherstellung bleiben verfügbar.');
        }
        $project = $this->record('projects', (string) $task['project_id']);
        if (!empty($project['archived'])) {
            throw new Problem(409, 'project_archived', 'In einem archivierten Projekt kann kein neuer Auftrag gestartet werden.');
        }
        if (!empty($task['blocked'])) {
            throw new Problem(409, 'task_blocked', 'Die Aufgabe ist blockiert und kann nicht gestartet werden.');
        }
        if (!empty($task['classification_required']) && ($task['intake_outcome'] ?? null) !== 'ready') {
            throw new Problem(409, 'intake_not_ready', 'Die erforderliche Eingangsklassifikation ist für die aktuelle Aufgabe noch nicht bereit.');
        }
        if (!in_array($task['status_category'], ['ready', 'active', 'review'], true)) {
            throw new Problem(409, 'task_not_ready', 'Die Aufgabe muss zuerst in einen bearbeitbaren Projektstatus verschoben werden.');
        }
        foreach ($this->store->all('attention_reasons', (string) $task['project_id']) as $reason) {
            if ($reason['task_id'] === $task['id'] && !empty($reason['open']) && ($reason['addressed_to'] ?? null) === 'owner') {
                throw new Problem(409, 'human_attention_required', 'Für diese Aufgabe ist zuerst eine offene menschliche Entscheidung aufzulösen.');
            }
        }
        if (null !== $this->activeRecoveryGate()) {
            throw new Problem(409, 'recovery_inventory_required', 'Nach der Wiederherstellung muss zuerst die externe T3-Inventur ausdrücklich abgeschlossen werden.');
        }
    }

    private function maintenanceMode(): bool
    {
        $settings = $this->store->find('settings', '00000000-0000-4000-8000-000000000001');

        return null !== $settings && !empty($settings['maintenance_mode']);
    }

    private function activeRecoveryGate(): ?array
    {
        $gates = array_values(array_filter($this->store->all('recovery_gates'), static fn (array $gate): bool => ($gate['status'] ?? null) !== 'released'));
        usort($gates, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $gates[0] ?? null;
    }

    private function workflowDefinition(string $workflowId, int $version): array
    {
        $workflow = $this->record('workflows', $workflowId);
        if ($version === (int) $workflow['definition_version']) {
            return $workflow;
        }
        foreach ($this->store->all('workflow_versions') as $candidate) {
            if ($candidate['workflow_id'] === $workflowId && (int) $candidate['definition_version'] === $version) {
                return array_replace($candidate, ['id' => $workflowId, 'version' => $version]);
            }
        }

        throw new Problem(409, 'workflow_version_missing', 'Die angeforderte unveränderliche Workflowversion ist nicht vorhanden.');
    }

    private function stage(array $workflow, string $stageId): array
    {
        foreach ($workflow['stages'] as $stage) {
            if ($stage['id'] === $stageId) {
                return $stage;
            }
        }

        throw new Problem(409, 'workflow_stage_missing', 'Die Workflowphase ist in der gespeicherten Definition nicht vorhanden.');
    }

    /** @return array<string, mixed> */
    private function attempt(array $run, int $number): array
    {
        foreach (($run['attempts'] ?? []) as $attempt) {
            if ((int) $attempt['attempt_no'] === $number) {
                return $attempt;
            }
        }

        throw new Problem(409, 'run_attempt_missing', 'Der erwartete Versuch gehört nicht zu diesem Lauf.');
    }

    private function normalizePendingInput(array $pending): array
    {
        $permission = ($pending['kind'] ?? $pending['type'] ?? null) === 'permission';
        $questions = [];
        foreach (($pending['questions'] ?? []) as $question) {
            if (!is_array($question) || !isset($question['id'])) {
                continue;
            }
            $questions[] = [
                'id' => (string) $question['id'], 'prompt' => (string) ($question['prompt'] ?? $question['question'] ?? ''),
                'options' => array_values($question['options'] ?? []),
                'allow_multiple' => (bool) ($question['allowMultiple'] ?? false),
            ];
        }

        return [
            'id' => (string) ($pending['id'] ?? $pending['requestId'] ?? $this->store->id()),
            'kind' => $permission ? 'permission' : 'question',
            'summary' => mb_substr((string) ($pending['summary'] ?? $pending['message'] ?? 'T3 benötigt eine Eingabe.'), 0, 2000),
            'questions' => $questions,
            'external_url' => isset($pending['url']) ? (string) $pending['url'] : null,
            'answerable_via_api' => !$permission && (bool) ($pending['answerableViaApi'] ?? true),
            'addressed_to' => $permission || ($pending['addressedTo'] ?? null) === 'owner' ? 'owner' : 'requester',
        ];
    }

    private function currentReport(array $run, bool $required = true): ?array
    {
        foreach (array_reverse($run['report_ids'] ?? []) as $reportId) {
            $report = $this->store->find('run_reports', (string) $reportId);
            if (null !== $report && (int) $report['attempt_no'] === (int) $run['attempt_no'] && (int) $report['task_revision'] === (int) $run['snapshot']['task_revision']) {
                return $report;
            }
        }
        if ($required) {
            throw new Problem(409, 'run_report_missing', 'Für den aktuellen Versuch liegt kein passender Ergebnisbericht vor.');
        }

        return null;
    }

    private function taskLink(string $taskId, string $linkId): array
    {
        $task = $this->record('tasks', $taskId);
        foreach ($this->store->all('link_collections', (string) $task['project_id']) as $collection) {
            if ($collection['task_id'] !== $taskId) {
                continue;
            }
            foreach (($collection['links'] ?? []) as $link) {
                if (($link['id'] ?? null) === $linkId) {
                    return $link;
                }
            }
        }

        throw new Problem(422, 'resource_not_found', 'Ein gemeldeter Ergebnislink gehört nicht zu diesem Aufgabenkontext.');
    }

    /** @param list<array<string, mixed>> $conditions */
    private function assertConditions(array $conditions, array $task, ?array $instance): void
    {
        if (!$this->conditionsSatisfied($conditions, $task, $instance)) {
            throw new Problem(409, 'workflow_entry_condition_unmet', 'Die Voraussetzungen für diese Workflowphase sind noch nicht erfüllt.');
        }
    }

    /** @param list<array<string, mixed>> $conditions */
    private function conditionsSatisfied(array $conditions, array $task, ?array $instance): bool
    {
        if ([] === $conditions) {
            return true;
        }
        $projection = $this->taskEvidenceProjection->projectTasks([$task])[$task['id']] ?? [
            'evidence' => [],
            'reports' => [],
        ];
        $compatibleRunIds = [];
        foreach ($projection['reports'] as $entry) {
            if (is_string($entry['run']['id'] ?? null)) {
                $compatibleRunIds[$entry['run']['id']] = true;
            }
        }
        $runs = array_filter(
            $this->store->all('runs', (string) $task['project_id']),
            static fn (array $run): bool => $run['task_id'] === $task['id']
                && ((int) $run['snapshot']['task_revision'] === (int) $task['version'] || isset($compatibleRunIds[$run['id']]))
                && (null === $instance || $run['workflow_instance_id'] === $instance['id']),
        );
        $runsById = array_column($runs, null, 'id');
        $taskEvidenceById = [];
        foreach ($this->store->all('evidence', (string) $task['project_id']) as $item) {
            if ($item['task_id'] === $task['id']
                && 'rejected' !== ($item['review_status'] ?? null)
                && $this->taskEvidenceEligibility->isCurrent($item, $task, $projection)) {
                $taskEvidenceById[$item['id']] = $item;
            }
        }
        $taskEvidence = array_values($taskEvidenceById);
        $approvals = array_filter($this->store->all('approvals', (string) $task['project_id']), static function (array $approval) use ($runsById): bool {
            $run = $runsById[$approval['run_id']] ?? null;

            return null !== $run && 'approved' === $approval['status'] && $approval['attempt_no'] === $run['attempt_no']
                && $approval['task_revision'] === $run['snapshot']['task_revision']
                && is_string($run['result_digest']) && hash_equals($run['result_digest'], $approval['result_digest']);
        });
        $reviewStageIds = array_column(array_filter($instance['definition_snapshot']['stages'] ?? [], static fn (array $stage): bool => 'review' === $stage['kind']), 'id');
        foreach ($conditions as $condition) {
            $type = $condition['type'];
            $satisfied = match ($type) {
                'all_required_criteria_human_confirmed' => array_reduce(
                    $task['criteria'] ?? [],
                    static fn (bool $carry, array $criterion): bool => $carry
                        && (empty($criterion['is_required']) || 'human_confirmed' === $criterion['state']),
                    true,
                ),
                'required_evidence_reported' => (bool) array_filter(
                    $taskEvidence,
                    static fn (array $item): bool => $item['kind'] === ($condition['evidence_kind'] ?? null)
                        && 'rejected' !== $item['review_status'],
                ),
                'required_evidence_human_confirmed' => (bool) array_filter(
                    $taskEvidence,
                    static fn (array $item): bool => $item['kind'] === ($condition['evidence_kind'] ?? null)
                        && 'human_confirmed' === $item['review_status'],
                ),
                'human_approval_granted' => [] !== $approvals,
                'review_report_accepted' => (bool) array_filter(
                    $runs,
                    fn (array $run): bool => 'succeeded' === $run['state']
                        && ('review' === $run['stage'] || in_array($run['stage'], $reviewStageIds, true))
                        && ($this->currentReport($run, false)['outcome'] ?? null) === 'reported_success',
                ),
                'run_succeeded' => (bool) array_filter($runs, static fn (array $run): bool => 'succeeded' === $run['state']),
                'intake_ready' => ($task['classification_required'] ?? false) ? ($task['intake_outcome'] ?? null) === 'ready' : true,
                'no_human_attention' => !$this->hasOpenOwnerAttention((string) $task['id'], (string) $task['project_id']),
                default => false,
            };
            if (!$satisfied) {
                return false;
            }
        }

        return true;
    }

    private function hasOpenOwnerAttention(string $taskId, string $projectId): bool
    {
        foreach ($this->store->all('attention_reasons', $projectId) as $reason) {
            if ($reason['task_id'] === $taskId && !empty($reason['open']) && ($reason['addressed_to'] ?? null) === 'owner') {
                return true;
            }
        }

        return false;
    }

    private function openAttention(string $taskId, string $projectId, string $code, string $addressedTo): void
    {
        foreach ($this->store->all('attention_reasons', $projectId) as $reason) {
            if (
                $reason['task_id'] === $taskId
                && $reason['code'] === $code
                && ($reason['source'] ?? null) === 'orchestration'
                && ($reason['addressed_to'] ?? null) === $addressedTo
                && !empty($reason['open'])
            ) {
                return;
            }
        }
        $this->store->save('attention_reasons', [
            'task_id' => $taskId, 'project_id' => $projectId, 'code' => $code,
            'source' => 'orchestration', 'open' => true, 'addressed_to' => $addressedTo,
            'created_at' => $this->store->now(), 'resolved_at' => null,
        ], 'attention.reason_opened');
    }

    private function resolveAttention(string $taskId, string $code): void
    {
        $task = $this->store->find('tasks', $taskId);
        if (null === $task) {
            return;
        }
        foreach ($this->store->all('attention_reasons', (string) $task['project_id']) as $reason) {
            if ($reason['task_id'] === $taskId && $reason['code'] === $code && ($reason['source'] ?? null) === 'orchestration' && !empty($reason['open'])) {
                $reason['open'] = false;
                $reason['resolved_at'] = $this->store->now();
                $this->store->save('attention_reasons', $reason, 'attention.reason_resolved');
            }
        }
    }

    private function defaultRunPolicy(): array
    {
        return [
            'require_external_settled' => true,
            'required_evidence_kinds' => [],
            'required_criterion_ids' => [],
            'require_human_phase_decision' => false,
            'require_human_confirmed_evidence' => false,
        ];
    }

    private function dispatchMessage(array $run, string $taskKey, string $template): string
    {
        $snapshot = $run['snapshot'];
        $template = strtr($template, ['{{task.title}}' => (string) $snapshot['title'], '{{task.description}}' => (string) $snapshot['description']]);
        $criteria = array_map(static fn (array $criterion): string => '- '.$criterion['text'].' (ID: '.$criterion['id'].')', $snapshot['criteria'] ?? []);
        $workflowVersion = (int) ($snapshot['workflow_version'] ?? 0);
        $workflowVersionLine = $workflowVersion > 0 ? "Workflowversion: {$workflowVersion}\n" : '';
        $handoffArguments = 'task_id='.(string) $run['task_id'];
        if (isset($snapshot['handoff_source_run_id'])) {
            $handoffArguments .= ', source_run_id='.(string) $snapshot['handoff_source_run_id'];
        }
        $body = "Falkenwarte-Auftrag\n"
            ."Projekt-ID: {$run['project_id']}\n"
            ."Ticket-ID: {$run['task_id']}\n"
            ."Ticket-Key: {$taskKey}\n"
            ."Phase-ID: {$run['stage']}\n"
            .$workflowVersionLine
            ."Run-ID: {$run['id']}\n"
            ."Versuch: {$run['attempt_no']}\n"
            ."Aufgabenrevision: {$snapshot['task_revision']}\n\n"
            ."Aufgabe: {$snapshot['title']}\n\n"
            .(string) $snapshot['description'];
        if ([] !== $criteria) {
            $body .= "\n\nAkzeptanzkriterien:\n".implode("\n", $criteria);
            $body .= "\nGib im Ergebnisbericht für jeden Nachweis unter artifacts[].criterion_ids die IDs genau der Kriterien an, die er belegt. Nenne die durchgeführten Prüfungen mit ihren tatsächlichen Ergebnissen.";
        }
        if (is_string($snapshot['stage_name'] ?? null) || is_string($snapshot['stage_kind'] ?? null)) {
            $body .= "\n\nWorkflowphase:\n";
            if (is_string($snapshot['stage_name'] ?? null)) {
                $body .= 'Name: '.$snapshot['stage_name']."\n";
            }
            if (is_string($snapshot['stage_kind'] ?? null)) {
                $body .= 'Art: '.$snapshot['stage_kind']."\n";
            }
            $instructions = trim((string) ($snapshot['stage_instructions'] ?? ''));
            if ('' !== $instructions) {
                $body .= "Phasenauftrag:\n".$instructions;
            }
        }
        $workflowRoutes = $snapshot['workflow_routes'] ?? [];
        if ([] !== $workflowRoutes) {
            $body .= "\n\nEingefrorene Workflowrouten:\n";
            foreach ($workflowRoutes as $route) {
                $reportOutcome = 'accepted' === $route['on'] ? 'reported_success' : $route['on'];
                $selection = !empty($route['is_default'])
                    ? 'Standardroute (route_label_id: null)'
                    : sprintf('%s (route_label_id: %s)', $route['route_label_name'], $route['route_label_id']);
                $body .= sprintf(
                    '- Bei Ergebnis %s: Zielphase „%s“ (Phase-ID: %s), Auswahl %s.\n',
                    $reportOutcome,
                    $route['to_stage_name'],
                    $route['to_stage_id'],
                    $selection,
                );
            }
            $body .= 'Sende in runs_report_result nur eine hier aufgeführte route_label_id, null für die ausdrücklich gewählte Standardroute oder lasse das Feld weg, damit Falkenwarte die Ticket-Themenlabels auswertet.';
        }
        if ('' !== trim($template)) {
            $body .= "\n\nRollenhinweise:\n".$template;
        }
        if (isset($snapshot['handoff_snapshot'])) {
            $handoff = $snapshot['handoff_snapshot'];
            $body .= "\n\nÜbergabe aus Lauf ".$snapshot['handoff_source_run_id']." (Agentenmeldung)\n";
            $body .= json_encode($handoff, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }
        $body .= "\n\nArbeitsbeginn:\n"
            .'Nutze den Skill falkenwarte, falls er in deiner T3-Umgebung verfügbar ist; andernfalls arbeite anhand dieses Auftrags weiter.'
            ."\nMit `tasks.read`: `task_handoff_get({$handoffArguments})` und den kuratierten Kontext nutzen."
            .' Mit `runs.read`: `runs_get(run_id='.$run['id'].')` für die aktuelle `expected_version`; mit `runs.report`: `runs_report_result` mit '
            .'run_id='.$run['id'].', attempt_no='.$run['attempt_no'].', task_revision='.$snapshot['task_revision']
            .'. Fehlt Freigabe oder Version, frage nach. Falkenwarte prüft keinen Code und lädt keine Links herunter.';

        return $body;
    }

    private function deadline(int $seconds): string
    {
        return (new \DateTimeImmutable($this->store->now()))->modify('+'.$seconds.' seconds')->format(DATE_ATOM);
    }

    /** @param array<string, mixed> $schedule */
    private function nextDue(array $schedule, ?\DateTimeImmutable $from = null): ?string
    {
        $from ??= new \DateTimeImmutable($this->store->now());
        $kind = $schedule['kind'] ?? null;
        if ('once' === $kind) {
            $due = new \DateTimeImmutable((string) $schedule['run_at']);

            return $due > $from ? $due->format(DATE_ATOM) : null;
        }
        if ('interval' === $kind) {
            return $from->modify('+'.max(60, (int) $schedule['every_seconds']).' seconds')->format(DATE_ATOM);
        }
        if ('daily' === $kind) {
            $timezone = new \DateTimeZone((string) $schedule['timezone']);
            $candidate = $from->setTimezone($timezone)->setTime((int) substr($schedule['local_time'], 0, 2), (int) substr($schedule['local_time'], 3, 2));
            if ($candidate <= $from->setTimezone($timezone)) {
                $candidate = $candidate->modify('+1 day');
            }
            $weekdays = $schedule['weekdays'] ?? [];
            for ($offset = 0; $offset < 7; ++$offset) {
                if ([] === $weekdays || in_array((int) $candidate->format('N'), $weekdays, true)) {
                    return $candidate->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM);
                }
                $candidate = $candidate->modify('+1 day');
            }
        }

        return null;
    }
}
