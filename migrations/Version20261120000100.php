<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261120000100 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Indizes für taskbezogene Runs, Instanzen, Reports und Approvals';
    }

    public function up(Schema $schema): void
    {
        $this->addSql("CREATE INDEX records_runs_task ON records(project_id, json_extract(data, '$.task_id'), seq) WHERE type = 'runs'");
        $this->addSql("CREATE INDEX records_workflow_instances_task ON records(project_id, json_extract(data, '$.task_id'), seq) WHERE type = 'workflow_instances'");
        $this->addSql("CREATE INDEX records_run_reports_run ON records(json_extract(data, '$.run_id'), seq) WHERE type = 'run_reports'");
        $this->addSql("CREATE INDEX records_approvals_project_run ON records(project_id, json_extract(data, '$.run_id'), seq) WHERE type = 'approvals'");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX records_approvals_project_run');
        $this->addSql('DROP INDEX records_run_reports_run');
        $this->addSql('DROP INDEX records_workflow_instances_task');
        $this->addSql('DROP INDEX records_runs_task');
    }
}
