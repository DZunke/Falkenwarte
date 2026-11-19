<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Shared\Application\Store;
use Doctrine\DBAL\Connection;

/** Infrastructure-only access to the DBAL connection backing the Store port. */
interface DbalStoreAccess extends Store
{
    public function db(): Connection;
}
