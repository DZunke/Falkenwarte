<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

/** Applies a WorkflowStage board target through WorkManagement's move rules. */
interface WorkflowStageBoardMover
{
    /**
     * Move the task to the current default drop status of a project board column.
     *
     * @return array<string, mixed> the fresh task record after the move
     */
    public function move(string $taskId, string $projectId, string $boardId, string $columnId): array;
}
