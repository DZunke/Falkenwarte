const reasonLabels: Record<string, string> = {
  routing_ambiguous: 'Mehrere Arbeitsabläufe passen',
  classification_unavailable: 'Einordnung konnte nicht abgeschlossen werden',
  decision_refused: 'Die Entscheidung wurde zurückgewiesen',
  intake_escalated: 'Die Rückfrage braucht eine menschliche Klärung',
  approval_pending: 'Ergebnismeldung wartet auf Freigabe',
  run_permission_in_t3: 'T3 wartet auf eine Berechtigungsentscheidung',
  auth_required: 'T3-Zugang benötigt eine Klärung',
  reconciliation_required: 'Ein T3-Auftrag muss abgeglichen werden',
}

export function taskAttentionReasonLabel(reason: string): string {
  return reasonLabels[reason] ?? reason
}
