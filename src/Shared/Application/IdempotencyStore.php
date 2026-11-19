<?php

declare(strict_types=1);

namespace App\Shared\Application;

/** Durable replay records and pending-command lookups for the presentation gateway. */
interface IdempotencyStore
{
    public function findReplay(string $principalId, string $key): ?array;

    public function hasPendingCommands(string $actionId): bool;

    public function saveReplay(string $principalId, string $key, string $fingerprint, string $response, int $createdAt): void;
}
