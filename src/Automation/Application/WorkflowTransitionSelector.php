<?php

declare(strict_types=1);

namespace App\Automation\Application;

/** Selects a transition from an immutable workflow definition. */
interface WorkflowTransitionSelector
{
    /**
     * @param list<array<string, mixed>> $transitions
     *
     * @return array<string, mixed>|null
     */
    public function select(array $transitions, string $fromStageId, string $outcome): ?array;
}
