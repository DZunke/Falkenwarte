<?php

declare(strict_types=1);

namespace App\AgentCatalog\Domain;

use App\Shared\Domain\Problem;

final class ProjectBindingRules
{
    public function assertProjectCanBeBound(bool $archived): void
    {
        if ($archived) {
            throw new Problem(409, 'project_archived', 'Ein archiviertes Projekt kann kein neues T3-Binding erhalten.');
        }
    }

    /** @param array<string, mixed> $connection */
    public function assertConnectionReady(array $connection): void
    {
        if (($connection['auth_status'] ?? null) !== 'valid' || ($connection['health'] ?? null) === 'incompatible') {
            throw new Problem(409, 't3_connection_unavailable', 'Die T3-Verbindung muss zuerst erfolgreich geprüft und autorisiert werden.');
        }
    }

    /** @param array<string, mixed>|null $existing @return array<string, mixed> */
    public function bindingRecord(string $projectId, string $connectionId, string $externalProjectId, ?array $existing): array
    {
        $externalProjectId = trim($externalProjectId);
        if ('' === $externalProjectId) {
            throw new Problem(422, 'validation_failed', 'Die T3-Projektkennung darf nicht leer sein.');
        }
        $binding = [
            'project_id' => $projectId,
            'connection_id' => $connectionId,
            'external_project_id' => $externalProjectId,
            'active' => true,
            'max_active_runs' => 1,
        ];
        if (null !== $existing) {
            $binding['id'] = $existing['id'];
        }

        return $binding;
    }
}
