<?php

declare(strict_types=1);

namespace App\Orchestration\Domain;

final class RunDelegationViolation extends \DomainException
{
    public function __construct(public readonly string $problemCode, string $message)
    {
        parent::__construct($message);
    }
}
