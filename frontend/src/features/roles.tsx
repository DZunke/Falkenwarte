import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { fetchAllPages, useConnections, useProjects } from '@/lib/queries'
import { ProviderInstancePicker, type ProviderSelection } from './ProviderInstancePicker'
import { ReferenceThreadPicker } from './ReferenceThreadPicker'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

type AgentProfile = components['schemas']['AgentProfile']
type ExecutionTarget = components['schemas']['T3ExecutionTarget']
type TargetMode = ExecutionTarget['mode']

type TargetEditorState = {
  profileId: string
  profileVersion: number
  mode: TargetMode
  referenceThread: string
  providerSelection: ProviderSelection | null
  providerReady: boolean
}

type ProjectEditorState = {
  profileId: string
  profileVersion: number
  allProjects: boolean
  projectIds: string[]
}

function buildExecutionTarget(mode: TargetMode, referenceThread: string, providerSelection: ProviderSelection | null): ExecutionTarget {
  if (mode === 't3_project_default') return { mode }
  if (mode === 't3_reference_thread') return { mode, reference_thread_id: referenceThread.trim() }
  if (!providerSelection?.model) throw new Error('Wähle eine verfügbare Providerinstanz und ein Modell aus dem aktuellen T3-Inventar.')

  return {
    mode,
    provider_instance_id: providerSelection.provider_instance_id,
    model: providerSelection.model,
    ...(providerSelection.reasoning ? { reasoning: providerSelection.reasoning } : {}),
  }
}

function executionTargetLabel(target: ExecutionTarget) {
  if (target.mode === 't3_project_default') return 'T3-Projektstandard'
  if (target.mode === 't3_reference_thread') return `Referenzthread ${target.reference_thread_id}`

  return `Providerinstanz ${target.provider_instance_id} · Modell ${target.model} · Reasoning-Level ${target.reasoning?.value ?? 'T3-Standard'}`
}

export default function RolesView({ initialProjectId, initialConnectionId }: { initialProjectId?: string; initialConnectionId?: string }) {
  const client = useQueryClient()
  const connectionsQuery = useConnections()
  const profilesQuery = useQuery({
    queryKey: ['agent-profiles', 'all'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/agent-profiles', { params: { query: { limit: 100, cursor } } }))),
  })
  const projectsQuery = useProjects()
  const [name, setName] = useState('')
  const [role, setRole] = useState('Implementierung')
  const [chosenConnection, setConnectionId] = useState(initialConnectionId ?? '')
  const [chosenProjects, setProjectIds] = useState<string[]>(initialProjectId ? [initialProjectId] : [])
  const [allProjects, setAllProjects] = useState(false)
  const [targetMode, setTargetMode] = useState<'t3_project_default' | 't3_reference_thread' | 't3_provider_instance'>('t3_project_default')
  const [referenceThread, setReferenceThread] = useState('')
  const [providerTarget, setProviderTarget] = useState<ProviderSelection | null>(null)
  const [providerTargetReady, setProviderTargetReady] = useState(false)
  const [targetEditor, setTargetEditor] = useState<TargetEditorState | null>(null)
  const [projectEditor, setProjectEditor] = useState<ProjectEditorState | null>(null)
  const [prompt, setPrompt] = useState('')
  const connections = connectionsQuery.data?.items ?? []
  const projects = projectsQuery.data?.items ?? []
  const connectionId = connections.find((connection) => connection.id === chosenConnection)?.id ?? ''
  const projectIds = chosenProjects.filter((id) => projects.some((project) => project.id === id))
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const selectedConnectionName = connections.find((connection) => connection.id === connectionId)?.name

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['agent-profiles'] }),
    client.invalidateQueries({ queryKey: ['connections'] }),
  ])

  const createProfile = useMutation({
    mutationFn: () => {
      if (!connectionId) throw new Error('Wähle zuerst eine T3-Verbindung aus.')
      if (targetMode === 't3_provider_instance' && !providerTargetReady) throw new Error('Wähle eine verfügbare Providerinstanz, ein Modell und gegebenenfalls ein von T3 bestätigtes Reasoning-Level.')
      const executionTarget = buildExecutionTarget(targetMode, referenceThread, providerTarget)
      return request(api.POST('/agent-profiles', {
        params: mutationParams(),
        body: {
          name: name.trim(), icon_key: 'bot', role: role.trim(), connection_id: connectionId,
          all_projects: allProjects, allowed_project_ids: allProjects ? [] : projectIds,
          max_parallel_runs: 1, prompt_template: prompt.trim() || undefined,
          enabled: true,
          default_run_completion_policy: {
            require_external_settled: true, required_evidence_kinds: [], required_criterion_ids: [],
            require_human_phase_decision: false, require_human_confirmed_evidence: false,
          },
          execution_target: executionTarget,
        },
      }))
    },
    onSuccess: async () => { setName(''); setPrompt(''); setProjectIds([]); setAllProjects(false); setReferenceThread(''); setProviderTarget(null); setProviderTargetReady(false); await refresh(); toast.success('Rolle angelegt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const toggleProfile = useMutation({
    mutationFn: (profile: NonNullable<typeof profilesQuery.data>['items'][number]) => request(api.PUT('/agent-profiles/{profile_id}', {
      params: { path: { profile_id: profile.id }, ...mutationParams(profile.version) },
      body: {
        name: profile.name, icon_key: profile.icon_key, role: profile.role, connection_id: profile.connection_id,
        allowed_project_ids: profile.allowed_project_ids, all_projects: profile.all_projects,
        max_parallel_runs: profile.max_parallel_runs, prompt_template: profile.prompt_template,
        enabled: !profile.enabled, default_run_completion_policy: profile.default_run_completion_policy,
        execution_target: profile.execution_target,
      },
    })),
    onSuccess: async () => { await refresh(); toast.success('Rollenstatus aktualisiert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateProfileTarget = useMutation({
    mutationFn: ({ profile, editor }: { profile: AgentProfile; editor: TargetEditorState }) => {
      if (editor.mode === 't3_provider_instance' && (!editor.providerReady || !editor.providerSelection?.model)) {
        throw new Error('Wähle eine verfügbare Providerinstanz, ein Modell und gegebenenfalls ein von T3 bestätigtes Reasoning-Level.')
      }
      const target = buildExecutionTarget(editor.mode, editor.referenceThread, editor.providerSelection)

      return request(api.PUT('/agent-profiles/{profile_id}', {
        params: { path: { profile_id: profile.id }, ...mutationParams(editor.profileVersion) },
        body: {
          name: profile.name, icon_key: profile.icon_key, role: profile.role, connection_id: profile.connection_id,
          allowed_project_ids: profile.allowed_project_ids, all_projects: profile.all_projects,
          max_parallel_runs: profile.max_parallel_runs,
          prompt_template: profile.prompt_template, enabled: profile.enabled,
          default_run_completion_policy: profile.default_run_completion_policy, execution_target: target,
        },
      }))
    },
    onSuccess: async () => { setTargetEditor(null); await refresh(); toast.success('Ausführungsziel aktualisiert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateProfileProjects = useMutation({
    mutationFn: ({ profile, editor }: { profile: AgentProfile; editor: ProjectEditorState }) => request(api.PUT('/agent-profiles/{profile_id}', {
      params: { path: { profile_id: profile.id }, ...mutationParams(editor.profileVersion) },
      body: {
        name: profile.name, icon_key: profile.icon_key, role: profile.role, connection_id: profile.connection_id,
        allowed_project_ids: editor.allProjects ? [] : editor.projectIds,
        all_projects: editor.allProjects,
        max_parallel_runs: profile.max_parallel_runs, prompt_template: profile.prompt_template,
        enabled: profile.enabled, default_run_completion_policy: profile.default_run_completion_policy,
        execution_target: profile.execution_target,
      },
    })),
    onSuccess: async () => { setProjectEditor(null); await refresh(); toast.success('Projektfreigaben aktualisiert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const setEditingProviderSelection = useCallback((selection: ProviderSelection | null) => {
    setTargetEditor((current) => {
      if (!current) return current
      const previous = current.providerSelection
      if (previous?.provider_instance_id === selection?.provider_instance_id
        && previous?.model === selection?.model
        && previous?.reasoning?.option_id === selection?.reasoning?.option_id
        && previous?.reasoning?.value === selection?.reasoning?.value) return current

      return { ...current, providerSelection: selection }
    })
  }, [])

  const setEditingProviderReady = useCallback((ready: boolean) => {
    setTargetEditor((current) => current && current.providerReady !== ready ? { ...current, providerReady: ready } : current)
  }, [])

  const changeEditedTargetMode = (mode: TargetMode) => {
    setTargetEditor((current) => current ? { ...current, mode, referenceThread: '', providerSelection: null, providerReady: false } : current)
  }

  const openTargetEditor = (profile: AgentProfile) => {
    setProjectEditor(null)
    const target = profile.execution_target
    setTargetEditor({
      profileId: profile.id,
      profileVersion: profile.version,
      mode: target.mode,
      referenceThread: target.mode === 't3_reference_thread' ? target.reference_thread_id : '',
      providerSelection: target.mode === 't3_provider_instance'
        ? { provider_instance_id: target.provider_instance_id, model: target.model, ...(target.reasoning ? { reasoning: target.reasoning } : {}) }
        : null,
      providerReady: false,
    })
  }

  const openProjectEditor = (profile: AgentProfile) => {
    setTargetEditor(null)
    setProjectEditor({
      profileId: profile.id,
      profileVersion: profile.version,
      allProjects: profile.all_projects,
      projectIds: [...profile.allowed_project_ids],
    })
  }

  if (connectionsQuery.isPending || profilesQuery.isPending || projectsQuery.isPending) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  if (connectionsQuery.isError || profilesQuery.isError || projectsQuery.isError) {
    const error = connectionsQuery.error ?? profilesQuery.error ?? projectsQuery.error
    return <Card><CardContent className="p-6"><h2 className="font-semibold">Rollen konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(error)}</p><Button variant="outline" className="mt-4" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>
  }

  const profiles = profilesQuery.data.items
  return (
    <main className="space-y-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">Agentrollen</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Rollen verbinden Projekte mit bestehenden T3-Zielen. Modell-, Provider-, Home- und Toolkonfiguration bleiben in T3.</p></header>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4 text-muted-foreground" />Rolle hinzufügen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Implementierungs-Agent" maxLength={120} /></div>
              <div className="space-y-1.5"><Label htmlFor="profile-role">Rolle</Label><Input id="profile-role" value={role} onChange={(event) => setRole(event.target.value)} maxLength={100} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="profile-connection">T3-Verbindung</Label><Select value={connectionId} onValueChange={(id) => { setConnectionId(id); setReferenceThread(''); setProviderTarget(null); setProviderTargetReady(false) }}><SelectTrigger id="profile-connection"><SelectValue placeholder="Verbindung wählen" /></SelectTrigger><SelectContent>{connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name} · {connection.health}</SelectItem>)}</SelectContent></Select></div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Erlaubte Projekte</legend>
              <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="all-projects-checkbox"
                  checked={allProjects}
                  disabled={!connectionId}
                  onChange={(event) => {
                    setAllProjects(event.target.checked)
                    setProjectIds([])
                    setReferenceThread('')
                  }}
                />
                <span className="font-medium">Alle Projekte</span>
              </label>
              <p className="text-xs text-muted-foreground">{selectedConnectionName
                ? `Gilt für alle aktuellen und künftigen Falkenwarte-Projekte. Ein Auftrag startet nur, wenn das jeweilige Projekt aktiv mit der T3-Verbindung „${selectedConnectionName}“ verbunden ist.`
                : 'Wähle zuerst eine T3-Verbindung. Starts benötigen eine aktive Projektbindung an genau diese Verbindung.'}</p>
              {!allProjects && <div className="grid gap-2 sm:grid-cols-2">
                {projects.map((project) => (
                  <label key={project.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => { setReferenceThread(''); setProjectIds(event.target.checked ? [...projectIds, project.id] : projectIds.filter((id) => id !== project.id)) }} />
                    <span className="truncate">{project.name}</span>
                  </label>
                ))}
                {projects.length === 0 && <p className="text-sm text-muted-foreground">Es gibt noch keine Falkenwarte-Projekte zur Auswahl.</p>}
              </div>}
              {allProjects && <p className="text-sm text-muted-foreground">Auch künftig angelegte Projekte sind freigegeben. Die einzelnen Projekt-IDs werden nicht gespeichert.</p>}
            </fieldset>
            <div className="space-y-1.5"><Label htmlFor="profile-target">Ausführungsziel in T3</Label><Select value={targetMode} onValueChange={(value) => { setTargetMode(value as TargetMode); setReferenceThread(''); setProviderTarget(null); setProviderTargetReady(false) }}><SelectTrigger id="profile-target"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="t3_project_default">T3-Projektstandard</SelectItem><SelectItem value="t3_reference_thread">Vorhandener Referenzthread</SelectItem><SelectItem value="t3_provider_instance">T3-Providerinstanz</SelectItem></SelectContent></Select></div>
            {targetMode === 't3_project_default' ? (
              <p className="text-sm text-muted-foreground">Beim Start verwendet T3 die Agentkonfiguration des gebundenen Projekts.</p>
            ) : targetMode === 't3_reference_thread' ? (
              <div className="space-y-3">
                {allProjects && <p role="status" className="text-sm text-amber-900">Dieser Referenzthread gehört zu einem T3-Projekt. Für mehrere unterschiedliche T3-Projekte eignen sich der Projektstandard oder eine Providerinstanz.</p>}
                <ReferenceThreadPicker
                  key={JSON.stringify([connectionId, allProjects, ...projectIds])}
                  connectionId={connectionId}
                  projects={allProjects ? projects : projects.filter((project) => projectIds.includes(project.id))}
                  value={referenceThread}
                  onChange={setReferenceThread}
                />
              </div>
            ) : (
              <ProviderInstancePicker
                key={connectionId}
                connectionId={connectionId}
                value={providerTarget}
                onChange={setProviderTarget}
                onReadyChange={setProviderTargetReady}
              />
            )}
            <div className="space-y-1.5"><Label htmlFor="profile-prompt">Auftragsvorlage <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="profile-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={30000} placeholder="Zusätzlicher Rollenhinweis für Übergaben" /></div>
            <Button disabled={!name.trim() || !role.trim() || !connectionId || (!allProjects && projectIds.length === 0) || (targetMode === 't3_reference_thread' && !referenceThread.trim()) || (targetMode === 't3_provider_instance' && (!providerTargetReady || !providerTarget?.model)) || createProfile.isPending} onClick={() => createProfile.mutate()}><Plus />Rolle anlegen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" />Vorhandene Rollen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => {
              const connection = connections.find((item) => item.id === profile.connection_id)
              const allowedProjects = projects.filter((project) => profile.allowed_project_ids.includes(project.id))
              const editor = targetEditor?.profileId === profile.id ? targetEditor : null
              const accessEditor = projectEditor?.profileId === profile.id ? projectEditor : null
              const canSaveTarget = Boolean(editor && (
                editor.mode === 't3_project_default'
                || (editor.mode === 't3_reference_thread' && editor.referenceThread.trim())
                || (editor.mode === 't3_provider_instance' && editor.providerReady && editor.providerSelection?.model)
              ))
              const canSaveProjectAccess = Boolean(accessEditor && (accessEditor.allProjects || accessEditor.projectIds.length > 0))

              return (
                <article key={profile.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Bot className="size-4" /></span>
                      <div className="min-w-0"><h3 className="truncate font-medium">{profile.name}</h3><p className="text-sm text-muted-foreground">{profile.role}</p></div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={updateProfileTarget.isPending} onClick={() => editor ? setTargetEditor(null) : openTargetEditor(profile)}>Ausführungsziel ändern</Button>
                      <Button size="sm" variant="outline" disabled={updateProfileProjects.isPending} onClick={() => accessEditor ? setProjectEditor(null) : openProjectEditor(profile)}>Projektfreigaben ändern</Button>
                      <Button size="sm" variant={profile.enabled ? 'outline' : 'default'} disabled={toggleProfile.isPending} onClick={() => toggleProfile.mutate(profile)}>{profile.enabled ? 'Deaktivieren' : 'Aktivieren'}</Button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant={profile.configuration_valid ? 'secondary' : 'outline'}>{profile.configuration_valid ? 'Konfiguration bereit' : 'Konfiguration prüfen'}</Badge>
                    <Badge variant="outline">{connection?.name ?? 'T3-Verbindung fehlt'}</Badge>
                    <Badge variant="outline">{executionTargetLabel(profile.execution_target)}</Badge>
                  </div>
                  {!profile.configuration_valid && profile.configuration_error && <p className="mt-3 text-sm text-amber-700">{profile.configuration_error}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.all_projects
                      ? <Badge variant="secondary">Alle Projekte</Badge>
                      : profile.allowed_project_ids.length > 0
                        ? profile.allowed_project_ids.map((id) => <Badge key={id} variant="secondary">{projectNames.get(id) ?? 'Unbekanntes Projekt'}</Badge>)
                        : <span className="text-xs text-muted-foreground">Keine Projektfreigabe</span>}
                  </div>
                  {profile.all_projects && <p className="mt-2 text-xs text-muted-foreground">Gilt für aktuelle und künftige Projekte. Starts sind nur bei aktiver Bindung an {connection?.name ?? 'die T3-Verbindung dieses Profils'} möglich.</p>}
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3" />Maximal ein gleichzeitiger Auftrag pro Profil</p>

                  {accessEditor && (
                    <section data-testid={`profile-project-access-editor-${profile.id}`} className="mt-4 space-y-4 rounded-lg border bg-muted/20 p-3">
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">Erlaubte Projekte</legend>
                        <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
                          <input
                            type="checkbox"
                            data-testid="all-projects-checkbox"
                            checked={accessEditor.allProjects}
                            onChange={(event) => {
                              const allProjects = event.target.checked
                              setProjectEditor((current) => current?.profileId === profile.id
                                ? { ...current, allProjects, projectIds: [] }
                                : current)
                            }}
                          />
                          <span className="font-medium">Alle Projekte</span>
                        </label>
                        <p className="text-xs text-muted-foreground">Gilt für alle aktuellen und künftigen Falkenwarte-Projekte. Ein Auftrag startet nur, wenn das jeweilige Projekt aktiv mit der T3-Verbindung „{connection?.name ?? 'dieses Profils'}“ verbunden ist.</p>
                        {!accessEditor.allProjects && <div className="grid gap-2 sm:grid-cols-2">
                          {projects.map((project) => (
                            <label key={project.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                              <input
                                type="checkbox"
                                checked={accessEditor.projectIds.includes(project.id)}
                                onChange={(event) => {
                                  const selected = event.target.checked
                                  setProjectEditor((current) => {
                                    if (current?.profileId !== profile.id) return current
                                    const projectIds = selected
                                      ? [...current.projectIds, project.id]
                                      : current.projectIds.filter((id) => id !== project.id)

                                    return { ...current, projectIds }
                                  })
                                }}
                              />
                              <span className="truncate">{project.name}</span>
                            </label>
                          ))}
                          {projects.length === 0 && <p className="text-sm text-muted-foreground">Es gibt noch keine Falkenwarte-Projekte zur Auswahl.</p>}
                        </div>}
                        {accessEditor.allProjects && <p className="text-sm text-muted-foreground">Auch künftig angelegte Projekte sind freigegeben. Die einzelnen Projekt-IDs werden nicht gespeichert.</p>}
                      </fieldset>
                      {!accessEditor.allProjects && accessEditor.projectIds.length === 0 && <p role="status" className="text-xs text-muted-foreground">Wähle mindestens ein Projekt oder aktiviere „Alle Projekte“. Beim Wechsel von „Alle Projekte“ zu einzelnen Projekten musst du die Auswahl neu treffen.</p>}
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setProjectEditor(null)}>Abbrechen</Button>
                        <Button type="button" disabled={!canSaveProjectAccess || updateProfileProjects.isPending} onClick={() => updateProfileProjects.mutate({ profile, editor: accessEditor })}>Projektfreigaben speichern</Button>
                      </div>
                    </section>
                  )}

                  {editor && (
                    <section data-testid={`profile-target-editor-${profile.id}`} className="mt-4 space-y-4 rounded-lg border bg-muted/20 p-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`profile-target-editor-mode-${profile.id}`}>Ausführungsziel in T3</Label>
                        <Select value={editor.mode} onValueChange={(value) => changeEditedTargetMode(value as TargetMode)}>
                          <SelectTrigger id={`profile-target-editor-mode-${profile.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="t3_project_default">T3-Projektstandard</SelectItem>
                            <SelectItem value="t3_reference_thread">Vorhandener Referenzthread</SelectItem>
                            <SelectItem value="t3_provider_instance">T3-Providerinstanz</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {editor.mode === 't3_project_default' && <p className="text-sm text-muted-foreground">Beim Start verwendet T3 die Agentkonfiguration des gebundenen Projekts.</p>}
                      {editor.mode === 't3_reference_thread' && (
                        <div className="space-y-3">
                          {profile.all_projects && <p role="status" className="text-sm text-amber-900">Dieser Referenzthread gehört zu einem T3-Projekt. Für mehrere unterschiedliche T3-Projekte eignen sich der Projektstandard oder eine Providerinstanz.</p>}
                          <ReferenceThreadPicker
                            key={`edit-${profile.id}-${JSON.stringify(profile.allowed_project_ids)}`}
                            connectionId={profile.connection_id}
                            projects={profile.all_projects ? projects : allowedProjects}
                            value={editor.referenceThread}
                            onChange={(referenceThread) => setTargetEditor((current) => current?.profileId === profile.id ? { ...current, referenceThread } : current)}
                          />
                        </div>
                      )}
                      {editor.mode === 't3_provider_instance' && (
                        <ProviderInstancePicker
                          key={`edit-${profile.id}-${profile.connection_id}`}
                          connectionId={profile.connection_id}
                          value={editor.providerSelection}
                          onChange={setEditingProviderSelection}
                          onReadyChange={setEditingProviderReady}
                        />
                      )}
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setTargetEditor(null)}>Abbrechen</Button>
                        <Button
                          type="button"
                          disabled={!canSaveTarget || updateProfileTarget.isPending}
                          onClick={() => updateProfileTarget.mutate({ profile, editor })}
                        >
                          Ausführungsziel speichern
                        </Button>
                      </div>
                    </section>
                  )}
                </article>
              )
            })}
            {profiles.length === 0 && <p className="py-5 text-sm text-muted-foreground">Lege eine Rolle für den gewünschten Arbeitsbereich an.</p>}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
