<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

interface TaskEvidenceProjectionReader
{
    /**
     * Project current accepted run evidence without mutating tasks or report records.
     *
     * @param list<array<string, mixed>> $tasks
     *
     * @return array<string, array{task: array<string, mixed>, evidence: list<array<string, mixed>>, reports: list<array{run: array<string, mixed>, report: array<string, mixed>}>, report_evidence_ids: list<string>}>
     */
    public function projectTasks(array $tasks): array;
}
