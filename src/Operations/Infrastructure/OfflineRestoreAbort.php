<?php

declare(strict_types=1);

namespace App\Operations\Infrastructure;

final class OfflineRestoreAbort extends \RuntimeException
{
    public function __construct(string $message, public readonly int $exitStatus)
    {
        parent::__construct($message);
    }
}
