<?php

declare(strict_types=1);

namespace App\Tests\Fixtures\Plugins;

use App\Extensions\Application\PluginCapability;
use App\Extensions\Application\PluginDefinition;

final readonly class QaBridgeDependentDefinition implements PluginDefinition
{
    /** @return array<string, mixed> */
    public function manifest(): array
    {
        try {
            $manifest = json_decode(file_get_contents(__DIR__.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new \LogicException('The QA dependent plugin manifest is invalid JSON.', previous: $exception);
        }
        if (!is_array($manifest)) {
            throw new \LogicException('The QA dependent plugin manifest must be an object.');
        }

        return $manifest;
    }

    /** @return iterable<PluginCapability> */
    public function capabilities(): iterable
    {
        yield new QaBridgeDependentCapability();
    }
}

final readonly class QaBridgeDependentCapability implements PluginCapability
{
    public function name(): string
    {
        return 'qa.bridge.dependent';
    }

    public function implementationId(): string
    {
        return 'qa.bridge.dependent.v1';
    }
}
