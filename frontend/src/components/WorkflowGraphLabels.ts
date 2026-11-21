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

export const workflowGraphRunStateLabels: Record<components['schemas']['RunState'], string> = {
  queued: 'Wartet auf Start',
  dispatching: 'Start wird übertragen',
  running: 'Läuft',
  waiting_input: 'Wartet auf Antwort',
  auth_blocked: 'Anmeldung erforderlich',
  reconciling: 'Status wird abgeglichen',
  cancel_requested: 'Abbruch angefragt',
  result_reported: 'Ergebnis gemeldet',
  verifying: 'Abschluss wird geprüft',
  succeeded: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  abandoned: 'Beendet',
}

export const workflowGraphReportOutcomeLabels: Record<components['schemas']['TaskFlowReport']['outcome'], string> = {
  reported_success: 'Erfolg gemeldet',
  needs_changes: 'Änderungen nötig',
  blocked: 'Blockiert',
  failed: 'Fehlgeschlagen',
}

export function workflowGraphDisplayName(value: string | null | undefined, labels: Record<string, string>): string {
  return value ? labels[value] ?? value.replaceAll('_', ' ') : 'Nicht angegeben'
}
