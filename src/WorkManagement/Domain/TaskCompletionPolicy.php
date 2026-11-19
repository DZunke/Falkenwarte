<?php

declare(strict_types=1);

namespace App\WorkManagement\Domain;

use App\Shared\Domain\Problem;

final class TaskCompletionPolicy
{
    /** @param array<string, mixed> $policy @param array<string, mixed> $task @param list<array<string, mixed>> $evidence @param list<array<string, mixed>> $approvals @param list<array<string, mixed>> $runs @param list<string> $currentEvidenceIds */
    public function assertSatisfied(array $policy, array $task, array $evidence, array $approvals, array $runs, array $currentEvidenceIds): void
    {
        foreach ($runs as $run) {
            if ($run['task_id'] === $task['id'] && in_array($run['state'], ['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested'], true)) {
                throw new Problem(409, 'completion_policy_unsatisfied', 'Ein laufender oder ungeklärter Agentauftrag verhindert den Ticketabschluss.');
            }
        }

        if (!empty($policy['require_human_confirmed_criteria'])) {
            foreach ($task['criteria'] as $criterion) {
                if ($criterion['is_required'] && 'human_confirmed' !== $criterion['state']) {
                    throw new Problem(409, 'completion_policy_unsatisfied', 'Alle erforderlichen Kriterien benötigen eine menschliche Bestätigung.');
                }
            }
        }

        $valid = array_fill_keys($currentEvidenceIds, true);
        foreach ($policy['required_evidence_kinds'] ?? [] as $requiredKind) {
            $found = false;
            foreach ($evidence as $item) {
                if ($item['task_id'] === $task['id'] && $item['kind'] === $requiredKind && 'human_confirmed' === $item['review_status'] && isset($valid[$item['id']])) {
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                throw new Problem(409, 'completion_policy_unsatisfied', 'Ein erforderlicher und menschlich bestätigter Nachweistyp fehlt.');
            }
        }

        if (!empty($policy['require_human_approval'])) {
            $approved = array_filter($approvals, static fn (array $approval): bool => ($approval['task_id'] ?? null) === $task['id'] && 'approved' === $approval['status']);
            if ([] === $approved) {
                throw new Problem(409, 'completion_policy_unsatisfied', 'Für den Abschluss ist eine offene menschliche Entscheidung erforderlich.');
            }
        }

        if (!empty($policy['require_review'])) {
            foreach ($evidence as $item) {
                if ($item['task_id'] === $task['id'] && 'human_confirmed' === $item['review_status'] && isset($valid[$item['id']])) {
                    return;
                }
            }
            throw new Problem(409, 'completion_policy_unsatisfied', 'Für den Abschluss fehlt eine menschlich bestätigte Reviewmeldung.');
        }
    }
}
