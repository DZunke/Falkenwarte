import { useId } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { components } from '@/generated/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  routeLabels = [],
  disabled = false,
  onChange,
}: Props) {
  const reactId = useId()
  const safePrefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '-')
  const activeTopicLabels = routeLabels.filter((label) => label.active && label.kind === 'topic')
  const startableBoardColumns = (boardColumns ?? []).filter((column) => !column.boardArchived
    && Boolean(column.defaultDropStatusId)
    && Boolean(column.defaultDropStatusCategory && startableCategories.has(column.defaultDropStatusCategory)))
  const groupedBoardColumns = new Map<string, WorkflowBoardColumnOption[]>()
  for (const column of startableBoardColumns) {
    groupedBoardColumns.set(column.boardId, [...(groupedBoardColumns.get(column.boardId) ?? []), column])
  }

  const updateStage = (stageId: string, change: (stage: WorkflowStageEditorStage) => WorkflowStageEditorStage) => {
    onChange(stages.map((stage) => stage.id === stageId ? change(stage) : stage), [...transitions])
  }

  const updateTransition = (index: number, patch: Partial<WorkflowStageEditorTransition>) => {
    const current = transitions[index]
    const candidate = { ...current, ...patch }
    const key = transitionKey(candidate.from_stage_id, candidate.on, candidate.route_label_id)
    const duplicate = transitions.some((transition, otherIndex) => otherIndex !== index
      && transitionKey(transition.from_stage_id, transition.on, transition.route_label_id) === key)
    if (duplicate || (candidate.from_stage_id === candidate.to_stage_id && candidate.on !== 'needs_changes')) return
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
  }

  const removeStage = (stageId: string) => {
    if (disabled || stages.length <= 1) return
    onChange(stages.filter((stage) => stage.id !== stageId), transitions.filter((transition) => transition.from_stage_id !== stageId && transition.to_stage_id !== stageId))
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
    const transition = nextTransition(stages, transitions, activeTopicLabels)
    if (transition) onChange([...stages], [...transitions, transition])
  }

  const addLabelledAlternative = () => {
    if (disabled || transitions.length >= 100) return
    const transition = nextLabelledAlternative(stages, transitions, activeTopicLabels)
    if (transition) onChange([...stages], [...transitions, transition])
  }

  const nextEdge = nextTransition(stages, transitions, activeTopicLabels)
  const nextLabelledEdge = nextLabelledAlternative(stages, transitions, activeTopicLabels)

  return (
    <section aria-label="Workflowphasen bearbeiten" className="space-y-4" data-testid={`workflow-${safePrefix}-stages-editor`}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">Phasen und Übergänge</h3>
            <p className="mt-1 text-xs text-muted-foreground">Die erste Phase startet zuerst. Übergänge steuern, wohin ein angenommenes, überarbeitetes, blockiertes oder fehlgeschlagenes Ergebnis führt.</p>
          </div>
          <Button type="button" variant="outline" onClick={addStage} disabled={disabled || stages.length >= 30}>
            <Plus />Phase hinzufügen
          </Button>
        </div>
        {stages.length >= 30 && <p role="status" className="text-xs text-muted-foreground">Ein Workflow kann höchstens 30 Phasen enthalten.</p>}
      </div>

      <div className="space-y-3">
        {stages.map((stage, index) => {
          const rowId = `workflow-${safePrefix}-stage-${stage.id}`
          const nameInputId = `${reactId}-stage-name-${stage.id}`
          const nameHintId = `${nameInputId}-hint`
          const kindSelectId = `${reactId}-stage-kind-${stage.id}`
          const roleSelectId = `${reactId}-stage-profile-${stage.id}`
          const instructionsId = `${reactId}-stage-instructions-${stage.id}`
          const boardTargetSelectId = `${reactId}-stage-board-target-${stage.id}`
          const approvedProfile = profiles.find((profile) => profile.id === stage.agent_profile_id)
          const completionPolicy = stage.run_completion_policy
          const stageKindIsKnown = stageKinds.some((kind) => kind.value === stage.kind)
          const savedTarget = stage.board_target
          const savedTargetKey = savedTarget ? boardTargetValue(savedTarget.board_id, savedTarget.column_id) : keepBoardTargetValue
          const savedTargetColumn = savedTarget
            ? boardColumns?.find((column) => column.boardId === savedTarget.board_id && column.columnId === savedTarget.column_id)
            : undefined
          const savedTargetUnavailable = Boolean(savedTarget && boardColumns !== undefined
            && !startableBoardColumns.some((column) => column.boardId === savedTarget.board_id && column.columnId === savedTarget.column_id))
          const savedTargetNeedsFallback = Boolean(savedTarget && (boardColumns === undefined || savedTargetUnavailable))

          return (
            <article key={stage.id} className="space-y-4 rounded-lg border p-4" data-testid={rowId}>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-medium">Phase {index + 1}: {stage.name || 'Ohne Namen'}</h4>
                  {index === 0 && <Badge variant="secondary">Startphase</Badge>}
                  <span className="text-xs text-muted-foreground">ID: {stage.id}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={`Phase ${index + 1} nach oben verschieben`} title={`Phase ${index + 1} nach oben verschieben`} disabled={disabled || index === 0} onClick={() => moveStage(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Phase ${index + 1} nach unten verschieben`} title={`Phase ${index + 1} nach unten verschieben`} disabled={disabled || index === stages.length - 1} onClick={() => moveStage(index, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" data-testid={`workflow-${safePrefix}-stage-remove-${stage.id}`} disabled={disabled || stages.length <= 1} onClick={() => removeStage(stage.id)}>
                    <Trash2 />Phase entfernen
                  </Button>
                </div>
              </header>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={nameInputId}>Name der Phase {index + 1}</Label>
                  <Input
                    id={nameInputId}
                    data-testid={`workflow-${safePrefix}-stage-name-${stage.id}`}
                    value={stage.name}
                    maxLength={120}
                    disabled={disabled}
                    aria-invalid={!stage.name.trim()}
                    aria-describedby={!stage.name.trim() ? nameHintId : undefined}
                    onChange={(event) => updateStage(stage.id, (current) => ({ ...current, name: event.target.value }))}
                  />
                  {!stage.name.trim() && <p id={nameHintId} role="alert" className="text-xs text-destructive">Gib dieser Phase einen Namen.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={kindSelectId}>Art der Phase</Label>
                  <Select value={stage.kind} disabled={disabled} onValueChange={(kind) => updateStage(stage.id, (current) => ({ ...current, kind }))}>
                    <SelectTrigger id={kindSelectId} data-testid={`workflow-${safePrefix}-stage-kind-${stage.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stageKinds.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}
                      {!stageKindIsKnown && <SelectItem value={stage.kind} disabled>Bestehende Schrittart: {stage.kind}</SelectItem>}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Arbeitsphasen starten das Rollenprofil. Reviewphasen werden zusätzlich für Review-Ergebnisse ausgewertet.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={roleSelectId}>Agentrolle für Phase {index + 1}</Label>
                  <Select
                    value={stage.agent_profile_id ?? noProfileValue}
                    disabled={disabled}
                    onValueChange={(profileId) => updateStage(stage.id, (current) => ({ ...current, agent_profile_id: profileId === noProfileValue ? null : profileId }))}
                  >
                    <SelectTrigger id={roleSelectId} data-testid={`workflow-${safePrefix}-stage-agent-role-${stage.id}`}>
                      <SelectValue placeholder="Rolle auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={noProfileValue}>Keine Agentrolle</SelectItem>
                      {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name} · {profile.role}</SelectItem>)}
                      {stage.agent_profile_id && !approvedProfile && <SelectItem value={stage.agent_profile_id} disabled>Gespeicherte Rolle nicht für dieses Projekt und diese T3-Verbindung freigegeben · {stage.agent_profile_id}</SelectItem>}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Du kannst die Vorlage ohne Rolle speichern. Weise für den Start jeder Phase eine Agentrolle zu. Für eine Entscheidung durch dich nutze Menschliche Freigabe. Angezeigt werden nur für das Projekt und dieselbe T3-Verbindung freigegebene Rollen.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={boardTargetSelectId}>Boardspalte bei Phasenstart für Phase {index + 1}</Label>
                  <Select
                    value={savedTargetKey}
                    disabled={disabled}
                    onValueChange={(value) => updateStage(stage.id, (current) => {
                      const next = { ...current }
                      const target = value === keepBoardTargetValue ? null : parseBoardTargetValue(value)
                      if (target) next.board_target = target
                      else delete next.board_target
                      return next
                    })}
                  >
                    <SelectTrigger id={boardTargetSelectId} data-testid={`workflow-${safePrefix}-stage-board-target-${stage.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={keepBoardTargetValue}>Spalte beibehalten</SelectItem>
                      {savedTarget && savedTargetNeedsFallback && (
                        <SelectItem value={savedTargetKey} disabled>
                          {boardColumns === undefined
                            ? `Gespeichertes Boardziel wird geprüft · ${savedTarget.board_id}/${savedTarget.column_id}`
                            : savedTargetColumn
                              ? `${savedTargetColumn.boardName} · ${savedTargetColumn.columnName} (nicht verfügbar)`
                              : `Gespeichertes Boardziel nicht verfügbar · ${savedTarget.board_id}/${savedTarget.column_id}`}
                        </SelectItem>
                      )}
                      {[...groupedBoardColumns.entries()].map(([boardId, columns]) => (
                        <SelectGroup key={boardId}>
                          <SelectLabel>{columns[0].boardName}</SelectLabel>
                          {columns.map((column) => <SelectItem key={column.columnId} value={boardTargetValue(column.boardId, column.columnId)}>{column.columnName} · {targetCategoryLabel(column.defaultDropStatusCategory)}</SelectItem>)}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {savedTargetUnavailable && <p role="status" className="text-xs text-amber-900">Das gespeicherte Boardziel ist nicht mehr für neue Phasenstarts verfügbar: {boardColumnUnavailableReason(savedTargetColumn)} Es bleibt erhalten, bis du es bewusst entfernst oder ersetzt.</p>}
                  {!projectId && <p className="text-xs text-muted-foreground">Projektübergreifende Workflows können keine neuen projektspezifischen Boardziele festlegen.</p>}
                  {projectId && boardColumns === undefined && <p role="status" className="text-xs text-muted-foreground">Projektboards werden geladen. Gespeicherte Boardziele bleiben bis dahin erhalten.</p>}
                  {projectId && boardColumns?.length === 0 && <p className="text-xs text-muted-foreground">Für dieses Projekt sind keine Boardspalten verfügbar; die bestehende Spaltenzuordnung bleibt unverändert.</p>}
                  {projectId && boardColumns && boardColumns.length > 0 && startableBoardColumns.length === 0 && <p className="text-xs text-muted-foreground">Keine nicht archivierte Boardspalte mit startbarem Standardstatus in Bereit, In Arbeit oder Review.</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={instructionsId}>Auftrag für diese Phase</Label>
                <Textarea
                  id={instructionsId}
                  data-testid={`workflow-${safePrefix}-stage-instructions-${stage.id}`}
                  value={stage.instructions ?? ''}
                  maxLength={12000}
                  disabled={disabled}
                  onChange={(event) => updateStage(stage.id, (current) => {
                    const next = { ...current }
                    if (event.target.value === '') delete next.instructions
                    else next.instructions = event.target.value
                    return next
                  })}
                  placeholder="Beschreibe den Auftrag dieser Phase."
                  aria-describedby={`${instructionsId}-hint`}
                />
                <p id={`${instructionsId}-hint`} className="text-xs text-muted-foreground">Diese phasenspezifische Anweisung wird mit der Workflowversion gespeichert und beim Start an die ausgewählte Rolle übergeben. Maximal 12.000 Zeichen.</p>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/40 p-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${reactId}-stage-human-approval-${stage.id}`}
                      data-testid={`workflow-${safePrefix}-stage-human-approval-${stage.id}`}
                      checked={completionPolicy.require_human_phase_decision}
                      disabled={disabled}
                      onCheckedChange={(checked) => updateStage(stage.id, (current) => ({
                        ...current,
                        run_completion_policy: { ...current.run_completion_policy, require_human_phase_decision: checked === true },
                      }))}
                    />
                    <Label htmlFor={`${reactId}-stage-human-approval-${stage.id}`}>Menschliche Freigabe</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">Nach dem Phasenergebnis wartet der Übergang auf die Entscheidung des Eigentümers. Die übrige Abschluss- und Übergangspolicy bleibt erhalten.</p>
                </div>
              </div>

              <details className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">Weitere gespeicherte Abschlussregeln ansehen</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>{completionPolicy.require_external_settled ? 'Der externe T3-Lauf muss abgeschlossen sein.' : 'Der Abschluss des externen T3-Laufs ist nicht erforderlich.'}</li>
                  {completionPolicy.required_evidence_kinds.map((kind) => <li key={`evidence-${kind}`}>Erforderlicher Nachweis: {kind}</li>)}
                  {completionPolicy.required_criterion_ids.map((criterionId) => <li key={`criterion-${criterionId}`}>Erforderliches Ticketkriterium: {criterionId}</li>)}
                  {completionPolicy.require_human_confirmed_evidence && <li>Gemeldete Nachweise müssen menschlich bestätigt sein.</li>}
                  {!completionPolicy.required_evidence_kinds.length && !completionPolicy.required_criterion_ids.length && !completionPolicy.require_human_confirmed_evidence && <li>Keine zusätzlichen Nachweis- oder Kriterienanforderungen.</li>}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Diese Regeln werden beim Bearbeiten übernommen. Die Phase kann sie im Editor oben nur um die menschliche Freigabe ergänzen.</p>
              </details>

              {stage.entry_conditions.length > 0 && (
                <details className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">Gespeicherte Startbedingungen ({stage.entry_conditions.length})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {stage.entry_conditions.map((condition, conditionIndex) => <li key={`${condition.type}-${conditionIndex}`}>{conditionLabel(condition)}</li>)}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">Startbedingungen werden vor der Phase geprüft und beim Bearbeiten unverändert erhalten.</p>
                </details>
              )}
            </article>
          )
        })}
      </div>

      <section aria-label="Workflowübergänge" className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-medium">Übergänge und Ergebnisrouten</h4>
            <p className="mt-1 text-xs text-muted-foreground">Für jedes Ergebnis kannst du eine Standardroute und Alternativen mit Themenlabels festlegen. Wählt der Agent keine Route, gilt das passende Themenlabel am Ticket. Bei mehreren Treffern wartet der Workflow auf Klärung. Ohne Treffer nutzt er die Standardroute, falls eine eingerichtet ist.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={addTransition} disabled={disabled || transitions.length >= 100 || !nextEdge}>
              <Plus />Übergang hinzufügen
            </Button>
            <Button type="button" variant="outline" onClick={addLabelledAlternative} disabled={disabled || transitions.length >= 100 || !nextLabelledEdge}>
              <Plus />Gelabelte Alternative hinzufügen
            </Button>
          </div>
        </div>
        {transitions.length >= 100 && <p role="status" className="text-xs text-muted-foreground">Ein Workflow kann höchstens 100 Übergänge enthalten.</p>}
        {transitions.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Übergangsregeln. Eine erfolgreiche Phase kann ohne passende Route den Workflow beenden.</p>}
        {transitions.map((transition, index) => {
          const rowId = `workflow-${safePrefix}-transition-${index}`
          const fromId = `${reactId}-transition-${index}-from`
          const outcomeId = `${reactId}-transition-${index}-outcome`
          const toId = `${reactId}-transition-${index}-to`
          const labelId = `${reactId}-transition-${index}-label`
          const selectedRouteLabel = transition.route_label_id
            ? activeTopicLabels.find((label) => label.id === transition.route_label_id)
            : undefined

          const conflicts = (fromStageId: string, outcome: WorkflowStageEditorTransition['on'], routeLabelId?: string) => transitions.some((other, otherIndex) => otherIndex !== index
            && transitionKey(other.from_stage_id, other.on, other.route_label_id) === transitionKey(fromStageId, outcome, routeLabelId))

          return (
            <article key={`${transition.from_stage_id}-${transition.on}-${transition.route_label_id ?? 'default'}-${index}`} className="space-y-3 rounded-md border p-3" data-testid={rowId}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor={fromId}>Von Phase</Label>
                  <Select value={transition.from_stage_id} disabled={disabled} onValueChange={(fromStageId) => updateTransition(index, { from_stage_id: fromStageId })}>
                    <SelectTrigger id={fromId} data-testid={`${rowId}-from`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stages.map((stage) => <SelectItem key={stage.id} value={stage.id} disabled={conflicts(stage.id, transition.on, transition.route_label_id) || (stage.id === transition.to_stage_id && transition.on !== 'needs_changes')}>{stage.name} · {stage.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={outcomeId}>Ergebnis</Label>
                  <Select value={transition.on} disabled={disabled} onValueChange={(on) => updateTransition(index, { on: on as WorkflowStageEditorTransition['on'] })}>
                    <SelectTrigger id={outcomeId} data-testid={`${rowId}-outcome`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {outcomes.map((outcome) => <SelectItem key={outcome.value} value={outcome.value} disabled={conflicts(transition.from_stage_id, outcome.value, transition.route_label_id) || (transition.from_stage_id === transition.to_stage_id && outcome.value !== 'needs_changes')}>{outcome.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={toId}>Zu Phase</Label>
                  <Select value={transition.to_stage_id} disabled={disabled} onValueChange={(toStageId) => updateTransition(index, { to_stage_id: toStageId })}>
                    <SelectTrigger id={toId} data-testid={`${rowId}-to`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stages.map((stage) => <SelectItem key={stage.id} value={stage.id} disabled={stage.id === transition.from_stage_id && transition.on !== 'needs_changes'}>{stage.name} · {stage.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={labelId}>Label für diesen Übergang</Label>
                  <Select
                    value={transition.route_label_id ?? defaultRouteLabelValue}
                    disabled={disabled}
                    onValueChange={(value) => {
                      const current = transitions[index]
                      const routeLabelId = value === defaultRouteLabelValue ? undefined : value
                      const duplicate = transitions.some((other, otherIndex) => otherIndex !== index
                        && transitionKey(other.from_stage_id, other.on, other.route_label_id) === transitionKey(current.from_stage_id, current.on, routeLabelId))
                      if (duplicate) return
                      const next = { ...current }
                      if (routeLabelId) next.route_label_id = routeLabelId
                      else delete next.route_label_id
                      onChange([...stages], transitions.map((other, otherIndex) => otherIndex === index ? next : other))
                    }}
                  >
                    <SelectTrigger id={labelId} data-testid={`${rowId}-route-label`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={defaultRouteLabelValue} disabled={conflicts(transition.from_stage_id, transition.on)}>Standardroute</SelectItem>
                      {transition.route_label_id && !selectedRouteLabel && <SelectItem value={transition.route_label_id} disabled>Gespeichertes Label nicht mehr aktiv · {transition.route_label_id}</SelectItem>}
                      {activeTopicLabels.map((label) => <SelectItem key={label.id} value={label.id} disabled={conflicts(transition.from_stage_id, transition.on, label.id)}>{label.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {activeTopicLabels.length === 0 && <p className="text-xs text-muted-foreground">Für gelabelte Alternativen ist ein aktives Themenlabel des Workflowprojekts erforderlich.</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  {transition.route_label_id && <p className="text-xs text-muted-foreground">Diese Alternative wird durch das Agentenlabel „{selectedRouteLabel?.name ?? transition.route_label_id}“ gewählt.</p>}
                  {transition.conditions.length > 0
                    ? <details className="text-xs"><summary className="cursor-pointer font-medium">Gespeicherte Übergangsbedingungen ({transition.conditions.length})</summary><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{transition.conditions.map((condition, conditionIndex) => <li key={`${condition.type}-${conditionIndex}`}>{conditionLabel(condition)}</li>)}</ul><p className="mt-1 text-muted-foreground">Diese Bedingungen bleiben beim Bearbeiten unverändert erhalten.</p></details>
                    : <p className="text-xs text-muted-foreground">Keine zusätzlichen Übergangsbedingungen.</p>}
                </div>
                <Button type="button" size="sm" variant="ghost" data-testid={`${rowId}-remove`} disabled={disabled} onClick={() => onChange([...stages], transitions.filter((_, otherIndex) => otherIndex !== index))}>
                  <Trash2 />Übergang entfernen
                </Button>
              </div>
            </article>
          )
        })}
        {activeTopicLabels.length === 0 && <p role="status" className="text-xs text-muted-foreground">Projektübergreifende Workflows und Workflows ohne aktive Themenlabels können nur Standardrouten verwenden.</p>}
      </section>

      <p className="text-xs text-muted-foreground">Falkenwarte prüft beim Speichern Phasengraph, erreichbare Startbedingungen, eindeutige Ergebnisrouten und Reparaturgrenzen. Es werden nur typisierte Bedingungen verwendet; freie JavaScript-Ausdrücke sind nicht möglich.</p>
    </section>
  )
}
