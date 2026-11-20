<?php

declare(strict_types=1);

namespace App\Shared\Application;

interface OperationHandler
{
    public function handles(string $operation): bool;

    /**
     * @param array<string, mixed> $parameters
     * @param array<string, mixed> $body
     *
     * @return array<string, mixed>
     */
    public function handle(string $operation, array $parameters, array $body, Actor $actor): array;
}
