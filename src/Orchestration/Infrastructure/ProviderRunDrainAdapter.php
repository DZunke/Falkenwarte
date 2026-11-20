<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\Extensions\Application\ProviderRunDrainPort;
use App\Orchestration\Application\RunHandler;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(ProviderRunDrainPort::class)]
final class ProviderRunDrainAdapter implements ProviderRunDrainPort
{
    public function __construct(private readonly RunHandler $runs)
    {
    }

    public function requestCancelForProvider(string $providerId, string $reason): int
    {
        return $this->runs->requestCancelForProvider($providerId, $reason);
    }
}
