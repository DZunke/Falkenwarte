<?php

declare(strict_types=1);

namespace App\Classification\Application;

interface DecisionGateway
{
    /** @param array<string, mixed> $request @return array<string, mixed> */
    public function decide(array $request, string $secretReferenceId, int $timeoutMs): array;
}
