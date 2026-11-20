<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

/** Reads the task-scoped records used to build a paginated TaskFlow projection. */
interface TaskFlowReader
{
    /** @return list<array<string, mixed>> */
    public function instances(string $taskId, string $projectId): array;

    /** @return list<array<string, mixed>> */
    public function runs(string $taskId, string $projectId): array;

    /** @param list<string> $runIds @return list<array<string, mixed>> */
    public function reports(array $runIds, string $projectId): array;

    /** @param list<string> $runIds @return list<array<string, mixed>> */
    public function approvals(array $runIds, string $projectId): array;
}
