import { useState } from 'react'
import { GitBranch, X } from 'lucide-react'
import type { components } from '@/generated/api'
import type { WorkflowGraphMobileContext, WorkflowGraphMobileStage, WorkflowGraphMobileTransition } from '@/components/WorkflowGraph'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type TaskFlowRun = components['schemas']['TaskFlowRun']
type TaskFlowSelectedTransition = components['schemas']['TaskFlowSelectedTransition']

export function hasDenseWorkflowRoutes(routes: readonly { from_stage_id: string; to_stage_id: string }[]): boolean {
  if (routes.length >= 8) return true

  const routeCounts = new Map<string, number>()
  for (const route of routes) {
    const key = `${route.from_stage_id}\u0000${route.to_stage_id}`
    const nextCount = (routeCounts.get(key) ?? 0) + 1
    if (nextCount >= 3) return true
    routeCounts.set(key, nextCount)
  }

  return false
}

function phaseName(id: string, stages: readonly WorkflowGraphMobileStage[]): string {
  return stages.find((stage) => stage.id === id)?.name ?? 'Phase nicht verfügbar'
}

function eventTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? 'Zeitpunkt nicht überliefert'
    : new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function RouteBadge({ transition }: { transition: WorkflowGraphMobileTransition }) {
  return <Badge variant={transition.on === 'blocked' || transition.on === 'failed' ? 'destructive' : 'outline'}>{transition.outcomeLabel}</Badge>
}

export function WorkflowGraphMobileNavigation(context: WorkflowGraphMobileContext) {
  const {
    stages,
    transitions,
    mode,
    runActivity,
    selectedRunId,
    selection,
    disabled,
    onSelect,
    onSelectRun,
    onSelectRunTransition,
    onSelectPlannedTransition,
    onConnectStages,
  } = context
  const [connecting, setConnecting] = useState(false)
  const [connectionSource, setConnectionSource] = useState<string | null>(null)
  const runs = runActivity?.runs ?? []
  const connectedTarget = connectionSource ? stages.find((stage) => stage.id === connectionSource) : undefined

  const selectPhase = (stage: WorkflowGraphMobileStage) => {
    if (disabled || stage.missing) return
    if (!connecting) {
      onSelect({ type: 'stage', stageId: stage.id })
      return
    }

    if (!connectionSource) {
      setConnectionSource(stage.id)
      return
    }
    if (connectionSource === stage.id) {
      setConnectionSource(null)
      return
    }

    onConnectStages?.(connectionSource, stage.id)
    setConnecting(false)
    setConnectionSource(null)
  }

  const toggleConnecting = () => {
    if (disabled) return
    const next = !connecting
    setConnecting(next)
    setConnectionSource(null)
    if (next) onSelect(null)
  }

  return (
    <section data-testid="workflow-mobile-navigation-content" aria-label="Phasen und Routen" className="min-h-full min-w-0 space-y-3 p-3 text-sm">
      {mode === 'definition' && onConnectStages && <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={connecting ? 'secondary' : 'outline'} data-testid="workflow-mobile-connect-mode" aria-pressed={connecting} disabled={disabled} onClick={toggleConnecting}>
          {connecting ? <X /> : <GitBranch />}
          {connecting ? 'Verbinden abbrechen' : 'Phasen verbinden'}
        </Button>
        {connecting && <p role="status" className="min-w-0 text-xs text-muted-foreground">{connectedTarget ? `Ausgang: ${connectedTarget.name} · Ziel wählen` : 'Ausgangsphase wählen'}</p>}
      </div>}

      <ol className="space-y-3">
        {stages.map((stage, index) => {
          const outgoing = transitions.flatMap((transition, transitionIndex) => transition.from_stage_id === stage.id ? [{ transition, transitionIndex }] : [])
          const isSelected = selection?.type === 'stage' && selection.stageId === stage.id

          return (
            <li key={stage.id} data-testid={`workflow-mobile-stage-${stage.id}`} className="min-w-0 rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
              <div className="flex min-w-0 items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-10 max-w-full justify-start whitespace-normal break-words px-1 py-1 text-left text-base font-semibold"
                    data-testid={`workflow-mobile-stage-select-${stage.id}`}
                    aria-label={connecting
                      ? connectionSource === stage.id
                        ? `Ausgangsphase ausgewählt: ${stage.name}`
                        : connectionSource
                          ? `Zielphase wählen: ${stage.name}`
                          : `Ausgangsphase wählen: ${stage.name}`
                      : `Phase auswählen: ${stage.name}`}
                    aria-pressed={!connecting && isSelected}
                    disabled={disabled || stage.missing}
                    onClick={() => selectPhase(stage)}
                  >{stage.name}</Button>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    {stage.start && <Badge variant="secondary">Startphase</Badge>}
                    {stage.statusLabel && <Badge variant={stage.current ? 'default' : stage.statusLabel === 'Erledigt' ? 'secondary' : stage.statusLabel === 'Blockiert' || stage.statusLabel === 'Unbekannt' ? 'destructive' : 'outline'}>{stage.statusLabel}</Badge>}
                    {stage.kind && <Badge variant="outline">{stage.kind}</Badge>}
                  </div>
                  <p className="mt-2 break-words" title={stage.profileTitle}><span className="text-muted-foreground">Rolle:</span> {stage.profileLabel}</p>
                  {stage.boardLabel !== 'Spalte beibehalten' && <p className="mt-1 break-words" title={stage.boardTitle}><span className="text-muted-foreground">Boardspalte:</span> {stage.boardLabel}</p>}
                  {stage.blockerReason && <p className="mt-2 break-words text-amber-800 dark:text-amber-300">{stage.blockerReason}</p>}
                </div>
              </div>

              {stage.runs.length > 0 && <div className="mt-3 space-y-1.5">
                <h5 className="font-medium">Läufe</h5>
                <ul className="flex min-w-0 flex-wrap gap-2">
                  {stage.runs.map((run, runIndex) => {
                    const attempt = run.attempt_no ?? runIndex + 1
                    return <li key={run.id}>
                      <Button type="button" size="sm" variant={run.id === selectedRunId ? 'secondary' : 'outline'} data-testid={`workflow-mobile-run-${run.id}`} aria-pressed={run.id === selectedRunId} onClick={() => onSelectRun?.(run)}>
                        Lauf {attempt} ansehen
                      </Button>
                    </li>
                  })}
                </ul>
              </div>}

              <div className="mt-3 space-y-1.5">
                <h5 className="font-medium">Routen</h5>
                {outgoing.length === 0
                  ? <p className="text-muted-foreground">Keine ausgehenden Routen.</p>
                  : <ul className="space-y-2">{outgoing.map(({ transition, transitionIndex }) => {
                    const targetName = phaseName(transition.to_stage_id, stages)
                    const routeTestId = transition.graphKind === 'definition'
                      ? `workflow-mobile-route-${transition.transitionIndex ?? transitionIndex}`
                      : transition.graphKind === 'planned'
                        ? `workflow-mobile-planned-route-${transition.transitionIndex ?? transitionIndex}`
                        : `workflow-mobile-actual-route-${transitionIndex}`
                    const routeSummary = <span className="min-w-0 break-words"><span className="font-medium">{targetName}</span><span className="block text-xs text-muted-foreground">{transition.routeLabel}</span></span>

                    if (transition.graphKind === 'definition') {
                      const definitionIndex = transition.transitionIndex ?? transitionIndex
                      const selected = selection?.type === 'transition' && selection.transitionIndex === definitionIndex
                      return <li key={`definition-${definitionIndex}`}>
                        <Button type="button" variant="ghost" className={cn('flex h-auto min-h-11 w-full min-w-0 items-start justify-between gap-2 whitespace-normal rounded-md border bg-background px-3 py-2 text-left text-sm', selected && 'border-primary bg-accent')} data-testid={routeTestId} aria-label={`Übergang auswählen: ${stage.name} nach ${targetName}, ${transition.outcomeLabel}, ${transition.routeLabel}`} aria-pressed={selected} disabled={disabled} onClick={() => onSelect({ type: 'transition', transitionIndex: definitionIndex })}>
                          {routeSummary}<RouteBadge transition={transition} />
                        </Button>
                      </li>
                    }

                    if (transition.graphKind === 'planned') {
                      const candidateIndex = transition.transitionIndex ?? transitionIndex
                      const selected = selection?.type === 'plannedTransition' && selection.transitionIndex === candidateIndex
                      return <li key={`planned-${candidateIndex}`}>
                        <Button type="button" variant="ghost" className={cn('flex h-auto min-h-11 w-full min-w-0 items-start justify-between gap-2 whitespace-normal rounded-md border bg-background px-3 py-2 text-left text-sm', selected && 'border-primary bg-accent')} data-testid={routeTestId} aria-label={`Geplante Route ansehen: ${stage.name} nach ${targetName}, ${transition.outcomeLabel}, ${transition.routeLabel}, ${transition.selectionStatusLabel ?? 'Unbekannt'}`} aria-pressed={selected} onClick={() => onSelectPlannedTransition?.(candidateIndex)}>
                          {routeSummary}<span className="flex shrink-0 flex-col items-end gap-1"><Badge variant="outline">{transition.selectionStatusLabel ?? 'Unbekannt'}</Badge><RouteBadge transition={transition} /></span>
                        </Button>
                      </li>
                    }

                    const visits = transition.eventIndexes?.flatMap((eventIndex) => runActivity?.selectedTransitions?.[eventIndex] ? [{ eventIndex, event: runActivity.selectedTransitions[eventIndex] }] : []) ?? []
                    const renderVisit = ({ eventIndex, event }: { eventIndex: number; event: TaskFlowSelectedTransition }) => {
                      const sourceRun = runs.find((run: TaskFlowRun) => run.id === event.source_run_id)
                      const attempt = sourceRun?.attempt_no ?? 'unbekannt'
                      const accessibleName = `Übergabe ansehen: ${stage.name} nach ${targetName}, ${transition.outcomeLabel}, Versuch ${attempt}`
                      return <Button key={eventIndex} type="button" size="sm" variant={selection?.type === 'transition' && selection.transitionIndex === eventIndex ? 'secondary' : 'outline'} className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left" data-testid={`workflow-mobile-transition-visit-${eventIndex}`} aria-label={accessibleName} aria-pressed={selection?.type === 'transition' && selection.transitionIndex === eventIndex} onClick={() => onSelectRunTransition?.(eventIndex, event)}>
                        Versuch {attempt} · {eventTime(event.selected_at)}
                      </Button>
                    }

                    return <li key={`actual-${transition.from_stage_id}-${transition.to_stage_id}-${transition.on}-${transition.route_label_id ?? transition.route_label_name ?? ''}`} className="rounded-md border bg-background p-2">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        {routeSummary}<RouteBadge transition={transition} />
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                        {visits.length <= 1
                          ? visits.map(renderVisit)
                          : <details className="min-w-0">
                            <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{visits.length} tatsächliche Besuche</summary>
                            <div className="mt-2 flex min-w-0 flex-col items-start gap-2">{visits.map(renderVisit)}</div>
                          </details>}
                      </div>
                    </li>
                  })}</ul>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
