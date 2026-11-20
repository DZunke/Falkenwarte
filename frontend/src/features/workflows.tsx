import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Pencil, Plus, Route, TimerReset, X } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { fetchAllPages, useProjectLabels, useProjectStatuses, useProjects } from '@/lib/queries'
import {
  WorkflowStagesEditor,
  type WorkflowBoardColumnOption,
  type WorkflowStageEditorProfile,
  type WorkflowStageEditorRouteLabel,
  type WorkflowStageEditorStage,
  type WorkflowStageEditorTransition,
} from '@/components/WorkflowStagesEditor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const instanceLabels: Record<string, string> = { queued: 'Wartet', running: 'Läuft', paused: 'Pausiert', succeeded: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen' }

type Workflow = components['schemas']['Workflow']
type WorkflowWriteDraft = components['schemas']['WorkflowWrite']
type AgentProfile = components['schemas']['AgentProfile']
type Board = components['schemas']['Board']
type ProjectBinding = components['schemas']['ProjectBinding']

type WorkflowEditorState = {
  workflow: Workflow
  baseVersion: number
  contextProjectId: string
  write: WorkflowWriteDraft
  error: string
  conflict: boolean
}

class WorkflowVersionConflict extends Error {}

function defaultRunCompletionPolicy(): components['schemas']['RunCompletionPolicy'] {
  return {
    require_external_settled: true,
    required_evidence_kinds: [],
    required_criterion_ids: [],
    require_human_phase_decision: false,
    require_human_confirmed_evidence: false,
  }
}

function defaultWorkflowDraft(): WorkflowWriteDraft {
  const policy = defaultRunCompletionPolicy()

  return {
    project_id: null,
    name: '',
    preset_id: 'two-stage-review',
    enabled: true,
    stages: [
      { id: 'work', kind: 'agent_run', name: 'Bearbeitung', agent_profile_id: null, entry_conditions: [], run_completion_policy: { ...policy } },
      { id: 'review', kind: 'review', name: 'Reviewmeldung', agent_profile_id: null, entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: { ...policy, require_human_phase_decision: true } },
    ],
    transitions: [
      { from_stage_id: 'work', to_stage_id: 'review', on: 'accepted', conditions: [] },
      { from_stage_id: 'review', to_stage_id: 'work', on: 'needs_changes', conditions: [] },
    ],
    limits: { max_repair_rounds: 2, max_depth: 3, max_parallel_runs: 1, max_total_seconds: 86400 },
  }
}

function workflowWriteDraft(workflow: Workflow): WorkflowWriteDraft {
  return {
    project_id: workflow.project_id,
    name: workflow.name,
    preset_id: workflow.preset_id,
    enabled: workflow.enabled,
    stages: workflow.stages.map((stage) => ({
      ...stage,
      entry_conditions: stage.entry_conditions.map((condition) => ({ ...condition })),
      run_completion_policy: {
        ...stage.run_completion_policy,
        required_evidence_kinds: [...stage.run_completion_policy.required_evidence_kinds],
        required_criterion_ids: [...stage.run_completion_policy.required_criterion_ids],
      },
      ...(stage.board_target ? { board_target: { ...stage.board_target } } : {}),
    })),
    transitions: workflow.transitions.map((transition) => ({
      ...transition,
      conditions: transition.conditions.map((condition) => ({ ...condition })),
    })),
    limits: { ...workflow.limits },
  }
}

function useProjectBinding(projectId: string) {
  return useQuery({
    queryKey: ['project-binding', projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: projectId } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    },
  })
}

function useWorkflowBoards(projectId: string) {
  return useQuery({
    queryKey: ['workflow-board-options', projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const load = (archived: boolean) => fetchAllPages((cursor) => request(api.GET('/projects/{project_id}/boards', {
        params: { path: { project_id: projectId }, query: { limit: 100, archived, ...(cursor ? { cursor } : {}) } },
      })))
      const [active, archived] = await Promise.all([load(false), load(true)])

      return [...active.items, ...archived.items]
    },
  })
}

function eligibleProfilesForProject(profiles: AgentProfile[], projectId: string, binding: ProjectBinding | null, projectWide = false): WorkflowStageEditorProfile[] {
  if (!projectId || !binding?.active) return []

  return profiles.filter((profile) => profile.enabled
    && profile.connection_id === binding.connection_id
    && (projectWide ? profile.all_projects : profile.all_projects || profile.allowed_project_ids.includes(projectId)))
    .map((profile) => ({ id: profile.id, name: profile.name, role: profile.role }))
}

function boardColumnOptions(boards: Board[] | undefined, statuses: components['schemas']['TaskStatus'][] | undefined): WorkflowBoardColumnOption[] {
  if (!boards || !statuses) return []
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

function selectableBoardTarget(stage: WorkflowStageEditorStage, options: WorkflowBoardColumnOption[]): boolean {
  if (!stage.board_target) return true

  return options.some((option) => option.boardId === stage.board_target?.board_id
    && option.columnId === stage.board_target?.column_id
    && !option.boardArchived
    && Boolean(option.defaultDropStatusId)
    && ['ready', 'active', 'review'].includes(option.defaultDropStatusCategory ?? ''))
}

function hasNewUnavailableRole(stages: WorkflowStageEditorStage[], profiles: WorkflowStageEditorProfile[], original?: Workflow): boolean {
  const eligibleIds = new Set(profiles.map((profile) => profile.id))

  return stages.some((stage) => {
    if (!stage.agent_profile_id || eligibleIds.has(stage.agent_profile_id)) return false
    const originalProfileId = original?.stages.find((saved) => saved.id === stage.id)?.agent_profile_id

    return originalProfileId !== stage.agent_profile_id
  })
}

function hasNewUnavailableBoardTarget(stages: WorkflowStageEditorStage[], options: WorkflowBoardColumnOption[], original?: Workflow): boolean {
  return stages.some((stage) => {
    if (!stage.board_target || selectableBoardTarget(stage, options)) return false
    const originalTarget = original?.stages.find((saved) => saved.id === stage.id)?.board_target

    return originalTarget?.board_id !== stage.board_target?.board_id || originalTarget?.column_id !== stage.board_target?.column_id
  })
}

function hasUnnamedStage(stages: WorkflowStageEditorStage[]): boolean {
  return stages.some((stage) => !stage.name.trim())
}

function WorkflowAvailability({
  projectId,
  bindingQuery,
  eligibleProfiles,
  projectWide,
}: {
  projectId: string
  bindingQuery: ReturnType<typeof useProjectBinding>
  eligibleProfiles: WorkflowStageEditorProfile[]
  projectWide?: boolean
}) {
  if (!projectId) return <p role="status" className="text-xs text-muted-foreground">Lege zuerst ein Falkenwarte-Projekt an, um eine Workflowvorlage einzurichten.</p>
  if (bindingQuery.isPending) return <p role="status" className="text-xs text-muted-foreground">Aktive Projektbindung und passende Rollen werden geprüft…</p>
  if (bindingQuery.isError) {
    return <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
      <span>Die T3-Projektbindung konnte nicht geprüft werden. Die Rollenauswahl bleibt leer.</span>
      <Button size="sm" variant="link" onClick={() => void bindingQuery.refetch()}>Erneut prüfen</Button>
    </div>
  }
  if (!bindingQuery.data?.active) {
    return <p role="status" className="text-xs text-amber-900">Für dieses Projekt ist keine aktive T3-Verbindung gebunden. Du kannst ohne feste Rolle fortfahren; Agentenläufe benötigen später eine aktive Projektbindung. Verbindungen richtest du unter <a className="underline underline-offset-4" href="#/agents">Agents &amp; T3</a> ein.</p>
  }
  if (projectWide) {
    return <p role="status" className="text-xs text-muted-foreground">Diese projektübergreifende Vorlage bietet nur globale Rollen an, die zur T3-Verbindung dieses Projektkontexts passen. Für Projekte mit einer anderen Verbindung ist die Rolle nicht verfügbar.</p>
  }
  if (eligibleProfiles.length === 0) {
    return <p role="status" className="text-xs text-muted-foreground">Keine aktivierte Rolle ist für dieses Projekt und dieselbe T3-Verbindung freigegeben. Du kannst ohne feste Rolle fortfahren oder eine passende Rolle unter <a className="underline underline-offset-4" href="#/roles">Rollen</a> einrichten.</p>
  }

  return <p className="text-xs text-muted-foreground">Je Phase werden nur aktivierte Rollen angeboten, die für dieses Projekt freigegeben und an dieselbe T3-Verbindung gebunden sind.</p>
}

export default function WorkflowsView() {
  const client = useQueryClient()
  const projectsQuery = useProjects()
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/workflows', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const profilesQuery = useQuery({
    queryKey: ['agent-profiles', 'all'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/agent-profiles', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const instancesQuery = useQuery({
    queryKey: ['workflow-instances'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/workflow-instances', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const triggersQuery = useQuery({
    queryKey: ['triggers'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/triggers', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const [projectId, setProjectId] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [createDraft, setCreateDraft] = useState<WorkflowWriteDraft>(defaultWorkflowDraft)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowEditorState | null>(null)
  const [loadingWorkflowId, setLoadingWorkflowId] = useState('')
  const [routeLabelId, setRouteLabelId] = useState('')
  const [routeWorkflowId, setRouteWorkflowId] = useState('')
  const [triggerName, setTriggerName] = useState('')
  const projects = projectsQuery.data?.items ?? []
  const workflows = workflowsQuery.data?.items ?? []
  const profiles = profilesQuery.data?.items ?? []
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0]
  const selectedProjectId = selectedProject?.id ?? ''
  const createBindingQuery = useProjectBinding(selectedProjectId)
  const createProjectBinding = createBindingQuery.isSuccess && createBindingQuery.data?.active ? createBindingQuery.data : null
  const eligibleCreateProfiles = useMemo(
    () => eligibleProfilesForProject(profiles, selectedProjectId, createProjectBinding),
    [profiles, selectedProjectId, createProjectBinding],
  )
  const createLabelsQuery = useProjectLabels(selectedProjectId || undefined)
  const routingQuery = useQuery({
    queryKey: ['routing-rules', selectedProjectId],
    enabled: Boolean(selectedProjectId),
    queryFn: () => request(api.GET('/projects/{project_id}/routing-rules', { params: { path: { project_id: selectedProjectId } } })),
  })
  const routeLabels = (createLabelsQuery.data?.items ?? []).filter((label) => label.active && label.kind === 'topic')
  const workflowLabels = (createLabelsQuery.data?.items ?? []).filter((label) => label.kind === 'workflow' && label.active)
  const createStatusesQuery = useProjectStatuses(selectedProjectId || undefined)
  const createBoardsQuery = useWorkflowBoards(selectedProjectId)
  const createBoardOptions = useMemo(
    () => boardColumnOptions(createBoardsQuery.data, createStatusesQuery.data?.items),
    [createBoardsQuery.data, createStatusesQuery.data],
  )
  const createBoardOptionsReady = !createBoardsQuery.isPending && !createBoardsQuery.isError && !createStatusesQuery.isPending && !createStatusesQuery.isError
  const createBoardOptionsForEditor = createBoardsQuery.isPending || createStatusesQuery.isPending ? undefined : createBoardOptions

  const editContextProjectId = editingWorkflow?.contextProjectId ?? ''
  const editBindingQuery = useProjectBinding(editContextProjectId)
  const editProjectBinding = editBindingQuery.isSuccess && editBindingQuery.data?.active ? editBindingQuery.data : null
  const editIsProjectWide = Boolean(editingWorkflow && editingWorkflow.workflow.project_id === null)
  const eligibleEditProfiles = useMemo(
    () => eligibleProfilesForProject(profiles, editContextProjectId, editProjectBinding, editIsProjectWide),
    [profiles, editContextProjectId, editProjectBinding, editIsProjectWide],
  )
  const editLabelsQuery = useProjectLabels(editContextProjectId || undefined)
  const editRouteLabels = editIsProjectWide ? [] : (editLabelsQuery.data?.items ?? []).filter((label) => label.active && label.kind === 'topic')
  const editStatusesQuery = useProjectStatuses(editIsProjectWide ? undefined : (editingWorkflow?.workflow.project_id ?? undefined))
  const editBoardsQuery = useWorkflowBoards(editIsProjectWide ? '' : (editingWorkflow?.workflow.project_id ?? ''))
  const editBoardOptions = useMemo(
    () => boardColumnOptions(editBoardsQuery.data, editStatusesQuery.data?.items),
    [editBoardsQuery.data, editStatusesQuery.data],
  )
  const editBoardOptionsForEditor = editingWorkflow?.workflow.project_id === null
    ? []
    : editBoardsQuery.isPending || editStatusesQuery.isPending ? undefined : editBoardOptions

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['workflows'] }),
    client.invalidateQueries({ queryKey: ['workflow-instances'] }),
    client.invalidateQueries({ queryKey: ['routing-rules'] }),
    client.invalidateQueries({ queryKey: ['triggers'] }),
  ])

  const openWorkflowEditor = async (workflowId: string, contextProjectId: string) => {
    setLoadingWorkflowId(workflowId)
    try {
      const workflow = await request(api.GET('/workflows/{workflow_id}', { params: { path: { workflow_id: workflowId } } }))
      setEditingWorkflow({
        workflow,
        baseVersion: workflow.version,
        contextProjectId: workflow.project_id ?? contextProjectId,
        write: workflowWriteDraft(workflow),
        error: '',
        conflict: false,
      })
    } catch (error) {
      toast.error(formatError(error))
    } finally {
      setLoadingWorkflowId('')
    }
  }

  const createWorkflow = useMutation({
    mutationFn: () => {
      if (!selectedProjectId) throw new Error('Wähle ein Projekt aus.')
      if (hasUnnamedStage(createDraft.stages)) throw new Error('Gib jeder Phase einen Namen.')
      if (hasNewUnavailableRole(createDraft.stages, eligibleCreateProfiles)) throw new Error('Eine Phase enthält eine Rolle, die für dieses Projekt oder seine T3-Verbindung nicht freigegeben ist. Wähle eine passende Rolle oder „Keine Agentrolle“.')
      if (createDraft.stages.some((stage) => stage.board_target) && (!createBoardOptionsReady || hasNewUnavailableBoardTarget(createDraft.stages, createBoardOptions))) {
        throw new Error('Ein Boardziel ist nicht mehr für Phasenstarts in Bereit, In Arbeit oder Review verfügbar. Wähle eine verfügbare Spalte oder „Spalte beibehalten“.')
      }

      return request(api.POST('/workflows', {
        params: mutationParams(),
        body: { ...createDraft, project_id: selectedProjectId, name: workflowName.trim() },
      }))
    },
    onSuccess: async () => {
      setWorkflowName('')
      setCreateDraft(defaultWorkflowDraft())
      await refresh()
      toast.success('Workflow angelegt')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateCreateDraft = (stages: WorkflowStageEditorStage[], transitions: WorkflowStageEditorTransition[]) => {
    setCreateDraft((current) => ({ ...current, stages, transitions }))
  }

  const selectProject = (nextProjectId: string) => {
    setProjectId(nextProjectId)
    setRouteLabelId('')
    setRouteWorkflowId('')
  }

  const updateEditingDraft = (stages: WorkflowStageEditorStage[], transitions: WorkflowStageEditorTransition[]) => {
    setEditingWorkflow((current) => current ? {
      ...current,
      write: { ...current.write, stages, transitions },
      error: '',
      conflict: false,
    } : current)
  }

  const saveWorkflow = useMutation({
    mutationFn: async () => {
      if (!editingWorkflow) throw new Error('Der Workflowentwurf ist nicht mehr verfügbar.')
      if (editingWorkflow.write.project_id !== editingWorkflow.workflow.project_id) throw new Error('Der Projektbereich eines Workflows kann nach dem Anlegen nicht geändert werden.')
      if (hasUnnamedStage(editingWorkflow.write.stages)) throw new Error('Gib jeder Phase einen Namen.')
      if (hasNewUnavailableRole(editingWorkflow.write.stages, eligibleEditProfiles, editingWorkflow.workflow)) throw new Error('Eine Phase enthält eine neue Rolle, die für das Kontextprojekt oder dessen T3-Verbindung nicht freigegeben ist.')
      if (hasNewUnavailableBoardTarget(editingWorkflow.write.stages, editBoardOptions, editingWorkflow.workflow)) throw new Error('Ein neues Boardziel ist nicht mehr für Phasenstarts in Bereit, In Arbeit oder Review verfügbar.')
      if (!Number.isInteger(editingWorkflow.write.limits.max_repair_rounds) || editingWorkflow.write.limits.max_repair_rounds < 0 || editingWorkflow.write.limits.max_repair_rounds > 20) throw new Error('Automatische Überarbeitungsrunden müssen zwischen 0 und 20 liegen.')

      const response = await api.PUT('/workflows/{workflow_id}', {
        params: { path: { workflow_id: editingWorkflow.workflow.id }, ...mutationParams(editingWorkflow.baseVersion) },
        body: editingWorkflow.write,
      })
      if (response.response.status === 412) throw new WorkflowVersionConflict('Eine andere Person hat den Workflow inzwischen geändert. Lade die aktuelle Version, bevor du erneut speicherst.')

      return request(Promise.resolve(response))
    },
    onSuccess: async () => {
      setEditingWorkflow(null)
      await refresh()
      toast.success('Workflowversion gespeichert')
    },
    onError: (error) => {
      setEditingWorkflow((current) => current ? {
        ...current,
        error: formatError(error),
        conflict: error instanceof WorkflowVersionConflict,
      } : current)
      toast.error(formatError(error))
    },
  })

  const saveRoute = useMutation({
    mutationFn: () => {
      if (!selectedProjectId || !routeLabelId || !routeWorkflowId) throw new Error('Wähle ein Workflowlabel und einen Workflow aus.')
      const workflow = workflows.find((item) => item.id === routeWorkflowId)
      if (!workflow) throw new Error('Der ausgewählte Workflow ist nicht verfügbar.')
      const rules = [...(routingQuery.data?.rules ?? []).filter((rule) => rule.workflow_label_id !== routeLabelId), {
        workflow_label_id: routeLabelId, workflow_id: workflow.id, workflow_definition_version: workflow.definition_version,
      }]
      return request(api.PUT('/projects/{project_id}/routing-rules', {
        params: { path: { project_id: selectedProjectId }, ...mutationParams(routingQuery.data?.version ?? 1) },
        body: { rules, on_unresolved: 'needs_human_decision' },
      }))
    },
    onSuccess: async () => { setRouteLabelId(''); setRouteWorkflowId(''); await refresh(); toast.success('Workflowroute gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const createTrigger = useMutation({
    mutationFn: () => {
      if (!selectedProjectId || !routeWorkflowId) throw new Error('Wähle zuerst ein Projekt und einen Workflow aus.')
      return request(api.POST('/triggers', {
        params: mutationParams(),
        body: { project_id: selectedProjectId, name: triggerName.trim(), workflow_id: routeWorkflowId, task_id: null, spec: { type: 'manual' }, enabled: true },
      }))
    },
    onSuccess: async () => { setTriggerName(''); await refresh(); toast.success('Manueller Workflowstart eingerichtet') },
    onError: (error) => toast.error(formatError(error)),
  })

  if ([projectsQuery, workflowsQuery, profilesQuery, instancesQuery, triggersQuery].some((query) => query.isPending)) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  const pageError = projectsQuery.error ?? workflowsQuery.error ?? profilesQuery.error ?? instancesQuery.error ?? triggersQuery.error
  if (pageError) return <Card><CardContent className="p-6"><h2 className="font-semibold">Workflows konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(pageError)}</p><Button variant="outline" className="mt-4" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>

  const instances = instancesQuery.data?.items ?? []
  const triggers = triggersQuery.data?.items ?? []
  const workflowCards = workflows.map((workflow) => ({
    workflow,
    stageProfiles: workflow.stages.map((stage) => ({
      stage,
      profile: profiles.find((profile) => profile.id === stage.agent_profile_id),
    })),
  }))
  const createRoleConflict = hasNewUnavailableRole(createDraft.stages, eligibleCreateProfiles)
  const createHasUnnamedStage = hasUnnamedStage(createDraft.stages)
  const createBoardConflict = createDraft.stages.some((stage) => stage.board_target)
    && (!createBoardOptionsReady || hasNewUnavailableBoardTarget(createDraft.stages, createBoardOptions))
  const editRoleConflict = editingWorkflow ? hasNewUnavailableRole(editingWorkflow.write.stages, eligibleEditProfiles, editingWorkflow.workflow) : false
  const editHasUnnamedStage = editingWorkflow ? hasUnnamedStage(editingWorkflow.write.stages) : false
  const editBoardConflict = editingWorkflow ? hasNewUnavailableBoardTarget(editingWorkflow.write.stages, editBoardOptions, editingWorkflow.workflow) : false
  const createRouteLabels: WorkflowStageEditorRouteLabel[] = routeLabels.map(({ id, name, active, kind }) => ({ id, name, active, kind }))
  const editRouteLabelsForEditor: WorkflowStageEditorRouteLabel[] = editRouteLabels.map(({ id, name, active, kind }) => ({ id, name, active, kind }))
  const createBoardsForEditor = createBoardOptionsForEditor
  const editBoardsForEditor = editBoardOptionsForEditor

  return (
    <main className="space-y-6">
      <header><p className="text-sm text-muted-foreground">Versionierte Phasen und kontrollierte Starts</p><h1 className="text-2xl font-semibold tracking-tight">Workflows</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Workflows legen fest, wann eine Phase endet und welche Entscheidung folgt. Workflowlabels ordnen eine Route zu und erteilen keine Startfreigabe.</p></header>

      {editingWorkflow && <Card data-testid={`workflow-editor-${editingWorkflow.workflow.id}`}>
        <CardHeader><CardTitle className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Pencil className="size-4 text-muted-foreground" />Workflow bearbeiten · v{editingWorkflow.workflow.definition_version}</span><Button type="button" size="icon" variant="ghost" aria-label="Workflowbearbeitung schließen" onClick={() => setEditingWorkflow(null)}><X /></Button></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor={`workflow-editor-name-${editingWorkflow.workflow.id}`}>Workflowname</Label><Input id={`workflow-editor-name-${editingWorkflow.workflow.id}`} value={editingWorkflow.write.name} maxLength={120} onChange={(event) => setEditingWorkflow((current) => current ? { ...current, write: { ...current.write, name: event.target.value }, error: '', conflict: false } : current)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`workflow-editor-repair-limit-${editingWorkflow.workflow.id}`}>Automatische Überarbeitungsrunden</Label><Input id={`workflow-editor-repair-limit-${editingWorkflow.workflow.id}`} type="number" min={0} max={20} step={1} value={editingWorkflow.write.limits.max_repair_rounds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 20) setEditingWorkflow((current) => current ? { ...current, write: { ...current.write, limits: { ...current.write.limits, max_repair_rounds: value } }, error: '', conflict: false } : current) }} /><p className="text-xs text-muted-foreground">0 bedeutet: Eine konfigurierte Rückkehr wegen „Änderungen nötig“ wartet schon vor der ersten automatischen Überarbeitung auf eine Eigentümerentscheidung. Nach Erreichen des Limits kann der Eigentümer mit Begründung eine zusätzliche Runde freigeben.</p></div>
          <WorkflowAvailability projectId={editContextProjectId} bindingQuery={editBindingQuery} eligibleProfiles={eligibleEditProfiles} projectWide={editIsProjectWide} />
          {editIsProjectWide && <p role="status" className="text-xs text-muted-foreground">Projektübergreifende Workflows bleiben projektunabhängig. Neue Boardziele und label-spezifische Übergänge sind hier nicht verfügbar; gespeicherte Werte bleiben erhalten, bis du sie ausdrücklich änderst.</p>}
          {!editIsProjectWide && editBoardsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektboards konnten nicht geladen werden; gespeicherte Zuordnungen bleiben erhalten.</span><Button size="sm" variant="link" onClick={() => void editBoardsQuery.refetch()}>Boards erneut laden</Button></div>}
          {!editIsProjectWide && editLabelsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektthemenlabels konnten nicht geladen werden; gespeicherte Übergänge bleiben erhalten.</span><Button size="sm" variant="link" onClick={() => void editLabelsQuery.refetch()}>Labels erneut laden</Button></div>}
          <WorkflowStagesEditor
            idPrefix={editingWorkflow.workflow.id}
            projectId={editingWorkflow.workflow.project_id}
            stages={editingWorkflow.write.stages}
            transitions={editingWorkflow.write.transitions}
            profiles={eligibleEditProfiles}
            boardColumns={editBoardsForEditor}
            routeLabels={editRouteLabelsForEditor}
            onChange={updateEditingDraft}
          />
          <p className="text-xs text-muted-foreground">Speichern erzeugt eine neue unveränderliche Workflowversion. Bestehende Workflowlabel-Routen bleiben an ihrer gespeicherten Version, bis du sie unter „Workflowlabels zuordnen“ aktualisierst.</p>
          {editRoleConflict && <p role="alert" className="text-xs text-destructive">Eine neu ausgewählte Agentrolle ist für dieses Projekt oder dessen T3-Verbindung nicht freigegeben. Wähle eine passende Rolle.</p>}
          {editBoardConflict && <p role="alert" className="text-xs text-destructive">Ein neu ausgewähltes Boardziel hat keinen startbaren Standardstatus in Bereit, In Arbeit oder Review. Wähle eine passende Spalte.</p>}
          {editingWorkflow.error && <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm"><p>{editingWorkflow.error}</p>{editingWorkflow.conflict && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={Boolean(loadingWorkflowId)} onClick={() => void openWorkflowEditor(editingWorkflow.workflow.id, editingWorkflow.contextProjectId)}>{loadingWorkflowId === editingWorkflow.workflow.id ? 'Wird geladen…' : 'Aktuelle Workflowversion neu laden'}</Button>}</div>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditingWorkflow(null)}>Abbrechen</Button><Button type="button" disabled={!editingWorkflow.write.name.trim() || saveWorkflow.isPending || editRoleConflict || editBoardConflict || editHasUnnamedStage} onClick={() => saveWorkflow.mutate()}>{saveWorkflow.isPending ? 'Speichert…' : 'Workflowversion speichern'}</Button></div>
        </CardContent>
      </Card>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card data-testid="workflow-editor-create">
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4 text-muted-foreground" />Workflowvorlage anlegen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="workflow-project">Projekt</Label><Select value={selectedProjectId} onValueChange={selectProject}><SelectTrigger id="workflow-project"><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="workflow-name">Workflowname</Label><Input id="workflow-name" value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Bearbeitung mit Reviewmeldung" maxLength={120} /></div>
            <div className="space-y-1.5"><Label htmlFor="workflow-repair-limit">Automatische Überarbeitungsrunden</Label><Input id="workflow-repair-limit" type="number" min={0} max={20} step={1} value={createDraft.limits.max_repair_rounds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 20) setCreateDraft((current) => ({ ...current, limits: { ...current.limits, max_repair_rounds: value } })) }} /><p className="text-xs text-muted-foreground">0 bedeutet: Eine konfigurierte Rückkehr wegen „Änderungen nötig“ wartet schon vor der ersten automatischen Überarbeitung auf eine Eigentümerentscheidung. Nach Erreichen des Limits kann der Eigentümer mit Begründung eine zusätzliche Runde freigeben.</p></div>
            <WorkflowAvailability projectId={selectedProjectId} bindingQuery={createBindingQuery} eligibleProfiles={eligibleCreateProfiles} />
            {createBoardsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektboards konnten nicht geladen werden; neue Boardziele sind nicht verfügbar.</span><Button size="sm" variant="link" onClick={() => void createBoardsQuery.refetch()}>Boards erneut laden</Button></div>}
            {createLabelsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektthemenlabels konnten nicht geladen werden; nur Standardübergänge sind auswählbar.</span><Button size="sm" variant="link" onClick={() => void createLabelsQuery.refetch()}>Labels erneut laden</Button></div>}
            <WorkflowStagesEditor
              idPrefix="create"
              projectId={selectedProjectId || null}
              stages={createDraft.stages}
              transitions={createDraft.transitions}
              profiles={eligibleCreateProfiles}
              boardColumns={createBoardsForEditor}
              routeLabels={createRouteLabels}
              onChange={updateCreateDraft}
            />
            {createRoleConflict && <p role="alert" className="text-xs text-destructive">Eine Phase enthält eine Rolle, die für dieses Projekt oder dessen T3-Verbindung nicht freigegeben ist. Wähle eine passende Rolle oder „Keine Agentrolle“.</p>}
            {createBoardConflict && <p role="alert" className="text-xs text-destructive">Ein Boardziel ist nicht verfügbar oder sein Standardstatus ist keine startbare Phase. Wähle eine startbare Spalte oder „Spalte beibehalten“.</p>}
            <Button disabled={!workflowName.trim() || !selectedProjectId || createWorkflow.isPending || createRoleConflict || createBoardConflict || createHasUnnamedStage} onClick={() => createWorkflow.mutate()}><GitBranch />Workflow anlegen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Route className="size-4 text-muted-foreground" />Workflowlabels zuordnen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="route-project">Projekt</Label><Select value={selectedProjectId} onValueChange={selectProject}><SelectTrigger id="route-project"><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="route-label">Workflowlabel</Label><Select value={routeLabelId} onValueChange={setRouteLabelId}><SelectTrigger id="route-label"><SelectValue placeholder="Label wählen" /></SelectTrigger><SelectContent>{workflowLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="route-workflow">Workflow</Label><Select value={routeWorkflowId} onValueChange={setRouteWorkflowId}><SelectTrigger id="route-workflow"><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{workflows.filter((workflow) => workflow.enabled && (workflow.project_id === null || workflow.project_id === selectedProjectId)).map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name} · v{workflow.definition_version}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <Button variant="outline" disabled={!routeLabelId || !routeWorkflowId || saveRoute.isPending || !routingQuery.data} onClick={() => saveRoute.mutate()}><Route />Zuordnung speichern</Button>
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Aktuelle Zuordnungen</p>
              {(routingQuery.data?.rules ?? []).map((rule) => <div key={rule.workflow_label_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"><span>{workflowLabels.find((label) => label.id === rule.workflow_label_id)?.name ?? 'Workflowlabel'}</span><span className="text-muted-foreground">{workflows.find((workflow) => workflow.id === rule.workflow_id)?.name ?? 'Workflow'} · v{rule.workflow_definition_version}</span></div>)}
              {(routingQuery.data?.rules ?? []).length === 0 && <p className="text-xs text-muted-foreground">Keine automatischen Zuordnungen konfiguriert.</p>}
              <p className="text-xs text-muted-foreground">Bei fehlender oder mehrdeutiger Zuordnung ist eine menschliche Entscheidung erforderlich.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TimerReset className="size-4 text-muted-foreground" />Workflows und laufende Instanzen</CardTitle></CardHeader><CardContent className="space-y-3">
          {workflowCards.map(({ workflow, stageProfiles }) => <article key={workflow.id} className="rounded-lg border p-3" data-testid={`workflow-card-${workflow.id}`}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{workflow.name}</h3><div className="flex items-center gap-2"><Badge variant={workflow.enabled ? 'secondary' : 'outline'}>{workflow.enabled ? 'Aktiv' : 'Pausiert'}</Badge><Button type="button" size="sm" variant="outline" disabled={Boolean(loadingWorkflowId || editingWorkflow)} onClick={() => void openWorkflowEditor(workflow.id, selectedProjectId)}>{loadingWorkflowId === workflow.id ? 'Wird geladen…' : <><Pencil />Workflow bearbeiten</>}</Button></div></div><p className="mt-1 text-xs text-muted-foreground">{workflow.project_id ? projects.find((project) => project.id === workflow.project_id)?.name ?? 'Projekt' : 'Projektübergreifend'} · Version {workflow.definition_version} · {workflow.stages.length} Phasen</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{stageProfiles.map(({ stage, profile }) => <div key={stage.id} className="min-w-0 rounded-md bg-muted/40 p-2 text-xs"><p className="font-medium">{stage.name} <span className="font-normal text-muted-foreground">({stage.kind})</span></p><p className="mt-1 text-muted-foreground">Agentrolle: {stage.agent_profile_id ? profile ? `${profile.name} · ${profile.role}${profile.enabled ? '' : ' · deaktiviert'}` : `Nicht verfügbare Rolle · ${stage.agent_profile_id}` : 'Keine feste Rolle'}</p>{(stage as WorkflowStageEditorStage).instructions?.trim() && <p className="mt-1 text-muted-foreground">Phasenauftrag hinterlegt</p>}{(stage as WorkflowStageEditorStage).board_target && <p className="mt-1 text-muted-foreground">Boardziel hinterlegt</p>}</div>)}</div></article>)}
          {workflows.length === 0 && <p className="py-3 text-sm text-muted-foreground">Noch keine Workflowvorlagen eingerichtet.</p>}
          {instances.slice(0, 8).map((instance) => <div key={instance.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"><span>{workflows.find((workflow) => workflow.id === instance.workflow_id)?.name ?? 'Workflow'} · v{instance.definition_version}</span><Badge variant="outline">{instanceLabels[instance.state] ?? instance.state}</Badge></div>)}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Manuelle Trigger</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor="trigger-name">Name</Label><Input id="trigger-name" value={triggerName} onChange={(event) => setTriggerName(event.target.value)} maxLength={120} placeholder="Manueller Start" /></div><div className="space-y-1.5"><Label htmlFor="trigger-workflow">Workflow</Label><Select value={routeWorkflowId} onValueChange={setRouteWorkflowId}><SelectTrigger id="trigger-workflow"><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{workflows.filter((workflow) => workflow.enabled).map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div><Button disabled={!triggerName.trim() || !routeWorkflowId || !selectedProjectId || createTrigger.isPending} onClick={() => createTrigger.mutate()}><Plus />Einrichten</Button></div>
          <p className="text-xs text-muted-foreground">Ein Trigger führt keinen Code aus und startet keinen Lauf, bevor eine berechtigte Aktion den Workflow anfordert.</p>
          <div className="space-y-2">{triggers.map((trigger) => <div key={trigger.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><div><p className="font-medium">{trigger.name}</p><p className="text-xs text-muted-foreground">{workflows.find((workflow) => workflow.id === trigger.workflow_id)?.name ?? 'Workflow'}</p></div><Badge variant={trigger.enabled ? 'secondary' : 'outline'}>{trigger.enabled ? 'Aktiv' : 'Pausiert'}</Badge></div>)}{triggers.length === 0 && <p className="text-sm text-muted-foreground">Keine manuellen Trigger eingerichtet.</p>}</div>
        </CardContent></Card>
      </section>
    </main>
  )
}
