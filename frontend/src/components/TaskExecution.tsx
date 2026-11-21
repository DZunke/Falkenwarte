import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Play, RefreshCw, Send, ShieldCheck, Square, Workflow as WorkflowIcon } from 'lucide-react'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Project, type Task } from '@/lib/api'
import { fetchAllPages } from '@/lib/queries'
import { taskAttentionReasonLabel } from '@/lib/task-attention'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Run = components['schemas']['Run']
type RunAttempt = components['schemas']['RunAttempt']
type RunState = components['schemas']['RunState']
type Workflow = components['schemas']['Workflow']
type WorkflowInstance = components['schemas']['WorkflowInstance']
type Approval = components['schemas']['Approval']
type RunResultReport = components['schemas']['RunResultReport']

const activeRunStates = new Set<RunState>(['queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling', 'cancel_requested', 'result_reported', 'verifying'])
const terminalRunStates = new Set<RunState>(['succeeded', 'failed', 'cancelled', 'abandoned'])
const activeWorkflowStates = new Set<WorkflowInstance['state']>(['queued', 'running', 'paused'])

const runStateNames: Record<RunState, string> = {
  queued: 'Warteschlange',
  dispatching: 'Start wird übertragen',
  running: 'Läuft in T3',
  waiting_input: 'Wartet auf eine Antwort',
  auth_blocked: 'T3-Anmeldung fehlt',
  reconciling: 'T3-Status wird abgeglichen',
  cancel_requested: 'Abbruch angefordert',
  result_reported: 'Ergebnis gemeldet',
  verifying: 'Phasenabschluss wird geprüft',
  succeeded: 'Phase abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  abandoned: 'Lokal aufgegeben',
}

const workflowStateNames: Record<WorkflowInstance['state'], string> = {
  queued: 'Wartet auf Start',
  running: 'Läuft',
  paused: 'Pausiert',
  succeeded: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
}

const reportOutcomeNames: Record<RunResultReport['outcome'], string> = {
  reported_success: 'Erfolg gemeldet',
  needs_changes: 'Änderungen nötig',
  blocked: 'Blockiert',
  failed: 'Fehlgeschlagen',
}

function runIsActive(run: Run): boolean {
  return activeRunStates.has(run.state)
}

function runSource(target: Run['snapshot']['execution_target']): string {
  switch (target.mode) {
    case 't3_provider_instance':
      return `T3-Providerinstanz ${target.provider_instance_id} · ${target.model}`
    case 't3_reference_thread':
      return `T3-Referenzthread ${target.reference_thread_id}`
    case 't3_project_default':
      return 'T3-Projektstandard'
  }
}

function attemptReference(label: string, value: string | null) {
  if (!value) return null
  return <p key={label} className="break-all text-xs text-muted-foreground">{label}: {value}</p>
}

type ExecutionProps = {
  task: Task
  project: Project
  boardId?: string
  boardPolicy?: components['schemas']['TaskFlowPage']['board_workflow_policy']
  boardPolicyError?: string
  retryBoardPolicy: () => void
  onChanged: () => Promise<void>
  onOpenDecisions: () => void
}

export default function TaskExecution({ task, project, boardId, boardPolicy, boardPolicyError, retryBoardPolicy, onChanged, onOpenDecisions }: ExecutionProps) {
  const queryClient = useQueryClient()
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedStageId, setSelectedStageId] = useState('task')
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState('')
  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedInstanceId, setSelectedInstanceId] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [message, setMessage] = useState('')
  const [answerValues, setAnswerValues] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [approvalKind, setApprovalKind] = useState<'review' | 'completion'>('review')
  const [approvalRequestReason, setApprovalRequestReason] = useState('')
  const [actionError, setActionError] = useState('')

  const runsQuery = useQuery({
    queryKey: ['task-runs', project.id, task.id],
    queryFn: () => request(api.GET('/runs', { params: { query: { project_id: project.id, task_id: task.id, limit: 100 } } })),
    refetchInterval: (query) => query.state.data?.items.some(runIsActive) ? 3000 : false,
  })
  const profilesQuery = useQuery({
    queryKey: ['execution-profiles', project.id],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/agent-profiles', { params: { query: { project_id: project.id, limit: 100, cursor } } }))),
  })
  const projectBindingQuery = useQuery({
    queryKey: ['project-binding', project.id],
    queryFn: async () => {
      const response = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: project.id } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    },
  })
  const workflowsQuery = useQuery({
    queryKey: ['execution-workflows', project.id],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/workflows', { params: { query: { project_id: project.id, enabled: true, limit: 100, cursor } } }))),
  })
  const routingQuery = useQuery({
    queryKey: ['execution-routing', project.id],
    queryFn: () => request(api.GET('/projects/{project_id}/routing-rules', { params: { path: { project_id: project.id } } })),
  })
  const workflowInstancesQuery = useQuery({
    queryKey: ['task-workflow-instances', project.id, task.id],
    queryFn: () => request(api.GET('/workflow-instances', { params: { query: { project_id: project.id, task_id: task.id, limit: 100 } } })),
    refetchInterval: (query) => query.state.data?.items.some((instance) => activeWorkflowStates.has(instance.state)) ? 3000 : false,
  })

  const profileCandidates = profilesQuery.data?.items ?? []
  const projectProfiles = profileCandidates.filter((profile) => profile.all_projects === true || profile.allowed_project_ids.includes(project.id))
  const projectBinding = projectBindingQuery.data?.active ? projectBindingQuery.data : null
  const profiles = projectBinding
    ? projectProfiles.filter((profile) => profile.connection_id === projectBinding.connection_id)
    : []
  const hasConnectionMismatch = Boolean(projectBinding && projectProfiles.some((profile) => profile.connection_id !== projectBinding.connection_id))
  const workflows = useMemo<Workflow[]>(
    () => workflowsQuery.data?.items.filter((workflow) => workflow.enabled && (workflow.project_id === null || workflow.project_id === project.id)) ?? [],
    [project.id, workflowsQuery.data],
  )
  const projectRoute = task.workflow_label_id
    ? routingQuery.data?.rules.find((rule) => rule.workflow_label_id === task.workflow_label_id)
    : undefined
  const policyCanSelectWorkflow = boardPolicy && (boardPolicy.state === 'available' || (boardPolicy.state === 'unconfigured' && task.workflow_label_id))
  const effectiveTaskRoute = policyCanSelectWorkflow && boardPolicy.workflow_id && boardPolicy.definition_version
    ? { workflow_id: boardPolicy.workflow_id, workflow_definition_version: boardPolicy.definition_version }
    : undefined
  const route = effectiveTaskRoute ?? projectRoute
  const routedWorkflowRequired = Boolean(task.workflow_label_id)
  const routingUnavailable = !effectiveTaskRoute && routedWorkflowRequired && !routingQuery.isSuccess
  const routedWorkflowMissing = routedWorkflowRequired && routingQuery.isSuccess && !route
  const routedWorkflowQuery = useQuery({
    queryKey: ['routed-workflow', route?.workflow_id, route?.workflow_definition_version],
    enabled: Boolean(route),
    queryFn: () => request(api.GET('/workflows/{workflow_id}/versions/{definition_version}', {
      params: { path: { workflow_id: route!.workflow_id, definition_version: route!.workflow_definition_version } },
    })),
  })
  const workflowOptions = useMemo(() => {
    const options = workflows.filter((workflow) => !route || workflow.id !== route.workflow_id)
    const routed = routedWorkflowQuery.data
    if (routed && !options.some((item) => item.id === routed.id && item.definition_version === routed.definition_version)) {
      options.push(routed)
    }
    return options
  }, [route, routedWorkflowQuery.data, workflows])

  useEffect(() => {
    setSelectedWorkflowKey('')
  }, [boardId, project.id, task.id])

  const routedWorkflowKey = route ? `${route.workflow_id}:${route.workflow_definition_version}` : ''
  const selectedWorkflow = workflowOptions.find((workflow) => `${workflow.id}:${workflow.definition_version}` === selectedWorkflowKey)
    ?? workflowOptions.find((workflow) => `${workflow.id}:${workflow.definition_version}` === routedWorkflowKey)
  const displayedWorkflowKey = selectedWorkflow ? `${selectedWorkflow.id}:${selectedWorkflow.definition_version}` : ''
  const unavailableStageNames = selectedWorkflow?.stages.filter((stage) =>
    !profiles.some((profile) => profile.id === stage.agent_profile_id && profile.enabled && profile.configuration_valid)).map((stage) => stage.name) ?? []
  const standaloneWorkflow = task.workflow_label_id || boardPolicy?.state === 'unconfigured' ? selectedWorkflow : undefined
  const selectedStage = standaloneWorkflow?.stages.find((stage) => stage.id === selectedStageId)
  const profilesForStage = selectedStage?.agent_profile_id
    ? profiles.filter((profile) => profile.id === selectedStage.agent_profile_id)
    : profiles
  const selectedProfile = profilesForStage.find((profile) => profile.id === selectedProfileId)

  useEffect(() => {
    if (selectedStage?.agent_profile_id) {
      setSelectedProfileId(selectedStage.agent_profile_id)
      return
    }
    if (selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)) return
    const preferred = profiles.find((profile) => profile.id === task.agent_profile_id && profile.enabled)
      ?? profiles.find((profile) => profile.enabled && profile.configuration_valid)
    if (preferred) setSelectedProfileId(preferred.id)
  }, [profiles, selectedProfileId, selectedStage?.agent_profile_id, task.agent_profile_id])

  useEffect(() => {
    if (!standaloneWorkflow || standaloneWorkflow.stages.length === 0) return
    if (!standaloneWorkflow.stages.some((stage) => stage.id === selectedStageId)) {
      setSelectedStageId(standaloneWorkflow.stages[0].id)
    }
  }, [selectedStageId, standaloneWorkflow])

  const runs = runsQuery.data?.items ?? []
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) setSelectedRunId(runs[0].id)
  }, [runs, selectedRunId])
  const selectedRunSummary = runs.find((run) => run.id === selectedRunId) ?? runs[0]
  const runQuery = useQuery({
    queryKey: ['run', selectedRunSummary?.id],
    enabled: Boolean(selectedRunSummary?.id),
    queryFn: () => request(api.GET('/runs/{run_id}', { params: { path: { run_id: selectedRunSummary!.id } } })),
    refetchInterval: (query) => query.state.data && runIsActive(query.state.data) ? 3000 : false,
  })
  const selectedRun = runQuery.data ?? selectedRunSummary
  const reportQueries = useQueries({
    queries: selectedRun ? selectedRun.report_ids.map((reportId) => ({
      queryKey: ['run-report', selectedRun.id, reportId],
      queryFn: () => request(api.GET('/runs/{run_id}/result-reports/{report_id}', {
        params: { path: { run_id: selectedRun.id, report_id: reportId } },
      })),
    })) : [],
  })
  const reports = reportQueries.flatMap((query) => query.data ? [query.data] : [])
  const approvalsQuery = useQuery({
    queryKey: ['run-approvals', project.id, selectedRun?.id],
    enabled: Boolean(selectedRun?.id),
    queryFn: () => request(api.GET('/approvals', { params: { query: { project_id: project.id, run_id: selectedRun!.id, limit: 100 } } })),
  })
  const approvals = approvalsQuery.data?.items ?? []

  const instances = workflowInstancesQuery.data?.items ?? []
  useEffect(() => {
    if (!selectedInstanceId && instances.length > 0) setSelectedInstanceId(instances[0].id)
  }, [instances, selectedInstanceId])
  const selectedInstanceSummary = instances.find((instance) => instance.id === selectedInstanceId) ?? instances[0]
  const instanceQuery = useQuery({
    queryKey: ['workflow-instance', selectedInstanceSummary?.id],
    enabled: Boolean(selectedInstanceSummary?.id),
    queryFn: () => request(api.GET('/workflow-instances/{instance_id}', { params: { path: { instance_id: selectedInstanceSummary!.id } } })),
    refetchInterval: (query) => query.state.data && activeWorkflowStates.has(query.state.data.state) ? 3000 : false,
  })
  const selectedInstance = instanceQuery.data ?? selectedInstanceSummary

  const constraints = [
    ...(project.archived ? ['Das Projekt ist archiviert; neue Aufträge sind gesperrt.'] : []),
    ...(task.blocked ? [`Die Aufgabe ist blockiert${task.blocker_reason ? `: ${task.blocker_reason}` : '.'}`] : []),
    ...(task.human_attention.required ? [`Eine menschliche Entscheidung ist offen: ${task.human_attention.reasons.map(taskAttentionReasonLabel).join('; ')}.`] : []),
    ...(task.classification_required && task.intake_outcome !== 'ready' ? ['Die Eingangsklassifikation ist für diese Ticketrevision noch nicht bereit.'] : []),
    ...(!['ready', 'active', 'review'].includes(task.status_category) ? ['Verschiebe das Ticket zuerst in einen bearbeitbaren Status.'] : []),
  ]
  const stageProfileMismatch = Boolean(selectedStage?.agent_profile_id && selectedProfileId !== selectedStage.agent_profile_id)
  const startBlocked = constraints.length > 0
  const canRequestRun = !startBlocked && Boolean(selectedProfile?.enabled && selectedProfile.configuration_valid) && !stageProfileMismatch && Boolean(selectedStageId.trim())
  const selectedWorkflowUsesRoute = Boolean(
    route
      && selectedWorkflow?.id === route.workflow_id
      && selectedWorkflow.definition_version === route.workflow_definition_version,
  )
  const workflowSelectionHint = selectedWorkflowUsesRoute
    ? task.workflow_label_id
      ? `Die gespeicherte Ticketroute mit Version ${route?.workflow_definition_version} ist vorausgewählt.`
      : 'Der Standard-Workflow dieses Boards ist vorausgewählt.'
    : selectedWorkflow
      ? 'Die ausgewählte Vorlage wird nur mit „Workflow starten“ ausgeführt.'
      : 'Wähle eine Vorlage für einen ausdrücklichen Workflowstart.'
  const workflowCanStart = !startBlocked
    && Boolean(boardPolicy && ['unconfigured', 'available'].includes(boardPolicy.state) && !boardPolicyError)
    && !routingUnavailable
    && !routedWorkflowMissing
    && unavailableStageNames.length === 0
    && (!selectedWorkflowUsesRoute || (selectedWorkflow?.definition_version === route?.workflow_definition_version && routedWorkflowQuery.isSuccess))
    && Boolean(selectedWorkflow?.enabled && selectedWorkflow.stages.length > 0)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task-runs', project.id, task.id] }),
      queryClient.invalidateQueries({ queryKey: ['run'] }),
      queryClient.invalidateQueries({ queryKey: ['run-report'] }),
      queryClient.invalidateQueries({ queryKey: ['run-approvals', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-approvals', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-workflow-instances', project.id, task.id] }),
      queryClient.invalidateQueries({ queryKey: ['workflow-instance'] }),
    ])
    await onChanged()
  }
  const fail = async (error: unknown) => {
    setActionError(formatError(error))
    await refresh()
  }

  const startRun = useMutation({
    mutationFn: async () => {
      if (!selectedProfile || !canRequestRun) throw new Error('Wähle ein startbereites Rollenprofil und löse die angezeigten Einschränkungen auf.')
      return request(api.POST('/tasks/{task_id}/runs', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: { agent_profile_id: selectedProfile.id, stage: selectedStageId.trim(), task_revision: task.version },
      }))
    },
    onSuccess: async (accepted) => {
      setActionError('')
      if (accepted.run_id) setSelectedRunId(accepted.run_id)
      await refresh()
    },
    onError: fail,
  })
  const startWorkflow = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflow || !workflowCanStart) throw new Error('Wähle einen aktiven Workflow, der für dieses Projekt freigegeben ist.')
      return request(api.POST('/tasks/{task_id}/workflow-instances', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: { workflow_id: selectedWorkflow.id, definition_version: selectedWorkflow.definition_version, task_revision: task.version, board_id: boardId },
      }))
    },
    onSuccess: async (accepted) => {
      setActionError('')
      if (accepted.resource?.resource_type === 'workflow_instance') setSelectedInstanceId(accepted.resource.id)
      await refresh()
    },
    onError: fail,
  })

  const cancelRun = useMutation({
    mutationFn: async () => {
      if (!selectedRun || !actionReason.trim()) throw new Error('Gib einen Grund für den Abbruch an.')
      return request(api.POST('/runs/{run_id}/cancel', {
        params: { path: { run_id: selectedRun.id }, ...mutationParams(selectedRun.version) },
        body: { reason: actionReason.trim(), scope: 'run' },
      }))
    },
    onSuccess: async () => { setActionError(''); await refresh() },
    onError: fail,
  })
  const reconcileRun = useMutation({
    mutationFn: async () => {
      if (!selectedRun) throw new Error('Wähle zuerst einen Lauf aus.')
      return request(api.POST('/runs/{run_id}/reconcile', {
        params: { path: { run_id: selectedRun.id }, ...mutationParams(selectedRun.version) },
        body: actionReason.trim() ? { reason: actionReason.trim() } : {},
      }))
    },
    onSuccess: async () => { setActionError(''); await refresh() },
    onError: fail,
  })
  const abandonRun = useMutation({
    mutationFn: async () => {
      if (!selectedRun || !actionReason.trim()) throw new Error('Gib einen Grund für das lokale Aufgeben an.')
      return request(api.POST('/runs/{run_id}/abandon', {
        params: { path: { run_id: selectedRun.id }, ...mutationParams(selectedRun.version) },
        body: { reason: actionReason.trim() },
      }))
    },
    onSuccess: async () => { setActionError(''); await refresh() },
    onError: fail,
  })
  const submitInput = useMutation({
    mutationFn: async () => {
      if (!selectedRun) throw new Error('Wähle zuerst einen Lauf aus.')
      const pending = selectedRun.pending_input
      let body: components['schemas']['RunInput']
      if (pending?.kind === 'question' && pending.answerable_via_api) {
        body = {
          type: 'answer_question',
          request_id: pending.id,
          answers: pending.questions.map((question) => ({
            question_id: question.id,
            values: [...(answerValues[question.id] ?? []), ...(customAnswers[question.id]?.trim() ? [customAnswers[question.id].trim()] : [])],
          })),
        }
        if (pending.questions.some((question) => !(answerValues[question.id]?.length || customAnswers[question.id]?.trim()))) {
          throw new Error('Beantworte jede offene Frage, bevor du sie sendest.')
        }
      } else {
        if (!message.trim()) throw new Error('Gib eine Nachricht ein, bevor du sie sendest.')
        body = { type: 'message', message: message.trim() }
      }
      return request(api.POST('/runs/{run_id}/input', {
        params: { path: { run_id: selectedRun.id }, ...mutationParams(selectedRun.version) },
        body,
      }))
    },
    onSuccess: async () => { setActionError(''); setMessage(''); setAnswerValues({}); setCustomAnswers({}); await refresh() },
    onError: fail,
  })
  const controlWorkflow = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'cancel' | 'authorize_repair') => {
      if (!selectedInstance) throw new Error('Wähle zuerst einen Workflow aus.')
      if (!actionReason.trim()) throw new Error('Gib eine Begründung für die Workflowsteuerung an.')
      if ('authorize_repair' === action && !selectedInstance.repair_decision_run_id) throw new Error('Für diesen Workflow liegt keine offene Überarbeitungsentscheidung vor.')
      return request(api.POST('/workflow-instances/{instance_id}/control', {
        params: { path: { instance_id: selectedInstance.id }, ...mutationParams(selectedInstance.version) },
        body: { action, reason: actionReason.trim() },
      }))
    },
    onSuccess: async (_accepted, action) => { setActionError(''); if ('authorize_repair' === action) setActionReason(''); await refresh() },
    onError: fail,
  })
  const requestApproval = useMutation({
    mutationFn: async () => {
      if (!selectedRun?.result_digest || !canRequestApproval) throw new Error('Für die aktuelle Aufgabenrevision liegt kein passender Ergebnisbericht vor.')
      return request(api.POST('/runs/{run_id}/approvals', {
        params: { path: { run_id: selectedRun.id }, ...mutationParams(selectedRun.version) },
        body: { kind: approvalKind, result_digest: selectedRun.result_digest, ...(approvalRequestReason.trim() ? { reason: approvalRequestReason.trim() } : {}) },
      }))
    },
    onSuccess: async () => { setActionError(''); setApprovalRequestReason(''); await refresh() },
    onError: fail,
  })
  const pendingInput = selectedRun?.pending_input
  const isQuestionAnswer = pendingInput?.kind === 'question' && pendingInput.answerable_via_api
  const canSendInput = Boolean(
    selectedRun
      && ['waiting_input', 'running'].includes(selectedRun.state)
      && pendingInput?.kind !== 'permission'
      && pendingInput?.kind !== 'workflow_decision'
      && !(pendingInput?.kind === 'question' && !pendingInput.answerable_via_api),
  )
  const reportsForCurrentAttempt = reports.filter((report) => selectedRun && report.attempt_no === selectedRun.attempt_no)
  const currentReport = reportsForCurrentAttempt.find((report) => report.accepted_for_reconciliation && report.task_revision === task.version)
  const approvalAlreadyOpen = approvals.some((approval) => approval.status === 'pending' && approval.kind === approvalKind && approval.result_digest === selectedRun?.result_digest)
  const canRequestApproval = Boolean(selectedRun?.result_digest && currentReport && ['result_reported', 'verifying', 'succeeded'].includes(selectedRun.state) && !approvalAlreadyOpen)
  const hasPendingApproval = task.human_attention.reasons.includes('approval_pending') || approvals.some((approval) => approval.status === 'pending')

  const profileStatus = (profile: components['schemas']['AgentProfile']) => !profile.enabled ? 'Deaktiviert' : !profile.configuration_valid ? 'Nicht startbereit' : 'Startbereit'
  const workflowFirst = Boolean(task.workflow_label_id || (boardPolicy && boardPolicy.state !== 'unconfigured'))

  const standaloneRunSection = (
    <section data-testid="execution-single-run-section" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2"><Play className="size-4 text-primary" /><h3 className="text-sm font-semibold">Einzellauf anfordern</h3></div>
      {profilesQuery.isPending || projectBindingQuery.isPending ? <p role="status" className="text-sm text-muted-foreground">Projektbindung und Rollenprofile werden geladen…</p>
        : projectBindingQuery.isError ? <p role="alert" className="text-sm text-destructive">Die aktive T3-Projektbindung konnte nicht geprüft werden.</p>
          : !projectBinding ? <p className="text-sm text-muted-foreground">Binde dieses Projekt unter <a className="underline underline-offset-4" href="#/agents">Agents &amp; T3</a> an eine T3-Verbindung, bevor du einen Auftrag startest.</p>
            : profiles.length === 0 && hasConnectionMismatch ? <p className="text-sm text-muted-foreground">Rollenprofile für andere T3-Verbindungen sind ausgeblendet. Starten ist nur mit derselben aktiven T3-Verbindung wie die Projektbindung möglich.</p>
              : profiles.length === 0 ? <p className="text-sm text-muted-foreground">Für dieses Projekt ist kein Rollenprofil freigegeben.</p> : <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="execution-profile">Rollenprofil</Label><Select value={selectedProfileId} onValueChange={setSelectedProfileId} disabled={Boolean(selectedStage?.agent_profile_id)}><SelectTrigger id="execution-profile"><SelectValue placeholder="Rolle auswählen" /></SelectTrigger><SelectContent>{profilesForStage.map((profile) => <SelectItem key={profile.id} value={profile.id} disabled={!profile.enabled || !profile.configuration_valid}>{profile.name} · {profileStatus(profile)}</SelectItem>)}</SelectContent></Select>{selectedProfile?.configuration_error && <p className="text-xs text-amber-900">{selectedProfile.configuration_error}</p>}{selectedStage?.agent_profile_id && <p className="text-xs text-muted-foreground">Diese Workflowphase ist an das angezeigte Rollenprofil gebunden.</p>}</div>
        <div className="grid gap-2"><Label htmlFor="execution-stage">Phase</Label>{standaloneWorkflow?.stages.length ? <Select value={selectedStageId} onValueChange={setSelectedStageId}><SelectTrigger id="execution-stage"><SelectValue placeholder="Phase auswählen" /></SelectTrigger><SelectContent>{standaloneWorkflow.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name} · {stage.id}</SelectItem>)}</SelectContent></Select> : <Input id="execution-stage" value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)} maxLength={100} />}{selectedStage?.agent_profile_id && !profilesForStage.some((profile) => profile.id === selectedStage.agent_profile_id && profile.configuration_valid && profile.enabled) && <p className="text-xs text-amber-900">Das festgelegte Rollenprofil dieser Phase ist nicht startbereit.</p>}</div>
      </div>}
      <div className="flex justify-end"><Button onClick={() => startRun.mutate()} disabled={!canRequestRun || startRun.isPending || profilesQuery.isPending || projectBindingQuery.isPending}><Play />{startRun.isPending ? 'Wird angefordert…' : 'Einzellauf anfordern'}</Button></div>
    </section>
  )

  const workflowStartSection = (
    <section data-testid="execution-workflow-section" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2"><WorkflowIcon className="size-4 text-primary" /><h3 className="text-sm font-semibold">Workflow starten</h3></div>
      {boardPolicyError
        ? <p role="alert" className="text-sm text-destructive">Die Workflow-Einstellungen des Boards konnten nicht geladen werden. {boardPolicyError} <Button variant="link" size="sm" onClick={retryBoardPolicy}>Erneut laden</Button></p>
        : !boardPolicy
          ? <p role="status" className="text-sm text-muted-foreground">Workflow-Einstellungen des Boards werden geladen…</p>
          : boardPolicy.state !== 'unconfigured' && <p role="status" className="text-sm text-muted-foreground">{boardPolicy.state === 'available' ? workflowSelectionHint : boardPolicy.reason ?? 'Für dieses Ticket ist der Workflowstart gesperrt.'}</p>}
      {task.workflow_label_id && route && <p className="text-xs text-muted-foreground">{selectedWorkflowUsesRoute
        ? `Die gespeicherte Labelroute mit Version ${route.workflow_definition_version} ist vorausgewählt. Du kannst stattdessen eine andere aktive Vorlage wählen.`
        : `Die gespeicherte Labelroute mit Version ${route.workflow_definition_version} bleibt verfügbar; aktuell ist eine andere Vorlage ausgewählt.`}</p>}
      {workflowsQuery.isPending ? <p className="text-sm text-muted-foreground">Workflows werden geladen…</p> : workflowOptions.length === 0 ? <p className="text-sm text-muted-foreground">Für dieses Projekt ist kein aktiver Workflow verfügbar.</p> : <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid min-w-0 gap-2"><Label htmlFor="execution-workflow">Workflow</Label><Select value={displayedWorkflowKey} onValueChange={setSelectedWorkflowKey} disabled={!boardPolicy || Boolean(boardPolicyError) || !['available', 'unconfigured'].includes(boardPolicy.state)}><SelectTrigger id="execution-workflow"><SelectValue placeholder="Workflow auswählen" /></SelectTrigger><SelectContent>{workflowOptions.map((workflow) => <SelectItem key={`${workflow.id}:${workflow.definition_version}`} value={`${workflow.id}:${workflow.definition_version}`}>{workflow.name} · Version {workflow.definition_version}</SelectItem>)}</SelectContent></Select>
          {selectedWorkflow ? <details data-testid="execution-workflow-phase-preview" className="rounded-md border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Phasen und Rollen · Version {selectedWorkflow.definition_version}</summary>
            {selectedWorkflow.stages.length > 0 ? <ol aria-label={`Phasen und Rollen der Version ${selectedWorkflow.definition_version}`} className="mt-2 space-y-1.5">
              {selectedWorkflow.stages.map((stage) => {
                const profile = profiles.find((candidate) => candidate.id === stage.agent_profile_id)
                const profileDescription = !stage.agent_profile_id
                  ? 'Keine Rolle zugewiesen'
                  : profilesQuery.isError || projectBindingQuery.isError
                    ? 'Rollenprofil konnte nicht geprüft werden'
                    : profilesQuery.isPending || projectBindingQuery.isPending
                      ? 'Rollenprofil wird geladen…'
                      : profile
                        ? `${profile.name}${profile.enabled && profile.configuration_valid ? '' : ` · ${profileStatus(profile)}`}`
                        : 'Rolle nicht verfügbar'
                return <li key={stage.id} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm"><span className="font-medium">{stage.name}</span><span className="text-muted-foreground">{profileDescription}</span></li>
              })}
            </ol> : <p className="mt-2 text-sm text-muted-foreground">Diese Workflowversion enthält keine Phasen.</p>}
          </details> : <p className="text-xs text-muted-foreground">Wähle einen Workflow, um seine Phasen und Rollen zu sehen.</p>}</div>
        <Button onClick={() => startWorkflow.mutate()} disabled={!workflowCanStart || startWorkflow.isPending}><WorkflowIcon />{startWorkflow.isPending ? 'Wird gestartet…' : 'Workflow starten'}</Button>
      </div>}
      {unavailableStageNames.length > 0 && profilesQuery.isSuccess && projectBindingQuery.isSuccess && <p role="alert" className="text-sm text-amber-900">Für folgende Phasen fehlt eine startbereite Rolle: {unavailableStageNames.join(', ')}. Öffne die Vorlage unter <a className="underline" href="#/workflows">Workflows</a> und weise jeder Phase eine Rolle für dieses Projekt und seine T3-Verbindung zu.</p>}
      {!effectiveTaskRoute && routedWorkflowRequired && routingQuery.isPending && <p className="text-xs text-muted-foreground">Die gespeicherte Route wird geladen. Du kannst anschließend eine andere aktive Vorlage wählen.</p>}
      {!effectiveTaskRoute && routedWorkflowRequired && routingQuery.isError && <p role="alert" className="text-xs text-destructive">Die versionierte Aufgabenroute konnte nicht geladen werden: {formatError(routingQuery.error)}</p>}
      {routedWorkflowMissing && <p role="alert" className="text-xs text-destructive">Für das Workflowlabel dieser Aufgabe wurde keine versionierte Route gefunden. Der Workflowstart ist gesperrt.</p>}
      {route && routedWorkflowQuery.isPending && <p className="text-xs text-muted-foreground">Die vorausgewählte Workflowversion wird geladen. Eine andere aktive Vorlage kannst du schon wählen.</p>}
      {route && !routedWorkflowQuery.data && routedWorkflowQuery.isError && <p role="alert" className="text-xs text-destructive">Die vorausgewählte Workflowversion konnte nicht geladen werden: {formatError(routedWorkflowQuery.error)} Eine andere aktive Vorlage kann trotzdem gewählt werden.</p>}
    </section>
  )

  return (
    <div className="space-y-5 pb-6">
      {actionError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{actionError}</div>}
      {(runsQuery.isError || profilesQuery.isError || projectBindingQuery.isError || workflowsQuery.isError || routingQuery.isError || workflowInstancesQuery.isError) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formatError(runsQuery.error ?? profilesQuery.error ?? projectBindingQuery.error ?? workflowsQuery.error ?? routingQuery.error ?? workflowInstancesQuery.error)}</div>}

      <section className="space-y-3 rounded-lg border p-4">
        <div><h3 className="text-sm font-semibold">Startbedingungen</h3></div>
        {constraints.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">{constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul> : <p className="text-sm text-muted-foreground">Für Ticket und Projekt sind keine bekannten Startblockaden offen.</p>}
        {hasPendingApproval && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 p-3"><p className="text-sm text-amber-950">Eine Ergebnismeldung wartet auf deine fachliche Entscheidung.</p><Button size="sm" variant="outline" onClick={onOpenDecisions}><ShieldCheck />Entscheidung öffnen</Button></div>}
        <p className="text-xs text-muted-foreground">Ein Phasenlauf schließt das Ticket nicht automatisch ab. Berichte bleiben Agentenmeldungen; Ticketkriterien und Projektabschlussregeln gelten unabhängig davon.</p>
      </section>

      {workflowFirst ? <>{workflowStartSection}{standaloneRunSection}</> : <>{standaloneRunSection}{workflowStartSection}</>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Ausführungen</h3><p className="mt-1 text-xs text-muted-foreground">Jeder Versuch behält seine T3-Referenzen und Beobachtungen.</p></div><Button size="sm" variant="outline" onClick={() => { void refresh() }}><RefreshCw />Aktualisieren</Button></div>
        {runsQuery.isPending ? <p className="text-sm text-muted-foreground">Ausführungen werden geladen…</p> : runs.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Für dieses Ticket wurden noch keine T3-Ausführungen angefordert.</div> : <div className="grid gap-2">{runs.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${run.id === selectedRun?.id ? 'border-primary bg-accent/50' : ''}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{run.snapshot.stage_name || run.stage} · Versuch {run.attempt_no}</span><span className="mt-1 block text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString('de-DE')}</span></span><Badge variant={run.state === 'failed' ? 'destructive' : run.state === 'succeeded' ? 'secondary' : 'outline'}>{runStateNames[run.state]}</Badge></button>)}</div>}
      </section>

      {selectedRun && <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{selectedRun.snapshot.stage_name || selectedRun.stage} · Versuch {selectedRun.attempt_no}</h3><p className="mt-1 text-xs text-muted-foreground">Aufgabenrevision {selectedRun.snapshot.task_revision} · Rollenprofilversion {selectedRun.snapshot.agent_profile_version} · {runSource(selectedRun.snapshot.execution_target)}</p></div><Badge variant={selectedRun.state === 'failed' ? 'destructive' : selectedRun.state === 'succeeded' ? 'secondary' : 'outline'}>{runStateNames[selectedRun.state]}</Badge></div>
        {selectedRun.snapshot.handoff_snapshot && selectedRun.snapshot.handoff_source_run_id && (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Übergabe aus der vorigen Phase</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">Agentenmeldung · Ticketrevision {selectedRun.snapshot.handoff_snapshot.task_revision_id} · Versuch {selectedRun.snapshot.handoff_snapshot.source_attempt_no}</p>
              <p className="whitespace-pre-wrap break-words">{selectedRun.snapshot.handoff_snapshot.summary}</p>
              {selectedRun.snapshot.handoff_snapshot.open_questions.length > 0 && (
                <div><h4 className="font-medium">Offene Fragen</h4><ul className="list-disc space-y-1 pl-5">{selectedRun.snapshot.handoff_snapshot.open_questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>
              )}
              {selectedRun.snapshot.handoff_snapshot.link_collections.filter((collection) => collection.links.length > 0).map((collection) => (
                <div key={collection.id}><h4 className="font-medium">{collection.name}</h4><ul className="list-disc space-y-1 pl-5">
                  {collection.links.map((link) => <li key={link.id}><a className="break-words text-primary underline" href={link.url} target="_blank" rel="noreferrer">{link.title}</a></li>)}
                </ul></div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setSelectedRunId(selectedRun.snapshot.handoff_source_run_id!)}>Ausgangslauf und Nachweise ansehen</Button>
            </div>
          </details>
        )}
        {selectedRun.status_reason && <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{selectedRun.status_reason}</div>}
        {runQuery.isError && <p role="alert" className="text-sm text-destructive">{formatError(runQuery.error)}</p>}
        <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2"><p>Rollenprofil: {profiles.find((profile) => profile.id === selectedRun.snapshot.agent_profile_id)?.name ?? selectedRun.snapshot.agent_profile_id}</p><p>Projektbindung: {selectedRun.snapshot.project_binding_id}</p><p>Workflowversion: {selectedRun.snapshot.workflow_version ?? 'Kein versionierter Workflow'}</p><p>Routingversion: {selectedRun.snapshot.routing_rules_version ?? 'Keine Workflowroute'}</p><p>Startrevision: {selectedRun.snapshot.task_revision}</p><p>Letzte Beobachtung: {selectedRun.last_observed_at ? new Date(selectedRun.last_observed_at).toLocaleString('de-DE') : 'Noch keine T3-Beobachtung'}</p>{selectedRun.snapshot.execution_target.mode === 't3_reference_thread' && <p>Referenzthread: {selectedRun.snapshot.execution_target.reference_thread_id}</p>}</div>

        <div className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versuchsverlauf</h4>{selectedRun.attempts.map((attempt) => <AttemptCard key={`${selectedRun.id}:${attempt.attempt_no}`} attempt={attempt} current={attempt.attempt_no === selectedRun.attempt_no} />)}</div>

        <div className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ergebnisberichte</h4>{reportQueries.some((query) => query.isPending) && <p className="text-xs text-muted-foreground">Berichte werden geladen…</p>}{reportsForCurrentAttempt.length === 0 ? <p className="text-xs text-muted-foreground">Für diesen Versuch liegt noch kein gespeicherter Ergebnisbericht vor.</p> : reportsForCurrentAttempt.map((report) => <div key={report.id} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{reportOutcomeNames[report.outcome]}</span><Badge variant={report.accepted_for_reconciliation ? 'secondary' : 'outline'}>{report.accepted_for_reconciliation ? 'Für Abgleich angenommen' : 'Noch nicht angenommen'}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm">{report.summary}</p><p className="mt-1 text-xs text-muted-foreground">Versuch {report.attempt_no} · Aufgabenrevision {report.task_revision} · {new Date(report.received_at).toLocaleString('de-DE')}</p>{report.rejection_reason && <p className="mt-2 text-xs text-destructive">{report.rejection_reason}</p>}</div>)}</div>

        <div className="space-y-3 rounded-md border p-3"><div><h4 className="text-sm font-semibold">Ergebnisentscheidung</h4><p className="mt-1 text-xs text-muted-foreground">Eine Freigabe bezieht sich auf Versuch, Ticketrevision und Ergebnisdigest. Sie bestätigt eine Phasenmeldung, nicht den Abschluss des Tickets.</p></div>{selectedRun.result_digest ? <p className="break-all font-mono text-[11px] text-muted-foreground">Ergebnisdigest: {selectedRun.result_digest}</p> : <p className="text-xs text-muted-foreground">Noch kein aktueller Ergebnisdigest.</p>}
          {approvalsQuery.isError && <p role="alert" className="text-xs text-destructive">{formatError(approvalsQuery.error)}</p>}
          {approvals.length > 0 && <div className="space-y-2">{approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} currentRun={selectedRun} task={task} />)}</div>}
          {approvals.some((approval) => approval.status === 'pending' && approval.attempt_no === selectedRun.attempt_no && approval.task_revision === task.version && approval.result_digest === selectedRun.result_digest) && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">Eine Freigabe dieses Versuchs wartet auf deine fachliche Entscheidung im Tab „Entscheidungen“.</p>}
          {selectedRun.result_digest && <div className="grid gap-2 border-t pt-3 sm:grid-cols-[140px_1fr_auto] sm:items-end"><div className="grid gap-2"><Label htmlFor="approval-kind">Entscheidungstyp</Label><Select value={approvalKind} onValueChange={(value) => setApprovalKind(value as typeof approvalKind)}><SelectTrigger id="approval-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review">Phasenreview</SelectItem><SelectItem value="completion">Phasenabschluss</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="approval-request-reason">Hinweis (optional)</Label><Input id="approval-request-reason" value={approvalRequestReason} onChange={(event) => setApprovalRequestReason(event.target.value)} maxLength={2000} /></div><Button variant="outline" onClick={() => requestApproval.mutate()} disabled={!canRequestApproval || requestApproval.isPending || approvalsQuery.isPending}>{requestApproval.isPending ? 'Wird angefordert…' : 'Freigabe anfordern'}</Button></div>}
          {selectedRun.result_digest && !currentReport && <p className="text-xs text-amber-900">Der aktuelle Versuch enthält keinen zur aktuellen Ticketrevision passenden angenommenen Bericht; eine Freigabe ist deshalb gesperrt.</p>}
        </div>

        {pendingInput && <div className="space-y-3 rounded-md border p-3"><h4 className="text-sm font-semibold">Eingabe an den laufenden Auftrag</h4><p className="text-sm">{pendingInput.summary}</p><p className="text-xs text-muted-foreground">Adressat: {pendingInput.addressed_to === 'owner' ? 'Eigentümer' : 'meldender Agent'} · {pendingInput.answerable_via_api ? 'Antwort über Falkenwarte möglich' : 'Antwort in T3 erforderlich'}</p>{pendingInput.external_url && <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={pendingInput.external_url} target="_blank" rel="noreferrer">In T3 öffnen <ExternalLink className="size-3" /></a>}
          {pendingInput.kind === 'permission' && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">Berechtigungen werden in T3 erteilt. Eine Nachricht in Falkenwarte kann diese Freigabe nicht ersetzen.</p>}
          {pendingInput.kind === 'workflow_decision' && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">Diese Workflowentscheidung wird nicht als allgemeine Agentenantwort behandelt.</p>}
          {canSendInput && isQuestionAnswer && pendingInput.questions.map((question) => <div key={question.id} className="grid gap-2 rounded-md bg-muted/30 p-3"><p className="text-sm font-medium">{question.question}</p>{question.options.length > 0 && (question.multi_select ? <div className="grid gap-2">{question.options.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm"><Checkbox checked={(answerValues[question.id] ?? []).includes(option.value)} onCheckedChange={(checked) => setAnswerValues((current) => ({ ...current, [question.id]: checked === true ? [...new Set([...(current[question.id] ?? []), option.value])] : (current[question.id] ?? []).filter((value) => value !== option.value) }))} /><span>{option.label}</span></label>)}</div> : <Select value={(answerValues[question.id] ?? [])[0] ?? ''} onValueChange={(value) => setAnswerValues((current) => ({ ...current, [question.id]: [value] }))}><SelectTrigger aria-label={question.question}><SelectValue placeholder="Antwort auswählen" /></SelectTrigger><SelectContent>{question.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>)}{question.allow_custom && <Input aria-label={`Eigene Antwort: ${question.question}`} value={customAnswers[question.id] ?? ''} onChange={(event) => setCustomAnswers((current) => ({ ...current, [question.id]: event.target.value }))} maxLength={4000} placeholder="Eigene Antwort" />}</div>)}
          {canSendInput && !isQuestionAnswer && <div className="grid gap-2"><Label htmlFor="run-message">Nachricht</Label><Textarea id="run-message" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={30000} placeholder="Zusätzlichen Kontext an den laufenden Auftrag senden" /></div>}
          {canSendInput && <div className="flex justify-end"><Button size="sm" onClick={() => submitInput.mutate()} disabled={submitInput.isPending || (!isQuestionAnswer && !message.trim()) || (isQuestionAnswer && pendingInput.questions.some((question) => !(answerValues[question.id]?.length || customAnswers[question.id]?.trim())))}><Send />{submitInput.isPending ? 'Wird gesendet…' : isQuestionAnswer ? 'Antwort senden' : 'Nachricht senden'}</Button></div>}
        </div>}

        <div className="space-y-3 border-t pt-3"><h4 className="text-sm font-semibold">Auftrag steuern</h4><div className="grid gap-2"><Label htmlFor="execution-action-reason">Begründung für Abbruch oder Klärung</Label><Textarea id="execution-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} rows={2} maxLength={2000} placeholder="Warum ist diese Aktion erforderlich?" /></div><div className="flex flex-wrap justify-end gap-2">{runIsActive(selectedRun) && <Button size="sm" variant="outline" onClick={() => cancelRun.mutate()} disabled={!actionReason.trim() || cancelRun.isPending}><Square />Abbruch anfordern</Button>}{!terminalRunStates.has(selectedRun.state) && ['auth_blocked', 'reconciling', 'cancel_requested', 'dispatching'].includes(selectedRun.state) && <Button size="sm" variant="outline" onClick={() => reconcileRun.mutate()} disabled={reconcileRun.isPending}><RefreshCw />T3-Status abgleichen</Button>}{['auth_blocked', 'reconciling', 'cancel_requested', 'dispatching'].includes(selectedRun.state) && <Button size="sm" variant="destructive" onClick={() => abandonRun.mutate()} disabled={!actionReason.trim() || abandonRun.isPending}>Lokal aufgeben</Button>}</div><p className="text-xs text-muted-foreground">„Lokal aufgeben“ beendet keine möglicherweise noch laufende externe T3-Arbeit.</p></div>
      </section>}

      <section className="space-y-3 rounded-lg border p-4">
        <div><h3 className="text-sm font-semibold">Workflowverlauf</h3><p className="mt-1 text-xs text-muted-foreground">Workflowphasen besitzen eigene Runs und Abschlussregeln. Ein Workflowstatus ersetzt nicht den Ticketabschluss.</p></div>
        {workflowInstancesQuery.isPending ? <p className="text-sm text-muted-foreground">Workflowverläufe werden geladen…</p> : instances.length === 0 ? <p className="text-sm text-muted-foreground">Für dieses Ticket wurde noch kein Workflow gestartet.</p> : <div className="space-y-2">{instances.map((instance) => {
          const workflow = workflowOptions.find((candidate) => candidate.id === instance.workflow_id && candidate.definition_version === instance.definition_version)
          const phaseRun = runs.find((run) => run.stage === instance.current_stage_id && instance.run_ids.includes(run.id))
          const phaseName = phaseRun?.snapshot.stage_name || workflow?.stages.find((stage) => stage.id === instance.current_stage_id)?.name || instance.current_stage_id
          return <button key={instance.id} type="button" onClick={() => setSelectedInstanceId(instance.id)} className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 ${instance.id === selectedInstance?.id ? 'border-primary bg-accent/50' : ''}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{workflow?.name ?? 'Workflow'} · Version {instance.definition_version}</span><span className="mt-1 block text-xs text-muted-foreground">{phaseName ? `Phase ${phaseName}` : 'Keine aktive Phase'} · Überarbeitungsrunde {instance.repair_round}</span></span><Badge variant={instance.state === 'failed' ? 'destructive' : instance.state === 'succeeded' ? 'secondary' : 'outline'}>{workflowStateNames[instance.state]}</Badge></button>
        })}</div>}
        {selectedInstance && <div className="space-y-3 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Aktuelle Phase: {selectedInstance.current_stage_id ?? 'keine'}</p><Badge variant="outline">{workflowStateNames[selectedInstance.state]}</Badge></div>{selectedInstance.pause_reason && <p role="status" className="rounded-md bg-amber-50 p-2 text-sm text-amber-950">{selectedInstance.pause_reason}</p>}<p className="text-xs text-muted-foreground">{selectedInstance.run_ids.length} Phasenlauf/-läufe · Version {selectedInstance.definition_version}</p><div className="grid gap-2"><Label htmlFor="workflow-action-reason">{selectedInstance.repair_decision_run_id ? 'Hinweis für die nächste Überarbeitung' : 'Begründung für die Workflowsteuerung'}</Label><Input id="workflow-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} maxLength={2000} placeholder={selectedInstance.repair_decision_run_id ? 'Was soll der Agent in der zusätzlichen Runde beachten?' : undefined} />{selectedInstance.repair_decision_run_id && <p className="text-xs text-muted-foreground">Dein Hinweis wird im Übergabeprotokoll der zusätzlichen Runde festgehalten.</p>}</div>{selectedInstance.repair_decision_run_id && selectedInstance.repair_decision_stage_name && <p className="text-xs text-muted-foreground">Die zusätzliche Runde wird in der Phase {selectedInstance.repair_decision_stage_name} ausgeführt.</p>}<div className="flex flex-wrap justify-end gap-2">{selectedInstance.state === 'running' && <Button size="sm" variant="outline" onClick={() => controlWorkflow.mutate('pause')} disabled={!actionReason.trim() || controlWorkflow.isPending}>Pausieren</Button>}{selectedInstance.state === 'paused' && selectedInstance.repair_decision_run_id && <Button size="sm" variant="outline" onClick={() => controlWorkflow.mutate('authorize_repair')} disabled={!actionReason.trim() || controlWorkflow.isPending}>Eine Überarbeitung freigeben</Button>}{selectedInstance.state === 'paused' && !selectedInstance.repair_decision_run_id && <Button size="sm" variant="outline" onClick={() => controlWorkflow.mutate('resume')} disabled={!actionReason.trim() || controlWorkflow.isPending}>Fortsetzen</Button>}{activeWorkflowStates.has(selectedInstance.state) && <Button size="sm" variant="destructive" onClick={() => controlWorkflow.mutate('cancel')} disabled={!actionReason.trim() || controlWorkflow.isPending}>Workflow abbrechen</Button>}</div><p className="text-xs text-muted-foreground">Ein Workflowabbruch fordert auch den Abbruch aktiver Phasenläufe an. Ob T3 sie beendet hat, bleibt im jeweiligen Laufstatus sichtbar.</p></div>}
      </section>
    </div>
  )
}

function AttemptCard({ attempt, current }: { attempt: RunAttempt; current: boolean }) {
  return <div className={`space-y-1 rounded-md border p-3 ${current ? 'border-primary/60' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Versuch {attempt.attempt_no}{current ? ' · aktuell' : ''}</span><Badge variant="outline">{attempt.remote_status ?? (attempt.ended_at ? 'Beendet' : attempt.started_at ? 'Gestartet' : 'Noch nicht angenommen')}</Badge></div><div className="grid gap-1 text-xs sm:grid-cols-2"><p>Gestartet: {attempt.started_at ? new Date(attempt.started_at).toLocaleString('de-DE') : 'Noch nicht bestätigt'}</p><p>Letzte Beobachtung: {attempt.last_observed_at ? new Date(attempt.last_observed_at).toLocaleString('de-DE') : 'Keine'}</p><p>Verbindung: {attempt.connection_id}</p><p>Autorisierungsgeneration: {attempt.auth_epoch}</p></div>{attemptReference('Externer Thread', attempt.external_thread_id)}{attemptReference('T3-Run', attempt.external_observed_run_id ?? attempt.external_dispatch_run_id ?? attempt.external_result_run_id)}{attempt.external_url && <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={attempt.external_url} target="_blank" rel="noreferrer">In T3 öffnen <ExternalLink className="size-3" /></a>}{attempt.ended_at && <p className="text-xs text-muted-foreground">Beendet: {new Date(attempt.ended_at).toLocaleString('de-DE')}</p>}</div>
}

function ApprovalCard({ approval, currentRun, task }: { approval: Approval; currentRun: Run; task: Task }) {
  const fresh = approval.attempt_no === currentRun.attempt_no && approval.task_revision === task.version && approval.result_digest === currentRun.result_digest
  const kind = approval.kind === 'completion' ? 'Phasenabschluss' : 'Phasenreview'
  const state = approval.status === 'pending' ? 'Wartet auf Entscheidung' : approval.status === 'approved' ? 'Angenommen' : approval.status === 'rejected' ? 'Zurückgewiesen' : 'Veraltet'
  return <div className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{kind} · Versuch {approval.attempt_no}</p><Badge variant={approval.status === 'rejected' || approval.status === 'invalidated' ? 'destructive' : approval.status === 'approved' ? 'secondary' : 'outline'}>{state}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Ticketrevision {approval.task_revision} · {fresh ? 'Bezieht sich auf den aktuellen Stand' : 'Bezieht sich nicht mehr auf den aktuellen Stand'}</p>{approval.reason && <p className="mt-2 whitespace-pre-wrap text-xs">{approval.reason}</p>}{approval.status === 'pending' && !fresh && <p className="mt-2 text-xs text-amber-900">Diese Freigabe kann den geänderten Ticket- oder Ergebnisstand nicht bestätigen.</p>}</div>
}
