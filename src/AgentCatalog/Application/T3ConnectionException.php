<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

final class T3ConnectionException extends \RuntimeException implements T3ConnectionFailure
{
    public function __construct(string $message, private readonly bool $authenticationFailure = false, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }

    public function isAuthenticationFailure(): bool
    {
        return $this->authenticationFailure;
    }
}
