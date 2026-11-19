<?php

declare(strict_types=1);

namespace App\Extensions\Application;

use App\Shared\Application\Store;
use App\Shared\Domain\Problem;

/** Discovers trusted package manifests and checks their runtime contribution gates. */
final class PluginRegistry implements PluginManifestReader
{
    /** @var array<string, PluginDefinition> */
    private array $definitions = [];

    /** @var array<string, array<string, mixed>> */
    private array $manifests = [];

    /** @var array<string, array<string, PluginCapability>> */
    private array $capabilities = [];

    /** @param iterable<PluginDefinition> $definitions */
    public function __construct(iterable $definitions, private readonly Store $store)
    {
        foreach ($definitions as $definition) {
            $manifest = $definition->manifest();
            $id = $manifest['id'] ?? null;
            if (!is_string($id) || 1 !== preg_match('/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/D', $id)) {
                throw new \LogicException('A plugin manifest has an invalid identifier.');
            }
            if (isset($this->definitions[$id])) {
                throw new \LogicException(sprintf('More than one plugin definition declares "%s".', $id));
            }
            $this->validateManifest($manifest);
            $this->definitions[$id] = $definition;
            $this->manifests[$id] = $manifest;
            $this->capabilities[$id] = $this->validateCapabilities($definition, $manifest);
        }
        $this->validateDependencyGraph();
        $this->validateBridgeProviders();
    }

    /** @return list<array<string, mixed>> */
    public function manifests(): array
    {
        return array_values($this->manifests);
    }

    public function has(string $pluginId): bool
    {
        return isset($this->manifests[$pluginId]);
    }

    /** @return array<string, mixed> */
    public function manifest(string $pluginId): array
    {
        return $this->manifests[$pluginId] ?? throw new Problem(404, 'resource_not_found', 'The requested plugin is not installed.');
    }

    public function state(string $pluginId): string
    {
        if (!$this->has($pluginId)) {
            return 'removed';
        }

        $default = (string) ($this->manifest($pluginId)['default_state'] ?? 'installed_disabled');

        return (string) ($this->store->find('plugins', $pluginId)['state'] ?? $default);
    }

    public function enabled(string $pluginId): bool
    {
        return 'enabled' === $this->state($pluginId) && $this->dependenciesSatisfied($pluginId);
    }

    public function supports(string $pluginId, string $capabilityName): bool
    {
        return isset($this->capabilities[$pluginId][$capabilityName]);
    }

    public function capabilityEnabled(string $capabilityName): bool
    {
        foreach ($this->capabilities as $pluginId => $capabilities) {
            if (isset($capabilities[$capabilityName])) {
                return $this->enabled($pluginId);
            }
        }

        return false;
    }

    public function bridgeProvider(string $bridgeId): ?string
    {
        foreach ($this->manifests as $pluginId => $manifest) {
            foreach ($manifest['bridge_providers'] ?? [] as $provider) {
                if (($provider['bridge_id'] ?? null) === $bridgeId
                    && $this->supports($pluginId, (string) ($provider['required_capability'] ?? ''))) {
                    return $pluginId;
                }
            }
        }

        return null;
    }

    public function bridgeEnabled(string $bridgeId): bool
    {
        $provider = $this->bridgeProvider($bridgeId);

        return null !== $provider && $this->enabled($provider);
    }

    /** @return list<array{plugin_id: string, version_constraint: string, satisfied: bool}> */
    public function dependencies(string $pluginId): array
    {
        $manifest = $this->manifest($pluginId);
        $result = [];
        foreach ($manifest['dependencies'] as $dependency) {
            $dependencyId = $dependency['plugin_id'];
            $candidate = $this->manifests[$dependencyId] ?? null;
            $result[] = [
                'plugin_id' => $dependencyId,
                'version_constraint' => $dependency['version_constraint'],
                'satisfied' => null !== $candidate
                    && $this->enabled($dependencyId)
                    && $this->versionSatisfies((string) $candidate['version'], (string) $dependency['version_constraint']),
            ];
        }

        return $result;
    }

    public function dependenciesSatisfied(string $pluginId): bool
    {
        foreach ($this->dependencies($pluginId) as $dependency) {
            if (!$dependency['satisfied']) {
                return false;
            }
        }

        return true;
    }

    /** @return list<array<string, mixed>> */
    public function uiContributions(?string $slot = null): array
    {
        $contributions = [];
        foreach ($this->manifests as $pluginId => $manifest) {
            if (!$this->enabled($pluginId)) {
                continue;
            }
            foreach ($manifest['ui'] as $contribution) {
                if (null !== $slot && $contribution['slot'] !== $slot) {
                    continue;
                }
                if (!$this->supports($pluginId, $contribution['required_capability'])) {
                    continue;
                }
                $contributions[] = ['plugin_id' => $pluginId, ...$contribution];
            }
        }

        return $contributions;
    }

    /** @return list<array<string, mixed>> */
    public function mcpTools(): array
    {
        $tools = [];
        foreach ($this->manifests as $pluginId => $manifest) {
            if (!$this->enabled($pluginId)) {
                continue;
            }
            foreach ($manifest['mcp_tools'] ?? [] as $tool) {
                $requiredCapability = $tool['required_plugin_capability'] ?? null;
                if (is_string($requiredCapability) && !$this->supports($pluginId, $requiredCapability)) {
                    continue;
                }
                $tools[] = ['required_plugin' => $pluginId, ...$tool];
            }
        }

        return $tools;
    }

    private function validateManifest(array $manifest): void
    {
        foreach (['name', 'description', 'version', 'contract_version', 'backend', 'dependencies', 'capabilities', 'settings_schema', 'migrations', 'ui', 'subscriptions', 'data_retention'] as $required) {
            if (!array_key_exists($required, $manifest)) {
                throw new \LogicException(sprintf('Plugin manifest is missing "%s".', $required));
            }
        }
        if (($manifest['contract_version'] ?? null) !== '1.0'
            || !is_string($manifest['version'] ?? null)
            || 1 !== preg_match('/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/D', $manifest['version'])
            || !is_array($manifest['dependencies'] ?? null)
            || !is_array($manifest['capabilities'] ?? null)
            || !is_array($manifest['ui'] ?? null)
            || !is_array($manifest['mcp_tools'] ?? [])
            || !is_array($manifest['bridge_providers'] ?? [])
            || !is_array($manifest['migrations'] ?? null)
            || !str_starts_with((string) ($manifest['migrations']['table_prefix'] ?? ''), 'plg_')) {
            throw new \LogicException(sprintf('Plugin manifest "%s" is not compatible with contract 1.0.', $manifest['id']));
        }
        foreach ($manifest['mcp_tools'] ?? [] as $tool) {
            if (!is_array($tool)
                || !is_string($tool['name'] ?? null)
                || 1 !== preg_match('/^[a-z][a-z0-9_]*$/D', $tool['name'])
                || !is_string($tool['operation_id'] ?? null)
                || !is_string($tool['description'] ?? null)
                || !is_array($tool['required_capabilities'] ?? null)
                || !is_array($tool['inputSchema'] ?? null)
                || !is_array($tool['annotations'] ?? null)) {
                throw new \LogicException(sprintf('Plugin manifest "%s" has an invalid MCP tool contribution.', $manifest['id']));
            }
            foreach ($tool['required_capabilities'] as $capability) {
                if (!is_string($capability) || '' === $capability) {
                    throw new \LogicException(sprintf('Plugin manifest "%s" has an invalid MCP capability gate.', $manifest['id']));
                }
            }
            if (isset($tool['required_plugin_capability'])
                && (!is_string($tool['required_plugin_capability'])
                    || !in_array($tool['required_plugin_capability'], array_column($manifest['capabilities'], 'name'), true))) {
                throw new \LogicException(sprintf('Plugin manifest "%s" declares an MCP tool with an unknown plugin capability.', $manifest['id']));
            }
        }
        foreach ($manifest['bridge_providers'] ?? [] as $provider) {
            if (!is_array($provider)
                || !is_string($provider['bridge_id'] ?? null)
                || !is_string($provider['required_capability'] ?? null)
                || !in_array($provider['required_capability'], array_column($manifest['capabilities'], 'name'), true)) {
                throw new \LogicException(sprintf('Plugin manifest "%s" has an invalid bridge provider contribution.', $manifest['id']));
            }
        }
        if (isset($manifest['default_state']) && !in_array($manifest['default_state'], ['enabled', 'installed_disabled'], true)) {
            throw new \LogicException(sprintf('Plugin manifest "%s" has an invalid default state.', $manifest['id']));
        }
    }

    private function validateDependencyGraph(): void
    {
        $visited = [];
        $visiting = [];
        $visit = function (string $pluginId) use (&$visit, &$visited, &$visiting): void {
            if (isset($visiting[$pluginId])) {
                throw new \LogicException(sprintf('Plugin dependency cycle includes "%s".', $pluginId));
            }
            if (isset($visited[$pluginId])) {
                return;
            }
            $visiting[$pluginId] = true;
            foreach ($this->manifests[$pluginId]['dependencies'] ?? [] as $dependency) {
                $dependencyId = $dependency['plugin_id'] ?? null;
                if (is_string($dependencyId) && isset($this->manifests[$dependencyId])) {
                    $visit($dependencyId);
                }
            }
            unset($visiting[$pluginId]);
            $visited[$pluginId] = true;
        };
        foreach (array_keys($this->manifests) as $pluginId) {
            $visit($pluginId);
        }
    }

    private function validateBridgeProviders(): void
    {
        $providers = [];
        foreach ($this->manifests as $pluginId => $manifest) {
            foreach ($manifest['bridge_providers'] ?? [] as $provider) {
                $bridgeId = (string) $provider['bridge_id'];
                if (isset($providers[$bridgeId])) {
                    throw new \LogicException(sprintf('Bridge "%s" has more than one plugin provider.', $bridgeId));
                }
                $providers[$bridgeId] = $pluginId;
            }
        }
    }

    /** @return array<string, PluginCapability> */
    private function validateCapabilities(PluginDefinition $definition, array $manifest): array
    {
        $implementations = [];
        foreach ($definition->capabilities() as $capability) {
            if (isset($implementations[$capability->name()])) {
                throw new \LogicException(sprintf('Plugin "%s" has a duplicate capability "%s".', $manifest['id'], $capability->name()));
            }
            $implementations[$capability->name()] = $capability;
        }

        $declared = [];
        foreach ($manifest['capabilities'] as $contribution) {
            $name = $contribution['name'] ?? null;
            $implementationId = $contribution['implementation_id'] ?? null;
            $capability = is_string($name) ? ($implementations[$name] ?? null) : null;
            if (!$capability instanceof PluginCapability || $capability->implementationId() !== $implementationId) {
                throw new \LogicException(sprintf('Plugin "%s" has an unregistered capability implementation.', $manifest['id']));
            }
            $declared[$name] = $capability;
        }
        if (count($declared) !== count($implementations)) {
            throw new \LogicException(sprintf('Plugin "%s" has an undeclared capability implementation.', $manifest['id']));
        }

        return $declared;
    }

    private function versionSatisfies(string $version, string $constraint): bool
    {
        if (1 !== preg_match('/^\^(\d+)\.(\d+)(?:\.(\d+))?$/D', $constraint, $match)) {
            return $version === $constraint;
        }
        $base = sprintf('%d.%d.%d', (int) $match[1], (int) $match[2], (int) ($match[3] ?? 0));
        $major = (int) $match[1];
        $minor = (int) $match[2];
        $upper = 0 === $major ? sprintf('0.%d.0', $minor + 1) : sprintf('%d.0.0', $major + 1);

        return version_compare($version, $base, '>=') && version_compare($version, $upper, '<');
    }
}
