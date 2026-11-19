<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes\Application;

interface LinkNoteRepository
{
    /** @return list<array<string, mixed>> */
    public function forTask(string $projectId, string $taskId): array;

    /** @return array<string, mixed>|null */
    public function find(string $noteId): ?array;

    /** @param array<string, mixed> $actor @return array<string, mixed> */
    public function create(string $id, string $projectId, string $taskId, string $linkId, string $note, array $actor, string $at): array;

    /** @param array<string, mixed> $actor @return array<string, mixed> */
    public function update(string $noteId, string $note, array $actor, string $at): array;

    /** @param array<string, mixed> $actor @return array<string, mixed> */
    public function remove(string $noteId, array $actor, string $at): array;

    /** @param array<string, mixed> $collection */
    public function projectRegisteredLinks(array $collection, string $eventId, string $at): void;

    public function cursor(string $consumer): int;

    public function setCursor(string $consumer, int $sequence): void;

    public function markConsumed(string $eventId, int $sequence, string $at): bool;

    public function retainedBytes(): int;
}
