import { useState } from 'react'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BookOpen, Cable, CircleCheck, CircleHelp, Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { fetchAllPages, useConnections, useProjects } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import ProjectBindingDialog, { bindingsForT3Project, type BoundProject } from './integrations/ProjectBindingDialog'

const healthLabels: Record<string, string> = { unconfigured: 'Noch nicht verbunden', ready: 'Bereit', degraded: 'Eingeschränkt', unreachable: 'Nicht erreichbar', incompatible: 'Protokoll prüfen' }
const authLabels: Record<string, string> = { missing: 'Autorisierung fehlt', pending: 'Autorisierung läuft', valid: 'Autorisiert', expiring: 'Zugang läuft ab', expired: 'Zugang abgelaufen', revoked: 'Widerrufen' }
const checkStatusLabels: Record<components['schemas']['ConnectionCheck']['status'], string> = { queued: 'Prüfung läuft', succeeded: 'Prüfung erfolgreich', failed: 'Prüfung fehlgeschlagen' }
const stageLabels: Record<components['schemas']['ConnectionCheck']['network'], string> = { ok: 'Bestanden', failed: 'Fehlgeschlagen', not_checked: 'Nicht geprüft' }

export default function IntegrationsView() {
  const client = useQueryClient()
  const connectionsQuery = useConnections()
  const projectsQuery = useProjects()
  const connections = connectionsQuery.data?.items ?? []
  const internalProjects = projectsQuery.data?.items ?? []
  const [name, setName] = useState('T3 Code')
  const [url, setUrl] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [bindingTarget, setBindingTarget] = useState<{ connectionId: string; project: components['schemas']['RemoteProject'] }>()
  const selected = connectionsQuery.isError ? undefined : connections.find((item) => item.id === selectedId) ?? connections[0]
  const effectiveId = selected?.id
  const canLoadProjects = Boolean(effectiveId && selected?.auth_status === 'valid')
  const [acceptedCheck, setAcceptedCheck] = useState<{ connectionId: string; actionId: string }>()
  const connectionCheckQuery = useQuery({
    queryKey: ['connection-check', effectiveId],
    enabled: Boolean(effectiveId),
    queryFn: effectiveId ? async () => {
      const response = await api.GET('/connections/{connection_id}/check', { params: { path: { connection_id: effectiveId } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    } : skipToken,
    refetchInterval: (query) => query.state.data?.status === 'queued' ? 750 : false,
  })
  const remoteProjectsQuery = useQuery({
    queryKey: ['connection-projects', effectiveId],
    enabled: canLoadProjects,
    queryFn: effectiveId ? () => fetchAllPages((cursor) => request(api.GET('/connections/{connection_id}/projects', { params: { path: { connection_id: effectiveId }, query: { limit: 100, cursor } } }))) : skipToken,
  })
  const bindingIndexQuery = useQuery({
    queryKey: ['project-binding-index', internalProjects.map((project) => `${project.id}:${project.version}:${project.active_binding_id ?? ''}`).join('|')],
    enabled: canLoadProjects && projectsQuery.isSuccess,
    queryFn: async () => {
      const boundProjects = internalProjects.filter((project) => project.active_binding_id !== null)
      return Promise.all(boundProjects.map(async (project): Promise<BoundProject> => {
        const response = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: project.id } } })
        if (response.response.status === 404) throw new Error(`Die gespeicherte Projektzuordnung für „${project.name}“ konnte nicht gelesen werden. Aktualisiere die Seite, bevor du weitere T3-Projekte verbindest.`)
        return { project, binding: await request(Promise.resolve(response)) }
      }))
    },
  })

  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['connections'] }), client.invalidateQueries({ queryKey: ['agent-profiles'] })])
  }

  const createConnection = useMutation({
    mutationFn: () => request(api.POST('/connections', { params: mutationParams(), body: { name: name.trim(), bridge_id: 't3.mcp.v0_1_10', canonical_url: url.trim() } })),
    onSuccess: async (connection) => { setUrl(''); await refresh(); setSelectedId(connection.id); toast.success('T3-Verbindung gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const checkConnection = useMutation({
    mutationFn: (connection: NonNullable<typeof connectionsQuery.data>['items'][number]) => request(api.POST('/connections/{connection_id}/check', {
      params: { path: { connection_id: connection.id }, ...mutationParams(connection.version) }, body: { refresh_capabilities: true },
    })),
    onSuccess: async (receipt, connection) => {
      setAcceptedCheck({ connectionId: connection.id, actionId: receipt.action_id })
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['connection-check', connection.id] })])
      toast.success('Verbindungsprüfung gestartet')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const authorize = useMutation({
    mutationFn: (connection: NonNullable<typeof connectionsQuery.data>['items'][number]) => request(api.POST('/connections/{connection_id}/oauth/start', {
      params: { path: { connection_id: connection.id }, ...mutationParams(connection.version) },
    })),
    onSuccess: (result) => { window.location.assign(result.authorization_url) },
    onError: (error) => toast.error(formatError(error)),
  })

  const bindingSourcesReady = canLoadProjects && projectsQuery.isSuccess && bindingIndexQuery.isSuccess
  const bindingSourcesError = projectsQuery.error ?? bindingIndexQuery.error
  const reloadBindingSources = () => { void projectsQuery.refetch(); void bindingIndexQuery.refetch() }

  if (connectionsQuery.isPending) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  if (connectionsQuery.isError) return <Card><CardContent className="p-6"><h2 className="font-semibold">T3-Verbindungen konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(connectionsQuery.error)}</p><Button variant="outline" className="mt-4" onClick={() => void connectionsQuery.refetch()}>Erneut laden</Button></CardContent></Card>

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">T3-Verbindung</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Verbinde Falkenwarte mit T3, um Aufträge zu starten. Installiere den Agent-Skill in deinem Arbeitsprojekt, damit die Agents ihre Übergaben und Ergebnisse am Ticket melden können.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href="#/docs/user/AGENT_SKILL.md"><BookOpen />Agent-Skill einrichten</a></Button>
          <Button asChild variant="ghost" size="sm"><a href="/skills/falkenwarte/SKILL.md" download="SKILL.md"><Download />Skill herunterladen</a></Button>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cable className="size-4 text-muted-foreground" />Verbindung hinzufügen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="connection-name">Name</Label><Input id="connection-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></div>
            <div className="space-y-1.5"><Label htmlFor="connection-url">Kanonische HTTPS-Adresse</Label><Input id="connection-url" value={url} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://t3.home.arpa" autoComplete="url" /></div>
            <p className="text-xs text-muted-foreground">Zugangsdaten werden getrennt über den Autorisierungsablauf gespeichert.</p>
            <Button disabled={!name.trim() || !url.startsWith('https://') || createConnection.isPending} onClick={() => createConnection.mutate()}>Verbindung speichern</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Verbindungen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {connections.map((connection) => <button key={connection.id} type="button" onClick={() => setSelectedId(connection.id)} className={`w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 ${selected?.id === connection.id ? 'border-primary/50 bg-muted/30' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{connection.name}</p><Badge variant={connection.health === 'ready' && connection.auth_status === 'valid' ? 'secondary' : 'outline'}>{healthLabels[connection.health] ?? connection.health}</Badge></div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{connection.canonical_url}</p>
              <p className="mt-3 text-xs text-muted-foreground">{authLabels[connection.auth_status] ?? connection.auth_status}{connection.last_success_at ? ` · zuletzt geprüft ${new Date(connection.last_success_at).toLocaleString()}` : ''}</p>
            </button>)}
            {connections.length === 0 && <p className="py-5 text-sm text-muted-foreground">Noch keine T3-Verbindung eingerichtet.</p>}
          </CardContent>
        </Card>
      </section>

      {selected && <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-muted-foreground" />Verbindung prüfen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Prüft Netzwerk, Autorisierung, MCP-Protokoll und verfügbare Fähigkeiten.</p>
            {selected.diagnostic && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">{selected.diagnostic}</div>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={checkConnection.isPending || connectionCheckQuery.data?.status === 'queued'} onClick={() => checkConnection.mutate(selected)}><RefreshCw className={checkConnection.isPending || connectionCheckQuery.data?.status === 'queued' ? 'animate-spin' : ''} />{connectionCheckQuery.data?.status === 'queued' ? 'Prüfung läuft…' : 'Verbindung testen'}</Button>
              <Button variant="outline" disabled={authorize.isPending || selected.auth_status === 'valid'} onClick={() => authorize.mutate(selected)}>Bei T3 anmelden <ArrowUpRight /></Button>
            </div>
            {connectionCheckQuery.isError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Prüfergebnis konnte nicht geladen werden. {formatError(connectionCheckQuery.error)} <Button variant="ghost" size="sm" onClick={() => void connectionCheckQuery.refetch()}>Erneut laden</Button></div>}
            {connectionCheckQuery.data && <ConnectionCheckResult check={connectionCheckQuery.data} actionId={acceptedCheck?.connectionId === selected.id ? acceptedCheck.actionId : undefined} />}
            {selected.capability_snapshot_id && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" />Fähigkeitsstand {selected.capability_snapshot_id}</p>}
            {!selected.capability_snapshot_id && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CircleHelp className="size-4" />Noch keine Fähigkeiten bestätigt</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Vorhandene T3-Projekte</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" disabled={!canLoadProjects || remoteProjectsQuery.isFetching} onClick={() => void remoteProjectsQuery.refetch()}><RefreshCw className={remoteProjectsQuery.isFetching ? 'animate-spin' : ''} />Projekte laden</Button>
            {!canLoadProjects && <p className="text-sm text-muted-foreground">Melde dich bei T3 an, bevor du Projekte lädst.</p>}
            {canLoadProjects && remoteProjectsQuery.isError && <div role="alert" className="text-sm text-destructive">{formatError(remoteProjectsQuery.error)} <Button variant="ghost" size="sm" onClick={() => void remoteProjectsQuery.refetch()}>Erneut laden</Button></div>}
            {canLoadProjects && remoteProjectsQuery.data && projectsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Falkenwarte-Projekte werden geladen…</p>}
            {canLoadProjects && remoteProjectsQuery.data && projectsQuery.isError && <div role="alert" className="text-sm text-destructive">Falkenwarte-Projekte konnten nicht geladen werden. {formatError(projectsQuery.error)} <Button variant="ghost" size="sm" onClick={() => void projectsQuery.refetch()}>Erneut laden</Button></div>}
            {canLoadProjects && remoteProjectsQuery.data && projectsQuery.isSuccess && bindingIndexQuery.isError && <div role="alert" className="text-sm text-destructive">Projektzuordnungen konnten nicht geladen werden. {formatError(bindingIndexQuery.error)} <Button variant="ghost" size="sm" onClick={() => void bindingIndexQuery.refetch()}>Erneut laden</Button></div>}
            {canLoadProjects && remoteProjectsQuery.data && projectsQuery.isSuccess && bindingIndexQuery.isFetching && <p role="status" className="text-sm text-muted-foreground">Bestehende Projektzuordnungen werden geladen…</p>}
            {canLoadProjects && (remoteProjectsQuery.data?.items ?? []).map((project) => {
              const bindings = bindingIndexQuery.data ? bindingsForT3Project(bindingIndexQuery.data, selected.id, project.external_project_id) : []
              return <div key={project.external_project_id} data-testid="t3-project-row" className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{project.title}</p><p className="text-xs text-muted-foreground">{project.workspace_label ?? 'T3-Projekt'} · {project.external_project_id}</p></div>
                {bindings.length > 0 ? <div data-testid="t3-project-binding" className="flex flex-col items-start gap-2 text-sm">
                  {bindings.map(({ project: localProject }) => <div key={localProject.id} className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">Verbunden</Badge>
                    <a className="font-medium underline underline-offset-4" href={`#/project/${encodeURIComponent(localProject.id)}/board`}>{localProject.name} öffnen</a>
                    <a className="underline underline-offset-4" href={`#/roles/${encodeURIComponent(localProject.id)}/${encodeURIComponent(selected.id)}`}>Agentrolle einrichten</a>
                  </div>)}
                </div> : <Button variant="outline" size="sm" disabled={!bindingSourcesReady} onClick={() => setBindingTarget({ connectionId: selected.id, project })}>Projekt verbinden</Button>}
              </div>
            })}
            {canLoadProjects && remoteProjectsQuery.data?.items.length === 0 && <p className="py-3 text-sm text-muted-foreground">Für diese Verbindung wurden keine T3-Projekte gemeldet.</p>}
          </CardContent>
        </Card>
      </section>}
      {bindingTarget && selected?.id === bindingTarget.connectionId && (
        <ProjectBindingDialog
          connectionId={bindingTarget.connectionId}
          remoteProject={bindingTarget.project}
          projects={internalProjects}
          boundProjects={bindingIndexQuery.data ?? []}
          sourcesReady={bindingSourcesReady}
          sourcesError={bindingSourcesError}
          onReload={reloadBindingSources}
          onClose={() => setBindingTarget(undefined)}
        />
      )}
    </main>
  )
}

function ConnectionCheckResult({ check, actionId }: { check: components['schemas']['ConnectionCheck']; actionId?: string }) {
  const failed = check.status === 'failed'
  return <section data-testid="connection-check-result" aria-live="polite" className={`space-y-2 rounded-lg border p-3 text-sm ${failed ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-muted/20'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{checkStatusLabels[check.status]}</h3><span className="text-xs text-muted-foreground">{new Date(check.checked_at).toLocaleString()}</span></div>
    {actionId && <p className="text-xs text-muted-foreground">Auftrag {actionId}</p>}
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      <div className="flex justify-between gap-2"><dt>Netzwerk</dt><dd>{stageLabels[check.network]}</dd></div>
      <div className="flex justify-between gap-2"><dt>Autorisierung</dt><dd>{stageLabels[check.authentication]}</dd></div>
      <div className="flex justify-between gap-2"><dt>MCP-Verbindung</dt><dd>{stageLabels[check.mcp_handshake]}</dd></div>
      <div className="flex justify-between gap-2"><dt>Fähigkeiten</dt><dd>{stageLabels[check.capabilities]}</dd></div>
    </dl>
    {check.diagnostic && <p className="whitespace-pre-wrap text-sm">{check.diagnostic}</p>}
    {check.snapshot_id && <p className="text-xs text-muted-foreground">Fähigkeitssnapshot {check.snapshot_id}</p>}
  </section>
}
