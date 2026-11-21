<?php

declare(strict_types=1);

namespace App\WorkManagement\Infrastructure;

use App\Orchestration\Application\WorkflowStageBoardMover;
use App\WorkManagement\Application\WorkHandler;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(WorkflowStageBoardMover::class)]
final readonly class OrchestrationWorkflowStageBoardMover implements WorkflowStageBoardMover
{
    public function __construct(private WorkHandler $workHandler)
    {
    }

    public function move(string $taskId, string $projectId, string $boardId, string $columnId): array
    {
        return $this->workHandler->moveTaskForWorkflowStage($taskId, $projectId, $boardId, $columnId);
    }
}
