<?php

declare(strict_types=1);

namespace App\Extensions\Application;

interface PluginAvailability
{
    public function enabled(string $pluginId): bool;
}
