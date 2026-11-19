<?php

declare(strict_types=1);

namespace App\Presentation;

use App\Extensions\Application\PluginRegistry;
use App\Shared\Application\Actor;
use App\Shared\Domain\Problem;
use Mcp\Schema\Content\TextContent;
use Mcp\Schema\Result\CallToolResult;
use Mcp\Server\ClientGateway;
use Mcp\Server\Handler\ToolHandlerInterface;

final readonly class McpTool implements ToolHandlerInterface
{
    public function __construct(private array $tool, private Actor $actor, private Gateway $app, private Contract $contract, private PluginRegistry $plugins)
    {
    }

    public function execute(array $arguments, ClientGateway $gateway): mixed
    {
        try {
            if (isset($this->tool['required_plugin']) && !$this->plugins->enabled($this->tool['required_plugin'])) {
                throw new Problem(409, 'capability_unavailable', 'The plugin capability for this MCP tool is not enabled.');
            }
            $this->contract->validate(json_decode(json_encode((object) $arguments, JSON_THROW_ON_ERROR)), $this->tool['inputSchema']);
            $op = $this->contract->op($this->tool['operation_id']);
            $p = $this->contract->params($op, $arguments, $arguments);
            $key = $arguments['client_request_id'] ?? null;
            $etag = isset($arguments['expected_version']) ? '"'.$arguments['expected_version'].'"' : null;
            unset($arguments['client_request_id'],$arguments['expected_version']);
            $body = array_diff_key($arguments, $p);
            $result = $this->app->invoke($op['operationId'], $p, $body, $this->actor, $key, $etag);
            $data = $this->contract->output($op, $this->contract->status($op, $result), $result);

            return new CallToolResult([new TextContent(json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE))], false, $data);
        } catch (Problem $e) {
            return new CallToolResult([new TextContent($e->getMessage())], true, (object) $e->details());
        } catch (\Throwable $e) {
            error_log(sprintf('MCP %s failed: %s in %s:%d', $this->tool['name'], $e::class, $e->getFile(), $e->getLine()));
            throw $e;
        }
    }
}
