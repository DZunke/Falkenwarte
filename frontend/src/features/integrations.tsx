import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Cable, CircleCheck, CircleHelp, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const healthLabels: Record<string, string> = { unconfigured: 'Noch nicht verbunden', ready: 'Bereit', degraded: 'Eingeschränkt', unreachable: 'Nicht erreichbar', incompatible: 'Protokoll prüfen' }
const authLabels: Record<string, string> = { missing: 'Autorisierung fehlt', pending: 'Autorisierung läuft', valid: 'Autorisiert', expiring: 'Zugang läuft ab', expired: 'Zugang abgelaufen', revoked: 'Widerrufen' }

export default function IntegrationsView() {
  const client = useQueryClient()
  const connectionsQuery = useQuery({ queryKey: ['connections'], queryFn: () => request(api.GET('/connections', { params: { query: { limit: 100 } } })) })
  const [name, setName] = useState('T3 Code')
  const [url, setUrl] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
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
    onSuccess: async () => { await refresh(); toast.success('Verbindungstest angenommen') },
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
      <header><p className="text-sm text-muted-foreground">Externe Ausführung</p><h1 className="text-2xl font-semibold tracking-tight">T3-Verbindung</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Falkenwarte verwaltet die Verbindung und Rollenreferenzen. Ausführungsziele, Modelle und Provider bleiben in T3.</p></header>

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
              <Button disabled={checkConnection.isPending} onClick={() => checkConnection.mutate(selected)}><RefreshCw className={checkConnection.isPending ? 'animate-spin' : ''} />Verbindung testen</Button>
              <Button variant="outline" disabled={authorize.isPending || selected.auth_status === 'valid'} onClick={() => authorize.mutate(selected)}>Bei T3 anmelden <ArrowUpRight /></Button>
            </div>
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
