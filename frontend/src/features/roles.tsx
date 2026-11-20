import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { fetchAllPages, useConnections, useProjects } from '@/lib/queries'
import { ReferenceThreadPicker } from './ReferenceThreadPicker'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

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
  const [targetMode, setTargetMode] = useState<'t3_project_default' | 't3_reference_thread'>('t3_project_default')
  const [referenceThread, setReferenceThread] = useState('')
  const [prompt, setPrompt] = useState('')
  const connections = connectionsQuery.data?.items ?? []
  const projects = projectsQuery.data?.items ?? []
  const connectionId = connections.find((connection) => connection.id === chosenConnection)?.id ?? ''
  const projectIds = chosenProjects.filter((id) => projects.some((project) => project.id === id))
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['agent-profiles'] }),
    client.invalidateQueries({ queryKey: ['connections'] }),
  ])

  const createProfile = useMutation({
    mutationFn: () => {
      if (!connectionId) throw new Error('Wähle zuerst eine T3-Verbindung aus.')
      return request(api.POST('/agent-profiles', {
        params: mutationParams(),
        body: {
          name: name.trim(), icon_key: 'bot', role: role.trim(), connection_id: connectionId,
          allowed_project_ids: projectIds, max_parallel_runs: 1, prompt_template: prompt.trim() || undefined,
          enabled: true,
          default_run_completion_policy: {
            require_external_settled: true, required_evidence_kinds: [], required_criterion_ids: [],
            require_human_phase_decision: false, require_human_confirmed_evidence: false,
          },
          execution_target: targetMode === 't3_project_default'
            ? { mode: 't3_project_default' as const }
            : { mode: 't3_reference_thread' as const, reference_thread_id: referenceThread.trim() },
        },
      }))
    },
    onSuccess: async () => { setName(''); setPrompt(''); setProjectIds([]); setReferenceThread(''); await refresh(); toast.success('Rolle angelegt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const toggleProfile = useMutation({
    mutationFn: (profile: NonNullable<typeof profilesQuery.data>['items'][number]) => request(api.PUT('/agent-profiles/{profile_id}', {
      params: { path: { profile_id: profile.id }, ...mutationParams(profile.version) },
      body: {
        name: profile.name, icon_key: profile.icon_key, role: profile.role, connection_id: profile.connection_id,
        allowed_project_ids: profile.allowed_project_ids, max_parallel_runs: 1, prompt_template: profile.prompt_template,
        enabled: !profile.enabled, default_run_completion_policy: profile.default_run_completion_policy,
        execution_target: profile.execution_target,
      },
    })),
    onSuccess: async () => { await refresh(); toast.success('Rollenstatus aktualisiert') },
    onError: (error) => toast.error(formatError(error)),
  })

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
            <div className="space-y-1.5"><Label htmlFor="profile-connection">T3-Verbindung</Label><Select value={connectionId} onValueChange={(id) => { setConnectionId(id); setReferenceThread('') }}><SelectTrigger id="profile-connection"><SelectValue placeholder="Verbindung wählen" /></SelectTrigger><SelectContent>{connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name} · {connection.health}</SelectItem>)}</SelectContent></Select></div>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Erlaubte Projekte</legend><div className="grid gap-2 sm:grid-cols-2">{projects.map((project) => <label key={project.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => { setReferenceThread(''); setProjectIds(event.target.checked ? [...projectIds, project.id] : projectIds.filter((id) => id !== project.id)) }} /><span className="truncate">{project.name}</span></label>)}</div></fieldset>
            <div className="space-y-1.5"><Label htmlFor="profile-target">Ausführungsziel in T3</Label><Select value={targetMode} onValueChange={(value) => { setTargetMode(value as typeof targetMode); setReferenceThread('') }}><SelectTrigger id="profile-target"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="t3_project_default">T3-Projektstandard</SelectItem><SelectItem value="t3_reference_thread">Vorhandener Referenzthread</SelectItem></SelectContent></Select></div>
            {targetMode === 't3_project_default' ? (
              <p className="text-sm text-muted-foreground">Beim Start verwendet T3 die Agentkonfiguration des gebundenen Projekts.</p>
            ) : (
              <ReferenceThreadPicker
                key={JSON.stringify([connectionId, ...projectIds])}
                connectionId={connectionId}
                projects={projects.filter((project) => projectIds.includes(project.id))}
                value={referenceThread}
                onChange={setReferenceThread}
              />
            )}
            <div className="space-y-1.5"><Label htmlFor="profile-prompt">Auftragsvorlage <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="profile-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={30000} placeholder="Zusätzlicher Rollenhinweis für Übergaben" /></div>
            <Button disabled={!name.trim() || !role.trim() || !connectionId || projectIds.length === 0 || (targetMode === 't3_reference_thread' && !referenceThread.trim()) || createProfile.isPending} onClick={() => createProfile.mutate()}><Plus />Rolle anlegen</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" />Vorhandene Rollen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => {
              const connection = connections.find((item) => item.id === profile.connection_id)
              const target = profile.execution_target.mode === 't3_project_default' ? 'T3-Projektstandard' : `Referenzthread ${profile.execution_target.reference_thread_id}`
              return <article key={profile.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Bot className="size-4" /></span><div className="min-w-0"><h3 className="truncate font-medium">{profile.name}</h3><p className="text-sm text-muted-foreground">{profile.role}</p></div></div><Button size="sm" variant={profile.enabled ? 'outline' : 'default'} disabled={toggleProfile.isPending} onClick={() => toggleProfile.mutate(profile)}>{profile.enabled ? 'Deaktivieren' : 'Aktivieren'}</Button></div>
                <div className="mt-4 flex flex-wrap gap-2"><Badge variant={profile.configuration_valid ? 'secondary' : 'outline'}>{profile.configuration_valid ? 'Konfiguration bereit' : 'Konfiguration prüfen'}</Badge><Badge variant="outline">{connection?.name ?? 'T3-Verbindung fehlt'}</Badge><Badge variant="outline">{target}</Badge></div>
                {!profile.configuration_valid && profile.configuration_error && <p className="mt-3 text-sm text-amber-700">{profile.configuration_error}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">{profile.allowed_project_ids.map((id) => <Badge key={id} variant="secondary">{projectNames.get(id) ?? 'Unbekanntes Projekt'}</Badge>)}</div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3" />Maximal ein gleichzeitiger Auftrag pro Profil</p>
              </article>
            })}
            {profiles.length === 0 && <p className="py-5 text-sm text-muted-foreground">Lege eine Rolle für den gewünschten Arbeitsbereich an.</p>}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
