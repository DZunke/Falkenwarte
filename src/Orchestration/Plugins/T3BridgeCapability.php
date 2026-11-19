<?php

declare(strict_types=1);

namespace App\Orchestration\Plugins;

use App\Extensions\Application\PluginCapability;

final readonly class T3BridgeCapability implements PluginCapability
{
    public function name(): string
    {
        return 'execution.bridge';
    }

    public function implementationId(): string
    {
        return 't3.mcp.v0_1_10';
    }
}
