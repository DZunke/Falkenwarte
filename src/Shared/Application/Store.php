<?php

declare(strict_types=1);

namespace App\Shared\Application;

/** Transactional resource and command journal shared by the bounded contexts. */
interface Store
{
    public const PUBLIC_TYPES = [
        'projects' => 'project', 'boards' => 'board', 'tasks' => 'task', 'runs' => 'run', 'evidence' => 'evidence', 'approvals' => 'approval', 'connections' => 'connection', 'agent_profiles' => 'agent_profile', 'workflows' => 'workflow', 'workflow_instances' => 'workflow_instance', 'triggers' => 'trigger', 'plugins' => 'plugin', 'exports' => 'export', 'backups' => 'backup', 'settings' => 'settings', 'owners' => 'owner', 'labels' => 'label', 'intakes' => 'intake', 'classifications' => 'classification', 'link_collections' => 'link_collection', 'decision_policies' => 'decision_policy',
    ];

    public function context(Actor $actor, string $action): void;

    public function actionId(): string;

    public function id(): string;

    public function now(): string;

    public function atomic(callable $operation): mixed;

    public function get(string $type, string $id): array;

    public function find(string $type, string $id): ?array;

    public function all(string $type, ?string $project = null): array;

    public function page(array $items, array $p = []): array;

    public function save(string $type, array $record, string $event): array;

    public function remove(string $type, string $id, string $event): void;

    public function redact(array $object): array;

    public function accepted(?array $resource = null, ?string $runId = null): array;

    public function enqueue(string $kind, array $payload): string;

    public function deleteSecret(string $ref): void;

    public function putSecret(string $ref, string $value): void;

    public function secret(string $ref): string;
}
