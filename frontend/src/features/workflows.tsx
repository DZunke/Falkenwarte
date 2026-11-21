import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownRight, ArrowRight, ChevronLeft, GitBranch, Plus, Route, TimerReset } from 'lucide-react'
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
type WorkflowSection = 'templates' | 'routing' | 'runs'

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
  return {
    project_id: null,
    name: '',
    preset_id: 'manual',
    enabled: true,
    stages: [
      { id: 'work', kind: 'agent_run', name: 'Bearbeitung', agent_profile_id: null, entry_conditions: [], run_completion_policy: defaultRunCompletionPolicy() },
    ],
    transitions: [],
    limits: { max_repair_rounds: 2, max_depth: 3, max_parallel_runs: 1, max_total_seconds: 86400 },
  }
}

function twoStageWorkflowDraft(): WorkflowWriteDraft {
  const policy = defaultRunCompletionPolicy()

  return {
    ...defaultWorkflowDraft(),
    preset_id: 'two-stage-review',
    stages: [
      { id: 'work', kind: 'agent_run', name: 'Bearbeitung', agent_profile_id: null, entry_conditions: [], run_completion_policy: { ...policy } },
      { id: 'review', kind: 'review', name: 'Reviewmeldung', agent_profile_id: null, entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: { ...policy, require_human_phase_decision: true } },
    ],
    transitions: [
      { from_stage_id: 'work', to_stage_id: 'review', on: 'accepted', conditions: [] },
      { from_stage_id: 'review', to_stage_id: 'work', on: 'needs_changes', conditions: [] },
    ],
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

function outcomeLabel(value: string): string {
  const labels: Record<string, string> = {
    accepted: 'angenommen',
    needs_changes: 'Änderungen nötig',
    rejected: 'abgelehnt',
    blocked: 'blockiert',
  }

  return labels[value] ?? value.replaceAll('_', ' ')
}

function WorkflowTemplateCard({
  workflow,
  profiles,
  projectName,
  loading,
  busy,
  onOpen,
}: {
  workflow: Workflow
  profiles: AgentProfile[]
  projectName: string
  loading: boolean
  busy: boolean
  onOpen: () => void
}) {
  const stageIndex = new Map(workflow.stages.map((stage, index) => [stage.id, index]))
  const backEdges = workflow.transitions.some((transition) => (stageIndex.get(transition.to_stage_id) ?? -1) <= (stageIndex.get(transition.from_stage_id) ?? -1))
  const branches = workflow.stages.some((stage) => workflow.transitions.filter((transition) => transition.from_stage_id === stage.id).length > 1)

  return <article className="min-w-0 max-w-full overflow-hidden rounded-xl border bg-card p-4" data-testid={`workflow-card-${workflow.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold [overflow-wrap:anywhere]">{workflow.name}</h2>
          {!workflow.enabled && <Badge variant="outline">Deaktiviert</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{projectName} · Version {workflow.definition_version}</p>
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={onOpen}>{loading ? 'Wird geöffnet…' : <><GitBranch />Graph öffnen</>}</Button>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2" data-testid={`workflow-compact-path-${workflow.id}`}>
      {workflow.stages.map((stage, index) => {
        const profile = profiles.find((item) => item.id === stage.agent_profile_id)
        const nextStage = workflow.stages[index + 1]
        const forwardTransition = nextStage && workflow.transitions.find((transition) => transition.from_stage_id === stage.id && transition.to_stage_id === nextStage.id)

        return <div key={stage.id} className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <div className="min-w-0 max-w-full flex-1 basis-40 rounded-lg border bg-muted/30 px-3 py-2">
            <p className="[overflow-wrap:anywhere] font-medium">{stage.name}</p>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{stage.kind === 'review' ? 'Review' : 'Agentenphase'} · {profile ? profile.name : stage.agent_profile_id ? 'Rolle nicht verfügbar' : 'Ohne Agentrolle'}</p>
          </div>
          {nextStage && <div className="flex items-center gap-1 text-muted-foreground" aria-label={forwardTransition ? `Bei ${outcomeLabel(forwardTransition.on)} weiter` : 'Keine direkte Verbindung zur nächsten Phase'}>
            {forwardTransition ? <ArrowRight className="size-4" /> : <span aria-hidden="true" className="px-1">···</span>}
            {forwardTransition && <span className="max-w-24 text-xs">{outcomeLabel(forwardTransition.on)}</span>}
          </div>}
        </div>
      })}
    </div>
    {(backEdges || branches) && <div className="mt-2 flex flex-wrap gap-2">{branches && <Badge variant="outline">Verzweigung</Badge>}{backEdges && <Badge variant="outline"><ArrowDownRight />Rückweg</Badge>}</div>}
  </article>
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

  return null
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
  const [libraryProjectId, setLibraryProjectId] = useState('all')
  const [section, setSection] = useState<WorkflowSection>('templates')
  const [createMode, setCreateMode] = useState(false)
  const [createBaseline, setCreateBaseline] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [createDraft, setCreateDraft] = useState<WorkflowWriteDraft>(defaultWorkflowDraft)
  const [createDraftTouched, setCreateDraftTouched] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowEditorState | null>(null)
  const [loadingWorkflowId, setLoadingWorkflowId] = useState('')
  const [routeLabelId, setRouteLabelId] = useState('')
  const [routeWorkflowId, setRouteWorkflowId] = useState('')
  const [triggerWorkflowId, setTriggerWorkflowId] = useState('')
  const [triggerName, setTriggerName] = useState('')
  const projects = projectsQuery.data?.items ?? []
  const workflows = workflowsQuery.data?.items ?? []
  const profiles = profilesQuery.data?.items ?? []
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0]
  const selectedProjectId = selectedProject?.id ?? ''
  const editorOpen = createMode || Boolean(editingWorkflow)
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
  const createBoardOptionsForEditor = createBoardsQuery.isPending || createBoardsQuery.isError || createStatusesQuery.isPending || createStatusesQuery.isError
    ? undefined
    : createBoardOptions

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
      setCreateMode(false)
      setSection('templates')
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
    onSuccess: async (workflow) => {
      setWorkflowName('')
      setCreateDraft(defaultWorkflowDraft())
      setCreateDraftTouched(false)
      setCreateMode(false)
      setCreateBaseline('')
      setSection('templates')
      setLibraryProjectId(workflow.project_id ?? selectedProjectId)
      await refresh()
      toast.success('Workflow angelegt')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateCreateDraft = (stages: WorkflowStageEditorStage[], transitions: WorkflowStageEditorTransition[]) => {
    setCreateDraftTouched(true)
    setCreateDraft((current) => ({ ...current, stages, transitions }))
  }

  const useTwoStageTemplate = () => {
    if (createDraftTouched || workflowName.trim()) return
    setCreateDraft(twoStageWorkflowDraft())
    setCreateDraftTouched(true)
  }

  const selectProject = (nextProjectId: string) => {
    setProjectId(nextProjectId)
    setRouteLabelId('')
    setRouteWorkflowId('')
    setTriggerWorkflowId('')
  }

  const startCreate = () => {
    const contextProjectId = libraryProjectId === 'all' ? selectedProjectId : libraryProjectId
    const draft = defaultWorkflowDraft()
    setProjectId(contextProjectId)
    setWorkflowName('')
    setCreateDraft(draft)
    setCreateDraftTouched(false)
    setCreateBaseline(JSON.stringify({ projectId: contextProjectId, name: '', write: draft }))
    setEditingWorkflow(null)
    setSection('templates')
    setCreateMode(true)
  }

  const leaveEditor = () => {
    if (createMode) {
      if (createWorkflow.isPending) return
      const current = JSON.stringify({ projectId: selectedProjectId, name: workflowName, write: createDraft })
      if (createBaseline !== current && !window.confirm('Entwurf verwerfen? Deine ungespeicherten Änderungen gehen verloren.')) return
      setCreateMode(false)
      setCreateBaseline('')
      return
    }

    if (editingWorkflow) {
      const current = JSON.stringify(editingWorkflow.write)
      const original = JSON.stringify(workflowWriteDraft(editingWorkflow.workflow))
      if (current !== original && !window.confirm('Änderungen verwerfen? Deine ungespeicherten Änderungen gehen verloren.')) return
      setEditingWorkflow(null)
    }
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
      if (!selectedProjectId || !triggerWorkflowId) throw new Error('Wähle zuerst ein Projekt und einen Workflow aus.')
      return request(api.POST('/triggers', {
        params: mutationParams(),
        body: { project_id: selectedProjectId, name: triggerName.trim(), workflow_id: triggerWorkflowId, task_id: null, spec: { type: 'manual' }, enabled: true },
      }))
    },
    onSuccess: async () => { setTriggerName(''); await refresh(); toast.success('Manueller Workflowstart eingerichtet') },
    onError: (error) => toast.error(formatError(error)),
  })

  if ([projectsQuery, workflowsQuery, profilesQuery, instancesQuery, triggersQuery].some((query) => query.isPending)) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-56 w-full" /></div>
  const pageError = projectsQuery.error ?? workflowsQuery.error ?? profilesQuery.error ?? instancesQuery.error ?? triggersQuery.error
  if (pageError) return <Card><CardContent className="p-6"><h2 className="font-semibold">Workflows konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(pageError)}</p><Button variant="outline" className="mt-4" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>

  const instances = instancesQuery.data?.items ?? []
  const triggers = triggersQuery.data?.items ?? []
  const visibleWorkflows = libraryProjectId === 'all'
    ? workflows
    : workflows.filter((workflow) => workflow.project_id === libraryProjectId || workflow.project_id === null)
  const createRoleConflict = hasNewUnavailableRole(createDraft.stages, eligibleCreateProfiles)
  const createHasUnnamedStage = hasUnnamedStage(createDraft.stages)
  const createBoardConflict = createDraft.stages.some((stage) => stage.board_target)
    && (!createBoardOptionsReady || hasNewUnavailableBoardTarget(createDraft.stages, createBoardOptions))
  const editRoleConflict = editingWorkflow ? hasNewUnavailableRole(editingWorkflow.write.stages, eligibleEditProfiles, editingWorkflow.workflow) : false
  const editHasUnnamedStage = editingWorkflow ? hasUnnamedStage(editingWorkflow.write.stages) : false
  const editBoardConflict = editingWorkflow ? hasNewUnavailableBoardTarget(editingWorkflow.write.stages, editBoardOptions, editingWorkflow.workflow) : false
  const createRouteLabels: WorkflowStageEditorRouteLabel[] | undefined = createLabelsQuery.isPending || createLabelsQuery.isError
    ? undefined
    : routeLabels.map(({ id, name, active, kind }) => ({ id, name, active, kind }))
  const editRouteLabelsForEditor: WorkflowStageEditorRouteLabel[] | undefined = editIsProjectWide || editLabelsQuery.isPending || editLabelsQuery.isError
    ? undefined
    : editRouteLabels.map(({ id, name, active, kind }) => ({ id, name, active, kind }))
  const createBoardsForEditor = createBoardOptionsForEditor
  const editBoardsForEditor = editingWorkflow?.workflow.project_id === null || editBoardsQuery.isPending || editBoardsQuery.isError || editStatusesQuery.isPending || editStatusesQuery.isError
    ? undefined
    : editBoardOptionsForEditor
  const routeWorkflows = workflows.filter((workflow) => workflow.enabled && (workflow.project_id === null || workflow.project_id === selectedProjectId))
  const projectTriggers = triggers.filter((trigger) => trigger.project_id === selectedProjectId)

  return (
    <main className="space-y-6">
      {editorOpen ? <header className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" className="-ml-3" disabled={createWorkflow.isPending || saveWorkflow.isPending} onClick={leaveEditor}><ChevronLeft />Zurück zu Vorlagen</Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{createMode ? 'Neue Vorlage' : editingWorkflow?.write.name}</h1>
          {editingWorkflow && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{editingWorkflow.workflow.project_id ? projects.find((project) => project.id === editingWorkflow.workflow.project_id)?.name ?? 'Projekt' : 'Projektübergreifend'} · Version {editingWorkflow.workflow.definition_version}</p>}
        </div>
      </header> : <>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        </header>
        <nav aria-label="Workflowbereiche" className="flex flex-wrap gap-2 border-b pb-3">
          <Button type="button" size="sm" variant={section === 'templates' ? 'secondary' : 'ghost'} aria-current={section === 'templates' ? 'page' : undefined} onClick={() => setSection('templates')}>Vorlagen</Button>
          <Button type="button" size="sm" variant={section === 'routing' ? 'secondary' : 'ghost'} aria-current={section === 'routing' ? 'page' : undefined} onClick={() => setSection('routing')}><Route />Routen &amp; Trigger</Button>
          <Button type="button" size="sm" variant={section === 'runs' ? 'secondary' : 'ghost'} aria-current={section === 'runs' ? 'page' : undefined} onClick={() => setSection('runs')}><TimerReset />Läufe</Button>
        </nav>
      </>}

      {editorOpen && (createMode ? <Card data-testid="workflow-editor-create" className="w-full">
        <CardContent className="space-y-5 p-4 md:p-6">
          <div className="grid gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(280px,2fr)]">
            <div className="space-y-1.5"><Label htmlFor="workflow-project">Projekt</Label><Select value={selectedProjectId} disabled={createWorkflow.isPending} onValueChange={selectProject}><SelectTrigger id="workflow-project"><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="workflow-name">Workflowname</Label><Input id="workflow-name" disabled={createWorkflow.isPending} value={workflowName} onChange={(event) => { setWorkflowName(event.target.value); setCreateDraftTouched(true) }} placeholder="Discovery, Umsetzung und Review" maxLength={120} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!createDraftTouched && !workflowName.trim() && <Button type="button" variant="outline" disabled={createWorkflow.isPending} onClick={useTwoStageTemplate}><GitBranch />Zwei-Phasen-Vorlage verwenden</Button>}
            <div className="flex items-center gap-2"><Label htmlFor="workflow-repair-limit" className="whitespace-nowrap">Überarbeitungsrunden</Label><Input id="workflow-repair-limit" className="w-24" type="number" min={0} max={20} step={1} disabled={createWorkflow.isPending} value={createDraft.limits.max_repair_rounds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 20) { setCreateDraft((current) => ({ ...current, limits: { ...current.limits, max_repair_rounds: value } })); setCreateDraftTouched(true) } }} /></div>
            <p className="text-xs text-muted-foreground">0 schaltet automatische Überarbeitungen aus.</p>
          </div>
          <WorkflowAvailability projectId={selectedProjectId} bindingQuery={createBindingQuery} eligibleProfiles={eligibleCreateProfiles} />
          {createBoardsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektboards konnten nicht geladen werden.</span><Button size="sm" variant="link" onClick={() => void createBoardsQuery.refetch()}>Erneut prüfen</Button></div>}
          {createLabelsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektthemenlabels konnten nicht geladen werden.</span><Button size="sm" variant="link" onClick={() => void createLabelsQuery.refetch()}>Erneut prüfen</Button></div>}
          <WorkflowStagesEditor idPrefix="create" projectId={selectedProjectId || null} stages={createDraft.stages} transitions={createDraft.transitions} profiles={eligibleCreateProfiles} boardColumns={createBoardsForEditor} routeLabels={createRouteLabels} disabled={createWorkflow.isPending} onChange={updateCreateDraft} />
          {createRoleConflict && <p role="alert" className="text-sm text-destructive">Eine Agentrolle ist für dieses Projekt oder dessen T3-Verbindung nicht freigegeben.</p>}
          {createBoardConflict && <p role="alert" className="text-sm text-destructive">Ein Boardziel ist nicht mehr für Phasenstarts verfügbar.</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={createWorkflow.isPending} onClick={leaveEditor}>Abbrechen</Button><Button disabled={!workflowName.trim() || !selectedProjectId || createWorkflow.isPending || createRoleConflict || createBoardConflict || createHasUnnamedStage} onClick={() => createWorkflow.mutate()}><GitBranch />{createWorkflow.isPending ? 'Wird angelegt…' : 'Workflow anlegen'}</Button></div>
        </CardContent>
      </Card> : editingWorkflow && <Card data-testid={`workflow-editor-${editingWorkflow.workflow.id}`} className="w-full">
        <CardContent className="space-y-5 p-4 md:p-6">
          <div className="grid gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(280px,2fr)]">
            <div className="space-y-1.5"><Label htmlFor={`workflow-editor-name-${editingWorkflow.workflow.id}`}>Workflowname</Label><Input id={`workflow-editor-name-${editingWorkflow.workflow.id}`} disabled={saveWorkflow.isPending} value={editingWorkflow.write.name} maxLength={120} onChange={(event) => setEditingWorkflow((current) => current ? { ...current, write: { ...current.write, name: event.target.value }, error: '', conflict: false } : current)} /></div>
            <div className="flex items-end gap-3"><div className="space-y-1.5"><Label htmlFor={`workflow-editor-repair-limit-${editingWorkflow.workflow.id}`}>Überarbeitungsrunden</Label><Input id={`workflow-editor-repair-limit-${editingWorkflow.workflow.id}`} disabled={saveWorkflow.isPending} className="w-28" type="number" min={0} max={20} step={1} value={editingWorkflow.write.limits.max_repair_rounds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 20) setEditingWorkflow((current) => current ? { ...current, write: { ...current.write, limits: { ...current.write.limits, max_repair_rounds: value } }, error: '', conflict: false } : current) }} /></div><p className="pb-2 text-xs text-muted-foreground">0 schaltet automatische Überarbeitungen aus.</p></div>
          </div>
          <WorkflowAvailability projectId={editContextProjectId} bindingQuery={editBindingQuery} eligibleProfiles={eligibleEditProfiles} projectWide={editIsProjectWide} />
          {editIsProjectWide && <p role="status" className="text-xs text-muted-foreground">Projektübergreifende Workflows bieten keine neuen Boardziele oder label-spezifischen Übergänge. Gespeicherte Werte bleiben erhalten.</p>}
          {!editIsProjectWide && editBoardsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektboards konnten nicht geladen werden; gespeicherte Ziele bleiben erhalten.</span><Button size="sm" variant="link" onClick={() => void editBoardsQuery.refetch()}>Erneut prüfen</Button></div>}
          {!editIsProjectWide && editLabelsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span>Projektthemenlabels konnten nicht geladen werden; gespeicherte Übergänge bleiben erhalten.</span><Button size="sm" variant="link" onClick={() => void editLabelsQuery.refetch()}>Erneut prüfen</Button></div>}
          <WorkflowStagesEditor idPrefix={editingWorkflow.workflow.id} projectId={editingWorkflow.workflow.project_id} stages={editingWorkflow.write.stages} transitions={editingWorkflow.write.transitions} profiles={eligibleEditProfiles} boardColumns={editBoardsForEditor} routeLabels={editRouteLabelsForEditor} selectFirstStageInitially={false} disabled={saveWorkflow.isPending} onChange={updateEditingDraft} />
          {editRoleConflict && <p role="alert" className="text-sm text-destructive">Eine neu ausgewählte Agentrolle ist für dieses Projekt oder dessen T3-Verbindung nicht freigegeben.</p>}
          {editBoardConflict && <p role="alert" className="text-sm text-destructive">Ein neues Boardziel ist nicht mehr für Phasenstarts verfügbar.</p>}
          {editingWorkflow.error && <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm"><p>{editingWorkflow.error}</p>{editingWorkflow.conflict && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={Boolean(loadingWorkflowId) || saveWorkflow.isPending} onClick={() => void openWorkflowEditor(editingWorkflow.workflow.id, editingWorkflow.contextProjectId)}>{loadingWorkflowId === editingWorkflow.workflow.id ? 'Wird geladen…' : 'Aktuelle Version neu laden'}</Button>}</div>}
          <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><p className="self-center text-xs text-muted-foreground">Speichern erzeugt eine neue Workflowversion.</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={saveWorkflow.isPending} onClick={leaveEditor}>Abbrechen</Button><Button type="button" disabled={!editingWorkflow.write.name.trim() || saveWorkflow.isPending || editRoleConflict || editBoardConflict || editHasUnnamedStage} onClick={() => saveWorkflow.mutate()}>{saveWorkflow.isPending ? 'Speichert…' : 'Workflowversion speichern'}</Button></div></div>
        </CardContent>
      </Card>)}

      {!editorOpen && section === 'templates' && <section id="workflow-panel-templates" className="space-y-4" aria-label="Workflowvorlagen">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-sm space-y-1.5"><Label htmlFor="workflow-library-project">Projekt</Label><Select value={libraryProjectId} onValueChange={setLibraryProjectId}><SelectTrigger id="workflow-library-project"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Projekte</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
          <Button type="button" onClick={startCreate} disabled={projects.length === 0}><Plus />Neue Vorlage</Button>
        </div>
        {projects.length === 0 && <Card><CardContent className="p-6"><h2 className="font-semibold">Zuerst ein Projekt anlegen</h2><p className="mt-1 text-sm text-muted-foreground">Workflows gehören zu einem Projekt und verwenden dessen Rollen und Boards.</p><Button asChild className="mt-4"><a href="#/projects">Zu Projekten</a></Button></CardContent></Card>}
        {projects.length > 0 && visibleWorkflows.length === 0 && <Card className="border-dashed"><CardContent className="flex min-h-40 flex-col items-center justify-center p-8 text-center"><GitBranch className="mb-3 size-8 text-muted-foreground" /><h2 className="font-semibold">Noch keine Workflowvorlagen</h2><p className="mt-1 max-w-lg text-sm text-muted-foreground">Lege einen Ablauf mit Phasen und Übergängen an. Gespeicherte Vorlagen lassen sich danach direkt im Graph öffnen.</p></CardContent></Card>}
        {visibleWorkflows.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{visibleWorkflows.map((workflow) => <WorkflowTemplateCard key={workflow.id} workflow={workflow} profiles={profiles} projectName={workflow.project_id ? projects.find((project) => project.id === workflow.project_id)?.name ?? 'Projekt' : 'Projektübergreifend'} loading={loadingWorkflowId === workflow.id} busy={Boolean(loadingWorkflowId)} onOpen={() => void openWorkflowEditor(workflow.id, workflow.project_id ?? (libraryProjectId === 'all' ? selectedProjectId : libraryProjectId))} />)}</div>}
      </section>}

      {!editorOpen && section === 'routing' && <section id="workflow-panel-routing" className="space-y-4" aria-label="Routen und manuelle Trigger">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Route className="size-4 text-muted-foreground" />Workflowlabel-Routen</CardTitle><p className="text-sm text-muted-foreground">Eine Route ordnet ein Label einer festen Workflowversion zu.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div className="space-y-1.5"><Label htmlFor="route-project">Projekt</Label><Select value={selectedProjectId} onValueChange={selectProject}><SelectTrigger id="route-project"><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="route-label">Workflowlabel</Label><Select value={routeLabelId} onValueChange={setRouteLabelId}><SelectTrigger id="route-label"><SelectValue placeholder="Label wählen" /></SelectTrigger><SelectContent>{workflowLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label htmlFor="route-workflow">Workflow</Label><Select value={routeWorkflowId} onValueChange={setRouteWorkflowId}><SelectTrigger id="route-workflow"><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{routeWorkflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name} · v{workflow.definition_version}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <Button variant="outline" disabled={!routeLabelId || !routeWorkflowId || saveRoute.isPending || !routingQuery.data} onClick={() => saveRoute.mutate()}><Route />Zuordnung speichern</Button>
            <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">Aktuelle Zuordnungen</p>{(routingQuery.data?.rules ?? []).map((rule) => <div key={rule.workflow_label_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="min-w-0 [overflow-wrap:anywhere]">{workflowLabels.find((label) => label.id === rule.workflow_label_id)?.name ?? 'Workflowlabel'}</span><span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{workflows.find((workflow) => workflow.id === rule.workflow_id)?.name ?? 'Workflow'} · v{rule.workflow_definition_version}</span></div>)}{(routingQuery.data?.rules ?? []).length === 0 && <p className="text-xs text-muted-foreground">Keine Zuordnungen für dieses Projekt.</p>}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Manuelle Trigger</CardTitle><p className="text-sm text-muted-foreground">Ein Trigger wird erst durch eine berechtigte Aktion gestartet.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(240px,1fr)_auto] md:items-end"><div className="space-y-1.5"><Label htmlFor="trigger-name">Name</Label><Input id="trigger-name" value={triggerName} onChange={(event) => setTriggerName(event.target.value)} maxLength={120} placeholder="Manueller Start" /></div><div className="space-y-1.5"><Label htmlFor="trigger-workflow">Workflow</Label><Select value={triggerWorkflowId} onValueChange={setTriggerWorkflowId}><SelectTrigger id="trigger-workflow"><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{routeWorkflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div><Button disabled={!triggerName.trim() || !triggerWorkflowId || !selectedProjectId || createTrigger.isPending} onClick={() => createTrigger.mutate()}><Plus />{createTrigger.isPending ? 'Wird eingerichtet…' : 'Trigger einrichten'}</Button></div>
            <div className="space-y-2">{projectTriggers.map((trigger) => <div key={trigger.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"><div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{trigger.name}</p><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{workflows.find((workflow) => workflow.id === trigger.workflow_id)?.name ?? 'Workflow'}</p></div><Badge variant={trigger.enabled ? 'secondary' : 'outline'}>{trigger.enabled ? 'Aktiv' : 'Pausiert'}</Badge></div>)}{projectTriggers.length === 0 && <p className="text-sm text-muted-foreground">Keine manuellen Trigger für dieses Projekt.</p>}</div>
          </CardContent>
        </Card>
      </section>}

      {!editorOpen && section === 'runs' && <section id="workflow-panel-runs" aria-label="Workflow-Läufe">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TimerReset className="size-4 text-muted-foreground" />Workflow-Läufe</CardTitle></CardHeader><CardContent className="space-y-2">
          {instances.map((instance) => {
            const workflow = workflows.find((item) => item.id === instance.workflow_id)
            const projectName = projects.find((project) => project.id === instance.project_id)?.name ?? 'Projekt'
            const ticketFlow = `#/project/${instance.project_id}/board?task=${instance.task_id}&tab=flow`
            return (
              <div key={instance.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{workflow?.name ?? 'Workflow'} · v{instance.definition_version}</p><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{projectName}</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{instanceLabels[instance.state] ?? instance.state}</Badge><Button asChild size="sm" variant="outline"><a href={ticketFlow}><GitBranch />Ticketablauf ansehen</a></Button></div>
              </div>
            )
          })}
          {instances.length === 0 && <p className="py-3 text-sm text-muted-foreground">Noch keine Workflow-Läufe vorhanden.</p>}
        </CardContent></Card>
      </section>}
    </main>
  )
}
