<?php

declare(strict_types=1);

namespace App\Extensions\Application;

/** Persistence query for outstanding plugin work during drain and deactivation. */
interface ExtensionPersistence
{
    public function pendingWorkCount(string $pluginId): int;
}
