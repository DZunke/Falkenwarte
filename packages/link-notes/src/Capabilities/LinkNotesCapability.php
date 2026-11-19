<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes\Capabilities;

use App\Extensions\Application\PluginCapability as PluginCapabilityContract;

final readonly class LinkNotesCapability implements PluginCapabilityContract
{
    public function name(): string
    {
        return 'links.notes';
    }

    public function implementationId(): string
    {
        return 'link_notes.panel';
    }
}
