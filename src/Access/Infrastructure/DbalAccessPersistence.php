<?php

declare(strict_types=1);

namespace App\Access\Infrastructure;

use App\Access\Application\AccessPersistence;
use Doctrine\DBAL\Connection;

final readonly class DbalAccessPersistence implements AccessPersistence
{
    public function __construct(private Connection $connection)
    {
    }

    public function findTechnicalTokenByHash(string $hash): ?array
    {
        $data = $this->connection->fetchOne(
            "SELECT data FROM records WHERE type='tokens' AND json_extract(data,'$._hash')=?",
            [$hash],
        );

        return $data === false ? null : json_decode($data, true, flags: JSON_THROW_ON_ERROR);
    }

    public function findSession(string $hash, int $now): ?array
    {
        $session = $this->connection->fetchAssociative('SELECT * FROM sessions WHERE hash=? AND expires>?', [$hash, $now]);

        return $session === false ? null : $session;
    }

    public function saveSession(array $session): void
    {
        $this->connection->insert('sessions', $session);
    }

    public function removeSession(string $hash): void
    {
        $this->connection->delete('sessions', ['hash' => $hash]);
    }

    public function removeOtherSessions(string $exceptHash): void
    {
        $this->connection->executeStatement('DELETE FROM sessions WHERE hash<>?', [$exceptHash]);
    }

    public function loginAttempts(string $address): ?array
    {
        $attempts = $this->connection->fetchAssociative('SELECT * FROM login_attempts WHERE address=?', [$address]);

        return $attempts === false ? null : $attempts;
    }

    public function recordLoginFailure(string $address, int $now): void
    {
        $this->connection->executeStatement(
            'INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(address) DO UPDATE SET attempts=CASE WHEN until_ts<? THEN 1 ELSE attempts+1 END, until_ts=excluded.until_ts',
            [$address, $now + 300, $now],
        );
    }

    public function clearLoginFailures(string $address): void
    {
        $this->connection->delete('login_attempts', ['address' => $address]);
    }
}
