import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Blocks, Download, Pause, Play, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const stateLabels: Record<string, string> = {
  discovered: 'Gefunden', installed_disabled: 'Installiert · deaktiviert', enabling: 'Wird aktiviert', enabled: 'Aktiv',
  draining: 'Lässt aktive Arbeit auslaufen', disabled: 'Deaktiviert', uninstall_pending: 'Entfernung vorgemerkt', removed: 'Entfernt', failed: 'Fehler',
}

export default function PluginsView() {
  const client = useQueryClient()
  const pluginsQuery = useQuery({ queryKey: ['plugins'], queryFn: () => request(api.GET('/plugins', { params: { query: { limit: 100 } } })) })
  const projectsQuery = useProjects()
  const [selectedId, setSelectedId] = useState('')
  const [enabledLabelsText, setEnabledLabelsText] = useState('')
  const [newPluginId, setNewPluginId] = useState('')
  const [newVersion, setNewVersion] = useState('')
  const [installSource, setInstallSource] = useState<'registry' | 'local_build'>('local_build')
  const plugins = pluginsQuery.data?.items ?? []
  const plugin = plugins.find((item) => item.id === selectedId) ?? plugins[0]
  const configurationQuery = useQuery({
    queryKey: ['plugin-configuration', plugin?.id],
    enabled: Boolean(plugin),
    queryFn: () => request(api.GET('/plugins/{plugin_id}/config', { params: { path: { plugin_id: plugin!.id } } })),
  })
  const plansQuery = useQuery({ queryKey: ['plugin-install-plans'], queryFn: () => request(api.GET('/plugin-install-plans', { params: { query: { limit: 100 } } })), retry: false })

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['plugins'] }),
    client.invalidateQueries({ queryKey: ['plugin-configuration'] }),
    client.invalidateQueries({ queryKey: ['plugin-install-plans'] }),
    client.invalidateQueries({ queryKey: ['link-notes'] }),
  ])

  const activate = useMutation({
    mutationFn: () => request(api.POST('/plugins/{plugin_id}/activate', {
      params: { path: { plugin_id: plugin!.id }, ...mutationParams(plugin!.version) },
      body: { acknowledged_contract_version: plugin!.contract_version },
    })),
    onSuccess: async () => { await refresh(); toast.success('Aktivierung angenommen') },
    onError: (error) => toast.error(formatError(error)),
  })
  const drain = useMutation({
    mutationFn: () => request(api.POST('/plugins/{plugin_id}/drain', {
      params: { path: { plugin_id: plugin!.id }, ...mutationParams(plugin!.version) },
      body: { policy: 'finish_active', reason: 'Plugin über die Administration deaktivieren.' },
    })),
    onSuccess: async () => { await refresh(); toast.success('Deaktivierung wartet auf den Abschluss aktiver Arbeit') },
    onError: (error) => toast.error(formatError(error)),
  })
  const deactivate = useMutation({
    mutationFn: () => request(api.POST('/plugins/{plugin_id}/deactivate', {
      params: { path: { plugin_id: plugin!.id }, ...mutationParams(plugin!.version) },
      body: { reason: 'Plugin über die Administration deaktivieren.' },
    })),
    onSuccess: async () => { await refresh(); toast.success('Plugin deaktiviert') },
    onError: (error) => toast.error(formatError(error)),
  })
  const saveConfiguration = useMutation({
    mutationFn: () => request(api.PUT('/plugins/{plugin_id}/config', {
      params: { path: { plugin_id: plugin!.id }, ...mutationParams(plugin!.version) },
      body: {
        schema_id: configurationQuery.data!.schema_id,
        values: { enabled_labels: enabledLabelsText.split(',').map((value) => value.trim()).filter(Boolean) },
      },
    })),
    onSuccess: async () => { await refresh(); toast.success('Plugin-Einstellungen gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })
  const createPlan = useMutation({
    mutationFn: () => request(api.POST('/plugin-install-plans', {
      params: mutationParams(),
      body: { plugin_id: newPluginId.trim(), target_version: newVersion.trim(), source: installSource },
    })),
    onSuccess: async () => { setNewPluginId(''); setNewVersion(''); await refresh(); toast.success('Installationsplan erstellt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const labelIds = useMemo(() => configurationQuery.data?.values.enabled_labels ?? [], [configurationQuery.data])
  if (pluginsQuery.isPending || projectsQuery.isPending) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  if (pluginsQuery.isError || projectsQuery.isError) {
    const error = pluginsQuery.error ?? projectsQuery.error
    return <Card><CardContent className="p-6"><h2 className="font-semibold">Plugins konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(error)}</p><Button variant="outline" className="mt-4" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>
  }

  const installedPlans = plansQuery.data?.items ?? []
  const anyMutationPending = activate.isPending || drain.isPending || deactivate.isPending || saveConfiguration.isPending
  const actionAllowed = (action: string) => plugin?.allowed_actions.some((item) => item.action === action && item.enabled) ?? false

  return (
    <main className="space-y-6">
      <header><p className="text-sm text-muted-foreground">Vorinstallierte Fähigkeiten und lokale Daten</p><h1 className="text-2xl font-semibold tracking-tight">Erweiterungen</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Ein geprüftes App-Image liefert den Code. Aktivierung, Berechtigungen und Nutzung werden hier gesteuert; vorhandene Notizen bleiben nach der Deaktivierung erhalten.</p></header>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Blocks className="size-4 text-muted-foreground" />Installierte Erweiterungen</CardTitle></CardHeader><CardContent className="space-y-3">
          {plugins.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-4 text-left hover:bg-muted/40 ${plugin?.id === item.id ? 'border-primary/50 bg-muted/30' : ''}`}>
            <div className="flex items-center justify-between gap-3"><p className="font-medium">{item.name}</p><Badge variant={item.state === 'enabled' ? 'secondary' : 'outline'}>{stateLabels[item.state] ?? item.state}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.id} · v{item.installed_version}</p><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
          </button>)}
          {plugins.length === 0 && <p className="py-4 text-sm text-muted-foreground">Keine Erweiterungen im App-Image registriert.</p>}
        </CardContent></Card>

        {plugin && <Card><CardHeader><CardTitle>{plugin.name}</CardTitle></CardHeader><CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2"><Badge variant="outline">Vertrag {plugin.contract_version}</Badge>{plugin.capabilities.map((capability) => <Badge key={capability} variant="secondary">{capability}</Badge>)}</div>
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Aktive Aufträge" value={plugin.active_run_count} /><Metric label="Wartende Arbeit" value={plugin.pending_job_count} /><Metric label="Behaltene Daten" value={`${plugin.retained_data_bytes.toLocaleString()} Byte`} /></div>
          {plugin.last_error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">{plugin.last_error}</div>}
          <div className="flex flex-wrap gap-2">
            {actionAllowed('activate') && <Button disabled={anyMutationPending} onClick={() => activate.mutate()}><Play />Aktivieren</Button>}
            {actionAllowed('drain') && plugin.state === 'enabled' && <Button variant="outline" disabled={anyMutationPending} onClick={() => drain.mutate()}><Pause />Drain starten</Button>}
            {plugin.state === 'draining' && <>
              <p className="basis-full text-sm text-muted-foreground">Aktive Arbeit wird abgeschlossen. Danach kannst du die Erweiterung deaktivieren.</p>
              <Button variant="outline" disabled={pluginsQuery.isFetching} onClick={() => void pluginsQuery.refetch()}><RefreshCw />Status aktualisieren</Button>
            </>}
            {actionAllowed('deactivate') && <Button variant="outline" disabled={anyMutationPending} onClick={() => deactivate.mutate()}>Deaktivieren</Button>}
          </div>

          {plugin.id === 'falkenwarte.link-notes' && <section className="space-y-3 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="size-4" />Linknotizen-Einstellungen</h3>
            {configurationQuery.isError && <p className="text-sm text-muted-foreground">{formatError(configurationQuery.error)}</p>}
            {configurationQuery.isPending ? <Skeleton className="h-14" /> : configurationQuery.data && <>
              <div className="space-y-1.5"><Label htmlFor="enabled-link-note-labels">Nur für diese Label-IDs <span className="font-normal text-muted-foreground">(optional, kommasepariert)</span></Label><Input id="enabled-link-note-labels" value={enabledLabelsText || labelIds.join(', ')} onChange={(event) => setEnabledLabelsText(event.target.value)} placeholder="Leer lassen für alle Tickets" /></div>
              <p className="text-xs text-muted-foreground">Die Erweiterung speichert nur lokale Notizen zu vorhandenen Ticketlinks. URLs werden nicht abgerufen.</p>
              <Button variant="outline" size="sm" disabled={!configurationQuery.data || saveConfiguration.isPending} onClick={() => saveConfiguration.mutate()}><ShieldCheck />Einstellungen speichern</Button>
            </>}
          </section>}
        </CardContent></Card>}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Download className="size-4 text-muted-foreground" />Installationsplan prüfen</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="install-plugin-id">Paket-ID</Label><Input id="install-plugin-id" value={newPluginId} onChange={(event) => setNewPluginId(event.target.value)} placeholder="vendor.plugin-name" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="install-version">Zielversion</Label><Input id="install-version" value={newVersion} onChange={(event) => setNewVersion(event.target.value)} placeholder="1.0.0" /></div><div className="space-y-1.5"><Label>Quelle</Label><Select value={installSource} onValueChange={(value) => setInstallSource(value as typeof installSource)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local_build">Lokaler Build</SelectItem><SelectItem value="registry">Registry</SelectItem></SelectContent></Select></div></div>
          <p className="text-xs text-muted-foreground">Der Plan dokumentiert die nötigen Schritte. Er installiert kein Paket und führt keine Shell- oder Containeraktion aus.</p>
          <Button variant="outline" disabled={!newPluginId.trim() || !newVersion.trim() || createPlan.isPending} onClick={() => createPlan.mutate()}>Plan erstellen</Button>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Geplante Installationen</CardTitle></CardHeader><CardContent className="space-y-3">
          {installedPlans.map((plan) => <article key={plan.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{plan.plugin_id} · {plan.target_version}</p><Badge variant="outline">{plan.status === 'prepared' ? 'Zur Prüfung bereit' : 'Blockiert'}</Badge></div><ol className="mt-3 space-y-1.5">{plan.steps.map((step, index) => <li key={`${plan.id}-${step.kind}`} className="flex gap-2 text-sm"><span className="text-muted-foreground">{index + 1}.</span><span>{step.description}</span></li>)}</ol>{plan.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-muted-foreground">{warning}</p>)}</article>)}
          {installedPlans.length === 0 && <p className="py-3 text-sm text-muted-foreground">Es wurden noch keine Installationspläne erstellt.</p>}
        </CardContent></Card>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>
}
