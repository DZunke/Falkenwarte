<?php

declare(strict_types=1);

namespace App\Orchestration\Plugins;

use App\Extensions\Application\PluginDefinition;

final readonly class T3BridgePluginDefinition implements PluginDefinition
{
    /** @return array<string, mixed> */
    public function manifest(): array
    {
        try {
            $manifest = json_decode(file_get_contents(dirname(__DIR__, 3).'/packages/t3-mcp-bridge/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new \LogicException('The T3 bridge manifest is invalid JSON.', previous: $exception);
        }
        if (!is_array($manifest)) {
            throw new \LogicException('The T3 bridge manifest must be an object.');
        }

        return $manifest;
    }

    /** @return iterable<T3BridgeCapability> */
    public function capabilities(): iterable
    {
        yield new T3BridgeCapability();
    }
}
