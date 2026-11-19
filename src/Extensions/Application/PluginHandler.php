<?php

declare(strict_types=1);

namespace App\Extensions\Application;

use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use Falkenwarte\LinkNotes\Application\LinkNoteRepository;

final class PluginHandler
{
    private const LINK_NOTES_ID = 'falkenwarte.link-notes';

    public function __construct(
        private readonly Store $store,
        private readonly ExtensionPersistence $extensions,
        private readonly PluginRegistry $registry,
        private readonly ProviderRunDrainPort $runDrain,
        private readonly PluginEventDispatcher $events,
        private readonly LinkNoteRepository $linkNotes,
    ) {
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
            'plugin_install_plan_cancel',
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
            'plugin_install_plan_cancel' => $this->cancelRemovalPlan($this->requiredId($p, 'plan_id'), $actor),
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

        $plugin = $this->requireInstalledPlugin($pluginId);
        if ('plugin.activate' === $kind && 'enabling' === $plugin['state']) {
            $plugin['state'] = 'enabled';
            $plugin['last_safe_state'] = 'enabled';
            $plugin['last_error'] = null;
            $this->store->save('plugins', $plugin, 'PluginActivationChanged');
            $this->events->dispatch($pluginId);
        }

        if ('plugin.drain' === $kind && 'draining' === $plugin['state']) {
            $activeWork = $this->activeWorkCounts($pluginId);
            $plugin['active_run_count'] = $activeWork['runs'];
            $plugin['pending_job_count'] = $activeWork['jobs'];
            $plugin['unresolved_external_activity_count'] = $activeWork['external'];

            if (0 === $activeWork['runs'] && 0 === $activeWork['jobs'] && 0 === $activeWork['external']) {
                $plugin['state'] = 'disabled';
                $plugin['last_safe_state'] = 'disabled';
            }

            $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        }
    }

    public function completeCancellationDrains(): void
    {
        foreach ($this->store->all('plugins') as $plugin) {
            if ('draining' !== ($plugin['state'] ?? null) || 'request_cancel' !== ($plugin['drain_policy'] ?? null)) {
                continue;
            }
            $id = $plugin['id'];
            if (0 === array_sum($this->activeWorkCounts($id))) {
                // Recheck state and outstanding work under the writer lock before completing the drain.
                $this->store->atomic(fn () => $this->work('plugin.drain', ['plugin_id' => $id]));
            }
        }
    }

    private function list(array $p, Actor $actor): array
    {
        $actor->requireOwner();
        $plugins = [];
        foreach ($this->registry->manifests() as $manifest) {
            $plugins[] = $this->plugin((string) $manifest['id']);
        }
        foreach ($this->store->all('plugins') as $stored) {
            $pluginId = $stored['id'] ?? null;
            if (!is_string($pluginId) || $this->registry->has($pluginId) || !$this->hasPreparedRemoval($pluginId, $stored)) {
                continue;
            }
            $plugins[] = $this->removedPlugin($pluginId, $stored);
        }

        usort($plugins, static fn (array $left, array $right): int => strcmp($left['id'], $right['id']));

        return $this->store->page($plugins, $p);
    }

    private function get(string $pluginId): array
    {
        if ($this->knownPlugin($pluginId)) {
            return $this->plugin($pluginId);
        }

        $stored = $this->store->find('plugins', $pluginId);
        if (null !== $stored && $this->hasPreparedRemoval($pluginId, $stored)) {
            return $this->removedPlugin($pluginId, $stored);
        }

        throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
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
        $schemaId = $this->settingsSchemaId($pluginId);
        if (($configuration['schema_id'] ?? $schemaId) !== $schemaId) {
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

        if (!in_array($plugin['state'], ['enabled', 'draining'], true)) {
            throw new Problem(409, 'plugin_state_conflict', 'Only an enabled plugin can enter the drain state.');
        }

        if (!in_array($body['policy'] ?? null, ['finish_active', 'request_cancel'], true) || '' === trim((string) ($body['reason'] ?? ''))) {
            throw new Problem(422, 'validation_failed', 'A drain policy and reason are required.');
        }

        if ('enabled' === $plugin['state']) {
            $plugin['state'] = 'draining';
            $plugin['last_safe_state'] = 'enabled';
        }
        $plugin['drain_policy'] = $body['policy'];
        $plugin['drain_reason'] = trim((string) $body['reason']);
        $counts = $this->activeWorkCounts($pluginId);
        $plugin['active_run_count'] = $counts['runs'];
        $plugin['pending_job_count'] = $counts['jobs'];
        $plugin['unresolved_external_activity_count'] = $counts['external'];
        $plugin = $this->store->save('plugins', $plugin, 'PluginActivationChanged');
        if ('request_cancel' === $body['policy']) {
            $this->runDrain->requestCancelForProvider($pluginId, trim((string) $body['reason']));
        }
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

        if ('disabled' !== $plugin['state']) {
            throw new Problem(409, 'plugin_state_conflict', 'The plugin must finish draining before deactivation.');
        }

        if ('' === trim((string) ($body['reason'] ?? ''))) {
            throw new Problem(422, 'validation_failed', 'A deactivation reason is required.');
        }

        foreach ($this->registry->manifests() as $manifest) {
            $dependentId = (string) $manifest['id'];
            if (!in_array($this->registry->state($dependentId), ['enabled', 'draining'], true)) {
                continue;
            }
            foreach ($this->registry->dependencies($dependentId) as $dependency) {
                if ($dependency['plugin_id'] === $pluginId) {
                    throw new Problem(409, 'plugin_dependency_active', 'An enabled plugin depends on this plugin.');
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
        if (!in_array($plugin['state'], ['installed_disabled', 'disabled', 'enabled'], true)) {
            throw new Problem(409, 'plugin_state_conflict', 'Configuration cannot change while the plugin is transitioning or pending removal.');
        }

        $values = $body['values'] ?? null;
        $manifest = $this->registry->manifest($pluginId);
        $schemaId = $this->settingsSchemaId($pluginId);
        if (($body['schema_id'] ?? null) !== $schemaId || !is_array($values) || [] !== array_diff(array_keys($values), array_keys($manifest['settings_schema']['properties'] ?? []))) {
            throw new Problem(422, 'validation_failed', 'The plugin configuration does not match its registered schema.');
        }
        $this->validateConfigurationValues($manifest['settings_schema'], $values);

        $configuration = [
            'id' => $pluginId,
            'plugin_id' => $pluginId,
            'plugin_version' => $plugin['version'],
            'schema_id' => $schemaId,
            'schema' => $manifest['settings_schema'],
            'values' => array_replace($this->defaultSettings($manifest['settings_schema']), $values),
            'redacted_fields' => [],
        ];
        $config = $this->store->save('plugin_configurations', $configuration, 'PluginConfigurationChanged');
        $plugin['configuration_version'] = $config['version'];
        $this->store->save('plugins', $plugin, 'PluginConfigurationChanged');

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
            'plugin_version' => $this->plugin($pluginId)['version'],
            'schema_id' => $this->settingsSchemaId($pluginId),
            'schema' => $this->registry->manifest($pluginId)['settings_schema'],
            'values' => $stored['values'] ?? $this->defaultSettings($this->registry->manifest($pluginId)['settings_schema']),
            'redacted_fields' => [],
        ];
    }

    private function createInstallPlan(array $body, Actor $actor): array
    {
        $actor->requireOwner();
        $operation = $body['operation'] ?? 'install';
        $pluginId = $body['plugin_id'] ?? null;
        $targetVersion = $body['target_version'] ?? null;
        $source = $body['source'] ?? null;

        if (!is_string($pluginId) || 1 !== preg_match('/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/', $pluginId) || !in_array($operation, ['install', 'remove'], true)) {
            throw new Problem(422, 'validation_failed', 'A plugin identifier and supported package operation are required.');
        }

        if ('remove' === $operation) {
            return $this->store->atomic(fn (): array => $this->createRemovalPlan($pluginId));
        }

        if (!is_string($targetVersion) || '' === trim($targetVersion) || !in_array($source, ['registry', 'local_build'], true)) {
            throw new Problem(422, 'validation_failed', 'An installation plan requires a target version and supported source.');
        }

        $plan = [
            'id' => $this->store->id(),
            'operation' => 'install',
            'plugin_id' => $pluginId,
            'target_version' => trim($targetVersion),
            'source' => $source,
            'status' => 'prepared',
            'requires_build' => true,
            'requires_restart' => true,
            'requires_migration' => $this->registry->has($pluginId)
                && (int) ($this->registry->manifest($pluginId)['migrations']['data_version'] ?? 0) > 0,
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
        if (is_string($body['manifest_sha256'] ?? null)) {
            $plan['manifest_sha256'] = $body['manifest_sha256'];
        }

        return $this->planView($this->store->save('plugin_install_plans', $plan, 'PluginInstallPlanPrepared'));
    }

    private function createRemovalPlan(string $pluginId): array
    {
        $plugin = $this->requireInstalledPlugin($pluginId);
        if (!in_array($plugin['state'], ['installed_disabled', 'disabled'], true)) {
            throw new Problem(409, 'plugin_state_conflict', 'A plugin must finish draining and be disabled before a removal plan can be prepared.');
        }

        $activeWork = $this->activeWorkCounts($pluginId);
        if (0 !== $activeWork['runs'] || 0 !== $activeWork['jobs'] || 0 !== $activeWork['external']) {
            throw new Problem(409, 'plugin_work_active', 'Active or unresolved plugin work must be resolved before a removal plan can be prepared.');
        }

        $activeDependents = [];
        foreach ($this->registry->manifests() as $manifest) {
            $dependentId = (string) $manifest['id'];
            if (!in_array($this->registry->state($dependentId), ['enabled', 'draining'], true)) {
                continue;
            }
            foreach ($this->registry->dependencies($dependentId) as $dependency) {
                if ($dependency['plugin_id'] === $pluginId) {
                    $activeDependents[] = $dependentId;
                    break;
                }
            }
        }
        if ([] !== $activeDependents) {
            throw new Problem(409, 'plugin_dependency_active', 'Enabled or draining plugins depend on the requested plugin.');
        }

        $plan = [
            'id' => $this->store->id(),
            'operation' => 'remove',
            'plugin_id' => $pluginId,
            'target_version' => $plugin['installed_version'],
            'status' => 'prepared',
            'previous_plugin_state' => $plugin['state'],
            'requires_build' => true,
            'requires_restart' => true,
            'requires_migration' => false,
            'steps' => [
                ['kind' => 'review_dependents', 'description' => 'Abhängige Plugins und verbleibende Daten vor dem Imagewechsel prüfen.', 'operator_required' => true],
                ['kind' => 'backup', 'description' => 'Vor der Paketentfernung ein konsistentes Backup erstellen.', 'operator_required' => true],
                ['kind' => 'preserve_data', 'description' => 'Plugin-Daten und historische Ansichten im neuen Image erhalten.', 'operator_required' => true],
                ['kind' => 'build_image', 'description' => 'Ein geprüftes App-Image ohne das Plugin bauen.', 'operator_required' => true],
                ['kind' => 'restart', 'description' => 'Die Entfernung mit dem geprüften Image neu starten.', 'operator_required' => true],
                ['kind' => 'verify', 'description' => 'Prüfen, dass das Paket entfernt ist und lokale Daten lesbar bleiben.', 'operator_required' => true],
            ],
            'warnings' => ['Dieser Plan führt keine Paket-, Shell-, Composer- oder Containeraktion aus.', 'Das Plugin bleibt als uninstall_pending gesperrt; Paket und lokale Daten bleiben bis zum Betreiberwechsel vorhanden.'],
            'created_at' => $this->store->now(),
        ];
        $plugin['state'] = 'uninstall_pending';
        $plugin['last_safe_state'] = $plan['previous_plugin_state'];
        $plugin['removal_plan_id'] = $plan['id'];
        $this->store->save('plugins', $plugin, 'PluginRemovalPlanPrepared');

        return $this->planView($this->store->save('plugin_install_plans', $plan, 'PluginRemovalPlanPrepared'));
    }

    private function cancelRemovalPlan(string $planId, Actor $actor): array
    {
        $actor->requireOwner();

        return $this->store->atomic(function () use ($planId): array {
            $plan = $this->store->find('plugin_install_plans', $planId);
            if (null === $plan) {
                throw new Problem(404, 'resource_not_found', 'The requested plugin change plan does not exist.');
            }
            if ('remove' !== ($plan['operation'] ?? null) || 'prepared' !== ($plan['status'] ?? null)) {
                throw new Problem(409, 'plugin_plan_conflict', 'Only a pending removal plan can be cancelled.');
            }

            $pluginId = (string) $plan['plugin_id'];
            if (!$this->registry->has($pluginId)) {
                throw new Problem(409, 'plugin_plan_conflict', 'The package is absent from the running image and cannot be restored by cancelling this plan.');
            }
            $plugin = $this->requireInstalledPlugin($pluginId);
            if ('uninstall_pending' !== $plugin['state'] || ($plugin['removal_plan_id'] ?? null) !== $planId) {
                throw new Problem(409, 'plugin_plan_conflict', 'The plugin no longer matches this pending removal plan.');
            }
            $previousState = $plan['previous_plugin_state'] ?? $plugin['last_safe_state'] ?? null;
            if (!in_array($previousState, ['installed_disabled', 'disabled'], true)) {
                throw new Problem(409, 'plugin_plan_conflict', 'The previous safe plugin state cannot be restored.');
            }

            $plugin['state'] = $previousState;
            $plugin['last_safe_state'] = $previousState;
            unset($plugin['removal_plan_id']);
            $this->store->save('plugins', $plugin, 'PluginRemovalPlanCancelled');

            $plan['status'] = 'cancelled';

            return $this->planView($this->store->save('plugin_install_plans', $plan, 'PluginRemovalPlanCancelled'));
        });
    }

    private function linkNotes(string $taskId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);

        return $this->store->page($this->linkNotes->forTask($task['project_id'], $taskId));
    }

    private function createLinkNote(string $taskId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $linkId = $body['link_id'] ?? null;
        $noteText = trim((string) ($body['note'] ?? ''));

        if (!is_string($linkId) || !$this->taskHasLink($taskId, $linkId) || '' === $noteText || mb_strlen($noteText) > 2000) {
            throw new Problem(422, 'validation_failed', 'A registered task link and a note of 1 to 2000 characters are required.');
        }

        return $this->linkNotes->create($this->store->id(), $task['project_id'], $taskId, $linkId, $noteText, $actor->ref(), $this->store->now());
    }

    private function updateLinkNote(string $taskId, string $noteId, array $body, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $note = $this->linkNotes->find($noteId);
        if (null === $note || ($note['task_id'] ?? null) !== $taskId || ($note['project_id'] ?? null) !== $task['project_id'] || ($note['deleted_at'] ?? null) !== null) {
            throw new Problem(404, 'resource_not_found', 'The requested link note does not exist.');
        }

        $text = trim((string) ($body['note'] ?? ''));
        if ('' === $text || mb_strlen($text) > 2000) {
            throw new Problem(422, 'validation_failed', 'A note of 1 to 2000 characters is required.');
        }

        return $this->linkNotes->update($noteId, $text, $actor->ref(), $this->store->now());
    }

    private function removeLinkNote(string $taskId, string $noteId, Actor $actor): array
    {
        $task = $this->task($taskId, $actor);
        $this->requireLinkNotesEnabled($task);
        $note = $this->linkNotes->find($noteId);
        if (null === $note || ($note['task_id'] ?? null) !== $taskId || ($note['project_id'] ?? null) !== $task['project_id'] || ($note['deleted_at'] ?? null) !== null) {
            throw new Problem(404, 'resource_not_found', 'The requested link note does not exist.');
        }

        return $this->linkNotes->remove($noteId, $actor->ref(), $this->store->now());
    }

    private function task(string $taskId, Actor $actor): array
    {
        $task = $this->store->find('tasks', $taskId);
        if (null === $task) {
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
        if (!$this->registry->enabled(self::LINK_NOTES_ID) || !$this->registry->supports(self::LINK_NOTES_ID, 'links.notes')) {
            throw new Problem(409, 'capability_unavailable', 'Linknotizen sind derzeit nicht aktiviert.');
        }

        $configuration = $this->storedConfiguration(self::LINK_NOTES_ID);
        $enabledLabels = $configuration['values']['enabled_labels'] ?? [];
        if ([] === $enabledLabels) {
            return;
        }

        $taskLabels = $task['label_ids'] ?? [];
        if ([] === array_intersect($enabledLabels, $taskLabels)) {
            throw new Problem(409, 'capability_unavailable', 'Linknotizen sind für die Labels dieses Tickets nicht freigegeben.');
        }
    }

    private function installPlan(string $planId): array
    {
        $plan = $this->store->find('plugin_install_plans', $planId);
        if (null === $plan) {
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
        $view = array_intersect_key($plan, array_flip([
            'id', 'operation', 'plugin_id', 'target_version', 'source', 'manifest_sha256', 'status',
            'requires_build', 'requires_restart', 'requires_migration', 'steps', 'warnings', 'created_at',
        ]));
        $view['operation'] ??= 'install';
        if ('remove' === $view['operation'] && 'prepared' === ($view['status'] ?? null)) {
            $pluginId = (string) ($view['plugin_id'] ?? '');
            $stored = '' !== $pluginId ? $this->store->find('plugins', $pluginId) : null;
            if (!$this->registry->has($pluginId) && null !== $stored && $this->hasPreparedRemoval($pluginId, $stored)) {
                $view['status'] = 'completed';
            }
        }

        return $view;
    }

    private function requireInstalledPlugin(string $pluginId): array
    {
        if (!$this->knownPlugin($pluginId)) {
            throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
        }

        $view = $this->plugin($pluginId);
        $stored = $this->store->find('plugins', $pluginId);

        // The installed manifest already exposes revision 1 before the first mutation.
        return null === $stored
            ? $this->store->save('plugins', $view, 'PluginDiscovered')
            : $view + $stored;
    }

    private function plugin(string $pluginId): array
    {
        $manifest = $this->registry->manifest($pluginId);
        $stored = $this->store->find('plugins', $pluginId) ?? [];
        $state = $this->registry->state($pluginId);
        $counts = $this->activeWorkCounts($pluginId);
        $configuration = $this->storedConfiguration($pluginId);

        return [
            'id' => $pluginId,
            'version' => (int) ($stored['version'] ?? 1),
            'name' => $manifest['name'],
            'installed_version' => $manifest['version'],
            'contract_version' => $manifest['contract_version'],
            'state' => $state,
            'last_safe_state' => $stored['last_safe_state'] ?? null,
            'description' => $manifest['description'],
            'dependencies' => $this->registry->dependencies($pluginId),
            'capabilities' => array_values(array_map(static fn (array $capability): string => $capability['name'], $manifest['capabilities'])),
            'ui_contributions' => array_values(array_filter(
                $manifest['ui'],
                fn (array $contribution): bool => $this->registry->supports($pluginId, (string) $contribution['required_capability']),
            )),
            'active_run_count' => $counts['runs'],
            'pending_job_count' => $counts['jobs'],
            'unresolved_external_activity_count' => $counts['external'],
            'retained_data_bytes' => self::LINK_NOTES_ID === $pluginId ? $this->linkNotes->retainedBytes() : (int) ($stored['retained_data_bytes'] ?? 0),
            'configuration_schema_id' => $this->settingsSchemaId($pluginId),
            'configuration_retained' => [] !== $configuration,
            'removal_plan_id' => is_string($stored['removal_plan_id'] ?? null) ? $stored['removal_plan_id'] : null,
            'restart_required' => (bool) ($stored['restart_required'] ?? false),
            'last_error' => $stored['last_error'] ?? null,
            'allowed_actions' => $this->allowedActions($state),
        ];
    }

    /** @param array<string, mixed> $stored */
    private function removedPlugin(string $pluginId, array $stored): array
    {
        $counts = $this->activeWorkCounts($pluginId);
        $configuration = $this->storedConfiguration($pluginId);

        return [
            'id' => $pluginId,
            'version' => (int) ($stored['version'] ?? 1),
            'name' => (string) ($stored['name'] ?? $pluginId),
            'installed_version' => (string) ($stored['installed_version'] ?? 'unknown'),
            'contract_version' => (string) ($stored['contract_version'] ?? 'unknown'),
            'state' => 'removed',
            'last_safe_state' => $stored['last_safe_state'] ?? 'installed_disabled',
            'description' => (string) ($stored['description'] ?? ''),
            'dependencies' => is_array($stored['dependencies'] ?? null) ? $stored['dependencies'] : [],
            'capabilities' => [],
            'ui_contributions' => [],
            'active_run_count' => $counts['runs'],
            'pending_job_count' => $counts['jobs'],
            'unresolved_external_activity_count' => $counts['external'],
            'retained_data_bytes' => (int) ($stored['retained_data_bytes'] ?? 0),
            'configuration_schema_id' => null,
            'configuration_retained' => [] !== $configuration,
            'removal_plan_id' => (string) $stored['removal_plan_id'],
            'restart_required' => false,
            'last_error' => null,
            'allowed_actions' => $this->allowedActions('removed'),
        ];
    }

    /** @param array<string, mixed> $stored */
    private function hasPreparedRemoval(string $pluginId, array $stored): bool
    {
        $planId = $stored['removal_plan_id'] ?? null;
        if ('uninstall_pending' !== ($stored['state'] ?? null) || !is_string($planId)) {
            return false;
        }

        $plan = $this->store->find('plugin_install_plans', $planId);

        return null !== $plan
            && 'remove' === ($plan['operation'] ?? null)
            && 'prepared' === ($plan['status'] ?? null)
            && $pluginId === ($plan['plugin_id'] ?? null);
    }

    private function allowedActions(string $state): array
    {
        $actions = [];
        foreach ([
            'activate' => ['installed_disabled', 'disabled'],
            'drain' => ['enabled', 'draining'],
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

    private function settingsSchemaId(string $pluginId): string
    {
        $manifest = $this->registry->manifest($pluginId);
        if (is_string($manifest['settings_schema_id'] ?? null)) {
            return $manifest['settings_schema_id'];
        }

        $version = max(1, (int) ($manifest['migrations']['data_version'] ?? 1));

        return 'https://falkenwarte.local/schemas/'.str_replace('.', '-', $pluginId).'-settings-v'.$version;
    }

    /** @param array<string, mixed> $schema @param array<string, mixed> $values */
    private function validateConfigurationValues(array $schema, array $values): void
    {
        if (($schema['type'] ?? null) !== 'object') {
            throw new Problem(422, 'validation_failed', 'The plugin settings schema must describe an object.');
        }
        foreach ($schema['required'] ?? [] as $required) {
            if (!array_key_exists($required, $values)) {
                throw new Problem(422, 'validation_failed', 'A required plugin setting is missing: '.$required.'.');
            }
        }
        foreach ($values as $name => $value) {
            $property = $schema['properties'][$name] ?? null;
            if (!is_array($property) || !$this->matchesSettingSchema($value, $property)) {
                throw new Problem(422, 'validation_failed', 'A plugin setting does not match its registered schema: '.$name.'.');
            }
        }
    }

    /** @param array<string, mixed> $schema */
    private function matchesSettingSchema(mixed $value, array $schema): bool
    {
        $type = $schema['type'] ?? null;
        $matches = match ($type) {
            'array' => is_array($value) && array_is_list($value) && count($value) <= (int) ($schema['maxItems'] ?? 200),
            'object' => is_array($value),
            'string' => is_string($value),
            'integer' => is_int($value),
            'number' => is_int($value) || is_float($value),
            'boolean' => is_bool($value),
            default => false,
        };
        if (!$matches) {
            return false;
        }
        if ('string' === $type && (mb_strlen($value) < (int) ($schema['minLength'] ?? 0) || mb_strlen($value) > (int) ($schema['maxLength'] ?? 4000))) {
            return false;
        }
        if ('array' === $type) {
            foreach ($value as $item) {
                if (isset($schema['items']) && (!$this->matchesSettingSchema($item, $schema['items']))) {
                    return false;
                }
            }
        }
        if ('object' === $type) {
            $properties = $schema['properties'] ?? [];
            foreach ($value as $name => $item) {
                if (!isset($properties[$name]) || !$this->matchesSettingSchema($item, $properties[$name])) {
                    return false;
                }
            }
        }

        return true;
    }

    private function activeWorkCounts(string $pluginId): array
    {
        $runs = array_filter($this->store->all('runs'), static fn (array $run): bool => (($run['plugin_id'] ?? null) === $pluginId || ($run['snapshot']['bridge_plugin_id'] ?? null) === $pluginId) && !in_array($run['state'] ?? null, ['succeeded', 'failed', 'cancelled'], true));
        $external = array_filter($this->store->all('recovery_entries'), static fn (array $entry): bool => ($entry['bridge_plugin_id'] ?? null) === $pluginId && !in_array($entry['status'] ?? null, ['stopped', 'resolved'], true) && in_array($entry['entry_kind'] ?? null, ['unlisted_external_activity', 'registered_external_start'], true));

        return ['runs' => count($runs), 'jobs' => $this->extensions->pendingWorkCount($pluginId), 'external' => count($external)];
    }

    private function knownPlugin(string $pluginId): bool
    {
        return $this->registry->has($pluginId);
    }

    /** @param array<string, mixed> $schema @return array<string, mixed> */
    private function defaultSettings(array $schema): array
    {
        $values = [];
        foreach ($schema['properties'] ?? [] as $name => $property) {
            if (is_array($property) && array_key_exists('default', $property)) {
                $values[$name] = $property['default'];
            }
        }

        return $values;
    }

    private function requiredId(array $params, string $key): string
    {
        $value = $params[$key] ?? null;
        if (!is_string($value) || '' === trim($value)) {
            throw new Problem(422, 'validation_failed', 'A valid '.$key.' is required.');
        }

        return $value;
    }
}
