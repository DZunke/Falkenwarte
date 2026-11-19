<?php

declare(strict_types=1);

namespace App\Extensions\Application;

/** Immutable code-image contribution discovered by the runtime plugin registry. */
interface PluginDefinition
{
    /** @return array<string, mixed> */
    public function manifest(): array;

    /** @return iterable<PluginCapability> */
    public function capabilities(): iterable;
}
