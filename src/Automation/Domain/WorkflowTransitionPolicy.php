<?php

declare(strict_types=1);

namespace App\Automation\Domain;

/** Selects the first valid configured transition for a completed phase. */
final class WorkflowTransitionPolicy
{
    /** @param list<array<string, mixed>> $transitions @param callable(array<string, mixed>): bool $conditionsSatisfied @return array<string, mixed>|null */
    public function select(array $transitions, string $fromStageId, string $outcome, callable $conditionsSatisfied): ?array
    {
        foreach ($transitions as $transition) {
            if (($transition['from_stage_id'] ?? null) !== $fromStageId || ($transition['on'] ?? null) !== $outcome) {
                continue;
            }
            if ($conditionsSatisfied($transition['conditions'] ?? [])) {
                return $transition;
            }
        }

        return null;
    }
}
