<?php

declare(strict_types=1);

namespace App\Automation\Domain;

/** Validates workflow shape and prevents ambiguous routing before it is versioned. */
final class WorkflowDefinitionPolicy
{
    private const FACT_RUN_SUCCEEDED = 1;

    private const FACT_REVIEW_REPORT_ACCEPTED = 2;

    private const FACT_HUMAN_APPROVAL_GRANTED = 4;

    private const ALLOWED_CONDITIONS = [
        'all_required_criteria_human_confirmed',
        'required_evidence_reported',
        'required_evidence_human_confirmed',
        'human_approval_granted',
        'review_report_accepted',
        'run_succeeded',
        'intake_ready',
        'no_human_attention',
    ];

    /** @param array<string, mixed> $definition */
    public function validate(array $definition): void
    {
        $stages = $definition['stages'] ?? [];
        $stageIds = [];
        foreach ($stages as $stage) {
            $stageId = (string) ($stage['id'] ?? '');
            if ('' === $stageId || isset($stageIds[$stageId])) {
                throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Phasen benötigen eindeutige IDs.');
            }
            $stageIds[$stageId] = true;
            foreach (($stage['entry_conditions'] ?? []) as $condition) {
                $this->validateCondition($condition);
            }
            foreach (($stage['run_completion_policy']['required_criterion_ids'] ?? []) as $criterionId) {
                if (!is_string($criterionId) || '' === $criterionId) {
                    throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Ein Phasenkriterium muss eine gültige Aufgabenreferenz besitzen.');
                }
            }
        }
        if ([] === $stageIds) {
            throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Ein Workflow benötigt mindestens eine Phase.');
        }

        $transitionKeys = [];
        foreach (($definition['transitions'] ?? []) as $transition) {
            $from = (string) ($transition['from_stage_id'] ?? '');
            $to = (string) ($transition['to_stage_id'] ?? '');
            $outcome = (string) ($transition['on'] ?? '');
            if (!isset($stageIds[$from], $stageIds[$to]) || ($from === $to && 'needs_changes' !== $outcome)) {
                throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Jeder Übergang muss auf vorhandene Phasen verweisen.');
            }
            $key = $from.'|'.$outcome;
            if (isset($transitionKeys[$key])) {
                throw new WorkflowDefinitionViolation('workflow_definition_ambiguous', 'Für dieselbe Phase und dasselbe Ergebnis gibt es mehrere mögliche Übergänge.');
            }
            $transitionKeys[$key] = true;
            foreach (($transition['conditions'] ?? []) as $condition) {
                $this->validateCondition($condition);
            }
        }

        $this->validateFutureStageDependencies($stages, $definition['transitions'] ?? []);

        $limits = $definition['limits'] ?? [];
        foreach (['max_repair_rounds', 'max_depth', 'max_parallel_runs', 'max_total_seconds'] as $limit) {
            $minimum = 'max_repair_rounds' === $limit ? 0 : 1;
            if (!isset($limits[$limit]) || !is_numeric($limits[$limit]) || (int) $limits[$limit] < $minimum) {
                throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Workflowgrenzen müssen vollständig angegeben sein; Reparaturrunden dürfen null sein.');
            }
        }
        if ((int) $limits['max_parallel_runs'] > 1) {
            throw new WorkflowDefinitionViolation('workflow_definition_invalid', 'Im aktuellen Umfang ist höchstens ein aktiver Auftrag je T3-Projektbindung erlaubt.');
        }
    }

    /** @param array<string, mixed> $condition */
    private function validateCondition(array $condition): void
    {
        $type = $condition['type'] ?? null;
        if (!is_string($type) || !in_array($type, self::ALLOWED_CONDITIONS, true)) {
            throw new WorkflowDefinitionViolation('workflow_condition_invalid', 'Der Workflow verwendet eine nicht registrierte Bedingung.');
        }
        if (str_starts_with($type, 'required_evidence_') && !isset($condition['evidence_kind'])) {
            throw new WorkflowDefinitionViolation('workflow_condition_invalid', 'Die Bedingung benötigt eine Art des gemeldeten Nachweises.');
        }
    }

    /**
     * @param list<array<string, mixed>> $stages
     * @param list<array<string, mixed>> $transitions
     */
    private function validateFutureStageDependencies(array $stages, array $transitions): void
    {
        /** @var array<string, array<string, mixed>> $stagesById */
        $stagesById = [];
        foreach ($stages as $stage) {
            $stagesById[(string) $stage['id']] = $stage;
        }

        /** @var array<string, list<array<string, mixed>>> $transitionsBySource */
        $transitionsBySource = [];
        foreach ($transitions as $transition) {
            $transitionsBySource[(string) $transition['from_stage_id']][] = $transition;
        }

        $firstStageId = (string) $stages[0]['id'];
        /** @var list<array{stage_id: string, facts: int}> $pending */
        $pending = [['stage_id' => $firstStageId, 'facts' => 0]];
        /** @var array<string, true> $visited */
        $visited = [];

        while ([] !== $pending) {
            $state = array_shift($pending);
            $stageId = $state['stage_id'];
            $facts = $state['facts'];
            $stateKey = $stageId.'|'.$facts;
            if (isset($visited[$stateKey])) {
                continue;
            }
            $visited[$stateKey] = true;
            $stage = $stagesById[$stageId];

            $this->assertTemporalConditionsAvailable(
                $stage['entry_conditions'] ?? [],
                $facts,
                sprintf('vor dem Start der Phase „%s“', $stageId),
            );

            foreach ($transitionsBySource[$stageId] ?? [] as $transition) {
                $outcome = (string) $transition['on'];
                $nextFacts = $facts;
                if ('accepted' === $outcome) {
                    $nextFacts |= self::FACT_RUN_SUCCEEDED | self::FACT_HUMAN_APPROVAL_GRANTED;
                    if ('review' === ($stage['kind'] ?? null)) {
                        $nextFacts |= self::FACT_REVIEW_REPORT_ACCEPTED;
                    }
                } elseif ('needs_changes' === $outcome || 'blocked' === $outcome) {
                    // These outcomes can carry a report that an owner may approve before resuming.
                    $nextFacts |= self::FACT_HUMAN_APPROVAL_GRANTED;
                }

                $this->assertTemporalConditionsAvailable(
                    $transition['conditions'] ?? [],
                    $nextFacts,
                    sprintf('am Übergang von „%s“ nach „%s“ (%s)', $stageId, (string) $transition['to_stage_id'], $outcome),
                );

                $pending[] = ['stage_id' => (string) $transition['to_stage_id'], 'facts' => $nextFacts];
            }
        }
    }

    /** @param list<array<string, mixed>> $conditions */
    private function assertTemporalConditionsAvailable(array $conditions, int $facts, string $context): void
    {
        foreach ($conditions as $condition) {
            $type = $condition['type'] ?? null;
            $requiredFact = match ($type) {
                'run_succeeded' => self::FACT_RUN_SUCCEEDED,
                'review_report_accepted' => self::FACT_REVIEW_REPORT_ACCEPTED,
                'human_approval_granted' => self::FACT_HUMAN_APPROVAL_GRANTED,
                default => 0,
            };
            if (0 !== $requiredFact && 0 === ($facts & $requiredFact)) {
                throw new WorkflowDefinitionViolation('workflow_condition_future_stage', sprintf('Die Bedingung „%s“ kann %s nur durch ein späteres Phasenergebnis erfüllt werden.', $type, $context));
            }
        }
    }
}
