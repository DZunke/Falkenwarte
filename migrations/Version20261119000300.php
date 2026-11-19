<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261119000300 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Fortlaufende Triggerabfragen nach Projekt, Ereignistyp und Journalposition';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("CREATE INDEX workflow_trigger_events ON events(project_id, json_extract(data,'$.event_type'), seq)");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX workflow_trigger_events');
    }
}
