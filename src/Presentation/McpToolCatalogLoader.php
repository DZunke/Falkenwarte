<?php

declare(strict_types=1);

namespace App\Presentation;

use App\Access\Infrastructure\McpPrincipal;
use App\Extensions\Application\PluginRegistry;
use Mcp\Capability\Registry\Loader\ExplicitElementLoader;
use Mcp\Capability\Registry\Loader\LoaderInterface;
use Mcp\Capability\RegistryInterface;
use Mcp\Schema\Tool;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

/** Loads the caller's current, permitted tools into the request-scoped MCP registry. */
final readonly class McpToolCatalogLoader implements LoaderInterface
{
    public function __construct(
        private TokenStorageInterface $tokenStorage,
        private Contract $contract,
        private PluginRegistry $plugins,
        private Gateway $gateway,
    ) {
    }

    public function load(RegistryInterface $registry): void
    {
        $principal = $this->tokenStorage->getToken()?->getUser();
        if (!$principal instanceof McpPrincipal) {
            return;
        }

        $tools = [];
        foreach ($this->contract->tools($this->plugins) as $tool) {
            if (!$this->isVisible($tool, $principal->actor->capabilities)) {
                continue;
            }

            $tools[] = [
                'definition' => Tool::fromArray($tool),
                'handler' => new McpTool($tool, $principal->actor, $this->gateway, $this->contract, $this->plugins),
            ];
        }

        (new ExplicitElementLoader($tools))->load($registry);
    }

    /**
     * @param array<string, mixed> $tool
     * @param list<string>         $capabilities
     */
    private function isVisible(array $tool, array $capabilities): bool
    {
        $required = $tool['required_capabilities'] ?? [];
        if ((!($tool['default_enabled'] ?? true) && [] === $required) || array_diff($required, $capabilities)) {
            return false;
        }

        if (isset($tool['required_plugin']) && !$this->plugins->enabled($tool['required_plugin'])) {
            return false;
        }

        return true;
    }
}
