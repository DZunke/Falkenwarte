import type { components } from '@/generated/api'

export type WorkflowGraphOutcome = components['schemas']['WorkflowTransition']['on']

export const workflowGraphOutcomeLabels: Record<WorkflowGraphOutcome, string> = {
  accepted: 'Angenommen',
  needs_changes: 'Änderungen nötig',
  blocked: 'Blockiert',
  failed: 'Fehlgeschlagen',
}

export const workflowGraphSelectionStatusLabels: Record<components['schemas']['TaskFlowCandidateTransition']['selection_status'], string> = {
  selected: 'Gewählt',
  possible: 'Möglich',
  not_selected: 'Nicht gewählt',
  unknown: 'Unbekannt',
}

export const workflowGraphPhaseStatusLabels: Record<components['schemas']['TaskFlowPhase']['status'], string> = {
  completed: 'Erledigt',
  current: 'Aktuell',
  open: 'Offen',
  blocked: 'Blockiert',
  skipped: 'Übersprungen',
  unknown: 'Unbekannt',
}
