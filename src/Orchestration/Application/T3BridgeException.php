<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

use RuntimeException;
use Throwable;

final class T3BridgeException extends RuntimeException
{
    public function __construct(string $message, public readonly bool $authenticationFailure = false, ?Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
