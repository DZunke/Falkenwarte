<?php

declare(strict_types=1);

namespace App\Orchestration\Infrastructure;

use App\Orchestration\Application\TaskFlowReader;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(TaskFlowReader::class)]
final readonly class DbalTaskFlowReader implements TaskFlowReader
{
    public function __construct(private Connection $connection)
    {
    }

    public function instances(string $taskId, string $projectId): array
    {
        return $this->fetchRecords(<<<'SQL'
        SELECT data
        FROM records
        WHERE type = 'workflow_instances'
          AND project_id = :project_id
          AND json_extract(data, '$.project_id') = :payload_project_id
          AND json_extract(data, '$.task_id') = :task_id
        ORDER BY seq ASC
        SQL, ['project_id' => $projectId, 'payload_project_id' => $projectId, 'task_id' => $taskId]);
    }

    public function runs(string $taskId, string $projectId): array
    {
        return $this->fetchRecords(<<<'SQL'
        SELECT data
        FROM records
        WHERE type = 'runs'
          AND project_id = :project_id
          AND json_extract(data, '$.project_id') = :payload_project_id
          AND json_extract(data, '$.task_id') = :task_id
        ORDER BY seq ASC
        SQL, ['project_id' => $projectId, 'payload_project_id' => $projectId, 'task_id' => $taskId]);
    }

    public function reports(array $runIds, string $projectId): array
    {
        $runIds = $this->normalizeRunIds($runIds);
        if ([] === $runIds) {
            return [];
        }

        return $this->fetchRecords(<<<'SQL'
        SELECT report.data
        FROM json_each(:run_ids) AS selected_run
        INNER JOIN records AS run
            ON run.type = 'runs'
           AND run.id = selected_run.value
           AND run.project_id = :project_id
        INNER JOIN records AS report
            ON report.type = 'run_reports'
           AND json_extract(report.data, '$.run_id') = run.id
           AND (json_extract(report.data, '$.project_id') IS NULL OR json_extract(report.data, '$.project_id') = run.project_id)
        ORDER BY report.seq ASC
        SQL, ['run_ids' => json_encode($runIds, JSON_THROW_ON_ERROR), 'project_id' => $projectId]);
    }

    public function approvals(array $runIds, string $projectId): array
    {
        $runIds = $this->normalizeRunIds($runIds);
        if ([] === $runIds) {
            return [];
        }

        return $this->fetchRecords(<<<'SQL'
        SELECT approval.data
        FROM json_each(:run_ids) AS selected_run
        INNER JOIN records AS run
            ON run.type = 'runs'
           AND run.id = selected_run.value
           AND run.project_id = :project_id
        INNER JOIN records AS approval
            ON approval.type = 'approvals'
           AND approval.project_id = :project_id
           AND json_extract(approval.data, '$.project_id') = run.project_id
           AND json_extract(approval.data, '$.run_id') = run.id
        ORDER BY approval.seq ASC
        SQL, ['run_ids' => json_encode($runIds, JSON_THROW_ON_ERROR), 'project_id' => $projectId]);
    }

    /** @param list<string> $runIds @return list<string> */
    private function normalizeRunIds(array $runIds): array
    {
        return array_values(array_unique(array_filter($runIds, static fn (string $runId): bool => '' !== $runId)));
    }

    /** @param array<string, scalar> $parameters @return list<array<string, mixed>> */
    private function fetchRecords(string $sql, array $parameters): array
    {
        $rows = $this->connection->fetchFirstColumn($sql, $parameters);

        return array_map(static function (mixed $data): array {
            $record = json_decode((string) $data, true, flags: JSON_THROW_ON_ERROR);
            if (!is_array($record)) {
                throw new \UnexpectedValueException('A TaskFlow record must contain a JSON object.');
            }

            return $record;
        }, $rows);
    }
}
