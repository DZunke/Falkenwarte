import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { ChevronDown, CirclePlus, Columns3, List, Plus, Search, Settings2 } from 'lucide-react'
import { api, formatError, mutationParams, request, type Label as ProjectLabel, type Project, type Task } from '@/lib/api'
import { useBoardView, useBoards, useProjectCustomFields, useProjectLabels, useProjectStatuses } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { CustomFieldInputs, customFieldsPayload, missingRequiredCustomFields, type CustomFieldDraft } from './custom-fields'
import ProjectCustomFields from './ProjectCustomFields'
import TaskSheet from './TaskSheet'
import ProjectIcon from './ProjectIcon'

const categoryLabels: Record<string, string> = {
  backlog: 'Backlog', ready: 'Bereit', active: 'In Arbeit', review: 'Review', done: 'Erledigt', cancelled: 'Abgebrochen',
}
type StatusInput = components['schemas']['TaskStatusInput']

export default function ProjectBoard({ project, initialTaskId, initialCreate, onRefreshProject }: { project: Project; initialTaskId?: string; initialCreate?: boolean; onRefreshProject: () => void }) {
  const queryClient = useQueryClient()
  const boardsQuery = useBoards(project.id)
  const statusesQuery = useProjectStatuses(project.id)
  const labelsQuery = useProjectLabels(project.id)
  const customFieldsQuery = useProjectCustomFields(project.id)
  const [boardId, setBoardId] = useState<string>()
  const [layout, setLayout] = useState<'board' | 'list'>('board')
  const [filter, setFilter] = useState('')
  const [taskId, setTaskId] = useState<string>()
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate && !project.archived))
  const [boardOpen, setBoardOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [statusesOpen, setStatusesOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [criteriaText, setCriteriaText] = useState('')
  const [customFieldDraft, setCustomFieldDraft] = useState<CustomFieldDraft>({})
  const [boardName, setBoardName] = useState('Projektboard')
  const [columnEdits, setColumnEdits] = useState<Record<string, { name: string; wipLimit: string; wipPolicy: 'warn' | 'block' }>>({})
  const [statusDrafts, setStatusDrafts] = useState<StatusInput[]>([])
  const [viewError, setViewError] = useState('')

  useEffect(() => {
    if (initialTaskId) setTaskId(initialTaskId)
  }, [initialTaskId])

  const boards = boardsQuery.data?.items ?? []
  const selectedBoard = boards.find((board) => board.id === boardId) ?? boards[0]
  const viewQuery = useBoardView(selectedBoard?.id)
  const columns = viewQuery.data?.columns ?? []
  const boardDefinition = viewQuery.data?.board ?? selectedBoard
  const statuses = statusesQuery.data?.items ?? []
  const labels = labelsQuery.data?.items ?? []
  const customFields = customFieldsQuery.data?.items ?? []
  const missingCustomFields = missingRequiredCustomFields(customFields, customFieldDraft)
  const allTasks = columns.flatMap((column) => column.items)
  const visibleTasks = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query ? allTasks.filter((task) => `${task.key} ${task.title} ${task.description}`.toLocaleLowerCase().includes(query)) : allTasks
  }, [allTasks, filter])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['boards', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['project-statuses', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['board-view'] }),
      queryClient.invalidateQueries({ queryKey: ['task'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['history'] }),
    ])
    onRefreshProject()
  }

  const createTask = useMutation({
    mutationFn: async () => {
      const status = statuses.find((item) => item.is_default) ?? statuses[0]
      if (!status) throw new Error('Lege unter „Status bearbeiten“ einen Standardstatus an.')
      if (customFieldsQuery.isPending || customFieldsQuery.isError) throw new Error('Die Projektfelder konnten nicht geladen werden.')
      if (missingCustomFields.length) throw new Error(`Fülle die erforderlichen Projektfelder aus: ${missingCustomFields.join(', ')}.`)
      const criteria = criteriaText.split('\n').map((text) => text.trim()).filter(Boolean).map((text) => ({ text, is_required: true }))
      return request(api.POST('/projects/{project_id}/tasks', {
        params: { path: { project_id: project.id }, ...mutationParams() },
        body: { title: title.trim(), description: description.trim(), priority, status_id: status.id, criteria, custom_fields: customFieldsPayload(customFields, customFieldDraft), prefer_wait_ms: 0 },
      }))
    },
    onSuccess: async (receipt) => {
      setCreateOpen(false)
      setTitle('')
      setDescription('')
      setCriteriaText('')
      setCustomFieldDraft({})
      setPriority('normal')
      await refresh()
      setTaskId(receipt.task_id)
      toast.success('Ticket angelegt')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const createBoard = useMutation({
    mutationFn: async () => {
      let currentStatuses = statuses
      if (currentStatuses.length === 0) {
        const defaults = [
          ['backlog', 'Backlog', '#88968e'], ['ready', 'Bereit', '#346783'], ['active', 'In Arbeit', '#176447'],
          ['review', 'Review', '#7754a2'], ['done', 'Erledigt', '#95620b'], ['cancelled', 'Abgebrochen', '#a34545'],
        ] as const
        const replacement = await request(api.PUT('/projects/{project_id}/statuses', {
          params: { path: { project_id: project.id }, ...mutationParams(project.version) },
          body: { statuses: defaults.map(([category, name, color], index) => ({ id: crypto.randomUUID(), category, name, color, is_default: index === 1 })) },
        }))
        currentStatuses = replacement.items
      }
      const grouped = ['backlog', 'ready', 'active', 'review', 'done', 'cancelled']
        .map((category) => currentStatuses.filter((status) => status.category === category))
        .filter((items) => items.length > 0)
      const columns = grouped.map((items) => ({
        name: categoryLabels[items[0].category],
        status_ids: items.map((item) => item.id),
        default_drop_status_id: items[0].id,
        wip_limit: null,
        wip_policy: 'block' as const,
      }))
      return request(api.POST('/projects/{project_id}/boards', {
        params: { path: { project_id: project.id }, ...mutationParams() },
        body: {
          name: boardName.trim() || 'Projektboard',
          config: { filter: {}, sort: 'updated_at', group_by: 'status', swimlane_by: 'none', visible_fields: ['key', 'title', 'priority', 'labels', 'criteria'] },
          columns,
        },
      }))
    },
    onSuccess: async (board) => {
      setBoardOpen(false)
      await refresh()
      setBoardId(board.id)
      toast.success('Board angelegt')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const moveTask = useMutation({
    mutationFn: async ({ task, statusId, beforeTaskId }: { task: Task; statusId: string; beforeTaskId?: string }) => request(api.POST('/tasks/{task_id}/move', {
      params: { path: { task_id: task.id }, ...mutationParams(task.version) },
      body: { status_id: statusId, board_id: boardDefinition?.id, before_task_id: beforeTaskId ?? null },
    })),
    onSuccess: async () => { setViewError(''); await refresh(); toast.success('Ticket verschoben') },
    onError: async (error) => { setViewError(formatError(error)); await refresh() },
  })

  const saveColumns = useMutation({
    mutationFn: async () => {
      if (!boardDefinition) throw new Error('Das Board ist nicht geladen.')
      return request(api.PUT('/boards/{board_id}/columns', {
        params: { path: { board_id: boardDefinition.id }, ...mutationParams(boardDefinition.version) },
        body: { columns: boardDefinition.columns.map((column) => {
          const edit = columnEdits[column.id]
          const wipLimit = edit?.wipLimit.trim() ? Number(edit.wipLimit) : null
          if (wipLimit !== null && (!Number.isInteger(wipLimit) || wipLimit < 1)) throw new Error('WIP-Grenzen müssen positive ganze Zahlen sein.')
          return { id: column.id, name: edit?.name.trim() || column.name, status_ids: column.status_ids, default_drop_status_id: column.default_drop_status_id, wip_limit: wipLimit, wip_policy: edit?.wipPolicy ?? column.wip_policy }
        }) },
      }))
    },
    onSuccess: async () => { setColumnsOpen(false); await refresh(); toast.success('Boardspalten gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const saveStatuses = useMutation({
    mutationFn: async () => {
      if (!statusesQuery.data) throw new Error('Projektstatus sind nicht verfügbar.')
      return request(api.PUT('/projects/{project_id}/statuses', {
        params: { path: { project_id: project.id }, ...mutationParams(statusesQuery.data.project_version) },
        body: { statuses: statusDrafts },
      }))
    },
    onSuccess: async () => { setStatusesOpen(false); await refresh(); toast.success('Projektstatus gespeichert') },
    onError: async (error) => { toast.error(formatError(error)); await refresh() },
  })

  function openColumns() {
    if (!boardDefinition) return
    setColumnEdits(Object.fromEntries(boardDefinition.columns.map((column) => [column.id, { name: column.name, wipLimit: column.wip_limit?.toString() ?? '', wipPolicy: column.wip_policy }])))
    setColumnsOpen(true)
  }

  function openStatuses() {
    setStatusDrafts(statuses.map((status) => ({ id: status.id, name: status.name, category: status.category, color: status.color, is_default: status.is_default })))
    setStatusesOpen(true)
  }

  if (boardsQuery.isPending || statusesQuery.isPending) {
    return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
  }

  if (boardsQuery.isError || statusesQuery.isError) {
    return <Card><CardContent className="flex flex-col items-start gap-3 p-6"><h2 className="font-semibold">Projekt konnte nicht geladen werden</h2><p className="text-sm text-muted-foreground">{formatError(boardsQuery.error ?? statusesQuery.error)}</p><Button variant="outline" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ backgroundColor: project.color }} aria-hidden="true">
            <ProjectIcon iconKey={project.icon_key} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description || 'Tickets und Bearbeitungsstand dieses Projekts.'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={openStatuses}><Settings2 />Status bearbeiten</Button>
          {selectedBoard && <Button variant="outline" size="sm" onClick={openColumns}><Settings2 />Spalten bearbeiten</Button>}
          <Button variant="outline" size="sm" onClick={() => setBoardOpen(true)}><Settings2 />{boards.length ? 'Board anlegen' : 'Board einrichten'}</Button>
          <ProjectCustomFields project={project} />
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!statuses.length || project.archived}><Plus />Neues Ticket</Button>
        </div>
      </div>

      {boards.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {boards.map((board) => <Button key={board.id} variant={board.id === boardDefinition?.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setBoardId(board.id)}>{board.name}</Button>)}
          <Separator orientation="vertical" className="mx-1 h-6" />
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Tickets filtern" placeholder="Tickets filtern…" value={filter} onChange={(event) => setFilter(event.target.value)} className="h-9 pl-9" />
          </div>
          <div className="ml-auto flex rounded-lg border bg-card p-1">
            <Button size="icon" variant={layout === 'board' ? 'secondary' : 'ghost'} aria-label="Boardansicht" onClick={() => setLayout('board')}><Columns3 /></Button>
            <Button size="icon" variant={layout === 'list' ? 'secondary' : 'ghost'} aria-label="Listenansicht" onClick={() => setLayout('list')}><List /></Button>
          </div>
        </div>
      )}

      {viewError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><span>{viewError}</span><Button variant="outline" size="sm" onClick={() => setViewError('')}>Schließen</Button></div>}

      {!boards.length ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Columns3 /></div>
            <h2 className="text-lg font-semibold">Dein Projektboard einrichten</h2>
            <p className="max-w-md text-sm text-muted-foreground">Wähle die Spalten für dein erstes Board. Tickets lassen sich auch direkt über die Übersicht öffnen.</p>
            <Button onClick={() => setBoardOpen(true)}><CirclePlus />Board einrichten</Button>
          </CardContent>
        </Card>
      ) : viewQuery.isPending ? (
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      ) : viewQuery.isError ? (
        <Card><CardContent className="flex items-center justify-between gap-4 p-6"><div><h2 className="font-semibold">Boarddaten konnten nicht geladen werden</h2><p className="mt-1 text-sm text-muted-foreground">{formatError(viewQuery.error)}</p></div><Button variant="outline" onClick={() => void viewQuery.refetch()}>Erneut laden</Button></CardContent></Card>
      ) : layout === 'board' ? (
        <div className="falkenwarte-scrollbar flex items-start gap-4 overflow-x-auto pb-4">
          {columns.map((column) => {
            const definition = boardDefinition?.columns.find((item) => item.id === column.column_id)
            const tasks = visibleTasks.filter((task) => column.items.some((item) => item.id === task.id))
            return <div key={column.column_id} className="w-[min(330px,82vw)] shrink-0 rounded-xl border border-border/80 bg-[#f1f5f3] p-3 dark:bg-sidebar" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); const dragged = allTasks.find((item) => item.id === id); if (dragged && definition?.default_drop_status_id) moveTask.mutate({ task: dragged, statusId: definition.default_drop_status_id }) }}>
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold">{definition?.name ?? 'Tickets'}</h2>
                <div className="flex items-center gap-2"><Badge variant="secondary" className="rounded-md">{column.total}</Badge><Button size="icon" variant="ghost" className="size-7" aria-label={`Ticket in ${definition?.name ?? 'dieser Spalte'} erstellen`} onClick={() => setCreateOpen(true)}><Plus /></Button></div>
              </div>
              {column.wip_exceeded && <p className="mb-2 rounded-md bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900">WIP-Grenze überschritten</p>}
              <div className="grid gap-2">
                {tasks.map((task) => <TaskCard key={task.id} task={task} statuses={statuses} labels={labels} onOpen={() => setTaskId(task.id)} onMove={(statusId) => moveTask.mutate({ task, statusId })} />)}
                {tasks.length === 0 && <div className="rounded-lg border border-dashed bg-background/70 px-3 py-8 text-center text-xs text-muted-foreground">Keine Tickets in dieser Spalte</div>}
              </div>
            </div>
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Ticket</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Priorität</th><th className="px-4 py-3 font-medium">Kriterien</th><th className="px-4 py-3 font-medium">Aktualisiert</th><th className="px-4 py-3"></th></tr></thead><tbody>
            {visibleTasks.map((task) => <tr key={task.id} className="border-b last:border-0 hover:bg-muted/40"><td className="max-w-[460px] px-4 py-3"><button className="text-left" onClick={() => setTaskId(task.id)}><span className="mr-2 font-mono text-xs text-muted-foreground">{task.key}</span><span className="font-medium">{task.title}</span></button></td><td className="px-4 py-3">{task.status_category}</td><td className="px-4 py-3 capitalize">{task.priority}</td><td className="px-4 py-3">{task.criteria.filter((item) => item.state === 'human_confirmed').length}/{task.criteria.length}</td><td className="px-4 py-3 text-xs text-muted-foreground">{new Date(task.updated_at).toLocaleDateString('de-DE')}</td><td className="px-4 py-3"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Status von ${task.key} ändern`}><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{statuses.map((status) => <DropdownMenuItem key={status.id} onSelect={() => moveTask.mutate({ task, statusId: status.id })}>{status.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></td></tr>)}
            {visibleTasks.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">Keine Tickets gefunden.</td></tr>}
          </tbody></table></div>
        </Card>
      )}

      <TaskSheet taskId={taskId} project={project} statuses={statuses} onClose={() => setTaskId(undefined)} onChanged={refresh} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Ticket anlegen</DialogTitle><DialogDescription>Eine menschlich angelegte Aufgabe. Du kannst Kriterien und Links später ergänzen.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label htmlFor="task-title">Titel</Label><Input id="task-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} required /></div>
            <div className="grid gap-2"><Label htmlFor="task-description">Beschreibung</Label><Textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={20000} /></div>
            <div className="grid gap-2"><Label htmlFor="task-priority">Priorität</Label><Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}><SelectTrigger id="task-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Niedrig</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Hoch</SelectItem><SelectItem value="urgent">Dringend</SelectItem></SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="task-criteria">Erfolgskriterien</Label><Textarea id="task-criteria" value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} placeholder="Ein Kriterium pro Zeile" rows={3} /></div>
            {customFieldsQuery.isPending ? <p className="text-xs text-muted-foreground">Projektfelder werden geladen…</p> : customFieldsQuery.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>Projektfelder konnten nicht geladen werden: {formatError(customFieldsQuery.error)}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void customFieldsQuery.refetch()}>Projektfelder erneut laden</Button></div> : <CustomFieldInputs fields={customFields} value={customFieldDraft} onChange={(key, value) => setCustomFieldDraft((current) => ({ ...current, [key]: value }))} idPrefix="new-task-field" />}
            {missingCustomFields.length > 0 && <p className="text-xs text-amber-800">Erforderlich: {missingCustomFields.join(', ')}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Abbrechen</Button><Button onClick={() => createTask.mutate()} disabled={!title.trim() || !statuses.length || project.archived || customFieldsQuery.isPending || customFieldsQuery.isError || missingCustomFields.length > 0 || createTask.isPending}>{createTask.isPending ? 'Wird angelegt…' : 'Ticket anlegen'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={boardOpen} onOpenChange={setBoardOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{boards.length ? 'Board anlegen' : 'Board einrichten'}</DialogTitle><DialogDescription>Falkenwarte erstellt passende Statuskategorien für den Projektablauf, falls noch keine vorhanden sind.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2"><Label htmlFor="board-name">Boardname</Label><Input id="board-name" value={boardName} onChange={(event) => setBoardName(event.target.value)} maxLength={100} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setBoardOpen(false)}>Abbrechen</Button><Button onClick={() => createBoard.mutate()} disabled={createBoard.isPending}>{createBoard.isPending ? 'Wird eingerichtet…' : 'Board erstellen'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Boardspalten bearbeiten</DialogTitle><DialogDescription>Ändere Spaltennamen und WIP-Grenzen. Harte Grenzen werden für alle Änderungen am Projekt serverseitig geprüft.</DialogDescription></DialogHeader><div className="grid max-h-[60vh] gap-4 overflow-y-auto py-2 pr-1">{boardDefinition?.columns.map((column) => { const edit = columnEdits[column.id]; return <div key={column.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_130px_140px]"><div className="grid gap-2"><Label htmlFor={`column-name-${column.id}`}>Spaltenname</Label><Input id={`column-name-${column.id}`} value={edit?.name ?? column.name} onChange={(event) => setColumnEdits((current) => ({ ...current, [column.id]: { name: event.target.value, wipLimit: current[column.id]?.wipLimit ?? '', wipPolicy: current[column.id]?.wipPolicy ?? column.wip_policy } }))} maxLength={60} /></div><div className="grid gap-2"><Label htmlFor={`column-wip-${column.id}`}>WIP-Limit</Label><Input id={`column-wip-${column.id}`} type="number" min={1} step={1} placeholder="Ohne Limit" value={edit?.wipLimit ?? ''} onChange={(event) => setColumnEdits((current) => ({ ...current, [column.id]: { name: current[column.id]?.name ?? column.name, wipLimit: event.target.value, wipPolicy: current[column.id]?.wipPolicy ?? column.wip_policy } }))} /></div><div className="grid gap-2"><Label htmlFor={`column-policy-${column.id}`}>Bei Überschreitung</Label><Select value={edit?.wipPolicy ?? column.wip_policy} onValueChange={(value) => setColumnEdits((current) => ({ ...current, [column.id]: { name: current[column.id]?.name ?? column.name, wipLimit: current[column.id]?.wipLimit ?? '', wipPolicy: value as 'warn' | 'block' } }))}><SelectTrigger id={`column-policy-${column.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="block">Blockieren</SelectItem><SelectItem value="warn">Warnen</SelectItem></SelectContent></Select></div></div>})}</div><DialogFooter><Button variant="outline" onClick={() => setColumnsOpen(false)}>Abbrechen</Button><Button onClick={() => saveColumns.mutate()} disabled={saveColumns.isPending}>{saveColumns.isPending ? 'Speichert…' : 'Spalten speichern'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={statusesOpen} onOpenChange={setStatusesOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Projektstatus bearbeiten</DialogTitle><DialogDescription>Statuskategorien tragen ihre fachliche Bedeutung. Eine verwendete Kategorie lässt sich nur ändern, wenn Projektregeln und bestehende Boards gültig bleiben.</DialogDescription></DialogHeader><div className="grid max-h-[60vh] gap-3 overflow-y-auto py-2 pr-1">{statusDrafts.map((status, index) => <div key={status.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(130px,1fr)_150px_80px_110px]"><div className="grid gap-2"><Label htmlFor={`status-name-${status.id}`}>Statusname</Label><Input id={`status-name-${status.id}`} value={status.name} onChange={(event) => setStatusDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} maxLength={80} /></div><div className="grid gap-2"><Label htmlFor={`status-category-${status.id}`}>Bedeutung</Label><Select value={status.category} onValueChange={(value) => setStatusDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: value as StatusInput['category'] } : item))}><SelectTrigger id={`status-category-${status.id}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor={`status-color-${status.id}`}>Farbe</Label><Input id={`status-color-${status.id}`} type="color" value={status.color} onChange={(event) => setStatusDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))} className="h-10 p-1" /></div><label className="flex items-center gap-2 self-end pb-2 text-xs"><Checkbox checked={status.is_default} onCheckedChange={(checked) => setStatusDrafts((current) => current.map((item, itemIndex) => ({ ...item, is_default: itemIndex === index && Boolean(checked) })))} />Standard</label></div>)}</div><div className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="outline" onClick={() => setStatusDrafts((current) => [...current, { id: crypto.randomUUID(), name: 'Neuer Status', category: 'ready', color: '#346783', is_default: false }])}><Plus />Status hinzufügen</Button><div className="flex gap-2"><Button variant="outline" onClick={() => setStatusesOpen(false)}>Abbrechen</Button><Button onClick={() => saveStatuses.mutate()} disabled={saveStatuses.isPending || statusDrafts.length === 0 || !statusDrafts.some((item) => item.is_default)}>{saveStatuses.isPending ? 'Speichert…' : 'Status speichern'}</Button></div></div></DialogContent></Dialog>
    </section>
  )
}

function TaskCard({ task, statuses, labels, onOpen, onMove }: { task: Task; statuses: { id: string; name: string }[]; labels: ProjectLabel[]; onOpen: () => void; onMove: (statusId: string) => void }) {
  const statusLabel = categoryLabels[task.status_category] ?? task.status_category
  return <Card draggable aria-roledescription="Ticketkarte" onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }} className="group border-border/80 shadow-sm transition-shadow hover:shadow-md">
    <CardContent className="p-3.5">
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] text-muted-foreground">{task.key}</span><Badge variant={task.priority === 'urgent' ? 'destructive' : task.priority === 'high' ? 'default' : 'secondary'} className="h-5 px-1.5 text-[10px] capitalize">{task.priority === 'normal' ? 'Normal' : task.priority}</Badge></div>
          <h3 className="line-clamp-2 text-sm font-medium leading-5">{task.title}</h3>
        </button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="-mr-2 -mt-1 size-7 opacity-70" aria-label={`Aktionen für ${task.key}`}><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={onOpen}>Ticket öffnen</DropdownMenuItem><DropdownMenuItem className="text-muted-foreground" disabled>{statusLabel}</DropdownMenuItem>{statuses.map((status) => <DropdownMenuItem key={status.id} onSelect={() => onMove(status.id)}>{status.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      </div>
      {task.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>}
      {task.label_ids.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{task.label_ids.map((id) => labels.find((label) => label.id === id)).filter((label): label is ProjectLabel => Boolean(label)).map((label) => <Badge key={label.id} variant="outline" className="h-5 gap-1.5 px-1.5 text-[10px] font-normal"><span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />{label.name}</Badge>)}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2.5 text-[11px] text-muted-foreground">
        {task.origin !== 'manual' && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{task.origin === 'mcp' ? 'MCP-Eingang' : 'Technische API'}</Badge>}
        {task.criteria.length > 0 && <span>{task.criteria.filter((item) => item.state === 'human_confirmed').length}/{task.criteria.length} Kriterien</span>}
        {task.human_attention.required && <Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-900">Mensch erforderlich</Badge>}
        {task.intake_outcome === 'needs_information' && <Badge variant="outline" className="h-5 border-blue-200 bg-blue-50 px-1.5 text-[10px] text-blue-900">Rückfrage an Agent</Badge>}
      </div>
    </CardContent>
  </Card>
}
