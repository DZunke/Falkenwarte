<?php

declare(strict_types=1);

namespace App\WorkManagement\Infrastructure;

use App\Shared\Application\Store;
use App\WorkManagement\Application\TaskEvidenceEligibility;
use Symfony\Component\DependencyInjection\Attribute\AsAlias;

#[AsAlias(TaskEvidenceEligibility::class)]
final readonly class StoredTaskEvidenceEligibility implements TaskEvidenceEligibility
{
    public function __construct(private Store $store)
    {
    }

    /**
     * @param array<string, mixed>                                                             $evidence
     * @param array<string, mixed>                                                             $task
     * @param array{evidence?: list<array<string, mixed>>, report_evidence_ids?: list<string>} $projection
     */
    public function isCurrent(array $evidence, array $task, array $projection): bool
    {
        if (($evidence['task_id'] ?? null) !== ($task['id'] ?? null)
            || ($evidence['project_id'] ?? null) !== ($task['project_id'] ?? null)) {
            return false;
        }

        $evidenceId = $evidence['id'] ?? null;
        if (is_string($evidenceId) && in_array($evidenceId, array_column($projection['evidence'] ?? [], 'id'), true)) {
            return true;
        }
        if (is_string($evidenceId) && in_array($evidenceId, $projection['report_evidence_ids'] ?? [], true)) {
            return false;
        }
        if ((int) ($evidence['task_revision'] ?? 0) !== (int) ($task['version'] ?? 0)) {
            return false;
        }

        $runId = $evidence['run_id'] ?? null;
        if (null === $runId) {
            return true;
        }
        if (!is_string($runId) || !isset($evidence['attempt_no'])) {
            return false;
        }
        $run = $this->store->find('runs', $runId);

        return null !== $run
            && ($run['task_id'] ?? null) === $task['id']
            && ($run['project_id'] ?? null) === $task['project_id']
            && (int) ($run['attempt_no'] ?? 0) === (int) $evidence['attempt_no'];
    }
}
