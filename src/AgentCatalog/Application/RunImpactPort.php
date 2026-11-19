<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

use App\AgentCatalog\Domain\ConnectionChangeImpact;

interface RunImpactPort
{
    public function connectionChanged(string $connectionId, ConnectionChangeImpact $impact, string $reason): void;

    public function projectBindingChanged(string $bindingId, string $reason): void;
}
