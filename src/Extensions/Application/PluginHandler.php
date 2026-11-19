<?php

declare(strict_types=1);

namespace App\Extensions\Application;

use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

final class PluginHandler
{
    private const LINK_NOTES_ID = 'falkenwarte.link-notes';
    private const CONTRACT_VERSION = '1.0';
    private const LINK_NOTES_SCHEMA_ID = 'https://falkenwarte.local/schemas/link-notes-settings-v1';

    public function __construct(private readonly Store $store, private readonly ExtensionPersistence $extensions)
    {
    }

    public function handles(string $op): bool
    {
        return in_array($op, [
            'plugins_list',
            'plugins_get',
            'plugins_activate',
            'plugins_drain',
            'plugins_deactivate',
            'plugins_configure',
            'plugin_configuration_get',
            'plugin_install_plan_create',
            'plugin_install_plan_get',
            'plugin_install_plans_list',
            'task_link_notes_list',
            'task_link_note_create',
            'task_link_note_update',
            'task_link_note_remove',
        ], true);
    }

    public function handle(string $op, array $p, array $body, Actor $actor): array
    {
        return match ($op) {
            'plugins_list' => $this->list($p, $actor),
            'plugins_get' => $this->get($this->requiredId($p, 'plugin_id')),
            'plugins_activate' => $this->activate($this->requiredId($p, 'plugin_id'), $body, $actor),
            'plugins_drain' => $this->drain($this->requiredId($p, 'plugin_id'), $body, $actor),
            'plugins_deactivate' => $this->deactivate($this->requiredId($p, 'plugin_id'), $body, $actor),
            'plugins_configure' => $this->configure($this->requiredId($p, 'plugin_id'), $body, $actor),
            'plugin_configuration_get' => $this->configuration($this->requiredId($p, 'plugin_id')),
            'plugin_install_plan_create' => $this->createInstallPlan($body, $actor),
            'plugin_install_plan_get' => $this->installPlan($this->requiredId($p, 'plan_id')),
            'plugin_install_plans_list' => $this->listInstallPlans($p, $actor),
            'task_link_notes_list' => $this->linkNotes($this->requiredId($p, 'task_id'), $actor),
            'task_link_note_create' => $this->createLinkNote($this->requiredId($p, 'task_id'), $body, $actor),
            'task_link_note_update' => $this->updateLinkNote($this->requiredId($p, 'task_id'), $this->requiredId($p, 'note_id'), $body, $actor),
            'task_link_note_remove' => $this->removeLinkNote($this->requiredId($p, 'task_id'), $this->requiredId($p, 'note_id'), $actor),
            default => throw new Problem(404, 'resource_not_found', 'Plugin operation not found.'),
        };
    }

    public function work(string $kind, array $payload): void
    {
        if (!str_starts_with($kind, 'plugin.')) {
            return;
        }

        $pluginId = $payload['plugin_id'] ?? null;
        if (!is_string($pluginId) || !$this->knownPlugin($pluginId)) {
            return;
        }

        $plugin = $this->plugin($pluginId);
        if ($kind === 'plugin.activate' && $plugin['state'] === 'enabling') {
            $plugin['state'] = 'enabled';
            $plugin['last_safe_state'] = 'enabled';
            $plugin['last_error'] = null;
            $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        }

        if ($kind === 'plugin.drain' && $plugin['state'] === 'draining') {
            $activeWork = $this->activeWorkCounts($pluginId);
            $plugin['active_run_count'] = $activeWork['runs'];
            $plugin['pending_job_count'] = $activeWork['jobs'];

            if ($activeWork['runs'] === 0 && $activeWork['jobs'] === 0) {
                $plugin['state'] = 'disabled';
                $plugin['last_safe_state'] = 'disabled';
            }

            $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        }
    }

    private function list(array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $plugins = [$this->plugin(self::LINK_NOTES_ID)];

        foreach ($this->store->all('plugins') as $stored) {
            if (($stored['id'] ?? null) !== self::LINK_NOTES_ID) {
                $plugins[] = $stored;
            }
        }

        return $this->store->page($plugins, $p);
    }

    private function get(string $pluginId): array
    {
        if (!$this->knownPlugin($pluginId)) {
            throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
        }

        return $this->plugin($pluginId);
    }

    private function activate(string $pluginId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $plugin = $this->requireInstalledPlugin($pluginId);

        if (($body['acknowledged_contract_version'] ?? null) !== $plugin['contract_version']) {
            throw new Problem(409, 'plugin_contract_mismatch', 'Review and acknowledge the installed plugin contract version.');
        }

        if (!in_array($plugin['state'], ['installed_disabled', 'disabled'], true)) {
            throw new Problem(409, 'plugin_state_conflict', 'The plugin cannot be activated from its current state.');
        }

        foreach ($plugin['dependencies'] as $dependency) {
            if (!$dependency['satisfied']) {
                throw new Problem(409, 'plugin_dependency_unsatisfied', 'A required plugin is unavailable.');
            }
        }

        $configuration = $this->storedConfiguration($pluginId);
        if ($pluginId === self::LINK_NOTES_ID && ($configuration['schema_id'] ?? self::LINK_NOTES_SCHEMA_ID) !== self::LINK_NOTES_SCHEMA_ID) {
            throw new Problem(409, 'plugin_configuration_invalid', 'The link notes configuration uses an unsupported schema.');
        }

        $plugin['state'] = 'enabling';
        $plugin['last_error'] = null;
        $plugin = $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        $this->store->enqueue('plugin.activate', ['plugin_id' => $pluginId]);

        return $this->store->accepted([
            'resource_type' => 'plugin',
            'id' => $pluginId,
            'version' => $plugin['version'],
            'url' => '/api/v1/plugins/'.rawurlencode($pluginId),
        ]);
    }

    private function drain(string $pluginId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $plugin = $this->requireInstalledPlugin($pluginId);

        if ($plugin['state'] !== 'enabled') {
            throw new Problem(409, 'plugin_state_conflict', 'Only an enabled plugin can enter the drain state.');
        }

        if (!in_array($body['policy'] ?? null, ['finish_active', 'request_cancel'], true) || trim((string) ($body['reason'] ?? '')) === '') {
            throw new Problem(422, 'validation_failed', 'A drain policy and reason are required.');
        }

        $plugin['state'] = 'draining';
        $plugin['last_safe_state'] = 'enabled';
        $plugin['drain_policy'] = $body['policy'];
        $plugin['drain_reason'] = trim((string) $body['reason']);
        $counts = $this->activeWorkCounts($pluginId);
        $plugin['active_run_count'] = $counts['runs'];
        $plugin['pending_job_count'] = $counts['jobs'];
        $plugin = $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        $this->store->enqueue('plugin.drain', ['plugin_id' => $pluginId, 'policy' => $body['policy']]);

        return $this->store->accepted([
            'resource_type' => 'plugin',
            'id' => $pluginId,
            'version' => $plugin['version'],
            'url' => '/api/v1/plugins/'.rawurlencode($pluginId),
        ]);
    }

    private function deactivate(string $pluginId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $plugin = $this->requireInstalledPlugin($pluginId);

        if ($plugin['state'] !== 'disabled') {
            throw new Problem(409, 'plugin_state_conflict', 'The plugin must finish draining before deactivation.');
        }

        if (trim((string) ($body['reason'] ?? '')) === '') {
            throw new Problem(422, 'validation_failed', 'A deactivation reason is required.');
        }

        foreach ($this->store->all('plugins') as $other) {
            if (($other['state'] ?? null) === 'enabled') {
                foreach ($other['dependencies'] ?? [] as $dependency) {
                    if (($dependency['plugin_id'] ?? null) === $pluginId) {
                        throw new Problem(409, 'plugin_dependency_active', 'An enabled plugin depends on this plugin.');
                    }
                }
            }
        }

        $plugin['state'] = 'installed_disabled';
        $plugin['last_safe_state'] = 'installed_disabled';
        $plugin['deactivation_reason'] = trim((string) $body['reason']);
        $plugin = $this->store->save('plugins', $plugin, 'PluginActivationChanged');

        return $this->store->accepted([
            'resource_type' => 'plugin',
            'id' => $pluginId,
            'version' => $plugin['version'],
            'url' => '/api/v1/plugins/'.rawurlencode($pluginId),
        ]);
    }

    private function configure(string $pluginId, array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $plugin = $this->requireInstalledPlugin($pluginId);

        if ($pluginId !== self::LINK_NOTES_ID) {
            throw new Problem(409, 'plugin_configuration_unavailable', 'This plugin does not expose an editable configuration.');
        }

        $values = $body['values'] ?? null;
        if (($body['schema_id'] ?? null) !== self::LINK_NOTES_SCHEMA_ID || !is_array($values) || array_diff(array_keys($values), ['enabled_labels']) !== []) {
            throw new Problem(422, 'validation_failed', 'The plugin configuration does not match its registered schema.');
        }

        $labels = $values['enabled_labels'] ?? [];
        if (!is_array($labels) || count($labels) > 200 || array_filter($labels, static fn ($label): bool => !is_string($label) || $label === '') !== []) {
            throw new Problem(422, 'validation_failed', 'Enabled labels must be a list of label identifiers.');
        }

        $configuration = [
            'id' => $pluginId,
            'plugin_id' => $pluginId,
            'plugin_version' => $plugin['version'],
            'schema_id' => self::LINK_NOTES_SCHEMA_ID,
            'schema' => [
                'type' => 'object',
                'properties' => ['enabled_labels' => ['type' => 'array', 'items' => ['type' => 'string']]],
                'required' => [],
                'additionalProperties' => false,
            ],
            'values' => ['enabled_labels' => array_values(array_unique($labels))],
            'redacted_fields' => [],
        ];
        $this->store->save('plugin_configurations', $configuration, 'PluginConfigurationChanged');

        return $this->plugin($pluginId);
    }

    private function configuration(string $pluginId): array
    {
        if (!$this->knownPlugin($pluginId)) {
            throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
        }

        $stored = $this->storedConfiguration($pluginId);

        return [
            'plugin_id' => $pluginId,
            'plugin_version' => 1,
            'schema_id' => self::LINK_NOTES_SCHEMA_ID,
            'schema' => [
                'type' => 'object',
                'properties' => ['enabled_labels' => ['type' => 'array', 'items' => ['type' => 'string']]],
                'required' => [],
                'additionalProperties' => false,
            ],
            'values' => $stored['values'] ?? ['enabled_labels' => []],
            'redacted_fields' => [],
        ];
    }

    private function createInstallPlan(array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $pluginId = $body['plugin_id'] ?? null;
        $targetVersion = $body['target_version'] ?? null;
        $source = $body['source'] ?? null;

        if (!is_string($pluginId) || preg_match('/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/', $pluginId) !== 1 || !is_string($targetVersion) || trim($targetVersion) === '' || !in_array($source, ['registry', 'local_build'], true)) {
            throw new Problem(422, 'validation_failed', 'A plugin identifier, version and supported source are required.');
        }

        $plan = [
            'id' => $this->store->id(),
            'plugin_id' => $pluginId,
            'target_version' => trim($targetVersion),
            'status' => 'prepared',
            'requires_build' => true,
            'requires_restart' => true,
            'requires_migration' => $pluginId === self::LINK_NOTES_ID,
            'steps' => [
                ['kind' => 'resolve_package', 'description' => 'Paket und Zielversion in einem geprüften Build auflösen.', 'operator_required' => true],
                ['kind' => 'review_dependencies', 'description' => 'Abhängigkeiten und Pluginvertrag prüfen.', 'operator_required' => true],
                ['kind' => 'backup', 'description' => 'Vor der Installation ein konsistentes Backup erstellen.', 'operator_required' => true],
                ['kind' => 'build_image', 'description' => 'Ein neues App-Image mit dem Plugin bauen und prüfen.', 'operator_required' => true],
                ['kind' => 'migrate', 'description' => 'Pluginmigrationen unter der zentralen Sperre ausführen.', 'operator_required' => true],
                ['kind' => 'restart', 'description' => 'Die Installation mit dem geprüften Image neu starten.', 'operator_required' => true],
                ['kind' => 'verify', 'description' => 'Pluginstatus und erforderliche Fähigkeiten prüfen.', 'operator_required' => true],
            ],
            'warnings' => ['Dieser Plan führt keine Paket-, Shell-, Composer- oder Containeraktion aus.'],
            'created_at' => $this->store->now(),
        ];

        return $this->planView($this->store->save('plugin_install_plans', $plan, 'PluginInstallPlanPrepared'));
    }

    private function linkNotes(string $taskId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $notes = array_values(array_filter(
            $this->store->all('plugin_link_notes', $task['project_id']),
            static fn (array $note): bool => ($note['task_id'] ?? null) === $taskId && ($note['deleted_at'] ?? null) === null,
        ));

        usort($notes, static fn (array $left, array $right): int => [$left['created_at'] ?? '', $left['id']] <=> [$right['created_at'] ?? '', $right['id']]);

        return $this->store->page($notes);
    }

    private function createLinkNote(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $linkId = $body['link_id'] ?? null;
        $noteText = trim((string) ($body['note'] ?? ''));

        if (!is_string($linkId) || !$this->taskHasLink($taskId, $linkId) || $noteText === '' || mb_strlen($noteText) > 2000) {
            throw new Problem(422, 'validation_failed', 'A registered task link and a note of 1 to 2000 characters are required.');
        }

        $record = [
            'project_id' => $task['project_id'],
            'task_id' => $taskId,
            'link_id' => $linkId,
            'note' => $noteText,
            'created_by' => $actor->ref(),
            'history' => [[
                'version' => 1,
                'note' => $noteText,
                'actor' => $actor->ref(),
                'recorded_at' => $this->store->now(),
            ]],
            'deleted_at' => null,
        ];

        return $this->store->save('plugin_link_notes', $record, 'LinkNoteCreated');
    }

    private function updateLinkNote(string $taskId, string $noteId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $note = $this->store->find('plugin_link_notes', $noteId);
        if ($note === null || ($note['task_id'] ?? null) !== $taskId || ($note['project_id'] ?? null) !== $task['project_id'] || ($note['deleted_at'] ?? null) !== null) {
            throw new Problem(404, 'resource_not_found', 'The requested link note does not exist.');
        }

        $text = trim((string) ($body['note'] ?? ''));
        if ($text === '' || mb_strlen($text) > 2000) {
            throw new Problem(422, 'validation_failed', 'A note of 1 to 2000 characters is required.');
        }

        $note['note'] = $text;
        $note['history'][] = [
            'version' => $note['version'] + 1,
            'note' => $text,
            'actor' => $actor->ref(),
            'recorded_at' => $this->store->now(),
        ];

        return $this->store->save('plugin_link_notes', $note, 'LinkNoteChanged');
    }

    private function removeLinkNote(string $taskId, string $noteId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $note = $this->store->find('plugin_link_notes', $noteId);
        if ($note === null || ($note['task_id'] ?? null) !== $taskId || ($note['project_id'] ?? null) !== $task['project_id'] || ($note['deleted_at'] ?? null) !== null) {
            throw new Problem(404, 'resource_not_found', 'The requested link note does not exist.');
        }

        $note['deleted_at'] = $this->store->now();
        $note['history'][] = [
            'version' => $note['version'] + 1,
            'note' => null,
            'actor' => $actor->ref(),
            'recorded_at' => $note['deleted_at'],
            'change' => 'removed',
        ];

        return $this->store->save('plugin_link_notes', $note, 'LinkNoteRemoved');
    }

    private function task(string $taskId, Actor $actor): array
    {
        $task = $this->store->find('tasks', $taskId);
        if ($task === null) {
            throw new Problem(404, 'resource_not_found', 'The requested task does not exist.');
        }

        $actor->requireProject($task['project_id']);

        return $task;
    }

    private function taskHasLink(string $taskId, string $linkId): bool
    {
        foreach ($this->store->all('link_collections') as $collection) {
            if (($collection['task_id'] ?? null) !== $taskId) {
                continue;
            }

            foreach ($collection['links'] ?? [] as $link) {
                if (($link['id'] ?? null) === $linkId) {
                    return true;
                }
            }
        }

        $task = $this->store->find('tasks', $taskId);
        foreach ($task['link_collections'] ?? [] as $collection) {
            foreach ($collection['links'] ?? [] as $link) {
                if (($link['id'] ?? null) === $linkId) {
                    return true;
                }
            }
        }
        foreach ($task['links'] ?? [] as $link) {
            if (($link['id'] ?? null) === $linkId) {
                return true;
            }
        }

        return false;
    }

    private function requireLinkNotesEnabled(array $task): void
    {
        $plugin = $this->plugin(self::LINK_NOTES_ID);
        if ($plugin['state'] !== 'enabled') {
            throw new Problem(409, 'capability_unavailable', 'Linknotizen sind derzeit nicht aktiviert.');
        }

        $configuration = $this->storedConfiguration(self::LINK_NOTES_ID);
        $enabledLabels = $configuration['values']['enabled_labels'] ?? [];
        if ($enabledLabels === []) {
            return;
        }

        $taskLabels = $task['label_ids'] ?? [];
        if (array_intersect($enabledLabels, $taskLabels) === []) {
            throw new Problem(409, 'capability_unavailable', 'Linknotizen sind für die Labels dieses Tickets nicht freigegeben.');
        }
    }

    private function installPlan(string $planId): array
    {
        $plan = $this->store->find('plugin_install_plans', $planId);
        if ($plan === null) {
            throw new Problem(404, 'resource_not_found', 'The requested plugin installation plan does not exist.');
        }

        return $this->planView($plan);
    }

    private function listInstallPlans(array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $plans = array_map(fn (array $plan): array => $this->planView($plan), $this->store->all('plugin_install_plans'));
        usort($plans, static fn (array $left, array $right): int => strcmp($right['created_at'], $left['created_at']));

        return $this->store->page($plans, $p);
    }

    private function planView(array $plan): array
    {
        return array_intersect_key($plan, array_flip([
            'id', 'plugin_id', 'target_version', 'status', 'requires_build', 'requires_restart',
            'requires_migration', 'steps', 'warnings', 'created_at',
        ]));
    }

    private function requireInstalledPlugin(string $pluginId): array
    {
        if (!$this->knownPlugin($pluginId)) {
            throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
        }

        return $this->plugin($pluginId);
    }

    private function plugin(string $pluginId): array
    {
        if ($pluginId !== self::LINK_NOTES_ID) {
            $stored = $this->store->find('plugins', $pluginId);
            if ($stored === null) {
                throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
            }

            $stored['allowed_actions'] = $this->allowedActions((string) ($stored['state'] ?? 'failed'));

            return array_intersect_key($stored, array_flip([
                'id', 'version', 'name', 'installed_version', 'contract_version', 'state', 'last_safe_state',
                'description', 'dependencies', 'capabilities', 'active_run_count', 'pending_job_count',
                'retained_data_bytes', 'configuration_schema_id', 'restart_required', 'last_error', 'allowed_actions',
            ]));
        }

        $stored = $this->store->find('plugins', self::LINK_NOTES_ID) ?? [];
        $plugin = [
            'id' => self::LINK_NOTES_ID,
            'version' => 1,
            'name' => 'Linknotizen',
            'installed_version' => '1.0.0',
            'contract_version' => self::CONTRACT_VERSION,
            'state' => 'installed_disabled',
            'last_safe_state' => null,
            'description' => 'Ergänzt lokale Notizen zu registrierten Ticketlinks. Es werden keine externen URLs abgerufen.',
            'dependencies' => [],
            'capabilities' => ['links.notes'],
            'active_run_count' => 0,
            'pending_job_count' => 0,
            'retained_data_bytes' => $this->retainedBytes(),
            'configuration_schema_id' => self::LINK_NOTES_SCHEMA_ID,
            'restart_required' => false,
            'last_error' => null,
        ];

        foreach (['version', 'state', 'last_safe_state', 'last_error', 'restart_required', 'configuration_schema_id'] as $field) {
            if (array_key_exists($field, $stored)) {
                $plugin[$field] = $stored[$field];
            }
        }

        $counts = $this->activeWorkCounts(self::LINK_NOTES_ID);
        $plugin['active_run_count'] = $counts['runs'];
        $plugin['pending_job_count'] = $counts['jobs'];
        $plugin['retained_data_bytes'] = $this->retainedBytes();
        $plugin['allowed_actions'] = $this->allowedActions($plugin['state']);

        return $plugin;
    }

    private function allowedActions(string $state): array
    {
        $actions = [];
        foreach ([
            'activate' => ['installed_disabled', 'disabled'],
            'drain' => ['enabled'],
            'deactivate' => ['disabled'],
            'configure' => ['installed_disabled', 'disabled', 'enabled'],
        ] as $action => $states) {
            $enabled = in_array($state, $states, true);
            $actions[] = [
                'action' => $action,
                'enabled' => $enabled,
                'reason' => $enabled ? null : 'Der aktuelle Pluginstatus erlaubt diese Aktion nicht.',
            ];
        }

        return $actions;
    }

    private function storedConfiguration(string $pluginId): array
    {
        return $this->store->find('plugin_configurations', $pluginId) ?? [];
    }

    private function activeWorkCounts(string $pluginId): array
    {
        $runs = array_filter($this->store->all('runs'), static fn (array $run): bool => ($run['plugin_id'] ?? null) === $pluginId && !in_array($run['state'] ?? null, ['succeeded', 'failed', 'cancelled'], true));
        return ['runs' => count($runs), 'jobs' => $this->extensions->pendingWorkCount($pluginId)];
    }

    private function retainedBytes(): int
    {
        $notes = $this->store->all('plugin_link_notes');
        if ($notes === []) {
            return 0;
        }

        return array_sum(array_map(static fn (array $note): int => strlen(json_encode($note, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''), $notes));
    }

    private function knownPlugin(string $pluginId): bool
    {
        return $pluginId === self::LINK_NOTES_ID || $this->store->find('plugins', $pluginId) !== null;
    }

    private function requiredId(array $params, string $key): string
    {
        $value = $params[$key] ?? null;
        if (!is_string($value) || trim($value) === '') {
            throw new Problem(422, 'validation_failed', 'A valid '.$key.' is required.');
        }

        return $value;
    }
}
