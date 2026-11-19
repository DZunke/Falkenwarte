<?php

declare(strict_types=1);

namespace App\Operations\Infrastructure;

use App\Operations\Application\OperationsPersistence;
use Doctrine\DBAL\Connection;

final readonly class DbalOperationsPersistence implements OperationsPersistence
{
    public function __construct(private Connection $connection)
    {
    }

    public function healthSnapshot(int $now): array
    {
        $schema = (int) $this->connection->fetchOne('SELECT count(*) FROM doctrine_migration_versions') > 0 ? 'ok' : 'outdated';
        $pulse = fn (string $name): string => (int) $this->connection->fetchOne('SELECT value FROM runtime_state WHERE key=?', [$name]) >= $now - 45 ? 'ok' : 'stale';

        return [
            'schema' => $schema,
            'worker' => $pulse('worker'),
            'maintenance' => $pulse('maintenance'),
        ];
    }
}
