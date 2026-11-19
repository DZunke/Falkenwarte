<?php

declare(strict_types=1);

namespace App\AgentCatalog\Domain;

enum ConnectionChangeImpact: string
{
    case RECONCILE = 'reconcile';
    case BLOCK_AUTH = 'block_auth';
}
