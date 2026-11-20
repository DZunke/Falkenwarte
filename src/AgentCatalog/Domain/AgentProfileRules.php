<?php

declare(strict_types=1);

namespace App\AgentCatalog\Domain;

use App\Shared\Domain\Problem;

final class AgentProfileRules
{
    /** @param array<string, mixed> $body @param array<string, mixed>|null $existing */
    public function allProjectsEnabled(array $body, ?array $existing): bool
    {
        if (!array_key_exists('all_projects', $body)) {
            return true === ($existing['all_projects'] ?? false);
        }
        if (!is_bool($body['all_projects'])) {
            throw new Problem(422, 'validation_failed', 'Die Projektfreigabe muss als boolescher Wert angegeben werden.');
        }

        return $body['all_projects'];
    }

    /** @param array<string, mixed> $profile */
    public function allowsProject(array $profile, string $projectId): bool
    {
        if (true === ($profile['all_projects'] ?? false)) {
            return true;
        }
        $allowedProjectIds = $profile['allowed_project_ids'] ?? [];

        return is_array($allowedProjectIds) && in_array($projectId, $allowedProjectIds, true);
    }

    /** @param array<string, mixed> $executionTarget */
    public function assertExecutionTarget(array $executionTarget): void
    {
        $mode = $executionTarget['mode'] ?? null;
        if ('t3_reference_thread' === $mode && (!is_string($executionTarget['reference_thread_id'] ?? null) || '' === trim($executionTarget['reference_thread_id']))) {
            throw new Problem(422, 'validation_failed', 'Ein T3-Referenzthread benötigt eine konkrete Thread-ID.');
        }

        if ('t3_provider_instance' === $mode) {
            $instanceId = $executionTarget['provider_instance_id'] ?? null;
            if (!is_string($instanceId) || 1 !== preg_match('/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/D', $instanceId)) {
                throw new Problem(422, 'validation_failed', 'Die T3-Providerinstanz benötigt eine gültige Instanz-ID.');
            }
            $model = $executionTarget['model'] ?? null;
            if (!is_string($model) || '' === trim($model) || $model !== trim($model) || mb_strlen($model) > 256) {
                throw new Problem(422, 'validation_failed', 'Eine T3-Providerinstanz benötigt eine konkrete Modell-ID.');
            }
        }

        if (array_key_exists('reasoning', $executionTarget)) {
            if ('t3_provider_instance' !== $mode) {
                throw new Problem(422, 'validation_failed', 'Eine Reasoning-Auswahl ist nur bei einer expliziten T3-Providerinstanz möglich.');
            }

            $reasoning = $executionTarget['reasoning'];
            if (!is_array($reasoning)
                || [] !== array_diff(array_keys($reasoning), ['option_id', 'value'])
                || [] !== array_diff(['option_id', 'value'], array_keys($reasoning))) {
                throw new Problem(422, 'validation_failed', 'Die Reasoning-Auswahl benötigt genau eine Options-ID und einen Wert.');
            }

            foreach (['option_id', 'value'] as $field) {
                $value = $reasoning[$field];
                if (!is_string($value) || '' === trim($value) || $value !== trim($value) || mb_strlen($value) > 128) {
                    throw new Problem(422, 'validation_failed', 'Die Reasoning-Options-ID und ihr Wert müssen kurze, getrimmte Strings sein.');
                }
            }
        }

        if (!in_array($mode, ['t3_project_default', 't3_reference_thread', 't3_provider_instance'], true)) {
            throw new Problem(422, 'validation_failed', 'Das Ausführungsziel ist unbekannt.');
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
