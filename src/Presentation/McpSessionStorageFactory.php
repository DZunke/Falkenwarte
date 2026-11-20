<?php

declare(strict_types=1);

namespace App\Presentation;

use App\Access\Infrastructure\McpPrincipal;
use Mcp\Server\Session\FileSessionLock;
use Mcp\Server\Session\FileSessionStore;
use Psr\Log\LoggerInterface;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

/** Creates the Bundle's native file session services in the caller's established storage area. */
final readonly class McpSessionStorageFactory
{
    public function __construct(
        private TokenStorageInterface $tokenStorage,
        private LoggerInterface $logger,
        private string $databasePath,
    ) {
    }

    public function createStore(): FileSessionStore
    {
        return new FileSessionStore($this->directory(), logger: $this->logger);
    }

    public function createLock(): FileSessionLock
    {
        return new FileSessionLock($this->directory(), logger: $this->logger);
    }

    private function directory(): string
    {
        $principal = $this->tokenStorage->getToken()?->getUser();
        $actorId = $principal instanceof McpPrincipal ? $principal->actor->id : 'anonymous';

        return dirname($this->databasePath).'/mcp/'.hash('sha256', $actorId);
    }
}
