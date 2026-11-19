<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

final readonly class Job
{
    public function __construct(public string $id)
    {
    }
}
