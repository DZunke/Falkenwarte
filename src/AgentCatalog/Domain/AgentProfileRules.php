<?php

declare(strict_types=1);

namespace App\AgentCatalog\Domain;

use App\Shared\Domain\Problem;

final class AgentProfileRules
{
    /** @param array<string, mixed> $executionTarget */
    public function assertExecutionTarget(array $executionTarget): void
    {
        if (($executionTarget['mode'] ?? null) === 't3_reference_thread' && empty($executionTarget['reference_thread_id'])) {
            throw new Problem(422, 'validation_failed', 'Ein T3-Referenzthread benötigt eine konkrete Thread-ID.');
        }
    }

    public function assertSingleRun(int $maxParallelRuns): void
    {
        if (1 !== $maxParallelRuns) {
            throw new Problem(422, 'validation_failed', 'Ein Agentprofil darf im aktuellen Umfang höchstens einen Auftrag gleichzeitig starten.');
        }
    }

    public function assertProjectAssignable(bool $archived): void
    {
        if ($archived) {
            throw new Problem(409, 'project_archived', 'Archivierte Projekte können keinem neuen Agentprofil zugeordnet werden.');
        }
    }

    /** @param array<string, mixed> $connection @return array{valid: bool, error: ?string} */
    public function connectionReadiness(array $connection): array
    {
        $valid = ($connection['auth_status'] ?? null) === 'valid' && ($connection['health'] ?? null) !== 'incompatible';

        return [
            'valid' => $valid,
            'error' => ($connection['auth_status'] ?? null) !== 'valid'
                ? 'T3-Verbindung ist noch nicht autorisiert.'
                : (($connection['health'] ?? null) === 'incompatible' ? 'T3 stellt die erforderlichen MCP-Fähigkeiten nicht bereit.' : null),
        ];
    }

    /** @param array<string, mixed>|null $existing */
    public function promptTemplateVersion(?array $existing, string $promptTemplate): int
    {
        if (null === $existing) {
            return 1;
        }

        $version = (int) ($existing['prompt_template_version'] ?? 0);

        return $promptTemplate === (string) ($existing['prompt_template'] ?? '') ? $version : $version + 1;
    }
}
