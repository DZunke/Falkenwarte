<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

/** Resolves board workflow defaults and guards explicit starts against board opt-outs. */
interface BoardWorkflowPolicyReader
{
    /** @param array<string, mixed> $task @return array{state: string, board_id: ?string, workflow_id: ?string, definition_version: ?int, reason: ?string} */
    public function resolve(array $task, ?string $boardId = null): array;

    /** @param array<string, mixed> $workflow */
    public function isReadyForBoard(array $workflow, string $projectId): bool;

    public function assertStartAllowed(array $task, ?string $boardId, string $workflowId, int $definitionVersion, bool $allowOwnerOverride = false): void;
}
