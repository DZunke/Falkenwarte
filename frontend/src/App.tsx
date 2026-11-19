import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity, ArrowUpRight, Archive, BookOpen, Check, Command, FolderKanban, Layers3,
  LayoutDashboard, LogOut, Menu, Moon, Search, Settings, Shield, Sun, Tags, Workflow, X,
} from 'lucide-react'
import { api, formatError, mutationParams, request, setCsrfToken, type Project, type Session } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { useLive } from '@/lib/use-live'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import ProjectBoard from '@/components/ProjectBoard'
import ProjectIcon from '@/components/ProjectIcon'

const DashboardView = lazy(() => import('@/features/dashboard'))
const IntegrationsView = lazy(() => import('@/features/integrations'))
const RolesView = lazy(() => import('@/features/roles'))
const WorkflowsView = lazy(() => import('@/features/workflows'))
const PluginsView = lazy(() => import('@/features/plugins'))
const SettingsView = lazy(() => import('@/features/settings'))
const MetricsView = lazy(() => import('@/features/metrics'))
const LabelsView = lazy(() => import('@/features/labels'))
const DocsView = lazy(() => import('@/features/docs'))

type Route = { page: string; projectId?: string; taskId?: string; createTask?: boolean; docPath?: string }

function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'project' && parts[1]) {
    const query = new URLSearchParams(parts[2]?.split('?')[1] ?? '')
    return { page: 'project', projectId: parts[1], taskId: query.get('task') ?? undefined, createTask: query.get('new') === '1' }
  }
  if (parts[0] === 'docs') return { page: 'docs', docPath: parts.slice(1).join('/') }
  return { page: parts[0] || 'dashboard' }
}

function go(path: string) {
  window.location.hash = `#/${path.replace(/^\/+/, '')}`
}

export default function App() {
  const queryClient = useQueryClient()
  const bootstrapQuery = useQuery({ queryKey: ['bootstrap'], queryFn: () => request(api.GET('/bootstrap', {})), staleTime: 60_000 })
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const session = await request(api.GET('/session', {}))
      setCsrfToken(session.csrf_token)
      return session
    },
    retry: false,
  })
  const liveStatus = useLive(sessionQuery.data?.authenticated === true)
  const [route, setRoute] = useState(readRoute)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('falkenwarte-theme') === 'dark')
  const projectsQuery = useProjects()
  const projects = projectsQuery.data?.items ?? []
  const activeProject = projects.find((project) => project.id === route.projectId)

  useEffect(() => {
    const updateRoute = () => setRoute(readRoute())
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('falkenwarte-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  const logout = useMutation({
    mutationFn: () => request(api.DELETE('/session', {})),
    onSuccess: async () => {
      setCsrfToken(null)
      queryClient.setQueryData(['session'], { authenticated: false, actor: null, owner: null, csrf_token: null, expires_at: null, capabilities: [] })
      await queryClient.invalidateQueries()
      toast.success('Abgemeldet')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  if (bootstrapQuery.isPending || sessionQuery.isPending) return <LoadingScreen />
  if (bootstrapQuery.isError || sessionQuery.isError) return <UnavailableScreen message={formatError(bootstrapQuery.error ?? sessionQuery.error)} onRetry={() => { void bootstrapQuery.refetch(); void sessionQuery.refetch() }} />
  if (!sessionQuery.data?.authenticated) return <AccessScreen setupRequired={bootstrapQuery.data.setup_required} onAuthenticated={(session) => { setCsrfToken(session.csrf_token); queryClient.setQueryData(['session'], session); void queryClient.invalidateQueries() }} />

  const session = sessionQuery.data
  const ownerName = session.owner?.display_name ?? 'Eigentümer'
  const pageTitle = titleFor(route.page, activeProject)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow-lg">Zum Inhalt springen</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r bg-sidebar px-3 py-5 md:flex">
        <Brand />
        <div className="mx-1 mb-5 rounded-lg border bg-card px-3 py-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Arbeitsbereich</p><p className="mt-1 truncate text-sm font-medium">Privat</p></div>
        <Navigation route={route} projects={projects} />
        <div className="mt-auto space-y-1 border-t pt-4">
          <button onClick={() => go('docs')} className={`nav-link ${route.page === 'docs' ? 'nav-link-active' : ''}`}><BookOpen />Dokumentation</button>
          <button onClick={() => go('settings')} className={`nav-link ${route.page === 'settings' ? 'nav-link-active' : ''}`}><Settings />Einstellungen</button>
          <div className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-xs font-semibold text-primary">{initials(ownerName)}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{ownerName}</p><p className="text-[10px] text-muted-foreground">Eigentümer</p></div><Button variant="ghost" size="icon" className="size-8" aria-label="Abmelden" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut /></Button></div>
        </div>
      </aside>

      <div className="md:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenu((open) => !open)} aria-label={mobileMenu ? 'Navigation schließen' : 'Navigation öffnen'}>{mobileMenu ? <X /> : <Menu />}</Button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span>Falkenwarte</span><span>/</span><span className="truncate text-foreground">{pageTitle}</span></div>
            <h1 className="truncate text-sm font-semibold sm:hidden">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-2">
            {liveStatus === 'reconnecting' && <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] text-muted-foreground" onClick={() => { void queryClient.invalidateQueries() }}>Aktuellen Stand laden</Button>}
            <span className={`hidden items-center gap-1.5 rounded-full px-2 py-1 text-[10px] sm:inline-flex ${liveStatus === 'connected' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`} role="status"><span className={`size-1.5 rounded-full ${liveStatus === 'connected' ? 'bg-primary' : liveStatus === 'reconnecting' ? 'animate-pulse bg-amber-500' : 'animate-pulse bg-muted-foreground'}`} />{liveStatus === 'connected' ? 'Live' : liveStatus === 'reconnecting' ? 'Live verbindet erneut' : 'Live verbindet'}</span>
            <Button variant="outline" className="h-9 w-9 px-0 sm:w-56 sm:justify-start sm:px-3" onClick={() => setSearchOpen(true)} aria-label="Suche öffnen"><Search className="size-4" /><span className="hidden flex-1 text-left text-xs text-muted-foreground sm:inline">Tickets und Projekte suchen</span><kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">⌘ K</kbd></Button>
            <Button variant="ghost" size="icon" onClick={() => setDarkMode((current) => !current)} aria-label={darkMode ? 'Hellmodus aktivieren' : 'Dunkelmodus aktivieren'}>{darkMode ? <Sun /> : <Moon />}</Button>
            <span className="hidden size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary sm:flex">{initials(ownerName)}</span>
          </div>
        </header>

        {mobileMenu && <div className="fixed inset-x-0 top-16 z-20 max-h-[calc(100vh-4rem)] overflow-y-auto border-b bg-sidebar px-3 py-4 shadow-lg md:hidden"><Navigation route={route} projects={projects} onNavigate={() => setMobileMenu(false)} /><div className="mt-3 border-t pt-3"><button className="nav-link" onClick={() => { go('docs'); setMobileMenu(false) }}><BookOpen />Dokumentation</button><button className="nav-link" onClick={() => { go('settings'); setMobileMenu(false) }}><Settings />Einstellungen</button></div></div>}

        <main id="main-content" className="mx-auto min-h-[calc(100vh-4rem)] max-w-[1560px] px-4 py-6 md:px-8 md:py-8">
          <AsyncViewBoundary key={route.page}>
          {route.page === 'project' && activeProject ? <ProjectBoard key={activeProject.id} project={activeProject} initialTaskId={route.taskId} initialCreate={route.createTask} onRefreshProject={() => { void queryClient.invalidateQueries({ queryKey: ['projects'] }) }} /> : null}
          {route.page === 'project' && !activeProject && <ProjectMissing projects={projects} onCreate={() => go('projects')} />}
          {route.page === 'projects' && <ProjectsPage projects={projects} loading={projectsQuery.isPending} error={projectsQuery.error} />}
          {route.page === 'dashboard' && <Suspense fallback={<PageSkeleton />}><DashboardView /></Suspense>}
          {route.page === 'labels' && <Suspense fallback={<PageSkeleton />}><LabelsView /></Suspense>}
          {route.page === 'agents' && <Suspense fallback={<PageSkeleton />}><IntegrationsView /></Suspense>}
          {route.page === 'roles' && <Suspense fallback={<PageSkeleton />}><RolesView /></Suspense>}
          {route.page === 'workflows' && <Suspense fallback={<PageSkeleton />}><WorkflowsView /></Suspense>}
          {route.page === 'plugins' && <Suspense fallback={<PageSkeleton />}><PluginsView /></Suspense>}
          {route.page === 'metrics' && <Suspense fallback={<PageSkeleton />}><MetricsView /></Suspense>}
          {route.page === 'settings' && <Suspense fallback={<PageSkeleton />}><SettingsView /></Suspense>}
          {route.page === 'docs' && <Suspense fallback={<PageSkeleton />}><DocsView path={route.docPath ?? ''} navigate={(path) => go(path)} /></Suspense>}
          {!['project', 'projects', 'dashboard', 'labels', 'agents', 'roles', 'workflows', 'plugins', 'metrics', 'settings', 'docs'].includes(route.page) && <ProjectMissing projects={projects} onCreate={() => go('dashboard')} />}
          </AsyncViewBoundary>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} projects={projects} />
    </div>
  )
}

class AsyncViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <Card><CardContent className="p-6"><h1 className="font-semibold">Diese Ansicht konnte nicht geladen werden</h1><p className="mt-2 text-sm text-muted-foreground">Die App-Datei ist möglicherweise veraltet oder die Verbindung wurde unterbrochen. Lade Falkenwarte neu, um den aktuellen Stand zu öffnen.</p><Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Erneut versuchen</Button></CardContent></Card>
    }
    return this.props.children
  }
}

function Brand() {
  return <div className="mb-6 flex items-center gap-2.5 px-2"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m3 5 8 4 10-3-7 8-2 7-3-8-6-8Z"/><path d="m11 9 3 5m-5-1 5 1M15 8l3 1"/></svg></span><span className="text-lg font-semibold tracking-tight">Falkenwarte</span></div>
}

function Navigation({ route, projects, onNavigate }: { route: Route; projects: Project[]; onNavigate?: () => void }) {
  const items = [
    { path: 'dashboard', label: 'Übersicht', Icon: LayoutDashboard },
    { path: 'projects', label: 'Projekte', Icon: FolderKanban },
    { path: 'labels', label: 'Labels', Icon: Tags },
    { path: 'agents', label: 'Agents & T3', Icon: Activity },
    { path: 'workflows', label: 'Workflows', Icon: Workflow },
    { path: 'plugins', label: 'Plugins', Icon: Layers3 },
    { path: 'metrics', label: 'Metriken', Icon: Activity },
  ]
  return <nav aria-label="Hauptnavigation" className="space-y-1">
    {items.map(({ path, label, Icon }) => <button key={path} onClick={() => { go(path); onNavigate?.() }} className={`nav-link ${route.page === path ? 'nav-link-active' : ''}`}><Icon />{label}</button>)}
    {projects.length > 0 && <><p className="px-3 pb-1 pt-6 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Deine Projekte</p>{projects.slice(0, 7).map((project) => <button key={project.id} onClick={() => { go(`project/${project.id}/board`); onNavigate?.() }} className={`nav-link ${route.projectId === project.id ? 'nav-link-active' : ''}`}><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} /><span className="truncate">{project.name}</span>{project.archived && <Badge variant="outline" className="ml-auto px-1 text-[9px]">Archiv</Badge>}</button>)}</>}
  </nav>
}

function AccessScreen({ setupRequired, onAuthenticated }: { setupRequired: boolean; onAuthenticated: (session: Session) => void }) {
  const [setupToken, setSetupToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const setup = useMutation({
    mutationFn: () => request(api.POST('/bootstrap', { body: { setup_token: setupToken, display_name: displayName.trim(), password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } })),
    onSuccess: onAuthenticated,
    onError: (reason) => setError(formatError(reason)),
  })
  const login = useMutation({
    mutationFn: () => request(api.POST('/session', { body: { password } })),
    onSuccess: onAuthenticated,
    onError: (reason) => setError(formatError(reason)),
  })
  return <div className="grid min-h-screen place-items-center bg-[#f1f5f3] px-4 py-10 dark:bg-background">
    <Card className="w-full max-w-md shadow-lg shadow-[#18332b]/5"><CardContent className="p-7 sm:p-9">
      <Brand /><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">{setupRequired ? 'Eigentümerkonto einrichten' : 'Willkommen zurück'}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{setupRequired ? 'Richte deinen privaten Falkenwarte-Zugang ein. Das Setup ist nur einmal möglich.' : 'Melde dich an, um deine Projekte und Tickets zu öffnen.'}</p></div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{error}</p>}
      {setupRequired ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setError(''); setup.mutate() }}>
        <div className="grid gap-2"><Label htmlFor="setup-token">Einmaliger Einrichtungstoken</Label><Input id="setup-token" type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} minLength={32} required /></div>
        <div className="grid gap-2"><Label htmlFor="owner-name">Dein Name</Label><Input id="owner-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required /></div>
        <div className="grid gap-2"><Label htmlFor="owner-password">Passwort</Label><Input id="owner-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /><p className="text-xs text-muted-foreground">Mindestens 12 Zeichen</p></div>
        <Button className="mt-2 w-full" type="submit" disabled={setup.isPending || setupToken.length < 32 || !displayName.trim() || password.length < 12}>{setup.isPending ? 'Wird eingerichtet…' : 'Falkenwarte einrichten'}</Button>
      </form> : <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setError(''); login.mutate() }}>
        <div className="grid gap-2"><Label htmlFor="login-password">Passwort</Label><Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /></div>
        <Button className="mt-2 w-full" type="submit" disabled={login.isPending || !password}>{login.isPending ? 'Anmeldung läuft…' : 'Anmelden'}</Button>
      </form>}
      <div className="mt-6 border-t pt-4 text-xs leading-5 text-muted-foreground">Private Single-User-Anwendung · lokale Sitzung</div>
    </CardContent></Card>
  </div>
}

function ProjectsPage({ projects, loading, error }: { projects: Project[]; loading: boolean; error: unknown }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Project>()
  const [archiveTarget, setArchiveTarget] = useState<Project>()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#176447')
  const [iconKey, setIconKey] = useState('folder-kanban')
  const create = useMutation({
    mutationFn: () => request(api.POST('/projects', {
      params: mutationParams(),
      body: { slug: slug.trim(), name: name.trim(), description: description.trim(), icon_key: iconKey, color, completion_policy: { required_evidence_kinds: [], require_human_approval: false, require_review: false, require_human_confirmed_criteria: true } },
    })),
    onSuccess: async (project) => { setCreateOpen(false); clear(); await queryClient.invalidateQueries({ queryKey: ['projects'] }); go(`project/${project.id}/board`); toast.success('Projekt angelegt') },
    onError: (reason) => toast.error(formatError(reason)),
  })
  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Projekt nicht gefunden.')
      return request(api.PATCH('/projects/{project_id}', { params: { path: { project_id: editing.id }, ...mutationParams(editing.version) }, body: { name: name.trim(), description, color, icon_key: iconKey } }))
    },
    onSuccess: async () => { setEditing(undefined); await queryClient.invalidateQueries({ queryKey: ['projects'] }); toast.success('Projekt gespeichert') },
    onError: (reason) => toast.error(formatError(reason)),
  })
  const archive = useMutation({
    mutationFn: () => {
      if (!archiveTarget) throw new Error('Projekt nicht gefunden.')
      return request(api.POST('/projects/{project_id}/archive', { params: { path: { project_id: archiveTarget.id }, ...mutationParams(archiveTarget.version) }, body: { archived: !archiveTarget.archived, reason: archiveTarget.archived ? 'Projekt durch Eigentümer wiederhergestellt' : 'Projekt durch Eigentümer archiviert' } }))
    },
    onSuccess: async () => { setArchiveTarget(undefined); await queryClient.invalidateQueries({ queryKey: ['projects'] }); toast.success('Projektstatus aktualisiert') },
    onError: (reason) => toast.error(formatError(reason)),
  })
  function clear() { setName(''); setSlug(''); setDescription(''); setColor('#176447'); setIconKey('folder-kanban') }
  function edit(project: Project) { setEditing(project); setName(project.name); setSlug(project.slug); setDescription(project.description); setColor(project.color); setIconKey(project.icon_key) }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Projekte</h1><p className="mt-1 text-sm text-muted-foreground">Tickets, Labels und Abläufe nach Projekten geordnet.</p></div><Button onClick={() => { clear(); setCreateOpen(true) }}><FolderKanban />Projekt anlegen</Button></header>
    {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div> : error ? <Card><CardContent className="p-6"><p role="alert" className="text-sm text-destructive">{formatError(error)}</p></CardContent></Card> : projects.length === 0 ? <Card className="border-dashed"><CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><FolderKanban className="mb-3 size-10 text-muted-foreground" /><h2 className="text-lg font-semibold">Lege dein erstes Projekt an</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Projekte halten Tickets, Status, Labels und Boards zusammen. Du kannst sie vollständig ohne Agenten verwenden.</p><Button className="mt-4" onClick={() => { clear(); setCreateOpen(true) }}>Projekt anlegen</Button></CardContent></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => <Card key={project.id} className="overflow-hidden transition-shadow hover:shadow-md"><div className="h-1" style={{ backgroundColor: project.color }} /><CardContent className="p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: project.color }}><ProjectIcon iconKey={project.icon_key} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{project.name}</h2>{project.archived && <Badge variant="outline">Archiv</Badge>}</div><p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description || 'Keine Projektbeschreibung hinterlegt.'}</p></div></div><div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><span>{project.open_task_count} offene Tickets</span><span>·</span><span>{project.active_run_count} laufende Aufträge</span></div><div className="mt-4 flex gap-2"><Button className="flex-1" variant={project.archived ? 'outline' : 'default'} onClick={() => go(`project/${project.id}/board`)}>{project.archived ? 'Projekt ansehen' : 'Board öffnen'}<ArrowUpRight /></Button><Button variant="outline" size="icon" aria-label={`${project.name} bearbeiten`} onClick={() => edit(project)}><Settings /></Button><Button variant="outline" size="icon" aria-label={project.archived ? `${project.name} wiederherstellen` : `${project.name} archivieren`} onClick={() => setArchiveTarget(project)}><ArchiveIcon archived={project.archived} /></Button></div></CardContent></Card>)}</div>}
    <Dialog open={createOpen || Boolean(editing)} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditing(undefined) } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? 'Projekt bearbeiten' : 'Projekt anlegen'}</DialogTitle><DialogDescription>Projektidentität wird in Listen, Tickets und Boards wiederverwendet.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="project-name">Name</Label><Input id="project-name" autoFocus value={name} onChange={(event) => { setName(event.target.value); if (!editing) setSlug(event.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) }} maxLength={140} /></div><div className="grid gap-2"><Label htmlFor="project-icon">Symbol</Label><Select value={iconKey} onValueChange={setIconKey}><SelectTrigger id="project-icon"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="folder-kanban">Projekt</SelectItem><SelectItem value="book-open">Buch</SelectItem><SelectItem value="code">Code</SelectItem><SelectItem value="globe">Globus</SelectItem><SelectItem value="layers">Ebenen</SelectItem><SelectItem value="shield">Schild</SelectItem><SelectItem value="star">Stern</SelectItem><SelectItem value="workflow">Ablauf</SelectItem></SelectContent></Select></div>{!editing && <div className="grid gap-2"><Label htmlFor="project-slug">Kurzname</Label><Input id="project-slug" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={80} /><p className="text-xs text-muted-foreground">Wird für Ticketkennungen verwendet.</p></div>}<div className="grid gap-2"><Label htmlFor="project-description">Beschreibung</Label><Textarea id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={20000} /></div><div className="grid gap-2"><Label htmlFor="project-color">Farbe</Label><div className="flex items-center gap-3"><Input id="project-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-16 p-1" /><Input aria-label="Hex-Farbwert" value={color} onChange={(event) => setColor(event.target.value)} maxLength={7} /></div></div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(undefined) }}>Abbrechen</Button><Button onClick={() => editing ? update.mutate() : create.mutate()} disabled={!name.trim() || (editing ? update.isPending : create.isPending)}>{editing ? update.isPending ? 'Speichert…' : 'Änderungen speichern' : create.isPending ? 'Erstellt…' : 'Projekt anlegen'}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open) setArchiveTarget(undefined) }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{archiveTarget?.archived ? 'Projekt wiederherstellen?' : 'Projekt archivieren?'}</DialogTitle><DialogDescription>{archiveTarget?.archived ? 'Das Projekt wird wieder für neue automatische Starts freigegeben.' : 'Tickets, Aufträge und Verlauf bleiben lesbar. Neue automatische Starts werden angehalten.'}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setArchiveTarget(undefined)}>Abbrechen</Button><Button variant={archiveTarget?.archived ? 'default' : 'destructive'} onClick={() => archive.mutate()} disabled={archive.isPending}>{archiveTarget?.archived ? 'Wiederherstellen' : 'Archivieren'}</Button></div></DialogContent></Dialog>
  </div>
}

function GlobalSearch({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[] }) {
  const [query, setQuery] = useState('')
  const taskQuery = useQuery({
    queryKey: ['global-search', query],
    enabled: open && query.trim().length >= 2,
    queryFn: () => request(api.GET('/tasks', { params: { query: { q: query.trim(), limit: 20, sort: 'updated_at', direction: 'desc' } } })),
  })
  const results = taskQuery.data?.items ?? []
  const matchingProjects = useMemo(() => projects.filter((project) => `${project.name} ${project.slug}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projects, query])
  return <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) setQuery('') }}><DialogContent className="top-[18%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"><DialogHeader className="sr-only"><DialogTitle>Falkenwarte durchsuchen</DialogTitle><DialogDescription>Finde Projekte und Tickets.</DialogDescription></DialogHeader><div className="flex items-center border-b px-4"><Search className="mr-3 size-4 shrink-0 text-muted-foreground" /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projekte und Tickets suchen…" className="h-14 border-0 px-0 shadow-none focus-visible:ring-0" /><kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd></div><div className="max-h-[55vh] overflow-y-auto p-2">
    {query.trim().length < 2 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">Mindestens zwei Zeichen eingeben.</p> : <>
      {matchingProjects.length > 0 && <><p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Projekte</p>{matchingProjects.map((project) => <button key={project.id} onClick={() => { onOpenChange(false); go(`project/${project.id}/board`) }} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted"><span className="size-2.5 rounded-full" style={{ backgroundColor: project.color }} /><span className="flex-1 text-sm font-medium">{project.name}</span><span className="text-xs text-muted-foreground">Projekt</span></button>)}</>}
      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tickets</p>
      {taskQuery.isPending ? <p className="px-3 py-5 text-sm text-muted-foreground">Suche läuft…</p> : taskQuery.isError ? <p role="alert" className="px-3 py-5 text-sm text-destructive">{formatError(taskQuery.error)}</p> : results.length === 0 ? <p className="px-3 py-5 text-sm text-muted-foreground">Keine passenden Tickets gefunden.</p> : results.map((task) => { const project = projects.find((item) => item.id === task.project_id); return <button key={task.id} onClick={() => { onOpenChange(false); go(`project/${task.project_id}/board?task=${task.id}`) }} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted"><span className="font-mono text-xs text-muted-foreground">{task.key}</span><span className="min-w-0 flex-1 truncate text-sm">{task.title}</span><span className="hidden text-xs text-muted-foreground sm:block">{project?.name ?? 'Projekt'}</span></button> })}
    </>}
  </div><div className="flex items-center gap-2 border-t px-4 py-2.5 text-[10px] text-muted-foreground"><Command className="size-3" /> Suche umfasst Projektnamen, Ticketkennungen und Titel</div></DialogContent></Dialog>
}

function ProjectMissing({ projects, onCreate }: { projects: Project[]; onCreate: () => void }) {
  return <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-24 text-center"><span className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent text-primary"><FolderKanban /></span><h1 className="text-xl font-semibold">Projekt nicht gefunden</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{projects.length ? 'Wähle ein Projekt aus der Navigation oder öffne die Projektübersicht.' : 'Lege ein Projekt an, um mit Tickets zu beginnen.'}</p><Button className="mt-5" onClick={onCreate}>Zur Projektübersicht</Button></div>
}

function LoadingScreen() {
  return <div className="grid min-h-screen place-items-center"><div className="flex items-center gap-3 text-sm text-muted-foreground"><span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />Falkenwarte wird geladen…</div></div>
}

function UnavailableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="grid min-h-screen place-items-center px-4"><Card className="max-w-md"><CardContent className="p-7"><Shield className="mb-3 size-7 text-primary" /><h1 className="text-lg font-semibold">Falkenwarte ist nicht erreichbar</h1><p role="alert" className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" variant="outline" onClick={onRetry}>Erneut versuchen</Button></CardContent></Card></div>
}

function PageSkeleton() {
  return <div className="space-y-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-24" /><div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div></div>
}

function titleFor(page: string, project?: Project) {
  if (project) return project.name
  return ({ dashboard: 'Übersicht', projects: 'Projekte', labels: 'Labels', agents: 'Agents & T3', roles: 'Rollen', workflows: 'Workflows', plugins: 'Plugins', metrics: 'Metriken', settings: 'Einstellungen', docs: 'Dokumentation' } as Record<string, string>)[page] ?? 'Falkenwarte'
}

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase() ?? '').join('') || 'F'
}

function ArchiveIcon({ archived }: { archived: boolean }) {
  return archived ? <Check /> : <Archive />
}
