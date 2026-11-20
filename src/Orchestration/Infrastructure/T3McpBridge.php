<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\AgentCatalog\Application\AgentCatalogMcpClient;
use App\Orchestration\Application\AgentExecutionBridge;
use App\Orchestration\Application\T3BridgeException;
use Mcp\Schema\Content\TextContent;
use Symfony\AI\McpBundle\Client\ServerConnectionInterface;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

/** A deliberately small client for the T3 MCP profile selected by the concept. */
#[AsAlias(AgentExecutionBridge::class)]
#[AsAlias(AgentCatalogMcpClient::class)]
final class T3McpBridge implements AgentExecutionBridge, AgentCatalogMcpClient
{
    public const PROTOCOL_VERSION = T3McpSessionFactory::PROTOCOL_VERSION;

    public function __construct(
        private readonly T3McpSessionFactory $sessions,
    ) {
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function capabilities(array $connection, string $token): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['orchestrator_capabilities', 't3_project_list', 't3_thread_launch', 't3_thread_read']);
            $result = $this->tool($client, 'orchestrator_capabilities', []);

            return [
                'tools' => $names,
                'server_version' => (string) ($result['serverVersion'] ?? $result['version'] ?? 'unknown'),
                'protocol_version' => self::PROTOCOL_VERSION,
                'providers' => $this->providers($result['providers'] ?? []),
                'supported_actions' => $this->supportedActions($names),
                'compatible' => in_array('t3_thread_launch', $names, true)
                    && in_array('t3_thread_read', $names, true)
                    && in_array('t3_thread_interrupt', $names, true),
            ];
        });
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function projects(array $connection, string $token, ?string $cursor = null, int $limit = 50): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($cursor, $limit): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_project_list']);
            $result = $this->tool($client, 't3_project_list', array_filter(['cursor' => $cursor, 'limit' => $limit], static fn (mixed $value): bool => null !== $value));
            $projects = $result['projects'] ?? $result['items'] ?? [];
            if (!is_array($projects)) {
                throw new T3BridgeException('T3 lieferte keine gültige Projektliste.');
            }

            return [
                'items' => array_map(static fn (array $project): array => [
                    'external_project_id' => (string) ($project['id'] ?? $project['projectId'] ?? ''),
                    'title' => (string) ($project['title'] ?? $project['name'] ?? ''),
                    'workspace_label' => (string) ($project['workspaceLabel'] ?? $project['workspace'] ?? ''),
                ], array_values(array_filter($projects, 'is_array'))),
                'next_cursor' => $result['nextCursor'] ?? null,
            ];
        });
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function readThread(array $connection, string $token, string $threadId, ?string $runId = null): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($threadId, $runId): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_read']);
            $result = $this->tool($client, 't3_thread_read', ['threadId' => $threadId, 'afterPosition' => 0, 'limit' => 100, 'runLimit' => 50, 'maxCharsPerItem' => 20000]);
            $runs = $result['runs'] ?? [];
            if (is_array($runs) && [] !== $runs) {
                $selected = null;
                if (null !== $runId) {
                    foreach ($runs as $candidate) {
                        if (is_array($candidate) && (string) ($candidate['runId'] ?? $candidate['id'] ?? '') === $runId) {
                            $selected = $candidate;
                            break;
                        }
                    }
                }
                if (null === $selected) {
                    $selected = $runs[array_key_last($runs)];
                }
                if (is_array($selected)) {
                    $result['run'] = $selected;
                    $result['runId'] ??= $selected['runId'] ?? $selected['id'] ?? null;
                    $result['status'] ??= $selected['status'] ?? null;
                    $result['pendingInput'] ??= $selected['pendingInput'] ?? $selected['pending_input'] ?? null;
                }
            }
            if (!isset($result['modelSelection'])) {
                $instanceId = $result['providerInstanceId'] ?? $result['provider_instance_id'] ?? null;
                $model = $result['model'] ?? null;
                if (is_string($instanceId) && '' !== $instanceId && is_string($model) && '' !== $model) {
                    $result['modelSelection'] = ['instanceId' => $instanceId, 'model' => $model];
                }
            }

            return $result;
        });
    }

    /** @param array<string, mixed> $connection @param array<string, mixed> $payload @return array<string, mixed> */
    public function launch(array $connection, string $token, array $payload): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($payload): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_launch']);
            $arguments = [
                'projectId' => $payload['projectId'],
                'title' => $payload['title'],
                'message' => $payload['message'],
                'clientRequestId' => $payload['clientRequestId'],
            ];
            if (isset($payload['modelSelection'])) {
                $arguments['modelSelection'] = $payload['modelSelection'];
            }

            return $this->tool($client, 't3_thread_launch', $arguments);
        });
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function send(array $connection, string $token, string $threadId, string $message, string $clientRequestId): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($threadId, $message, $clientRequestId): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_send']);

            return $this->tool($client, 't3_thread_send', [
                'threadId' => $threadId,
                'message' => $message,
                'clientRequestId' => $clientRequestId,
                'mode' => 'queue',
            ]);
        });
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function interrupt(array $connection, string $token, string $threadId, string $runId): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($threadId, $runId): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_interrupt']);

            return $this->tool($client, 't3_thread_interrupt', ['threadId' => $threadId, 'runId' => $runId, 'clientRequestId' => 'interrupt-'.$runId]);
        });
    }

    /** @param array<string, mixed> $connection @param callable(ServerConnectionInterface, list<array<string, mixed>>): array<string, mixed> $operation @return array<string, mixed> */
    private function withSession(array $connection, string $token, callable $operation): array
    {
        $client = $this->sessions->create((string) ($connection['canonical_url'] ?? ''), $token);
        try {
            if (self::PROTOCOL_VERSION !== $client->getProtocolVersion()?->value) {
                throw new T3BridgeException('T3 hat ein nicht freigegebenes MCP-Protokoll ausgehandelt.');
            }
            $tools = array_map(static fn ($tool): array => $tool->jsonSerialize(), $client->getTools());

            return $operation($client, $tools);
        } catch (T3BridgeException $exception) {
            throw $exception;
        } catch (\Throwable $exception) {
            if ($this->isAuthorizationFailure($exception)) {
                throw new T3BridgeException('T3 hat die aktuelle Autorisierung abgewiesen.', true, $exception);
            }
            throw new T3BridgeException('Der MCP-Verkehr mit T3 ist fehlgeschlagen.', false, $exception);
        } finally {
            try {
                $client->disconnect();
            } catch (\Throwable) {
                // Session cleanup does not change the result of an already completed MCP operation.
            }
        }
    }

    private function isAuthorizationFailure(\Throwable $exception): bool
    {
        do {
            if (1 === preg_match('/\b(?:401|403)\b/', $exception->getMessage())) {
                return true;
            }
            $exception = $exception->getPrevious();
        } while (null !== $exception);

        return false;
    }

    /** @param list<string> $actual @param list<string> $required */
    private function requireTools(array $actual, array $required): void
    {
        $missing = array_values(array_diff($required, $actual));
        if ([] !== $missing) {
            throw new T3BridgeException('T3 fehlen erforderliche MCP-Fähigkeiten: '.implode(', ', $missing));
        }
    }

    /** @param array<string, mixed> $arguments @return array<string, mixed> */
    private function tool(ServerConnectionInterface $client, string $name, array $arguments): array
    {
        $result = $client->callTool($name, $arguments);
        if ($result->isError) {
            throw new T3BridgeException('T3 hat den MCP-Aufruf abgewiesen: '.$name);
        }
        if (is_array($result->structuredContent)) {
            return $result->structuredContent;
        }
        foreach ($result->content as $content) {
            if (!$content instanceof TextContent) {
                continue;
            }
            $decoded = json_decode((string) $content->text, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return [];
    }

    /** @param mixed $providers @return list<array{provider_instance_id: string, display_name: ?string, available: bool}> */
    private function providers(mixed $providers): array
    {
        if (!is_array($providers)) {
            return [];
        }

        $result = [];
        foreach ($providers as $provider) {
            if (!is_array($provider)) {
                continue;
            }
            $id = $provider['providerInstanceId'] ?? $provider['instanceId'] ?? null;
            if (!is_string($id) || '' === $id) {
                continue;
            }
            $result[] = [
                'provider_instance_id' => $id,
                'display_name' => isset($provider['displayName']) ? (string) $provider['displayName'] : null,
                'available' => (bool) ($provider['available'] ?? true),
            ];
        }

        return $result;
    }

    /** @param list<string> $tools @return list<string> */
    private function supportedActions(array $tools): array
    {
        $mapping = [
            't3_thread_launch' => 'launch',
            't3_thread_read' => 'observe',
            't3_thread_wait' => 'wait',
            't3_thread_send' => 'send',
            't3_thread_interrupt' => 'interrupt',
            't3_project_list' => 'list_projects',
            'orchestrator_capabilities' => 'read_capabilities',
        ];

        return array_values(array_unique(array_map(static fn (string $tool): string => $mapping[$tool], array_intersect($tools, array_keys($mapping)))));
    }
}
