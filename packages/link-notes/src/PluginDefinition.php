<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes;

use App\Extensions\Application\PluginDefinition as PluginDefinitionContract;
use Falkenwarte\LinkNotes\Capabilities\LinkNotesCapability;

final readonly class PluginDefinition implements PluginDefinitionContract
{
    /** @return array<string, mixed> */
    public function manifest(): array
    {
        try {
            $manifest = json_decode(file_get_contents(__DIR__.'/../manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new \LogicException('The link-notes package manifest is invalid JSON.', previous: $exception);
        }
        if (!is_array($manifest)) {
            throw new \LogicException('The link-notes package manifest must be an object.');
        }

        return $manifest;
    }

    /** @return iterable<LinkNotesCapability> */
    public function capabilities(): iterable
    {
        yield new LinkNotesCapability();
    }
}
