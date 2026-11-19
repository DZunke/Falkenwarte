<?php

declare(strict_types=1);

namespace App\Orchestration\Domain;

final readonly class RunCompletionDecision
{
    private function __construct(public string $outcome, public string $reason, public ?string $attentionCode = null)
    {
    }

    public static function succeeded(): self
    {
        return new self('succeeded', '');
    }

    public static function pending(string $outcome, string $reason, ?string $attentionCode = null): self
    {
        return new self($outcome, $reason, $attentionCode);
    }

    public static function failed(string $reason): self
    {
        return new self('failed', $reason);
    }

    public function isSucceeded(): bool
    {
        return 'succeeded' === $this->outcome;
    }
}
