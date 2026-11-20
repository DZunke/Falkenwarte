import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BookOpen, Cable, CircleCheck, CircleHelp, Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const healthLabels: Record<string, string> = { unconfigured: 'Noch nicht verbunden', ready: 'Bereit', degraded: 'Eingeschränkt', unreachable: 'Nicht erreichbar', incompatible: 'Protokoll prüfen' }
const authLabels: Record<string, string> = { missing: 'Autorisierung fehlt', pending: 'Autorisierung läuft', valid: 'Autorisiert', expiring: 'Zugang läuft ab', expired: 'Zugang abgelaufen', revoked: 'Widerrufen' }
const checkStatusLabels: Record<components['schemas']['ConnectionCheck']['status'], string> = { queued: 'Prüfung läuft', succeeded: 'Prüfung erfolgreich', failed: 'Prüfung fehlgeschlagen' }
const stageLabels: Record<components['schemas']['ConnectionCheck']['network'], string> = { ok: 'Bestanden', failed: 'Fehlgeschlagen', not_checked: 'Nicht geprüft' }

export default function IntegrationsView() {
  const client = useQueryClient()
  const connectionsQuery = useQuery({ queryKey: ['connections'], queryFn: () => request(api.GET('/connections', { params: { query: { limit: 100 } } })) })
  const [name, setName] = useState('T3 Code')
  const [url, setUrl] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [acceptedCheck, setAcceptedCheck] = useState<{ connectionId: string; actionId: string }>()
  const connectionCheckQuery = useQuery({
    queryKey: ['connection-check', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const response = await api.GET('/connections/{connection_id}/check', { params: { path: { connection_id: selectedId! } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    },
    refetchInterval: (query) => query.state.data?.status === 'queued' ? 750 : false,
  })
  const projectsQuery = useQuery({
    queryKey: ['connection-projects', selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => request(api.GET('/connections/{connection_id}/projects', { params: { path: { connection_id: selectedId! }, query: { limit: 100 } } })),
  })

  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['connections'] }), client.invalidateQueries({ queryKey: ['agent-profiles'] }), client.invalidateQueries({ queryKey: ['connection-projects'] })])
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

  if (connectionsQuery.isPending) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  if (connectionsQuery.isError) return <Card><CardContent className="p-6"><h2 className="font-semibold">T3-Verbindungen konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(connectionsQuery.error)}</p><Button variant="outline" className="mt-4" onClick={() => void connectionsQuery.refetch()}>Erneut laden</Button></CardContent></Card>

  const connections = connectionsQuery.data.items
  const selected = connections.find((item) => item.id === selectedId) ?? connections[0]

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
            <div className="space-y-1.5"><Label htmlFor="connection-url">Kanonische HTTPS-Adresse</Label><Input id="connection-url" value={url} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://t3.home.arpa/mcp" autoComplete="url" /></div>
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
            <Button variant="outline" size="sm" disabled={projectsQuery.isFetching} onClick={() => void projectsQuery.refetch()}><RefreshCw className={projectsQuery.isFetching ? 'animate-spin' : ''} />Projekte laden</Button>
            {projectsQuery.isError && <p className="text-sm text-muted-foreground">{formatError(projectsQuery.error)}</p>}
            {(projectsQuery.data?.items ?? []).map((project) => <div key={project.external_project_id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{project.title}</p><p className="text-xs text-muted-foreground">{project.workspace_label ?? 'T3-Projekt'} · {project.external_project_id}</p></div><Badge variant="outline">Referenz</Badge></div>)}
            {projectsQuery.data?.items.length === 0 && <p className="py-3 text-sm text-muted-foreground">Für diese Verbindung wurden keine T3-Projekte gemeldet.</p>}
          </CardContent>
        </Card>
      </section>}
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
