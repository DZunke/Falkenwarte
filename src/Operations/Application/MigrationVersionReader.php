<?php

declare(strict_types=1);

namespace App\Operations\Application;

/** Reads the last applied migration version for backup manifests. */
interface MigrationVersionReader
{
    public function latestVersion(): string;
}
