<?php

declare(strict_types=1);

namespace App\Automation\Domain;

/** Finds the unique configured transition for a stage and its outcome. */
final class WorkflowTransitionPolicy
{
    /** @param list<array<string, mixed>> $transitions @return array<string, mixed>|null */
    public function select(array $transitions, string $fromStageId, string $outcome): ?array
    {
        foreach ($transitions as $transition) {
            if (($transition['from_stage_id'] ?? null) !== $fromStageId || ($transition['on'] ?? null) !== $outcome) {
                continue;
            }

            return $transition;
        }

        return null;
    }
}
