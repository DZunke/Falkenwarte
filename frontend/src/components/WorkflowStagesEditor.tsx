import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowDown, ArrowUp, GitBranch, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import type { components } from '@/generated/api'
import { WorkflowGraph, type WorkflowGraphSelection } from '@/components/WorkflowGraph'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export type WorkflowStageEditorStage = components['schemas']['WorkflowStage']

export type WorkflowStageEditorTransition = components['schemas']['WorkflowTransition']

export type WorkflowStageEditorProfile = {
  id: string
  name: string
  role: string
}

export type WorkflowBoardColumnOption = {
  boardId: string
  boardName: string
  boardArchived: boolean
  columnId: string
  columnName: string
  defaultDropStatusId: string | null
  defaultDropStatusCategory: string | null
}

export type WorkflowStageEditorRouteLabel = {
  id: string
  name: string
  active: boolean
  kind: string
}

type Props = {
  idPrefix: string
  projectId: string | null
  stages: readonly WorkflowStageEditorStage[]
  transitions: readonly WorkflowStageEditorTransition[]
  profiles: readonly WorkflowStageEditorProfile[]
  boardColumns?: readonly WorkflowBoardColumnOption[]
  routeLabels?: readonly WorkflowStageEditorRouteLabel[]
  selectFirstStageInitially?: boolean
  disabled?: boolean
  onChange: (stages: WorkflowStageEditorStage[], transitions: WorkflowStageEditorTransition[]) => void
}

const defaultCompletionPolicy: WorkflowStageEditorStage['run_completion_policy'] = {
  require_external_settled: true,
  required_evidence_kinds: [],
  required_criterion_ids: [],
  require_human_phase_decision: false,
  require_human_confirmed_evidence: false,
}

const outcomes: { value: WorkflowStageEditorTransition['on']; label: string }[] = [
  { value: 'accepted', label: 'Angenommen' },
  { value: 'needs_changes', label: 'Änderungen nötig' },
  { value: 'blocked', label: 'Blockiert' },
  { value: 'failed', label: 'Fehlgeschlagen' },
]

const stageKinds = [
  { value: 'agent_run', label: 'Arbeitsphase' },
  { value: 'review', label: 'Reviewphase' },
]

const startableCategories = new Set(['ready', 'active', 'review'])
const noProfileValue = '__workflow_no_profile__'
const keepBoardTargetValue = '__workflow_keep_board_target__'
const defaultRouteLabelValue = '__workflow_default_route__'

function transitionKey(fromStageId: string, outcome: string, routeLabelId?: string): string {
  return `${fromStageId}\u0000${outcome}\u0000${routeLabelId?.toLowerCase() ?? ''}`
}

function boardTargetValue(boardId: string, columnId: string): string {
  return `${boardId}::${columnId}`
}

function parseBoardTargetValue(value: string): { board_id: string; column_id: string } | null {
  const separator = value.indexOf('::')
  if (separator < 1 || separator === value.length - 2) return null
  return { board_id: value.slice(0, separator), column_id: value.slice(separator + 2) }
}

function conditionLabel(condition: components['schemas']['WorkflowCondition']): string {
  switch (condition.type) {
    case 'all_required_criteria_human_confirmed': return 'Alle Pflichtkriterien sind menschlich bestätigt'
    case 'required_evidence_reported': return `Nachweis gemeldet${condition.evidence_kind ? ` (${condition.evidence_kind})` : ''}`
    case 'required_evidence_human_confirmed': return `Nachweis menschlich bestätigt${condition.evidence_kind ? ` (${condition.evidence_kind})` : ''}`
    case 'human_approval_granted': return 'Eigentümerfreigabe liegt vor'
    case 'review_report_accepted': return 'Reviewbericht ist angenommen'
    case 'run_succeeded': return 'Vorheriger Phasenlauf war erfolgreich'
    case 'intake_ready': return 'Technischer Eingang ist bereit'
    case 'no_human_attention': return 'Keine offene menschliche Klärung'
  }
}

function hasRoute(
  transitions: readonly WorkflowStageEditorTransition[],
  fromStageId: string,
  outcome: WorkflowStageEditorTransition['on'],
  routeLabelId?: string,
): boolean {
  return transitions.some((transition) => transitionKey(transition.from_stage_id, transition.on, transition.route_label_id)
    === transitionKey(fromStageId, outcome, routeLabelId))
}

function nextTransition(
  stages: readonly WorkflowStageEditorStage[],
  transitions: readonly WorkflowStageEditorTransition[],
  routeLabels: readonly WorkflowStageEditorRouteLabel[],
): WorkflowStageEditorTransition | null {
  for (let index = 0; index < stages.length - 1; index++) {
    const source = stages[index]
    if (!hasRoute(transitions, source.id, 'accepted')) {
      return { from_stage_id: source.id, to_stage_id: stages[index + 1].id, on: 'accepted', conditions: [] }
    }
  }

  for (let sourceIndex = 0; sourceIndex < stages.length; sourceIndex++) {
    const source = stages[sourceIndex]
    const target = stages[sourceIndex + 1]?.id ?? stages.find((stage) => stage.id !== source.id)?.id

    for (const outcome of outcomes) {
      const toStageId = target ?? (outcome.value === 'needs_changes' ? source.id : null)
      if (!toStageId || (toStageId === source.id && outcome.value !== 'needs_changes') || hasRoute(transitions, source.id, outcome.value)) continue
      return { from_stage_id: source.id, to_stage_id: toStageId, on: outcome.value, conditions: [] }
    }
  }

  for (const source of stages) {
    const target = stages.find((stage) => stage.id !== source.id)?.id
    for (const outcome of outcomes) {
      const toStageId = target ?? (outcome.value === 'needs_changes' ? source.id : null)
      if (!toStageId || (toStageId === source.id && outcome.value !== 'needs_changes')) continue
      for (const label of routeLabels) {
        if (!hasRoute(transitions, source.id, outcome.value, label.id)) {
          return { from_stage_id: source.id, to_stage_id: toStageId, on: outcome.value, conditions: [], route_label_id: label.id }
        }
      }
    }
  }

  return null
}

function nextLabelledAlternative(
  stages: readonly WorkflowStageEditorStage[],
  transitions: readonly WorkflowStageEditorTransition[],
  routeLabels: readonly WorkflowStageEditorRouteLabel[],
): WorkflowStageEditorTransition | null {
  const firstTransition = transitions.length === 0 ? nextTransition(stages, transitions, []) : null
  const branchCandidates = transitions.length > 0 ? transitions : firstTransition ? [firstTransition] : []

  for (const branch of branchCandidates) {
    const routeLabel = routeLabels.find((label) => !hasRoute(transitions, branch.from_stage_id, branch.on, label.id))
    if (routeLabel) return { ...branch, conditions: [...branch.conditions], route_label_id: routeLabel.id }
  }

  return null
}

function boardColumnUnavailableReason(column: WorkflowBoardColumnOption | undefined): string {
  if (!column) return 'Board oder Spalte wurde entfernt.'
  if (column.boardArchived) return 'Das Board ist archiviert.'
  if (!column.defaultDropStatusId) return 'Die Spalte hat keinen festgelegten Standardstatus.'
  if (!column.defaultDropStatusCategory || !startableCategories.has(column.defaultDropStatusCategory)) {
    return 'Der Standardstatus ist keine startbare Arbeitsphase.'
  }
  return 'Die Zielspalte ist für neue Phasenstarts nicht verfügbar.'
}

function targetCategoryLabel(category: string | null): string {
  switch (category) {
    case 'ready': return 'Bereit'
    case 'active': return 'In Arbeit'
    case 'review': return 'Review'
    default: return 'Nicht startbar'
  }
}

export function WorkflowStagesEditor({
  idPrefix,
  projectId,
  stages,
  transitions,
  profiles,
  boardColumns,
  routeLabels,
  selectFirstStageInitially = true,
  disabled = false,
  onChange,
}: Props) {
  const reactId = useId()
  const safePrefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '-')
  const [selection, setSelection] = useState<WorkflowGraphSelection>(() => selectFirstStageInitially && stages[0] ? { type: 'stage', stageId: stages[0].id } : null)
  const [graphNotice, setGraphNotice] = useState('')
  const graphRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const scrollAfterSelection = useRef(false)
  const activeTopicLabels = (routeLabels ?? []).filter((label) => label.active && label.kind === 'topic')
  const startableBoardColumns = (boardColumns ?? []).filter((column) => !column.boardArchived
    && Boolean(column.defaultDropStatusId)
    && Boolean(column.defaultDropStatusCategory && startableCategories.has(column.defaultDropStatusCategory)))
  const groupedBoardColumns = new Map<string, WorkflowBoardColumnOption[]>()
  for (const column of startableBoardColumns) groupedBoardColumns.set(column.boardId, [...(groupedBoardColumns.get(column.boardId) ?? []), column])

  const selectionExists = selection?.type === 'stage'
    ? stages.some((stage) => stage.id === selection.stageId)
    : selection?.type === 'transition'
      ? Boolean(transitions[selection.transitionIndex])
      : false
  const visibleSelection = selectionExists ? selection : null
  const selectedStageIndex = visibleSelection?.type === 'stage'
    ? stages.findIndex((stage) => stage.id === visibleSelection.stageId)
    : -1
  const selectedStage = selectedStageIndex >= 0 ? stages[selectedStageIndex] : undefined
  const selectedTransitionIndex = visibleSelection?.type === 'transition' ? visibleSelection.transitionIndex : -1
  const selectedTransition = selectedTransitionIndex >= 0 ? transitions[selectedTransitionIndex] : undefined

  useEffect(() => {
    if (selectionExists || !selection) return
    setSelection(stages[0] ? { type: 'stage', stageId: stages[0].id } : null)
  }, [selection, selectionExists, stages])

  useEffect(() => {
    if (!scrollAfterSelection.current) return
    scrollAfterSelection.current = false
    if (!window.matchMedia('(max-width: 1279px)').matches) return
    inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    inspectorRef.current?.querySelector<HTMLElement>('[data-testid="workflow-inspector-heading"]')?.focus({ preventScroll: true })
  }, [selection])

  const returnToGraph = () => {
    setSelection(null)
    if (!window.matchMedia('(max-width: 1279px)').matches) return
    requestAnimationFrame(() => {
      graphRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      graphRef.current?.querySelector<HTMLElement>('[data-testid^="workflow-graph-stage-"]')?.focus({ preventScroll: true })
    })
  }

  const selectElement = (nextSelection: WorkflowGraphSelection) => {
    scrollAfterSelection.current = nextSelection !== null
    setSelection(nextSelection)
    setGraphNotice('')
  }

  const updateStage = (stageId: string, change: (stage: WorkflowStageEditorStage) => WorkflowStageEditorStage) => {
    onChange(stages.map((stage) => stage.id === stageId ? change(stage) : stage), [...transitions])
  }

  const transitionConflicts = (
    fromStageId: string,
    outcome: WorkflowStageEditorTransition['on'],
    routeLabelId: string | undefined,
    exceptIndex = -1,
  ) => transitions.some((transition, index) => index !== exceptIndex
    && transitionKey(transition.from_stage_id, transition.on, transition.route_label_id) === transitionKey(fromStageId, outcome, routeLabelId))

  const updateTransition = (index: number, patch: Partial<WorkflowStageEditorTransition>) => {
    const current = transitions[index]
    if (!current) return
    const candidate = { ...current, ...patch }
    if (transitionConflicts(candidate.from_stage_id, candidate.on, candidate.route_label_id, index)
      || (candidate.from_stage_id === candidate.to_stage_id && candidate.on !== 'needs_changes')) return
    onChange([...stages], transitions.map((transition, otherIndex) => otherIndex === index ? candidate : transition))
  }

  const addStage = () => {
    if (disabled || stages.length >= 30) return
    let suffix = stages.length + 1
    let id = `phase-${suffix}`
    while (stages.some((stage) => stage.id === id)) {
      suffix += 1
      id = `phase-${suffix}`
    }
    const newStage: WorkflowStageEditorStage = {
      id,
      kind: 'agent_run',
      name: `Neue Phase ${stages.length + 1}`,
      agent_profile_id: null,
      entry_conditions: [],
      run_completion_policy: { ...defaultCompletionPolicy, required_evidence_kinds: [], required_criterion_ids: [] },
      instructions: '',
    }
    const nextTransitions = [...transitions]
    const previousStage = stages.at(-1)
    if (previousStage && !hasRoute(transitions, previousStage.id, 'accepted')) {
      nextTransitions.push({ from_stage_id: previousStage.id, to_stage_id: newStage.id, on: 'accepted', conditions: [] })
    }
    onChange([...stages, newStage], nextTransitions)
    scrollAfterSelection.current = true
    setSelection({ type: 'stage', stageId: newStage.id })
    setGraphNotice('')
  }

  const removeStage = (stageId: string) => {
    if (disabled || stages.length <= 1) return
    const nextStages = stages.filter((stage) => stage.id !== stageId)
    onChange(nextStages, transitions.filter((transition) => transition.from_stage_id !== stageId && transition.to_stage_id !== stageId))
    setSelection(nextStages[0] ? { type: 'stage', stageId: nextStages[0].id } : null)
    setGraphNotice('')
  }

  const moveStage = (index: number, offset: -1 | 1) => {
    const destination = index + offset
    if (disabled || destination < 0 || destination >= stages.length) return
    const reordered = [...stages]
    const displaced = reordered[index]
    reordered[index] = reordered[destination]
    reordered[destination] = displaced
    onChange(reordered, [...transitions])
  }

  const addTransition = () => {
    if (disabled || transitions.length >= 100) return
    const transition = nextTransition(stages, transitions, [])
    if (!transition) return
    const nextIndex = transitions.length
    onChange([...stages], [...transitions, transition])
    scrollAfterSelection.current = true
    setSelection({ type: 'transition', transitionIndex: nextIndex })
    setGraphNotice('')
  }

  const addLabelledAlternative = () => {
    if (disabled || transitions.length >= 100) return
    const transition = nextLabelledAlternative(stages, transitions, activeTopicLabels)
    if (!transition) return
    const nextIndex = transitions.length
    onChange([...stages], [...transitions, transition])
    scrollAfterSelection.current = true
    setSelection({ type: 'transition', transitionIndex: nextIndex })
    setGraphNotice('')
  }

  const addConnectedTransition = (fromStageId: string, toStageId: string) => {
    if (disabled || transitions.length >= 100) {
      setGraphNotice('Ein Workflow kann höchstens 100 Übergänge enthalten.')
      return
    }
    if (!stages.some((stage) => stage.id === fromStageId) || !stages.some((stage) => stage.id === toStageId)) {
      setGraphNotice('Die ausgewählte Phase ist nicht mehr verfügbar.')
      return
    }

    const outcome = outcomes.find(({ value }) => (fromStageId !== toStageId || value === 'needs_changes')
      && !transitionConflicts(fromStageId, value, undefined))
    if (!outcome) {
      setGraphNotice('Für diese Phase sind alle zulässigen Ergebnisrouten bereits belegt.')
      return
    }

    const nextIndex = transitions.length
    onChange([...stages], [...transitions, { from_stage_id: fromStageId, to_stage_id: toStageId, on: outcome.value, conditions: [] }])
    scrollAfterSelection.current = true
    setSelection({ type: 'transition', transitionIndex: nextIndex })
    setGraphNotice('')
  }

  const reconnectTransition = (index: number, fromStageId: string, toStageId: string) => {
    const current = transitions[index]
    if (disabled || !current) return
    if (!stages.some((stage) => stage.id === fromStageId) || !stages.some((stage) => stage.id === toStageId)) {
      setGraphNotice('Die ausgewählte Phase ist nicht mehr verfügbar.')
      return
    }
    if ((fromStageId === toStageId && current.on !== 'needs_changes')
      || transitionConflicts(fromStageId, current.on, current.route_label_id, index)) {
      setGraphNotice('Diese Verbindung würde eine unzulässige oder doppelte Ergebnisroute erzeugen.')
      return
    }

    onChange([...stages], transitions.map((transition, otherIndex) => otherIndex === index
      ? { ...transition, from_stage_id: fromStageId, to_stage_id: toStageId }
      : transition))
    scrollAfterSelection.current = true
    setSelection({ type: 'transition', transitionIndex: index })
    setGraphNotice('')
  }

  const nextEdge = nextTransition(stages, transitions, [])
  const nextLabelledEdge = nextLabelledAlternative(stages, transitions, activeTopicLabels)

  const updateRouteLabel = (index: number, value: string) => {
    const current = transitions[index]
    if (!current) return
    const routeLabelId = value === defaultRouteLabelValue ? undefined : value
    if (transitionConflicts(current.from_stage_id, current.on, routeLabelId, index)) return
    const next = { ...current }
    if (routeLabelId) next.route_label_id = routeLabelId
    else delete next.route_label_id
    onChange([...stages], transitions.map((other, otherIndex) => otherIndex === index ? next : other))
  }

  const removeTransition = (index: number) => {
    const transition = transitions[index]
    if (!transition) return
    onChange([...stages], transitions.filter((_, otherIndex) => otherIndex !== index))
    setSelection(stages.some((stage) => stage.id === transition.from_stage_id)
      ? { type: 'stage', stageId: transition.from_stage_id }
      : stages[0] ? { type: 'stage', stageId: stages[0].id } : null)
    setGraphNotice('')
  }

  const transitionSelectionLabel = selectedTransition
    ? `${stageLabel(selectedTransition.from_stage_id, stages)} → ${stageLabel(selectedTransition.to_stage_id, stages)}`
    : ''

  return (
    <section aria-label="Workflowphasen bearbeiten" className="space-y-3" data-testid={`workflow-${safePrefix}-stages-editor`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Ablaufplan</h3>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="max-w-full" disabled={disabled || stages.length >= 30} onClick={addStage}>
            <Plus />Phase hinzufügen
          </Button>
          <div className="hidden items-center gap-1.5 sm:flex">
            <Button type="button" size="sm" variant="outline" disabled={disabled || transitions.length >= 100 || !nextEdge} onClick={addTransition}>
              <Plus />Übergang hinzufügen
            </Button>
            {activeTopicLabels.length > 0 && <Button type="button" size="sm" variant="outline" disabled={disabled || transitions.length >= 100 || !nextLabelledEdge} onClick={addLabelledAlternative}>
              <Plus />Gelabelte Alternative hinzufügen
            </Button>}
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="outline" aria-label="Übergangsaktionen" title="Übergangsaktionen" disabled={disabled || (transitions.length >= 100 && !nextEdge && !nextLabelledEdge)}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={transitions.length >= 100 || !nextEdge} onSelect={addTransition}><GitBranch />Übergang hinzufügen</DropdownMenuItem>
                {activeTopicLabels.length > 0 && <DropdownMenuItem disabled={transitions.length >= 100 || !nextLabelledEdge} onSelect={addLabelledAlternative}><GitBranch />Gelabelte Alternative hinzufügen</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {graphNotice && <p role="status" aria-live="polite" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{graphNotice}</p>}
      {transitions.length >= 100 && <p role="status" className="text-xs text-muted-foreground">Ein Workflow kann höchstens 100 Übergänge enthalten.</p>}

      <div className={`grid min-w-0 gap-4 ${visibleSelection ? 'xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.85fr)]' : 'grid-cols-1'}`}>
        <div ref={graphRef} className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
          <WorkflowGraph
            label="Workflowablauf"
            className="h-[28rem] min-h-[24rem] w-full sm:h-[min(58vh,38rem)]"
            stages={stages}
            transitions={transitions}
            profiles={profiles}
            disabled={disabled}
            boardColumns={boardColumns}
            routeLabels={routeLabels}
            selection={visibleSelection}
            onSelect={selectElement}
            onConnectStages={addConnectedTransition}
            onReconnectTransition={reconnectTransition}
          />
        </div>

        {selectedStage && (
          <StageInspector
            idPrefix={safePrefix}
            reactId={reactId}
            stage={selectedStage}
            index={selectedStageIndex}
            stages={stages}
            profiles={profiles}
            projectId={projectId}
            boardColumns={boardColumns}
            startableBoardColumns={startableBoardColumns}
            disabled={disabled}
            onUpdate={(change) => updateStage(selectedStage.id, change)}
            onMove={(offset) => moveStage(selectedStageIndex, offset)}
            onRemove={() => removeStage(selectedStage.id)}
            onClose={returnToGraph}
            inspectorRef={inspectorRef}
          />
        )}

        {selectedTransition && (
          <TransitionInspector
            idPrefix={safePrefix}
            reactId={reactId}
            transition={selectedTransition}
            index={selectedTransitionIndex}
            stages={stages}
            activeTopicLabels={activeTopicLabels}
            routeLabels={routeLabels}
            disabled={disabled}
            summary={transitionSelectionLabel}
            conflicts={transitionConflicts}
            onUpdate={(patch) => updateTransition(selectedTransitionIndex, patch)}
            onRouteLabelChange={(value) => updateRouteLabel(selectedTransitionIndex, value)}
            onRemove={() => removeTransition(selectedTransitionIndex)}
            onClose={returnToGraph}
            inspectorRef={inspectorRef}
          />
        )}

      </div>
    </section>
  )
}

type StageInspectorProps = {
  idPrefix: string
  reactId: string
  stage: WorkflowStageEditorStage
  index: number
  stages: readonly WorkflowStageEditorStage[]
  profiles: readonly WorkflowStageEditorProfile[]
  projectId: string | null
  boardColumns?: readonly WorkflowBoardColumnOption[]
  startableBoardColumns: readonly WorkflowBoardColumnOption[]
  disabled: boolean
  onClose: () => void
  inspectorRef: RefObject<HTMLDivElement | null>
  onUpdate: (change: (stage: WorkflowStageEditorStage) => WorkflowStageEditorStage) => void
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}

function StageInspector({
  idPrefix,
  reactId,
  stage,
  index,
  stages,
  profiles,
  projectId,
  boardColumns,
  startableBoardColumns,
  disabled,
  onClose,
  inspectorRef,
  onUpdate,
  onMove,
  onRemove,
}: StageInspectorProps) {
  const nameInputId = `${reactId}-stage-name-${stage.id}`
  const nameHintId = `${nameInputId}-hint`
  const kindSelectId = `${reactId}-stage-kind-${stage.id}`
  const roleSelectId = `${reactId}-stage-profile-${stage.id}`
  const instructionsId = `${reactId}-stage-instructions-${stage.id}`
  const boardTargetSelectId = `${reactId}-stage-board-target-${stage.id}`
  const approvedProfile = profiles.find((profile) => profile.id === stage.agent_profile_id)
  const completionPolicy = stage.run_completion_policy
  const hasStoredCompletionRules = !completionPolicy.require_external_settled
    || completionPolicy.required_evidence_kinds.length > 0
    || completionPolicy.required_criterion_ids.length > 0
    || completionPolicy.require_human_confirmed_evidence
  const stageKindIsKnown = stageKinds.some((kind) => kind.value === stage.kind)
  const savedTarget = stage.board_target
  const savedTargetKey = savedTarget ? boardTargetValue(savedTarget.board_id, savedTarget.column_id) : keepBoardTargetValue
  const savedTargetColumn = savedTarget
    ? boardColumns?.find((column) => column.boardId === savedTarget.board_id && column.columnId === savedTarget.column_id)
    : undefined
  const savedTargetUnavailable = Boolean(savedTarget && boardColumns !== undefined
    && !startableBoardColumns.some((column) => column.boardId === savedTarget.board_id && column.columnId === savedTarget.column_id))
  const savedTargetNeedsFallback = Boolean(savedTarget && (boardColumns === undefined || savedTargetUnavailable))
  const groupedBoardColumns = new Map<string, WorkflowBoardColumnOption[]>()
  for (const column of startableBoardColumns) groupedBoardColumns.set(column.boardId, [...(groupedBoardColumns.get(column.boardId) ?? []), column])

  return (
    <article className="min-w-0" data-testid={`workflow-${idPrefix}-stage-${stage.id}`}>
      <div ref={inspectorRef} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm scroll-mt-4" data-testid="workflow-stage-inspector">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Phasendetails</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Phase {index + 1}</span>
            {index === 0 && <Badge variant="secondary">Startphase</Badge>}
          </div>
          <h4 tabIndex={-1} data-testid="workflow-inspector-heading" className="mt-1 break-words text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{stage.name || 'Ohne Namen'}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Details schließen" title="Details schließen" onClick={onClose}><X /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Phase ${index + 1} nach oben verschieben`} title={`Phase ${index + 1} nach oben verschieben`} disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Phase ${index + 1} nach unten verschieben`} title={`Phase ${index + 1} nach unten verschieben`} disabled={disabled || index === stages.length - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label={`Phase ${index + 1} entfernen`} title={`Phase ${index + 1} entfernen`} data-testid={`workflow-${idPrefix}-stage-remove-${stage.id}`} disabled={disabled || stages.length <= 1} onClick={onRemove}><Trash2 /></Button>
        </div>
      </header>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={nameInputId}>Name der Phase {index + 1}</Label>
          <Input id={nameInputId} className="w-full min-w-0" data-testid={`workflow-${idPrefix}-stage-name-${stage.id}`} value={stage.name} maxLength={120} disabled={disabled} aria-invalid={!stage.name.trim()} aria-describedby={!stage.name.trim() ? nameHintId : undefined} onChange={(event) => onUpdate((current) => ({ ...current, name: event.target.value }))} />
          {!stage.name.trim() && <p id={nameHintId} role="alert" className="text-xs text-destructive">Gib dieser Phase einen Namen.</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={kindSelectId}>Art der Phase</Label>
          <Select value={stage.kind} disabled={disabled} onValueChange={(kind) => onUpdate((current) => ({ ...current, kind }))}>
            <SelectTrigger id={kindSelectId} className="w-full min-w-0" data-testid={`workflow-${idPrefix}-stage-kind-${stage.id}`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              {stageKinds.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}
              {!stageKindIsKnown && <SelectItem value={stage.kind} disabled>Bestehende Phase</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={roleSelectId}>Agentrolle für Phase {index + 1}</Label>
          <Select value={stage.agent_profile_id ?? noProfileValue} disabled={disabled} onValueChange={(profileId) => onUpdate((current) => ({ ...current, agent_profile_id: profileId === noProfileValue ? null : profileId }))}>
            <SelectTrigger id={roleSelectId} className="w-full min-w-0" data-testid={`workflow-${idPrefix}-stage-agent-role-${stage.id}`}><SelectValue placeholder="Rolle auswählen" /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              <SelectItem value={noProfileValue}>Keine Agentrolle</SelectItem>
              {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name} · {profile.role}</SelectItem>)}
              {stage.agent_profile_id && !approvedProfile && <SelectItem value={stage.agent_profile_id} disabled>Gespeicherte Rolle nicht verfügbar</SelectItem>}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Wird beim Start dieser Phase verwendet.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={boardTargetSelectId}>Boardspalte bei Phasenstart für Phase {index + 1}</Label>
          <Select value={savedTargetKey} disabled={disabled} onValueChange={(value) => onUpdate((current) => {
            const next = { ...current }
            const target = value === keepBoardTargetValue ? null : parseBoardTargetValue(value)
            if (target) next.board_target = target
            else delete next.board_target
            return next
          })}>
            <SelectTrigger id={boardTargetSelectId} className="w-full min-w-0" data-testid={`workflow-${idPrefix}-stage-board-target-${stage.id}`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              <SelectItem value={keepBoardTargetValue}>Spalte beibehalten</SelectItem>
              {savedTarget && savedTargetNeedsFallback && <SelectItem value={savedTargetKey} disabled>
                {boardColumns === undefined
                  ? projectId ? 'Gespeichertes Boardziel wird geprüft' : 'Gespeichertes Boardziel unverändert'
                  : savedTargetColumn
                    ? `${savedTargetColumn.boardName} · ${savedTargetColumn.columnName} (nicht verfügbar)`
                    : 'Gespeichertes Boardziel nicht verfügbar'}
              </SelectItem>}
              {[...groupedBoardColumns.entries()].map(([boardId, columns]) => (
                <SelectGroup key={boardId}>
                  <SelectLabel>{columns[0].boardName}</SelectLabel>
                  {columns.map((column) => <SelectItem key={column.columnId} value={boardTargetValue(column.boardId, column.columnId)}>{column.columnName} · {targetCategoryLabel(column.defaultDropStatusCategory)}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {savedTargetUnavailable && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">Das gespeicherte Boardziel ist nicht mehr verfügbar: {boardColumnUnavailableReason(savedTargetColumn)} Es bleibt erhalten, bis du es änderst.</p>}
          {!projectId && <p className="text-xs text-muted-foreground">Projektübergreifende Workflows übernehmen das Boardziel unverändert.</p>}
          {projectId && boardColumns === undefined && <p role="status" className="text-xs text-muted-foreground">Gespeicherte Boardziele bleiben erhalten, bis die Projektspalten geprüft werden können.</p>}
          {projectId && boardColumns && startableBoardColumns.length === 0 && <p className="text-xs text-muted-foreground">Keine startbare Boardspalte verfügbar.</p>}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
          <Checkbox id={`${reactId}-stage-human-approval-${stage.id}`} data-testid={`workflow-${idPrefix}-stage-human-approval-${stage.id}`} checked={completionPolicy.require_human_phase_decision} disabled={disabled} onCheckedChange={(checked) => onUpdate((current) => ({ ...current, run_completion_policy: { ...current.run_completion_policy, require_human_phase_decision: checked === true } }))} />
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={`${reactId}-stage-human-approval-${stage.id}`}>Menschliche Freigabe</Label>
            <p className="text-xs text-muted-foreground">Die Phase wartet vor dem Übergang auf deine Entscheidung.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={instructionsId}>Auftrag für diese Phase</Label>
          <Textarea id={instructionsId} className="min-h-28 w-full min-w-0 resize-y" data-testid={`workflow-${idPrefix}-stage-instructions-${stage.id}`} value={stage.instructions ?? ''} maxLength={12000} disabled={disabled} onChange={(event) => onUpdate((current) => {
            const next = { ...current }
            if (event.target.value === '') delete next.instructions
            else next.instructions = event.target.value
            return next
          })} placeholder="Beschreibe den Auftrag dieser Phase." />
          <p className="text-right text-xs text-muted-foreground">{(stage.instructions ?? '').length.toLocaleString()} / 12.000</p>
        </div>
      </div>

      {hasStoredCompletionRules && <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Weitere Abschlussregeln</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>{completionPolicy.require_external_settled ? 'Der externe T3-Lauf muss abgeschlossen sein.' : 'Der externe T3-Lauf muss nicht abgeschlossen sein.'}</li>
          {completionPolicy.required_evidence_kinds.map((kind) => <li key={`evidence-${kind}`}>Nachweis: {kind}</li>)}
          {completionPolicy.required_criterion_ids.map((criterionId) => <li key={`criterion-${criterionId}`}>Ticketkriterium: {criterionId}</li>)}
          {completionPolicy.require_human_confirmed_evidence && <li>Gemeldete Nachweise müssen menschlich bestätigt sein.</li>}
        </ul>
      </details>}

      {stage.entry_conditions.length > 0 && <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Startregeln ({stage.entry_conditions.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {stage.entry_conditions.map((condition, conditionIndex) => <li key={`${condition.type}-${conditionIndex}`}>{conditionLabel(condition)}</li>)}
        </ul>
      </details>}
      </div>
    </article>
  )
}

type TransitionInspectorProps = {
  idPrefix: string
  reactId: string
  transition: WorkflowStageEditorTransition
  index: number
  stages: readonly WorkflowStageEditorStage[]
  activeTopicLabels: readonly WorkflowStageEditorRouteLabel[]
  routeLabels?: readonly WorkflowStageEditorRouteLabel[]
  disabled: boolean
  summary: string
  onClose: () => void
  inspectorRef: RefObject<HTMLDivElement | null>
  conflicts: (fromStageId: string, outcome: WorkflowStageEditorTransition['on'], routeLabelId: string | undefined, exceptIndex?: number) => boolean
  onUpdate: (patch: Partial<WorkflowStageEditorTransition>) => void
  onRouteLabelChange: (value: string) => void
  onRemove: () => void
}

function TransitionInspector({
  idPrefix,
  reactId,
  transition,
  index,
  stages,
  activeTopicLabels,
  routeLabels,
  disabled,
  summary,
  onClose,
  inspectorRef,
  conflicts,
  onUpdate,
  onRouteLabelChange,
  onRemove,
}: TransitionInspectorProps) {
  const rowId = `workflow-${idPrefix}-transition-${index}`
  const fromId = `${reactId}-transition-${index}-from`
  const outcomeId = `${reactId}-transition-${index}-outcome`
  const toId = `${reactId}-transition-${index}-to`
  const labelId = `${reactId}-transition-${index}-label`
  const selectedRouteLabel = transition.route_label_id
    ? activeTopicLabels.find((label) => label.id === transition.route_label_id)
    : undefined
  const showRouteLabel = activeTopicLabels.length > 0 || Boolean(transition.route_label_id)

  return (
    <article className="min-w-0" data-testid={rowId}>
      <div ref={inspectorRef} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm scroll-mt-4" data-testid="workflow-transition-inspector">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Übergangsdetails · {index + 1}</p>
          <h4 tabIndex={-1} data-testid="workflow-inspector-heading" className="mt-1 break-words text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{summary}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Details schließen" title="Details schließen" onClick={onClose}><X /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label={`Übergang ${index + 1} entfernen`} title={`Übergang ${index + 1} entfernen`} data-testid={`${rowId}-remove`} disabled={disabled} onClick={onRemove}><Trash2 /></Button>
        </div>
      </header>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={fromId}>Von Phase</Label>
          <Select value={transition.from_stage_id} disabled={disabled} onValueChange={(fromStageId) => onUpdate({ from_stage_id: fromStageId })}>
            <SelectTrigger id={fromId} className="w-full min-w-0" data-testid={`${rowId}-from`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              {stages.map((stage) => <SelectItem key={stage.id} value={stage.id} disabled={conflicts(stage.id, transition.on, transition.route_label_id, index) || (stage.id === transition.to_stage_id && transition.on !== 'needs_changes')}>{stageLabel(stage.id, stages)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={outcomeId}>Ergebnis</Label>
          <Select value={transition.on} disabled={disabled} onValueChange={(on) => onUpdate({ on: on as WorkflowStageEditorTransition['on'] })}>
            <SelectTrigger id={outcomeId} className="w-full min-w-0" data-testid={`${rowId}-outcome`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              {outcomes.map((outcome) => <SelectItem key={outcome.value} value={outcome.value} disabled={conflicts(transition.from_stage_id, outcome.value, transition.route_label_id, index) || (transition.from_stage_id === transition.to_stage_id && outcome.value !== 'needs_changes')}>{outcome.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={toId}>Zu Phase</Label>
          <Select value={transition.to_stage_id} disabled={disabled} onValueChange={(toStageId) => onUpdate({ to_stage_id: toStageId })}>
            <SelectTrigger id={toId} className="w-full min-w-0" data-testid={`${rowId}-to`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              {stages.map((stage) => <SelectItem key={stage.id} value={stage.id} disabled={stage.id === transition.from_stage_id && transition.on !== 'needs_changes'}>{stageLabel(stage.id, stages)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {showRouteLabel && <div className="space-y-1.5">
          <Label htmlFor={labelId}>Label für diesen Übergang</Label>
          <Select value={transition.route_label_id ?? defaultRouteLabelValue} disabled={disabled} onValueChange={onRouteLabelChange}>
            <SelectTrigger id={labelId} className="w-full min-w-0" data-testid={`${rowId}-route-label`}><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
              <SelectItem value={defaultRouteLabelValue} disabled={conflicts(transition.from_stage_id, transition.on, undefined, index)}>Standardroute</SelectItem>
              {transition.route_label_id && !selectedRouteLabel && <SelectItem value={transition.route_label_id} disabled>{routeLabels === undefined ? 'Themenlabel wird geprüft' : 'Gespeichertes Label nicht mehr verfügbar'}</SelectItem>}
              {activeTopicLabels.map((label) => <SelectItem key={label.id} value={label.id} disabled={conflicts(transition.from_stage_id, transition.on, label.id, index)}>{label.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {transition.route_label_id && routeLabels !== undefined && !selectedRouteLabel && <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">Das gespeicherte Themenlabel ist nicht mehr aktiv oder gehört nicht mehr zu diesem Projekt. Ersetze oder entferne es vor dem Speichern.</p>}
        </div>}
      </div>

      {transition.conditions.length > 0 && <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Gespeicherte Regeln ({transition.conditions.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {transition.conditions.map((condition, conditionIndex) => <li key={`${condition.type}-${conditionIndex}`}>{conditionLabel(condition)}</li>)}
        </ul>
      </details>}
      </div>
    </article>
  )
}

function stageLabel(stageId: string, stages: readonly WorkflowStageEditorStage[]): string {
  const index = stages.findIndex((stage) => stage.id === stageId)
  const stage = stages[index]
  if (!stage) return 'Nicht verfügbare Phase'
  const name = stage.name.trim() || `Phase ${index + 1}`
  const duplicateName = Boolean(stage.name.trim()) && stages.some((other, otherIndex) => otherIndex !== index && other.name.trim().toLocaleLowerCase() === stage.name.trim().toLocaleLowerCase())

  return duplicateName ? `Phase ${index + 1}: ${name}` : name
}
