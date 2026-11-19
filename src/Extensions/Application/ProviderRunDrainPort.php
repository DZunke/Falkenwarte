<?php

declare(strict_types=1);

namespace App\Extensions\Application;

/** Requests normal orchestration cancellation for runs owned by a draining provider. */
interface ProviderRunDrainPort
{
    public function requestCancelForProvider(string $providerId, string $reason): int;
}
