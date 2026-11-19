<?php

declare(strict_types=1);

namespace App\Operations\Application;

/** Read-only runtime state needed to report schema and process readiness. */
interface OperationsPersistence
{
    /** @return array{schema: string, worker: string, maintenance: string} */
    public function healthSnapshot(int $now): array;
}
