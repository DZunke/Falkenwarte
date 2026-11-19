<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

interface AttentionLabelReader
{
    /** @return array{name:string,description:string}|null */
    public function labelForReason(string $projectId, string $code): ?array;
}
