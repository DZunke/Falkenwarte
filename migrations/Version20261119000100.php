<?php
declare(strict_types=1);
namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261119000100 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Versionierte Aggregate, Revisionen, Outbox, Commands, Inbox und getrennte Zugangsdaten';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE records (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(type,id))');
        $this->addSql('CREATE INDEX records_project ON records(type,project_id,seq)');
        $this->addSql('CREATE TABLE revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_id TEXT, data TEXT NOT NULL)');
        $this->addSql('CREATE INDEX revisions_project ON revisions(project_id,seq)');
        $this->addSql('CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE, project_id TEXT, data TEXT NOT NULL, change_json TEXT, published INTEGER NOT NULL DEFAULT 0)');
        $this->addSql('CREATE INDEX outbox_pending ON events(published,seq)');
        $this->addSql('CREATE TABLE commands (id TEXT PRIMARY KEY, kind TEXT NOT NULL, action_id TEXT NOT NULL, payload TEXT NOT NULL, dispatched INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, error TEXT)');
        $this->addSql('CREATE INDEX commands_due ON commands(dispatched,due_at)');
        $this->addSql('CREATE TABLE inbox (command_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL)');
        $this->addSql('CREATE TABLE dedup (principal TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(principal,key))');
        $this->addSql('CREATE TABLE sessions (hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL)');
        $this->addSql('CREATE TABLE login_attempts (address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_ts INTEGER NOT NULL)');
        $this->addSql('CREATE TABLE secrets (ref TEXT PRIMARY KEY, value TEXT NOT NULL)');
        $this->addSql('CREATE TABLE mcp_sessions (hash TEXT PRIMARY KEY, principal TEXT NOT NULL, protocol TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL)');
        $this->addSql('CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        $this->addSql("INSERT INTO runtime_state VALUES ('write_lock','0')");
        $this->addSql('CREATE TABLE messenger_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, body CLOB NOT NULL, headers CLOB NOT NULL, queue_name VARCHAR(190) NOT NULL, created_at DATETIME NOT NULL, available_at DATETIME NOT NULL, delivered_at DATETIME DEFAULT NULL)');
        $this->addSql('CREATE INDEX messenger_queue ON messenger_messages(queue_name,available_at,delivered_at,id)');
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
