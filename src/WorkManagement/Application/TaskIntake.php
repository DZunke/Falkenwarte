<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

use App\Shared\Application\Actor;

interface TaskIntake
{
    /** @param array<string, mixed> $task @return array<string, mixed> */
    public function acceptTechnicalTask(array $task, Actor $actor, ?string $actionId = null, array $suggestedLabelIds = []): array;

    /** @param array<string, mixed> $task @return array<string, mixed>|null */
    public function acceptManualTask(array $task, Actor $actor): ?array;

    /** @param array<string, mixed> $task @return array<string, mixed>|null */
    public function invalidateForTaskRevision(array $task, Actor $actor, string $reason, array $suggestedLabelIds = []): ?array;
}
