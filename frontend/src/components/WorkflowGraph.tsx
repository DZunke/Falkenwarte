import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
import { workflowGraphOutcomeLabels as outcomes, workflowGraphPhaseStatusLabels as phaseStatusLabels, workflowGraphSelectionStatusLabels as selectionStatusLabels } from '@/components/WorkflowGraphLabels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
  | { type: 'plannedTransition'; transitionIndex: number }
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
  mobileNavigation?: (context: WorkflowGraphMobileContext) => ReactNode
  mode?: 'definition' | 'run'
  runActivity?: WorkflowGraphRunActivity
  selectedRunId?: string | null
  onSelectRun?: (run: components['schemas']['TaskFlowRun']) => void
  onSelectRunTransition?: (index: number, event: components['schemas']['TaskFlowSelectedTransition']) => void
  onSelectPlannedTransition?: (candidateIndex: number) => void
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
  routeLabel: string
  outcomeLabel: string
  conditionsCount: number
  graphKind: 'definition' | 'planned' | 'actual'
  selectionStatus?: components['schemas']['TaskFlowCandidateTransition']['selection_status']
  selectionStatusLabel?: string
  transitionIndex?: number
  eventIndexes?: number[]
}

type GraphRouteBundleItem = {
  id: string
  transitionIndex: number
  accessibleLabel: string
  outcomeLabel: string
  routeLabel: string
  selectionStatus?: components['schemas']['TaskFlowCandidateTransition']['selection_status']
  conditionsCount: number
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
  status?: components['schemas']['TaskFlowPhase']['status']
  blockerReason?: string | null
  profileLabel: string
  profileTitle?: string
  boardLabel: string
  boardTitle?: string
  runs: components['schemas']['TaskFlowRun'][]
  selectedRunId: string | null
}

export type WorkflowGraphMobileStage = GraphStage
export type WorkflowGraphMobileTransition = GraphTransition

export type WorkflowGraphMobileContext = {
  stages: readonly WorkflowGraphMobileStage[]
  transitions: readonly WorkflowGraphMobileTransition[]
  mode: 'definition' | 'run'
  runActivity?: WorkflowGraphRunActivity
  selectedRunId: string | null
  routeLabels?: readonly WorkflowStageEditorRouteLabel[]
  routeLabelNames?: ReadonlyMap<string, string>
  selection: WorkflowGraphSelection
  disabled: boolean
  onSelect: (selection: WorkflowGraphSelection) => void
  onSelectRun?: WorkflowGraphProps['onSelectRun']
  onSelectRunTransition?: WorkflowGraphProps['onSelectRunTransition']
  onSelectPlannedTransition?: WorkflowGraphProps['onSelectPlannedTransition']
  onConnectStages?: WorkflowGraphProps['onConnectStages']
  onReconnectTransition?: WorkflowGraphProps['onReconnectTransition']
}

type WorkflowStageNodeData = {
  stage: GraphStage
  layout: GraphLayout
  nodeWidth: number
  canConnect: boolean
  disabled: boolean
  connecting: boolean
  connectionSource: boolean
  hasConnectionSource: boolean
  connectionTargetAvailable: boolean
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
  labelMaxWidth: number
  waypoints?: { x: number; y: number }[]
  selectionStatus?: components['schemas']['TaskFlowCandidateTransition']['selection_status']
  selectedVisits?: components['schemas']['TaskFlowSelectedTransition'][]
  branchHistoryStatus?: components['schemas']['TaskFlowWorkflowInstance']['branch_history_status']
  onSelectRunTransition?: WorkflowGraphProps['onSelectRunTransition']
  onSelectPlannedTransition?: WorkflowGraphProps['onSelectPlannedTransition']
  onOpenRunVisits?: (edgeIndex: number) => void
  bundleId?: string
  bundleLabel?: string
  bundleAccessibleLabel?: string
  bundleRouteLabel?: string
  bundleSourceIndex?: number
  bundleTargetIndex?: number
  bundleLeader?: boolean
  bundleItems?: GraphRouteBundleItem[]
  onSelectBundleTransition?: (transitionIndex: number) => void
  onSelect: () => void
}

type WorkflowTransitionEdge = Edge<WorkflowTransitionEdgeData, 'workflowTransition'>

const nodeHeight = 164
const verticalStep = 250

const sourceHandleId = 'workflow-source-main'
const targetHandleId = 'workflow-target-main'
const sourceReturnHandleId = 'workflow-source-return'
const targetReturnHandleId = 'workflow-target-return'

function outcomeColor(outcome: PhaseOutcome, isReturn = false): string {
  if (isReturn || outcome === 'needs_changes') return 'var(--workflow-return)'
  if (outcome === 'blocked' || outcome === 'failed') return 'var(--destructive)'

  return 'var(--primary)'
}

function routeBundleStatusLabel(status?: GraphRouteBundleItem['selectionStatus']): string {
  if (!status || status === 'unknown') return 'Auswahlstatus unbekannt'
  if (status === 'possible') return 'Bisher unbesucht'
  if (status === 'not_selected') return 'Nicht gewählt'

  return 'Als Übergang gewählt'
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
      status,
      blockerReason: 'blocker_reason' in stage ? stage.blocker_reason : null,
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

function resolvedRouteLabel(
  routeLabelId: string | null | undefined,
  graphKind: GraphTransition['graphKind'],
  routeLabelName: string | null | undefined,
  routeLabels: readonly WorkflowStageEditorRouteLabel[] | undefined,
  routeLabelNames: ReadonlyMap<string, string> | undefined,
): string {
  if (!routeLabelId) return 'Standardroute'
  if (graphKind === 'actual') return routeLabelName ?? routeLabelNames?.get(routeLabelId) ?? 'Themenlabel nicht verfügbar'
  if (routeLabels === undefined) return routeLabelNames?.get(routeLabelId) ?? 'Themenlabel wird geprüft'

  return routeLabels.find((label) => label.id === routeLabelId && label.active && label.kind === 'topic')?.name
    ?? routeLabelNames?.get(routeLabelId)
    ?? 'Themenlabel nicht verfügbar'
}

function graphTransitionsFromDefinition(
  transitions: readonly WorkflowStageEditorTransition[],
  routeLabels: readonly WorkflowStageEditorRouteLabel[] | undefined,
  routeLabelNames: ReadonlyMap<string, string> | undefined,
): GraphTransition[] {
  return transitions.map((transition, transitionIndex) => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    route_label_id: transition.route_label_id ?? null,
    routeLabel: resolvedRouteLabel(transition.route_label_id, 'definition', undefined, routeLabels, routeLabelNames),
    outcomeLabel: outcomes[transition.on],
    conditionsCount: transition.conditions.length,
    graphKind: 'definition',
    transitionIndex,
  }))
}

function graphTransitionsFromRun(
  activity: WorkflowGraphRunActivity | undefined,
  routeLabels: readonly WorkflowStageEditorRouteLabel[] | undefined,
  routeLabelNames: ReadonlyMap<string, string> | undefined,
): GraphTransition[] {
  if (!activity) return []
  const pathKey = (fromStageId: string, toStageId: string, outcome: PhaseOutcome, routeLabelId?: string | null, routeLabelName?: string | null) => {
    const labelKey = routeLabelId ? ['id', routeLabelId] : routeLabelName ? ['name', routeLabelName] : null
    return JSON.stringify([fromStageId, toStageId, outcome, labelKey])
  }
  const planned = activity.plannedTransitions.map((transition, transitionIndex): GraphTransition => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.on,
    route_label_id: transition.route_label_id ?? null,
    routeLabel: resolvedRouteLabel(transition.route_label_id, 'planned', undefined, routeLabels, routeLabelNames),
    outcomeLabel: outcomes[transition.on],
    conditionsCount: transition.conditions.length,
    graphKind: 'planned',
    selectionStatus: transition.selection_status,
    selectionStatusLabel: selectionStatusLabels[transition.selection_status],
    transitionIndex,
  }))
  const actualGroups = new Map<string, { transition: components['schemas']['TaskFlowSelectedTransition']; indexes: number[] }>()
  for (const [index, event] of (activity.selectedTransitions ?? []).entries()) {
    const key = pathKey(event.from_stage_id, event.to_stage_id, event.outcome, event.route_label_id, event.route_label_name)
    const group = actualGroups.get(key) ?? { transition: event, indexes: [] }
    group.indexes.push(index)
    actualGroups.set(key, group)
  }
  // Candidate status alone does not prove a visit; only a recorded event replaces an exact planned path.
  const actualPathKeys = new Set(actualGroups.keys())
  const unvisitedPlanned = planned.filter((transition) => !actualPathKeys.has(
    pathKey(transition.from_stage_id, transition.to_stage_id, transition.on, transition.route_label_id),
  ))
  const actual = [...actualGroups.values()].map(({ transition, indexes }): GraphTransition => ({
    from_stage_id: transition.from_stage_id,
    to_stage_id: transition.to_stage_id,
    on: transition.outcome,
    route_label_id: transition.route_label_id ?? null,
    route_label_name: transition.route_label_name,
    routeLabel: resolvedRouteLabel(transition.route_label_id, 'actual', transition.route_label_name, routeLabels, routeLabelNames),
    outcomeLabel: outcomes[transition.outcome],
    conditionsCount: 0,
    graphKind: 'actual',
    eventIndexes: indexes,
  }))

  return [...unvisitedPlanned, ...actual]
}

function isReturnTransition(sourceIndex: number, targetIndex: number): boolean {
  return targetIndex <= sourceIndex
}

type RouteBundleMetadata = {
  id: string
  sourceStageIndex: number
  targetStageIndex: number
  memberIndexes: number[]
  isLeader: boolean
  hasActualSibling: boolean
}

function routeBundleMetadata(
  transitions: readonly GraphTransition[],
  mode: 'definition' | 'run',
  stageIndexById: ReadonlyMap<string, number>,
  layout: GraphLayout,
): Map<number, RouteBundleMetadata> {
  const byPair = new Map<string, { id: string; sourceStageIndex: number; targetStageIndex: number; all: number[]; planned: number[] }>()
  transitions.forEach((transition, index) => {
    const sourceIndex = stageIndexById.get(transition.from_stage_id) ?? 0
    const targetIndex = stageIndexById.get(transition.to_stage_id) ?? 0
    const id = `${sourceIndex}-${targetIndex}`
    const group = byPair.get(id) ?? { id, sourceStageIndex: sourceIndex, targetStageIndex: targetIndex, all: [], planned: [] }
    group.all.push(index)
    if (transition.graphKind === 'planned') group.planned.push(index)
    byPair.set(id, group)
  })

  const denseGraph = transitions.length >= 8 || [...byPair.values()].some((group) => group.all.length >= 3)
  const metadata = new Map<number, RouteBundleMetadata>()
  for (const group of byPair.values()) {
    const memberIndexes = mode === 'definition' ? group.all : group.planned
    const actualCount = mode === 'run'
      ? group.all.filter((index) => transitions[index].graphKind === 'actual').length
      : 0
    const shouldBundle = mode === 'definition'
      ? memberIndexes.length >= 3 || (layout === 'vertical' && denseGraph && memberIndexes.length >= 2)
      : memberIndexes.length >= 3
        || (memberIndexes.length >= 2 && actualCount > 0)
        || (layout === 'vertical' && denseGraph && memberIndexes.length >= 2)
    if (!shouldBundle) continue

    const leaderIndex = memberIndexes[0]
    for (const index of memberIndexes) metadata.set(index, {
      id: group.id,
      sourceStageIndex: group.sourceStageIndex,
      targetStageIndex: group.targetStageIndex,
      memberIndexes,
      isLeader: index === leaderIndex,
      hasActualSibling: actualCount > 0,
    })
  }

  return metadata
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
            ? `Ausgangsphase ausgewählt: ${data.stage.name}`
            : data.hasConnectionSource
              ? data.connectionTargetAvailable
                ? `Zielphase wählen: ${data.stage.name}`
                : `Kein Übergang nach ${data.stage.name} verfügbar`
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
          <span lang="de" className="line-clamp-2 hyphens-auto text-base font-semibold leading-tight [overflow-wrap:anywhere]">{data.stage.name}</span>
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
        labelY: (sourceY + 6 * laneY + targetY) / 8,
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
      labelX: (sourceX + 6 * laneX + targetX) / 8,
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
  const [selectedBundleItem, setSelectedBundleItem] = useState<GraphRouteBundleItem | null>(null)
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
    if (data.graphKind === 'planned') {
      if (data.transitionIndex !== undefined) data.onSelectPlannedTransition?.(data.transitionIndex)
      return
    }
    data.onSelect()
  }

  const chooseBundleItem = (item: GraphRouteBundleItem, event: { preventDefault: () => void }) => {
    if (data.graphKind === 'planned') {
      setSelectedBundleItem(item)
      data.onSelectPlannedTransition?.(item.transitionIndex)
      event.preventDefault()
    } else {
      data.onSelectBundleTransition?.(item.transitionIndex)
    }
  }

  if (data.bundleLeader && data.bundleId && data.bundleItems?.length) {
    return <DropdownMenu>
      <EdgeLabelRenderer>
        <div
          className="workflow-graph__edge-label nodrag nopan absolute z-10 pointer-events-auto"
          style={{ transform: `translate(-50%, -50%) translate(${path.labelX}px, ${path.labelY}px)` }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid={`workflow-graph-route-bundle-${data.bundleSourceIndex}-${data.bundleTargetIndex}`}
              aria-label={data.bundleAccessibleLabel}
              title={data.bundleAccessibleLabel}
              disabled={data.disabled}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'flex min-h-9 min-w-28 items-center justify-center gap-1.5 overflow-hidden rounded-full border bg-card px-3 py-1 text-xs font-semibold text-card-foreground shadow-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                data.graphKind === 'planned' ? 'border-dashed border-primary/60' : 'border-primary/60',
                data.isReturn && 'border-dashed',
              )}
            >
              <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{data.bundleLabel}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid={`workflow-graph-route-bundle-detail-${data.bundleSourceIndex}-${data.bundleTargetIndex}`}
            align="center"
            sideOffset={6}
            className="w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-1rem)]"
          >
            <DropdownMenuLabel className="whitespace-normal px-2 py-1.5 text-xs leading-5">
              {data.graphKind === 'planned' ? 'Bisher unbesuchte Routen' : 'Ergebnisrouten'}
              <span className="mt-0.5 block font-normal text-muted-foreground">{data.bundleRouteLabel}</span>
            </DropdownMenuLabel>
            {data.graphKind === 'planned' && <DropdownMenuSeparator />}
            {selectedBundleItem && data.graphKind === 'planned' && <div data-testid={`workflow-graph-route-bundle-selection-${data.bundleSourceIndex}-${data.bundleTargetIndex}`} role="status" className="mx-1 mb-1 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
              <p className="font-medium">Route aus gespeicherter Definition</p>
              <p className="mt-0.5 break-words">{selectedBundleItem.outcomeLabel} · {selectedBundleItem.routeLabel}</p>
              <p className="mt-0.5 text-muted-foreground">{routeBundleStatusLabel(selectedBundleItem.selectionStatus)} · Diese Auswahl im Diagramm startet keinen Auftrag. Wird erst nach einer tatsächlichen Auswahl ausgeführt.</p>
            </div>}
            {data.bundleItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                data-testid={`workflow-graph-route-bundle-item-${data.bundleSourceIndex}-${data.bundleTargetIndex}-${item.transitionIndex}`}
                aria-label={item.accessibleLabel}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onSelect={(event) => {
                  event.stopPropagation()
                  chooseBundleItem(item, event)
                }}
                className="flex h-auto min-h-12 items-start gap-2 whitespace-normal px-2.5 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{item.outcomeLabel} · {item.routeLabel}</span>
                  {item.conditionsCount > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{item.conditionsCount} zusätzliche Bedingungen</span>}
                </span>
                {item.selectionStatus && <Badge variant={item.selectionStatus === 'selected' ? 'secondary' : 'outline'} className="shrink-0">{routeBundleStatusLabel(item.selectionStatus)}</Badge>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </div>
      </EdgeLabelRenderer>
    </DropdownMenu>
  }

  if (data.bundleId) return <BaseEdge
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
            style={{ maxWidth: data.labelMaxWidth }}
            onClick={(event) => {
              event.stopPropagation()
              routeAction()
            }}
            className={cn(
              'flex min-h-8 min-w-24 max-w-[280px] items-center gap-1.5 overflow-hidden rounded-full border bg-card px-2 py-1 text-left text-[10px] font-medium leading-4 text-card-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
  onSelectPlannedTransition?: WorkflowGraphProps['onSelectPlannedTransition']
  onConnectStages?: WorkflowGraphProps['onConnectStages']
  onReconnectTransition?: WorkflowGraphProps['onReconnectTransition']
  disabled?: boolean
  containerWidth: number
  containerHeight: number
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
  onSelectPlannedTransition,
  onConnectStages,
  onReconnectTransition,
  disabled = false,
  containerWidth,
  containerHeight,
  graphStages: stageNodes,
  controlledSelection,
  setSelection,
}: WorkflowGraphCanvasProps) {
  const { fitBounds, getNodesBounds, zoomIn, zoomOut, screenToFlowPosition, viewportInitialized } = useReactFlow<WorkflowStageNode, WorkflowTransitionEdge>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const fitApiRef = useRef({ fitBounds, getNodesBounds, screenToFlowPosition })
  fitApiRef.current = { fitBounds, getNodesBounds, screenToFlowPosition }
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
      width: geometry.width,
      height: geometry.height,
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
        hasConnectionSource: Boolean(connectionSource),
        connectionTargetAvailable: Boolean(connectionSource && !stage.missing
          && connectionSource !== stage.id
          && canCreateRoute(transitions, connectionSource, stage.id)),
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
  const fitDataRef = useRef({ nodes: graphNodes, layout: graphLayout })
  fitDataRef.current = { nodes: graphNodes, layout: graphLayout }

  const graphEdges = useMemo(() => {
    const bundleByIndex = routeBundleMetadata(transitions, mode, stageIndexById, layout)
    const edgeDetails = transitions.map((transition) => {
      const sourceIndex = stageIndexById.get(transition.from_stage_id) ?? 0
      const targetIndex = stageIndexById.get(transition.to_stage_id) ?? 0
      const isReturn = isReturnTransition(sourceIndex, targetIndex)
      const sourceName = stageNodes.find((stage) => stage.id === transition.from_stage_id)?.name ?? 'Phase nicht verfügbar'
      const targetName = stageNodes.find((stage) => stage.id === transition.to_stage_id)?.name ?? 'Phase nicht verfügbar'
      const accessibleStatus = transition.graphKind === 'planned'
        ? `Eingefrorene Route, ${transition.selectionStatusLabel ?? selectionStatusLabels[transition.selectionStatus ?? 'unknown']}`
        : transition.graphKind === 'actual' ? `${transition.eventIndexes?.length ?? 0} tatsächliche Besuche` : ''
      const accessibleLabel = `${accessibleStatus ? `${accessibleStatus}: ` : ''}${sourceName} → ${targetName}, ${transition.outcomeLabel}, ${transition.routeLabel}${isReturn ? ', Rückweg' : ''}${transition.conditionsCount > 0 ? `, ${transition.conditionsCount} Bedingungen` : ''}`

      return { transition, sourceIndex, targetIndex, isReturn, sourceName, targetName, accessibleLabel }
    })
    const bundleItemsById = new Map<string, GraphRouteBundleItem[]>()
    for (const metadata of bundleByIndex.values()) {
      if (!metadata.isLeader) continue
      bundleItemsById.set(metadata.id, metadata.memberIndexes.map((memberIndex) => {
        const detail = edgeDetails[memberIndex]
        const transitionIndex = detail.transition.transitionIndex ?? memberIndex
        return {
          id: `${metadata.id}-${transitionIndex}`,
          transitionIndex,
          accessibleLabel: detail.accessibleLabel,
          outcomeLabel: detail.transition.outcomeLabel,
          routeLabel: detail.transition.routeLabel,
          selectionStatus: detail.transition.selectionStatus,
          selectionStatusLabel: detail.transition.selectionStatusLabel,
          conditionsCount: detail.transition.conditionsCount,
        }
      }))
    }

    return edgeDetails.map((detail, index) => {
      const { transition, isReturn } = detail
      const metadata = bundleByIndex.get(index)
      const bundleItems = metadata?.isLeader ? bundleItemsById.get(metadata.id) : undefined
      const sourceHandle = isReturn ? sourceReturnHandleId : sourceHandleId
      const targetHandle = isReturn ? targetReturnHandleId : targetHandleId
      const layoutEdge = graphLayout.edges.get(index)
      const selected = mode === 'definition'
        ? controlledSelection?.type === 'transition' && controlledSelection.transitionIndex === transition.transitionIndex
        : transition.graphKind === 'planned'
          ? controlledSelection?.type === 'plannedTransition' && controlledSelection.transitionIndex === transition.transitionIndex
          : transition.graphKind === 'actual' && controlledSelection?.type === 'transition' && Boolean(transition.eventIndexes?.includes(controlledSelection.transitionIndex))
      const bundleLabel = metadata && bundleItems
        ? mode === 'definition'
          ? `${bundleItems.length} Routen`
          : metadata.hasActualSibling
            ? `${bundleItems.length} weitere Routen`
            : `${bundleItems.length} mögliche Routen`
        : undefined
      const bundleAccessibleLabel = metadata && bundleItems
        ? `${bundleItems.length} ${mode === 'definition' ? 'Ergebnisrouten' : metadata.hasActualSibling ? 'weitere geplante Routen' : 'mögliche Routen'} zwischen ${detail.sourceName} und ${detail.targetName} anzeigen`
        : undefined
      const bundleRouteLabel = metadata ? `${detail.sourceName} → ${detail.targetName}` : undefined

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
          outcomeLabel: transition.outcomeLabel,
          routeLabel: transition.routeLabel,
          hasRouteLabel: Boolean(transition.route_label_id),
          accessibleLabel: detail.accessibleLabel,
          conditionsCount: transition.conditionsCount,
          disabled,
          isReturn,
          layout,
          lane: layoutEdge?.lane ?? 0,
          labelMaxWidth: layoutEdge?.labelMaxWidth ?? 112,
          waypoints: layoutEdge?.waypoints,
          selectionStatus: transition.selectionStatus,
          selectedVisits: transition.eventIndexes?.flatMap((eventIndex) => runActivity?.selectedTransitions?.[eventIndex] ?? []) ?? [],
          branchHistoryStatus: runActivity?.branchHistoryStatus,
          onSelectRunTransition,
          onSelectPlannedTransition,
          onOpenRunVisits: setOpenVisitsEdgeIndex,
          bundleId: metadata?.id,
          bundleLabel,
          bundleAccessibleLabel,
          bundleRouteLabel,
          bundleSourceIndex: metadata?.sourceStageIndex,
          bundleTargetIndex: metadata?.targetStageIndex,
          bundleLeader: metadata?.isLeader,
          bundleItems,
          onSelectBundleTransition: (transitionIndex: number) => {
            if (mode === 'definition') setSelection({ type: 'transition', transitionIndex })
            else onSelectPlannedTransition?.(transitionIndex)
          },
          onSelect: () => setSelection({ type: 'transition', transitionIndex: transition.transitionIndex ?? index }),
        },
        selected,
      } satisfies WorkflowTransitionEdge
    })
  }, [transitions, mode, stageIndexById, stageNodes, routeLabels, routeLabelNames, graphLayout, controlledSelection, onReconnectTransition, onSelectRunTransition, onSelectPlannedTransition, runActivity, layout, setSelection, disabled])

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

  const geometryKey = JSON.stringify([
    mode,
    layout,
    stageNodes.map((stage) => stage.id),
    graphEdges.map(({ source, target, data }) => [
      source, target, data.graphKind, data.outcome, data.routeLabel,
      data.conditionsCount, data.selectionStatus, data.selectedVisits?.length,
    ]),
  ])
  const fitGraph = useCallback((duration = 180) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const { fitBounds: fitToBounds, getNodesBounds: getCurrentNodesBounds, screenToFlowPosition: screenToCurrentFlow } = fitApiRef.current
      const { nodes, layout: currentLayout } = fitDataRef.current
      if (!canvasRef.current || nodes.length === 0) return
      const nodesBounds = getCurrentNodesBounds(nodes)
      const layoutNodes = [...currentLayout.nodes.values()]
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
        const topLeft = screenToCurrentFlow({ x: box.left, y: box.top })
        const bottomRight = screenToCurrentFlow({ x: box.right, y: box.bottom })
        minX = Math.min(minX, topLeft.x - 10)
        minY = Math.min(minY, topLeft.y - 10)
        maxX = Math.max(maxX, bottomRight.x + 10)
        maxY = Math.max(maxY, bottomRight.y + 10)
      }
      for (const edge of currentLayout.edges.values()) {
        for (const waypoint of edge.waypoints ?? []) {
          minX = Math.min(minX, waypoint.x)
          minY = Math.min(minY, waypoint.y)
          maxX = Math.max(maxX, waypoint.x)
          maxY = Math.max(maxY, waypoint.y)
        }
      }
      if (maxX <= minX || maxY <= minY) return
      void fitToBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 16, duration })
    }))
  }, [])

  useEffect(() => {
    if (graphNodes.length === 0 || !viewportInitialized || containerWidth <= 0 || containerHeight <= 0) return
    const frame = window.requestAnimationFrame(() => fitGraph(0))

    return () => window.cancelAnimationFrame(frame)
  }, [fitGraph, geometryKey, containerWidth, containerHeight, graphNodes.length, viewportInitialized])

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
          if (_event.target instanceof Element && _event.target.closest('[role="menu"], [role="menuitem"], [data-slot="dropdown-menu-portal"]')) return
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
        onPaneClick={(event) => {
          if (event.target instanceof Element && event.target.closest('[role="menu"], [role="menuitem"], [data-slot="dropdown-menu-portal"]')) return
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
  mobileNavigation,
  mode = 'definition',
  runActivity,
  selectedRunId = null,
  onSelectRun,
  onSelectRunTransition,
  onSelectPlannedTransition,
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
  const [containerHeight, setContainerHeight] = useState(0)
  const [localSelection, setLocalSelection] = useState<WorkflowGraphSelection>(null)
  const [mobileView, setMobileView] = useState<'navigation' | 'graph'>('graph')
  const previousMobileMode = useRef<boolean | null>(null)
  const definitionTransitions = transitions ?? []
  const graphTransitions = useMemo(() => mode === 'run'
    ? graphTransitionsFromRun(runActivity, routeLabels, routeLabelNames)
    : graphTransitionsFromDefinition(definitionTransitions, routeLabels, routeLabelNames), [mode, runActivity, definitionTransitions, routeLabels, routeLabelNames])
  const graphStagesData = useMemo(() => graphStages(stages, graphTransitions, profiles, boardColumns, mode, runActivity, selectedRunId), [stages, graphTransitions, profiles, boardColumns, mode, runActivity, selectedRunId])
  const controlledSelection = selection === undefined ? localSelection : selection
  const hasMobileNavigation = typeof mobileNavigation === 'function'

  useEffect(() => {
    if (containerWidth <= 0) return
    const shouldUseMobileNavigation = containerWidth < 600 && hasMobileNavigation
    if (previousMobileMode.current !== shouldUseMobileNavigation) {
      previousMobileMode.current = shouldUseMobileNavigation
      setMobileView(shouldUseMobileNavigation ? 'navigation' : 'graph')
    }
  }, [containerWidth, hasMobileNavigation])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerWidth(entry.contentRect.width)
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const setSelection = useCallback((nextSelection: WorkflowGraphSelection) => {
    if (disabled) return
    onSelect?.(nextSelection)
    if (selection === undefined) setLocalSelection(nextSelection)
  }, [disabled, onSelect, selection])
  const mobileNavigationContext: WorkflowGraphMobileContext = {
    stages: graphStagesData,
    transitions: graphTransitions,
    mode,
    runActivity,
    selectedRunId,
    routeLabels,
    routeLabelNames,
    selection: controlledSelection,
    disabled,
    onSelect: setSelection,
    onSelectRun,
    onSelectRunTransition,
    onSelectPlannedTransition,
    onConnectStages,
    onReconnectTransition,
  }

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
        vertical && mobileNavigation ? (
          <div className="relative flex h-full min-h-0 flex-col">
            <div role="group" aria-label="Ablaufansicht wählen" className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-2">
              <Button type="button" size="sm" variant={mobileView === 'navigation' ? 'secondary' : 'outline'} aria-pressed={mobileView === 'navigation'} data-testid="workflow-graph-mobile-view-navigation" onClick={() => setMobileView('navigation')}>Phasen &amp; Routen</Button>
              <Button type="button" size="sm" variant={mobileView === 'graph' ? 'secondary' : 'outline'} aria-pressed={mobileView === 'graph'} data-testid="workflow-graph-mobile-view-graph" onClick={() => setMobileView('graph')}>Diagramm</Button>
            </div>
            <div className="relative min-h-0 flex-1">
              {mobileView === 'navigation'
                ? <div data-testid="workflow-graph-mobile-navigation" className="h-full overflow-auto">{mobileNavigation(mobileNavigationContext)}</div>
                : <ReactFlowProvider>
                  <WorkflowGraphCanvas
                    transitions={graphTransitions}
                    routeLabels={routeLabels}
                    routeLabelNames={routeLabelNames}
                    mode={mode}
                    runActivity={runActivity}
                    onSelectRun={onSelectRun}
                    onSelectRunTransition={onSelectRunTransition}
                    onSelectPlannedTransition={onSelectPlannedTransition}
                    onConnectStages={onConnectStages}
                    onReconnectTransition={onReconnectTransition}
                    disabled={disabled}
                    containerWidth={widthForLayout}
                    containerHeight={containerHeight}
                    graphStages={graphStagesData}
                    controlledSelection={controlledSelection}
                    setSelection={setSelection}
                  />
                </ReactFlowProvider>}
            </div>
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
              onSelectPlannedTransition={onSelectPlannedTransition}
              onConnectStages={onConnectStages}
              onReconnectTransition={onReconnectTransition}
              disabled={disabled}
              containerWidth={widthForLayout}
              containerHeight={containerHeight}
              graphStages={graphStagesData}
              controlledSelection={controlledSelection}
              setSelection={setSelection}
            />
          </ReactFlowProvider>
        )
      )}
      <p id={instructionsId} className="sr-only">Mit Tab zu Phase oder Übergang wechseln. Eingabetaste oder Leertaste wählt aus. Zoom über Werkzeugleiste oder Plus/Minus, Diagramm einpassen über Pos1.</p>
    </section>
  )
}
