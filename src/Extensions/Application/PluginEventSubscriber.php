<?php

declare(strict_types=1);

namespace App\Extensions\Application;

/** Idempotent subscriber for a declared versioned domain event. */
interface PluginEventSubscriber
{
    public function pluginId(): string;

    public function consumerId(): string;

    public function eventType(): string;

    public function cursor(): int;

    public function setCursor(int $sequence): void;

    /** @param array<string, mixed> $event */
    public function consume(array $event, int $sequence): void;
}
