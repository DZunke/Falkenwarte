import { useState, type ReactNode } from 'react'
import { Activity, ArrowRight, CheckCheck, ChevronRight, CircleAlert, FolderKanban, MessagesSquare, Play, Plus } from 'lucide-react'
import { useDashboard, useProjects } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import ProjectIcon from '@/components/ProjectIcon'
import { formatError } from '@/lib/api'
import type { components } from '@/generated/api'

type AttentionItem = components['schemas']['AttentionItem']

const runLabels: Record<string, string> = {
  queued: 'Wartet', dispatching: 'Startet', running: 'Läuft', waiting_input: 'Wartet auf Antwort',
  auth_blocked: 'Zugang benötigt', reconciling: 'Im Abgleich', cancel_requested: 'Abbruch angefragt',
  result_reported: 'Ergebnis gemeldet', verifying: 'In Prüfung',
}
const time = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Section({ title, icon, link, children }: { title: string; icon: ReactNode; link?: ReactNode; children: ReactNode }) {
  return <Card className="gap-0 py-0">
    <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3.5">
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>{link}
    </CardHeader>
    <CardContent className="divide-y px-4">{children}</CardContent>
  </Card>
}

function AttentionList({ items, empty }: { items: AttentionItem[]; empty: string }) {
  if (!items.length) return <p className="flex gap-2 py-4 text-sm text-muted-foreground"><CheckCheck className="size-4 text-primary" />{empty}</p>
  return items.map((item) => {
    const href = item.task_id && item.project_id ? `#/project/${item.project_id}/board?task=${item.task_id}` : item.resource.resource_type === 'plugin' ? '#/plugins' : item.resource.resource_type === 'connection' ? '#/integrations' : undefined
    return <div key={`${item.resource.id}/${item.kind}/${item.title}`} className="py-3">
      {item.task_key && <p className="mb-1 text-xs text-muted-foreground">{item.task_key}</p>}
      {href ? <a href={href} className="font-medium hover:text-primary hover:underline">{item.task_title ?? item.title}</a> : <p className="font-medium">{item.title}</p>}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.task_title ? `${item.title} · ` : ''}{item.detail}</p>
    </div>
  })
}

export default function DashboardView() {
  const query = useDashboard()
  const projectsQuery = useProjects()
  const [chooseProject, setChooseProject] = useState(false)
  if (query.isPending || projectsQuery.isPending) return <Skeleton aria-label="Übersicht wird geladen" className="h-32" />
  if (query.isError || projectsQuery.isError) return <Card><CardContent><h2 className="font-semibold">Übersicht konnte nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(query.error ?? projectsQuery.error)}</p><Button className="mt-4" variant="outline" onClick={() => { void query.refetch(); void projectsQuery.refetch() }}>Erneut laden</Button></CardContent></Card>
  const dashboard = query.data
  const projects = projectsQuery.data.items.filter((project) => !project.archived)
  const metric = (key: string) => dashboard.metrics.find((item) => item.key === key)?.value ?? '–'
  const requester = dashboard.attention.filter((item) => item.kind === 'intake_information')
  const operational = dashboard.attention.filter((item) => ['connection', 'plugin'].includes(item.resource.resource_type))
  const owner = dashboard.attention.filter((item) => item.kind !== 'intake_information' && ['task', 'approval'].includes(item.resource.resource_type))
  const newTicket = (id: string) => `#/project/${id}/board?new=1`

  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Übersicht</h1><p className="mt-1 text-sm text-muted-foreground">Offene Entscheidungen und laufende Aufträge.</p></div>
      {projects.length > 1 ? <Button onClick={() => setChooseProject(true)}><Plus />Neues Ticket</Button> : <Button asChild><a href={projects.length ? newTicket(projects[0].id) : '#/projects'}><Plus />{projects.length ? 'Neues Ticket' : 'Projekt anlegen'}</a></Button>}
    </header>
    <dl aria-label="Arbeitsstand" className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card sm:grid-cols-4 sm:divide-y-0">
      {[['Offene Tickets', 'open_tasks'], ['Mensch erforderlich', 'human_attention'], ['Aktive T3-Aufträge', 'active_runs'], ['Rückfragen an Agents', 'waiting_for_requester']].map(([title, key]) => <div className="min-w-0 px-4 py-3 sm:px-5" key={key}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{metric(key)}</dd></div>)}
    </dl>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Section title="Projekte" icon={<FolderKanban className="size-4 text-primary" />} link={<a href="#/projects" className="flex items-center gap-1 text-xs text-primary hover:underline">Alle Projekte <ArrowRight className="size-3" /></a>}>
          {projects.slice(0, 5).map((project) => <a href={`#/project/${project.id}/board`} key={project.id} className="group flex items-center gap-3 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border" style={{ color: project.color, backgroundColor: `${project.color}14`, borderColor: `${project.color}40` }}><ProjectIcon iconKey={project.icon_key} className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium group-hover:text-primary">{project.name}</p>{project.description && <p className="truncate text-xs text-muted-foreground">{project.description}</p>}</div>
            <span className="text-xs text-muted-foreground">{project.open_task_count} offen</span><ChevronRight className="size-4 text-muted-foreground" />
          </a>)}
          {!projects.length && <p className="py-4 text-sm text-muted-foreground">Lege ein Projekt an, um dein erstes Ticket zu erfassen.</p>}
        </Section>
        <Section title="Aktive T3-Aufträge" icon={<Play className="size-4 text-primary" />}>
          {dashboard.active_runs.map((run) => <a key={run.id} href={`#/project/${run.project_id}/board?task=${run.task_id}`} className="flex items-center justify-between gap-3 py-3 hover:text-primary">
            <div className="min-w-0"><p className="truncate font-medium">{run.title}</p><p className="mt-1 text-xs text-muted-foreground">{[run.task_key, run.agent_profile_name, run.stage].filter(Boolean).join(' · ')}</p></div><Badge variant="secondary">{runLabels[run.state] ?? run.state}</Badge>
          </a>)}
          {!dashboard.active_runs.length && <p className="py-4 text-sm text-muted-foreground">Derzeit laufen keine T3-Aufträge.</p>}
        </Section>
        <Section title="Letzte Änderungen" icon={<Activity className="size-4 text-primary" />}>
          {dashboard.activity.slice(0, 5).map((item) => <div key={item.id} className="py-2.5"><p className="text-sm">{item.summary}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.actor.display_name ?? (item.actor.kind === 'owner' ? 'Eigentümer' : item.actor.kind)} · {time.format(new Date(item.occurred_at))}</p></div>)}
          {!dashboard.activity.length && <p className="py-4 text-sm text-muted-foreground">Bisher wurden keine Änderungen erfasst.</p>}
        </Section>
      </div>
      <div className="space-y-5">
        <Section title="Offene Entscheidungen" icon={<CircleAlert className="size-4 text-amber-600" />}><AttentionList items={owner} empty="Keine offenen Entscheidungen" /></Section>
        <Section title="Rückfragen an Agents" icon={<MessagesSquare className="size-4 text-primary" />}><AttentionList items={requester} empty="Keine offenen Rückfragen an Agents" /></Section>
        {operational.length > 0 && <Section title="Betrieb" icon={<Activity className="size-4 text-primary" />}><AttentionList items={operational} empty="" /></Section>}
      </div>
    </div>
    <p className="text-xs text-muted-foreground">Datenstand {time.format(new Date(dashboard.data_through))}</p>
    <Dialog open={chooseProject} onOpenChange={setChooseProject}><DialogContent><DialogHeader><DialogTitle>Projekt für das neue Ticket</DialogTitle><DialogDescription>In welchem Projekt möchtest du das Ticket anlegen?</DialogDescription></DialogHeader>
      <div className="max-h-[55vh] divide-y overflow-y-auto">{projects.map((project) => <a key={project.id} href={newTicket(project.id)} className="flex items-center gap-3 py-2.5 hover:text-primary"><span style={{ color: project.color }}><ProjectIcon iconKey={project.icon_key} /></span>{project.name}<ChevronRight className="ml-auto size-4" /></a>)}</div>
    </DialogContent></Dialog>
  </div>
}
