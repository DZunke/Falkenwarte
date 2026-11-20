<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Shared\Application\Clock;
use Symfony\Component\Clock\ClockInterface as SymfonyClock;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(Clock::class)]
final class SystemClock implements Clock
{
    public function __construct(private readonly SymfonyClock $clock)
    {
    }

    public function now(): string
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\\TH:i:s.u\\Z');
    }
}
