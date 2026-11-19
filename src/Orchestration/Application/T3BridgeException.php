<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

use App\AgentCatalog\Application\T3ConnectionFailure;

final class T3BridgeException extends \RuntimeException implements T3ConnectionFailure
{
    public function __construct(string $message, public readonly bool $authenticationFailure = false, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }

    public function isAuthenticationFailure(): bool
    {
        return $this->authenticationFailure;
    }
}
