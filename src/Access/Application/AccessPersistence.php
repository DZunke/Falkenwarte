<?php

declare(strict_types=1);

namespace App\Access\Application;

/** Persistence operations required by the owner and technical-principal boundary. */
interface AccessPersistence
{
    public function findTechnicalTokenByHash(string $hash): ?array;

    public function findSession(string $hash, int $now): ?array;

    public function saveSession(array $session): void;

    public function removeSession(string $hash): void;

    public function removeOtherSessions(string $exceptHash): void;

    public function loginAttempts(string $address): ?array;

    public function recordLoginFailure(string $address, int $now): void;

    public function clearLoginFailures(string $address): void;
}
