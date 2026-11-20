<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Shared\Application\Clock;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\DependencyInjection\Attribute\When;

#[When(env: 'test')]
final class FileClock implements Clock
{
    public function __construct(
        private readonly SystemClock $systemClock,
        #[Autowire('%env(FALKENWARTE_TEST_CLOCK_FILE)%')]
        private readonly string $clockFile,
    ) {
    }

    public function now(): string
    {
        if ('' === $this->clockFile) {
            return $this->systemClock->now();
        }

        if (!file_exists($this->clockFile)) {
            return $this->systemClock->now();
        }

        $contents = @file_get_contents($this->clockFile);
        if (false === $contents) {
            throw new \UnexpectedValueException('The controlled clock file exists but cannot be read.');
        }

        $payload = json_decode($contents, true);
        if (!is_array($payload) || !is_string($payload['now'] ?? null)) {
            throw new \UnexpectedValueException('The controlled clock file must contain a JSON "now" timestamp.');
        }

        try {
            $now = new \DateTimeImmutable($payload['now']);
        } catch (\Throwable $error) {
            throw new \UnexpectedValueException('The controlled clock file contains an invalid timestamp.', previous: $error);
        }

        return $now->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');
    }
}
