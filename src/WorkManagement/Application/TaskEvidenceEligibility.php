<?php

declare(strict_types=1);

namespace App\WorkManagement\Application;

interface TaskEvidenceEligibility
{
    /**
     * @param array<string, mixed>                                                             $evidence
     * @param array<string, mixed>                                                             $task
     * @param array{evidence?: list<array<string, mixed>>, report_evidence_ids?: list<string>} $projection
     */
    public function isCurrent(array $evidence, array $task, array $projection): bool;
}
