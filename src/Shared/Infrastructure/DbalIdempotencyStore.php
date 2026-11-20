<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Shared\Application\IdempotencyStore;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(IdempotencyStore::class)]
final readonly class DbalIdempotencyStore implements IdempotencyStore
{
    public function __construct(private Connection $connection)
    {
    }

    public function findReplay(string $principalId, string $key): ?array
    {
        $row = $this->connection->fetchAssociative('SELECT fingerprint,data FROM dedup WHERE principal=? AND key=?', [$principalId, $key]);

        return false === $row ? null : [
            'fingerprint' => $row['fingerprint'],
            'response' => json_decode($row['data'], true, flags: JSON_THROW_ON_ERROR),
        ];
    }

    public function hasPendingCommands(string $actionId): bool
    {
        return (int) $this->connection->fetchOne('SELECT COUNT(*) FROM commands WHERE action_id=?', [$actionId]) > 0;
    }

    public function saveReplay(string $principalId, string $key, string $fingerprint, string $response, int $createdAt): void
    {
        $this->connection->insert('dedup', [
            'principal' => $principalId,
            'key' => $key,
            'fingerprint' => $fingerprint,
            'data' => $response,
            'created_at' => $createdAt,
        ]);
    }
}
