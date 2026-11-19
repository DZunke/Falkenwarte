<?php

declare(strict_types=1);

namespace App\Extensions\Application;

interface PluginManifestReader
{
    /** @return list<array<string, mixed>> */
    public function manifests(): array;
}
