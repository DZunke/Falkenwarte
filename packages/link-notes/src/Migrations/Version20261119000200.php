<?php

declare(strict_types=1);

namespace Falkenwarte\LinkNotes\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261119000200 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create plugin-owned link note history, link projection, and subscriber inbox tables.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE plg_link_notes_notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, link_id TEXT NOT NULL, note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 2000), created_by TEXT NOT NULL CHECK(json_valid(created_by)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT NULL, version INTEGER NOT NULL CHECK(version >= 1))');
        $this->addSql('CREATE INDEX plg_link_notes_task ON plg_link_notes_notes(project_id, task_id, created_at, id)');
        $this->addSql('CREATE INDEX plg_link_notes_link ON plg_link_notes_notes(task_id, link_id)');
        $this->addSql('CREATE TABLE plg_link_notes_revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, note_id TEXT NOT NULL, version INTEGER NOT NULL, note TEXT NULL, actor TEXT NOT NULL CHECK(json_valid(actor)), recorded_at TEXT NOT NULL, change_kind TEXT NOT NULL CHECK(change_kind IN (\'created\', \'updated\', \'removed\')), UNIQUE(note_id, version))');
        $this->addSql('CREATE INDEX plg_link_notes_revisions_note ON plg_link_notes_revisions(note_id, version)');
        $this->addSql('CREATE TABLE plg_link_notes_link_projection (task_id TEXT NOT NULL, project_id TEXT NOT NULL, link_id TEXT NOT NULL, collection_id TEXT NOT NULL, registered_at TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(task_id, link_id))');
        $this->addSql('CREATE INDEX plg_link_notes_projection_project ON plg_link_notes_link_projection(project_id, task_id)');
        $this->addSql('CREATE TABLE plg_link_notes_inbox (event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, consumed_at TEXT NOT NULL)');
        $this->addSql('CREATE TABLE plg_link_notes_event_cursor (consumer TEXT PRIMARY KEY, sequence INTEGER NOT NULL)');
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
