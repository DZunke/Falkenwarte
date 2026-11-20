<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

use App\AgentCatalog\Domain\AgentProfileRules;
use App\AgentCatalog\Domain\ConnectionChangeImpact;
use App\AgentCatalog\Domain\ProjectBindingRules;
use App\AgentCatalog\Domain\T3ConnectionRules;
use App\Shared\Application\Actor;
use App\Shared\Application\OperationHandler;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

final class AgentCatalogHandler implements OperationHandler
{
    public function __construct(
        private readonly Store $store,
        private readonly AgentCatalogReader $catalog,
        private readonly AgentCatalogMcpClient $bridge,
        private readonly AgentCatalogOAuthClient $oauth,
        private readonly RunImpactPort $runImpact,
        private readonly T3ConnectionRules $connectionRules,
        private readonly AgentProfileRules $profileRules,
        private readonly ProjectBindingRules $bindingRules,
        private readonly bool $allowTestHttpEndpoint,
        private readonly string $publicOrigin,
    ) {
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'project_binding_get', 'project_binding_set', 'project_t3_threads_list',
            'connections_list', 'connections_create', 'connections_get', 'connections_update', 'connections_check', 'connection_check_get',
            'connection_capabilities_get', 'connection_providers_list', 'connection_projects_list', 'connection_oauth_start', 'connection_oauth_callback', 'connection_credentials_remove',
            'agent_profiles_list', 'agent_profiles_create', 'agent_profiles_get', 'agent_profiles_replace',
        ], true);
    }

    /** @param array<string, mixed> $p @param array<string, mixed> $body @return array<string, mixed> */
    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'project_binding_get' => $this->getBinding($this->pathId($p, 'project_id'), $actor),
            'project_binding_set' => $this->setBinding($this->pathId($p, 'project_id'), $body, $actor),
            'project_t3_threads_list' => $this->listProjectThreads($this->pathId($p, 'project_id'), $p, $actor),
            'connections_list' => $this->listConnections($p, $actor),
            'connections_create' => $this->createConnection($body, $actor),
            'connections_get' => $this->getConnection($this->pathId($p, 'connection_id'), $actor),
            'connections_update' => $this->updateConnection($this->pathId($p, 'connection_id'), $body, $actor),
            'connections_check' => $this->checkConnection($this->pathId($p, 'connection_id'), $actor),
            'connection_check_get' => $this->getConnectionCheck($this->pathId($p, 'connection_id'), $actor),
            'connection_capabilities_get' => $this->getCapabilities($this->pathId($p, 'connection_id'), $actor),
            'connection_providers_list' => $this->listRemoteProviders($this->pathId($p, 'connection_id'), $p['search'] ?? null, $actor),
            'connection_projects_list' => $this->listRemoteProjects($this->pathId($p, 'connection_id'), $p, $actor),
            'connection_oauth_start' => $this->startOAuth($this->pathId($p, 'connection_id'), $body, $actor),
            'connection_oauth_callback' => $this->finishOAuth($p),
            'connection_credentials_remove' => $this->removeCredentials($this->pathId($p, 'connection_id'), $actor),
            'agent_profiles_list' => $this->listProfiles($p, $actor),
            'agent_profiles_create' => $this->writeProfile(null, $body, $actor),
            'agent_profiles_get' => $this->getProfile($this->pathId($p, 'profile_id'), $actor),
            'agent_profiles_replace' => $this->writeProfile($this->pathId($p, 'profile_id'), $body, $actor),
            default => throw new Problem(404, 'operation_not_found', 'Unbekannte Agentenkatalogoperation.'),
        };
    }

    /** @param array<string, mixed> $payload */
    public function work(string $kind, array $payload): void
    {
        if ('connection.check' !== $kind) {
            throw new Problem(422, 'unsupported_job', 'Unbekannter Agentenkatalogauftrag.');
        }
        $checkId = $payload['check_id'] ?? null;
        if (!is_string($checkId) || '' === $checkId) {
            throw new Problem(422, 'invalid_job', 'Der dauerhafte Auftrag enthält keine Ressourcenkennung.');
        }

        $this->performConnectionCheck($checkId);
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
        $bridgeId = (string) $body['bridge_id'];
        $bridgePluginId = $this->catalog->providerForBridge($bridgeId);
        if (null === $bridgePluginId) {
            throw new Problem(422, 'validation_failed', 'Die angeforderte MCP-Bridge ist in keinem installierten Plugin registriert.');
        }
        $connection = $this->store->save('connections', [
            'name' => trim((string) $body['name']),
            'bridge_id' => $bridgeId,
            'bridge_plugin_id' => $bridgePluginId,
            'canonical_url' => $this->connectionRules->canonicalEndpoint((string) $body['canonical_url'], $this->allowTestHttpEndpoint),
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

        return $this->publicRecord($this->catalog->connection($id));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function updateConnection(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        $previousUrl = (string) $connection['canonical_url'];
        if (isset($body['name'])) {
            $connection['name'] = trim((string) $body['name']);
        }
        if (isset($body['canonical_url'])) {
            $connection['canonical_url'] = $this->connectionRules->canonicalEndpoint((string) $body['canonical_url'], $this->allowTestHttpEndpoint);
        }
        if ($connection['canonical_url'] !== $previousUrl) {
            $secretRef = $connection['credential_secret_ref'] ?? null;
            if (is_string($secretRef) && '' !== $secretRef) {
                $this->store->deleteSecret($secretRef);
            }
            $connection['auth_status'] = 'missing';
            $connection['auth_expires_at'] = null;
            $connection['health'] = 'unconfigured';
            $connection['capability_snapshot_id'] = null;
            $connection['diagnostic'] = 'Die T3-Adresse wurde geändert. Eine neue OAuth-Anmeldung und der Abgleich offener Läufe sind erforderlich.';
            unset($connection['credential_secret_ref'], $connection['oauth_client_id'], $connection['oauth_issuer']);
            $this->runImpact->connectionChanged($id, ConnectionChangeImpact::RECONCILE, 'Die T3-Adresse wurde geändert. Der externe Ausgang muss abgeglichen werden.');
        }

        return $this->publicRecord($this->store->save('connections', $connection, 't3_connection.updated'));
    }

    /** @return array<string, mixed> */
    private function checkConnection(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
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

        return $this->store->accepted(['resource_type' => 'connection', 'id' => $connection['id'], 'version' => $connection['version']]);
    }

    /** @return array<string, mixed> */
    private function getConnectionCheck(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $this->catalog->connection($id);
        $checks = array_values(array_filter($this->store->all('connection_checks'), static fn (array $check): bool => $check['connection_id'] === $id));
        usort($checks, static fn (array $a, array $b): int => strcmp((string) $b['created_at'], (string) $a['created_at']));

        return $checks[0] ?? throw new Problem(404, 'resource_not_found', 'Es liegt noch keine Verbindungsprüfung vor.');
    }

    /** @return array<string, mixed> */
    private function getCapabilities(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        $snapshotId = $connection['capability_snapshot_id'] ?? null;
        if (!is_string($snapshotId) || '' === $snapshotId) {
            throw new Problem(404, 'resource_not_found', 'Für diese T3-Verbindung liegt noch kein Fähigkeitssnapshot vor.');
        }

        return $this->catalog->capabilitySnapshot($snapshotId)
            ?? throw new Problem(404, 'resource_not_found', 'Der angeforderte Eintrag wurde nicht gefunden.');
    }

    /** @return array<string, mixed> */
    private function listRemoteProviders(string $id, ?string $search, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        try {
            $capabilities = $this->bridge->capabilities($connection, $this->connectionToken($id), $search);
        } catch (T3ConnectionFailure $exception) {
            throw new Problem(502, 't3_unavailable', $exception->getMessage());
        }

        return ['providers' => array_values(array_filter(
            $capabilities['providers'],
            static fn (array $provider): bool => $provider['available'],
        ))];
    }

    /** @param array<string, mixed> $p @return array<string, mixed> */
    private function listRemoteProjects(string $id, array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        $token = $this->connectionToken($id);
        try {
            $result = $this->bridge->projects($connection, $token, isset($p['cursor']) ? (string) $p['cursor'] : null, min(100, max(1, (int) ($p['limit'] ?? 50))));
        } catch (T3ConnectionFailure $exception) {
            throw new Problem(502, 't3_unavailable', $exception->getMessage());
        }
        $nextCursor = $result['next_cursor'] ?? null;

        return [
            'items' => array_values($result['items']),
            'next_cursor' => null === $nextCursor ? null : (string) $nextCursor,
            'has_more' => $result['has_more'] ?? (null !== $nextCursor),
        ];
    }

    /** @param array<string, mixed> $p @return array{items: list<array{id: string, title: string, provider_instance_id?: string, model?: string}>, next_cursor: ?string, has_more: bool} */
    private function listProjectThreads(string $projectId, array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $this->record('projects', $projectId);
        $binding = $this->catalog->bindingForProject($projectId);
        if (null === $binding
            || empty($binding['active'])
            || ($binding['project_id'] ?? null) !== $projectId
            || !is_string($binding['connection_id'] ?? null)
            || !is_string($binding['external_project_id'] ?? null)
            || '' === $binding['external_project_id']) {
            throw new Problem(409, 't3_project_unbound', 'Binde zuerst ein T3-Projekt, bevor du dessen Referenzthreads laden kannst.');
        }

        $connection = $this->catalog->connection($binding['connection_id']);
        try {
            return $this->bridge->threads(
                $connection,
                $this->connectionToken((string) $connection['id']),
                $binding['external_project_id'],
                isset($p['cursor']) ? (string) $p['cursor'] : null,
                min(100, max(1, (int) ($p['limit'] ?? 50))),
            );
        } catch (T3ConnectionFailure $exception) {
            throw new Problem(502, 't3_unavailable', $exception->getMessage());
        }
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function startOAuth(string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        $resourceUrl = rtrim((string) $connection['canonical_url'], '/').'/mcp';
        $callback = (string) ($body['redirect_uri'] ?? (rtrim($this->publicOrigin, '/').'/auth/t3/callback'));
        if (!$this->connectionRules->permitsOAuthCallback($callback)) {
            throw new Problem(422, 'validation_failed', 'Der OAuth-Callback muss eine HTTPS-Adresse oder Loopback-Adresse verwenden.');
        }
        $state = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $registration = $this->oauth->begin((string) $connection['canonical_url'], $callback, $resourceUrl, $state, $challenge);
        $verifierRef = 'oauth-verifier-'.$this->store->id();
        $this->store->putSecret($verifierRef, $verifier);
        $expiresAt = (new \DateTimeImmutable('+10 minutes'))->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM);
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
        if (null === $flow || $flow['consumed'] || strtotime((string) $flow['expires_at']) <= time()) {
            throw new Problem(400, 't3_oauth_state_invalid', 'Die T3-Anmeldung ist abgelaufen oder ihre Browserbestätigung passt nicht.');
        }
        if (isset($p['iss']) && rtrim((string) $p['iss'], '/') !== rtrim((string) $flow['issuer'], '/')) {
            throw new Problem(400, 't3_oauth_issuer_mismatch', 'Der OAuth-Issuer stimmt nicht mit der entdeckten T3-Verbindung überein.');
        }
        $flow['consumed'] = true;
        $this->store->save('oauth_flows', $flow, 't3_oauth.callback_received');
        $connection = $this->catalog->connection((string) $flow['connection_id']);
        if (isset($p['error'])) {
            $connection['auth_status'] = 'revoked';
            $connection['diagnostic'] = mb_substr((string) ($p['error_description'] ?? $p['error']), 0, 500);
            $this->store->save('connections', $connection, 't3_connection.authorization_failed');

            return ['redirect' => $this->settingsRedirect((string) $connection['id'], 'authorization_failed')];
        }
        $code = (string) ($p['code'] ?? '');
        if ('' === $code) {
            throw new Problem(400, 't3_oauth_code_missing', 'T3 hat keinen Autorisierungscode zurückgegeben.');
        }
        $verifier = $this->store->secret((string) $flow['verifier_secret_ref']);
        $token = $this->oauth->exchange((string) $flow['token_endpoint'], $code, (string) $flow['callback_url'], (string) $flow['client_id'], $verifier, (string) $flow['resource_url']);
        if (!is_string($token['access_token'] ?? null) || '' === $token['access_token']) {
            throw new Problem(502, 't3_oauth_invalid_response', 'T3 hat kein verwendbares Zugangstoken ausgegeben.');
        }
        $secretRef = (string) ($connection['credential_secret_ref'] ?? ('t3-credential-'.$connection['id']));
        $this->store->putSecret($secretRef, $token['access_token']);
        $connection['credential_secret_ref'] = $secretRef;
        $connection['oauth_client_id'] = $flow['client_id'];
        $connection['oauth_issuer'] = $flow['issuer'];
        $connection['auth_epoch'] = (int) $connection['auth_epoch'] + 1;
        $connection['auth_status'] = 'valid';
        $connection['auth_expires_at'] = isset($token['expires_in']) ? (new \DateTimeImmutable('+'.max(1, (int) $token['expires_in']).' seconds'))->format(DATE_ATOM) : null;
        $connection['diagnostic'] = null;
        $this->store->save('connections', $connection, 't3_connection.authorized');
        $this->runImpact->connectionChanged((string) $connection['id'], ConnectionChangeImpact::RECONCILE, 'Die T3-Autorisierung wurde erneuert. Der zuvor gestartete Auftrag wird im gespeicherten Kontext abgeglichen.');

        return ['redirect' => $this->settingsRedirect((string) $connection['id'], 'authorized')];
    }

    /** @return array<string, mixed> */
    private function removeCredentials(string $id, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection($id);
        $reference = $connection['credential_secret_ref'] ?? null;
        if (is_string($reference) && '' !== $reference) {
            $this->store->deleteSecret($reference);
        }
        unset($connection['credential_secret_ref']);
        $connection['auth_status'] = 'missing';
        $connection['auth_expires_at'] = null;
        $connection['diagnostic'] = 'Die lokale T3-Autorisierung wurde entfernt.';
        $this->store->save('connections', $connection, 't3_connection.credentials_removed');
        $this->runImpact->connectionChanged($id, ConnectionChangeImpact::BLOCK_AUTH, 'Für die Beobachtung oder Fortsetzung wird eine neue T3-Anmeldung benötigt.');

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

        return $this->publicRecord($this->catalog->profile($id));
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function writeProfile(?string $id, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $connection = $this->catalog->connection((string) $body['connection_id']);
        $executionTarget = $body['execution_target'];
        $this->profileRules->assertExecutionTarget($executionTarget);
        $this->profileRules->assertSingleRun((int) ($body['max_parallel_runs'] ?? 1));
        foreach (($body['allowed_project_ids'] ?? []) as $projectId) {
            $project = $this->record('projects', (string) $projectId);
            $this->profileRules->assertProjectAssignable(!empty($project['archived']));
        }
        $existing = null === $id ? null : $this->catalog->profile($id);
        $profile = array_replace($existing ?? [], $body);
        $profile['bridge_plugin_id'] = $connection['bridge_plugin_id'] ?? $this->catalog->providerForBridge((string) $connection['bridge_id']);
        if (!is_string($profile['bridge_plugin_id'])) {
            throw new Problem(409, 'capability_unavailable', 'Für die Verbindung ist keine aktive Bridge-Implementierung registriert.');
        }
        $profile['max_parallel_runs'] = 1;
        $profile['prompt_template'] = (string) ($body['prompt_template'] ?? ($existing['prompt_template'] ?? ''));
        $profile['prompt_template_version'] = $this->profileRules->promptTemplateVersion($existing, $profile['prompt_template']);
        $profile['default_run_completion_policy'] = $body['default_run_completion_policy'] ?? ($existing['default_run_completion_policy'] ?? $this->defaultRunPolicy());
        $readiness = $this->profileRules->connectionReadiness($connection);
        $profile['configuration_valid'] = $readiness['valid'];
        $profile['configuration_error'] = $readiness['error'];
        $saved = $this->store->save('agent_profiles', $profile, null === $id ? 'agent_profile.created' : 'agent_profile.updated');

        return $this->publicRecord($saved);
    }

    /** @return array<string, mixed> */
    private function getBinding(string $projectId, Actor $actor): array
    {
        $actor->requireProject($projectId);
        $this->record('projects', $projectId);
        $binding = $this->catalog->bindingForProject($projectId);
        if (null === $binding) {
            throw new Problem(404, 'resource_not_found', 'Für dieses Projekt ist noch kein T3-Projekt gebunden.');
        }

        return $binding;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function setBinding(string $projectId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $project = $this->record('projects', $projectId);
        $this->bindingRules->assertProjectCanBeBound(!empty($project['archived']));
        $connection = $this->catalog->connection((string) $body['connection_id']);
        $this->bindingRules->assertConnectionReady($connection);
        $existing = $this->catalog->bindingForProject($projectId);
        $bindingRecord = $this->bindingRules->bindingRecord($projectId, (string) $connection['id'], (string) $body['external_project_id'], $existing);
        $binding = $this->store->save('project_bindings', $bindingRecord, null === $existing ? 'project.t3_binding_created' : 'project.t3_binding_changed');
        $project['active_binding_id'] = $binding['id'];
        $this->store->save('projects', $project, 'project.t3_binding_updated');
        if (null !== $existing && ($existing['connection_id'] !== $connection['id'] || $existing['external_project_id'] !== $binding['external_project_id'])) {
            $this->runImpact->projectBindingChanged((string) $existing['id'], 'Das aktive T3-Binding wurde geändert. Der zuvor eingefrorene Auftrag muss abgeglichen werden.');
        }

        return $binding;
    }

    private function performConnectionCheck(string $checkId): void
    {
        $check = $this->record('connection_checks', $checkId);
        $connection = $this->catalog->connection((string) $check['connection_id']);
        $check['checked_at'] = $this->store->now();
        if ('valid' !== $connection['auth_status']) {
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
            $this->refreshProfiles($connection, false);

            return;
        }
        try {
            $result = $this->bridge->capabilities($connection, $this->connectionToken((string) $connection['id']));
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
            $this->refreshProfiles($connection, (bool) $result['compatible']);
        } catch (T3ConnectionFailure $exception) {
            $authenticationFailure = $exception->isAuthenticationFailure();
            $connection['health'] = $authenticationFailure ? 'degraded' : 'unreachable';
            $connection['diagnostic'] = $exception->getMessage();
            $check['network'] = $authenticationFailure ? 'ok' : 'failed';
            $check['authentication'] = $authenticationFailure ? 'failed' : 'not_checked';
            $check['mcp_handshake'] = 'failed';
            $check['capabilities'] = 'not_checked';
            $check['diagnostic'] = $exception->getMessage();
            $check['status'] = 'failed';
            if ($authenticationFailure) {
                $connection['auth_status'] = 'expired';
            }
            $this->store->save('connections', $connection, 't3_connection.check_failed');
            $this->store->save('connection_checks', $check, 't3_connection.check_failed');
            $this->refreshProfiles($connection, false);
        }
    }

    /** @param array<string, mixed> $connection */
    private function refreshProfiles(array $connection, bool $compatible): void
    {
        foreach ($this->catalog->profilesForConnection((string) $connection['id']) as $profile) {
            $readiness = $this->profileRules->connectionReadiness($connection);
            $profile['configuration_valid'] = $compatible && $readiness['valid'];
            $profile['configuration_error'] = $profile['configuration_valid'] ? null : ($connection['diagnostic'] ?? $readiness['error']);
            $this->store->save('agent_profiles', $profile, 'agent_profile.configuration_refreshed');
        }
    }

    private function connectionToken(string $connectionId): string
    {
        $token = $this->catalog->accessToken($connectionId);
        if (!is_string($token) || '' === $token) {
            throw new T3ConnectionException('Die lokal gespeicherte T3-Autorisierung ist nicht verfügbar.', true);
        }

        return $token;
    }

    private function settingsRedirect(string $connectionId, string $status): string
    {
        return '/agents?connection='.rawurlencode($connectionId).'&authorization='.rawurlencode($status);
    }

    /** @return array<string, mixed> */
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

    private function publicRecord(array $record): array
    {
        if (isset($record['bridge_id']) && !isset($record['bridge_plugin_id'])) {
            $record['bridge_plugin_id'] = $this->catalog->providerForBridge((string) $record['bridge_id']);
        }
        if (isset($record['connection_id']) && !isset($record['bridge_plugin_id'])) {
            $record['bridge_plugin_id'] = $this->catalog->providerIdForConnection((string) $record['connection_id']);
        }

        return $this->store->redact($record);
    }

    private function defaultRunPolicy(): array
    {
        return [
            'require_external_settled' => true, 'required_evidence_kinds' => [],
            'required_criterion_ids' => [], 'require_human_phase_decision' => false,
            'require_human_confirmed_evidence' => false,
        ];
    }
}
