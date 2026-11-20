<?php

declare(strict_types=1);

namespace App\Orchestration\Application;

interface AgentExecutionBridge
{
    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function capabilities(array $connection, string $token, ?string $search = null): array;

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function projects(array $connection, string $token, ?string $cursor = null, int $limit = 50): array;

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function readThread(array $connection, string $token, string $threadId, ?string $runId = null): array;

    /** @param array<string, mixed> $connection @param array<string, mixed> $payload @return array<string, mixed> */
    public function launch(array $connection, string $token, array $payload): array;

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function send(array $connection, string $token, string $threadId, string $message, string $clientRequestId): array;

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function interrupt(array $connection, string $token, string $threadId, string $runId): array;
}
