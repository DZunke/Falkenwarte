import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Columns3, GitBranch, Layers2, ListChecks, Maximize2, UserRound, X, ZoomIn, ZoomOut } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import './WorkflowGraph.css'
import type { components } from '@/generated/api'
import { workflowLayout } from '@/components/WorkflowGraphLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type WorkflowBoardColumnOption,
  type WorkflowStageEditorProfile,
  type WorkflowStageEditorRouteLabel,
  type WorkflowStageEditorStage,
  type WorkflowStageEditorTransition,
} from '@/components/WorkflowStagesEditor'
import { cn } from '@/lib/utils'

export type WorkflowGraphSelection =
  | { type: 'stage'; stageId: string }
  | { type: 'transition'; transitionIndex: number }
  | null

export type WorkflowGraphRunActivity = {
  currentStageId: string | null
  selectedTransitions: readonly components['schemas']['TaskFlowSelectedTransition'][] | null
  plannedTransitions: readonly components['schemas']['TaskFlowCandidateTransition'][]
  runs: readonly components['schemas']['TaskFlowRun'][]
  branchHistoryStatus: components['schemas']['TaskFlowWorkflowInstance']['branch_history_status']
}

export type WorkflowGraphProps = {
  stages: readonly WorkflowGraphStageInput[]
  transitions?: readonly WorkflowStageEditorTransition[]
  profiles: readonly WorkflowStageEditorProfile[]
  boardColumns?: readonly WorkflowBoardColumnOption[]
  routeLabels?: readonly WorkflowStageEditorRouteLabel[]
  routeLabelNames?: ReadonlyMap<string, string>
  mode?: 'definition' | 'run'
  runActivity?: WorkflowGraphRunActivity
  selectedRunId?: string | null
  onSelectRun?: (run: components['schemas']['TaskFlowRun']) => void
  onSelectRunTransition?: (index: number, event: components['schemas']['TaskFlowSelectedTransition']) => void
  selection?: WorkflowGraphSelection
  onSelect?: (selection: WorkflowGraphSelection) => void
  onConnectStages?: (fromStageId: string, toStageId: string) => void
  onReconnectTransition?: (transitionIndex: number, fromStageId: string, toStageId: string) => void
  disabled?: boolean
  className?: string
  label?: string
}

type GraphLayout = 'horizontal' | 'vertical'
type PhaseOutcome = WorkflowStageEditorTransition['on']
type WorkflowGraphStageInput = WorkflowStageEditorStage | components['schemas']['TaskFlowPhase']

type GraphTransition = {
  from_stage_id: string
  to_stage_id: string
  on: PhaseOutcome
  route_label_id?: string | null
  route_label_name?: string | null
  conditionsCount: number
  graphKind: 'definition' | 'planned' | 'actual'
  selectionStatus?: components['schemas']['TaskFlowCandidateTransition']['selection_status']
  transitionIndex?: number
  eventIndexes?: number[]
}

type GraphStage = {
  id: string
  name: string
  kind: string
  order: number
  start: boolean
  missing: boolean
  current: boolean
  statusLabel?: string
  profileLabel: string
  profileTitle?: string
  boardLabel: string
  boardTitle?: string
  runs: components['schemas']['TaskFlowRun'][]
  selectedRunId: string | null
}

type WorkflowStageNodeData = {
  stage: GraphStage
  layout: GraphLayout
  nodeWidth: number
  canConnect: boolean
  disabled: boolean
  connecting: boolean
  connectionSource: boolean
  onSelectRun: (run: components['schemas']['TaskFlowRun']) => void
  onActivate: () => void
}

type WorkflowStageNode = Node<WorkflowStageNodeData, 'workflowStage'>

type WorkflowTransitionEdgeData = {
  edgeIndex: number
  graphKind: GraphTransition['graphKind']
  transitionIndex?: number
  eventIndexes?: number[]
  outcome: PhaseOutcome
  outcomeLabel: string
  routeLabel: string
  hasRouteLabel: boolean
  accessibleLabel: string
  conditionsCount: number
  disabled: boolean
  isReturn: boolean
  layout: GraphLayout
  lane: number
  waypoints?: { x: number; y: number }[]
  selectionStatus?: components['schemas']['TaskFlowCandidateTransition']['selection_status']
  selectedVisits?: components['schemas']['TaskFlowSelectedTransition'][]
  branchHistoryStatus?: components['schemas']['TaskFlowWorkflowInstance']['branch_history_status']
  onSelectRunTransition?: WorkflowGraphProps['onSelectRunTransition']
  onOpenRunVisits?: (edgeIndex: number) => void
  onSelect: () => void
}

type WorkflowTransitionEdge = Edge<WorkflowTransitionEdgeData, 'workflowTransition'>

const nodeHeight = 164
const verticalStep = 250

const phaseStatusLabels: Record<components['schemas']['TaskFlowPhase']['status'], string> = {
  completed: 'Erledigt',
  current: 'Aktuell',
  open: 'Offen',
  blocked: 'Blockiert',
  skipped: 'Übersprungen',
  unknown: 'Unbekannt',
}

const outcomes: Record<PhaseOutcome, string> = {
  accepted: 'Angenommen',
  needs_changes: 'Änderungen nötig',
  blocked: 'Blockiert',
  failed: 'Fehlgeschlagen',
}

const sourceHandleId = 'workflow-source-main'
const targetHandleId = 'workflow-target-main'
const sourceReturnHandleId = 'workflow-source-return'
const targetReturnHandleId = 'workflow-target-return'

function outcomeColor(outcome: PhaseOutcome, isReturn = false): string {
  if (isReturn || outcome === 'needs_changes') return 'var(--workflow-return)'
  if (outcome === 'blocked' || outcome === 'failed') return 'var(--destructive)'

  return 'var(--primary)'
}

function routeKey(fromStageId: string, outcome: PhaseOutcome, routeLabelId?: string | null): string {
  return `${fromStageId}\u0000${outcome}\u0000${routeLabelId?.toLowerCase() ?? ''}`
}

function canCreateRoute(
  transitions: readonly GraphTransition[],
  fromStageId: string,
  toStageId: string,
): boolean {
  const availableOutcomes: PhaseOutcome[] = fromStageId === toStageId
    ? ['needs_changes']
    : ['accepted', 'needs_changes', 'blocked', 'failed']

  return availableOutcomes.some((outcome) => !transitions.some((transition) =>
    transition.from_stage_id === fromStageId
    && transition.on === outcome
    && !transition.route_label_id))
}

function canReconnectRoute(
  transitions: readonly GraphTransition[],
  transitionIndex: number,
  fromStageId: string,
  toStageId: string,
): boolean {
  const current = transitions[transitionIndex]
  if (!current || (fromStageId === toStageId && current.on !== 'needs_changes')) return false

  const candidateKey = routeKey(fromStageId, current.on, current.route_label_id)

  return !transitions.some((transition, index) => index !== transitionIndex
    && routeKey(transition.from_stage_id, transition.on, transition.route_label_id) === candidateKey)
}

function boardTargetSummary(
  target: WorkflowStageEditorStage['board_target'],
  boardColumns: readonly WorkflowBoardColumnOption[] | undefined,
  mode: 'definition' | 'run',
): { label: string; title?: string } {
  if (!target) return { label: 'Spalte beibehalten' }
  if (boardColumns === undefined) return mode === 'run'
    ? { label: 'Boardspalte festgelegt', title: 'Das eingefrorene Boardziel ist gespeichert.' }
    : { label: 'Boardziel wird geprüft', title: 'Das gespeicherte Boardziel wird geprüft.' }

  const column = boardColumns?.find((candidate) => candidate.boardId === target.board_id && candidate.columnId === target.column_id)
  const identifiers = `${target.board_id}/${target.column_id}`
  if (!column) return { label: 'Spalte nicht verfügbar', title: `Gespeichertes Boardziel: ${identifiers}` }

  if (mode === 'run') return { label: `${column.boardName} · ${column.columnName}` }

  const available = !column.boardArchived
    && Boolean(column.defaultDropStatusId)
    && ['ready', 'active', 'review'].includes(column.defaultDropStatusCategory ?? '')
  if (!available) return { label: 'Spalte nicht verfügbar', title: `${column.boardName} · ${column.columnName} (${identifiers})` }

  return { label: `${column.boardName} · ${column.columnName}` }
}

function graphStages(
  stages: readonly WorkflowGraphStageInput[],
  transitions: readonly GraphTransition[],
  profiles: readonly WorkflowStageEditorProfile[],
  boardColumns: readonly WorkflowBoardColumnOption[] | undefined,
  mode: 'definition' | 'run',
  activity: WorkflowGraphRunActivity | undefined,
  selectedRunId: string | null,
): GraphStage[] {
  const orderedStages = mode === 'run'
    ? [...stages].sort((left, right) => ('position' in left ? left.position : 0) - ('position' in right ? right.position : 0))
    : stages
  const mapped = orderedStages.map((stage, index): GraphStage => {
    const profile = stage.agent_profile_id ? profiles.find((candidate) => candidate.id === stage.agent_profile_id) : undefined
    const boardTarget = boardTargetSummary(stage.board_target, boardColumns, mode)
    const status = 'status' in stage ? stage.status : undefined

    return {
      id: stage.id,
      name: stage.name || 'Phase ohne Namen',
      kind: stage.kind === 'agent_run' ? 'Arbeitsphase' : stage.kind === 'review' ? (mode === 'run' ? 'Prüfung' : 'Reviewphase') : stage.kind === 'implementation' ? 'Bearbeitung' : stage.kind === 'research' ? 'Recherche' : stage.kind === 'manual' ? 'Manuelle Phase' : stage.kind,
      order: index + 1,
      start: index === 0,
      missing: false,
      current: activity?.currentStageId === stage.id,
      statusLabel: status ? phaseStatusLabels[status] : undefined,
      profileLabel: stage.agent_profile_id ? profile?.name ?? 'Rolle nicht verfügbar' : 'Keine Agentrolle',
      profileTitle: stage.agent_profile_id && !profile ? `Gespeicherte Rollen-ID: ${stage.agent_profile_id}` : undefined,
      boardLabel: boardTarget.label,
      boardTitle: boardTarget.title,
      runs: activity?.runs.filter((run) => run.stage === stage.id) ?? [],
      selectedRunId,
    }
  })
  const knownIds = new Set(mapped.map((stage) => stage.id))
  const referencedIds = new Set(transitions.flatMap((transition) => [transition.from_stage_id, transition.to_stage_id]))

  for (const id of referencedIds) {
    if (knownIds.has(id)) continue
    knownIds.add(id)
    mapped.push({
      id,
      name: 'Phase nicht verfügbar',
      kind: 'Nicht verfügbar',
      order: mapped.length + 1,
      start: false,
      missing: true,
      current: false,
      profileLabel: 'Rolle nicht verfügbar',
      profileTitle: 'Die Phasendefinition fehlt.',
      boardLabel: 'Spalte nicht verfügbar',
      boardTitle: 'Die Phasendefinition fehlt.',
      runs: [],
      selectedRunId,
    })
  }

  return mapped
}

function graphTransitionsFromDefinition(transitions: readonly WorkflowStageEditorTransition[]): GraphTransition[] {
  return transitions.map((transition, transitionIndex) => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    route_label_id: transition.route_label_id ?? null,
    conditionsCount: transition.conditions.length,
    graphKind: 'definition',
    transitionIndex,
  }))
}

function graphTransitionsFromRun(activity: WorkflowGraphRunActivity | undefined): GraphTransition[] {
  if (!activity) return []
  const planned = activity.plannedTransitions.map((transition, transitionIndex): GraphTransition => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    route_label_id: transition.route_label_id ?? null,
    conditionsCount: transition.conditions.length,
    graphKind: 'planned',
    selectionStatus: transition.selection_status,
    transitionIndex,
  }))
  const actualGroups = new Map<string, { transition: components['schemas']['TaskFlowSelectedTransition']; indexes: number[] }>()
  for (const [index, event] of (activity.selectedTransitions ?? []).entries()) {
    const key = JSON.stringify([event.from_stage_id, event.to_stage_id, event.outcome, event.route_label_id ?? null, event.route_label_name ?? null])
    const group = actualGroups.get(key) ?? { transition: event, indexes: [] }
    group.indexes.push(index)
    actualGroups.set(key, group)
  }
  const actual = [...actualGroups.values()].map(({ transition, indexes }): GraphTransition => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.outcome,
    route_label_id: transition.route_label_id ?? null,
    route_label_name: transition.route_label_name,
    conditionsCount: 0,
    graphKind: 'actual',
    eventIndexes: indexes,
  }))

  return [...planned, ...actual]
}

function isReturnTransition(sourceIndex: number, targetIndex: number): boolean {
  return targetIndex <= sourceIndex
}

function StageNodeView({ data, selected }: NodeProps<WorkflowStageNode>) {
  const isReview = data.stage.kind === 'Reviewphase' || data.stage.kind === 'Prüfung'
  const StageIcon = isReview ? ListChecks : Layers2
  const handleClassName = 'workflow-graph__handle !h-3.5 !w-3.5 !rounded-full !border-2 !border-background !bg-primary'
  const sourceAndTargetAreConnectable = data.canConnect
  const runs = data.stage.runs

  return (
    <div className="relative flex h-full w-full flex-col" data-run-phase={data.stage.statusLabel ? true : undefined}>
      <Handle
        id={sourceHandleId}
        type="source"
        position={data.layout === 'horizontal' ? Position.Right : Position.Bottom}
        className={handleClassName}
        isConnectable={sourceAndTargetAreConnectable}
        isConnectableStart={sourceAndTargetAreConnectable}
        isConnectableEnd={false}
        aria-label={`Ausgang von ${data.stage.name}`}
        title={`Ausgang von ${data.stage.name}`}
      />
      <Handle
        id={targetHandleId}
        type="target"
        position={data.layout === 'horizontal' ? Position.Left : Position.Top}
        className={handleClassName}
        isConnectable={sourceAndTargetAreConnectable}
        isConnectableStart={false}
        isConnectableEnd={sourceAndTargetAreConnectable}
        aria-label={`Eingang zu ${data.stage.name}`}
        title={`Eingang zu ${data.stage.name}`}
      />
      <Handle
        id={sourceReturnHandleId}
        type="source"
        position={data.layout === 'horizontal' ? Position.Bottom : Position.Right}
        className={cn(handleClassName, 'workflow-graph__handle--return')}
        style={data.layout === 'horizontal' ? { left: '64%' } : { top: '64%' }}
        isConnectable={sourceAndTargetAreConnectable}
        isConnectableStart={sourceAndTargetAreConnectable}
        isConnectableEnd={false}
        aria-label={`Rückweg von ${data.stage.name}`}
        title={`Rückweg von ${data.stage.name}`}
      />
      <Handle
        id={targetReturnHandleId}
        type="target"
        position={data.layout === 'horizontal' ? Position.Bottom : Position.Right}
        className={cn(handleClassName, 'workflow-graph__handle--return-target')}
        style={data.layout === 'horizontal' ? { left: '36%' } : { top: '36%' }}
        isConnectable={sourceAndTargetAreConnectable}
        isConnectableStart={false}
        isConnectableEnd={sourceAndTargetAreConnectable}
        aria-label={`Rückweg zu ${data.stage.name}`}
        title={`Rückweg zu ${data.stage.name}`}
      />

      <button
        type="button"
        data-testid={`workflow-graph-stage-${data.stage.id}`}
        aria-pressed={selected}
        data-review={isReview}
        data-current={data.stage.current || undefined}
        aria-label={data.connecting
          ? data.connectionSource
            ? `Zielphase wählen: ${data.stage.name}`
            : `Ausgangsphase wählen: ${data.stage.name}`
          : `Phase auswählen: ${data.stage.name}`}
        title={data.stage.missing ? `Phasen-ID: ${data.stage.id}` : data.stage.name}
        disabled={data.stage.missing || data.disabled}
        onClick={(event) => {
          event.stopPropagation()
          data.onActivate()
        }}
        className={cn(
          'workflow-graph__node nodrag nopan flex min-h-0 w-full flex-1 flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-card-foreground transition-colors hover:border-primary/55 focus-visible:outline-none',
          runs.length > 0 && 'rounded-b-none border-b-0 pb-1',
          data.connectionSource && 'ring-2 ring-primary/60',
          data.stage.missing && 'cursor-not-allowed border-dashed opacity-70',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="workflow-graph__icon grid size-7 shrink-0 place-items-center rounded-md">
            <StageIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{data.stage.kind}</span>
          {data.stage.statusLabel && <Badge variant={data.stage.current ? 'default' : 'outline'} className="px-1.5 text-[10px]">{data.stage.statusLabel}</Badge>}
          {data.stage.start && !data.stage.statusLabel && <Badge variant="secondary" className="px-1.5 text-[10px]">Startphase</Badge>}
          {data.connectionSource && <Badge variant="secondary" className="px-1.5 text-[10px]">Ausgang</Badge>}
        </span>
        <span className="flex min-h-0 grow items-center overflow-hidden" title={data.stage.name}>
          <span className="line-clamp-2 text-base font-semibold leading-tight [overflow-wrap:anywhere]">{data.stage.name}</span>
        </span>
        <span className="grid min-w-0 gap-1 border-t pt-2 text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={data.stage.profileTitle ?? data.stage.profileLabel}>{data.stage.profileLabel}</span>
          </span>
          {(!data.stage.statusLabel || data.stage.boardLabel !== 'Spalte beibehalten') && <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <Columns3 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={data.stage.boardTitle ?? data.stage.boardLabel}>{data.stage.boardLabel}</span>
          </span>}
        </span>
      </button>
      {runs.length > 0 && <div className="nodrag nopan flex h-9 shrink-0 items-center gap-1 overflow-hidden rounded-b-xl border border-t-0 bg-card px-3 pb-1">
        {runs.length <= 2 ? runs.map((run, i) => (
          <button
            type="button"
            key={run.id}
            data-testid={`workflow-graph-run-${run.id}`}
            aria-label={`Lauf ${i + 1} für ${data.stage.name} öffnen`}
            aria-pressed={run.id === data.stage.selectedRunId}
            className="rounded-md px-2 py-1 text-xs text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent"
            onClick={event => { event.stopPropagation(); data.onSelectRun(run) }}
          >Lauf {i + 1}</button>
        )) : (
          <select
            className="w-full rounded border bg-card px-2 py-1 text-xs text-card-foreground"
            aria-label={`Lauf für ${data.stage.name} wählen`}
            value={data.stage.selectedRunId && runs.some(run => run.id === data.stage.selectedRunId) ? data.stage.selectedRunId : ''}
            onClick={event => event.stopPropagation()}
            onChange={event => {
              const run = runs.find(item => item.id === event.target.value)
              if (run) data.onSelectRun(run)
            }}
          >
            <option value="" disabled>{runs.length} Läufe</option>
            {runs.map((run, i) => <option value={run.id} key={run.id}>Lauf {i + 1} · Versuch {run.attempt_no}</option>)}
          </select>
        )}
      </div>}
    </div>
  )
}

function roundedPolyline(points: { x: number; y: number }[]): { path: string; labelX: number; labelY: number } {
  if (points.length < 2) return { path: '', labelX: 0, labelY: 0 }
  const distances = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  const totalLength = distances.reduce((sum, distance) => sum + distance, 0)
  let remaining = totalLength / 2
  let labelX = points[0].x
  let labelY = points[0].y
  for (let index = 0; index < distances.length; index++) {
    const distance = distances[index]
    if (remaining <= distance) {
      const ratio = distance === 0 ? 0 : remaining / distance
      labelX = points[index].x + (points[index + 1].x - points[index].x) * ratio
      labelY = points[index].y + (points[index + 1].y - points[index].y) * ratio
      break
    }
    remaining -= distance
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y)
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y)
    const radius = Math.min(18, previousLength / 3, nextLength / 3)
    if (radius <= 0) continue
    const before = { x: current.x - ((current.x - previous.x) / previousLength) * radius, y: current.y - ((current.y - previous.y) / previousLength) * radius }
    const after = { x: current.x + ((next.x - current.x) / nextLength) * radius, y: current.y + ((next.y - current.y) / nextLength) * radius }
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`
  }
  const last = points[points.length - 1]
  path += ` L ${last.x} ${last.y}`

  return { path, labelX, labelY }
}

function transitionPath(props: EdgeProps<WorkflowTransitionEdge>): { path: string; labelX: number; labelY: number } {
  const { sourceX, sourceY, targetX, targetY, data } = props
  const lane = data?.lane ?? 0
  const layout = data?.layout ?? 'horizontal'
  if (data?.waypoints?.length) return roundedPolyline([{ x: sourceX, y: sourceY }, ...data.waypoints, { x: targetX, y: targetY }])

  if (layout === 'horizontal') {
    if (data?.isReturn) {
      const laneY = Math.max(sourceY, targetY) + 68 + lane * 72
      return {
        path: `M ${sourceX} ${sourceY} C ${sourceX} ${laneY}, ${targetX} ${laneY}, ${targetX} ${targetY}`,
        labelX: (sourceX + targetX) / 2,
        labelY: laneY,
      }
    }

    const laneY = (sourceY + targetY) / 2 + lane * 54
    const reach = Math.max(28, Math.min(130, Math.abs(targetX - sourceX) * 0.35))
    return {
      path: `M ${sourceX} ${sourceY} C ${sourceX + reach} ${laneY}, ${targetX - reach} ${laneY}, ${targetX} ${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY + 6 * laneY) / 8,
    }
  }

  if (data?.isReturn) {
    const laneX = Math.max(sourceX, targetX) + 42 + lane * 56
    return {
      path: `M ${sourceX} ${sourceY} C ${laneX} ${sourceY}, ${laneX} ${targetY}, ${targetX} ${targetY}`,
      labelX: laneX,
      labelY: (sourceY + targetY) / 2,
    }
  }

  const laneX = (sourceX + targetX) / 2 + lane * 56
  const controlY1 = sourceY + (targetY - sourceY) * 0.35
  const controlY2 = targetY - (targetY - sourceY) * 0.35
  return {
    path: `M ${sourceX} ${sourceY} C ${laneX} ${controlY1}, ${laneX} ${controlY2}, ${targetX} ${targetY}`,
    labelX: (sourceX + targetX + 6 * laneX) / 8,
    labelY: (sourceY + targetY + 3 * controlY1 + 3 * controlY2) / 8,
  }
}

function TransitionEdgeView(props: EdgeProps<WorkflowTransitionEdge>) {
  const data = props.data
  if (!data) return null
  const path = transitionPath(props)
  const color = data.graphKind === 'planned'
    ? data.selectionStatus === 'selected' ? 'var(--primary)' : 'var(--muted-foreground)'
    : outcomeColor(data.outcome, data.isReturn)
  const visitCount = data.eventIndexes?.length ?? 0
  const definitionTestId = data.graphKind === 'definition' ? `workflow-graph-transition-${data.transitionIndex}` : undefined
  const testId = definitionTestId
    ?? (data.graphKind === 'planned' ? `workflow-graph-planned-transition-${data.transitionIndex}` : `workflow-graph-run-route-${data.edgeIndex}`)
  const selectionStatusLabels: Record<NonNullable<WorkflowTransitionEdgeData['selectionStatus']>, string> = {
    selected: 'Gewählt', possible: 'Möglich', not_selected: 'Nicht gewählt', unknown: 'Unbekannt',
  }
  const routeAction = () => {
    if (data.graphKind === 'actual') {
      if (visitCount === 1) {
        const eventIndex = data.eventIndexes?.[0]
        const event = eventIndex === undefined ? undefined : data.selectedVisits?.[0]
        if (eventIndex !== undefined && event) data.onSelectRunTransition?.(eventIndex, event)
      } else if (visitCount > 1) {
        data.onOpenRunVisits?.(data.edgeIndex)
      }
      return
    }
    data.onSelect()
  }

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path.path}
        markerEnd={props.markerEnd}
        interactionWidth={28}
        style={{
          stroke: color,
          strokeWidth: data.graphKind === 'actual' ? 3.2 : props.selected ? 3 : 2.25,
          strokeDasharray: data.graphKind === 'planned' ? '4 5' : data.isReturn ? '7 5' : undefined,
          opacity: data.graphKind === 'actual' ? 0.98 : data.graphKind === 'planned' ? (data.selectionStatus === 'selected' ? 0.8 : 0.42) : props.selected ? 1 : 0.86,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="workflow-graph__edge-label nodrag nopan absolute z-10 pointer-events-auto"
          style={{ transform: `translate(-50%, -50%) translate(${path.labelX}px, ${path.labelY}px)` }}
        >
          <button
            type="button"
            data-testid={testId}
            aria-label={data.accessibleLabel}
            aria-pressed={props.selected}
            title={data.accessibleLabel}
            disabled={data.disabled}
            onClick={(event) => {
              event.stopPropagation()
              routeAction()
            }}
            className={cn(
              'flex max-w-[280px] items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-left text-[10px] font-medium leading-4 text-card-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              props.selected || data.graphKind === 'actual' ? 'border-primary ring-2 ring-primary/35' : 'border-border hover:border-primary/60',
              data.graphKind === 'planned' && 'border-dashed',
              data.isReturn && 'border-dashed',
            )}
          >
            <span className="shrink-0 whitespace-nowrap">{data.outcomeLabel}</span>
            {data.hasRouteLabel && <><span aria-hidden="true" className="shrink-0 text-muted-foreground">·</span><span className="min-w-0 truncate text-muted-foreground">{data.routeLabel}</span></>}
            {data.graphKind === 'planned' && data.selectionStatus && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">{selectionStatusLabels[data.selectionStatus]}</Badge>}
            {data.graphKind === 'actual' && visitCount > 1 && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">×{visitCount}</Badge>}
            {data.conditionsCount > 0 && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">+{data.conditionsCount}</Badge>}
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { workflowStage: StageNodeView }
const edgeTypes = { workflowTransition: TransitionEdgeView }

type WorkflowGraphCanvasProps = {
  transitions: readonly GraphTransition[]
  routeLabels?: readonly WorkflowStageEditorRouteLabel[]
  routeLabelNames?: ReadonlyMap<string, string>
  mode: 'definition' | 'run'
  runActivity?: WorkflowGraphRunActivity
  onSelectRun?: WorkflowGraphProps['onSelectRun']
  onSelectRunTransition?: WorkflowGraphProps['onSelectRunTransition']
  onConnectStages?: WorkflowGraphProps['onConnectStages']
  onReconnectTransition?: WorkflowGraphProps['onReconnectTransition']
  disabled?: boolean
  containerWidth: number
  graphStages: GraphStage[]
  controlledSelection: WorkflowGraphSelection
  setSelection: (selection: WorkflowGraphSelection) => void
}

function WorkflowGraphCanvas({
  transitions,
  routeLabels,
  routeLabelNames,
  mode,
  runActivity,
  onSelectRun,
  onSelectRunTransition,
  onConnectStages,
  onReconnectTransition,
  disabled = false,
  containerWidth,
  graphStages: stageNodes,
  controlledSelection,
  setSelection,
}: WorkflowGraphCanvasProps) {
  const { fitBounds, getNodesBounds, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow<WorkflowStageNode, WorkflowTransitionEdge>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodesInitialized = useNodesInitialized()
  const [connecting, setConnecting] = useState(false)
  const [connectionSource, setConnectionSource] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState('')
  const [openVisitsEdgeIndex, setOpenVisitsEdgeIndex] = useState<number | null>(null)
  const reconnectingTransitionIndex = useRef<number | null>(null)
  const layout: GraphLayout = containerWidth > 0 && containerWidth < 600 ? 'vertical' : 'horizontal'
  const stageIndexById = useMemo(() => new Map(stageNodes.map((stage, index) => [stage.id, index])), [stageNodes])
  const graphLayout = useMemo(() => workflowLayout(
    stageNodes.map((stage) => stage.id),
    transitions,
    layout,
    containerWidth || 1100,
  ), [stageNodes, transitions, layout, containerWidth])
  const onConnectStagesRef = useRef(onConnectStages)
  const onReconnectTransitionRef = useRef(onReconnectTransition)
  onConnectStagesRef.current = onConnectStages
  onReconnectTransitionRef.current = onReconnectTransition

  const graphNodes = useMemo(() => stageNodes.map((stage) => {
    const geometry = graphLayout.nodes.get(stage.id)!
    const isSelected = controlledSelection?.type === 'stage' && controlledSelection.stageId === stage.id
    const isConnectionSource = connectionSource === stage.id

    return {
      id: stage.id,
      type: 'workflowStage' as const,
      position: { x: geometry.x, y: geometry.y },
      style: { width: geometry.width, height: geometry.height },
      draggable: false,
      selectable: false,
      focusable: false,
      data: {
        stage,
        layout,
        nodeWidth: geometry.width,
        canConnect: !disabled && Boolean(onConnectStages || onReconnectTransition),
        disabled,
        connecting,
        connectionSource: isConnectionSource,
        onSelectRun: (run: components['schemas']['TaskFlowRun']) => onSelectRun?.(run),
        onActivate: () => {
          if (stage.missing || disabled) return
          if (connecting && onConnectStages) {
            if (!connectionSource) {
              setConnectionSource(stage.id)
              setConnectionStatus(`Ausgangsphase: ${stage.name}. Wähle die Zielphase.`)
              return
            }
            if (connectionSource === stage.id) {
              setConnectionSource(null)
              setConnectionStatus('Wähle eine Ausgangsphase.')
              return
            }
            if (!canCreateRoute(transitions, connectionSource, stage.id)) {
              setConnectionStatus(`Zwischen ${stage.name} und der gewählten Phase ist keine weitere Standardroute verfügbar.`)
              return
            }
            const sourceName = stageNodes.find((candidate) => candidate.id === connectionSource)?.name ?? 'Phase'
            onConnectStages(connectionSource, stage.id)
            setConnectionStatus(`Übergang von ${sourceName} nach ${stage.name} wird angelegt.`)
            setConnecting(false)
            setConnectionSource(null)
            return
          }
          setSelection({ type: 'stage', stageId: stage.id })
        },
      },
      selected: isSelected,
    } satisfies WorkflowStageNode
  }), [stageNodes, layout, containerWidth, graphLayout, controlledSelection, connectionSource, connecting, onConnectStages, onReconnectTransition, transitions, setSelection, onSelectRun, disabled])

  const graphEdges = useMemo(() => transitions.map((transition, index) => {
    const sourceIndex = stageIndexById.get(transition.from_stage_id) ?? 0
    const targetIndex = stageIndexById.get(transition.to_stage_id) ?? 0
    const isReturn = isReturnTransition(sourceIndex, targetIndex)
    const sourceHandle = isReturn ? sourceReturnHandleId : sourceHandleId
    const targetHandle = isReturn ? targetReturnHandleId : targetHandleId
    const sourceName = stageNodes.find((stage) => stage.id === transition.from_stage_id)?.name ?? 'Phase nicht verfügbar'
    const targetName = stageNodes.find((stage) => stage.id === transition.to_stage_id)?.name ?? 'Phase nicht verfügbar'
    const routeLabel = !transition.route_label_id
      ? 'Standardroute'
      : transition.graphKind === 'actual'
        ? transition.route_label_name ?? routeLabelNames?.get(transition.route_label_id) ?? 'Themenlabel nicht verfügbar'
        : routeLabels === undefined
          ? routeLabelNames?.get(transition.route_label_id) ?? 'Themenlabel wird geprüft'
          : routeLabels.find((label) => label.id === transition.route_label_id && label.active && label.kind === 'topic')?.name
            ?? routeLabelNames?.get(transition.route_label_id)
            ?? 'Themenlabel nicht verfügbar'
    const hasRouteLabel = Boolean(transition.route_label_id)
    const accessibleStatus = transition.graphKind === 'planned' ? `Eingefrorene Route, ${transition.selectionStatus ?? 'Auswahl unbekannt'}` : transition.graphKind === 'actual' ? `${transition.eventIndexes?.length ?? 0} tatsächliche Besuche` : ''
    const accessibleLabel = `${accessibleStatus ? `${accessibleStatus}: ` : ''}${sourceName} → ${targetName}, ${outcomes[transition.on]}, ${routeLabel}${isReturn ? ', Rückweg' : ''}${transition.conditionsCount > 0 ? `, ${transition.conditionsCount} Bedingungen` : ''}`
    const layoutEdge = graphLayout.edges.get(index)
    const selected = mode === 'definition'
      ? controlledSelection?.type === 'transition' && controlledSelection.transitionIndex === transition.transitionIndex
      : transition.graphKind === 'actual' && controlledSelection?.type === 'transition' && Boolean(transition.eventIndexes?.includes(controlledSelection.transitionIndex))

    return {
      id: `workflow-${transition.graphKind}-${index}`,
      type: 'workflowTransition' as const,
      source: transition.from_stage_id,
      target: transition.to_stage_id,
      sourceHandle,
      targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed, color: outcomeColor(transition.on, isReturn) },
      selectable: mode === 'definition' && !disabled,
      focusable: false,
      reconnectable: mode === 'definition' && !disabled && Boolean(onReconnectTransition),
      data: {
        edgeIndex: index,
        graphKind: transition.graphKind,
        transitionIndex: transition.transitionIndex,
        eventIndexes: transition.eventIndexes,
        outcome: transition.on,
        outcomeLabel: outcomes[transition.on],
        routeLabel,
        hasRouteLabel,
        accessibleLabel,
        conditionsCount: transition.conditionsCount,
        disabled: disabled || (mode === 'run' && transition.graphKind === 'planned'),
        isReturn,
        layout,
        lane: layoutEdge?.lane ?? 0,
        waypoints: layoutEdge?.waypoints,
        selectionStatus: transition.selectionStatus,
        selectedVisits: transition.eventIndexes?.flatMap((eventIndex) => runActivity?.selectedTransitions?.[eventIndex] ?? []) ?? [],
        branchHistoryStatus: runActivity?.branchHistoryStatus,
        onSelectRunTransition,
        onOpenRunVisits: setOpenVisitsEdgeIndex,
        onSelect: () => setSelection({ type: 'transition', transitionIndex: transition.transitionIndex ?? index }),
      },
      selected,
    } satisfies WorkflowTransitionEdge
  }), [transitions, stageIndexById, layout, stageNodes, routeLabels, routeLabelNames, graphLayout, controlledSelection, onReconnectTransition, onSelectRunTransition, runActivity, mode, setSelection, disabled])

  const isValidConnection = useCallback((connection: Connection | WorkflowTransitionEdge) => {
    const source = connection.source
    const target = connection.target
    if (disabled || !source || !target || stageNodes.some((stage) => stage.missing && (stage.id === source || stage.id === target))) return false

    const reconnectingIndex = reconnectingTransitionIndex.current
    if (reconnectingIndex !== null && onReconnectTransitionRef.current) {
      return canReconnectRoute(transitions, reconnectingIndex, source, target)
    }

    return Boolean(onConnectStagesRef.current && canCreateRoute(transitions, source, target))
  }, [disabled, stageNodes, transitions])

  const handleConnect = useCallback((connection: Connection) => {
    if (disabled || !onConnectStages || !isValidConnection(connection)) return
    onConnectStages(connection.source, connection.target)
    const sourceName = stageNodes.find((stage) => stage.id === connection.source)?.name ?? 'Phase'
    const targetName = stageNodes.find((stage) => stage.id === connection.target)?.name ?? 'Phase'
    setConnectionStatus(`Übergang von ${sourceName} nach ${targetName} wird angelegt.`)
  }, [disabled, onConnectStages, isValidConnection, stageNodes])

  const handleReconnect = useCallback((edge: WorkflowTransitionEdge, connection: Connection) => {
    const index = edge.data?.transitionIndex
    if (disabled || index === undefined || !onReconnectTransition || !isValidConnection(connection)) return
    onReconnectTransition(index, connection.source, connection.target)
    setConnectionStatus('Der Übergang wird verschoben.')
    setSelection({ type: 'transition', transitionIndex: index })
    reconnectingTransitionIndex.current = null
  }, [disabled, onReconnectTransition, isValidConnection, setSelection])

  const currentDefinition = `${mode}:${layout}:${stageNodes.map((stage) => stage.id).join(',')}:${transitions.map((transition) => `${transition.graphKind}:${transition.from_stage_id}>${transition.to_stage_id}:${transition.on}:${transition.route_label_id ?? ''}:${transition.eventIndexes?.join('.') ?? ''}`).join(',')}`
  const fitGraph = useCallback((duration = 180) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!canvasRef.current || graphNodes.length === 0) return
      const nodesBounds = getNodesBounds(graphNodes)
      const layoutNodes = [...graphLayout.nodes.values()]
      if (layoutNodes.length === 0) return
      let minX = Math.min(...layoutNodes.map((node) => node.x))
      let minY = Math.min(...layoutNodes.map((node) => node.y))
      let maxX = Math.max(...layoutNodes.map((node) => node.x + node.width))
      let maxY = Math.max(...layoutNodes.map((node) => node.y + node.height))
      if (nodesBounds.width > 0 && nodesBounds.height > 0) {
        minX = Math.min(minX, nodesBounds.x)
        minY = Math.min(minY, nodesBounds.y)
        maxX = Math.max(maxX, nodesBounds.x + nodesBounds.width)
        maxY = Math.max(maxY, nodesBounds.y + nodesBounds.height)
      }
      const labels = canvasRef.current.querySelectorAll<HTMLElement>('.workflow-graph__edge-label')
      for (const label of labels) {
        const box = label.getBoundingClientRect()
        const topLeft = screenToFlowPosition({ x: box.left, y: box.top })
        const bottomRight = screenToFlowPosition({ x: box.right, y: box.bottom })
        minX = Math.min(minX, topLeft.x - 10)
        minY = Math.min(minY, topLeft.y - 10)
        maxX = Math.max(maxX, bottomRight.x + 10)
        maxY = Math.max(maxY, bottomRight.y + 10)
      }
      for (const edge of graphLayout.edges.values()) {
        for (const waypoint of edge.waypoints ?? []) {
          minX = Math.min(minX, waypoint.x)
          minY = Math.min(minY, waypoint.y)
          maxX = Math.max(maxX, waypoint.x)
          maxY = Math.max(maxY, waypoint.y)
        }
      }
      if (maxX <= minX || maxY <= minY) return
      void fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.035, duration })
    }))
  }, [fitBounds, graphNodes, graphLayout, screenToFlowPosition, getNodesBounds])

  useEffect(() => {
    if (graphNodes.length === 0 || !nodesInitialized) return
    const frame = window.requestAnimationFrame(() => fitGraph(250))

    return () => window.cancelAnimationFrame(frame)
  }, [fitGraph, currentDefinition, containerWidth, graphNodes.length, nodesInitialized])

  const cancelConnectionMode = useCallback(() => {
    setConnecting(false)
    setConnectionSource(null)
    setConnectionStatus('Phasenverbindung abgebrochen.')
  }, [])

  const openVisits = openVisitsEdgeIndex === null ? null : transitions[openVisitsEdgeIndex]
  const visitEvents = openVisits?.graphKind === 'actual'
    ? openVisits.eventIndexes?.flatMap((index) => runActivity?.selectedTransitions?.[index] ? [{ index, event: runActivity.selectedTransitions[index] }] : []) ?? []
    : []
  const visitRuns = new Map((runActivity?.runs ?? []).map((run) => [run.id, run]))
  const runReports = new Map((runActivity?.runs ?? []).flatMap((run) => run.reports.map((report) => [report.id, { report, run }] as const)))

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && connecting) {
      event.preventDefault()
      cancelConnectionMode()
      return
    }

    if (event.target !== event.currentTarget) return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      void zoomIn({ duration: 120 })
    } else if (event.key === '-') {
      event.preventDefault()
      void zoomOut({ duration: 120 })
    } else if (event.key === 'Home') {
      event.preventDefault()
      fitGraph()
    }
  }

  return (
    <div
      ref={canvasRef}
      className="absolute inset-0"
      data-testid="workflow-editor-graph-canvas"
      role="group"
      aria-label="Workflowgraph-Steuerung"
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <div className="absolute inset-x-0 top-0 z-20 flex h-13 items-center justify-end gap-1 border-b bg-card/95 px-2 shadow-sm backdrop-blur">
        {onConnectStages && (
          <Button
            type="button"
            variant={connecting ? 'secondary' : 'outline'}
            size="sm"
            data-testid="workflow-graph-connect-mode"
            aria-pressed={connecting}
            aria-label={connecting ? 'Phasenverbindung abbrechen' : 'Phasen verbinden'}
            disabled={disabled}
            onClick={() => {
              if (connecting) {
                cancelConnectionMode()
                return
              }
              setSelection(null)
              setConnecting(true)
              setConnectionSource(null)
              setConnectionStatus('Wähle die Ausgangsphase.')
            }}
          >
            {connecting ? <X /> : <GitBranch />}
            <span className="hidden sm:inline">{connecting ? 'Abbrechen' : 'Verbinden'}</span>
          </Button>
        )}
        <span className="mr-auto min-w-0 truncate pl-2 text-xs text-muted-foreground" aria-live="polite">{connecting ? connectionStatus || 'Wähle die Ausgangsphase.' : mode === 'run' ? `Eingefrorener Ablauf${runActivity?.branchHistoryStatus === 'partial' ? ' · Übergangshistorie teilweise' : runActivity?.branchHistoryStatus === 'not_recorded' ? ' · keine Übergangshistorie' : ''}` : 'Phasengraph'}</span>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Diagramm vergrößern" title="Diagramm vergrößern · +" aria-keyshortcuts="+" disabled={disabled} onClick={() => void zoomIn({ duration: 120 })}>
          <ZoomIn />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Diagramm verkleinern" title="Diagramm verkleinern · −" aria-keyshortcuts="-" disabled={disabled} onClick={() => void zoomOut({ duration: 120 })}>
          <ZoomOut />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Diagramm einpassen" title="Diagramm einpassen · Pos1" aria-keyshortcuts="Home" disabled={disabled} onClick={() => fitGraph()}>
          <Maximize2 />
        </Button>
      </div>

      <div className="absolute inset-x-0 bottom-0 top-[3.25rem]" data-testid="workflow-editor-graph-pane">
      <div className="sr-only" aria-live="polite">{connectionStatus}</div>
      <ReactFlow<WorkflowStageNode, WorkflowTransitionEdge>
        nodes={graphNodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_event, node) => {
          if (disabled || node.data.stage.missing) return
          node.data.onActivate()
        }}
        onEdgeClick={(_event, edge) => {
          const edgeIndex = edge.data?.edgeIndex
          if (disabled || edgeIndex === undefined) return
          const transition = transitions[edgeIndex]
          if (transition?.graphKind === 'actual') {
            if (transition.eventIndexes?.length === 1) {
              const eventIndex = transition.eventIndexes[0]
              const event = runActivity?.selectedTransitions?.[eventIndex]
              if (event) onSelectRunTransition?.(eventIndex, event)
            } else if ((transition.eventIndexes?.length ?? 0) > 1) setOpenVisitsEdgeIndex(edgeIndex)
          } else if (mode === 'definition' && transition?.transitionIndex !== undefined) {
            setSelection({ type: 'transition', transitionIndex: transition.transitionIndex })
          }
        }}
        onPaneClick={() => {
          if (!disabled && !connecting) setSelection(null)
        }}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onReconnectStart={(_event, edge) => {
          reconnectingTransitionIndex.current = edge.data?.transitionIndex ?? null
          setConnectionStatus(`Übergang von ${stageNodes.find((stage) => stage.id === edge.source)?.name ?? 'Phase'} verschieben.`)
        }}
        onReconnect={handleReconnect}
        onReconnectEnd={() => {
          reconnectingTransitionIndex.current = null
        }}
        nodesDraggable={false}
        nodesConnectable={!disabled && Boolean(onConnectStages || onReconnectTransition)}
        edgesReconnectable={mode === 'definition' && !disabled && Boolean(onReconnectTransition)}
        elementsSelectable={!disabled && mode === 'definition'}
        connectOnClick={!disabled && Boolean(onConnectStages)}
        connectionRadius={32}
        panOnDrag={!disabled}
        zoomOnScroll={false}
        zoomOnPinch={!disabled}
        minZoom={0.045}
        elevateEdgesOnSelect={false}
        maxZoom={1.4}
        deleteKeyCode={null}
        selectionKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.045, maxZoom: 1.15 }}
        className="workflow-graph__flow"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      </ReactFlow>

      {visitEvents.length > 1 && <div role="dialog" aria-label="Tatsächliche Übergangsbesuche" className="absolute bottom-2 left-2 right-2 z-30 max-h-[42%] overflow-auto rounded-lg border bg-card/98 p-3 text-card-foreground shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Besuch auswählen · {visitEvents.length} tatsächliche Übergänge</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpenVisitsEdgeIndex(null)}>Schließen</Button>
        </div>
        <ol className="space-y-1.5">{visitEvents.map(({ index, event }, ordinal) => {
          const run = visitRuns.get(event.source_run_id)
          const linkedReport = event.report_id ? runReports.get(event.report_id)?.report : undefined
          return <li key={`${event.source_run_id}-${event.selected_at}-${index}`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto w-full justify-between gap-3 py-2 text-left"
              data-testid={`workflow-graph-run-transition-${index}`}
              aria-label={`Tatsächlichen Besuch ${ordinal + 1} aus Lauf ${run?.attempt_no ?? 'unbekannt'} öffnen`}
              onClick={() => {
                onSelectRunTransition?.(index, event)
                setOpenVisitsEdgeIndex(null)
              }}
            >
              <span className="min-w-0 truncate">Besuch {ordinal + 1} · {run ? `${run.attempt_no ? `Versuch ${run.attempt_no}` : 'Lauf'} · ${run.state.replaceAll('_', ' ')}` : 'Laufdetails nicht verfügbar'}{linkedReport ? ` · Meldung: ${linkedReport.outcome.replaceAll('_', ' ')}` : event.report_id ? ' · Zugeordnete Meldung fehlt' : ''}{run?.handoff ? ' · Übergabeprotokoll vorhanden' : ''}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.selected_at))}</span>
            </Button>
          </li>
        })}</ol>
      </div>}
      </div>
      <p className="sr-only">Mit Tab zu Phase oder Übergang wechseln; Eingabetaste oder Leertaste wählt aus. Plus und Minus ändern Zoom, Pos1 passt das Diagramm ein. Escape bricht eine Verbindungsauswahl ab.</p>
    </div>
  )
}

export function WorkflowGraph({
  stages,
  transitions,
  profiles,
  boardColumns,
  routeLabels,
  routeLabelNames,
  mode = 'definition',
  runActivity,
  selectedRunId = null,
  onSelectRun,
  onSelectRunTransition,
  selection,
  onSelect,
  onConnectStages,
  onReconnectTransition,
  disabled = false,
  className,
  label = 'Phasengraph',
}: WorkflowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const [containerWidth, setContainerWidth] = useState(0)
  const [localSelection, setLocalSelection] = useState<WorkflowGraphSelection>(null)
  const definitionTransitions = transitions ?? []
  const graphTransitions = useMemo(() => mode === 'run'
    ? graphTransitionsFromRun(runActivity)
    : graphTransitionsFromDefinition(definitionTransitions), [mode, runActivity, definitionTransitions])
  const graphStagesData = useMemo(() => graphStages(stages, graphTransitions, profiles, boardColumns, mode, runActivity, selectedRunId), [stages, graphTransitions, profiles, boardColumns, mode, runActivity, selectedRunId])
  const controlledSelection = selection === undefined ? localSelection : selection

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const setSelection = useCallback((nextSelection: WorkflowGraphSelection) => {
    if (disabled) return
    onSelect?.(nextSelection)
    if (selection === undefined) setLocalSelection(nextSelection)
  }, [disabled, onSelect, selection])

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setSelection(null)
    }
  }

  const widthForLayout = containerWidth || 1100
  const vertical = containerWidth > 0 && containerWidth < 600
  const verticalGraphHeight = 52 + Math.max(0, stages.length - 1) * verticalStep + nodeHeight + 52

  return (
    <section
      ref={containerRef}
      role="region"
      aria-label={label}
      aria-describedby={instructionsId}
      aria-disabled={disabled}
      data-testid="workflow-editor-graph"
      style={vertical ? { height: `${Math.max(384, verticalGraphHeight)}px` } : undefined}
      onKeyDown={handleKeyboard}
      className={cn('fw-workflow-graph relative h-[min(60vh,36rem)] min-h-[24rem] w-full min-w-0 overflow-hidden rounded-xl border bg-background', className)}
    >
      {stages.length === 0 ? (
        <div className="flex h-full min-h-[24rem] items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Füge eine Phase hinzu, um den Workflowgraph zu sehen.
        </div>
      ) : (
        <ReactFlowProvider>
          <WorkflowGraphCanvas
            transitions={graphTransitions}
            routeLabels={routeLabels}
            routeLabelNames={routeLabelNames}
            mode={mode}
            runActivity={runActivity}
            onSelectRun={onSelectRun}
            onSelectRunTransition={onSelectRunTransition}
            onConnectStages={onConnectStages}
            onReconnectTransition={onReconnectTransition}
            disabled={disabled}
            containerWidth={widthForLayout}
            graphStages={graphStagesData}
            controlledSelection={controlledSelection}
            setSelection={setSelection}
          />
        </ReactFlowProvider>
      )}
      <p id={instructionsId} className="sr-only">Mit Tab zu Phase oder Übergang wechseln. Eingabetaste oder Leertaste wählt aus. Zoom über Werkzeugleiste oder Plus/Minus, Diagramm einpassen über Pos1.</p>
    </section>
  )
}
