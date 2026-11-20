<?php

declare(strict_types=1);

namespace App\Extensions\Infrastructure;

use App\Extensions\Application\PluginEventDispatcher;
use App\Extensions\Application\PluginEventSubscriber;
use App\Extensions\Application\PluginRegistry;
use App\Shared\Infrastructure\DbalStoreAccess;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\DependencyInjection\Attribute\AutowireIterator;

/** Dispatches declared durable events to package-owned idempotent subscribers. */
#[AsAlias(PluginEventDispatcher::class)]
final readonly class RegisteredPluginEventDispatcher implements PluginEventDispatcher
{
    /** @param iterable<PluginEventSubscriber> $subscribers */
    public function __construct(
        private DbalStoreAccess $store,
        private PluginRegistry $registry,
        #[AutowireIterator('app.plugin_event_subscriber')] private iterable $subscribers,
    ) {
    }

    public function dispatch(?string $pluginId = null): void
    {
        foreach ($this->subscribers as $subscriber) {
            $subscriberPlugin = $subscriber->pluginId();
            if ((null !== $pluginId && $subscriberPlugin !== $pluginId) || !$this->registry->enabled($subscriberPlugin)) {
                continue;
            }

            $subscription = $this->subscription($subscriberPlugin, $subscriber->consumerId(), $subscriber->eventType());
            if (null === $subscription) {
                throw new \LogicException(sprintf('Plugin subscriber "%s" is not declared in its manifest.', $subscriber->consumerId()));
            }

            $this->dispatchSubscriber($subscriber, $subscription);
        }
    }

    /** @return array<string, mixed>|null */
    private function subscription(string $pluginId, string $consumerId, string $eventType): ?array
    {
        foreach ($this->registry->manifest($pluginId)['subscriptions'] ?? [] as $subscription) {
            if (($subscription['consumer'] ?? null) === $consumerId && ($subscription['event_type'] ?? null) === $eventType) {
                return $subscription;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $subscription */
    private function dispatchSubscriber(PluginEventSubscriber $subscriber, array $subscription): void
    {
        $db = $this->store->db();
        $maximum = (int) $db->fetchOne('SELECT COALESCE(MAX(seq), 0) FROM events');
        $cursor = $subscriber->cursor();
        if (0 === $cursor && $maximum > 0) {
            $replayLimit = max(1, min(10000, (int) ($subscription['replay_limit'] ?? 1000)));
            $cursor = max(0, $maximum - $replayLimit);
            $subscriber->setCursor($cursor);
        }

        do {
            $rows = $db->fetchAllAssociative('SELECT seq, data FROM events WHERE seq>? ORDER BY seq LIMIT 250', [$cursor]);
            if ([] === $rows) {
                return;
            }
            $last = $cursor;
            $this->store->atomic(function () use ($rows, $subscriber, $subscription, &$last): void {
                foreach ($rows as $row) {
                    try {
                        $event = json_decode((string) $row['data'], true, flags: JSON_THROW_ON_ERROR);
                    } catch (\JsonException $exception) {
                        throw new \LogicException('The durable event journal contains invalid JSON.', previous: $exception);
                    }
                    $sequence = (int) $row['seq'];
                    if (($event['event_type'] ?? null) === $subscriber->eventType()
                        && ($event['schema_version'] ?? null) === ($subscription['schema_version'] ?? null)) {
                        $subscriber->consume($event, $sequence);
                    }
                    $subscriber->setCursor($sequence);
                    $last = $sequence;
                }
            });
            $cursor = $last;
        } while (250 === count($rows) && $cursor < $maximum);
    }
}
