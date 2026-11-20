<?php

declare(strict_types=1);

namespace App\AgentCatalog\Application;

interface AgentCatalogMcpClient
{
    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function capabilities(array $connection, string $token): array;

    /** @param array<string, mixed> $connection @return array<string, mixed> */
    public function projects(array $connection, string $token, ?string $cursor = null, int $limit = 50): array;

    /** @param array<string, mixed> $connection @return array{items: list<array{id: string, title: string}>, next_cursor: ?string, has_more: bool} */
    public function threads(array $connection, string $token, string $projectId, ?string $cursor = null, int $limit = 50): array;
}
