<?php

declare(strict_types=1);

namespace App\AgentCatalog\Infrastructure;

use App\AgentCatalog\Application\AgentCatalogReader;
use App\Extensions\Application\PluginRegistry;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

final class StoreAgentCatalogReader implements AgentCatalogReader
{
    public function __construct(private readonly Store $store, private readonly PluginRegistry $plugins)
    {
    }

    public function connection(string $id): array
    {
        return $this->required('connections', $id);
    }

    public function profile(string $id): array
    {
        $profile = $this->required('agent_profiles', $id);
        $profile['bridge_plugin_id'] ??= $this->providerIdForConnection((string) $profile['connection_id']);

        return $profile;
    }

    public function binding(string $id): array
    {
        return $this->required('project_bindings', $id);
    }

    public function bindingForProject(string $projectId): ?array
    {
        $project = $this->store->find('projects', $projectId);
        if (is_string($project['active_binding_id'] ?? null)) {
            $binding = $this->store->find('project_bindings', $project['active_binding_id']);
            if (null !== $binding && !empty($binding['active'])) {
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

    public function activeBindings(): array
    {
        return array_values(array_filter($this->store->all('project_bindings'), static fn (array $binding): bool => !empty($binding['active'])));
    }

    public function profilesForConnection(string $connectionId): array
    {
        return array_values(array_filter($this->store->all('agent_profiles'), static fn (array $profile): bool => ($profile['connection_id'] ?? null) === $connectionId));
    }

    public function capabilitySnapshot(string $id): ?array
    {
        return $this->store->find('capability_snapshots', $id);
    }

    public function accessToken(string $connectionId): ?string
    {
        $reference = $this->connection($connectionId)['credential_secret_ref'] ?? null;
        if (!is_string($reference) || '' === $reference) {
            return null;
        }
        try {
            return $this->store->secret($reference);
        } catch (\Throwable) {
            return null;
        }
    }

    public function providerForBridge(string $bridgeId): ?string
    {
        $pluginId = $this->plugins->bridgeProvider($bridgeId);

        return null !== $pluginId && $this->plugins->has($pluginId) ? $pluginId : null;
    }

    public function providerIdForConnection(string $connectionId): ?string
    {
        $connection = $this->store->find('connections', $connectionId);
        if (null === $connection) {
            return null;
        }
        $pluginId = $connection['bridge_plugin_id'] ?? $this->plugins->bridgeProvider((string) ($connection['bridge_id'] ?? ''));

        return is_string($pluginId) && $this->plugins->has($pluginId) ? $pluginId : null;
    }

    public function providerEnabled(string $bridgePluginId): bool
    {
        return $this->plugins->enabled($bridgePluginId);
    }

    /** @return array<string, mixed> */
    private function required(string $type, string $id): array
    {
        return $this->store->find($type, $id)
            ?? throw new Problem(404, 'resource_not_found', 'Der angeforderte Eintrag wurde nicht gefunden.');
    }
}
