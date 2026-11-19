<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

interface T3ConnectionFailure extends \Throwable
{
    public function isAuthenticationFailure(): bool;
}
