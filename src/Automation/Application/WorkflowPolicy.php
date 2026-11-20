<?php

declare(strict_types=1);

namespace App\Automation\Application;

/** Published policy port used by orchestration without importing Automation internals. */
interface WorkflowPolicy
{
    /** @param array<string, mixed> $definition */
    public function validateDefinition(array $definition): void;

    /**
     * @param list<array<string, mixed>> $transitions
     *
     * @return array<string, mixed>|null
     */
    public function selectTransition(array $transitions, string $fromStageId, string $outcome): ?array;
}
