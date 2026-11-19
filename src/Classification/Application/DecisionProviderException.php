<?php

declare(strict_types=1);

namespace App\Classification\Application;

final class DecisionProviderException extends \RuntimeException
{
    public function __construct(string $message, public readonly bool $retryable, ?\Throwable $previous = null)
    {
        parent::__construct($message, previous: $previous);
    }
}
