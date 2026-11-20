<?php

declare(strict_types=1);

namespace App\Presentation;

use App\Access\Infrastructure\McpPrincipal;
use App\Extensions\Application\PluginRegistry;
use App\Shared\Domain\Problem;
use Mcp\Schema\Enum\ProtocolVersion;
use Mcp\Schema\Tool;
use Mcp\Server;
use Mcp\Server\Session\FileSessionLock;
use Mcp\Server\Session\FileSessionStore;
use Mcp\Server\Transport\Http\Middleware\PassthroughMiddleware;
use Mcp\Server\Transport\StreamableHttpTransport;
use Nyholm\Psr7\ServerRequest;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

final readonly class McpEndpoint
{
    public function __construct(
        private TokenStorageInterface $tokenStorage,
        private Gateway $gateway,
        private Contract $contract,
        private PluginRegistry $plugins,
        #[Autowire('%falkenwarte.database_path%')]
        private string $databasePath,
        private string $appVersion,
    ) {
    }

    public function handle(Request $r): Response
    {
        $user = $this->tokenStorage->getToken()?->getUser();
        if (!$user instanceof McpPrincipal) {
            throw new Problem(401, 'unauthenticated', 'Ein technisches Bearer-Token ist erforderlich.');
        }
        $actor = $user->actor;
        $dir = dirname($this->databasePath).'/mcp/'.hash('sha256', $actor->id);
        $builder = Server::builder()->setServerInfo('Falkenwarte', $this->appVersion)->setProtocolVersion(ProtocolVersion::V2025_06_18)->withoutModernEra()->setSession(new FileSessionStore($dir))->setSessionLock(new FileSessionLock($dir));
        foreach ($this->contract->tools($this->plugins) as $spec) {
            $required = $spec['required_capabilities'] ?? [];
            // Optional tools require an explicit grant on this technical token.
            if ((!($spec['default_enabled'] ?? true) && [] === $required)
                || array_diff($required, $actor->capabilities)
                || (isset($spec['required_plugin']) && !$this->plugins->enabled($spec['required_plugin']))) {
                continue;
            }
            $builder->add(Tool::fromArray($spec), new McpTool($spec, $actor, $this->gateway, $this->contract, $this->plugins));
        }
        $request = new ServerRequest($r->getMethod(), $r->getUri(), $r->headers->all(), $r->getContent());
        $result = $builder->build()->run(new StreamableHttpTransport($request, middleware: [new PassthroughMiddleware()]));

        return new Response((string) $result->getBody(), $result->getStatusCode(), $result->getHeaders());
    }
}
