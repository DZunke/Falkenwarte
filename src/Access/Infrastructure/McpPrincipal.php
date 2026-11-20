<?php

declare(strict_types=1);

namespace App\Access\Infrastructure;

use App\Shared\Application\Actor;
use Symfony\Component\Security\Core\User\UserInterface;

final readonly class McpPrincipal implements UserInterface
{
    public function __construct(public Actor $actor)
    {
    }

    public function getRoles(): array
    {
        return ['ROLE_MCP'];
    }

    public function eraseCredentials(): void
    {
    }

    public function getUserIdentifier(): string
    {
        return $this->actor->id;
    }
}
