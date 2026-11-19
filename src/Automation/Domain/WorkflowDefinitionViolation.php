<?php

declare(strict_types=1);

namespace App\Automation\Domain;

final class WorkflowDefinitionViolation extends \DomainException
{
    public function __construct(public readonly string $problemCode, string $message)
    {
        parent::__construct($message);
    }
}
