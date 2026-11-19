<?php

declare(strict_types=1);

namespace App\Extensions\Application;

/** A typed implementation registered by an installed plugin definition. */
interface PluginCapability
{
    public function name(): string;

    public function implementationId(): string;
}
