import { Activity, AlertCircle, ArrowUpRight, CheckCheck, CircleDot, FolderKanban, Play } from 'lucide-react'
import { useDashboard } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatError } from '@/lib/api'

const attentionLabels: Record<string, string> = {
  question: 'Rückfrage', approval: 'Freigabe', failure: 'Fehler', auth: 'Verbindung',
  reconciliation: 'Abgleich', plugin_drain: 'Plugin', classification: 'Einordnung', intake_information: 'Agent gefragt',
}

const runLabels: Record<string, string> = {
  queued: 'Wartet', dispatching: 'Startet', running: 'Läuft', waiting_for_input: 'Rückfrage',
  auth_required: 'Zugang benötigt', reconciliation_required: 'Abgleich nötig', cancelling: 'Wird beendet',
}

export default function DashboardView() {
  const query = useDashboard()
  if (query.isPending) return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
  if (query.isError) return <Card><CardContent className="p-6"><h2 className="font-semibold">Übersicht konnte nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(query.error)}</p><Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>Erneut laden</Button></CardContent></Card>

  const dashboard = query.data
  const openTasks = dashboard.projects.reduce((count, project) => count + project.open_tasks, 0)
  const metric = (key: string) => dashboard.metrics.find((item) => item.key === key)?.value
  const attentionCount = dashboard.attention.filter((item) => item.kind !== 'intake_information').length
  const requesterCount = dashboard.attention.filter((item) => item.kind === 'intake_information').length

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-muted-foreground">Falkenwarte</p><h1 className="text-2xl font-semibold tracking-tight">Übersicht</h1></div>
        <p className="text-xs text-muted-foreground">Datenstand {new Date(dashboard.data_through).toLocaleString()}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Arbeitsstand">
        <SummaryCard icon={<FolderKanban />} label="Projekte" value={dashboard.projects.length} detail="Aktive Projektbereiche" />
        <SummaryCard icon={<CircleDot />} label="Offene Tickets" value={metric('open_tasks') ?? openTasks} detail="Über alle erreichbaren Projekte" />
        <SummaryCard icon={<AlertCircle />} label="Mensch erforderlich" value={attentionCount} detail={requesterCount ? `${requesterCount} Rückfragen an Agents` : 'Keine offenen Agent-Rückfragen'} />
        <SummaryCard icon={<Play />} label="T3-Aufträge" value={dashboard.active_runs.length} detail="Laufend oder in Klärung" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4"><CardTitle className="flex items-center gap-2"><FolderKanban className="size-4 text-muted-foreground" />Projekte</CardTitle>{dashboard.projects.length > 0 && <a className="text-xs text-primary hover:underline" href="#/projects">Alle öffnen <ArrowUpRight className="inline size-3" /></a>}</CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {dashboard.projects.map((project) => <a key={project.id} href={`#/project/${project.id}/board`} className="group rounded-xl border p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg text-white" style={{ backgroundColor: project.color }}><FolderKanban className="size-4" /></span><div className="min-w-0"><h3 className="truncate font-medium">{project.name}</h3><p className="text-xs text-muted-foreground">/{project.slug}</p></div></div>
              <div className="mt-4 flex gap-4 text-sm"><span><strong>{project.open_tasks}</strong> offen</span><span><strong>{project.active_runs}</strong> T3-Aufträge</span></div>
            </a>)}
            {dashboard.projects.length === 0 && <div className="space-y-3"><p className="text-sm text-muted-foreground">Lege ein Projekt an, um Aufgaben zu organisieren.</p><Button size="sm" asChild><a href="#/projects">Projekt anlegen</a></Button></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="size-4 text-muted-foreground" />Offene Entscheidungen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.attention.slice(0, 8).map((item) => <div key={`${item.resource.resource_type}-${item.resource.id}-${item.kind}`} className="flex items-start gap-3 border-b pb-3 last:border-0 last:pb-0">
              <span className="mt-1 size-2 rounded-full bg-amber-500" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.title}</p><Badge variant="secondary">{attentionLabels[item.kind] ?? item.kind}</Badge></div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.detail}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.since).toLocaleString()}</p></div>
            </div>)}
            {dashboard.attention.length === 0 && <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground"><CheckCheck className="size-5 text-emerald-600" />Keine offenen Entscheidungen</div>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Play className="size-4 text-muted-foreground" />Aktive T3-Aufträge</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.active_runs.slice(0, 8).map((run) => <a key={run.id} href={`#/project/${run.project_id}/board?task=${run.task_id}`} className="flex items-center justify-between gap-4 rounded-lg border p-3 hover:bg-muted/40">
              <div className="min-w-0"><p className="truncate font-medium">{run.task_key ? `${run.task_key} · ` : ''}{run.title}</p><p className="mt-1 text-xs text-muted-foreground">{run.agent_profile_name}{run.stage ? ` · ${run.stage}` : ''}</p></div><Badge variant={run.state === 'running' ? 'default' : 'secondary'}>{runLabels[run.state] ?? run.state}</Badge>
            </a>)}
            {dashboard.active_runs.length === 0 && <p className="py-4 text-sm text-muted-foreground">Derzeit laufen keine Agentaufträge.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-muted-foreground" />Letzte Änderungen</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.activity.slice(0, 10).map((item) => <div key={item.id} className="flex gap-3 border-b pb-3 last:border-0 last:pb-0">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" /><div className="min-w-0"><p className="text-sm">{item.summary}</p><p className="mt-1 text-xs text-muted-foreground">{item.actor.display_name ?? (item.actor.kind === 'owner' ? 'Eigentümer' : item.actor.kind)} · {new Date(item.occurred_at).toLocaleString()}</p></div>
            </div>)}
            {dashboard.activity.length === 0 && <p className="py-4 text-sm text-muted-foreground">Änderungen werden hier angezeigt.</p>}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function SummaryCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) {
  return <Card><CardContent className="p-4"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><span className="text-muted-foreground">{icon}</span></div><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}
