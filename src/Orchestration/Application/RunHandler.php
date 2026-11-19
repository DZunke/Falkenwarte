<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

final class RunHandler
{
    private const T3_BRIDGE_ID = 't3.mcp.v0_1_10';
    private const ACTIVE_RUN_STATES = ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested', 'result_reported', 'verifying'];

    private readonly AgentExecutionBridge $bridge;

    public function __construct(public Store $store, AgentExecutionBridge $bridge, private readonly T3OAuthClient $oauth)
    {
        $this->bridge = $bridge;
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'project_binding_get', 'project_binding_set',
            'connections_list', 'connections_create', 'connections_get', 'connections_update', 'connections_check', 'connection_check_get',
            'connection_capabilities_get', 'connection_projects_list', 'connection_oauth_start', 'connection_oauth_callback', 'connection_credentials_remove',
            'agent_profiles_list', 'agent_profiles_create', 'agent_profiles_get', 'agent_profiles_replace',
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
            'project_binding_get' => $this->getBinding($this->pathId($p, 'project_id'), $actor),
            'project_binding_set' => $this->setBinding($this->pathId($p, 'project_id'), $body, $actor),
            'connections_list' => $this->listConnections($p, $actor),
            'connections_create' => $this->createConnection($body, $actor),
            'connections_get' => $this->getConnection($this->pathId($p, 'connection_id'), $actor),
            'connections_update' => $this->updateConnection($this->pathId($p, 'connection_id'), $body, $actor),
            'connections_check' => $this->checkConnection($this->pathId($p, 'connection_id'), $body, $actor),
            'connection_check_get' => $this->getConnectionCheck($this->pathId($p, 'connection_id'), $actor),
            'connection_capabilities_get' => $this->getCapabilities($this->pathId($p, 'connection_id'), $actor),
            'connection_projects_list' => $this->listRemoteProjects($this->pathId($p, 'connection_id'), $p, $actor),
            'connection_oauth_start' => $this->startOAuth($this->pathId($p, 'connection_id'), $body, $actor),
            'connection_oauth_callback' => $this->finishOAuth($p),
            'connection_credentials_remove' => $this->removeCredentials($this->pathId($p, 'connection_id'), $actor),
            'agent_profiles_list' => $this->listProfiles($p, $actor),
            'agent_profiles_create' => $this->writeProfile(null, $body, $actor),
            'agent_profiles_get' => $this->getProfile($this->pathId($p, 'profile_id'), $actor),
            'agent_profiles_replace' => $this->writeProfile($this->pathId($p, 'profile_id'), $body, $actor),
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
            'workflow.advance' => $this->advanceWorkflow($this->jobId($payload, 'instance_id')),
            'workflow.trigger' => $this->fireTrigger($this->jobId($payload, 'trigger_id'), $payload),
            'connection.check' => $this->performConnectionCheck($this->jobId($payload, 'check_id')),
            'run.restore_inventory' => $this->restoreInventory($payload),
            'recovery.entry.observe' => $this->observeRecoveryEntry($this->jobId($payload, 'entry_id')),
            default => throw new Problem(422, 'unsupported_job', 'Unbekannter Orchestrierungsauftrag.'),
        };
    }

    public function scheduleDue(): void
    {
        $now = $this->store->now();
        $this->store->atomic(function () use ($now): void {
            if ($this->activeRecoveryGate() === null) {
            foreach ($this->store->all('triggers') as $trigger) {
                if (!$trigger['enabled'] || $trigger['spec']['type'] !== 'schedule' || $trigger['next_due_at'] === null || $trigger['next_due_at'] > $now) {
                    continue;
                }
                $trigger['next_due_at'] = $this->nextDue($trigger['spec']['schedule'], new DateTimeImmutable($now));
                $trigger['last_fired_at'] = $now;
                $this->store->save('triggers', $trigger, 'workflow.trigger_due');
                $this->store->enqueue('workflow.trigger', ['trigger_id' => $trigger['id'], 'scheduled_at' => $now]);
            }
            $allEvents = $this->store->all('events');
            foreach ($this->store->all('triggers') as $trigger) {
                if (!$trigger['enabled'] || ($trigger['spec']['type'] ?? null) !== 'domain_event') {
                    continue;
                }
                $events = $allEvents;
                $cursor = $trigger['last_event_id'] ?? null;
                if ($cursor !== null) {
                    $cursorIndex = null;
                    foreach ($events as $index => $event) {
                        if (($event['event_id'] ?? $event['id'] ?? null) === $cursor) {
                            $cursorIndex = $index;
                            break;
                        }
                    }
                    $events = $cursorIndex === null ? [] : array_slice($events, $cursorIndex + 1);
                }
                foreach ($events as $event) {
                    $eventId = (string) ($event['event_id'] ?? $event['id'] ?? '');
                    if ($eventId === '') {
                        continue;
                    }
                    if (($event['project_id'] ?? null) !== $trigger['project_id'] || $event['event_type'] !== $trigger['spec']['event_type']) {
                        $trigger['last_event_id'] = $eventId;
                        $this->store->save('triggers', $trigger, 'workflow.domain_event_cursor_advanced');
                        continue;
                    }
                    $taskId = $event['data']['task_id'] ?? $event['aggregate']['id'] ?? null;
                    $task = is_string($taskId) ? $this->store->find('tasks', $taskId) : null;
                    if ($task === null || $task['project_id'] !== $trigger['project_id']) {
                        $trigger['last_event_id'] = $eventId;
                        $this->store->save('triggers', $trigger, 'workflow.domain_event_cursor_advanced');
                        continue;
                    }
                    $statusId = $trigger['spec']['task_status_id'] ?? null;
                    if ($statusId !== null && $task['status_id'] !== $statusId) {
                        $trigger['last_event_id'] = $eventId;
                        $this->store->save('triggers', $trigger, 'workflow.domain_event_cursor_advanced');
                        continue;
                    }
                    $this->store->enqueue('workflow.trigger', [
                        'trigger_id' => $trigger['id'], 'event_id' => $eventId,
                        'event_type' => $event['event_type'], 'task_id' => $task['id'],
                    ]);
                    $trigger['last_event_id'] = $eventId;
                    $trigger['last_fired_at'] = $now;
                    $this->store->save('triggers', $trigger, 'workflow.domain_event_triggered');
                }
            }
            foreach ($this->store->all('run_observation_schedules') as $schedule) {
                if ($schedule['next_due_at'] > $now) {
                    continue;
                }
                $run = $this->store->find('runs', (string) $schedule['run_id']);
                if ($run === null || !in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $this->store->remove('run_observation_schedules', $schedule['id'], 'run.observation_schedule_removed');
                    continue;
                }
                $schedule['next_due_at'] = (new DateTimeImmutable($now))->modify('+5 seconds')->format(DATE_ATOM);
                $this->store->save('run_observation_schedules', $schedule, 'run.observation_scheduled');
                $this->store->enqueue('run.observe', ['run_id' => $run['id']]);
            }
            }
            foreach ($this->store->all('recovery_observation_schedules') as $schedule) {
                if ($schedule['next_due_at'] > $now) {
                    continue;
                }
                $entry = $this->store->find('recovery_entries', (string) $schedule['entry_id']);
                if ($entry === null || in_array($entry['status'] ?? null, ['resolved', 'stopped'], true) || empty($entry['external_thread_id'])) {
                    $this->store->remove('recovery_observation_schedules', $schedule['id'], 'recovery.observation_schedule_removed');
                    continue;
                }
                $schedule['next_due_at'] = (new DateTimeImmutable($now))->modify('+5 seconds')->format(DATE_ATOM);
                $this->store->save('recovery_observation_schedules', $schedule, 'recovery.observation_scheduled');
                $this->store->enqueue('recovery.entry.observe', ['entry_id' => $entry['id']]);
            }
        });
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listConnections(array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $items = $this->store->all('connections');
        usort($items, static fn (array $a, array $b): int => strcasecmp((string) $a['name'], (string) $b['name']));

        return $this->store->page(array_map($this->publicRecord(...), $items), $p);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createConnection(array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $url = $this->canonicalHttpsUrl((string) $body['canonical_url']);
        $connection = $this->store->save('connections', [
            'name' => trim((string) $body['name']),
            'bridge_id' => $this->bridgeId((string) $body['bridge_id']),
            'canonical_url' => $url,
            'health' => 'unconfigured',
            'auth_status' => 'missing',
            'auth_epoch' => 0,
            'auth_expires_at' => null,
            'last_success_at' => null,
            'capability_snapshot_id' => null,
            'diagnostic' => null,
        ], 't3_connection.created');

        return $this->publicRecord($connection);
    }

    /** @return array<string, mixed> */
    private function getConnection(string $id, Actor $actor): array
    {
        $actor->requireOwner();

        return $this->publicRecord($this->record('connections', $id));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateConnection(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        $previousUrl = $connection['canonical_url'];
        if (isset($body['name'])) {
            $connection['name'] = trim((string) $body['name']);
        }
        if (isset($body['canonical_url'])) {
            $connection['canonical_url'] = $this->canonicalHttpsUrl((string) $body['canonical_url']);
        }
        if ($connection['canonical_url'] !== $previousUrl) {
            $connection['auth_status'] = 'missing';
            $connection['auth_expires_at'] = null;
            $connection['health'] = 'unconfigured';
            $connection['capability_snapshot_id'] = null;
            $connection['diagnostic'] = 'Die T3-Adresse wurde geändert. Eine neue OAuth-Anmeldung und der Abgleich offener Läufe sind erforderlich.';
            unset($connection['credential_secret_ref'], $connection['oauth_client_id'], $connection['oauth_issuer']);
            foreach ($this->store->all('runs') as $run) {
                if ($this->runUsesConnection($run, $id) && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $run['state'] = 'reconciling';
                    $run['status_reason'] = 'Die T3-Adresse wurde geändert. Der externe Ausgang muss abgeglichen werden.';
                    $this->store->save('runs', $run, 'run.reconciliation_required');
                    $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
                }
            }
        }

        return $this->publicRecord($this->store->save('connections', $connection, 't3_connection.updated'));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function checkConnection(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        $check = $this->store->save('connection_checks', [
            'connection_id' => $id,
            'checked_at' => $this->store->now(),
            'network' => 'not_checked',
            'authentication' => 'not_checked',
            'mcp_handshake' => 'not_checked',
            'capabilities' => 'not_checked',
            'diagnostic' => null,
            'snapshot_id' => null,
            'status' => 'queued',
        ], 't3_connection.check_requested');
        $this->store->enqueue('connection.check', ['check_id' => $check['id']]);

        return ['action_id' => $check['id'], 'status' => 'accepted', 'action_url' => '/api/v1/connections/'.$id.'/check', 'resource' => ['type' => 'connection_check', 'id' => $check['id']], 'run_id' => null];
    }

    /** @return array<string, mixed> */
    private function getConnectionCheck(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $this->record('connections', $id);
        $checks = array_values(array_filter($this->store->all('connection_checks'), static fn (array $check): bool => $check['connection_id'] === $id));
        usort($checks, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $checks[0] ?? throw new Problem(404, 'resource_not_found', 'Es liegt noch keine Verbindungsprüfung vor.');
    }

    /** @return array<string, mixed> */
    private function getCapabilities(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        $snapshotId = $connection['capability_snapshot_id'] ?? null;
        if (!is_string($snapshotId) || $snapshotId === '') {
            throw new Problem(404, 'resource_not_found', 'Für diese T3-Verbindung liegt noch kein Fähigkeitssnapshot vor.');
        }

        return $this->record('capability_snapshots', $snapshotId);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listRemoteProjects(string $id, array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        $result = $this->bridge->projects($connection, $this->connectionToken($connection), isset($p['cursor']) ? (string) $p['cursor'] : null, min(100, max(1, (int) ($p['limit'] ?? 50))));
        $items = $result['items'];
        $page = $this->store->page($items, $p);
        if (isset($result['next_cursor'])) {
            $page['next_cursor'] = $result['next_cursor'];
        }

        return $page;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function startOAuth(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        $resourceUrl = rtrim($connection['canonical_url'], '/').'/mcp';
        $callback = (string) ($body['redirect_uri'] ?? (rtrim((string) (getenv('FALKENWARTE_PUBLIC_URL') ?: 'https://localhost:8443'), '/').'/auth/t3/callback'));
        if (!$this->isHttpsUrl($callback) && !preg_match('#^http://127\.0\.0\.1(?::[0-9]+)?/#', $callback)) {
            throw new Problem(422, 'validation_failed', 'Der OAuth-Callback muss eine HTTPS-Adresse oder Loopback-Adresse verwenden.');
        }
        $state = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $registration = $this->oauth->begin((string) $connection['canonical_url'], $callback, $resourceUrl, $state, $challenge);
        $verifierRef = 'oauth-verifier-'.$this->store->id();
        $this->store->putSecret($verifierRef, $verifier);
        $expiresAt = (new DateTimeImmutable('+10 minutes'))->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
        $this->store->save('oauth_flows', [
            'connection_id' => $id,
            'state_hash' => hash('sha256', $state),
            'issuer' => $registration['issuer'],
            'authorization_server' => $registration['authorization_server'],
            'token_endpoint' => $registration['token_endpoint'],
            'client_id' => $registration['client_id'],
            'callback_url' => $callback,
            'resource_url' => $resourceUrl,
            'verifier_secret_ref' => $verifierRef,
            'expires_at' => $expiresAt,
            'consumed' => false,
        ], 't3_oauth.started');
        $connection['auth_status'] = 'pending';
        $this->store->save('connections', $connection, 't3_connection.authorization_started');
        return ['authorization_url' => $registration['authorization_url'], 'callback_url' => $callback, 'expires_at' => $expiresAt];
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function finishOAuth(array $p): array
    {
        $state = (string) ($p['state'] ?? '');
        $flow = null;
        foreach ($this->store->all('oauth_flows') as $candidate) {
            if (hash_equals((string) $candidate['state_hash'], hash('sha256', $state))) {
                $flow = $candidate;
                break;
            }
        }
        if ($flow === null || $flow['consumed'] || strtotime((string) $flow['expires_at']) <= time()) {
            throw new Problem(400, 't3_oauth_state_invalid', 'Die T3-Anmeldung ist abgelaufen oder ihre Browserbestätigung passt nicht.');
        }
        if (isset($p['iss']) && rtrim((string) $p['iss'], '/') !== rtrim((string) $flow['issuer'], '/')) {
            throw new Problem(400, 't3_oauth_issuer_mismatch', 'Der OAuth-Issuer stimmt nicht mit der entdeckten T3-Verbindung überein.');
        }
        $flow['consumed'] = true;
        $this->store->save('oauth_flows', $flow, 't3_oauth.callback_received');
        $connection = $this->record('connections', (string) $flow['connection_id']);
        if (isset($p['error'])) {
            $connection['auth_status'] = 'revoked';
            $connection['diagnostic'] = mb_substr((string) ($p['error_description'] ?? $p['error']), 0, 500);
            $this->store->save('connections', $connection, 't3_connection.authorization_failed');

            return ['redirect' => $this->settingsRedirect($connection['id'], 'authorization_failed')];
        }
        $code = (string) ($p['code'] ?? '');
        if ($code === '') {
            throw new Problem(400, 't3_oauth_code_missing', 'T3 hat keinen Autorisierungscode zurückgegeben.');
        }
        $verifier = $this->store->secret((string) $flow['verifier_secret_ref']);
        $token = $this->oauth->exchange((string) $flow['token_endpoint'], $code, (string) $flow['callback_url'], (string) $flow['client_id'], $verifier, (string) $flow['resource_url']);
        if (!is_string($token['access_token'] ?? null) || $token['access_token'] === '') {
            throw new Problem(502, 't3_oauth_invalid_response', 'T3 hat kein verwendbares Zugangstoken ausgegeben.');
        }
        $secretRef = (string) ($connection['credential_secret_ref'] ?? ('t3-credential-'.$connection['id']));
        $this->store->putSecret($secretRef, $token['access_token']);
        $connection['credential_secret_ref'] = $secretRef;
        $connection['oauth_client_id'] = $flow['client_id'];
        $connection['oauth_issuer'] = $flow['issuer'];
        $connection['auth_epoch'] = (int) $connection['auth_epoch'] + 1;
        $connection['auth_status'] = 'valid';
        $connection['auth_expires_at'] = isset($token['expires_in']) ? (new DateTimeImmutable('+'.max(1, (int) $token['expires_in']).' seconds'))->format(DATE_ATOM) : null;
        $connection['diagnostic'] = null;
        $this->store->save('connections', $connection, 't3_connection.authorized');
        foreach ($this->store->all('runs') as $run) {
            if ($this->runUsesConnection($run, $connection['id']) && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                $run['state'] = 'reconciling';
                $run['status_reason'] = 'Die T3-Autorisierung wurde erneuert. Der zuvor gestartete Auftrag wird im gespeicherten Kontext abgeglichen.';
                $this->store->save('runs', $run, 'run.reconciliation_required');
                $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
            }
        }

        return ['redirect' => $this->settingsRedirect($connection['id'], 'authorized')];
    }

    /** @return array<string, mixed> */
    private function removeCredentials(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', $id);
        if (isset($connection['credential_secret_ref'])) {
            $this->store->deleteSecret((string) $connection['credential_secret_ref']);
        }
        unset($connection['credential_secret_ref']);
        $connection['auth_status'] = 'missing';
        $connection['auth_expires_at'] = null;
        $connection['diagnostic'] = 'Die lokale T3-Autorisierung wurde entfernt.';
        $this->store->save('connections', $connection, 't3_connection.credentials_removed');
        foreach ($this->store->all('runs') as $run) {
            if ($this->runUsesConnection($run, $id) && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                $run['state'] = 'auth_blocked';
                $run['status_reason'] = 'Für die Beobachtung oder Fortsetzung wird eine neue T3-Anmeldung benötigt.';
                $this->store->save('runs', $run, 'run.auth_blocked');
            }
        }

        return $this->publicRecord($connection);
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listProfiles(array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $items = $this->store->all('agent_profiles');
        if (isset($p['enabled'])) {
            $enabled = filter_var($p['enabled'], FILTER_VALIDATE_BOOLEAN);
            $items = array_values(array_filter($items, static fn (array $item): bool => (bool) $item['enabled'] === $enabled));
        }

        return $this->store->page(array_map($this->publicRecord(...), $items), $p);
    }

    /** @return array<string, mixed> */
    private function getProfile(string $id, Actor $actor): array
    {
        $actor->requireOwner();

        return $this->publicRecord($this->record('agent_profiles', $id));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function writeProfile(?string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->record('connections', (string) $body['connection_id']);
        $executionTarget = $body['execution_target'];
        if (($executionTarget['mode'] ?? null) === 't3_reference_thread' && empty($executionTarget['reference_thread_id'])) {
            throw new Problem(422, 'validation_failed', 'Ein T3-Referenzthread benötigt eine konkrete Thread-ID.');
        }
        if (($body['max_parallel_runs'] ?? 1) !== 1) {
            throw new Problem(422, 'validation_failed', 'Ein Agentprofil darf im aktuellen Umfang höchstens einen Auftrag gleichzeitig starten.');
        }
        foreach (($body['allowed_project_ids'] ?? []) as $projectId) {
            $project = $this->record('projects', (string) $projectId);
            if (!empty($project['archived'])) {
                throw new Problem(409, 'project_archived', 'Archivierte Projekte können keinem neuen Agentprofil zugeordnet werden.');
            }
        }
        $profile = $id === null ? [] : $this->record('agent_profiles', $id);
        $profile = array_replace($profile, $body, [
            'max_parallel_runs' => 1,
            'prompt_template' => (string) ($body['prompt_template'] ?? ($profile['prompt_template'] ?? '')),
            'prompt_template_version' => (int) ($profile['prompt_template_version'] ?? 0) + (($id === null || ($body['prompt_template'] ?? '') !== ($profile['prompt_template'] ?? '')) ? 1 : 0),
            'default_run_completion_policy' => $body['default_run_completion_policy'] ?? ($profile['default_run_completion_policy'] ?? $this->defaultRunPolicy()),
            'configuration_valid' => $connection['auth_status'] === 'valid' && $connection['health'] !== 'incompatible',
            'configuration_error' => $connection['auth_status'] !== 'valid' ? 'T3-Verbindung ist noch nicht autorisiert.' : ($connection['health'] === 'incompatible' ? 'T3 stellt die erforderlichen MCP-Fähigkeiten nicht bereit.' : null),
        ]);
        if ($id !== null && ($body['prompt_template'] ?? null) !== ($this->record('agent_profiles', $id)['prompt_template'] ?? null)) {
            $profile['prompt_template_version'] = (int) ($this->record('agent_profiles', $id)['prompt_template_version'] ?? 0) + 1;
        }
        $saved = $this->store->save('agent_profiles', $profile, $id === null ? 'agent_profile.created' : 'agent_profile.updated');

        return $this->publicRecord($saved);
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
                $items = array_values(array_filter($items, static fn (array $run): bool => ($filter === 'agent_profile_id' ? ($run['snapshot']['agent_profile_id'] ?? null) : $run[$filter] ?? null) === $p[$filter]));
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
        $this->assertTaskCanStart($task);
        if ((int) $task['version'] !== (int) $body['task_revision']) {
            throw new Problem(412, 'version_conflict', 'Die Aufgabe hat sich seit dem gelesenen Stand geändert.');
        }

        return $this->store->atomic(function () use ($task, $body, $projectId): array {
            $profile = $this->record('agent_profiles', (string) $body['agent_profile_id']);
            if (!$profile['enabled'] || !$profile['configuration_valid']) {
                throw new Problem(409, 'agent_profile_unavailable', (string) ($profile['configuration_error'] ?? 'Das Agentprofil ist nicht startbereit.'));
            }
            if (!in_array($projectId, $profile['allowed_project_ids'], true)) {
                throw new Problem(403, 'forbidden', 'Dieses Agentprofil ist für das Projekt nicht freigegeben.');
            }
            $binding = $this->bindingForProject($projectId);
            if ($binding === null) {
                throw new Problem(409, 't3_project_unbound', 'Das Projekt ist noch keinem vorhandenen T3-Projekt zugeordnet.');
            }
            $connection = $this->record('connections', (string) $binding['connection_id']);
            if ($connection['auth_status'] !== 'valid' || $connection['health'] === 'incompatible') {
                throw new Problem(409, 't3_connection_unavailable', 'Die T3-Verbindung ist nicht startbereit. Prüfe Verbindung und Anmeldung.');
            }
            if (($profile['connection_id'] ?? null) !== $connection['id']) {
                throw new Problem(409, 'agent_connection_mismatch', 'Agentprofil und Projektbindung verwenden unterschiedliche T3-Verbindungen.');
            }
            $this->assertCapabilities($connection, ['t3_thread_launch', 't3_thread_read']);
            foreach ($this->store->all('runs') as $existing) {
                if (($existing['snapshot']['project_binding_id'] ?? null) === $binding['id'] && in_array($existing['state'], self::ACTIVE_RUN_STATES, true)) {
                    throw new Problem(409, 'execution_slot_occupied', 'Für dieses T3-Projekt ist bereits ein Auftrag aktiv oder ungeklärt.');
                }
            }

            $workflowInstance = null;
            if (isset($body['workflow_instance_id'])) {
                $workflowInstance = $this->record('workflow_instances', (string) $body['workflow_instance_id']);
                if ($workflowInstance['task_id'] !== $task['id'] || $workflowInstance['project_id'] !== $projectId || $workflowInstance['state'] !== 'running' || $workflowInstance['current_stage_id'] !== $body['stage']) {
                    throw new Problem(409, 'run_context_mismatch', 'Der Workflow-Auftrag gehört nicht zur aktuellen Phase dieser Aufgabe.');
                }
            }

            $policy = $this->defaultRunPolicy();
            $workflowVersion = null;
            $routing = null;
            if ($workflowInstance !== null) {
                $workflow = $this->workflowDefinition((string) $workflowInstance['workflow_id'], (int) $workflowInstance['definition_version']);
                $stage = $this->stage($workflow, (string) $workflowInstance['current_stage_id']);
                if ($stage['agent_profile_id'] !== null && $stage['agent_profile_id'] !== $profile['id']) {
                    throw new Problem(409, 'run_context_mismatch', 'Das Agentprofil stimmt nicht mit der Version der aktiven Workflowphase überein.');
                }
                $this->assertConditions($stage['entry_conditions'] ?? [], $task, $workflowInstance);
                $policy = $stage['run_completion_policy'];
                $workflowVersion = (int) $workflowInstance['definition_version'];
            } else {
                $routing = $this->store->find('task_routing_snapshots', (string) $task['id']);
                if (!empty($task['workflow_label_id'])) {
                    if ($routing === null) {
                        throw new Problem(409, 'workflow_route_conflict', 'Die Aufgabe hat ein Workflowlabel, aber keine passende versionierte Route.');
                    }
                    $workflow = $this->workflowDefinition((string) $routing['workflow_id'], (int) $routing['workflow_definition_version']);
                    $stage = $this->stage($workflow, (string) $body['stage']);
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
                'classification_id' => $task['classification_id'] ?? null,
                'workflow_label_id' => $task['workflow_label_id'] ?? null,
                'routing_rules_version' => $routing['routing_rules_version'] ?? $task['routing_rules_version'] ?? null,
            ];
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
                'parent_run_id' => $body['parent_run_id'] ?? null,
                'workflow_instance_id' => $workflowInstance['id'] ?? null,
                'pending_input' => null,
                'result_digest' => null,
                'evidence_ids' => [],
                'report_ids' => [],
                'last_observed_at' => null,
                'status_reason' => null,
                '_dispatch_request' => null,
            ], 'run.queued');
            if ($workflowInstance !== null) {
                $workflowInstance['run_ids'][] = $run['id'];
                $this->store->save('workflow_instances', $workflowInstance, 'workflow.run_attached');
            }
            $this->store->enqueue('run.dispatch', ['run_id' => $run['id']]);

            return ['action_id' => $this->store->actionId(), 'status' => 'accepted', 'action_url' => '/api/v1/runs/'.$run['id'], 'resource' => ['type' => 'run', 'id' => $run['id']], 'run_id' => $run['id']];
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
        $run['state'] = 'cancel_requested';
        $run['status_reason'] = trim((string) $body['reason']);
        $run = $this->store->save('runs', $run, 'run.cancel_requested');
        $this->store->enqueue('run.cancel', ['run_id' => $id]);

        return ['action_id' => $this->store->actionId(), 'status' => 'accepted', 'action_url' => '/api/v1/runs/'.$id, 'resource' => ['type' => 'run', 'id' => $id], 'run_id' => $id];
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

        return ['action_id' => $this->store->actionId(), 'status' => 'accepted', 'action_url' => '/api/v1/runs/'.$id, 'resource' => ['type' => 'run', 'id' => $id], 'run_id' => $id];
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

        return ['action_id' => $this->store->actionId(), 'status' => 'accepted', 'action_url' => '/api/v1/runs/'.$id, 'resource' => ['type' => 'run', 'id' => $id], 'run_id' => $id];
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

        return $run;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function reportResult(string $id, array $body, Actor $actor): array
    {
        $run = $this->record('runs', $id);
        $actor->requireProject((string) $run['project_id']);
        $attempt = $this->attempt($run, (int) $body['attempt_no']);
        $task = $this->record('tasks', (string) $run['task_id']);
        $digest = hash('sha256', json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        $reportId = (string) $body['report_id'];
        $prior = $this->store->find('run_reports', $reportId);
        if ($prior !== null) {
            if (($prior['_digest'] ?? null) !== $digest) {
                throw new Problem(409, 'idempotency_conflict', 'Diese Report-ID wurde bereits mit anderem Inhalt verwendet.');
            }
            return $prior;
        }
        $isCurrent = (int) $body['task_revision'] === (int) $run['snapshot']['task_revision']
            && (int) $body['task_revision'] === (int) $task['version']
            && $attempt['attempt_no'] === (int) $run['attempt_no']
            && !in_array($run['state'], ['succeeded', 'failed', 'cancelled', 'abandoned'], true);
        $linkSnapshots = [];
        $linkIds = [];
        foreach ($body['artifacts'] as $artifact) {
            foreach (($artifact['link_ids'] ?? []) as $linkId) {
                $link = $this->taskLink((string) $task['id'], (string) $linkId);
                $linkIds[] = $linkId;
                $linkSnapshots[] = $link;
            }
        }
        $evidenceIds = [];
        foreach ($body['artifacts'] as $artifact) {
            $artifactLinks = array_values(array_intersect($artifact['link_ids'] ?? [], $linkIds));
            $evidence = $this->store->save('evidence', [
                'project_id' => $run['project_id'], 'task_id' => $run['task_id'], 'run_id' => $id,
                'attempt_no' => $attempt['attempt_no'], 'task_revision' => (int) $body['task_revision'],
                'kind' => (string) $artifact['kind'], 'label' => trim((string) $artifact['label']),
                'text' => $artifact['text'] ?? null, 'link_ids' => $artifactLinks, 'review_status' => 'reported',
                'reported_by' => $actor->ref(),
                'reviewed_at' => null, 'reviewed_by' => null, 'review_reason' => null,
                'criterion_ids' => [], 'link_snapshot' => array_values(array_filter($linkSnapshots, static fn (array $link): bool => in_array($link['id'], $artifactLinks, true))),
            ], 'evidence.reported');
            $evidenceIds[] = $evidence['id'];
        }
        $report = $this->store->save('run_reports', [
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
            '_open_questions' => array_values($body['open_questions'] ?? []),
        ], 'run.result_reported');
        if ($isCurrent) {
            $run['state'] = 'result_reported';
            $run['result_digest'] = $digest;
            $run['report_ids'][] = $reportId;
            $run['evidence_ids'] = array_values(array_unique(array_merge($run['evidence_ids'] ?? [], $evidenceIds)));
            $run['status_reason'] = null;
            $this->store->save('runs', $run, 'run.result_reported');
            $this->store->enqueue('run.reconcile', ['run_id' => $id]);
        }

        return $report;
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
                try { $actor->requireProject((string) $item['project_id']); return true; } catch (Problem) { return false; }
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
        if ($approval['status'] !== 'pending') {
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

            return $this->store->save('approvals', $approval, 'approval.invalidated');
        }
        $approval['status'] = (string) $body['decision'];
        $approval['decided_at'] = $this->store->now();
        $approval['decided_by'] = $actor->ref();
        $approval['reason'] = trim((string) $body['reason']);
        $approval = $this->store->save('approvals', $approval, 'approval.'.$approval['status']);
        $this->resolveAttention($run['task_id'], 'approval_pending');
        if ($approval['status'] === 'approved') {
            $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
        } else {
            $run['state'] = 'failed';
            $run['status_reason'] = 'Die Eigentümerentscheidung hat den gemeldeten Phasenabschluss zurückgewiesen.';
            $this->store->save('runs', $run, 'run.phase_rejected');
        }

        return $approval;
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listWorkflows(array $p, Actor $actor): array
    {
        $items = $this->store->all('workflows');
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
            $items = array_values(array_filter($items, static fn (array $item): bool => $item['project_id'] === $p['project_id'] || $item['project_id'] === null));
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $item) use ($actor): bool {
                if ($item['project_id'] === null) {
                    return true;
                }
                try { $actor->requireProject((string) $item['project_id']); return true; } catch (Problem) { return false; }
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
        if ($projectId !== null) {
            $project = $this->record('projects', (string) $projectId);
            if (!empty($project['archived']) && !empty($body['enabled'])) {
                throw new Problem(409, 'project_archived', 'Ein archiviertes Projekt kann keine aktive Workflowroute erhalten.');
            }
        }
        $this->validateWorkflowDefinition($body);
        $existing = $id === null ? null : $this->record('workflows', $id);
        if ($existing !== null && ($existing['project_id'] ?? null) !== $projectId) {
            throw new Problem(409, 'workflow_scope_immutable', 'Der Projektbereich eines Workflows bleibt nach dem Anlegen unverändert.');
        }
        $definitionVersion = $existing === null ? 1 : (int) $existing['definition_version'] + 1;
        $workflow = array_replace($existing ?? [], $body, ['definition_version' => $definitionVersion]);
        $saved = $this->store->save('workflows', $workflow, $existing === null ? 'workflow.created' : 'workflow.definition_replaced');
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
        if ($workflow['project_id'] !== null) {
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
        if ($record === null || $version < 1 || $version > (int) $workflow['definition_version']) {
            throw new Problem(404, 'resource_not_found', 'Diese Workflowversion ist nicht vorhanden.');
        }

        return $record;
    }

    /** @param array<string, mixed> $body */
    private function validateWorkflowDefinition(array $body): void
    {
        $stages = $body['stages'] ?? [];
        $stageIds = [];
        foreach ($stages as $stage) {
            $stageId = (string) ($stage['id'] ?? '');
            if ($stageId === '' || isset($stageIds[$stageId])) {
                throw new Problem(422, 'workflow_definition_invalid', 'Phasen benötigen eindeutige IDs.');
            }
            $stageIds[$stageId] = $stage;
            foreach (($stage['entry_conditions'] ?? []) as $condition) {
                $this->validateCondition($condition);
            }
            foreach (($stage['run_completion_policy']['required_criterion_ids'] ?? []) as $criterionId) {
                if ($criterionId === '') {
                    throw new Problem(422, 'workflow_definition_invalid', 'Ein Phasenkriterium muss eine gültige Aufgabenreferenz besitzen.');
                }
            }
            if (($stage['agent_profile_id'] ?? null) !== null) {
                $this->record('agent_profiles', (string) $stage['agent_profile_id']);
            }
        }
        if ($stages === []) {
            throw new Problem(422, 'workflow_definition_invalid', 'Ein Workflow benötigt mindestens eine Phase.');
        }
        $transitions = [];
        foreach (($body['transitions'] ?? []) as $transition) {
            $from = (string) $transition['from_stage_id'];
            $to = (string) $transition['to_stage_id'];
            $on = (string) $transition['on'];
            if (!isset($stageIds[$from], $stageIds[$to]) || ($from === $to && $on !== 'needs_changes')) {
                throw new Problem(422, 'workflow_definition_invalid', 'Jeder Übergang muss auf vorhandene Phasen verweisen.');
            }
            $key = $from.'|'.$on;
            if (isset($transitions[$key])) {
                throw new Problem(422, 'workflow_definition_ambiguous', 'Für dieselbe Phase und dasselbe Ergebnis gibt es mehrere mögliche Übergänge.');
            }
            $transitions[$key] = true;
            foreach (($transition['conditions'] ?? []) as $condition) {
                $this->validateCondition($condition);
            }
        }
        foreach (['max_repair_rounds', 'max_depth', 'max_parallel_runs', 'max_total_seconds'] as $limit) {
            if (!isset($body['limits'][$limit])) {
                throw new Problem(422, 'workflow_definition_invalid', 'Workflowgrenzen müssen vollständig angegeben sein.');
            }
        }
        if ((int) $body['limits']['max_parallel_runs'] > 1) {
            throw new Problem(422, 'workflow_definition_invalid', 'Im aktuellen Umfang ist höchstens ein aktiver Auftrag je T3-Projektbindung erlaubt.');
        }
    }

    /** @param array<string, mixed> $condition */
    private function validateCondition(array $condition): void
    {
        $allowed = ['all_required_criteria_human_confirmed', 'required_evidence_reported', 'required_evidence_human_confirmed', 'human_approval_granted', 'review_report_accepted', 'run_succeeded', 'intake_ready', 'no_human_attention'];
        if (!in_array($condition['type'] ?? null, $allowed, true)) {
            throw new Problem(422, 'workflow_condition_invalid', 'Der Workflow verwendet eine nicht registrierte Bedingung.');
        }
        if (str_starts_with((string) $condition['type'], 'required_evidence_') && !isset($condition['evidence_kind'])) {
            throw new Problem(422, 'workflow_condition_invalid', 'Die Bedingung benötigt eine Art des gemeldeten Nachweises.');
        }
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function startWorkflow(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->record('tasks', $taskId);
        $actor->requireProject((string) $task['project_id']);
        if ((int) $task['version'] !== (int) $body['task_revision']) {
            throw new Problem(412, 'version_conflict', 'Die Aufgabe hat sich seit dem gelesenen Stand geändert.');
        }
        $this->assertTaskCanStart($task);
        $routing = $this->store->find('task_routing_snapshots', $taskId);
        if (!empty($task['workflow_label_id']) && ($routing === null
            || $routing['workflow_id'] !== $body['workflow_id']
            || (int) $routing['workflow_definition_version'] !== (int) $body['definition_version'])) {
            throw new Problem(409, 'workflow_route_conflict', 'Der ausgewählte Workflow stimmt nicht mit der versionierten Aufgabenroute überein.');
        }
        $workflow = $this->workflowDefinition((string) $body['workflow_id'], (int) $body['definition_version']);
        if (!$workflow['enabled'] || ($workflow['project_id'] !== null && $workflow['project_id'] !== $task['project_id'])) {
            throw new Problem(409, 'workflow_unavailable', 'Der Workflow ist deaktiviert oder gehört zu einem anderen Projekt.');
        }
        if ($workflow['stages'] === []) {
            throw new Problem(409, 'workflow_definition_invalid', 'Der Workflow enthält keine startbare Phase.');
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
            'repair_round' => 0, 'pause_reason' => null, 'started_at' => $this->store->now(), 'deadline_at' => $this->deadline((int) $workflow['limits']['max_total_seconds']),
        ], 'workflow.started');
        if ($firstStage['agent_profile_id'] !== null) {
            $this->store->enqueue('workflow.advance', ['instance_id' => $instance['id']]);
        }

        return $instance;
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
        if ($body['action'] === 'pause') {
            if ($instance['state'] !== 'running') {
                throw new Problem(409, 'workflow_transition_invalid', 'Nur ein laufender Workflow kann pausiert werden.');
            }
            $instance['state'] = 'paused';
            $instance['pause_reason'] = trim((string) $body['reason']);
            $instance = $this->store->save('workflow_instances', $instance, 'workflow.paused');
        } elseif ($body['action'] === 'resume') {
            if ($instance['state'] !== 'paused') {
                throw new Problem(409, 'workflow_transition_invalid', 'Nur ein pausierter Workflow kann fortgesetzt werden.');
            }
            $instance['state'] = 'running';
            $instance['pause_reason'] = null;
            $instance = $this->store->save('workflow_instances', $instance, 'workflow.resumed');
            $this->store->enqueue('workflow.advance', ['instance_id' => $id]);
        } else {
            if (in_array($instance['state'], ['succeeded', 'failed', 'cancelled'], true)) {
                throw new Problem(409, 'workflow_transition_invalid', 'Dieser Workflow ist bereits beendet.');
            }
            $instance['state'] = 'cancelled';
            $instance['pause_reason'] = trim((string) $body['reason']);
            $instance = $this->store->save('workflow_instances', $instance, 'workflow.cancelled');
            foreach ($instance['run_ids'] as $runId) {
                $run = $this->store->find('runs', (string) $runId);
                if ($run !== null && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $run['state'] = 'cancel_requested';
                    $run['status_reason'] = 'Der übergeordnete Workflow wurde abgebrochen.';
                    $this->store->save('runs', $run, 'run.cancel_requested');
                    $this->store->enqueue('run.cancel', ['run_id' => $runId]);
                }
            }
        }

        return $instance;
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listWorkflowInstances(array $p, Actor $actor): array
    {
        $items = $this->store->all('workflow_instances', isset($p['project_id']) ? (string) $p['project_id'] : null);
        if (isset($p['project_id'])) {
            $actor->requireProject((string) $p['project_id']);
        } elseif (!$actor->owner) {
            $items = array_values(array_filter($items, function (array $instance) use ($actor): bool {
                try { $actor->requireProject((string) $instance['project_id']); return true; } catch (Problem) { return false; }
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
                try { $actor->requireProject((string) $item['project_id']); return true; } catch (Problem) { return false; }
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
        if (!$workflow['enabled'] || ($workflow['project_id'] !== null && $workflow['project_id'] !== $project['id'])) {
            throw new Problem(409, 'workflow_unavailable', 'Der Trigger verweist auf keinen aktiven Workflow dieses Projekts.');
        }
        $spec = $body['spec'];
        if (($spec['type'] ?? null) === 'plugin') {
            $plugin = $this->store->find('plugins', (string) $spec['plugin_id']);
            if ($plugin === null || $plugin['state'] !== 'enabled') {
                throw new Problem(409, 'capability_unavailable', 'Der konfigurierte Plugin-Trigger ist nicht aktiviert.');
            }
        }
        $trigger = $id === null ? [] : $this->record('triggers', $id);
        if ($id !== null && $trigger['project_id'] !== $body['project_id']) {
            throw new Problem(409, 'trigger_scope_immutable', 'Der Projektbereich eines Triggers bleibt nach dem Anlegen unverändert.');
        }
        $trigger = array_replace($trigger, $body, [
            'definition_version' => $workflowVersion,
            'next_due_at' => ($body['enabled'] && ($spec['type'] ?? null) === 'schedule') ? $this->nextDue($spec['schedule']) : null,
            'last_fired_at' => $trigger['last_fired_at'] ?? null,
            'last_error' => null,
            'last_event_id' => $trigger['last_event_id'] ?? null,
        ]);
        $saved = $this->store->save('triggers', $trigger, $id === null ? 'workflow.trigger_created' : 'workflow.trigger_updated');

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
        if ($attempt['external_thread_id'] !== null) {
            $this->observe($runId);

            return;
        }
        $connection = $this->record('connections', (string) $attempt['connection_id']);
        if ($connection['auth_status'] !== 'valid') {
            $run['state'] = 'auth_blocked';
            $run['status_reason'] = 'Die T3-Anmeldung fehlt oder ist abgelaufen. Melde dich erneut bei T3 an.';
            $this->store->save('runs', $run, 'run.auth_blocked');
            $this->openAttention($run['task_id'], $run['project_id'], 'auth_required', 'owner');

            return;
        }
        if ($attempt['external_thread_id'] === null && (int) ($attempt['auth_epoch'] ?? 0) !== (int) $connection['auth_epoch']) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Seit der ungeklärten T3-Annahme wurde eine neue OAuth-Session eingerichtet. Der alte Start darf nicht in einem anderen T3-Namespace wiederholt werden.';
            $this->store->save('runs', $run, 'run.new_auth_namespace_reconciliation_required');
            $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
            $this->removeObservationSchedule($runId);

            return;
        }
        $binding = $this->record('project_bindings', (string) $run['snapshot']['project_binding_id']);
        $payload = $run['_dispatch_request'] ?? null;
        if (!is_array($payload)) {
            $profile = $this->record('agent_profiles', (string) $run['snapshot']['agent_profile_id']);
            $message = $this->dispatchMessage($task, $profile, $run);
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
                if (!is_array($modelSelection) || !is_string($modelSelection['instanceId'] ?? null) || !is_string($modelSelection['model'] ?? null)) {
                    $run['state'] = 'auth_blocked';
                    $run['status_reason'] = 'T3 liefert für den Referenzthread keine belegten Provider- und Modellreferenzen.';
                    $this->store->save('runs', $run, 'run.reference_target_invalid');
                    $this->openAttention($run['task_id'], $run['project_id'], 'reference_target_invalid', 'owner');
                    return;
                }
                $payload['modelSelection'] = ['instanceId' => $modelSelection['instanceId'], 'model' => $modelSelection['model']];
            }
            $attempt['request_sha256'] = hash('sha256', $this->canonicalJson($payload));
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $run['_dispatch_request'] = $payload;
            $run['state'] = 'dispatching';
            $run['status_reason'] = null;
            $run = $this->store->save('runs', $run, 'run.dispatch_prepared');
        }
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
        if (!is_string($threadId) || $threadId === '') {
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
        $attempt['external_thread_id'] = $threadId;
        $attempt['external_dispatch_run_id'] = isset($result['runId']) ? (string) $result['runId'] : (isset($result['run_id']) ? (string) $result['run_id'] : null);
        $attempt['remote_status'] = (string) ($result['status'] ?? 'unknown');
        $attempt['started_at'] = $this->store->now();
        $attempts = $run['attempts'];
        $attempts[$attempt['attempt_no'] - 1] = $attempt;
        $run['attempts'] = $attempts;
        $run['state'] = 'running';
        $run['status_reason'] = null;
        $run = $this->store->save('runs', $run, 'run.external_launch_accepted');
        $this->resolveAttention($run['task_id'], 'auth_required');
        $this->scheduleObservation($runId);
        $this->store->enqueue('run.observe', ['run_id' => $runId]);
    }

    private function observe(string $runId): void
    {
        $run = $this->record('runs', $runId);
        if (!in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
            return;
        }
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        if ($attempt['external_thread_id'] === null) {
            if (in_array($run['state'], ['queued', 'dispatching'], true)) {
                return;
            }
            $connection = $this->record('connections', (string) $attempt['connection_id']);
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
        $connection = $this->record('connections', (string) $attempt['connection_id']);
        try {
            $remote = $this->bridge->readThread($connection, $this->connectionToken($connection), (string) $attempt['external_thread_id']);
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }
            return;
        }
        $attempt['remote_status'] = (string) ($remote['status'] ?? $remote['run']['status'] ?? 'unknown');
        $attempt['external_observed_run_id'] = isset($remote['runId']) ? (string) $remote['runId'] : (isset($remote['run']['id']) ? (string) $remote['run']['id'] : $attempt['external_dispatch_run_id']);
        $attempt['last_observed_at'] = $this->store->now();
        $attempts = $run['attempts'];
        $attempts[$attempt['attempt_no'] - 1] = $attempt;
        $run['attempts'] = $attempts;
        $run['last_observed_at'] = $attempt['last_observed_at'];
        $run = $this->store->save('runs', $run, 'run.external_observed');
        $status = strtolower((string) $attempt['remote_status']);
        if (in_array($status, ['running', 'in_progress', 'streaming'], true)) {
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
            }
            $run['status_reason'] = 'T3 wartet auf eine Eingabe. Berechtigungsanfragen müssen in T3 beantwortet werden.';
        } elseif (in_array($status, ['completed', 'succeeded', 'success'], true)) {
            $run['state'] = 'verifying';
            $attempt['ended_at'] = $this->store->now();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
            $run['status_reason'] = 'T3 hat den Lauf beendet. Die passende Agentmeldung und die Phasenregeln werden noch abgeglichen.';
        } elseif (in_array($status, ['failed', 'error'], true)) {
            $run['state'] = 'failed';
            $run['status_reason'] = 'T3 hat einen Fehler gemeldet.';
            $attempt['ended_at'] = $this->store->now();
            $attempts = $run['attempts'];
            $attempts[$attempt['attempt_no'] - 1] = $attempt;
            $run['attempts'] = $attempts;
        } elseif (in_array($status, ['cancelled', 'canceled', 'interrupted'], true)) {
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
        $run = $this->store->save('runs', $run, 'run.state_observed');
        if ($run['state'] === 'verifying') {
            $this->completePhaseIfAllowed($run);
        } elseif (in_array($run['state'], ['failed', 'cancelled'], true) && $run['workflow_instance_id'] !== null) {
            $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
        }
        $current = $this->store->find('runs', $runId);
        if ($current !== null && in_array($current['state'], self::ACTIVE_RUN_STATES, true)) {
            $this->scheduleObservation($runId);
        } else {
            $this->removeObservationSchedule($runId);
        }
    }

    private function performCancel(string $runId): void
    {
        $run = $this->record('runs', $runId);
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        if ($attempt['external_thread_id'] === null || $attempt['external_dispatch_run_id'] === null) {
            $run['state'] = 'reconciling';
            $run['status_reason'] = 'Der externe Startausgang ist ungeklärt. Abbruchwirkung wird vor einer Freigabe des Ausführungsplatzes abgeglichen.';
            $this->store->save('runs', $run, 'run.cancel_reconciliation_required');
            $this->store->enqueue('run.reconcile', ['run_id' => $runId]);
            return;
        }
        $connection = $this->record('connections', (string) $attempt['connection_id']);
        try {
            $this->bridge->interrupt($connection, $this->connectionToken($connection), (string) $attempt['external_thread_id'], (string) $attempt['external_dispatch_run_id']);
        } catch (T3BridgeException $exception) {
            $this->setRunBridgeFailure($run, $exception);
            if (!$exception->authenticationFailure) {
                throw $exception;
            }
            return;
        }
        $this->store->enqueue('run.observe', ['run_id' => $runId]);
    }

    private function performInput(string $runId, string $inputId): void
    {
        $run = $this->record('runs', $runId);
        $input = $this->record('run_inputs', $inputId);
        if ($input['run_id'] !== $runId || $input['status'] !== 'queued') {
            return;
        }
        $attempt = $this->attempt($run, (int) $input['attempt_no']);
        if ($attempt['external_thread_id'] === null) {
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
        $connection = $this->record('connections', (string) $attempt['connection_id']);
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
        $run['state'] = 'running';
        $run['pending_input'] = null;
        $run['status_reason'] = null;
        $this->store->save('runs', $run, 'run.input_delivered');
        $this->store->enqueue('run.observe', ['run_id' => $runId]);
    }

    private function completePhaseIfAllowed(array $run): void
    {
        $report = $this->currentReport($run, false);
        $policy = $run['snapshot']['run_completion_policy'] ?? $this->defaultRunPolicy();
        if ($report === null) {
            $run['status_reason'] = 'T3 hat den Lauf beendet, aber es liegt noch keine passende Agentmeldung vor.';
            $this->store->save('runs', $run, 'run.report_required');
            return;
        }
        if (!$report['accepted_for_reconciliation'] || $report['outcome'] !== 'reported_success') {
            $run['state'] = 'failed';
            $run['status_reason'] = $report['accepted_for_reconciliation'] ? 'Die Agentmeldung verlangt Änderungen oder meldet einen Fehler.' : 'Die Ergebnismeldung ist überholt.';
            $this->store->save('runs', $run, 'run.phase_not_succeeded');
            if ($run['workflow_instance_id'] !== null) {
                $this->store->enqueue('workflow.advance', ['instance_id' => $run['workflow_instance_id']]);
            }
            return;
        }
        $evidence = array_values(array_filter($this->store->all('evidence', (string) $run['project_id']), static fn (array $item): bool => $item['run_id'] === $run['id'] && $item['attempt_no'] === $run['attempt_no'] && $item['task_revision'] === $run['snapshot']['task_revision']));
        foreach (($policy['required_evidence_kinds'] ?? []) as $kind) {
            if (!array_filter($evidence, static fn (array $item): bool => $item['kind'] === $kind && $item['review_status'] !== 'rejected')) {
                $run['state'] = 'verifying';
                $run['status_reason'] = 'Für diese Phase fehlt ein erforderlicher gemeldeter Nachweis ('.$kind.').';
                $this->store->save('runs', $run, 'run.phase_evidence_pending');
                $this->openAttention($run['task_id'], $run['project_id'], 'phase_evidence_pending', 'owner');
                return;
            }
        }
        if (!empty($policy['require_human_confirmed_evidence'])) {
            foreach ($evidence as $item) {
                if ($item['review_status'] === 'rejected') {
                    continue;
                }
                if ($item['review_status'] !== 'human_confirmed') {
                    $run['state'] = 'verifying';
                    $run['status_reason'] = 'Die Phasenpolicy verlangt eine menschliche Bestätigung der gemeldeten Belege.';
                    $this->store->save('runs', $run, 'run.phase_review_pending');
                    $this->openAttention($run['task_id'], $run['project_id'], 'phase_review_pending', 'owner');
                    return;
                }
            }
        }
        if (!empty($policy['require_human_phase_decision'])) {
            $approved = false;
            foreach ($this->store->all('approvals', (string) $run['project_id']) as $approval) {
                if ($approval['run_id'] === $run['id'] && $approval['attempt_no'] === $run['attempt_no'] && $approval['status'] === 'approved' && hash_equals((string) $approval['result_digest'], (string) $run['result_digest'])) {
                    $approved = true;
                    break;
                }
            }
            if (!$approved) {
                $run['state'] = 'verifying';
                $run['status_reason'] = 'Die aktuelle Phasenpolicy verlangt eine Eigentümerentscheidung über diesen Ergebnisstand.';
                $this->store->save('runs', $run, 'run.phase_decision_pending');
                $this->openAttention($run['task_id'], $run['project_id'], 'approval_pending', 'owner');
                return;
            }
        }
        foreach (($policy['required_criterion_ids'] ?? []) as $criterionId) {
            $criterion = null;
            foreach (($this->record('tasks', (string) $run['task_id'])['criteria'] ?? []) as $candidate) {
                if ($candidate['id'] === $criterionId) {
                    $criterion = $candidate;
                    break;
                }
            }
            if ($criterion === null || ($criterion['review_status'] ?? null) !== 'human_confirmed') {
                $run['state'] = 'verifying';
                $run['status_reason'] = 'Die Phasenpolicy verlangt die menschliche Bestätigung ausgewählter Akzeptanzkriterien.';
                $this->store->save('runs', $run, 'run.phase_criteria_pending');
                $this->openAttention($run['task_id'], $run['project_id'], 'phase_criteria_pending', 'owner');
                return;
            }
        }
        $run['state'] = 'succeeded';
        $run['status_reason'] = null;
        $attempt = $this->attempt($run, (int) $run['attempt_no']);
        $attempt['ended_at'] ??= $this->store->now();
        $attempts = $run['attempts'];
        $attempts[$attempt['attempt_no'] - 1] = $attempt;
        $run['attempts'] = $attempts;
        $run = $this->store->save('runs', $run, 'run.phase_succeeded');
        foreach (['phase_evidence_pending', 'phase_review_pending', 'phase_decision_pending', 'phase_criteria_pending', 'reconciliation_required'] as $reason) {
            $this->resolveAttention($run['task_id'], $reason);
        }
        if ($run['workflow_instance_id'] !== null) {
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

    /** @return array<string, mixed> */
    private function getBinding(string $projectId, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $this->record('projects', $projectId);
        $binding = $this->bindingForProject($projectId);
        if ($binding === null) {
            throw new Problem(404, 'resource_not_found', 'Für dieses Projekt ist noch kein T3-Projekt gebunden.');
        }

        return $binding;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function setBinding(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $project = $this->record('projects', $projectId);
        if (!empty($project['archived'])) {
            throw new Problem(409, 'project_archived', 'Ein archiviertes Projekt kann kein neues T3-Binding erhalten.');
        }
        $connection = $this->record('connections', (string) $body['connection_id']);
        if ($connection['auth_status'] !== 'valid' || $connection['health'] === 'incompatible') {
            throw new Problem(409, 't3_connection_unavailable', 'Die T3-Verbindung muss zuerst erfolgreich geprüft und autorisiert werden.');
        }
        $existing = $this->bindingForProject($projectId);
        $bindingRecord = [
            'project_id' => $projectId,
            'connection_id' => $connection['id'],
            'external_project_id' => trim((string) $body['external_project_id']),
            'active' => true,
            'max_active_runs' => 1,
        ];
        if ($existing !== null) {
            $bindingRecord['id'] = $existing['id'];
        }
        $binding = $this->store->save('project_bindings', $bindingRecord, $existing === null ? 'project.t3_binding_created' : 'project.t3_binding_changed');
        $project['active_binding_id'] = $binding['id'];
        $this->store->save('projects', $project, 'project.t3_binding_updated');
        if ($existing !== null && ($existing['connection_id'] !== $connection['id'] || $existing['external_project_id'] !== $binding['external_project_id'])) {
            foreach ($this->store->all('runs') as $run) {
                if (($run['snapshot']['project_binding_id'] ?? null) === $existing['id'] && in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    $run['state'] = 'reconciling';
                    $run['status_reason'] = 'Das aktive T3-Binding wurde geändert. Der zuvor eingefrorene Auftrag muss abgeglichen werden.';
                    $this->store->save('runs', $run, 'run.reconciliation_required');
                    $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
                }
            }
        }

        return $binding;
    }

    /** @param array<string, mixed> $payload */
    private function performConnectionCheck(string $checkId): void
    {
        $check = $this->record('connection_checks', $checkId);
        $connection = $this->record('connections', (string) $check['connection_id']);
        $check['checked_at'] = $this->store->now();
        if ($connection['auth_status'] !== 'valid') {
            $check['network'] = 'not_checked';
            $check['authentication'] = 'failed';
            $check['mcp_handshake'] = 'not_checked';
            $check['capabilities'] = 'not_checked';
            $check['diagnostic'] = 'Für die T3-Prüfung fehlt eine gültige OAuth-Anmeldung.';
            $check['status'] = 'failed';
            $connection['health'] = 'degraded';
            $connection['diagnostic'] = $check['diagnostic'];
            $this->store->save('connection_checks', $check, 't3_connection.check_failed');
            $this->store->save('connections', $connection, 't3_connection.degraded');
            return;
        }
        try {
            $result = $this->bridge->capabilities($connection, $this->connectionToken($connection));
            $snapshot = $this->store->save('capability_snapshots', [
                'connection_id' => $connection['id'], 'snapshot_id' => $this->store->id(),
                'observed_at' => $this->store->now(), 'server_version' => $result['server_version'],
                'protocol_version' => $result['protocol_version'], 'tools' => $result['tools'],
                'providers' => $result['providers'], 'supported_actions' => $result['supported_actions'],
                'compatible' => $result['compatible'], 'incompatibilities' => $result['compatible'] ? [] : ['Erforderliche Launch-, Read- oder Interrupt-Fähigkeit fehlt.'],
            ], 't3_capabilities.observed');
            $connection['health'] = $result['compatible'] ? 'ready' : 'incompatible';
            $connection['last_success_at'] = $this->store->now();
            $connection['capability_snapshot_id'] = $snapshot['id'];
            $connection['diagnostic'] = $result['compatible'] ? null : implode(' ', $snapshot['incompatibilities']);
            $check['network'] = 'ok';
            $check['authentication'] = 'ok';
            $check['mcp_handshake'] = 'ok';
            $check['capabilities'] = $result['compatible'] ? 'ok' : 'failed';
            $check['diagnostic'] = $connection['diagnostic'];
            $check['snapshot_id'] = $snapshot['id'];
            $check['status'] = $result['compatible'] ? 'succeeded' : 'failed';
            $this->store->save('connections', $connection, $result['compatible'] ? 't3_connection.ready' : 't3_connection.incompatible');
            $this->store->save('connection_checks', $check, $result['compatible'] ? 't3_connection.check_succeeded' : 't3_connection.check_failed');
            foreach ($this->store->all('agent_profiles') as $profile) {
                if ($profile['connection_id'] === $connection['id']) {
                    $profile['configuration_valid'] = $result['compatible'];
                    $profile['configuration_error'] = $result['compatible'] ? null : $connection['diagnostic'];
                    $this->store->save('agent_profiles', $profile, 'agent_profile.configuration_refreshed');
                }
            }
        } catch (T3BridgeException $exception) {
            $connection['health'] = $exception->authenticationFailure ? 'degraded' : 'unreachable';
            $connection['diagnostic'] = $exception->getMessage();
            $check['network'] = $exception->authenticationFailure ? 'ok' : 'failed';
            $check['authentication'] = $exception->authenticationFailure ? 'failed' : 'not_checked';
            $check['mcp_handshake'] = 'failed';
            $check['capabilities'] = 'not_checked';
            $check['diagnostic'] = $exception->getMessage();
            $check['status'] = 'failed';
            if ($exception->authenticationFailure) {
                $connection['auth_status'] = 'expired';
            }
            $this->store->save('connections', $connection, 't3_connection.check_failed');
            $this->store->save('connection_checks', $check, 't3_connection.check_failed');
        }
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function getHandoff(string $taskId, array $p, Actor $actor): array
    {
        $task = $this->record('tasks', $taskId);
        $actor->requireProject((string) $task['project_id']);
        $run = isset($p['source_run_id']) ? $this->store->find('runs', (string) $p['source_run_id']) : null;
        $evidence = array_values(array_filter($this->store->all('evidence', (string) $task['project_id']), static fn (array $item): bool => $item['task_id'] === $taskId && $item['review_status'] !== 'rejected'));
        $collections = array_values(array_filter($this->store->all('link_collections', (string) $task['project_id']), static fn (array $collection): bool => $collection['task_id'] === $taskId));

        return [
            'task' => $task,
            'source_run_id' => $run['id'] ?? null,
            'open_questions' => $run === null ? [] : ($this->currentReport($run, false)['_open_questions'] ?? []),
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
                    'run_id' => $run['id'], 'external_thread_id' => $attempt['external_thread_id'] ?? null,
                    'external_run_id' => $attempt['external_dispatch_run_id'] ?? null,
                    'entry_kind' => 'known_run', 'status' => 'pending', 'disposition' => null, 'reason' => null,
                ], 'recovery.known_run_added');
                if (is_string($attempt['external_thread_id'] ?? null) && $attempt['external_thread_id'] !== '') {
                    $this->store->enqueue('run.reconcile', ['run_id' => $run['id']]);
                } else {
                    $this->openAttention($run['task_id'], $run['project_id'], 'reconciliation_required', 'owner');
                }
            }
            foreach ($this->store->all('project_bindings') as $binding) {
                if (!$binding['active']) {
                    continue;
                }
                $this->store->save('recovery_entries', [
                    'gate_id' => $gate['id'], 'project_id' => $binding['project_id'], 'connection_id' => $binding['connection_id'],
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
        if ($gate === null) {
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
        if ($gate === null) {
            throw new Problem(409, 'recovery_not_active', 'Es ist keine Wiederherstellungsinventur offen.');
        }
        if ($body['action'] === 'register_external_start') {
            $start = $body['external_start'];
            $project = $this->record('projects', (string) $start['project_id']);
            $binding = $this->bindingForProject((string) $project['id']);
            if ($binding === null || $binding['connection_id'] !== $start['connection_id'] || $binding['external_project_id'] !== $start['external_project_id']) {
                throw new Problem(409, 'run_context_mismatch', 'Der registrierte T3-Lauf passt nicht zum aktiven Projektbinding.');
            }
            $entry = $this->store->save('recovery_entries', [
                'gate_id' => $gate['id'], 'project_id' => $project['id'], 'connection_id' => $binding['connection_id'],
                'external_project_id' => $binding['external_project_id'], 'external_thread_id' => $start['thread_id'],
                'external_run_id' => $start['run_id'] ?? null, 'entry_kind' => 'registered_external_start',
                'status' => 'pending', 'disposition' => null, 'reason' => trim((string) ($body['reason'] ?? '')),
            ], 'recovery.external_start_registered');
            if (is_string($entry['external_thread_id']) && $entry['external_thread_id'] !== '') {
                $this->store->enqueue('recovery.entry.observe', ['entry_id' => $entry['id']]);
            }
        } elseif ($body['action'] === 'resolve_entry') {
            $entry = $this->record('recovery_entries', (string) $body['entry_id']);
            if ($entry['gate_id'] !== $gate['id']) {
                throw new Problem(404, 'resource_not_found', 'Der Eintrag gehört nicht zur offenen Wiederherstellungsinventur.');
            }
            $disposition = (string) $body['disposition'];
            if ($entry['entry_kind'] === 'known_run') {
                if (!in_array($disposition, ['confirmed_stopped_in_t3', 'confirmed_not_started'], true)) {
                    throw new Problem(422, 'validation_failed', 'Ein bekannter Lauf darf nur nach bestätigtem T3-Stopp oder bestätigtem Nichtstart aufgelöst werden.');
                }
                $run = $this->record('runs', (string) $entry['run_id']);
                if (in_array($run['state'], self::ACTIVE_RUN_STATES, true)) {
                    throw new Problem(409, 'run_still_active', 'Der bekannte Lauf muss zuerst über T3 abgeglichen und beendet werden.');
                }
            } elseif ($entry['entry_kind'] === 'unlisted_external_activity') {
                if ($disposition !== 'reviewed_no_additional_runs') {
                    throw new Problem(422, 'validation_failed', 'Der Inventurhinweis kann nur nach manueller Prüfung der T3-Projektaktivität bestätigt werden.');
                }
            } else {
                if (!in_array($disposition, ['confirmed_stopped_in_t3', 'confirmed_not_started'], true)) {
                    throw new Problem(422, 'validation_failed', 'Ein registrierter externer Lauf benötigt eine bestätigte Klärung in T3.');
                }
                if ($entry['status'] !== 'stopped') {
                    throw new Problem(409, 'run_still_active', 'Der registrierte T3-Lauf wurde noch nicht als beendet beobachtet.');
                }
            }
            $entry['status'] = 'resolved';
            $entry['disposition'] = $disposition;
            $entry['reason'] = trim((string) $body['reason']);
            $entry['resolved_by'] = $actor->ref();
            $entry['resolved_at'] = $this->store->now();
            $this->store->save('recovery_entries', $entry, 'recovery.entry_resolved');
        } elseif ($body['action'] === 'confirm_inventory') {
            $entries = array_values(array_filter($this->store->all('recovery_entries'), static fn (array $entry): bool => $entry['gate_id'] === $gate['id']));
            if (array_filter($entries, static fn (array $entry): bool => $entry['status'] !== 'resolved')) {
                throw new Problem(409, 'recovery_inventory_incomplete', 'Alle bekannten Läufe und Hinweise auf unbekannte T3-Aktivität müssen zuerst geklärt werden.');
            }
            $gate['status'] = 'released';
            $gate['inventory_confirmed_at'] = $this->store->now();
            $gate['released_at'] = $this->store->now();
            $gate['resolved_by'] = $actor->ref();
            $gate['resolution_reason'] = trim((string) $body['reason']);
            $this->store->save('recovery_gates', $gate, 'recovery.inventory_released');
            foreach ($this->store->all('recovery_entries') as $entry) {
                if ($entry['gate_id'] === $gate['id'] && $entry['entry_kind'] === 'known_run' && is_string($entry['run_id'] ?? null)) {
                    $run = $this->store->find('runs', $entry['run_id']);
                    if ($run !== null) {
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
        if ($entry['status'] === 'resolved' || !isset($entry['external_thread_id'])) {
            return;
        }
        $connection = $this->record('connections', (string) $entry['connection_id']);
        try {
            $remote = $this->bridge->readThread($connection, $this->connectionToken($connection), (string) $entry['external_thread_id']);
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
        if ($entry['status'] === 'pending') {
            $this->scheduleRecoveryObservation($entryId);
        }
    }

    private function advanceWorkflow(string $instanceId): void
    {
        $instance = $this->record('workflow_instances', $instanceId);
        if ($instance['state'] !== 'running' || strtotime((string) $instance['deadline_at']) <= time()) {
            if ($instance['state'] === 'running') {
                $instance['state'] = 'paused';
                $instance['pause_reason'] = 'Die konfigurierte maximale Workflowdauer wurde erreicht.';
                $this->store->save('workflow_instances', $instance, 'workflow.duration_limit_reached');
                $this->openAttention($instance['task_id'], $instance['project_id'], 'workflow_duration_limit', 'owner');
            }
            return;
        }
        $workflow = $instance['definition_snapshot'] ?? $this->workflowDefinition((string) $instance['workflow_id'], (int) $instance['definition_version']);
        $task = $this->record('tasks', (string) $instance['task_id']);
        $runs = array_values(array_filter(array_map(fn (string $id): ?array => $this->store->find('runs', $id), $instance['run_ids']), static fn (?array $run): bool => $run !== null));
        $active = array_filter($runs, static fn (array $run): bool => in_array($run['state'], self::ACTIVE_RUN_STATES, true));
        if ($active !== []) {
            return;
        }
        $latest = $runs === [] ? null : $runs[array_key_last($runs)];
        $stage = $this->stage($workflow, (string) $instance['current_stage_id']);
        if ($latest === null) {
            $this->assertConditions($stage['entry_conditions'] ?? [], $task, $instance);
            if ($stage['agent_profile_id'] === null) {
                $this->pauseWorkflow($instance, 'Für die erste Phase ist kein Agentprofil gesetzt.');
                return;
            }
            $this->queueWorkflowStageRun($instance, $task, $workflow, $stage);
            return;
        }
        $report = $this->currentReport($latest, false);
        $outcome = match (true) {
            $latest['state'] === 'succeeded' => 'accepted',
            $report !== null => (string) $report['outcome'],
            $latest['state'] === 'failed' => 'failed',
            $latest['state'] === 'cancelled' => 'blocked',
            default => null,
        };
        if ($outcome === null) {
            $this->pauseWorkflow($instance, 'Der letzte Phasenlauf benötigt eine menschliche Klärung.');
            return;
        }
        if ($outcome === 'needs_changes') {
            ++$instance['repair_round'];
            if ($instance['repair_round'] > (int) $workflow['limits']['max_repair_rounds']) {
                $this->pauseWorkflow($instance, 'Die konfigurierte Zahl der Reparaturrunden ist erreicht.');
                $this->openAttention($task['id'], $task['project_id'], 'workflow_repair_limit', 'owner');
                return;
            }
        }
        $transition = null;
        foreach ($workflow['transitions'] as $candidate) {
            if ($candidate['from_stage_id'] !== $instance['current_stage_id'] || $candidate['on'] !== $outcome) {
                continue;
            }
            if ($this->conditionsSatisfied($candidate['conditions'] ?? [], $task, $instance)) {
                $transition = $candidate;
                break;
            }
        }
        if ($transition === null) {
            if ($latest['state'] === 'succeeded' && $outcome === 'accepted') {
                $instance['state'] = 'succeeded';
                $instance['current_stage_id'] = null;
                $instance['pause_reason'] = null;
                $this->store->save('workflow_instances', $instance, 'workflow.succeeded');
                $this->resolveAttention($task['id'], 'workflow_repair_limit');
                return;
            }
            $this->pauseWorkflow($instance, 'Für das gemeldete Phasenergebnis ist keine passende Übergangsregel konfiguriert.');
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
        if ($nextStage['agent_profile_id'] === null) {
            $this->pauseWorkflow($instance, 'Die nächste Phase benötigt ein Agentprofil oder eine menschliche Ausführung.');
            return;
        }
        $instance['current_stage_id'] = $nextStage['id'];
        $instance['pause_reason'] = null;
        $instance = $this->store->save('workflow_instances', $instance, 'workflow.stage_advanced');
        $this->queueWorkflowStageRun($instance, $task, $workflow, $nextStage);
        $this->resolveAttention($task['id'], 'workflow_transition_required');
        $this->resolveAttention($task['id'], 'workflow_entry_condition_unmet');
    }

    private function queueWorkflowStageRun(array $instance, array $task, array $workflow, array $stage): void
    {
        if (!empty($task['human_attention']['required']) || $this->activeRecoveryGate() !== null) {
            $this->pauseWorkflow($instance, $this->activeRecoveryGate() !== null
                ? 'Nach der Wiederherstellung muss die externe T3-Inventur abgeschlossen werden.'
                : 'Für diese Aufgabe ist noch eine menschliche Entscheidung offen.');
            return;
        }
        $profile = $this->record('agent_profiles', (string) $stage['agent_profile_id']);
        if (!$profile['enabled'] || !$profile['configuration_valid']) {
            $this->pauseWorkflow($instance, 'Das Agentprofil dieser Phase ist nicht startbereit.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_profile_unavailable', 'owner');
            return;
        }
        $binding = $this->bindingForProject((string) $task['project_id']);
        if ($binding === null || $binding['connection_id'] !== $profile['connection_id']) {
            $this->pauseWorkflow($instance, 'T3-Projektbindung und Agentprofil sind nicht passend konfiguriert.');
            $this->openAttention($task['id'], $task['project_id'], 'workflow_profile_unavailable', 'owner');
            return;
        }
        $connection = $this->record('connections', (string) $binding['connection_id']);
        if ($connection['auth_status'] !== 'valid' || $connection['health'] === 'incompatible') {
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
                'classification_id' => $task['classification_id'] ?? null, 'workflow_label_id' => $task['workflow_label_id'] ?? null,
                'routing_rules_version' => $task['routing_rules_version'] ?? null,
            ],
            'attempt_no' => 1, 'attempts' => [[
                'attempt_no' => 1, 'dispatch_id' => $dispatchId, 'connection_id' => $connection['id'],
                'auth_epoch' => max(1, (int) $connection['auth_epoch']), 'external_thread_id' => null,
                'external_dispatch_run_id' => null, 'external_observed_run_id' => null, 'external_result_run_id' => null,
                'external_message_id' => null, 'external_url' => null, 'remote_status' => null, 'last_observed_at' => null,
                'started_at' => null, 'ended_at' => null, 'request_sha256' => hash('sha256', ''),
            ]],
            'parent_run_id' => null, 'workflow_instance_id' => $instance['id'], 'pending_input' => null,
            'result_digest' => null, 'evidence_ids' => [], 'report_ids' => [], 'last_observed_at' => null,
            'status_reason' => null, '_dispatch_request' => null,
        ], 'run.queued');
        $instance['run_ids'][] = $run['id'];
        $this->store->save('workflow_instances', $instance, 'workflow.run_attached');
        $this->store->enqueue('run.dispatch', ['run_id' => $run['id']]);
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
        if (!$trigger['enabled'] || $this->activeRecoveryGate() !== null) {
            return;
        }
        $project = $this->record('projects', (string) $trigger['project_id']);
        if ($project['archived']) {
            $trigger['last_error'] = 'Archiviertes Projekt kann keine neuen automatischen Läufe starten.';
            $trigger['enabled'] = false;
            $this->store->save('triggers', $trigger, 'workflow.trigger_disabled_for_archived_project');
            return;
        }
        if ($trigger['spec']['type'] === 'plugin') {
            $trigger['last_error'] = 'Plugin-Trigger werden erst ausgeführt, wenn das aktivierte Plugin einen registrierten Trigger-Handler bereitstellt.';
            $this->store->save('triggers', $trigger, 'workflow.trigger_handler_unavailable');
            return;
        }
        $tasks = [];
        if ($trigger['task_id'] !== null) {
            $task = $this->store->find('tasks', (string) $trigger['task_id']);
            if ($task !== null) {
                $tasks[] = $task;
            }
        } elseif ($trigger['spec']['type'] === 'domain_event' && isset($payload['task_id'])) {
            $task = $this->store->find('tasks', (string) $payload['task_id']);
            if ($task !== null && $task['project_id'] === $project['id']) {
                $tasks[] = $task;
            }
        } elseif ($trigger['spec']['type'] === 'domain_event' && isset($trigger['spec']['task_status_id'])) {
            $tasks = array_values(array_filter($this->store->all('tasks', (string) $project['id']), static fn (array $task): bool => $task['status_id'] === $trigger['spec']['task_status_id']));
        }
        $started = 0;
        foreach ($tasks as $task) {
            if ($trigger['spec']['type'] === 'domain_event' && isset($payload['event_type']) && $payload['event_type'] !== $trigger['spec']['event_type']) {
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
        if ($started === 0 && $trigger['last_error'] === null && $trigger['spec']['type'] === 'manual') {
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
        $nextDue = (new DateTimeImmutable($this->store->now()))->modify('+5 seconds')->format(DATE_ATOM);
        $record = [
            'run_id' => $runId,
            'next_due_at' => $nextDue,
        ];
        if ($schedule !== null) {
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
            'next_due_at' => (new DateTimeImmutable($this->store->now()))->modify('+5 seconds')->format(DATE_ATOM),
        ];
        if ($schedule !== null) {
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
        if (!is_string($id) || $id === '') {
            throw new Problem(422, 'validation_failed', 'Der Ressourcenbezeichner fehlt.');
        }

        return $id;
    }

    private function jobId(array $payload, string $name): string
    {
        $id = $payload[$name] ?? null;
        if (!is_string($id) || $id === '') {
            throw new Problem(422, 'invalid_job', 'Der dauerhafte Auftrag enthält keine Ressourcenkennung.');
        }

        return $id;
    }

    private function publicRecord(array $record): array
    {
        return $this->store->redact($record);
    }

    private function canonicalHttpsUrl(string $url): string
    {
        $url = rtrim(trim($url), '/');
        $parts = parse_url($url);
        $isSecure = ($parts['scheme'] ?? null) === 'https';
        $isTestMock = getenv('APP_ENV') === 'test' && ($parts['scheme'] ?? null) === 'http' && ($parts['host'] ?? null) === 't3-mock';
        if ((!$isSecure && !$isTestMock) || !isset($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            throw new Problem(422, 'validation_failed', 'Die T3-Adresse muss eine kanonische HTTPS-URL ohne Zugangsdaten oder Query sein.');
        }

        return $url;
    }

    private function isHttpsUrl(string $url): bool
    {
        return parse_url($url, PHP_URL_SCHEME) === 'https' && is_string(parse_url($url, PHP_URL_HOST));
    }

    private function settingsRedirect(string $connectionId, string $status): string
    {
        return '/agents?connection='.rawurlencode($connectionId).'&authorization='.rawurlencode($status);
    }

    private function connectionToken(array $connection): string
    {
        $reference = $connection['credential_secret_ref'] ?? null;
        if (!is_string($reference) || $reference === '') {
            throw new T3BridgeException('Für die T3-Verbindung ist keine OAuth-Autorisierung gespeichert.', true);
        }
        try {
            return $this->store->secret($reference);
        } catch (Throwable $exception) {
            throw new T3BridgeException('Das lokal gespeicherte T3-Credential ist nicht verfügbar.', true, $exception);
        }
    }

    private function bindingForProject(string $projectId): ?array
    {
        $project = $this->store->find('projects', $projectId);
        if (is_string($project['active_binding_id'] ?? null)) {
            $binding = $this->store->find('project_bindings', $project['active_binding_id']);
            if ($binding !== null && !empty($binding['active'])) {
                return $binding;
            }
        }
        foreach ($this->store->all('project_bindings', $projectId) as $binding) {
            if (!empty($binding['active'])) {
                return $binding;
            }
        }

        return null;
    }

    private function runUsesConnection(array $run, string $connectionId): bool
    {
        foreach (($run['attempts'] ?? []) as $attempt) {
            if (($attempt['connection_id'] ?? null) === $connectionId) {
                return true;
            }
        }

        return false;
    }

    private function assertCapabilities(array $connection, array $required): void
    {
        $snapshotId = $connection['capability_snapshot_id'] ?? null;
        $snapshot = is_string($snapshotId) ? $this->store->find('capability_snapshots', $snapshotId) : null;
        $tools = $snapshot['tools'] ?? [];
        $missing = array_values(array_diff($required, $tools));
        if ($snapshot === null || !$snapshot['compatible'] || $missing !== []) {
            throw new Problem(409, 'capability_unavailable', 'Die letzte T3-Prüfung bestätigt nicht alle für diesen Auftrag benötigten Fähigkeiten.');
        }
    }

    private function assertTaskCanStart(array $task): void
    {
        $project = $this->record('projects', (string) $task['project_id']);
        if (!empty($project['archived'])) {
            throw new Problem(409, 'project_archived', 'In einem archivierten Projekt kann kein neuer Auftrag gestartet werden.');
        }
        if (!empty($task['blocked'])) {
            throw new Problem(409, 'task_blocked', 'Die Aufgabe ist blockiert und kann nicht gestartet werden.');
        }
        if (!empty($task['human_attention']['required'])) {
            throw new Problem(409, 'human_attention_required', 'Für diese Aufgabe ist zuerst eine menschliche Entscheidung nötig.');
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
        if ($this->activeRecoveryGate() !== null) {
            throw new Problem(409, 'recovery_inventory_required', 'Nach der Wiederherstellung muss zuerst die externe T3-Inventur ausdrücklich abgeschlossen werden.');
        }
    }

    private function activeRecoveryGate(): ?array
    {
        $gates = array_values(array_filter($this->store->all('recovery_gates'), static fn (array $gate): bool => ($gate['status'] ?? null) !== 'released'));
        usort($gates, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $gates[0] ?? null;
    }

    private function bridgeId(string $bridgeId): string
    {
        if ($bridgeId !== self::T3_BRIDGE_ID) {
            throw new Problem(422, 'validation_failed', 'Die angeforderte T3-Bridge-Version wird nicht unterstützt.');
        }

        return $bridgeId;
    }

    /** @param array<string, mixed> $workflow */
    private function workflowDefinition(string $workflowId, int $version): array
    {
        $workflow = $this->record('workflows', $workflowId);
        if ($version === (int) $workflow['definition_version']) {
            return $workflow;
        }
        foreach ($this->store->all('workflow_versions') as $candidate) {
            if ($candidate['workflow_id'] === $workflowId && (int) $candidate['definition_version'] === $version) {
                return $candidate;
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
            if ($report !== null && (int) $report['attempt_no'] === (int) $run['attempt_no'] && (int) $report['task_revision'] === (int) $run['snapshot']['task_revision']) {
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
        foreach ($conditions as $condition) {
            $type = $condition['type'];
            $evidence = $this->store->all('evidence', (string) $task['project_id']);
            $approvals = $this->store->all('approvals', (string) $task['project_id']);
            $taskEvidence = array_values(array_filter($evidence, static fn (array $item): bool => $item['task_id'] === $task['id']));
            $taskApprovals = array_values(array_filter($approvals, static fn (array $approval): bool => ($approval['run_id'] ?? null) !== null));
            $satisfied = match ($type) {
                'all_required_criteria_human_confirmed' => array_reduce($task['criteria'] ?? [], static fn (bool $carry, array $criterion): bool => $carry && (($criterion['review_status'] ?? null) === 'human_confirmed'), true),
                'required_evidence_reported' => (bool) array_filter($taskEvidence, static fn (array $item): bool => $item['kind'] === ($condition['evidence_kind'] ?? null) && $item['review_status'] !== 'rejected'),
                'required_evidence_human_confirmed' => (bool) array_filter($taskEvidence, static fn (array $item): bool => $item['kind'] === ($condition['evidence_kind'] ?? null) && $item['review_status'] === 'human_confirmed'),
                'human_approval_granted' => (bool) array_filter($taskApprovals, static fn (array $approval): bool => $approval['status'] === 'approved'),
                'review_report_accepted' => (bool) array_filter($this->store->all('runs', (string) $task['project_id']), fn (array $run): bool => $run['task_id'] === $task['id'] && ($this->currentReport($run, false)['outcome'] ?? null) === 'reported_success'),
                'run_succeeded' => (bool) array_filter($this->store->all('runs', (string) $task['project_id']), static fn (array $run): bool => $run['task_id'] === $task['id'] && $run['state'] === 'succeeded'),
                'intake_ready' => ($task['classification_required'] ?? false) ? ($task['intake_outcome'] ?? null) === 'ready' : true,
                'no_human_attention' => empty($task['human_attention']['required']) && !$this->hasOpenOwnerAttention((string) $task['id'], (string) $task['project_id']),
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
            if ($reason['task_id'] === $taskId && $reason['code'] === $code && !empty($reason['open'])) {
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
        if ($task === null) {
            return;
        }
        foreach ($this->store->all('attention_reasons', (string) $task['project_id']) as $reason) {
            if ($reason['task_id'] === $taskId && $reason['code'] === $code && !empty($reason['open'])) {
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

    private function dispatchMessage(array $task, array $profile, array $run): string
    {
        $template = (string) ($profile['prompt_template'] ?? '');
        $template = strtr($template, ['{{task.title}}' => (string) $task['title'], '{{task.description}}' => (string) $task['description']]);
        $criteria = array_map(static fn (array $criterion): string => '- '.$criterion['description'], $task['criteria'] ?? []);
        $body = "Falkenwarte-Auftrag\nRun-ID: {$run['id']}\nVersuch: {$run['attempt_no']}\nAufgabenrevision: {$run['snapshot']['task_revision']}\n\nAufgabe: {$task['title']}\n\n{$task['description']}";
        if ($criteria !== []) {
            $body .= "\n\nAkzeptanzkriterien:\n".implode("\n", $criteria);
        }
        if (trim($template) !== '') {
            $body .= "\n\nRollenhinweise:\n".$template;
        }
        $body .= "\n\nNutze die freigegebenen Falkenwarte-MCP-Werkzeuge für Rückfragen, Ergebnislinks und Ergebnisberichte. Berichte Beobachtungen als Agentmeldung. Falkenwarte prüft keinen Code und lädt keine Links herunter.";

        return $body;
    }

    private function canonicalJson(array $value): string
    {
        $normalize = static function (mixed $item) use (&$normalize): mixed {
            if (!is_array($item)) {
                return $item;
            }
            if (!array_is_list($item)) {
                ksort($item);
            }
            foreach ($item as $key => $nested) {
                $item[$key] = $normalize($nested);
            }
            return $item;
        };

        return json_encode($normalize($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function deadline(int $seconds): string
    {
        return (new DateTimeImmutable($this->store->now()))->modify('+'.$seconds.' seconds')->format(DATE_ATOM);
    }

    /** @param array<string, mixed> $schedule */
    private function nextDue(array $schedule, ?DateTimeImmutable $from = null): ?string
    {
        $from ??= new DateTimeImmutable($this->store->now());
        $kind = $schedule['kind'] ?? null;
        if ($kind === 'once') {
            $due = new DateTimeImmutable((string) $schedule['run_at']);
            return $due > $from ? $due->format(DATE_ATOM) : null;
        }
        if ($kind === 'interval') {
            return $from->modify('+'.max(60, (int) $schedule['every_seconds']).' seconds')->format(DATE_ATOM);
        }
        if ($kind === 'daily') {
            $timezone = new DateTimeZone((string) $schedule['timezone']);
            $candidate = $from->setTimezone($timezone)->setTime((int) substr($schedule['local_time'], 0, 2), (int) substr($schedule['local_time'], 3, 2));
            if ($candidate <= $from->setTimezone($timezone)) {
                $candidate = $candidate->modify('+1 day');
            }
            $weekdays = $schedule['weekdays'] ?? [];
            for ($offset = 0; $offset < 7; ++$offset) {
                if ($weekdays === [] || in_array((int) $candidate->format('N'), $weekdays, true)) {
                    return $candidate->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
                }
                $candidate = $candidate->modify('+1 day');
            }
        }

        return null;
    }
}
