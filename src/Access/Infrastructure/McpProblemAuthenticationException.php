<?php

declare(strict_types=1);

namespace App\Access\Infrastructure;

use App\Shared\Domain\Problem;
use Symfony\Component\Security\Core\Exception\AuthenticationException;

final class McpProblemAuthenticationException extends AuthenticationException
{
    public function __construct(public readonly Problem $problem)
    {
        parent::__construct($problem->getMessage(), previous: $problem);
    }
}
