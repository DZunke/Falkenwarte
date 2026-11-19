<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

/** Internal cross-context read port for immutable run context and T3 references. */
interface AgentCatalogReader
{
    /** @return array<string, mixed> */
    public function connection(string $id): array;

    /** @return array<string, mixed> */
    public function profile(string $id): array;

    /** @return array<string, mixed> */
    public function binding(string $id): array;

    /** @return array<string, mixed>|null */
    public function bindingForProject(string $projectId): ?array;

    /** @return list<array<string, mixed>> */
    public function activeBindings(): array;

    /** @return list<array<string, mixed>> */
    public function profilesForConnection(string $connectionId): array;

    /** @return array<string, mixed>|null */
    public function capabilitySnapshot(string $id): ?array;

    public function accessToken(string $connectionId): ?string;

    public function providerForBridge(string $bridgeId): ?string;

    public function providerIdForConnection(string $connectionId): ?string;

    public function providerEnabled(string $bridgePluginId): bool;

    public function providerAllowsDrainCancellation(string $bridgePluginId): bool;
}
