<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\Orchestration\Application\AgentExecutionBridge;
use App\Orchestration\Application\T3BridgeException;
use Mcp\Client;
use Mcp\Client\Transport\HttpTransport;
use Mcp\Schema\Enum\ProtocolVersion;
use Mcp\Schema\Content\TextContent;
use Symfony\Component\HttpClient\Psr18Client;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Throwable;

/** A deliberately small client for the T3 MCP profile selected by the concept. */
final class T3McpBridge implements AgentExecutionBridge
{
    public const PROTOCOL_VERSION = '2025-06-18';

    public function __construct(private readonly HttpClientInterface $httpClient)
    {
    }

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function capabilities(array $connection, string $token): array
    {
        return $this->withSession($connection, $token, function (Client $client, array $tools): array {
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
        return $this->withSession($connection, $token, function (Client $client, array $tools) use ($cursor, $limit): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_project_list']);
            $result = $this->tool($client, 't3_project_list', array_filter(['cursor' => $cursor, 'limit' => $limit], static fn (mixed $value): bool => $value !== null));
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
    public function readThread(array $connection, string $token, string $threadId): array
    {
        return $this->withSession($connection, $token, function (Client $client, array $tools) use ($threadId): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_read']);

            return $this->tool($client, 't3_thread_read', ['threadId' => $threadId, 'afterPosition' => 0, 'limit' => 100, 'runLimit' => 50, 'maxCharsPerItem' => 20000]);
        });
    }

    /** @param array<string, mixed> $connection @param array<string, mixed> $payload @return array<string, mixed> */
    public function launch(array $connection, string $token, array $payload): array
    {
        return $this->withSession($connection, $token, function (Client $client, array $tools) use ($payload): array {
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
        return $this->withSession($connection, $token, function (Client $client, array $tools) use ($threadId, $message, $clientRequestId): array {
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
        return $this->withSession($connection, $token, function (Client $client, array $tools) use ($threadId, $runId): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_thread_interrupt']);

            return $this->tool($client, 't3_thread_interrupt', ['threadId' => $threadId, 'runId' => $runId]);
        });
    }

    /** @param array<string, mixed> $connection @param callable(Client, list<array<string, mixed>>): array<string, mixed> $operation @return array<string, mixed> */
    private function withSession(array $connection, string $token, callable $operation): array
    {
        $baseUrl = rtrim((string) ($connection['canonical_url'] ?? ''), '/');
        if (!str_starts_with($baseUrl, 'https://') && !$this->allowsTestMock($baseUrl)) {
            throw new T3BridgeException('Die T3-Verbindung benötigt eine kanonische HTTPS-Adresse.');
        }
        $psr18 = new Psr18Client($this->httpClient);
        $client = Client::builder()
            ->setClientInfo('falkenwarte', '0.1.0')
            ->setProtocolVersion(ProtocolVersion::V2025_06_18)
            ->setFallbackProtocolVersion(null)
            ->setInitTimeout(15)
            ->setRequestTimeout(15)
            ->setMaxRetries(0)
            ->build();
        $transport = new HttpTransport($baseUrl.'/mcp', ['Authorization' => 'Bearer '.$token], $psr18, $psr18, $psr18);
        try {
            $client->connect($transport);
            if ($client->getProtocolVersion()?->value !== self::PROTOCOL_VERSION) {
                throw new T3BridgeException('T3 hat ein nicht freigegebenes MCP-Protokoll ausgehandelt.');
            }
            $tools = array_map(static fn ($tool): array => $tool->jsonSerialize(), $client->listTools()->tools);

            return $operation($client, $tools);
        } catch (T3BridgeException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            if (str_contains($exception->getMessage(), '401') || str_contains($exception->getMessage(), '403')) {
                throw new T3BridgeException('T3 hat die aktuelle Autorisierung abgewiesen.', true, $exception);
            }
            throw new T3BridgeException('Der MCP-Verkehr mit T3 ist fehlgeschlagen.', false, $exception);
        } finally {
            try {
                $client->disconnect();
            } catch (Throwable) {
                // Session cleanup does not change the result of an already completed MCP operation.
            }
        }
    }

    /** @param list<string> $actual @param list<string> $required */
    private function requireTools(array $actual, array $required): void
    {
        $missing = array_values(array_diff($required, $actual));
        if ($missing !== []) {
            throw new T3BridgeException('T3 fehlen erforderliche MCP-Fähigkeiten: '.implode(', ', $missing));
        }
    }

    /** @param array<string, mixed> $arguments @return array<string, mixed> */
    private function tool(Client $client, string $name, array $arguments): array
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

    private function allowsTestMock(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);

        return getenv('APP_ENV') === 'test' && parse_url($url, PHP_URL_SCHEME) === 'http' && $host === 't3-mock';
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
            if (!is_string($id) || $id === '') {
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
