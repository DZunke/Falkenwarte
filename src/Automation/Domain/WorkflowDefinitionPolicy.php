<?php

declare(strict_types=1);

namespace App\Automation\Domain;

/** Validates workflow shape and prevents ambiguous routing before it is versioned. */
final class WorkflowDefinitionPolicy
{
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
}
