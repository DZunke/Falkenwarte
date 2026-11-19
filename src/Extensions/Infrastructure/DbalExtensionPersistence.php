<?php

declare(strict_types=1);

namespace App\Extensions\Infrastructure;

use App\Extensions\Application\ExtensionPersistence;
use Doctrine\DBAL\Connection;

final readonly class DbalExtensionPersistence implements ExtensionPersistence
{
    public function __construct(private Connection $connection)
    {
    }

    public function pendingWorkCount(string $pluginId): int
    {
        $count = 0;
        foreach ($this->connection->fetchAllAssociative("SELECT kind,payload FROM commands WHERE complete=0 AND kind LIKE 'plugin.%' AND kind<>'plugin.drain'") as $command) {
            $payload = json_decode((string) $command['payload'], true);
            if (is_array($payload) && ($payload['plugin_id'] ?? null) === $pluginId) {
                ++$count;
            }
        }

        return $count;
    }
}
