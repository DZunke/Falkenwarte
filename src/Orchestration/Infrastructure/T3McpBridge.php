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
    public function capabilities(array $connection, string $token, ?string $search = null): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($search): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['orchestrator_capabilities', 't3_project_list', 't3_thread_launch', 't3_thread_read']);
            $arguments = null === $search ? [] : ['search' => $search];
            $result = $this->tool($client, 'orchestrator_capabilities', $arguments);

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
        $nativeCursor = 0;
        if (null !== $cursor) {
            $nativeCursor = filter_var($cursor, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 9007199254740991]]);
            if (false === $nativeCursor) {
                $legacyOffset = base64_decode($cursor, true);
                $nativeCursor = false === $legacyOffset
                    ? false
                    : filter_var($legacyOffset, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 9007199254740991]]);
            }
            if (false === $nativeCursor) {
                throw new T3BridgeException('Der T3-Projektcursor ist ungültig.');
            }
        }

        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($nativeCursor, $limit): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            $this->requireTools($names, ['t3_project_list']);
            $result = $this->tool($client, 't3_project_list', ['cursor' => $nativeCursor, 'limit' => $limit]);
            $projects = $result['projects'] ?? $result['items'] ?? [];
            if (!is_array($projects)) {
                throw new T3BridgeException('T3 lieferte keine gültige Projektliste.');
            }
            $nextCursor = $result['nextCursor'] ?? $result['next_cursor'] ?? null;
            if (null !== $nextCursor) {
                if (!is_int($nextCursor) && !is_string($nextCursor)) {
                    throw new T3BridgeException('T3 lieferte einen ungültigen Projektcursor.');
                }
                $nextCursor = filter_var((string) $nextCursor, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 9007199254740991]]);
                if (false === $nextCursor || $nextCursor <= $nativeCursor) {
                    throw new T3BridgeException('T3 lieferte einen ungültigen Projektcursor.');
                }
            }

            return [
                'items' => array_map(static fn (array $project): array => [
                    'external_project_id' => (string) ($project['id'] ?? $project['projectId'] ?? ''),
                    'title' => (string) ($project['title'] ?? $project['name'] ?? ''),
                    'workspace_label' => (string) ($project['workspaceRoot'] ?? $project['workspaceLabel'] ?? $project['workspace'] ?? ''),
                ], array_values(array_filter($projects, 'is_array'))),
                'next_cursor' => null === $nextCursor ? null : (string) $nextCursor,
                'has_more' => null !== $nextCursor,
            ];
        });
    }

    /** @param array<string, mixed> $connection @return array{items: list<array{id: string, title: string, provider_instance_id?: string, model?: string}>, next_cursor: ?string, has_more: bool} */
    public function threads(array $connection, string $token, string $projectId, ?string $cursor = null, int $limit = 50): array
    {
        return $this->withSession($connection, $token, function (ServerConnectionInterface $client, array $tools) use ($projectId, $cursor, $limit): array {
            $names = array_map(static fn (array $tool): string => (string) ($tool['name'] ?? ''), $tools);
            if (!in_array('t3_thread_list', $names, true)) {
                throw new T3BridgeException('Diese T3-Version stellt keine Threadliste bereit. Wähle den T3-Projektstandard oder gib eine bekannte Referenzthread-ID ein.');
            }

            $offset = null === $cursor ? null : filter_var($cursor, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
            if (null !== $cursor && false === $offset) {
                throw new T3BridgeException('Der T3-Threadseiten-Cursor ist ungültig. Lade die erste Seite erneut.');
            }
            $arguments = ['projectId' => $projectId, 'limit' => $limit];
            if (null !== $offset) {
                $arguments['cursor'] = $offset;
            }
            $result = $this->tool($client, 't3_thread_list', $arguments);
            if (($result['projectId'] ?? null) !== $projectId) {
                throw new T3BridgeException('T3 lieferte eine Threadliste ohne übereinstimmende Projektzugehörigkeit.');
            }
            $threads = $result['threads'] ?? null;
            if (!is_array($threads)) {
                throw new T3BridgeException('T3 lieferte keine gültige Threadliste.');
            }

            $items = [];
            foreach ($threads as $thread) {
                if (!is_array($thread) || ($thread['projectId'] ?? null) !== $projectId) {
                    continue;
                }
                $id = $thread['threadId'] ?? null;
                $title = $thread['title'] ?? null;
                if (!is_string($id) || '' === $id || mb_strlen($id) > 256 || !is_string($title) || mb_strlen($title) > 1000) {
                    throw new T3BridgeException('T3 lieferte einen ungültigen Thread für das gebundene Projekt.');
                }
                $item = ['id' => $id, 'title' => $title];
                $providerInstanceId = $thread['providerInstanceId'] ?? null;
                if (is_string($providerInstanceId) && 1 === preg_match('/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/D', $providerInstanceId)) {
                    $item['provider_instance_id'] = $providerInstanceId;
                }
                $model = $thread['model'] ?? null;
                if (is_string($model) && '' !== $model && mb_strlen($model) <= 256) {
                    $item['model'] = $model;
                }
                $items[] = $item;
            }

            if (!array_key_exists('nextCursor', $result)) {
                throw new T3BridgeException('T3 lieferte keine gültige Folgeseiteninformation.');
            }
            $nextCursor = $result['nextCursor'];
            if (null !== $nextCursor && (!is_int($nextCursor) || $nextCursor < 0 || strlen((string) $nextCursor) > 15 || (null !== $offset && $nextCursor <= $offset))) {
                throw new T3BridgeException('T3 lieferte einen ungültigen Folgeseiten-Cursor. Lade die erste Seite erneut.');
            }

            return [
                'items' => $items,
                'next_cursor' => null === $nextCursor ? null : (string) $nextCursor,
                'has_more' => null !== $nextCursor,
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
            $thread = $result['thread'] ?? null;
            $nativeRead = is_array($thread);
            if (null !== $runId) {
                unset($result['status'], $result['runId'], $result['run'], $result['pendingInput']);
            }
            if ($nativeRead) {
                $nativeThreadId = $thread['threadId'] ?? null;
                $nativeProjectId = $thread['projectId'] ?? null;
                if (!is_string($nativeThreadId) || '' === trim($nativeThreadId) || $nativeThreadId !== $threadId
                    || !is_string($nativeProjectId) || '' === trim($nativeProjectId)) {
                    throw new T3BridgeException('T3 lieferte eine ungültige Thread- oder Projektzugehörigkeit.');
                }
                $result['threadId'] = $nativeThreadId;
                $result['projectId'] = $nativeProjectId;
                unset($result['modelSelection']);
                $providerInstanceId = $thread['providerInstanceId'] ?? null;
                $model = $thread['model'] ?? null;
                if (is_string($providerInstanceId) && 1 === preg_match('/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/D', $providerInstanceId)) {
                    $result['providerInstanceId'] = $providerInstanceId;
                } else {
                    unset($result['providerInstanceId']);
                }
                if (is_string($model) && '' !== trim($model) && $model === trim($model) && mb_strlen($model) <= 256) {
                    $result['model'] = $model;
                } else {
                    unset($result['model']);
                }
                // The nested thread status is not a run status. A requested run must be selected below.
                unset($result['status'], $result['runId'], $result['run'], $result['pendingInput']);
                if (isset($result['providerInstanceId'], $result['model'])) {
                    $result['modelSelection'] = ['instanceId' => $result['providerInstanceId'], 'model' => $result['model']];
                }
            }

            $runs = $result['recentRuns'] ?? $result['runs'] ?? [];
            if (is_array($runs) && [] !== $runs) {
                $selected = null;
                if (null !== $runId) {
                    foreach ($runs as $candidate) {
                        if (is_array($candidate) && (string) ($candidate['runId'] ?? $candidate['id'] ?? '') === $runId) {
                            $selected = $candidate;
                            break;
                        }
                    }
                } elseif ($nativeRead && is_string($thread['latestRunId'] ?? null)) {
                    foreach ($runs as $candidate) {
                        if (is_array($candidate) && (string) ($candidate['runId'] ?? $candidate['id'] ?? '') === $thread['latestRunId']) {
                            $selected = $candidate;
                            break;
                        }
                    }
                } elseif (!$nativeRead) {
                    $selected = $runs[array_key_last($runs)];
                }
                if (is_array($selected)) {
                    $selectedRunId = $selected['runId'] ?? $selected['id'] ?? null;
                    if (is_string($selectedRunId) && '' !== $selectedRunId) {
                        $selected['id'] ??= $selectedRunId;
                        $selected['runId'] ??= $selectedRunId;
                    }
                    $result['run'] = $selected;
                    $result['runId'] = $selectedRunId;
                    $result['status'] = $selected['status'] ?? 'unknown';
                    $result['pendingInput'] ??= $selected['pendingInput'] ?? $selected['pending_input'] ?? null;
                } elseif (null !== $runId) {
                    // Never observe a different recent run as if it were the exact dispatch.
                    $result['status'] = 'unknown';
                }
            } elseif (null !== $runId) {
                $result['status'] = 'unknown';
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

    /** @param mixed $providers @return list<array{provider_instance_id: string, display_name: ?string, available: bool, models: list<array{id: string, label?: string}>, omitted_models?: int}> */
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
            if (!is_string($id) || '' === trim($id) || mb_strlen($id) > 64 || 1 !== preg_match('/^[a-zA-Z][a-zA-Z0-9_-]*$/D', $id)) {
                continue;
            }
            $displayName = $provider['displayName'] ?? null;
            if (!is_string($displayName) || mb_strlen($displayName) > 200) {
                $displayName = null;
            }
            $models = [];
            $providerModels = $provider['models'] ?? [];
            foreach (is_array($providerModels) ? $providerModels : [] as $model) {
                if (count($models) >= 500) {
                    break;
                }
                if (!is_array($model)) {
                    continue;
                }
                $modelId = $model['id'] ?? null;
                if (!is_string($modelId) || '' === $modelId || mb_strlen($modelId) > 256) {
                    continue;
                }
                $normalizedModel = ['id' => $modelId];
                $label = $model['label'] ?? null;
                if (is_string($label) && mb_strlen($label) <= 200) {
                    $normalizedModel['label'] = $label;
                }
                $models[] = $normalizedModel;
            }
            $normalized = [
                'provider_instance_id' => $id,
                'display_name' => $displayName,
                // A false signal from either schema takes precedence over a true from the other.
                // Native T3 uses canRunChildTask; older capability sources may expose available.
                'available' => $this->providerAvailable($provider),
                'models' => $models,
            ];
            $omittedModels = $provider['omittedModels'] ?? $provider['omitted_models'] ?? null;
            if (is_int($omittedModels) && $omittedModels >= 0) {
                $normalized['omitted_models'] = $omittedModels;
            }
            $result[] = $normalized;
        }

        return $result;
    }

    /** @param array<string, mixed> $provider */
    private function providerAvailable(array $provider): bool
    {
        $legacy = $provider['available'] ?? null;
        $native = $provider['canRunChildTask'] ?? null;
        if (false === $legacy || false === $native) {
            return false;
        }

        return true === $legacy || true === $native;
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
