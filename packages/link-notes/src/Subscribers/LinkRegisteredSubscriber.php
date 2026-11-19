<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes\Subscribers;

use App\Extensions\Application\PluginEventSubscriber;
use App\Shared\Application\Store;
use Falkenwarte\LinkNotes\Application\LinkNoteRepository;

final readonly class LinkRegisteredSubscriber implements PluginEventSubscriber
{
    public function __construct(private Store $store, private LinkNoteRepository $notes)
    {
    }

    public function pluginId(): string
    {
        return 'falkenwarte.link-notes';
    }

    public function consumerId(): string
    {
        return 'link_notes.projection';
    }

    public function eventType(): string
    {
        return 'work.link_registered';
    }

    public function cursor(): int
    {
        return $this->notes->cursor($this->consumerId());
    }

    public function setCursor(int $sequence): void
    {
        $this->notes->setCursor($this->consumerId(), $sequence);
    }

    /** @param array<string, mixed> $event */
    public function consume(array $event, int $sequence): void
    {
        $eventId = $event['event_id'] ?? null;
        if (!is_string($eventId) || !$this->notes->markConsumed($eventId, $sequence, (string) ($event['occurred_at'] ?? $this->store->now()))) {
            return;
        }

        $aggregate = $event['aggregate'] ?? null;
        if (!is_array($aggregate) || ($aggregate['type'] ?? null) !== 'link_collection' || !is_string($aggregate['id'] ?? null)) {
            return;
        }
        $collection = $this->store->find('link_collections', $aggregate['id']);
        if (null === $collection) {
            return;
        }

        $this->notes->projectRegisteredLinks($collection, $eventId, (string) ($event['occurred_at'] ?? $this->store->now()));
    }
}
