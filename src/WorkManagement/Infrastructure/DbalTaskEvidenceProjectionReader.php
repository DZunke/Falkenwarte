<?php

declare(strict_types=1);

namespace App\WorkManagement\Infrastructure;

use App\WorkManagement\Application\TaskEvidenceProjectionReader;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(TaskEvidenceProjectionReader::class)]
final readonly class DbalTaskEvidenceProjectionReader implements TaskEvidenceProjectionReader
{
    private const REVISION_PRESERVING_EVENTS = [
        'task.criterion_reviewed',
        'task.evidence_attached',
        'task.evidence_reported',
        'task.evidence_rejected',
        'task.moved',
    ];

    public function __construct(private Connection $connection)
    {
    }

    /**
     * @param list<array<string, mixed>> $tasks
     *
     * @return array<string, array{task: array<string, mixed>, evidence: list<array<string, mixed>>, reports: list<array{run: array<string, mixed>, report: array<string, mixed>}>, report_evidence_ids: list<string>}>
     */
    public function projectTasks(array $tasks): array
    {
        $tasksByProject = [];
        foreach ($tasks as $task) {
            if (!is_string($task['id'] ?? null) || !is_string($task['project_id'] ?? null)) {
                continue;
            }
            $tasksByProject[$task['project_id']][$task['id']] = $task;
        }

        $projections = [];
        foreach ($tasksByProject as $projectId => $projectTasks) {
            $taskIds = array_keys($projectTasks);
            $runs = $this->runsForTasks($taskIds, $projectId);
            if ([] === $runs) {
                $this->emptyTaskProjections($projectTasks, $projections);
                continue;
            }

            $reportsByRun = $this->reportsForRuns(array_column($runs, 'id'), $projectId);
            $reportEvidenceIdsByTask = [];
            foreach ($runs as $run) {
                foreach ($reportsByRun[$run['id']] ?? [] as $report) {
                    foreach ($report['evidence_ids'] ?? [] as $evidenceId) {
                        if (is_string($evidenceId)) {
                            $reportEvidenceIdsByTask[$run['task_id']][$evidenceId] = true;
                        }
                    }
                }
            }
            $currentReports = [];
            $evidenceIds = [];
            foreach ($runs as $run) {
                foreach ($this->currentAcceptedReports($run, $reportsByRun[$run['id']] ?? []) as $report) {
                    $currentReports[] = ['run' => $run, 'report' => $report];
                    foreach ($report['evidence_ids'] ?? [] as $evidenceId) {
                        if (is_string($evidenceId)) {
                            $evidenceIds[$evidenceId] = true;
                        }
                    }
                }
            }

            if ([] === $currentReports) {
                $this->emptyTaskProjections($projectTasks, $projections, $reportEvidenceIdsByTask);
                continue;
            }

            $evidenceById = [] === $evidenceIds ? [] : $this->evidenceByIds(array_keys($evidenceIds), $projectId);
            $reportEvidence = [];
            $revisionRanges = [];
            $linkTaskIds = [];
            foreach ($currentReports as $entry) {
                $run = $entry['run'];
                $task = $projectTasks[$run['task_id']];
                if (!$this->sameTaskDefinition($task, $run)) {
                    continue;
                }
                $snapshotRevision = (int) $run['snapshot']['task_revision'];
                if ($snapshotRevision < (int) $task['version']) {
                    $range = $revisionRanges[$task['id']] ?? null;
                    $revisionRanges[$task['id']] = [
                        'task_id' => $task['id'],
                        'from_version' => null === $range ? $snapshotRevision : min($range['from_version'], $snapshotRevision),
                        'through_version' => (int) $task['version'],
                    ];
                }
                foreach ($entry['report']['evidence_ids'] as $evidenceId) {
                    if (!is_string($evidenceId)) {
                        continue;
                    }
                    $evidence = $evidenceById[$evidenceId] ?? null;
                    if (null === $evidence || !$this->matchesReport($evidence, $run, $entry['report'], $task)) {
                        continue;
                    }
                    $reportEvidence[] = [
                        'task_id' => (string) $task['id'],
                        'task' => $task,
                        'run' => $run,
                        'evidence' => $evidence,
                    ];
                    if ([] !== ($evidence['link_ids'] ?? [])) {
                        $linkTaskIds[$task['id']] = true;
                    }
                }
            }

            $revisionsByTaskAndVersion = [] === $revisionRanges
                ? []
                : $this->taskRevisions(array_values($revisionRanges), $projectId);
            $linksById = [] === $linkTaskIds ? [] : $this->linksById(array_keys($linkTaskIds), $projectId);
            $reportsByTask = [];
            foreach ($currentReports as $entry) {
                $task = $projectTasks[$entry['run']['task_id']];
                if ($this->taskRevisionMatches($task, $entry['run'], $revisionsByTaskAndVersion)) {
                    $reportsByTask[$task['id']][] = $entry;
                }
            }
            $evidenceByTask = [];
            foreach ($reportEvidence as $entry) {
                if (!$this->taskRevisionMatches($entry['task'], $entry['run'], $revisionsByTaskAndVersion)) {
                    continue;
                }
                if (!$this->evidenceLinksMatch($entry['evidence'], $linksById)) {
                    continue;
                }
                $evidenceByTask[$entry['task_id']][$entry['evidence']['id']] = $entry['evidence'];
            }

            foreach ($projectTasks as $taskId => $task) {
                $evidence = array_values($evidenceByTask[$taskId] ?? []);
                $projections[$taskId] = [
                    'task' => $this->projectCriteria($task, $evidence),
                    'evidence' => $evidence,
                    'reports' => $reportsByTask[$taskId] ?? [],
                    'report_evidence_ids' => array_keys($reportEvidenceIdsByTask[$taskId] ?? []),
                ];
            }
        }

        return $projections;
    }

    /** @param list<string> $taskIds @return list<array<string, mixed>> */
    private function runsForTasks(array $taskIds, string $projectId): array
    {
        return $this->fetchRecords(<<<'SQL'
        SELECT run.data
        FROM json_each(:task_ids) AS selected_task
        CROSS JOIN records AS run
        WHERE run.type = 'runs'
          AND run.project_id = :project_id
          AND json_extract(run.data, '$.project_id') = :payload_project_id
          AND json_extract(run.data, '$.task_id') = selected_task.value
        ORDER BY run.seq ASC
        SQL, [
            'task_ids' => json_encode($taskIds, JSON_THROW_ON_ERROR),
            'project_id' => $projectId,
            'payload_project_id' => $projectId,
        ]);
    }

    /** @param list<string> $runIds @return array<string, list<array<string, mixed>>> */
    private function reportsForRuns(array $runIds, string $projectId): array
    {
        $reportsByRun = [];
        if ([] === $runIds) {
            return $reportsByRun;
        }
        foreach ($this->fetchRecords(<<<'SQL'
        SELECT report.data
        FROM json_each(:run_ids) AS selected_run
        CROSS JOIN records AS run
        CROSS JOIN records AS report
        WHERE run.type = 'runs'
          AND run.id = selected_run.value
          AND run.project_id = :project_id
          AND report.type = 'run_reports'
          AND json_extract(report.data, '$.run_id') = selected_run.value
          AND (json_extract(report.data, '$.project_id') IS NULL OR json_extract(report.data, '$.project_id') = run.project_id)
        ORDER BY report.seq ASC
        SQL, [
            'run_ids' => json_encode($runIds, JSON_THROW_ON_ERROR),
            'project_id' => $projectId,
        ]) as $report) {
            if (is_string($report['run_id'] ?? null)) {
                $reportsByRun[$report['run_id']][] = $report;
            }
        }

        return $reportsByRun;
    }

    /** @param list<string> $evidenceIds @return array<string, array<string, mixed>> */
    private function evidenceByIds(array $evidenceIds, string $projectId): array
    {
        if ([] === $evidenceIds) {
            return [];
        }

        $evidenceById = [];
        foreach ($this->fetchRecords(<<<'SQL'
        SELECT evidence.data
        FROM json_each(:evidence_ids) AS selected_evidence
        CROSS JOIN records AS evidence
        WHERE evidence.type = 'evidence'
          AND evidence.id = selected_evidence.value
          AND evidence.project_id = :project_id
        SQL, ['evidence_ids' => json_encode($evidenceIds, JSON_THROW_ON_ERROR), 'project_id' => $projectId]) as $evidence) {
            if (is_string($evidence['id'] ?? null)) {
                $evidenceById[$evidence['id']] = $evidence;
            }
        }

        return $evidenceById;
    }

    /** @param list<string> $taskIds @return array<string, array<string, mixed>> */
    private function linksById(array $taskIds, string $projectId): array
    {
        $linksById = [];
        foreach ($this->fetchRecords(<<<'SQL'
        SELECT collection.data
        FROM json_each(:task_ids) AS selected_task
        CROSS JOIN records AS collection
        WHERE collection.type = 'link_collections'
          AND collection.project_id = :project_id
          AND json_extract(collection.data, '$.project_id') = :payload_project_id
          AND json_extract(collection.data, '$.task_id') = selected_task.value
        ORDER BY collection.seq ASC
        SQL, [
            'task_ids' => json_encode($taskIds, JSON_THROW_ON_ERROR),
            'project_id' => $projectId,
            'payload_project_id' => $projectId,
        ]) as $collection) {
            foreach ($collection['links'] ?? [] as $link) {
                if (is_string($link['id'] ?? null)) {
                    $linksById[$link['id']] = $link;
                }
            }
        }

        return $linksById;
    }

    /** @param list<array{task_id: string, from_version: int, through_version: int}> $ranges @return array<string, array<int, array<string, mixed>>> */
    private function taskRevisions(array $ranges, string $projectId): array
    {
        $revisions = [];
        foreach ($this->fetchRecords(<<<'SQL'
        SELECT revision.data
        FROM revisions AS revision
        CROSS JOIN json_each(:ranges) AS selected_task
        WHERE revision.project_id = :project_id
          AND json_extract(revision.data, '$.resource.resource_type') = 'task'
          AND json_extract(revision.data, '$.resource.id') = json_extract(selected_task.value, '$.task_id')
          AND CAST(json_extract(revision.data, '$.resource.version') AS INTEGER) > CAST(json_extract(selected_task.value, '$.from_version') AS INTEGER)
          AND CAST(json_extract(revision.data, '$.resource.version') AS INTEGER) <= CAST(json_extract(selected_task.value, '$.through_version') AS INTEGER)
        ORDER BY revision.seq ASC
        SQL, ['ranges' => json_encode($ranges, JSON_THROW_ON_ERROR), 'project_id' => $projectId]) as $revision) {
            $resource = $revision['resource'] ?? [];
            if (is_string($resource['id'] ?? null) && is_int($resource['version'] ?? null)) {
                $revisions[$resource['id']][$resource['version']] = $revision;
            }
        }

        return $revisions;
    }

    /** @param array<string, mixed> $run @param list<array<string, mixed>> $reports @return list<array<string, mixed>> */
    private function currentAcceptedReports(array $run, array $reports): array
    {
        $reportsById = [];
        foreach ($reports as $report) {
            if (is_string($report['id'] ?? null)) {
                $reportsById[$report['id']] = $report;
            }
        }

        $taskRevision = (int) ($run['snapshot']['task_revision'] ?? 0);
        if ($taskRevision < 1) {
            return [];
        }
        $currentReports = [];
        foreach ($run['report_ids'] ?? [] as $reportId) {
            if (!is_string($reportId)) {
                continue;
            }
            $report = $reportsById[$reportId] ?? null;
            if (null === $report
                || ($report['run_id'] ?? null) !== ($run['id'] ?? null)
                || empty($report['accepted_for_reconciliation'])
                || (int) ($report['attempt_no'] ?? 0) !== (int) ($run['attempt_no'] ?? 0)
                || (int) ($report['task_revision'] ?? 0) !== $taskRevision) {
                continue;
            }
            $currentReports[$reportId] = $report;
        }

        return array_values($currentReports);
    }

    /** @param array<string, mixed> $evidence @param array<string, mixed> $run @param array<string, mixed> $report @param array<string, mixed> $task */
    private function matchesReport(array $evidence, array $run, array $report, array $task): bool
    {
        return ($evidence['task_id'] ?? null) === ($run['task_id'] ?? null)
            && ($evidence['project_id'] ?? null) === ($run['project_id'] ?? null)
            && ($evidence['run_id'] ?? null) === ($run['id'] ?? null)
            && (int) ($evidence['attempt_no'] ?? 0) === (int) ($report['attempt_no'] ?? 0)
            && (int) ($evidence['task_revision'] ?? 0) >= (int) ($report['task_revision'] ?? 0)
            && (int) ($evidence['task_revision'] ?? 0) <= (int) ($task['version'] ?? 0)
            && 'rejected' !== ($evidence['review_status'] ?? null);
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $run @param array<string, array<int, array<string, mixed>>> $revisionsByTaskAndVersion */
    private function taskRevisionMatches(array $task, array $run, array $revisionsByTaskAndVersion): bool
    {
        if (!$this->sameTaskDefinition($task, $run)) {
            return false;
        }

        $snapshotRevision = (int) ($run['snapshot']['task_revision'] ?? 0);
        $currentRevision = (int) ($task['version'] ?? 0);
        if ($snapshotRevision < 1 || $currentRevision < $snapshotRevision) {
            return false;
        }
        if ($snapshotRevision === $currentRevision) {
            return true;
        }

        $taskRevisions = $revisionsByTaskAndVersion[$task['id']] ?? [];
        for ($version = $snapshotRevision + 1; $version <= $currentRevision; ++$version) {
            $revision = $taskRevisions[$version] ?? null;
            if (null === $revision || !in_array($revision['summary'] ?? null, self::REVISION_PRESERVING_EVENTS, true)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, mixed> $task @param array<string, mixed> $run */
    private function sameTaskDefinition(array $task, array $run): bool
    {
        $snapshot = $run['snapshot'] ?? null;

        return is_array($snapshot)
            && is_string($snapshot['title'] ?? null)
            && is_string($snapshot['description'] ?? null)
            && is_array($snapshot['criteria'] ?? null)
            && $snapshot['title'] === ($task['title'] ?? null)
            && $snapshot['description'] === ($task['description'] ?? null)
            && $this->sameCriterionDefinitions($snapshot['criteria'], $task['criteria'] ?? []);
    }

    /** @param list<array<string, mixed>> $snapshotCriteria @param list<array<string, mixed>> $currentCriteria */
    private function sameCriterionDefinitions(array $snapshotCriteria, array $currentCriteria): bool
    {
        $snapshotDefinitions = $this->criterionDefinitions($snapshotCriteria);
        $currentDefinitions = $this->criterionDefinitions($currentCriteria);

        return null !== $snapshotDefinitions && null !== $currentDefinitions && $snapshotDefinitions === $currentDefinitions;
    }

    /** @param list<array<string, mixed>> $criteria @return list<array{id: string, text: string, is_required: bool}>|null */
    private function criterionDefinitions(array $criteria): ?array
    {
        $definitions = [];
        foreach ($criteria as $criterion) {
            if (!is_string($criterion['id'] ?? null)
                || !is_string($criterion['text'] ?? null)
                || !is_bool($criterion['is_required'] ?? null)) {
                return null;
            }
            $definitions[] = [
                'id' => $criterion['id'],
                'text' => $criterion['text'],
                'is_required' => $criterion['is_required'],
            ];
        }

        return $definitions;
    }

    /** @param array<string, mixed> $evidence @param array<string, array<string, mixed>> $linksById */
    private function evidenceLinksMatch(array $evidence, array $linksById): bool
    {
        $linkIds = $evidence['link_ids'] ?? [];
        if (!is_array($linkIds)) {
            return false;
        }
        if ([] === $linkIds) {
            return [] === ($evidence['link_snapshot'] ?? []);
        }

        $current = [];
        foreach ($linkIds as $linkId) {
            if (!is_string($linkId) || !isset($linksById[$linkId])) {
                return false;
            }
            $current[] = $linksById[$linkId];
        }

        return $current === ($evidence['link_snapshot'] ?? null);
    }

    /** @param array<string, mixed> $task @param list<array<string, mixed>> $evidence @return array<string, mixed> */
    private function projectCriteria(array $task, array $evidence): array
    {
        $criterionIndex = [];
        foreach ($task['criteria'] ?? [] as $index => $criterion) {
            if (is_string($criterion['id'] ?? null)) {
                $criterionIndex[$criterion['id']] = $index;
            }
        }

        $evidenceByCriterion = [];
        foreach ($evidence as $item) {
            foreach ($item['criterion_ids'] ?? [] as $criterionId) {
                if (is_string($criterionId) && isset($criterionIndex[$criterionId]) && is_string($item['id'] ?? null)) {
                    $evidenceByCriterion[$criterionId][] = $item['id'];
                }
            }
        }

        foreach ($evidenceByCriterion as $criterionId => $evidenceIds) {
            $index = $criterionIndex[$criterionId];
            $criterion = $task['criteria'][$index];
            if (in_array($criterion['state'] ?? null, ['pending', 'reported'], true)) {
                $criterion['evidence_ids'] = array_values(array_unique(array_merge($criterion['evidence_ids'] ?? [], $evidenceIds)));
                $criterion['state'] = 'reported';
            }
            $task['criteria'][$index] = $criterion;
        }

        return $task;
    }

    /**
     * @param array<string, array<string, mixed>>                                                                                                                                                                      $tasks
     * @param array<string, array{task: array<string, mixed>, evidence: list<array<string, mixed>>, reports: list<array{run: array<string, mixed>, report: array<string, mixed>}>, report_evidence_ids: list<string>}> $projections
     * @param array<string, array<string, bool>>                                                                                                                                                                       $reportEvidenceIdsByTask
     */
    private function emptyTaskProjections(array $tasks, array &$projections, array $reportEvidenceIdsByTask = []): void
    {
        foreach ($tasks as $taskId => $task) {
            $projections[$taskId] = [
                'task' => $task,
                'evidence' => [],
                'reports' => [],
                'report_evidence_ids' => array_keys($reportEvidenceIdsByTask[$taskId] ?? []),
            ];
        }
    }

    /** @param array<string, mixed> $parameters @return list<array<string, mixed>> */
    private function fetchRecords(string $sql, array $parameters): array
    {
        return array_map(static function (mixed $data): array {
            $record = json_decode((string) $data, true, flags: JSON_THROW_ON_ERROR);
            if (!is_array($record)) {
                throw new \UnexpectedValueException('A projection record must contain a JSON object.');
            }

            return $record;
        }, $this->connection->fetchFirstColumn($sql, $parameters));
    }
}
