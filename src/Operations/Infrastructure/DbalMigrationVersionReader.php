<?php

declare(strict_types=1);

namespace App\Operations\Infrastructure;

use App\Operations\Application\MigrationVersionReader;
use Doctrine\DBAL\Connection;

final readonly class DbalMigrationVersionReader implements MigrationVersionReader
{
    public function __construct(private Connection $connection)
    {
    }

    public function latestVersion(): string
    {
        $versions = $this->connection->fetchFirstColumn('SELECT version FROM doctrine_migration_versions ORDER BY version');

        return $versions === [] ? '' : (string) end($versions);
    }
}
