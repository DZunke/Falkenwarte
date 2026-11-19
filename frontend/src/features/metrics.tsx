import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const metricLabels: Record<string, string> = {
  open_tasks: 'Offene Tickets', throughput: 'Abgeschlossene Tickets', active_runs: 'Laufende T3-Aufträge',
  human_attention: 'Menschliche Entscheidungen', waiting_for_requester: 'Rückfragen an Agents',
  intake_ready: 'Eingänge eingeordnet', intake_needs_information: 'Eingänge mit Rückfrage',
  classification_records: 'Angewandte Einordnungen', routing_corrections: 'Korrigierte Routen',
  run_success_rate: 'Erfolgreich gemeldete Runs', lead_time_seconds: 'Lead-Time bis Abschluss',
  cycle_time_seconds: 'Cycle-Time ab Arbeitsbeginn',
}

const provenanceLabels: Record<string, string> = {
  provider_reported: 'Vom Anbieter gemeldet', locally_observed: 'Lokal beobachtet', derived: 'Abgeleitet', manual: 'Manuell erfasst',
}

const qualityLabels: Record<string, string> = { measured: 'Gemessen', estimated: 'Geschätzt', unavailable: 'Keine Daten' }

function dateInput(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function toDateTime(date: string, end = false) {
  const boundary = new Date(`${date}T00:00:00`)
  if (end) boundary.setDate(boundary.getDate() + 1)
  return boundary.toISOString()
}

export default function MetricsView() {
  const queryClient = useQueryClient()
  const projectsQuery = useProjects()
  const now = new Date()
  const [projectId, setProjectId] = useState('all')
  const [from, setFrom] = useState(() => { const date = new Date(now); date.setDate(date.getDate() - 30); return dateInput(date) })
  const [to, setTo] = useState(() => dateInput(now))
  const [grain, setGrain] = useState<'day' | 'week' | 'month' | 'total'>('day')
  const query = useQuery({
    queryKey: ['metrics', projectId, from, to, grain],
    enabled: Boolean(from && to),
    queryFn: () => request(api.GET('/metrics', {
      params: { query: {
        ...(projectId === 'all' ? {} : { project_id: projectId }),
        from: toDateTime(from),
        to: toDateTime(to, true),
        grain,
      } },
    })),
  })

  const rebuild = useMutation({
    mutationFn: () => request(api.POST('/metrics/rebuild', { params: mutationParams() })),
    onSuccess: async () => { toast.success('Neuberechnung angenommen'); await queryClient.invalidateQueries({ queryKey: ['metrics'] }) },
    onError: (error) => toast.error(formatError(error)),
  })

  const series = query.data?.series ?? []
  const throughput = series.map((point) => point.metrics.find((metric) => metric.key === 'throughput')?.value ?? 0)
  const maxThroughput = Math.max(1, ...throughput.map((value) => value ?? 0))

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-muted-foreground">Arbeitsstand und Quellen</p><h1 className="text-2xl font-semibold tracking-tight">Metriken</h1></div>
        <Button variant="outline" disabled={rebuild.isPending} onClick={() => rebuild.mutate()}><RefreshCw className={rebuild.isPending ? 'animate-spin' : ''} />Projektion neu aufbauen</Button>
      </header>

      <Card><CardContent className="grid gap-4 p-4 md:grid-cols-[1.3fr_1fr_1fr_0.8fr] md:items-end">
        <label className="space-y-1.5 text-sm"><span className="font-medium">Projekt</span><Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle erreichbaren Projekte</SelectItem>{(projectsQuery.data?.items ?? []).map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5 text-sm"><span className="font-medium">Von</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" /></label>
        <label className="space-y-1.5 text-sm"><span className="font-medium">Bis</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" /></label>
        <label className="space-y-1.5 text-sm"><span className="font-medium">Darstellung</span><Select value={grain} onValueChange={(value) => setGrain(value as typeof grain)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">Täglich</SelectItem><SelectItem value="week">Wöchentlich</SelectItem><SelectItem value="month">Monatlich</SelectItem><SelectItem value="total">Gesamt</SelectItem></SelectContent></Select></label>
      </CardContent></Card>

      {query.isPending ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div> : query.isError ? <Card><CardContent className="p-6"><h2 className="font-semibold">Metriken konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(query.error)}</p><Button variant="outline" className="mt-4" onClick={() => void query.refetch()}>Erneut laden</Button></CardContent></Card> : <>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {query.data.values.slice(0, 8).map((metric) => <Card key={metric.key}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{metricLabels[metric.key] ?? metric.label}</p><p className="mt-3 text-2xl font-semibold">{formatValue(metric.value, metric.unit)}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{qualityLabels[metric.quality]}</Badge><span className="text-xs text-muted-foreground">Stichprobe {metric.sample_size}</span></div>{metric.reason && <p className="mt-2 text-xs text-muted-foreground">{metric.reason}</p>}</CardContent></Card>)}
        </section>

        {query.data.series.length > 0 && <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" />Abschlüsse und Einordnungen</CardTitle></CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1 border-b border-l px-2 pb-0">
              {series.map((point, index) => {
                const completed = throughput[index] ?? 0
                const height = Math.max(completed ? 8 : 2, Math.round((completed / maxThroughput) * 100))
                return <div key={point.period_start} className="group relative flex h-full min-w-1 flex-1 items-end justify-center" title={`${new Date(point.period_start).toLocaleDateString()} · ${completed ?? 0} Abschlüsse`}><span className="w-full max-w-7 rounded-t-sm bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${height}%` }} /></div>
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{new Date(series[0].period_start).toLocaleDateString()}</span><span>{new Date(series.at(-1)!.period_end).toLocaleDateString()}</span></div>
            {query.data.warnings.map((warning) => <p key={warning} className="mt-3 text-xs text-muted-foreground">{warning}</p>)}
          </CardContent>
        </Card>}

        <Card>
          <CardHeader><CardTitle>Definition und Herkunft</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="pb-2 font-medium">Kennzahl</th><th className="pb-2 font-medium">Wert</th><th className="pb-2 font-medium">Quelle</th><th className="pb-2 font-medium">Qualität</th><th className="pb-2 text-right font-medium">Stichprobe</th></tr></thead><tbody>{query.data.values.map((metric) => <tr key={metric.key} className="border-b last:border-0"><td className="py-3 font-medium">{metricLabels[metric.key] ?? metric.label}</td><td className="py-3">{formatValue(metric.value, metric.unit)}</td><td className="py-3 text-muted-foreground">{provenanceLabels[metric.provenance]}</td><td className="py-3"><Badge variant={metric.quality === 'unavailable' ? 'outline' : 'secondary'}>{qualityLabels[metric.quality]}</Badge></td><td className="py-3 text-right tabular-nums">{metric.sample_size}</td></tr>)}</tbody></table>
            <p className="mt-4 text-xs text-muted-foreground">Zeitraum {new Date(query.data.from).toLocaleDateString()} – {new Date(query.data.to).toLocaleDateString()} · Datenstand {new Date(query.data.data_through).toLocaleString()} · {query.data.excluded_records} Ereignisse ohne Zeitstempel ausgeschlossen</p>
          </CardContent>
        </Card>
      </>}
    </main>
  )
}

function formatValue(value: number | null, unit: string) {
  if (value === null) return 'Noch keine Daten'
  if (unit === 'ratio') return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`
  if (unit === 'seconds') {
    const hours = Math.round(value / 3600)
    if (hours >= 24) return `${(hours / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} Tage`
    return `${hours.toLocaleString()} Std.`
  }
  return value.toLocaleString()
}
