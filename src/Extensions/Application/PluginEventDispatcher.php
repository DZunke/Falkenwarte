<?php

declare(strict_types=1);

namespace App\Extensions\Application;

interface PluginEventDispatcher
{
    public function dispatch(?string $pluginId = null): void;
}
