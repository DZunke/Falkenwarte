<?php

declare(strict_types=1);

namespace App\Orchestration\Domain;

/** Applies the frozen phase policy to T3 observation, report, evidence and owner decisions. */
final class RunCompletionEvaluator
{
    /**
     * @param array<string, mixed>       $policy
     * @param array<string, mixed>|null  $report
     * @param list<array<string, mixed>> $evidence
     * @param list<array<string, mixed>> $approvals
     * @param list<array<string, mixed>> $criteria
     */
    public function evaluate(
        array $policy,
        bool $externalSettled,
        ?array $report,
        array $evidence,
        array $approvals,
        array $criteria,
        string $runId,
        int $attemptNo,
        int $taskRevision,
        ?string $resultDigest,
    ): RunCompletionDecision {
        if (!empty($policy['require_external_settled']) && !$externalSettled) {
            return RunCompletionDecision::pending('external_pending', 'Der externe T3-Lauf ist noch nicht abgeschlossen.');
        }
        if (null === $report) {
            return RunCompletionDecision::pending('report_pending', 'T3 hat den Lauf beendet, aber es liegt noch keine passende Agentmeldung vor.');
        }
        if (empty($report['accepted_for_reconciliation']) || ($report['outcome'] ?? null) !== 'reported_success') {
            $reason = !empty($report['accepted_for_reconciliation'])
                ? 'Die Agentmeldung verlangt Änderungen oder meldet einen Fehler.'
                : 'Die Ergebnismeldung ist überholt.';

            return RunCompletionDecision::failed($reason);
        }

        foreach (($policy['required_evidence_kinds'] ?? []) as $kind) {
            if (!array_filter($evidence, static fn (array $item): bool => ($item['kind'] ?? null) === $kind && ($item['review_status'] ?? null) !== 'rejected')) {
                return RunCompletionDecision::pending('evidence_pending', sprintf('Für diese Phase fehlt ein erforderlicher gemeldeter Nachweis (%s).', (string) $kind), 'phase_evidence_pending');
            }
        }

        if (!empty($policy['require_human_confirmed_evidence'])) {
            $reviewableEvidence = array_values(array_filter($evidence, static fn (array $item): bool => ($item['review_status'] ?? null) !== 'rejected'));
            if ([] === $reviewableEvidence || array_filter($reviewableEvidence, static fn (array $item): bool => ($item['review_status'] ?? null) !== 'human_confirmed')) {
                return RunCompletionDecision::pending('evidence_review_pending', 'Die Phasenpolicy verlangt eine menschliche Bestätigung gemeldeter Nachweise.', 'phase_review_pending');
            }
        }

        if (!empty($policy['require_human_phase_decision'])) {
            $approved = null !== $resultDigest && (bool) array_filter($approvals, static fn (array $approval): bool => ($approval['run_id'] ?? null) === $runId
                && (int) ($approval['attempt_no'] ?? 0) === $attemptNo
                && (int) ($approval['task_revision'] ?? 0) === $taskRevision
                && ($approval['status'] ?? null) === 'approved'
                && is_string($approval['result_digest'] ?? null)
                && hash_equals($resultDigest, $approval['result_digest']));
            if (!$approved) {
                return RunCompletionDecision::pending('approval_pending', 'Die aktuelle Phasenpolicy verlangt eine Eigentümerentscheidung über diesen Ergebnisstand.', 'approval_pending');
            }
        }

        foreach (($policy['required_criterion_ids'] ?? []) as $criterionId) {
            $criterion = null;
            foreach ($criteria as $candidate) {
                if (($candidate['id'] ?? null) === $criterionId) {
                    $criterion = $candidate;
                    break;
                }
            }
            if (null === $criterion || ($criterion['review_status'] ?? null) !== 'human_confirmed') {
                return RunCompletionDecision::pending('criteria_pending', 'Die Phasenpolicy verlangt die menschliche Bestätigung ausgewählter Akzeptanzkriterien.', 'phase_criteria_pending');
            }
        }

        return RunCompletionDecision::succeeded();
    }
}
