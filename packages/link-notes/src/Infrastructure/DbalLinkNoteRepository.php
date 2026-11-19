<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes\Infrastructure;

use Doctrine\DBAL\Connection;
use Falkenwarte\LinkNotes\Application\LinkNoteRepository;
use Symfony\Component\Uid\Uuid;

final readonly class DbalLinkNoteRepository implements LinkNoteRepository
{
    public function __construct(private Connection $connection)
    {
    }

    public function forTask(string $projectId, string $taskId): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT * FROM plg_link_notes_notes WHERE project_id=? AND task_id=? AND deleted_at IS NULL ORDER BY created_at, id',
            [$projectId, $taskId],
        );

        return array_map(fn (array $row): array => $this->view($row), $rows);
    }

    public function find(string $noteId): ?array
    {
        $row = $this->connection->fetchAssociative('SELECT * FROM plg_link_notes_notes WHERE id=?', [$noteId]);

        return false === $row ? null : $this->view($row);
    }

    public function create(string $id, string $projectId, string $taskId, string $linkId, string $note, array $actor, string $at): array
    {
        $this->connection->insert('plg_link_notes_notes', [
            'id' => $id,
            'project_id' => $projectId,
            'task_id' => $taskId,
            'link_id' => $linkId,
            'note' => $note,
            'created_by' => json_encode($actor, JSON_THROW_ON_ERROR),
            'created_at' => $at,
            'updated_at' => $at,
            'deleted_at' => null,
            'version' => 1,
        ]);
        $this->revision($id, 1, $note, $actor, $at, 'created');

        return $this->find($id) ?? throw new \LogicException('The created link note could not be read back.');
    }

    public function update(string $noteId, string $note, array $actor, string $at): array
    {
        $row = $this->connection->fetchAssociative('SELECT version FROM plg_link_notes_notes WHERE id=? AND deleted_at IS NULL', [$noteId]);
        if (false === $row) {
            throw new \RuntimeException('The link note is no longer editable.');
        }
        $version = (int) $row['version'] + 1;
        $this->connection->update('plg_link_notes_notes', ['note' => $note, 'updated_at' => $at, 'version' => $version], ['id' => $noteId]);
        $this->revision($noteId, $version, $note, $actor, $at, 'updated');

        return $this->find($noteId) ?? throw new \LogicException('The updated link note could not be read back.');
    }

    public function remove(string $noteId, array $actor, string $at): array
    {
        $row = $this->connection->fetchAssociative('SELECT version FROM plg_link_notes_notes WHERE id=? AND deleted_at IS NULL', [$noteId]);
        if (false === $row) {
            throw new \RuntimeException('The link note is already removed.');
        }
        $version = (int) $row['version'] + 1;
        $this->connection->update('plg_link_notes_notes', ['deleted_at' => $at, 'updated_at' => $at, 'version' => $version], ['id' => $noteId]);
        $this->revision($noteId, $version, null, $actor, $at, 'removed');

        return $this->find($noteId) ?? throw new \LogicException('The removed link note could not be read back.');
    }

    public function projectRegisteredLinks(array $collection, string $eventId, string $at): void
    {
        $projectId = $collection['project_id'] ?? null;
        $taskId = $collection['task_id'] ?? null;
        $collectionId = $collection['id'] ?? null;
        if (!is_string($projectId) || !is_string($taskId) || !is_string($collectionId)) {
            return;
        }
        foreach ($collection['links'] ?? [] as $link) {
            if (!is_array($link) || !is_string($link['id'] ?? null)) {
                continue;
            }
            $this->connection->executeStatement(
                'INSERT INTO plg_link_notes_link_projection(task_id, project_id, link_id, collection_id, registered_at, event_id) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, link_id) DO UPDATE SET project_id=excluded.project_id, collection_id=excluded.collection_id, event_id=excluded.event_id',
                [$taskId, $projectId, $link['id'], $collectionId, $link['registered_at'] ?? $at, $eventId],
            );
        }
    }

    public function cursor(string $consumer): int
    {
        $sequence = $this->connection->fetchOne('SELECT sequence FROM plg_link_notes_event_cursor WHERE consumer=?', [$consumer]);

        return false === $sequence ? 0 : (int) $sequence;
    }

    public function setCursor(string $consumer, int $sequence): void
    {
        $this->connection->executeStatement(
            'INSERT INTO plg_link_notes_event_cursor(consumer, sequence) VALUES(?, ?) ON CONFLICT(consumer) DO UPDATE SET sequence=MAX(sequence, excluded.sequence)',
            [$consumer, $sequence],
        );
    }

    public function markConsumed(string $eventId, int $sequence, string $at): bool
    {
        return 1 === $this->connection->executeStatement(
            'INSERT OR IGNORE INTO plg_link_notes_inbox(event_id, sequence, consumed_at) VALUES(?, ?, ?)',
            [$eventId, $sequence, $at],
        );
    }

    public function retainedBytes(): int
    {
        $notes = $this->connection->fetchAllAssociative('SELECT * FROM plg_link_notes_notes');
        $revisions = $this->connection->fetchAllAssociative('SELECT * FROM plg_link_notes_revisions');
        $bytes = 0;
        foreach ([$notes, $revisions] as $rows) {
            foreach ($rows as $row) {
                $bytes += strlen(json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
            }
        }

        return $bytes;
    }

    private function revision(string $noteId, int $version, ?string $note, array $actor, string $at, string $change): void
    {
        $this->connection->insert('plg_link_notes_revisions', [
            'id' => Uuid::v7()->toRfc4122(),
            'note_id' => $noteId,
            'version' => $version,
            'note' => $note,
            'actor' => json_encode($actor, JSON_THROW_ON_ERROR),
            'recorded_at' => $at,
            'change_kind' => $change,
        ]);
    }

    private function view(array $row): array
    {
        $history = $this->connection->fetchAllAssociative(
            'SELECT version, note, actor, recorded_at, change_kind FROM plg_link_notes_revisions WHERE note_id=? ORDER BY version DESC LIMIT 1000',
            [$row['id']],
        );
        $history = array_map(static function (array $revision): array {
            return [
                'version' => (int) $revision['version'],
                'note' => $revision['note'],
                'actor' => json_decode((string) $revision['actor'], true, flags: JSON_THROW_ON_ERROR),
                'recorded_at' => $revision['recorded_at'],
                'change' => $revision['change_kind'],
            ];
        }, array_reverse($history));

        return [
            'id' => $row['id'],
            'version' => (int) $row['version'],
            'project_id' => $row['project_id'],
            'task_id' => $row['task_id'],
            'link_id' => $row['link_id'],
            'note' => $row['note'],
            'created_by' => json_decode((string) $row['created_by'], true, flags: JSON_THROW_ON_ERROR),
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'deleted_at' => $row['deleted_at'],
            'history' => $history,
            'allowed_actions' => [],
        ];
    }
}
