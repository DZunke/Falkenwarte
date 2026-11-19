import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, CirclePlus, Pencil, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Label } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label as FormLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type RoutingRule = components['schemas']['WorkflowRoutingRule']

export default function LabelsView() {
  const queryClient = useQueryClient()
  const projectsQuery = useProjects()
  const projects = projectsQuery.data?.items ?? []
  const [projectId, setProjectId] = useState<string>()
  const project = projects.find((item) => item.id === projectId) ?? projects[0]
  const labelsQuery = useQuery({
    queryKey: ['project-labels', project?.id],
    enabled: Boolean(project),
    queryFn: () => request(api.GET('/projects/{project_id}/labels', { params: { path: { project_id: project!.id } } })),
  })
  const routingQuery = useQuery({
    queryKey: ['routing-rules', project?.id],
    enabled: Boolean(project),
    queryFn: () => request(api.GET('/projects/{project_id}/routing-rules', { params: { path: { project_id: project!.id } } })),
  })
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: () => request(api.GET('/workflows', { params: { query: { limit: 100 } } })) })
  const labels = labelsQuery.data?.items ?? []
  const workflowLabels = labels.filter((label) => label.kind === 'workflow' && !label.system_managed && label.active)
  const workflows = workflowsQuery.data?.items.filter((workflow) => workflow.enabled && (!workflow.project_id || workflow.project_id === project?.id)) ?? []
  const [editing, setEditing] = useState<Label>()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#346783')
  const [kind, setKind] = useState<'topic' | 'workflow'>('topic')
  const [active, setActive] = useState(true)
  const [routeChoices, setRouteChoices] = useState<Record<string, string>>({})

  const activeRules = routingQuery.data?.rules ?? []
  const workflowChoiceById = useMemo(() => {
    const values: Record<string, string> = {}
    workflowLabels.forEach((label) => {
      const current = activeRules.find((rule) => rule.workflow_label_id === label.id)
      if (current) values[label.id] = current.workflow_id
    })
    return { ...values, ...routeChoices }
  }, [activeRules, workflowLabels, routeChoices])

  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['project-labels', project?.id] }),
    queryClient.invalidateQueries({ queryKey: ['routing-rules', project?.id] }),
    queryClient.invalidateQueries({ queryKey: ['task'] }),
    queryClient.invalidateQueries({ queryKey: ['board-view'] }),
  ])

  const createLabel = useMutation({
    mutationFn: () => {
      if (!project) throw new Error('Bitte zuerst ein Projekt anlegen.')
      return request(api.POST('/projects/{project_id}/labels', {
        params: { path: { project_id: project.id }, ...mutationParams() },
        body: { key: key.trim(), name: name.trim(), color, description: description.trim(), kind },
      }))
    },
    onSuccess: async () => { setCreateOpen(false); clearForm(); await refresh(); toast.success('Label angelegt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateLabel = useMutation({
    mutationFn: () => {
      if (!project || !editing) throw new Error('Das Label ist nicht mehr verfügbar.')
      return request(api.PATCH('/projects/{project_id}/labels/{label_id}', {
        params: { path: { project_id: project.id, label_id: editing.id }, ...mutationParams(editing.version) },
        body: { name: name.trim(), color, description: description.trim(), active },
      }))
    },
    onSuccess: async () => { setEditing(undefined); await refresh(); toast.success('Label gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateRouting = useMutation({
    mutationFn: () => {
      if (!project || !routingQuery.data) throw new Error('Routingregeln sind nicht verfügbar.')
      const rules: RoutingRule[] = workflowLabels.flatMap((label) => {
        const workflow = workflows.find((item) => item.id === workflowChoiceById[label.id])
        return workflow ? [{ workflow_label_id: label.id, workflow_id: workflow.id, workflow_definition_version: workflow.definition_version }] : []
      })
      return request(api.PUT('/projects/{project_id}/routing-rules', {
        params: { path: { project_id: project.id }, ...mutationParams(routingQuery.data.version) },
        body: { rules, on_unresolved: 'needs_human_decision' },
      }))
    },
    onSuccess: async () => { setRouteChoices({}); await refresh(); toast.success('Workflowzuordnung gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  function clearForm() {
    setName('')
    setKey('')
    setDescription('')
    setColor('#346783')
    setKind('topic')
    setActive(true)
  }

  function openEdit(label: Label) {
    setEditing(label)
    setName(label.name)
    setDescription(label.description)
    setColor(label.color)
    setActive(label.active)
  }

  if (projectsQuery.isPending) return <p className="text-sm text-muted-foreground">Projekte werden geladen…</p>
  if (projectsQuery.isError) return <p role="alert" className="text-sm text-destructive">{formatError(projectsQuery.error)}</p>
  if (!projects.length) return <Card><CardContent className="p-8 text-center"><h2 className="font-semibold">Erst ein Projekt anlegen</h2><p className="mt-2 text-sm text-muted-foreground">Labels gehören zu einem Projekt und stehen dort für Tickets und Einordnung bereit.</p></CardContent></Card>

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Labels</h1><p className="mt-1 text-sm text-muted-foreground">Labels ordnen Tickets thematisch ein und wählen versionierte Bearbeitungsrouten.</p></div><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><Select value={project.id} onValueChange={setProjectId}><SelectTrigger aria-label="Projekt für Labels" className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent>{projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button className="w-full sm:w-auto" onClick={() => { clearForm(); setCreateOpen(true) }}><CirclePlus />Label anlegen</Button></div></header>

      {(labelsQuery.isError || routingQuery.isError) && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formatError(labelsQuery.error ?? routingQuery.error)}</p>}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">{project.name} · Labelkatalog</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {labelsQuery.isPending ? <p className="text-sm text-muted-foreground">Labels werden geladen…</p> : labels.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center"><p className="font-medium">Noch keine Labels</p><p className="mt-1 text-sm text-muted-foreground">Lege ein Themenlabel oder eine Workflowroute an.</p></div> : labels.map((label) => <div key={label.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{label.name}</p><Badge variant={label.kind === 'workflow' ? 'secondary' : 'outline'}>{label.kind === 'workflow' ? 'Workflow' : label.system_managed ? 'System' : 'Thema'}</Badge>{!label.active && <Badge variant="destructive">Deaktiviert</Badge>}</div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{label.description || 'Keine Beschreibung'}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{label.key}</p></div>
              {!label.system_managed && <Button variant="ghost" size="icon" aria-label={`${label.name} bearbeiten`} onClick={() => openEdit(label)}><Pencil /></Button>}
            </div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">Workflowzuordnung</CardTitle><p className="mt-1 text-xs text-muted-foreground">Jedes Workflowlabel verweist auf eine konkrete Workflowversion.</p></div><Button size="sm" onClick={() => updateRouting.mutate()} disabled={updateRouting.isPending || !routingQuery.data}><Save />Speichern</Button></CardHeader>
          <CardContent className="space-y-4">
            {routingQuery.isPending || workflowsQuery.isPending ? <p className="text-sm text-muted-foreground">Routen werden geladen…</p> : workflowLabels.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Lege zuerst ein Workflowlabel an.</div> : workflowLabels.map((label) => {
              const workflow = workflows.find((item) => item.id === workflowChoiceById[label.id])
              return <div key={label.id} className="space-y-2 rounded-lg border p-3"><div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} /><p className="text-sm font-medium">{label.name}</p></div><FormLabel htmlFor={`workflow-route-${label.id}`}>Route für {label.name}</FormLabel><Select value={workflowChoiceById[label.id] ?? '__unassigned'} onValueChange={(value) => setRouteChoices((current) => ({ ...current, [label.id]: value === '__unassigned' ? '' : value }))}><SelectTrigger id={`workflow-route-${label.id}`}><SelectValue placeholder="Keine Route zugewiesen" /></SelectTrigger><SelectContent><SelectItem value="__unassigned">Keine Route</SelectItem>{workflows.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · v{item.definition_version}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{workflow ? `Neue Tickets verwenden Workflowversion ${workflow.definition_version}. Laufende Abläufe behalten ihre Version.` : 'Ohne eindeutige Route benötigt die Einordnung eine menschliche Entscheidung.'}</p></div>
            })}
            {workflowsQuery.isError && <p role="alert" className="text-xs text-destructive">Workflowliste nicht verfügbar: {formatError(workflowsQuery.error)}</p>}
            <a href="#/workflows" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Workflows verwalten <ArrowUpRight className="size-3.5" /></a>
          </CardContent>
        </Card>
      </div>

      <LabelDialog open={createOpen} title="Label anlegen" description="Labels gehören zu diesem Projekt. Ihre stabile Identität bleibt nach der Anlage erhalten." kind={kind} setKind={setKind} name={name} setName={setName} keyValue={key} setKey={setKey} descriptionValue={description} setDescription={setDescription} color={color} setColor={setColor} active={active} setActive={setActive} onSave={() => createLabel.mutate()} onClose={() => setCreateOpen(false)} busy={createLabel.isPending} creating />
      <LabelDialog open={Boolean(editing)} title="Label bearbeiten" description="Name, Farbe und Beschreibung sind anpassbar. Die stabile Identität und Labelart bleiben gleich." kind={editing?.kind === 'workflow' ? 'workflow' : 'topic'} setKind={() => undefined} name={name} setName={setName} keyValue={editing?.key ?? ''} setKey={setKey} descriptionValue={description} setDescription={setDescription} color={color} setColor={setColor} active={active} setActive={setActive} onSave={() => updateLabel.mutate()} onClose={() => setEditing(undefined)} busy={updateLabel.isPending} creating={false} />
    </div>
  )
}

function LabelDialog({ open, title, description, kind, setKind, name, setName, keyValue, setKey, descriptionValue, setDescription, color, setColor, active, setActive, onSave, onClose, busy, creating }: {
  open: boolean; title: string; description: string; kind: 'topic' | 'workflow'; setKind: (kind: 'topic' | 'workflow') => void; name: string; setName: (name: string) => void; keyValue: string; setKey: (key: string) => void; descriptionValue: string; setDescription: (description: string) => void; color: string; setColor: (color: string) => void; active: boolean; setActive: (active: boolean) => void; onSave: () => void; onClose: () => void; busy: boolean; creating: boolean;
}) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="grid gap-4 py-2">
    {creating && <div className="grid gap-2"><FormLabel htmlFor="label-kind">Labelart</FormLabel><Select value={kind} onValueChange={(value) => setKind(value as 'topic' | 'workflow')}><SelectTrigger id="label-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="topic">Thema</SelectItem><SelectItem value="workflow">Workflowroute</SelectItem></SelectContent></Select></div>}
    <div className="grid gap-2"><FormLabel htmlFor="label-name">Name</FormLabel><Input id="label-name" value={name} onChange={(event) => { setName(event.target.value); if (creating) setKey(event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) }} maxLength={100} /></div>
    {creating && <div className="grid gap-2"><FormLabel htmlFor="label-key">Stabiler Schlüssel</FormLabel><Input id="label-key" value={keyValue} onChange={(event) => setKey(event.target.value)} maxLength={100} /><p className="text-xs text-muted-foreground">Kleinbuchstaben, Ziffern und Bindestriche verwenden.</p></div>}
    <div className="grid gap-2"><FormLabel htmlFor="label-description">Beschreibung</FormLabel><Textarea id="label-description" value={descriptionValue} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} /></div>
    <div className="grid gap-2"><FormLabel htmlFor="label-color">Farbe</FormLabel><div className="flex items-center gap-3"><Input id="label-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-16 p-1" /><Input aria-label="Hex-Farbwert" value={color} onChange={(event) => setColor(event.target.value)} maxLength={7} /></div></div>
    {!creating && <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onCheckedChange={(checked) => setActive(Boolean(checked))} />Label aktivieren</label>}
  </div><DialogFooter><Button variant="outline" onClick={onClose}>Abbrechen</Button><Button onClick={onSave} disabled={busy || !name.trim() || (creating && !keyValue.trim())}>{busy ? 'Speichert…' : 'Speichern'}</Button></DialogFooter></DialogContent></Dialog>
}
