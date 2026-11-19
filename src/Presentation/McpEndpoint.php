<?php
declare(strict_types=1);
namespace App\Presentation;

use App\Access\Presentation\Access;
use Mcp\Schema\Enum\ProtocolVersion;
use Mcp\Schema\Tool;
use Mcp\Server;
use Mcp\Server\Session\{FileSessionLock,FileSessionStore};
use Mcp\Server\Transport\Http\Middleware\PassthroughMiddleware;
use Mcp\Server\Transport\StreamableHttpTransport;
use Nyholm\Psr7\ServerRequest;
use Symfony\Component\HttpFoundation\{Request,Response};

final readonly class McpEndpoint
{
    public function __construct(private Access $access,private Gateway $gateway,private Contract $contract) {}

    public function handle(Request $r):Response
    {
        $actor=$this->access->authenticate($r,true);
        $dir=dirname(getenv('FALKENWARTE_DB') ?: dirname(__DIR__,2).'/var/falkenwarte.sqlite').'/mcp/'.hash('sha256',$actor->id);
        $builder=Server::builder()->setServerInfo('Falkenwarte','0.2.0')->setProtocolVersion(ProtocolVersion::V2025_06_18)->withoutModernEra()->setSession(new FileSessionStore($dir))->setSessionLock(new FileSessionLock($dir));
        foreach ($this->contract->tools() as $spec) {
            if (!($spec['default_enabled'] ?? true) || array_diff($spec['required_capabilities'],$actor->capabilities)) { continue; }
            $builder->add(Tool::fromArray($spec), new McpTool($spec,$actor,$this->gateway,$this->contract));
        }
        $request=new ServerRequest($r->getMethod(),$r->getUri(),$r->headers->all(),$r->getContent());
        $result=$builder->build()->run(new StreamableHttpTransport($request,middleware:[new PassthroughMiddleware()]));
        return new Response((string)$result->getBody(),$result->getStatusCode(),$result->getHeaders());
    }
}
