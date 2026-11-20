<?php

declare(strict_types=1);

namespace App\Presentation;

use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;

/** Keeps actor-dependent MCP state inside the HTTP request's native Bundle server graph. */
final class McpRequestScopePass implements CompilerPassInterface
{
    private const REQUEST_SCOPED_SERVICES = [
        'mcp.server.falkenwarte',
        'mcp.server.falkenwarte.builder',
        'mcp.server.falkenwarte.registry',
        'mcp.server.falkenwarte.controller',
        'mcp.server.falkenwarte.session.store',
        'mcp.server.falkenwarte.session.lock',
    ];

    public function process(ContainerBuilder $container): void
    {
        foreach (self::REQUEST_SCOPED_SERVICES as $serviceId) {
            $container->getDefinition($serviceId)->setShared(false);
        }

        $container->getDefinition('mcp.server.falkenwarte.session.store')
            ->setFactory([new Reference(McpSessionStorageFactory::class), 'createStore'])
            ->setArguments([]);
        $container->getDefinition('mcp.server.falkenwarte.session.lock')
            ->setFactory([new Reference(McpSessionStorageFactory::class), 'createLock'])
            ->setArguments([]);
    }
}
