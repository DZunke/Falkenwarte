import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, FileCheck2, GitBranch, ListChecks, RotateCw } from 'lucide-react'
import type { components } from '@/generated/api'
import { api, request, type Task, type TaskStatus } from '@/lib/api'
import { fetchAllPages } from '@/lib/queries'
import { WorkflowGraph, type WorkflowGraphSelection } from '@/components/WorkflowGraph'
import type { WorkflowBoardColumnOption, WorkflowStageEditorProfile } from '@/components/WorkflowStagesEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type TaskFlowCondition = components['schemas']['WorkflowCondition']
type TaskFlowCandidateTransition = components['schemas']['TaskFlowCandidateTransition']
type TaskFlowSelectedTransition = components['schemas']['TaskFlowSelectedTransition']
type TaskFlowPhase = components['schemas']['TaskFlowPhase']
type TaskFlowWorkflowItem = components['schemas']['TaskFlowWorkflowInstance']
type TaskFlowItem = components['schemas']['TaskFlowItem']
type TaskFlowRun = components['schemas']['TaskFlowRun']
type TaskFlowReport = components['schemas']['TaskFlowReport']
type TaskFlowHandoff = components['schemas']['TaskFlowHandoff']
type TaskFlowActorRef = components['schemas']['actor']
type TaskFlowBoard = components['schemas']['Board']
type TaskFlowGraphFocus =
  | { type: 'phase'; phaseId: string }
  | { type: 'run'; runId: string }
  | { type: 'transition'; index: number; runId: string; reportId: string | null }
  | null
export type TaskFlowPage = components['schemas']['TaskFlowPage']

const categoryLabels: Record<string, string> = {
  backlog: 'Backlog', ready: 'Bereit', active: 'In Arbeit', review: 'Review', done: 'Erledigt', cancelled: 'Abgebrochen',
}

const criterionStates: Record<string, string> = {
  human_confirmed: 'Bestätigt', reported: 'Meldung liegt vor', rejected: 'Zurückgewiesen',
}

const phaseStates: Record<TaskFlowPhase['status'], string> = {
  completed: 'Erledigt', current: 'Aktuell', open: 'Offen', blocked: 'Blockiert', skipped: 'Übersprungen', unknown: 'Status unbekannt',
}

const workflowStates: Record<string, string> = {
  queued: 'Start steht aus', running: 'Läuft', paused: 'Pausiert', succeeded: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen',
}

const runStates: Record<string, string> = {
  queued: 'Wartet auf Start', dispatching: 'Start wird übertragen', running: 'Läuft', waiting_input: 'Wartet auf Antwort',
  auth_blocked: 'Anmeldung erforderlich', reconciling: 'Status wird abgeglichen', cancel_requested: 'Abbruch angefragt',
  result_reported: 'Ergebnis gemeldet', verifying: 'Abschluss wird geprüft', succeeded: 'Abgeschlossen', failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen', abandoned: 'Beendet',
}

const outcomes: Record<string, string> = {
  reported_success: 'Erfolg gemeldet', needs_changes: 'Änderungen nötig', blocked: 'Blockiert', failed: 'Fehlgeschlagen', accepted: 'Angenommen',
}

const approvalStates: Record<string, string> = {
  pending: 'Offen', approved: 'Freigegeben', rejected: 'Abgelehnt', cancelled: 'Zurückgezogen', invalidated: 'Nicht mehr gültig',
}

const transitionSelectionStates: Record<TaskFlowCandidateTransition['selection_status'], string> = {
  selected: 'Ausgewählt', possible: 'Möglich', not_selected: 'Nicht ausgewählt', unknown: 'Auswahl nicht belegt',
}

const stageKinds: Record<string, string> = {
  implementation: 'Bearbeitung', review: 'Prüfung', research: 'Recherche', manual: 'Manuelle Phase',
}

function dateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function displayName(value: string | null | undefined, labels: Record<string, string>): string {
  return value ? labels[value] ?? value.replaceAll('_', ' ') : 'Nicht angegeben'
}

function actorName(actor: TaskFlowActorRef | string | null): string | null {
  if (null === actor) return null
  if ('string' === typeof actor) return actor
  if (actor.display_name) return actor.display_name
  const role = actor.kind === 'owner' ? 'Projektverantwortliche Person' : actor.kind === 'agent' ? 'Rollenprofil' : actor.kind === 'system' ? 'System' : 'Integration'
  return actor.id ? `${role} · ${actor.id}` : role
}

function profileName(id: string, profileNames: Map<string, string>): string {
  // Keep the stored profile ID visible when its current display name cannot be loaded.
  return profileNames.get(id) ?? `Rollenprofil (${id})`
}

function taskFlowBoardColumns(boards: readonly TaskFlowBoard[] | undefined, statuses: readonly TaskStatus[]): WorkflowBoardColumnOption[] | undefined {
  if (!boards) return undefined
  const statusById = new Map(statuses.map((status) => [status.id, status]))

  return boards.flatMap((board) => board.columns.map((column) => {
    const status = column.default_drop_status_id ? statusById.get(column.default_drop_status_id) : undefined

    return {
      boardId: board.id,
      boardName: board.name,
      boardArchived: board.archived,
      columnId: column.id,
      columnName: column.name,
      defaultDropStatusId: column.default_drop_status_id,
      defaultDropStatusCategory: status?.category ?? null,
    }
  }))
}

function conditionText(condition: TaskFlowCondition): string {
  const evidenceLabels: Record<string, string> = { test_report: 'Testbericht', document: 'Dokument', review: 'Prüfvermerk', note: 'Notiz' }
  const evidenceKind = condition.evidence_kind ? ` (${evidenceLabels[condition.evidence_kind] ?? condition.evidence_kind.replaceAll('_', ' ')})` : ''
  const labels: Record<string, string> = {
    all_required_criteria_human_confirmed: 'Alle erforderlichen Erfolgskriterien bestätigt',
    required_evidence_reported: `Erforderliche Meldung liegt vor${evidenceKind}`,
    required_evidence_human_confirmed: `Meldung fachlich bestätigt${evidenceKind}`,
    intake_ready: 'Eingangsklärung abgeschlossen',
    no_human_attention: 'Keine offene menschliche Entscheidung',
    run_succeeded: 'Vorherige Phase erfolgreich',
    review_report_accepted: 'Prüfbericht angenommen',
    human_approval_granted: 'Menschliche Freigabe erteilt',
  }
  return labels[condition.type] ?? 'Zusätzliche Workflowbedingung'
}

function completionPolicyText(policy: Record<string, unknown>, criteria: Task['criteria']): string[] {
  const messages: string[] = []
  if (policy.require_external_settled === true) messages.push('Der externe Lauf muss beendet sein')
  if (policy.require_human_phase_decision === true) messages.push('Eine menschliche Phasenentscheidung ist erforderlich')
  if (policy.require_human_confirmed_evidence === true) messages.push('Die gemeldeten Belege müssen fachlich bestätigt sein')
  if (Array.isArray(policy.required_evidence_kinds)) {
    for (const kind of policy.required_evidence_kinds) {
      if (typeof kind === 'string') {
        const evidenceLabels: Record<string, string> = { test_report: 'Testbericht', document: 'Dokument', review: 'Prüfvermerk', note: 'Notiz' }
        messages.push(`Meldung der Art „${evidenceLabels[kind] ?? kind.replaceAll('_', ' ')}“ ist erforderlich`)
      }
    }
  }
  if (Array.isArray(policy.required_criterion_ids) && policy.required_criterion_ids.length > 0) {
    const requiredCriteria = policy.required_criterion_ids.map((id) => {
      if (typeof id !== 'string') return 'Erfolgskriterium'
      return criteria.find((criterion) => criterion.id === id)?.text ?? 'Erfolgskriterium'
    })
    messages.push(`Diese Erfolgskriterien müssen erfüllt sein: ${requiredCriteria.join(', ')}`)
  }
  return messages
}

function safeWebUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function TextBlock({ label, children }: { label: string; children: string | null | undefined }) {
  if (!children?.trim()) return null
  return <div className="min-w-0 space-y-1">
    <h6 className="text-xs font-medium text-muted-foreground">{label}</h6>
    <p className="whitespace-pre-wrap break-words text-sm">{children}</p>
  </div>
}

function HandoffDetails({ handoff, profileNames, reports, onOpenDetails, expanded = false }: { handoff: TaskFlowHandoff; profileNames: Map<string, string>; reports: Map<string, TaskFlowReport>; onOpenDetails: () => void; expanded?: boolean }) {
  const sourceReport = handoff.source_report_id ? reports.get(handoff.source_report_id) : undefined
  const sourceName = handoff.source_agent_profile_id ? profileNames.get(handoff.source_agent_profile_id) : undefined
  const targetName = handoff.target_agent_profile_id ? profileNames.get(handoff.target_agent_profile_id) : undefined
  const evidenceCount = handoff.reported_evidence_ids.length
  const links = handoff.link_collections.flatMap((collection) => collection.links.map((link) => ({ collection, link })))

  return <details open={expanded} className="mt-3 rounded-md border bg-background">
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Übergabeprotokoll ansehen</summary>
    <div className="space-y-4 border-t p-3">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="text-muted-foreground">Absender:</span> {sourceName ?? (handoff.source_agent_profile_id ? profileName(handoff.source_agent_profile_id, profileNames) : 'Keine Absenderrolle überliefert')}</p>
        <p><span className="text-muted-foreground">Empfänger:</span> {targetName ?? (handoff.target_agent_profile_id ? profileName(handoff.target_agent_profile_id, profileNames) : 'Keine Empfängerrolle überliefert')}</p>
      </div>
      <p className="text-xs text-muted-foreground">Herkunft: Versuch {handoff.source_attempt_no ?? 'nicht überliefert'} · Ticketrevision {handoff.task_revision ?? 'nicht überliefert'}</p>
      <TextBlock label="Zusammenfassung der Übergabe" children={handoff.summary} />
      {handoff.owner_guidance && <TextBlock label="Hinweis des Eigentümers zur Überarbeitung" children={handoff.owner_guidance} />}
      <p className="text-sm"><span className="text-muted-foreground">Gemeldetes Ergebnis:</span> {displayName(handoff.outcome, outcomes)}</p>
      {sourceReport && <div className="rounded-md bg-muted/40 p-3">
        <p className="text-xs font-medium text-muted-foreground">Übernommene Agentenmeldung · {displayName(sourceReport.outcome, outcomes)}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{sourceReport.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">Eingegangen: {dateTime(sourceReport.received_at) ?? 'Zeitpunkt nicht überliefert'}</p>
        {sourceReport.open_questions.length > 0 && <div className="mt-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Offene Fragen der ursprünglichen Agentenmeldung</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">{sourceReport.open_questions.map((question, index) => <li key={`${index}-${question}`} className="whitespace-pre-wrap break-words">{question}</li>)}</ul>
        </div>}
      </div>}
      {!sourceReport && handoff.source_report_id && <p className="text-sm text-muted-foreground">Die referenzierte Meldung ist in diesem Ablauf nicht enthalten. Du findest verfügbare Meldungen unter „Details“.</p>}
      <TextBlock label="Kontext zur Übergabe" children={handoff.context_summary} />
      {handoff.open_questions.length > 0 && <div className="space-y-1">
        <h6 className="text-xs font-medium text-muted-foreground">Für den Folgelauf übernommene offene Fragen</h6>
        <ul className="list-disc space-y-1 pl-5 text-sm">{handoff.open_questions.map((question, index) => <li key={`${index}-${question}`} className="whitespace-pre-wrap break-words">{question}</li>)}</ul>
      </div>}
      {evidenceCount > 0 && <div className="space-y-1">
        <p className="text-sm">Übernommene Meldungen und Belege: {evidenceCount}</p>
        <Button type="button" size="sm" variant="outline" onClick={onOpenDetails}>Meldungen und Belege in Details öffnen</Button>
      </div>}
      {links.length > 0 && <div className="space-y-2">
        <h6 className="text-xs font-medium text-muted-foreground">Registrierte Links</h6>
        <ul className="space-y-2">{links.map(({ collection, link }, index) => {
          const href = safeWebUrl(link.url)
          return <li key={link.id ?? `${collection.name}-${index}`} className="min-w-0 rounded-md bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{collection.name}</p>
            {href ? <a className="mt-1 block break-all text-sm font-medium text-primary underline-offset-4 hover:underline" href={href} target="_blank" rel="noreferrer">{link.title || href}</a> : <p className="mt-1 break-words text-sm font-medium">{link.title || 'Link ohne Titel'}</p>}
            <p className="mt-1 break-words text-xs text-muted-foreground">{[link.kind, link.relation].filter(Boolean).join(' · ') || 'Art nicht angegeben'}{link.url && !href ? ` · ${link.url}` : ''}</p>
          </li>
        })}</ul>
      </div>}
      <p className="text-xs text-muted-foreground">Diese Angaben stammen aus dem beim Folgelauf gespeicherten Übergabeprotokoll.</p>
    </div>
  </details>
}

function RunDetails({ run, ordinal, profileNames, reports, onOpenDetails, expanded = false, selectedReportId = null }: { run: TaskFlowRun; ordinal: number; profileNames: Map<string, string>; reports: Map<string, TaskFlowReport>; onOpenDetails: () => void; expanded?: boolean; selectedReportId?: string | null }) {
  return <details open={expanded} className="rounded-md border bg-background" data-testid={`task-flow-run-details-${run.id}`}>
    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="text-sm font-medium">Laufdetails ansehen · Lauf {ordinal} · {displayName(run.state, runStates)}</span>
      <span className="text-xs text-muted-foreground">{dateTime(run.created_at) ?? 'Zeitpunkt nicht überliefert'}</span>
    </summary>
    <div className="space-y-4 border-t p-3">
      {run.status_reason && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Hinweis zum Lauf</p><p className="mt-1 whitespace-pre-wrap break-words">{run.status_reason}</p></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm"><span className="text-muted-foreground">Ticketrevision:</span> {run.task_revision ?? 'Nicht überliefert'}</p>
        <p className="text-sm"><span className="text-muted-foreground">Aktueller Versuch:</span> {run.attempt_no ?? 'Nicht überliefert'}</p>
      </div>
      {run.attempts.length > 0 && <div className="space-y-2">
        <h6 className="text-xs font-medium text-muted-foreground">Versuche und T3-Sitzungen</h6>
        <ol className="space-y-2">{run.attempts.map((attempt, index) => <li key={`${attempt.attempt_no ?? 'unbekannt'}-${index}`} className="min-w-0 rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">Versuch {attempt.attempt_no ?? 'unbekannt'}{attempt.remote_status ? ` · ${attempt.remote_status.replaceAll('_', ' ')}` : ''}</p>
          <p className="mt-1 text-xs text-muted-foreground">{attempt.started_at ? `Beginn: ${dateTime(attempt.started_at) ?? 'unbekannt'}` : 'Beginn nicht überliefert'}{attempt.ended_at ? ` · Ende: ${dateTime(attempt.ended_at) ?? 'unbekannt'}` : ''}</p>
          {attempt.external_thread_id && <p className="mt-1 break-all text-xs text-muted-foreground">T3-Thread: {attempt.external_thread_id}</p>}
          {attempt.last_observed_at && <p className="mt-1 text-xs text-muted-foreground">Zuletzt abgeglichen: {dateTime(attempt.last_observed_at) ?? 'unbekannt'}</p>}
        </li>)}</ol>
      </div>}
      {run.reports.length > 0 && <div className="space-y-2">
        <h6 className="text-xs font-medium text-muted-foreground">Agentenmeldungen</h6>
        {run.reports.map((report) => <article key={report.id} data-testid={`task-flow-report-${report.id}`} className={`min-w-0 rounded-md p-3 ${report.id === selectedReportId ? 'border border-primary/50 bg-primary/5 ring-1 ring-primary/20' : 'bg-muted/40'}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{displayName(report.outcome, outcomes)}</Badge><span className="text-xs text-muted-foreground">Versuch {report.attempt_no} · Revision {report.task_revision}</span></div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{report.summary}</p>
          {report.route_label_id !== undefined && <p className="mt-1 text-sm">Vom Agenten gewählte Route: {report.route_label_name ?? report.route_label_id ?? 'Standardroute'}</p>}
          <p className="mt-2 text-xs text-muted-foreground">Eingegangen: {dateTime(report.received_at) ?? 'Zeitpunkt nicht überliefert'} · {report.accepted_for_reconciliation ? 'Für die Prüfung übernommen' : 'Nicht für die Prüfung übernommen'}</p>
          {report.rejection_reason && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-destructive">Zurückweisung: {report.rejection_reason}</p>}
          {report.open_questions.length > 0 && <div className="mt-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Offene Fragen aus dieser Meldung</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">{report.open_questions.map((question, index) => <li key={`${index}-${question}`} className="whitespace-pre-wrap break-words">{question}</li>)}</ul>
          </div>}
        </article>)}
      </div>}
      {run.approvals.length > 0 && <div className="space-y-2">
        <h6 className="text-xs font-medium text-muted-foreground">Menschliche Entscheidungen</h6>
        {run.approvals.map((approval) => <article key={approval.id} className="rounded-md bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={approval.status === 'approved' ? 'secondary' : approval.status === 'rejected' ? 'destructive' : 'outline'}>{displayName(approval.status, approvalStates)}</Badge><span className="text-sm">{approval.kind === 'completion' ? 'Phasenabschluss' : 'Prüfung'}</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Angefragt: {dateTime(approval.requested_at) ?? 'Zeitpunkt nicht überliefert'}{approval.decided_at ? ` · Entschieden: ${dateTime(approval.decided_at) ?? 'Zeitpunkt nicht überliefert'}` : ''}</p>
          {actorName(approval.decided_by) && <p className="mt-1 break-words text-xs text-muted-foreground">Entscheidung durch: {actorName(approval.decided_by)}</p>}
          {approval.reason && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{approval.reason}</p>}
        </article>)}
      </div>}
      {run.handoff && <HandoffDetails handoff={run.handoff} profileNames={profileNames} reports={reports} onOpenDetails={onOpenDetails} expanded={expanded} />}
    </div>
  </details>
}

function TaskWorkflows({ item, criteria, profileNames, profiles, boardColumns, boardLookupError, labelNames, onOpenDetails }: { item: TaskFlowWorkflowItem; criteria: Task['criteria']; profileNames: Map<string, string>; profiles: readonly WorkflowStageEditorProfile[]; boardColumns?: readonly WorkflowBoardColumnOption[]; boardLookupError: boolean; labelNames: Map<string, string>; onOpenDetails: () => void }) {
  const [focus, setFocus] = useState<TaskFlowGraphFocus>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const activityDetailsRef = useRef<HTMLElement>(null)
  const scrollAfterFocus = useRef(false)
  const phaseNames = new Map(item.phases.map((phase) => [phase.id, phase.name]))
  const reports = new Map(item.runs.flatMap((run) => run.reports.map((report) => [report.id, report] as const)))
  const runsByStage = new Map<string, TaskFlowRun[]>()
  for (const run of item.runs) runsByStage.set(run.stage, [...(runsByStage.get(run.stage) ?? []), run])
  const knownPhaseIds = new Set(item.phases.map((phase) => phase.id))
  const unassignedRuns = item.runs.filter((run) => !knownPhaseIds.has(run.stage))
  const selectedTransitions = item.selected_transitions ?? []
  const selectedRunTransition = focus?.type === 'transition' ? selectedTransitions[focus.index] : undefined
  const selectedRunId = focus?.type === 'run' ? focus.runId : focus?.type === 'transition' ? focus.runId : null
  const selectedRun = selectedRunId ? item.runs.find((run) => run.id === selectedRunId) : undefined
  const selectedRunOrdinal = selectedRun ? (runsByStage.get(selectedRun.stage) ?? []).findIndex((run) => run.id === selectedRun.id) + 1 : 1
  const selectedPhaseId = focus?.type === 'phase'
    ? focus.phaseId
    : selectedRun?.stage ?? selectedRunTransition?.from_stage_id ?? null
  const selectedPhase = selectedPhaseId ? item.phases.find((phase) => phase.id === selectedPhaseId) : undefined
  const phaseRuns = selectedPhase ? runsByStage.get(selectedPhase.id) ?? [] : []
  const selectedReportId = focus?.type === 'transition' ? focus.reportId : null
  const graphSelection: WorkflowGraphSelection = focus?.type === 'phase'
    ? { type: 'stage', stageId: focus.phaseId }
    : focus?.type === 'run' && selectedRun
      ? { type: 'stage', stageId: selectedRun.stage }
      : focus?.type === 'transition'
        ? { type: 'transition', transitionIndex: focus.index }
        : null
  const graphRouteLabels = new Map<string, string>()
  for (const transition of item.candidate_transitions) {
    if (transition.route_label_id) graphRouteLabels.set(transition.route_label_id, labelNames.get(transition.route_label_id) ?? 'Themenlabel')
  }
  for (const transition of selectedTransitions) {
    if (transition.route_label_id) graphRouteLabels.set(transition.route_label_id, transition.route_label_name ?? labelNames.get(transition.route_label_id) ?? 'Themenlabel')
  }

  useEffect(() => {
    if (!scrollAfterFocus.current) return
    scrollAfterFocus.current = false
    if (!window.matchMedia('(max-width: 1279px)').matches) return
    activityDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activityDetailsRef.current?.querySelector<HTMLElement>('[data-testid="task-flow-activity-details-heading"]')?.focus({ preventScroll: true })
  }, [focus])

  const focusActivity = (nextFocus: TaskFlowGraphFocus) => {
    scrollAfterFocus.current = nextFocus !== null
    setFocus(nextFocus)
  }

  const returnToGraph = () => {
    focusActivity(null)
    if (!window.matchMedia('(max-width: 1279px)').matches) return
    requestAnimationFrame(() => {
      graphRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      graphRef.current?.querySelector<HTMLElement>('[data-testid^="workflow-graph-stage-"]')?.focus({ preventScroll: true })
    })
  }

  const selectGraphElement = (selection: WorkflowGraphSelection) => {
    if (!selection) {
      focusActivity(null)
    } else if (selection.type === 'stage') {
      focusActivity({ type: 'phase', phaseId: selection.stageId })
    } else {
      const transition = selectedTransitions[selection.transitionIndex]
      if (transition) focusActivity({ type: 'transition', index: selection.transitionIndex, runId: transition.source_run_id, reportId: transition.report_id })
    }
  }

  const selectRun = (run: TaskFlowRun) => focusActivity({ type: 'run', runId: run.id })
  const selectRunTransition = (index: number, transition: TaskFlowSelectedTransition) => focusActivity({ type: 'transition', index, runId: transition.source_run_id, reportId: transition.report_id })

  return <Card>
    <CardContent className="space-y-5 p-4 sm:p-5">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <GitBranch className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h4 className="break-words text-base font-semibold">Workflow: {item.workflow_name || 'Name nicht gespeichert'} · Version {item.definition_version}</h4>
            <p className="mt-1 text-sm text-muted-foreground">Gestartet: {dateTime(item.started_at) ?? dateTime(item.created_at) ?? 'Zeitpunkt nicht überliefert'}{item.ended_at ? ` · Beendet: ${dateTime(item.ended_at) ?? 'Zeitpunkt nicht überliefert'}` : ''}</p>
          </div>
        </div>
        <Badge variant={item.state === 'succeeded' ? 'secondary' : item.state === 'failed' || item.state === 'cancelled' ? 'destructive' : 'outline'}>{displayName(item.state, workflowStates)}</Badge>
      </header>

      {item.pause_reason && <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Warum pausiert</p><p className="mt-1 whitespace-pre-wrap break-words">{item.pause_reason}</p></div>}
      {item.repair_round !== null && item.repair_round > 0 && <p className="text-sm text-muted-foreground">Überarbeitungsrunde: {item.repair_round}</p>}

      {item.definition_available && item.phases.length > 0 && <section aria-label="Gespeicherter Workflowablauf" className="space-y-3">
        <h5 className="text-sm font-semibold">Workflowablauf</h5>
        {item.branch_history_status === 'partial' && <p role="status" className="text-xs text-muted-foreground">Ein Teil der tatsächlichen Übergänge ist nicht gespeichert. Geplante Routen stammen aus Version {item.definition_version}.</p>}
        {item.branch_history_status === 'not_recorded' && <p role="status" className="text-xs text-muted-foreground">Für diesen Ablauf ist keine tatsächliche Übergangshistorie gespeichert. Geplante Routen stammen aus Version {item.definition_version}.</p>}
        {boardLookupError && item.phases.some((phase) => phase.board_target) && <p role="status" className="text-xs text-muted-foreground">Projektspalten konnten nicht geladen werden. Gespeicherte Boardziele werden ohne Spaltennamen dargestellt.</p>}
        <div className={focus ? 'grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(19rem,1fr)]' : 'min-w-0'}>
          <div ref={graphRef} data-testid={`task-flow-workflow-graph-${item.id}`} className="min-w-0">
            <WorkflowGraph
              mode="run"
              label={`Ablaufdiagramm · ${item.workflow_name || `Version ${item.definition_version}`}`}
              className="h-[26rem] sm:h-[min(58vh,36rem)]"
              selectedRunId={selectedRunId}
              routeLabelNames={labelNames}
              stages={item.phases}
              transitions={[]}
              profiles={profiles}
              boardColumns={boardColumns}
              routeLabels={[...graphRouteLabels].map(([id, name]) => ({ id, name, active: true, kind: 'topic' }))}
              selection={graphSelection}
              onSelect={selectGraphElement}
              runActivity={{
                currentStageId: item.current_stage_id,
                selectedTransitions: item.selected_transitions,
                plannedTransitions: item.candidate_transitions,
                runs: item.runs,
                branchHistoryStatus: item.branch_history_status,
              }}
              onSelectRun={selectRun}
              onSelectRunTransition={selectRunTransition}
            />
          </div>

          {focus && <section ref={activityDetailsRef} data-testid="task-flow-activity-details" className="min-w-0 scroll-mt-4 space-y-3 rounded-lg border bg-card p-3 text-card-foreground">
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h6 tabIndex={-1} data-testid="task-flow-activity-details-heading" className="break-words text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{selectedRunTransition
                ? `${phaseNames.get(selectedRunTransition.from_stage_id) ?? 'Vorherige Phase'} → ${phaseNames.get(selectedRunTransition.to_stage_id) ?? 'Folgephase'}`
                : selectedRun
                  ? `Lauf ${selectedRunOrdinal} · ${phaseNames.get(selectedRun.stage) ?? 'Phase nicht verfügbar'}`
                  : selectedPhase?.name ?? 'Phase nicht verfügbar'}</h6>
              {selectedPhase && <p className="mt-1 text-xs text-muted-foreground">{selectedPhase.agent_profile_id ? `Rolle: ${profileName(selectedPhase.agent_profile_id, profileNames)}` : 'Keine feste Agentrolle'}</p>}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={returnToGraph}>Details schließen</Button>
          </header>

          {selectedRunTransition && <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{displayName(selectedRunTransition.outcome, outcomes)}</Badge><span className="text-xs text-muted-foreground">Tatsächlicher Übergang · {dateTime(selectedRunTransition.selected_at) ?? 'Zeitpunkt nicht überliefert'}</span></div>
            {selectedRunTransition.route_label_id !== undefined && <p className="mt-1 text-xs">{selectedRunTransition.route_label_id ? `Themenlabel: ${selectedRunTransition.route_label_name ?? labelNames.get(selectedRunTransition.route_label_id) ?? 'nicht mehr verfügbar'}` : 'Standardroute'}</p>}
            {selectedRunTransition.owner_guidance && <p className="mt-2 whitespace-pre-wrap break-words">Freigabe für eine weitere Überarbeitung: {selectedRunTransition.owner_guidance}</p>}
            {selectedRunTransition.report_id && !selectedRun?.reports.some((report) => report.id === selectedRunTransition.report_id) && <p role="status" className="mt-2 text-xs text-muted-foreground">Die zugeordnete Agentenmeldung ist in diesem Lauf nicht enthalten.</p>}
          </div>}

          {selectedPhase && phaseRuns.length > 0 && !selectedRun && <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Läufe dieser Phase</p>
            <ul className="space-y-1.5">{phaseRuns.map((run, index) => <li key={run.id}><Button type="button" variant="outline" size="sm" className="h-auto w-full justify-between gap-3 py-2 text-left" data-testid={`task-flow-run-select-${run.id}`} onClick={() => selectRun(run)}><span className="min-w-0 truncate">Lauf {index + 1} · {displayName(run.state, runStates)}</span><span className="shrink-0 text-xs text-muted-foreground">{dateTime(run.created_at) ?? 'Zeitpunkt nicht überliefert'}</span></Button></li>)}</ul>
          </div>}

          {selectedPhase && phaseRuns.length === 0 && <p className="text-sm text-muted-foreground">Für diese Phase ist noch kein Lauf gespeichert.</p>}
          {selectedRun && <RunDetails run={selectedRun} ordinal={selectedRunOrdinal} profileNames={profileNames} reports={reports} onOpenDetails={onOpenDetails} expanded selectedReportId={selectedReportId} />}
          {!selectedPhase && !selectedRunTransition && <p className="text-sm text-muted-foreground">Die ausgewählte Phase ist in der gespeicherten Workflowversion nicht enthalten.</p>}
          </section>}
        </div>
      </section>}

      <section aria-label="Workflowphasen" className="space-y-3">
        <h5 className="text-sm font-semibold">Phasen</h5>
        {!item.definition_available && <p role="status" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Die gespeicherte Workflowdefinition ist nicht verfügbar. Phasen können für diesen Ablauf nicht zuverlässig eingeordnet werden.</p>}
        {item.phases.length > 0 ? <ol className="space-y-3 border-l pl-4 sm:pl-5">
          {[...item.phases].sort((left, right) => left.position - right.position).map((phase) => {
            const phaseRuns = runsByStage.get(phase.id) ?? []
            const phaseBlocker = phase.blocker_reason && phase.blocker_reason.trim() !== item.pause_reason?.trim() ? phase.blocker_reason : null
            return <li key={phase.id} className="relative min-w-0 space-y-2">
              <span className="absolute -left-[1.32rem] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary sm:-left-[1.57rem]" aria-hidden="true" />
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h6 className="break-words text-sm font-medium">{phase.name || 'Unbenannte Phase'}</h6>
                  <p className="mt-0.5 text-xs text-muted-foreground">{displayName(phase.kind, stageKinds)}{phase.agent_profile_id ? ` · Rolle: ${profileName(phase.agent_profile_id, profileNames)}` : ''}</p>
                </div>
                <Badge variant={phase.status === 'completed' ? 'secondary' : phase.status === 'blocked' ? 'destructive' : phase.status === 'current' ? 'default' : 'outline'}>{phaseStates[phase.status]}</Badge>
              </div>
              {phase.instructions && <details className="rounded-md border bg-background">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Phasenauftrag ansehen</summary>
                <p className="whitespace-pre-wrap break-words border-t p-3 text-sm">{phase.instructions}</p>
              </details>}
              {phaseBlocker && <p className="whitespace-pre-wrap break-words rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">{phaseBlocker}</p>}
              {phase.entry_conditions.length > 0 && <p className="text-xs text-muted-foreground">Eingangsbedingungen: {phase.entry_conditions.map(conditionText).join(' · ')}</p>}
              {completionPolicyText(phase.run_completion_policy, criteria).length > 0 && <details className="rounded-md border bg-background">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Abschlussregeln ansehen</summary>
                <ul className="list-disc space-y-1 border-t p-3 pl-8 text-sm">{completionPolicyText(phase.run_completion_policy, criteria).map((rule, index) => <li key={`${index}-${rule}`} className="whitespace-pre-wrap break-words">{rule}</li>)}</ul>
              </details>}
              {phaseRuns.length > 0 && <ol aria-label={`Läufe der Phase ${phase.name}`} className="space-y-2">
                {phaseRuns.map((run, index) => <li key={run.id}><RunDetails run={run} ordinal={index + 1} profileNames={profileNames} reports={reports} onOpenDetails={onOpenDetails} /></li>)}
              </ol>}
              {phaseRuns.length === 0 && <p className="text-xs text-muted-foreground">Für diese Phase ist kein Agentenlauf gespeichert.</p>}
            </li>
          })}
        </ol> : item.definition_available && <p className="text-sm text-muted-foreground">Für diesen Workflow sind keine Phasen gespeichert.</p>}
      </section>

      {unassignedRuns.length > 0 && <section className="space-y-3">
        <h5 className="text-sm font-semibold">Gespeicherte Läufe ohne verfügbare Phase</h5>
        <p className="text-xs text-muted-foreground">Diese Läufe bleiben sichtbar, auch wenn ihre Phase in der gespeicherten Definition fehlt.</p>
        <ol className="space-y-2">{unassignedRuns.map((run, index) => <li key={run.id}><RunDetails run={run} ordinal={index + 1} profileNames={profileNames} reports={reports} onOpenDetails={onOpenDetails} /></li>)}</ol>
      </section>}

      <section className="space-y-3">
        <h5 className="text-sm font-semibold">Tatsächliche Übergänge</h5>
        {item.branch_history_status === 'complete' && <p className="text-xs text-muted-foreground">Das Übergangsprotokoll ist für diesen Workflow vollständig.</p>}
        {item.branch_history_status === 'partial' && <p className="text-xs text-muted-foreground">Das Übergangsprotokoll ist teilweise vorhanden. Ältere Schritte können fehlen.</p>}
        {item.branch_history_status === 'not_recorded' && <p className="text-xs text-muted-foreground">Für diesen älteren Workflow wurde keine vollständige Übergangshistorie gespeichert. Nicht belegte Schritte werden nicht ergänzt.</p>}
        {item.selected_transitions?.length ? <ol className="space-y-2">
          {item.selected_transitions.map((transition, index) => <li key={`${transition.source_run_id}-${transition.selected_at}-${index}`} className="min-w-0 rounded-md bg-muted/40 p-3">
            <p className="break-words text-sm font-medium">{phaseNames.get(transition.from_stage_id) ?? 'Vorherige Phase'} → {phaseNames.get(transition.to_stage_id) ?? 'Folgephase'}</p>
            <p className="mt-1 text-sm">Ausgewählter Ausgang: {displayName(transition.outcome, outcomes)}</p>
            {transition.route_label_id !== undefined && <p className="mt-1 text-sm">{transition.route_label_id ? `Routenlabel: ${transition.route_label_name ?? labelNames.get(transition.route_label_id) ?? transition.route_label_id}` : 'Standardroute'}</p>}
            {transition.owner_guidance && <p className="mt-1 whitespace-pre-wrap break-words text-sm">Weitere Überarbeitung freigegeben: {transition.owner_guidance}</p>}
            <p className="mt-1 text-xs text-muted-foreground">Ausgewählt: {dateTime(transition.selected_at) ?? 'Zeitpunkt nicht überliefert'}{transition.report_id ? ' · Agentenmeldung ist zugeordnet' : ''}</p>
          </li>)}
        </ol> : <p className="text-sm text-muted-foreground">Für diesen Ablauf ist noch kein tatsächlicher Übergang gespeichert.</p>}
      </section>

      {item.candidate_transitions.length > 0 && <details className="rounded-md border bg-background">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Weitere Regeln in der Workflowdefinition ansehen</summary>
        <div className="space-y-2 border-t p-3">
          <p className="text-xs text-muted-foreground">Diese Übergänge sind in der gespeicherten Definition möglich. Sie sagen nicht voraus, welcher Schritt als Nächstes ausgeführt wird.</p>
          <ul className="space-y-2">{item.candidate_transitions.map((transition, index) => <li key={`${transition.from_stage_id}-${transition.to_stage_id}-${transition.on}-${index}`} className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words font-medium">{phaseNames.get(transition.from_stage_id) ?? 'Phase'} → {phaseNames.get(transition.to_stage_id) ?? 'Folgephase'}</p><Badge variant={transition.selection_status === 'selected' ? 'secondary' : 'outline'}>{transitionSelectionStates[transition.selection_status]}</Badge></div>
            <p className="mt-1">Bei: {displayName(transition.on, outcomes)}</p>
            {transition.route_label_id && <p className="mt-1">Routenlabel: {labelNames.get(transition.route_label_id) ?? transition.route_label_id}</p>}
            {transition.conditions.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Zusätzliche Bedingungen: {transition.conditions.map(conditionText).join(' · ')}</p>}
          </li>)}</ul>
        </div>
      </details>}
    </CardContent>
  </Card>
}

function TaskRunItem({ item, profileNames, onOpenDetails }: { item: Extract<TaskFlowItem, { kind: 'run' }>; profileNames: Map<string, string>; onOpenDetails: () => void }) {
  const reports = new Map(item.run.reports.map((report) => [report.id, report]))
  return <Card>
    <CardContent className="space-y-3 p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-base font-semibold">Einzellauf · {item.run.stage || 'Phase nicht angegeben'}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{dateTime(item.run.created_at) ?? 'Zeitpunkt nicht überliefert'}</p>
        </div>
        <Badge variant={item.run.state === 'succeeded' ? 'secondary' : item.run.state === 'failed' || item.run.state === 'cancelled' ? 'destructive' : 'outline'}>{displayName(item.run.state, runStates)}</Badge>
      </div>
      <RunDetails run={item.run} ordinal={1} profileNames={profileNames} reports={reports} onOpenDetails={onOpenDetails} />
    </CardContent>
  </Card>
}

export default function TaskFlow({ task, projectId, statuses, labelNames, flow, loading, error, loadingMore, hasMore, onOpenDetails, onOpenExecution, onRetry, onLoadMore }: {
  task: Task
  projectId: string
  statuses: TaskStatus[]
  labelNames: Map<string, string>
  flow?: TaskFlowPage
  loading: boolean
  error?: string
  loadingMore: boolean
  hasMore: boolean
  onOpenDetails: () => void
  onOpenExecution: () => void
  onRetry: () => void
  onLoadMore: () => void
}) {
  const status = statuses.find((item) => item.id === task.status_id)
  const profilesQuery = useQuery({
    queryKey: ['task-flow-profiles', projectId],
    enabled: Boolean(flow?.items.length),
    queryFn: async () => {
      const items: components['schemas']['AgentProfile'][] = []
      let cursor: string | undefined
      do {
        const page = await request(api.GET('/agent-profiles', { params: { query: { project_id: projectId, limit: 100, ...(cursor ? { cursor } : {}) } } }))
        items.push(...page.items)
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      return { items }
    },
  })
  const profileNames = new Map((profilesQuery.data?.items ?? []).map((profile) => [profile.id, profile.name]))
  const profileOptions: WorkflowStageEditorProfile[] = (profilesQuery.data?.items ?? []).map((profile) => ({ id: profile.id, name: profile.name, role: profile.role }))
  const hasWorkflowBoardTargets = Boolean(flow?.items.some((item) => item.kind === 'workflow_instance' && item.phases.some((phase) => phase.board_target)))
  const workflowBoardsQuery = useQuery({
    queryKey: ['task-flow-workflow-boards', projectId],
    enabled: Boolean(projectId && hasWorkflowBoardTargets),
    queryFn: async () => {
      const load = (archived: boolean) => fetchAllPages((cursor) => request(api.GET('/projects/{project_id}/boards', {
        params: { path: { project_id: projectId }, query: { limit: 100, archived, ...(cursor ? { cursor } : {}) } },
      })))
      const [active, archived] = await Promise.all([load(false), load(true)])

      return [...active.items, ...archived.items]
    },
  })
  const boardColumns = taskFlowBoardColumns(workflowBoardsQuery.data, statuses)

  const ticketStatusSection = <section aria-labelledby="task-flow-ticket-status" className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ListChecks className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="task-flow-ticket-status" className="text-sm font-semibold">Ticketstand</h3>
            <p className="mt-1 text-xs text-muted-foreground">Status und Erfolgskriterien gelten für das gesamte Ticket. Sie stehen getrennt von den einzelnen Workflowphasen.</p>
          </div>
        </div>
        <Badge variant={task.status_category === 'done' ? 'secondary' : 'outline'}>{status?.name ?? categoryLabels[task.status_category] ?? 'Status unbekannt'}</Badge>
      </div>

      {task.blocked && <div role="status" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div><p className="font-medium">Ticket blockiert</p>{task.blocker_reason && <p className="mt-1 whitespace-pre-wrap break-words">{task.blocker_reason}</p>}</div>
      </div>}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Erfolgskriterien des Tickets</h4>
          <Button size="sm" variant="outline" onClick={onOpenDetails}><FileCheck2 />Details öffnen</Button>
        </div>
        {task.criteria.length === 0 ? <p className="text-sm text-muted-foreground">Für dieses Ticket sind keine Erfolgskriterien festgelegt.</p> : <ul className="space-y-2">
          {task.criteria.map((criterion) => <li key={criterion.id} className="flex min-w-0 flex-col items-start gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:justify-between sm:gap-3">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{criterion.text}</p>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <Badge variant="outline">{criterion.is_required ? 'Erforderlich' : 'Optional'}</Badge>
              <Badge variant={criterion.state === 'human_confirmed' ? 'secondary' : criterion.state === 'rejected' ? 'destructive' : 'outline'}>{criterionStates[criterion.state] ?? 'Offen'}</Badge>
            </div>
          </li>)}
        </ul>}
      </div>
    </section>

  const workflowSessionsSection = <section aria-labelledby="task-flow-sessions" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="task-flow-sessions" className="text-sm font-semibold">Workflows und Agentenläufe</h3>
        <Button size="sm" variant="outline" onClick={onOpenExecution}>Ausführung öffnen</Button>
      </div>
      {loading ? <p role="status" aria-live="polite" className="rounded-lg border p-4 text-sm text-muted-foreground">Ablauf wird geladen …</p>
        : error ? <div role="alert" className="rounded-lg border border-destructive/40 p-4">
          <p className="text-sm">Der Ticketablauf konnte nicht geladen werden: {error}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}><RotateCw />Erneut laden</Button>
        </div>
          : flow?.items.length ? <div className="space-y-4">
            {flow.items.map((item) => item.kind === 'workflow_instance'
              ? <TaskWorkflows key={`${item.kind}-${item.id}`} item={item} criteria={task.criteria} profileNames={profileNames} profiles={profileOptions} boardColumns={boardColumns} boardLookupError={workflowBoardsQuery.isError} labelNames={labelNames} onOpenDetails={onOpenDetails} />
              : <TaskRunItem key={`${item.kind}-${item.run.id}`} item={item} profileNames={profileNames} onOpenDetails={onOpenDetails} />)}
            {hasMore && <div className="flex justify-center"><Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Weitere Abläufe werden geladen …' : 'Ältere Abläufe laden'}</Button></div>}
          </div>
            : <div className="rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium">Für dieses Ticket gibt es noch keinen Workflow oder Einzellauf.</p>
              <p className="mt-1 text-sm text-muted-foreground">Du kannst das Ticket trotzdem selbst bearbeiten. Der Ticketstand oben bleibt davon unabhängig.</p>
            </div>}
    </section>
  const hasVisibleWorkflowGraph = Boolean(flow?.items.some((item) => item.kind === 'workflow_instance' && item.definition_available && item.phases.length > 0))

  return <div className="space-y-5 pb-6">
    {hasVisibleWorkflowGraph ? <>{workflowSessionsSection}{ticketStatusSection}</> : <>{ticketStatusSection}{workflowSessionsSection}</>}
  </div>
}
