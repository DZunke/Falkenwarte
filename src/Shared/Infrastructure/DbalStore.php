<?php

declare(strict_types=1);

namespace App\Shared\Infrastructure;

use App\Shared\Application\Actor;
use App\Shared\Application\Clock;
use App\Shared\Application\Store;
use App\Shared\Domain\CustomFieldHistory;
use App\Shared\Domain\Problem;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;

#[AsAlias(Store::class)]
#[AsAlias(DbalStoreAccess::class)]
final class DbalStore implements DbalStoreAccess
{
    private Actor $actor;

    private string $action;

    public function __construct(
        private readonly Connection $connection,
        private readonly Clock $clock,
        #[Autowire('%env(APP_SECRET)%')]
        private readonly string $appSecret,
    ) {
        $connection->executeStatement('PRAGMA busy_timeout=10000');
        if ('wal' !== strtolower((string) $connection->fetchOne('PRAGMA journal_mode'))) {
            $connection->fetchOne('PRAGMA journal_mode=WAL');
        }
        $connection->executeStatement('PRAGMA foreign_keys=ON');
        $connection->executeStatement('PRAGMA synchronous=FULL');
        $this->context(new Actor('system', false), $this->id());
    }

    public function context(Actor $actor, string $action): void
    {
        $this->actor = $actor;
        $this->action = $action;
    }

    public function actionId(): string
    {
        return $this->action;
    }

    public function db(): Connection
    {
        return $this->connection;
    }

    public function id(): string
    {
        return Uuid::v7()->toRfc4122();
    }

    public function now(): string
    {
        return $this->clock->now();
    }

    public function atomic(callable $operation): mixed
    {
        if ($this->connection->isTransactionActive()) {
            return $operation();
        }

        return $this->connection->transactional(function () use ($operation) {
            // Acquire the SQLite writer before reading aggregate versions or WIP counts.
            $this->connection->executeStatement("UPDATE runtime_state SET value=value WHERE key='write_lock'");

            return $operation();
        });
    }

    public function get(string $type, string $id): array
    {
        return $this->find($type, $id) ?? throw new Problem(404, 'resource_not_found', 'Der angeforderte Eintrag wurde nicht gefunden.');
    }

    private function table(string $type): string
    {
        return in_array($type, ['events', 'revisions'], true) ? $type : 'records';
    }

    public function find(string $type, string $id): ?array
    {
        $table = $this->table($type);
        $data = 'records' === $table
            ? $this->connection->fetchOne('SELECT data FROM records WHERE type=? AND id=?', [$type, $id])
            : $this->connection->fetchOne("SELECT data FROM $table WHERE id=?", [$id]);

        return false === $data ? null : json_decode($data, true, flags: JSON_THROW_ON_ERROR);
    }

    public function all(string $type, ?string $project = null): array
    {
        $table = $this->table($type);
        $sql = "SELECT data FROM $table WHERE 1=1";
        $params = [];
        if ('records' === $table) {
            $sql .= ' AND type=?';
            $params[] = $type;
        }
        if (null !== $project) {
            $sql .= ' AND project_id=?';
            $params[] = $project;
        }

        return array_map(static fn ($row) => json_decode($row, true, flags: JSON_THROW_ON_ERROR), $this->connection->fetchFirstColumn($sql.' ORDER BY seq', $params));
    }

    public function latestEventId(): ?string
    {
        $id = $this->connection->fetchOne('SELECT id FROM events ORDER BY seq DESC LIMIT 1');

        return false === $id ? null : (string) $id;
    }

    public function projectEventsAfter(string $projectId, string $eventType, ?string $cursor): array
    {
        $sql = "SELECT data FROM events WHERE project_id=? AND json_extract(data,'$.event_type')=? AND json_extract(data,'$.kind')='domain' AND json_extract(data,'$.aggregate.type')!='trigger'";
        $parameters = [$projectId, $eventType];
        if (null !== $cursor) {
            $sql .= ' AND seq > (SELECT seq FROM events WHERE id=?)';
            $parameters[] = $cursor;
        }
        $events = $this->connection->fetchFirstColumn($sql.' ORDER BY seq LIMIT 128', $parameters);

        return array_map(static fn (string $event): array => json_decode($event, true, flags: JSON_THROW_ON_ERROR), $events);
    }

    public function page(array $items, array $p = []): array
    {
        $offset = 0;
        if (isset($p['cursor'])) {
            $cursor = base64_decode((string) $p['cursor'], true);
            if (false === $cursor || !ctype_digit($cursor)) {
                throw new Problem(422, 'validation_failed', 'Der Seitencursor ist ungültig.');
            }
            $offset = (int) $cursor;
        }
        $limit = max(1, min(100, (int) ($p['limit'] ?? 50)));
        $more = count($items) > $offset + $limit;

        return ['items' => array_values(array_slice($items, $offset, $limit)), 'next_cursor' => $more ? base64_encode((string) ($offset + $limit)) : null, 'has_more' => $more];
    }

    public function save(string $type, array $record, string $event): array
    {
        return $this->atomic(function () use ($type, $record, $event) {
            $id = $record['id'] ?? $this->id();
            $old = $this->find($type, $id);
            $now = $this->now();
            $record['id'] = $id;
            $record['version'] = ($old['version'] ?? 0) + 1;
            $record['created_at'] = $old['created_at'] ?? $now;
            $record['updated_at'] = $now;
            $record['allowed_actions'] ??= [];
            $project = 'projects' === $type ? $id : ($record['project_id'] ?? null);
            $this->connection->executeStatement(
                'INSERT INTO records(type,id,project_id,data) VALUES (?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data',
                [$type, $id, $project, json_encode($record, JSON_THROW_ON_ERROR)],
            );
            $this->journal($type, $project, $old, $record, $event, null === $old ? 'created' : 'updated');

            return $record;
        });
    }

    public function remove(string $type, string $id, string $event): void
    {
        $this->atomic(function () use ($type, $id, $event) {
            $old = $this->get($type, $id);
            $this->connection->delete('records', ['type' => $type, 'id' => $id]);
            $after = ['id' => $id, 'version' => $old['version'] + 1];
            $this->journal($type, $old['project_id'] ?? null, $old, $after, $event, 'removed');
        });
    }

    private function journal(string $type, ?string $project, ?array $old, array $record, string $event, string $change): void
    {
        $name = self::PUBLIC_TYPES[$type] ?? ('actions' === $type ? 'action' : $type);
        $now = $this->now();
        $resource = ['resource_type' => $name, 'id' => $record['id'], 'version' => $record['version'], 'url' => '/api/v1/'.str_replace('_', '-', $type).'/'.rawurlencode($record['id'])];
        $changes = [];
        $snapshot = $this->redact($record);
        $old = null === $old ? null : $this->redact($old);
        foreach ($snapshot as $key => $value) {
            if (in_array($key, ['created_at', 'updated_at', 'allowed_actions'], true) || (null !== $old && ($old[$key] ?? null) === $value)) {
                continue;
            }
            $changes[] = ['path' => '/'.$key, 'before' => $this->historyValue($old[$key] ?? null), 'after' => $this->historyValue($value)];
        }
        if (isset(self::PUBLIC_TYPES[$type])) {
            $revision = [
                'id' => $this->id(),
                'resource' => $resource,
                'project_id' => $project,
                'actor' => $this->actor->ref(),
                'action_id' => $this->action,
                'correlation_id' => $this->action,
                'recorded_at' => $now,
                'schema_version' => 1,
                'summary' => $event,
                'changes' => $changes,
                'restorable' => 'tasks' === $type && 'removed' !== $change,
                'allowed_actions' => [],
                '_snapshot' => $snapshot,
            ];
            if ('tasks' === $type && !empty($snapshot['custom_fields'])) {
                $labels = array_column($this->all('custom_fields', $project), 'label', 'key');
                $revision['custom_field_values'] = CustomFieldHistory::snapshot($snapshot['custom_fields'], $labels);
            }
            $this->connection->insert('revisions', ['id' => $revision['id'], 'project_id' => $project, 'data' => json_encode($revision, JSON_THROW_ON_ERROR)]);
        }
        $envelope = [
            'event_id' => $this->id(),
            'kind' => 'actions' === $type ? 'action' : 'domain',
            'event_type' => strtolower(preg_replace('/(?<!^)[A-Z]/', '_$0', $event)),
            'schema_version' => 1,
            'occurred_at' => $now,
            'project_id' => $project,
            'actor' => $this->actor->ref(),
            'correlation_id' => $this->action,
            'causation_id' => null,
            'action_id' => $this->action,
            'aggregate' => [
                'type' => $name,
                'id' => $record['id'],
                'version' => $record['version'],
            ],
            'aggregate_sequence' => $record['version'],
            'data' => ['change' => $change],
        ];
        if (in_array($type, ['tasks', 'runs', 'intakes', 'classifications', 'approvals'], true)) {
            $keys = array_flip([
                'task_id',
                'run_id',
                'status_id',
                'status_category',
                'priority',
                'blocked',
                'state',
                'external_state',
                'outcome',
                'waiting_for',
                'origin',
                'status',
                'workflow_label_id',
                'routing_rules_version',
                'classification_id',
                'primary_topic_label_id',
                'label_ids',
                'assessment_status',
                'policy_version',
            ]);
            $envelope['data']['transition'] = ['before' => array_intersect_key($old ?? [], $keys), 'after' => array_intersect_key($record, $keys)];
        }
        if ('tasks' === $type && $old && ($old['status_id'] ?? null) !== ($record['status_id'] ?? null) && isset($record['status_id'])) {
            $envelope['event_type'] = 'work.task_moved';
            $envelope['data'] += [
                'task_id' => $record['id'],
                'from_status_id' => $old['status_id'],
                'to_status_id' => $record['status_id'],
                'from_category' => $old['status_category'],
                'to_category' => $record['status_category'],
                'board_id' => null,
            ];
        }
        if ('actions' === $type) {
            $envelope['aggregate'] = null;
            unset($envelope['aggregate_sequence']);
            $envelope['data'] = [
                'command_type' => $record['type'],
                'target' => ['type' => 'command', 'id' => $record['id']],
                'result_resource' => null,
                'error_code' => $record['error']['code'] ?? null,
                'redacted_message' => $record['status'],
            ];
            if (isset($record['result']['resource_type'],$record['result']['id'])) {
                $envelope['data']['result_resource'] = ['type' => $record['result']['resource_type'], 'id' => $record['result']['id']];
            }
        }
        $uiTypes = [
            'project',
            'task',
            'board',
            'run',
            'evidence',
            'approval',
            'connection',
            'agent_profile',
            'plugin',
            'action',
            'label',
            'intake',
            'classification',
            'link_collection',
            'decision_policy',
        ];
        $ui = in_array($name, $uiTypes, true)
            ? [
                'event_id' => $envelope['event_id'],
                'occurred_at' => $now,
                'resource_type' => $name,
                'resource_id' => $record['id'],
                'project_id' => $project,
                'version' => $record['version'],
                'action_id' => $this->action,
                'change' => $change,
            ]
            : null;
        if (($envelope['aggregate']['id'] ?? null) !== null && !Uuid::isValid($envelope['aggregate']['id'])) {
            $envelope['kind'] = 'integration';
            $envelope['aggregate'] = null;
            unset($envelope['aggregate_sequence']);
        }
        $this->connection->insert('events', [
            'id' => $envelope['event_id'],
            'project_id' => $project,
            'data' => json_encode($envelope, JSON_THROW_ON_ERROR),
            'change_json' => null === $ui ? null : json_encode($ui, JSON_THROW_ON_ERROR),
            'published' => null === $ui ? 1 : 0,
        ]);
    }

    public function redact(array $object): array
    {
        foreach ($object as $key => $value) {
            if (is_string($key) && (str_starts_with($key, '_') || in_array($key, ['password', 'token', 'secret', 'access_token', 'refresh_token', 'csrf_token', 'code_verifier'], true))) {
                unset($object[$key]);
            } elseif (is_array($value)) {
                $object[$key] = $this->redact('custom_fields' === $key ? CustomFieldHistory::publicFields($value) : $value);
            }
        }

        return $object;
    }

    private function historyValue(mixed $value): array
    {
        if (is_array($value)) {
            return [
                'type' => 'structured_reference',
                'schema_id' => 'urn:falkenwarte:history:json',
                'summary' => count($value).' Einträge',
                'sha256' => hash('sha256', json_encode($value, JSON_THROW_ON_ERROR)),
            ];
        }

        return ['type' => match (true) {
            null === $value => 'null', is_bool($value) => 'boolean', is_numeric($value) && !is_string($value) => 'number', default => 'text',
        }, 'value' => is_string($value) ? mb_substr($value, 0, 20000) : $value];
    }

    public function accepted(?array $resource = null, ?string $runId = null): array
    {
        if ($resource && !isset($resource['url'])) {
            $collection = array_search($resource['resource_type'] ?? '', self::PUBLIC_TYPES, true) ?: $resource['resource_type'];
            $resource['url'] = '/api/v1/'.str_replace('_', '-', $collection).'/'.rawurlencode($resource['id']);
        }

        return ['action_id' => $this->action, 'status' => 'accepted', 'action_url' => '/api/v1/actions/'.$this->action, 'resource' => $resource, 'run_id' => $runId];
    }

    public function enqueue(string $kind, array $payload): string
    {
        $id = $this->id();
        $this->connection->insert('commands', ['id' => $id, 'kind' => $kind, 'action_id' => $this->action, 'payload' => json_encode($payload, JSON_THROW_ON_ERROR), 'due_at' => time()]);

        return $id;
    }

    public function deleteSecret(string $ref): void
    {
        $this->connection->delete('secrets', ['ref' => $ref]);
    }

    public function putSecret(string $ref, string $value): void
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $encrypted = $nonce.sodium_crypto_secretbox($value, $nonce, $this->key());
        $this->connection->executeStatement('INSERT INTO secrets VALUES (?,?) ON CONFLICT(ref) DO UPDATE SET value=excluded.value', [$ref, base64_encode($encrypted)]);
    }

    public function secret(string $ref): string
    {
        $value = $this->connection->fetchOne('SELECT value FROM secrets WHERE ref=?', [$ref]);
        if (!$value) {
            throw new Problem(409, 'secret_unconfigured', 'Der Zugang ist noch nicht eingerichtet.');
        }
        $bytes = base64_decode($value, true);
        $n = SODIUM_CRYPTO_SECRETBOX_NONCEBYTES;
        $plain = sodium_crypto_secretbox_open(substr($bytes, $n), substr($bytes, 0, $n), $this->key());

        return false !== $plain ? $plain : throw new Problem(503, 'secret_unavailable', 'Der Zugang kann mit diesem Schlüssel nicht gelesen werden.');
    }

    private function key(): string
    {
        if (strlen($this->appSecret) < 32) {
            throw new Problem(503, 'secret_unavailable', 'APP_SECRET mit mindestens 32 Zeichen konfigurieren.');
        }

        return hash('sha256', $this->appSecret, true);
    }
}
