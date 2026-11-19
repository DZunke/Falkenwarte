import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus, Route, TimerReset } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const instanceLabels: Record<string, string> = { queued: 'Wartet', running: 'Läuft', paused: 'Pausiert', succeeded: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen' }

export default function WorkflowsView() {
  const client = useQueryClient()
  const projectsQuery = useProjects()
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: () => request(api.GET('/workflows', { params: { query: { limit: 100 } } })) })
  const profilesQuery = useQuery({ queryKey: ['agent-profiles'], queryFn: () => request(api.GET('/agent-profiles', { params: { query: { limit: 100 } } })) })
  const instancesQuery = useQuery({ queryKey: ['workflow-instances'], queryFn: () => request(api.GET('/workflow-instances', { params: { query: { limit: 100 } } })) })
  const triggersQuery = useQuery({ queryKey: ['triggers'], queryFn: () => request(api.GET('/triggers', { params: { query: { limit: 100 } } })) })
  const [projectId, setProjectId] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [routeLabelId, setRouteLabelId] = useState('')
  const [routeWorkflowId, setRouteWorkflowId] = useState('')
  const [triggerName, setTriggerName] = useState('')
  const projects = projectsQuery.data?.items ?? []
  const workflows = workflowsQuery.data?.items ?? []
  const profiles = profilesQuery.data?.items ?? []
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0]
  const selectedProjectId = projectId || selectedProject?.id || ''
  const labelsQuery = useQuery({
    queryKey: ['project-labels', selectedProjectId],
    enabled: Boolean(selectedProjectId),
    queryFn: () => request(api.GET('/projects/{project_id}/labels', { params: { path: { project_id: selectedProjectId } } })),
  })
  const routingQuery = useQuery({
    queryKey: ['routing-rules', selectedProjectId],
    enabled: Boolean(selectedProjectId),
    queryFn: () => request(api.GET('/projects/{project_id}/routing-rules', { params: { path: { project_id: selectedProjectId } } })),
  })
  const topicRoutes = useMemo(() => routingQuery.data?.rules ?? [], [routingQuery.data])
  const workflowLabels = (labelsQuery.data?.items ?? []).filter((label) => label.kind === 'workflow' && label.active)

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['workflows'] }), client.invalidateQueries({ queryKey: ['workflow-instances'] }),
    client.invalidateQueries({ queryKey: ['routing-rules'] }), client.invalidateQueries({ queryKey: ['triggers'] }),
  ])

  const createWorkflow = useMutation({
    mutationFn: () => {
      if (!selectedProjectId) throw new Error('Wähle ein Projekt aus.')
      const profile = profileId || null
      const policy = { require_external_settled: true as const, required_evidence_kinds: [], required_criterion_ids: [], require_human_phase_decision: false, require_human_confirmed_evidence: false }
      return request(api.POST('/workflows', {
        params: mutationParams(),
        body: {
          project_id: selectedProjectId, name: workflowName.trim(), preset_id: 'two-stage-review', enabled: true,
          stages: [
            { id: 'work', kind: 'agent_run', name: 'Bearbeitung', agent_profile_id: profile, entry_conditions: [], run_completion_policy: policy },
            { id: 'review', kind: 'review', name: 'Reviewmeldung', agent_profile_id: profile, entry_conditions: [{ type: 'run_succeeded' }], run_completion_policy: { ...policy, require_human_phase_decision: true } },
          ],
          transitions: [
            { from_stage_id: 'work', to_stage_id: 'review', on: 'accepted', conditions: [] },
            { from_stage_id: 'review', to_stage_id: 'work', on: 'needs_changes', conditions: [] },
          ],
          limits: { max_repair_rounds: 2, max_depth: 3, max_parallel_runs: 1, max_total_seconds: 86400 },
        },
      }))
    },
    onSuccess: async () => { setWorkflowName(''); await refresh(); toast.success('Workflow gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const saveRoute = useMutation({
    mutationFn: () => {
      if (!selectedProjectId || !routeLabelId || !routeWorkflowId) throw new Error('Wähle ein Workflowlabel und einen Workflow aus.')
      const workflow = workflows.find((item) => item.id === routeWorkflowId)
      if (!workflow) throw new Error('Der ausgewählte Workflow ist nicht verfügbar.')
      const rules = [...topicRoutes.filter((rule) => rule.workflow_label_id !== routeLabelId), {
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
  return (
    <main className="space-y-6">
      <header><p className="text-sm text-muted-foreground">Versionierte Phasen und kontrollierte Starts</p><h1 className="text-2xl font-semibold tracking-tight">Workflows</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Workflows legen fest, wann eine Phase endet und welche Entscheidung folgt. Workflowlabels ordnen eine Route zu und erteilen keine Startfreigabe.</p></header>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4 text-muted-foreground" />Zwei-Phasen-Workflow</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label>Projekt</Label><Select value={selectedProjectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="workflow-name">Name</Label><Input id="workflow-name" value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Bearbeitung mit Reviewmeldung" maxLength={120} /></div>
            <div className="space-y-1.5"><Label>Agentrolle für beide Phasen</Label><Select value={profileId || 'none'} onValueChange={(value) => setProfileId(value === 'none' ? '' : value)}><SelectTrigger><SelectValue placeholder="Rolle wählen" /></SelectTrigger><SelectContent><SelectItem value="none">Keine Rolle festlegen</SelectItem>{profiles.filter((profile) => profile.enabled).map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name} · {profile.role}</SelectItem>)}</SelectContent></Select></div>
            <p className="text-xs text-muted-foreground">Bearbeitung führt nach angenommener Meldung zur Reviewphase. „Änderungen nötig“ führt zur Bearbeitung zurück. Eine menschliche Phasenentscheidung bleibt wirksam.</p>
            <Button disabled={!workflowName.trim() || !selectedProjectId || createWorkflow.isPending} onClick={() => createWorkflow.mutate()}><GitBranch />Workflow anlegen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Route className="size-4 text-muted-foreground" />Workflowlabels zuordnen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label>Projekt</Label><Select value={selectedProjectId} onValueChange={setProjectId}><SelectTrigger><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Workflowlabel</Label><Select value={routeLabelId} onValueChange={setRouteLabelId}><SelectTrigger><SelectValue placeholder="Label wählen" /></SelectTrigger><SelectContent>{workflowLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Workflow</Label><Select value={routeWorkflowId} onValueChange={setRouteWorkflowId}><SelectTrigger><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{workflows.filter((workflow) => workflow.enabled && (workflow.project_id === null || workflow.project_id === selectedProjectId)).map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name} · v{workflow.definition_version}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <Button variant="outline" disabled={!routeLabelId || !routeWorkflowId || saveRoute.isPending || !routingQuery.data} onClick={() => saveRoute.mutate()}><Route />Zuordnung speichern</Button>
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Aktuelle Zuordnungen</p>
              {topicRoutes.map((rule) => <div key={rule.workflow_label_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"><span>{workflowLabels.find((label) => label.id === rule.workflow_label_id)?.name ?? 'Workflowlabel'}</span><span className="text-muted-foreground">{workflows.find((workflow) => workflow.id === rule.workflow_id)?.name ?? 'Workflow'} · v{rule.workflow_definition_version}</span></div>)}
              {topicRoutes.length === 0 && <p className="text-xs text-muted-foreground">Keine automatischen Zuordnungen konfiguriert.</p>}
              <p className="text-xs text-muted-foreground">Bei fehlender oder mehrdeutiger Zuordnung ist eine menschliche Entscheidung erforderlich.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TimerReset className="size-4 text-muted-foreground" />Workflows und laufende Instanzen</CardTitle></CardHeader><CardContent className="space-y-3">
          {workflows.map((workflow) => <article key={workflow.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{workflow.name}</h3><Badge variant={workflow.enabled ? 'secondary' : 'outline'}>{workflow.enabled ? 'Aktiv' : 'Pausiert'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{workflow.project_id ? projects.find((project) => project.id === workflow.project_id)?.name ?? 'Projekt' : 'Projektübergreifend'} · Version {workflow.definition_version} · {workflow.stages.length} Phasen</p><div className="mt-3 flex flex-wrap gap-2">{workflow.stages.map((stage) => <Badge key={stage.id} variant="outline">{stage.name}</Badge>)}</div></article>)}
          {workflows.length === 0 && <p className="py-3 text-sm text-muted-foreground">Noch keine Workflowvorlagen eingerichtet.</p>}
          {instances.slice(0, 8).map((instance) => <div key={instance.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"><span>{workflows.find((workflow) => workflow.id === instance.workflow_id)?.name ?? 'Workflow'} · v{instance.definition_version}</span><Badge variant="outline">{instanceLabels[instance.state] ?? instance.state}</Badge></div>)}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Manuelle Trigger</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor="trigger-name">Name</Label><Input id="trigger-name" value={triggerName} onChange={(event) => setTriggerName(event.target.value)} maxLength={120} placeholder="Manueller Start" /></div><div className="space-y-1.5"><Label>Workflow</Label><Select value={routeWorkflowId} onValueChange={setRouteWorkflowId}><SelectTrigger><SelectValue placeholder="Workflow wählen" /></SelectTrigger><SelectContent>{workflows.filter((workflow) => workflow.enabled).map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>)}</SelectContent></Select></div><Button disabled={!triggerName.trim() || !routeWorkflowId || !selectedProjectId || createTrigger.isPending} onClick={() => createTrigger.mutate()}><Plus />Einrichten</Button></div>
          <p className="text-xs text-muted-foreground">Ein Trigger führt keinen Code aus und startet keinen Lauf, bevor eine berechtigte Aktion den Workflow anfordert.</p>
          <div className="space-y-2">{triggers.map((trigger) => <div key={trigger.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><div><p className="font-medium">{trigger.name}</p><p className="text-xs text-muted-foreground">{workflows.find((workflow) => workflow.id === trigger.workflow_id)?.name ?? 'Workflow'}</p></div><Badge variant={trigger.enabled ? 'secondary' : 'outline'}>{trigger.enabled ? 'Aktiv' : 'Pausiert'}</Badge></div>)}{triggers.length === 0 && <p className="text-sm text-muted-foreground">Keine manuellen Trigger eingerichtet.</p>}</div>
        </CardContent></Card>
      </section>
    </main>
  )
}
