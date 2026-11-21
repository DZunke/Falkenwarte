import { lazy, Suspense, useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, GitBranch, History, Link2, Pencil, Play, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Project, type Task, type TaskStatus } from '@/lib/api'
import { useProjectCustomFields, useProjectLabels, useTask, useTaskLinks } from '@/lib/queries'
import TaskExecution from '@/components/TaskExecution'
import TaskDecisions from '@/components/TaskDecisions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import LinkNotesPanel from '@/features/plugins/LinkNotesPanel'
import { CustomFieldInputs, CustomFieldValues, customFieldDraft, customFieldsPayload, missingRequiredCustomFields, type CustomFieldDraft } from './custom-fields'

const TaskFlow = lazy(() => import('@/components/TaskFlow'))

const linkKinds = [
  ['source_issue', 'Issue'], ['pull_request', 'Pull request'], ['merge_request', 'Merge request'], ['documentation', 'Dokumentation'], ['other', 'Referenz'],
] as const
const linkRelations = [
  ['source', 'Quelle'], ['part_of', 'Teil von'], ['delivers', 'Ergebnis'], ['references', 'Referenz'],
] as const
function historyValue(value: components['schemas']['HistoryValue']): string {
  if ('summary' in value) return value.summary
  if (!('value' in value)) return '–'
  if (value.type === 'boolean') return value.value ? 'Ja' : 'Nein'
  return Array.isArray(value.value) ? value.value.join(', ') : String(value.value ?? '–')
}

function RevisionFields({ fields }: { fields: components['schemas']['Revision']['custom_field_values'] }) {
  if (!fields?.length) return null
  return <dl className="mt-2 grid gap-1.5 text-sm">
    {fields.map((field) => <div key={field.key} className="min-w-0">
      <dt className="text-xs text-muted-foreground">{field.label}</dt>
      <dd className="whitespace-pre-wrap break-words">{historyValue(field.value)}</dd>
    </div>)}
  </dl>
}

type TaskLink = components['schemas']['TaskLink']

function evidenceIsCurrentForTask(evidence: components['schemas']['Evidence'], task: Task): boolean {
  return typeof evidence.current_for_task === 'boolean'
    ? evidence.current_for_task
    : evidence.task_revision === task.version
}

export default function TaskSheet({ taskId, openFlow = false, project, board, statuses, onClose, onChanged }: { taskId?: string; openFlow?: boolean; project: Project; board?: components['schemas']['Board']; statuses: TaskStatus[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState(openFlow ? 'flow' : 'details')
  const [restoreActionId, setRestoreActionId] = useState<string>()
  const taskQuery = useTask(taskId)
  const taskFlowQuery = useInfiniteQuery({
    queryKey: ['task-flow', taskId, board?.id],
    enabled: Boolean(taskId && (activeTab === 'flow' || activeTab === 'execution')),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => request(api.GET('/tasks/{task_id}/flow', {
      params: { path: { task_id: taskId! }, query: { board_id: board?.id, limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } },
    })),
    getNextPageParam: (page) => page.has_more ? page.next_cursor ?? undefined : undefined,
  })
  const linksQuery = useTaskLinks(taskId)
  const labelsQuery = useProjectLabels(project.id)
  const customFieldsQuery = useProjectCustomFields(project.id)
  const linkNotesPluginQuery = useQuery({
    queryKey: ['plugin', 'falkenwarte.link-notes'],
    queryFn: () => request(api.GET('/plugins/{plugin_id}', { params: { path: { plugin_id: 'falkenwarte.link-notes' } } })),
  })
  const linkNotesContribution = linkNotesPluginQuery.data?.ui_contributions.find((contribution) => contribution.slot === 'task.tabs' && contribution.component_id === 'link-notes.tab')
  const historyQuery = useQuery({
    queryKey: ['history', taskId],
    enabled: Boolean(taskId),
    queryFn: () => request(api.GET('/history', { params: { query: { resource_type: 'task', resource_id: taskId!, limit: 40 } } })),
  })
  const evidenceQuery = useQuery({
    queryKey: ['task-evidence', taskId],
    enabled: Boolean(taskId),
    queryFn: () => request(api.GET('/evidence', { params: { query: { task_id: taskId!, limit: 100 } } })),
  })
  const restoreActionQuery = useQuery({
    queryKey: ['action', restoreActionId],
    enabled: Boolean(restoreActionId),
    queryFn: () => request(api.GET('/actions/{action_id}', { params: { path: { action_id: restoreActionId! } } })),
    refetchInterval: (query) => query.state.data?.status === 'accepted' || query.state.data?.status === 'started' ? 1000 : false,
  })
  const task = taskQuery.data
  const linkCollections = linksQuery.data?.items ?? []
  const labels = labelsQuery.data?.items.filter((label) => label.active && !label.system_managed && label.kind !== 'attention') ?? []
  const customFields = customFieldsQuery.data?.items ?? []
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('normal')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [criteriaText, setCriteriaText] = useState('')
  const [customFieldDraftValues, setCustomFieldDraftValues] = useState<CustomFieldDraft>({})
  const [editBaseVersion, setEditBaseVersion] = useState<number>()
  const [linkForm, setLinkForm] = useState(false)
  const [collectionName, setCollectionName] = useState('Ergebnisse')
  const [collectionKind, setCollectionKind] = useState<'source' | 'delivery' | 'reference'>('delivery')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkKind, setLinkKind] = useState<(typeof linkKinds)[number][0]>('other')
  const [linkRelation, setLinkRelation] = useState<(typeof linkRelations)[number][0]>('references')
  const [editingLink, setEditingLink] = useState<{ collectionId: string; taskVersion: number; link: TaskLink }>()
  const [removingLink, setRemovingLink] = useState<{ collectionId: string; taskVersion: number; link: TaskLink }>()
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceLabel, setEvidenceLabel] = useState('')
  const [evidenceText, setEvidenceText] = useState('')
  const [evidenceCriteria, setEvidenceCriteria] = useState<string[]>([])
  const [evidenceAssignmentTarget, setEvidenceAssignmentTarget] = useState<string>()
  const [evidenceAssignmentCriteria, setEvidenceAssignmentCriteria] = useState<string[]>([])
  const [evidenceAssignmentError, setEvidenceAssignmentError] = useState('')
  const [evidenceAssignmentProgress, setEvidenceAssignmentProgress] = useState('')
  const [reviewTarget, setReviewTarget] = useState<string>()
  const [reviewReason, setReviewReason] = useState('')
  const [saveConflict, setSaveConflict] = useState('')
  const [restoreRevision, setRestoreRevision] = useState<string>()
  const [restoreReason, setRestoreReason] = useState('')
  const evidenceItems = evidenceQuery.data?.items ?? []
  const evidenceAssignmentEvidence = evidenceItems.find((item) => item.id === evidenceAssignmentTarget)
  const evidenceAssignmentIsCurrent = Boolean(task && evidenceAssignmentEvidence && evidenceIsCurrentForTask(evidenceAssignmentEvidence, task))
  const evidenceAssignmentIsStale = Boolean(evidenceAssignmentEvidence && !evidenceAssignmentIsCurrent)
  const evidenceAssignmentLinkedCriteria = task && evidenceAssignmentEvidence
    ? task.criteria.filter((criterion) => criterion.evidence_ids.includes(evidenceAssignmentEvidence.id))
    : []
  const evidenceAssignmentAvailableCriteria = task && evidenceAssignmentEvidence && evidenceAssignmentIsCurrent && evidenceAssignmentEvidence.review_status !== 'rejected'
    ? task.criteria.filter((criterion) => ['pending', 'reported'].includes(criterion.state) && !criterion.evidence_ids.includes(evidenceAssignmentEvidence.id))
    : []
  const missingCustomFields = missingRequiredCustomFields(customFields, customFieldDraftValues)
  const taskFlowPages = taskFlowQuery.data?.pages ?? []
  const lastTaskFlowPage = taskFlowPages.at(-1)
  const taskFlow = taskFlowPages.length > 0 ? {
    ...taskFlowPages[0],
    items: taskFlowPages.flatMap((page) => page.items),
    next_cursor: lastTaskFlowPage?.next_cursor ?? null,
    has_more: lastTaskFlowPage?.has_more ?? false,
  } : undefined

  useEffect(() => {
    setActiveTab(openFlow ? 'flow' : 'details')
    setEvidenceAssignmentTarget(undefined)
    setEvidenceAssignmentCriteria([])
    setEvidenceAssignmentError('')
    setEvidenceAssignmentProgress('')
  }, [taskId, openFlow])

  useEffect(() => {
    if (!task || editing) return
    setTitle(task.title)
    setDescription(task.description)
    setPriority(task.priority)
    setLabelIds(task.label_ids)
    setCriteriaText(task.criteria.map((criterion) => criterion.text).join('\n'))
    setCustomFieldDraftValues(customFieldDraft(task.custom_fields))
  }, [task?.id, task?.version, editing])

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['task-flow', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['task-links', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['task-evidence', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['history', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['board-view'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ])
    await onChanged()
  }

  const beginTaskEdit = () => {
    if (!task) return
    setEditBaseVersion(task.version)
    setCustomFieldDraftValues(customFieldDraft(task.custom_fields))
    setEditing(true)
  }

  const rebaseTaskEdit = () => {
    if (!task) return
    setEditBaseVersion(task.version)
    setSaveConflict('')
  }

  const reloadTaskEdit = () => {
    if (!task) return
    setEditBaseVersion(task.version)
    setTitle(task.title)
    setDescription(task.description)
    setPriority(task.priority)
    setLabelIds(task.label_ids)
    setCriteriaText(task.criteria.map((criterion) => criterion.text).join('\n'))
    setCustomFieldDraftValues(customFieldDraft(task.custom_fields))
    setSaveConflict('')
  }

  const saveTask = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error('Das Ticket ist nicht geladen.')
      if (editBaseVersion === undefined) throw new Error('Die Bearbeitungsversion ist nicht verfügbar. Öffne das Formular erneut.')
      if (customFieldsQuery.isPending || customFieldsQuery.isError) throw new Error('Die Projektfelder konnten nicht geladen werden. Lade sie erneut, bevor du speicherst.')
      if (missingCustomFields.length) throw new Error(`Fülle die erforderlichen Projektfelder aus: ${missingCustomFields.join(', ')}.`)
      const updated = await request(api.PATCH('/tasks/{task_id}', {
        params: { path: { task_id: task.id }, ...mutationParams(editBaseVersion) },
        body: { title: title.trim(), description, priority, label_ids: labelIds, custom_fields: customFieldsPayload(customFields, customFieldDraftValues) },
      }))
      const existing = new Map(task.criteria.map((criterion) => [criterion.text, criterion]))
      const criteria = criteriaText.split('\n').map((text) => text.trim()).filter(Boolean).map((text) => {
        const old = existing.get(text)
        return { ...(old ? { id: old.id } : {}), text, is_required: old?.is_required ?? true }
      })
      if (criteria.length !== task.criteria.length || criteria.some((criterion, index) => criterion.text !== task.criteria[index]?.text)) {
        return request(api.PUT('/tasks/{task_id}/criteria', {
          params: { path: { task_id: task.id }, ...mutationParams(updated.version) },
          body: { criteria },
        }))
      }
      return updated
    },
    onSuccess: async () => { setEditing(false); setEditBaseVersion(undefined); setSaveConflict(''); await invalidate(); toast.success('Ticket gespeichert') },
    onError: async (error) => { setSaveConflict('Der aktuelle Ticketstand wurde neu geladen. Deine Eingaben sind im Formular erhalten. Prüfe den angezeigten Stand und speichere erneut, wenn deine Änderung weiter gilt.'); toast.error(formatError(error)); await invalidate() },
  })

  const moveTask = useMutation({
    mutationFn: (statusId: string) => {
      if (!task) throw new Error('Das Ticket ist nicht geladen.')
      return request(api.POST('/tasks/{task_id}/move', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: { status_id: statusId },
      }))
    },
    onSuccess: async () => { await invalidate(); toast.success('Status geändert') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const registerLink = useMutation({
    mutationFn: async () => {
      if (!task || !linkTitle.trim() || !linkUrl.trim()) throw new Error('Titel und URL sind erforderlich.')
      const current = linkCollections.find((collection) => collection.kind === collectionKind && collection.name === collectionName.trim())
      let collection = current
      if (!collection) {
        collection = await request(api.POST('/tasks/{task_id}/link-collections', {
          params: { path: { task_id: task.id }, ...mutationParams(task.version) },
          body: { name: collectionName.trim(), kind: collectionKind },
        }))
      }
      return request(api.POST('/tasks/{task_id}/link-collections/{collection_id}/links', {
        params: { path: { task_id: task.id, collection_id: collection.id }, ...mutationParams(collection.task_version) },
        body: { title: linkTitle.trim(), url: linkUrl.trim(), kind: linkKind, relation: linkRelation },
      }))
    },
    onSuccess: async () => { setLinkForm(false); setLinkTitle(''); setLinkUrl(''); await invalidate(); toast.success('Link registriert') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const updateLink = useMutation({
    mutationFn: async () => {
      if (!task || !editingLink || !linkTitle.trim() || !linkUrl.trim()) throw new Error('Titel und URL sind erforderlich.')
      return request(api.PATCH('/tasks/{task_id}/link-collections/{collection_id}/links/{link_id}', {
        params: { path: { task_id: task.id, collection_id: editingLink.collectionId, link_id: editingLink.link.id }, ...mutationParams(editingLink.taskVersion) },
        body: { title: linkTitle.trim(), url: linkUrl.trim(), kind: linkKind, relation: linkRelation },
      }))
    },
    onSuccess: async () => { setEditingLink(undefined); setLinkForm(false); await invalidate(); toast.success('Link gespeichert') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const removeLink = useMutation({
    mutationFn: async () => {
      if (!task || !removingLink) throw new Error('Der Link ist nicht mehr verfügbar.')
      return request(api.DELETE('/tasks/{task_id}/link-collections/{collection_id}/links/{link_id}', {
        params: { path: { task_id: task.id, collection_id: removingLink.collectionId, link_id: removingLink.link.id }, ...mutationParams(removingLink.taskVersion) },
      }))
    },
    onSuccess: async () => { setRemovingLink(undefined); await invalidate(); toast.success('Link entfernt') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const registerEvidence = useMutation({
    mutationFn: async () => {
      if (!task || !evidenceLabel.trim() || !evidenceText.trim()) throw new Error('Bezeichnung und Meldung sind erforderlich.')
      return request(api.POST('/tasks/{task_id}/evidence', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: {
          task_id: task.id,
          task_revision: task.version,
          run_id: null,
          attempt_no: null,
          artifact: { kind: 'note', label: evidenceLabel.trim(), text: evidenceText.trim() },
          criterion_ids: evidenceCriteria,
        },
      }))
    },
    onSuccess: async () => { setEvidenceOpen(false); setEvidenceLabel(''); setEvidenceText(''); setEvidenceCriteria([]); await invalidate(); toast.success('Meldung gespeichert') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const assignEvidence = useMutation({
    mutationFn: async () => {
      if (!task || !evidenceAssignmentTarget || evidenceAssignmentCriteria.length === 0) throw new Error('Wähle mindestens ein offenes Erfolgskriterium aus.')
      setEvidenceAssignmentError('')
      setEvidenceAssignmentProgress('')
      const evidence = await request(api.GET('/evidence/{evidence_id}', { params: { path: { evidence_id: evidenceAssignmentTarget } } }))
      const requestedTask = await request(api.GET('/tasks/{task_id}', { params: { path: { task_id: task.id } } }))
      if (evidence.task_id !== requestedTask.id) throw new Error('Der Nachweis gehört nicht mehr zu diesem Ticket.')
      if (evidence.review_status === 'rejected') throw new Error('Ein zurückgewiesener Nachweis kann nicht zugeordnet werden.')
      if (!evidenceIsCurrentForTask(evidence, requestedTask)) throw new Error('Der Nachweis ist für den aktuellen Ticketstand nicht gültig und kann nicht zugeordnet werden.')

      let currentTask = requestedTask
      let savedCount = 0
      const requestedCriteria = [...new Set(evidenceAssignmentCriteria)]
      try {
        for (const criterionId of requestedCriteria) {
          const criterion = currentTask.criteria.find((item) => item.id === criterionId)
          if (!criterion) throw new Error('Ein ausgewähltes Erfolgskriterium ist nicht mehr vorhanden. Lade das Ticket neu.')
          if (criterion.evidence_ids.includes(evidence.id)) continue
          if (!['pending', 'reported'].includes(criterion.state)) throw new Error('Ein ausgewähltes Erfolgskriterium ist nicht mehr offen. Lade das Ticket neu.')
          currentTask = await request(api.POST('/tasks/{task_id}/criteria/{criterion_id}/evidence', {
            params: { path: { task_id: currentTask.id, criterion_id: criterionId }, ...mutationParams(currentTask.version) },
            body: { evidence_ids: [evidence.id] },
          }))
          savedCount += 1
          setEvidenceAssignmentProgress(`${savedCount} Zuordnung${savedCount === 1 ? '' : 'en'} bestätigt gespeichert. Bereits gespeicherte Zuordnungen bleiben erhalten.`)
        }
      } catch (error) {
        if (savedCount > 0) setEvidenceAssignmentProgress(`${savedCount} Zuordnung${savedCount === 1 ? '' : 'en'} bestätigt gespeichert. Bereits gespeicherte Zuordnungen bleiben erhalten.`)
        throw error
      }

      return { savedCount }
    },
    onSuccess: async ({ savedCount }) => {
      await invalidate()
      setEvidenceAssignmentTarget(undefined)
      setEvidenceAssignmentCriteria([])
      setEvidenceAssignmentError('')
      setEvidenceAssignmentProgress('')
      toast.success(savedCount > 0 ? `${savedCount} Kriterium${savedCount === 1 ? '' : 'e'} zugeordnet` : 'Die ausgewählten Kriterien waren bereits zugeordnet')
    },
    onError: async (error) => {
      setEvidenceAssignmentError(formatError(error))
      toast.error(formatError(error))
      await invalidate()
    },
  })

  const reviewCriterion = useMutation({
    mutationFn: async () => {
      const criterion = task?.criteria.find((item) => item.id === reviewTarget)
      if (!task || !criterion || !reviewReason.trim()) throw new Error('Begründung erforderlich.')
      return request(api.POST('/tasks/{task_id}/criteria/{criterion_id}/review', {
        params: { path: { task_id: task.id, criterion_id: criterion.id }, ...mutationParams(task.version) },
        body: { decision: 'human_confirmed', evidence_ids: criterion.evidence_ids, reason: reviewReason.trim() },
      }))
    },
    onSuccess: async () => { setReviewTarget(undefined); setReviewReason(''); await invalidate(); toast.success('Kriterium als fachlich bestätigt gespeichert') },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  const restore = useMutation({
    mutationFn: async () => {
      if (!task || !restoreRevision || !restoreReason.trim()) throw new Error('Wähle eine wiederherstellbare Revision und gib einen Grund an.')
      return request(api.POST('/history/{revision_id}/restore', {
        params: { path: { revision_id: restoreRevision }, ...mutationParams(task.version) },
        body: { reason: restoreReason.trim() },
      }))
    },
    onSuccess: async (action) => {
      setRestoreRevision(undefined)
      setRestoreReason('')
      setRestoreActionId(action.action_id)
      await invalidate()
      toast.success('Wiederherstellung wurde angenommen')
    },
    onError: async (error) => { toast.error(formatError(error)); await invalidate() },
  })

  return (
    <>
      <Sheet open={Boolean(taskId)} onOpenChange={(open) => { if (!open) { setEditing(false); onClose() } }}>
        <SheetContent side="right" className={`flex flex-col gap-0 overflow-hidden p-0 data-[side=right]:w-full ${activeTab === 'flow' ? 'data-[side=right]:sm:max-w-[min(94vw,84rem)]' : 'data-[side=right]:sm:max-w-2xl'}`}>
          {taskQuery.isPending ? <div className="space-y-4 p-6"><div className="h-6 w-3/4 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /></div> : taskQuery.isError || !task ? (
            <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-8 text-center"><h2 className="font-semibold">Ticket konnte nicht geladen werden</h2><p className="text-sm text-muted-foreground">{formatError(taskQuery.error)}</p><Button variant="outline" onClick={() => void taskQuery.refetch()}><RefreshCw />Erneut laden</Button></div>
          ) : (
            <>
              <SheetHeader className="border-b px-6 py-5 pr-14 text-left">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-mono">{task.key}</span><span>·</span><span>{project.name}</span></div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><SheetTitle className="text-xl leading-7">{task.title}</SheetTitle><SheetDescription className="mt-2">Ticket · Version {task.version} · {task.origin === 'manual' ? 'Von dir angelegt' : `Eingang über ${task.origin === 'mcp' ? 'MCP' : 'technische API'}`}</SheetDescription></div>
                  <Button size="sm" variant="outline" onClick={beginTaskEdit}>Bearbeiten</Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Select value={task.status_id} onValueChange={(statusId) => moveTask.mutate(statusId)}><SelectTrigger aria-label="Ticketstatus" className="h-8 w-auto min-w-36 text-xs"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}</SelectContent></Select>
                  <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'} className="capitalize">{task.priority}</Badge>
                  {task.human_attention.required && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Mensch erforderlich</Badge>}
                  {task.intake_outcome === 'needs_information' && <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-900">Rückfrage an Agent</Badge>}
                </div>
              </SheetHeader>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <TabsList className="falkenwarte-scrollbar mx-4 mt-4 w-auto min-w-0 self-stretch justify-start overflow-x-auto overflow-y-hidden sm:mx-6"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="flow"><GitBranch />Ablauf</TabsTrigger><TabsTrigger value="decisions"><ShieldCheck />Entscheidungen</TabsTrigger><TabsTrigger value="execution"><Play />Ausführung</TabsTrigger><TabsTrigger value="history"><History />Verlauf</TabsTrigger>{linkNotesContribution && <TabsTrigger value="link-notes"><Link2 />{linkNotesContribution.label}</TabsTrigger>}</TabsList>
                <TabsContent value="details" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 space-y-6 overflow-y-auto px-6 pb-8 pt-5">
                  <section className="space-y-2"><h3 className="text-sm font-semibold">Beschreibung</h3><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.description || 'Keine Beschreibung hinterlegt.'}</p></section>
                  {(Object.keys(task.custom_fields).length > 0 || customFields.length > 0) && <section className="space-y-3"><h3 className="text-sm font-semibold">Projektfelder</h3>{customFieldsQuery.isError && <p role="alert" className="text-xs text-destructive">Feldnamen konnten nicht geladen werden: {formatError(customFieldsQuery.error)}</p>}<CustomFieldValues fields={customFields} values={task.custom_fields} />{Object.keys(task.custom_fields).length === 0 && <p className="text-sm text-muted-foreground">Für dieses Ticket sind keine Projektfeldwerte hinterlegt.</p>}</section>}
                  <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Erfolgskriterien</h3><Button size="sm" variant="outline" onClick={() => setEvidenceOpen(true)}><Plus />Meldung hinzufügen</Button></div>
                    {task.criteria.length ? <div className="space-y-2">{task.criteria.map((criterion) => <div key={criterion.id} className="rounded-lg border p-3">
                      <div className="flex items-start gap-3"><div className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${criterion.state === 'human_confirmed' ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'}`}>{criterion.state === 'human_confirmed' ? '✓' : '·'}</div><div className="min-w-0 flex-1"><p className="text-sm">{criterion.text}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{criterion.is_required ? 'Erforderlich' : 'Optional'}</span><span>·</span><span>{criterion.state === 'human_confirmed' ? 'Menschlich bestätigt' : criterion.state === 'reported' ? 'Agentenmeldung liegt vor' : criterion.state === 'rejected' ? 'Zurückgewiesen' : 'Offen'}</span>{criterion.evidence_ids.length > 0 && <><span>·</span><span>{criterion.evidence_ids.length} Meldung(en)</span></>}</div></div>
                        {criterion.state !== 'human_confirmed' && criterion.evidence_ids.length > 0 && <Button size="sm" variant="outline" onClick={() => setReviewTarget(criterion.id)}><ShieldCheck />Bestätigen</Button>}
                      </div>
                    </div>)}</div> : <p className="text-sm text-muted-foreground">Für dieses Ticket sind keine Kriterien festgelegt.</p>}
                  </section>
                  {task.blocked && <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Blockiert</strong><p className="mt-1">{task.blocker_reason}</p></section>}
                  <section className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Link-Sammlungen</h3><Button size="sm" variant="outline" onClick={() => setLinkForm((value) => !value)}><Plus />Link hinzufügen</Button></div>
                    {linkForm && <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                      <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="link-collection-name">Sammlung</Label><Input id="link-collection-name" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} maxLength={100} /></div><div className="grid gap-2"><Label htmlFor="link-collection-kind">Sammlungstyp</Label><Select value={collectionKind} onValueChange={(value) => setCollectionKind(value as typeof collectionKind)}><SelectTrigger id="link-collection-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="source">Quelle</SelectItem><SelectItem value="delivery">Ergebnis</SelectItem><SelectItem value="reference">Referenz</SelectItem></SelectContent></Select></div></div>
                      <div className="grid gap-2"><Label htmlFor="link-title">Titel</Label><Input id="link-title" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} maxLength={300} /></div><div className="grid gap-2"><Label htmlFor="link-url">URL</Label><Input id="link-url" type="url" placeholder="https://…" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} maxLength={4000} /></div>
                      <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="link-kind">Linktyp</Label><Select value={linkKind} onValueChange={(value) => setLinkKind(value as typeof linkKind)}><SelectTrigger id="link-kind"><SelectValue /></SelectTrigger><SelectContent>{linkKinds.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="link-relation">Beziehung</Label><Select value={linkRelation} onValueChange={(value) => setLinkRelation(value as typeof linkRelation)}><SelectTrigger id="link-relation"><SelectValue /></SelectTrigger><SelectContent>{linkRelations.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div>
                      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setLinkForm(false)}>Abbrechen</Button><Button size="sm" onClick={() => registerLink.mutate()} disabled={registerLink.isPending || !linkTitle.trim() || !linkUrl.trim()}>{registerLink.isPending ? 'Wird gespeichert…' : 'Link registrieren'}</Button></div>
                    </div>}
                    {linksQuery.isPending ? <p className="text-sm text-muted-foreground">Links werden geladen…</p> : linksQuery.isError ? <p role="alert" className="text-sm text-destructive">{formatError(linksQuery.error)}</p> : linkCollections.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine externen Referenzen gespeichert.</p> : <div className="space-y-3">{linkCollections.map((collection) => <div key={collection.id} className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-medium">{collection.name}</h4><Badge variant="secondary" className="capitalize">{collection.kind === 'delivery' ? 'Ergebnis' : collection.kind === 'source' ? 'Quelle' : 'Referenz'}</Badge></div>{collection.links.length === 0 ? <p className="text-xs text-muted-foreground">Noch keine Links.</p> : <div className="space-y-2">{collection.links.map((link) => <div key={link.id} className="rounded-md px-2 py-2 hover:bg-muted"><a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-sm"><Link2 className="mt-0.5 size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block font-medium">{link.title}</span><span className="block truncate text-xs text-muted-foreground">{link.url}</span></span><ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /></a><div className="mt-1 flex gap-1 pl-6"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setEditingLink({ collectionId: collection.id, taskVersion: collection.task_version, link }); setLinkTitle(link.title); setLinkUrl(link.url); setLinkKind(link.kind); setLinkRelation(link.relation); setLinkForm(false) }}><Pencil />Link bearbeiten</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => setRemovingLink({ collectionId: collection.id, taskVersion: collection.task_version, link })}><Trash2 />Entfernen</Button></div></div>)}</div>}</div>)}</div>}
                    <p className="text-xs text-muted-foreground">Links sind registrierte Referenzen. Falkenwarte liest keine Inhalte oder Statuswerte von externen Seiten.</p>
                  </section>
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Gemeldete Nachweise</h3>
                    {evidenceQuery.isPending ? <p className="text-sm text-muted-foreground">Meldungen werden geladen…</p> : evidenceQuery.isError ? <p role="alert" className="text-sm text-destructive">Meldungen konnten nicht geladen werden: {formatError(evidenceQuery.error)}</p> : evidenceItems.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Meldungen. Ein Nachweis bleibt als menschliche oder Agentenmeldung gekennzeichnet.</p> : <div className="space-y-2">{evidenceItems.map((item) => {
                      const linkedCriteria = task.criteria.filter((criterion) => criterion.evidence_ids.includes(item.id))
                      const openCriteria = task.criteria.filter((criterion) => ['pending', 'reported'].includes(criterion.state) && !criterion.evidence_ids.includes(item.id))
                      const linkedToConfirmedCriterion = item.review_status !== 'rejected'
                        && linkedCriteria.some((criterion) => criterion.state === 'human_confirmed')
                      const legacyCurrentCriterionLink = item.review_status !== 'rejected'
                        && linkedCriteria.some((criterion) => criterion.state === 'human_confirmed' || (item.run_id !== null && criterion.state === 'reported'))
                      const isCurrent = typeof item.current_for_task === 'boolean'
                        ? item.current_for_task
                        : item.task_revision === task.version || legacyCurrentCriterionLink
                      const stale = !isCurrent && !linkedToConfirmedCriterion
                      const canAssign = item.review_status !== 'rejected' && evidenceIsCurrentForTask(item, task) && openCriteria.length > 0

                      return <div key={item.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{item.label}</p><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.review_status === 'human_confirmed' ? 'Menschlich bestätigt' : item.review_status === 'rejected' ? 'Zurückgewiesen' : 'Gemeldet'}</Badge>{stale && <Badge variant="destructive">Veraltet</Badge>}</div></div>
                        {item.text && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.text}</p>}
                        {linkedCriteria.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">Bereits zugeordnet: {linkedCriteria.map((criterion) => criterion.text).join(' · ')}</p> : <p className="mt-2 text-xs text-muted-foreground">Noch keinem Erfolgskriterium zugeordnet.</p>}
                        {(isCurrent || linkedToConfirmedCriterion) && item.task_revision !== task.version && <p className="mt-2 text-xs text-muted-foreground">Nachweis aus Ticketversion {item.task_revision}.</p>}
                        {item.review_status === 'rejected' && <p className="mt-2 text-xs text-destructive">Zurückgewiesene Nachweise lassen sich nicht zuordnen.</p>}
                        {stale && <p className="mt-2 text-xs text-destructive">Dieser Nachweis bezieht sich auf Ticketversion {item.task_revision}, aktuell ist Version {task.version}. Er lässt sich nicht zuordnen.</p>}
                        {item.review_status !== 'rejected' && !stale && openCriteria.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Keine offenen Kriterien ohne diese Zuordnung verfügbar.</p>}
                        {canAssign && <Button size="sm" variant="outline" className="mt-2" disabled={assignEvidence.isPending} onClick={() => { setEvidenceAssignmentTarget(item.id); setEvidenceAssignmentCriteria([]); setEvidenceAssignmentError(''); setEvidenceAssignmentProgress('') }}><Link2 />Kriterien zuordnen</Button>}
                      </div>
                    })}</div>}
                  </section>
                </TabsContent>
                <TabsContent value="flow" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
                  <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Ablauf wird geladen…</p>}>
                    <TaskFlow
                      task={task}
                      projectId={project.id}
                      statuses={statuses}
                      labelNames={new Map(labelsQuery.data?.items.map((label) => [label.id, label.name]))}
                      flow={taskFlow}
                      loading={taskFlowQuery.isPending}
                      error={taskFlowQuery.isError && !taskFlow ? formatError(taskFlowQuery.error) : undefined}
                      loadingMore={taskFlowQuery.isFetchingNextPage}
                      hasMore={taskFlow?.has_more ?? false}
                      onOpenDetails={() => setActiveTab('details')}
                      onOpenExecution={() => setActiveTab('execution')}
                      onRetry={() => { void taskFlowQuery.refetch() }}
                      onLoadMore={() => { void taskFlowQuery.fetchNextPage() }}
                    />
                  </Suspense>
                </TabsContent>
                <TabsContent value="decisions" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
                  <TaskDecisions task={task} project={project} onChanged={invalidate} />
                </TabsContent>
                <TabsContent value="execution" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
                  <TaskExecution task={task} project={project} boardId={board?.id} boardPolicy={taskFlow?.board_workflow_policy} boardPolicyError={taskFlowQuery.isError ? formatError(taskFlowQuery.error) : undefined} retryBoardPolicy={() => void taskFlowQuery.refetch()} onChanged={invalidate} onOpenDecisions={() => setActiveTab('decisions')} />
                </TabsContent>
                <TabsContent value="history" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
                  {restoreActionQuery.data && <div className={`mb-5 rounded-lg border p-3 text-sm ${restoreActionQuery.data.status === 'failed' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-primary/20 bg-accent text-accent-foreground'}`} role="status"><p className="font-medium">{restoreActionQuery.data.status === 'succeeded' ? 'Wiederherstellung abgeschlossen' : restoreActionQuery.data.status === 'failed' ? 'Wiederherstellung fehlgeschlagen' : 'Wiederherstellung läuft'}</p><p className="mt-1 text-xs">Action {restoreActionQuery.data.id}</p></div>}
                  {historyQuery.isPending ? <p className="text-sm text-muted-foreground">Verlauf wird geladen…</p> : historyQuery.isError ? <p role="alert" className="text-sm text-destructive">{formatError(historyQuery.error)}</p> : historyQuery.data?.items.length ? <div className="space-y-0">{historyQuery.data.items.map((revision) => <div key={revision.id} className="relative border-l pb-5 pl-5 last:pb-0"><span className="absolute -left-1.5 top-1 size-3 rounded-full border-2 border-primary bg-background" /><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-sm font-medium">{revision.summary}</p><time className="text-xs text-muted-foreground">{new Date(revision.recorded_at).toLocaleString('de-DE')}</time></div>{revision.restorable && <Button size="sm" variant="outline" onClick={() => setRestoreRevision(revision.id)}>Wiederherstellen</Button>}</div>{revision.reason && <p className="mt-1 text-xs text-muted-foreground">Grund: {revision.reason}</p>}<p className="mt-1 text-xs text-muted-foreground">{revision.actor.display_name}</p><RevisionFields fields={revision.custom_field_values} /></div>)}</div> : <p className="text-sm text-muted-foreground">Für dieses Ticket ist noch kein Verlauf vorhanden.</p>}
                </TabsContent>
                {linkNotesContribution && <TabsContent value="link-notes" className="falkenwarte-scrollbar mt-0 min-w-0 flex-1 overflow-y-auto px-6 pb-8 pt-5"><LinkNotesPanel taskId={task.id} projectId={project.id} /></TabsContent>}
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={editing} onOpenChange={(open) => { setEditing(open); if (!open) { setSaveConflict(''); setEditBaseVersion(undefined) } }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Ticket bearbeiten</DialogTitle><DialogDescription>Änderungen erzeugen eine neue Version und werden im Verlauf festgehalten.</DialogDescription></DialogHeader>{saveConflict && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>{saveConflict}</p><div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={rebaseTaskEdit}>Aktuelle Version als Basis verwenden</Button><Button variant="outline" size="sm" onClick={reloadTaskEdit}>Formular mit aktuellem Stand laden</Button></div></div>}<div className="grid max-h-[65vh] gap-4 overflow-y-auto py-2 pr-1"><div className="grid gap-2"><Label htmlFor="edit-title">Titel</Label><Input id="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} /></div><div className="grid gap-2"><Label htmlFor="edit-description">Beschreibung</Label><Textarea id="edit-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={20000} /></div><div className="grid gap-2"><Label htmlFor="edit-priority">Priorität</Label><Select value={priority} onValueChange={(value) => setPriority(value as Task['priority'])}><SelectTrigger id="edit-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Niedrig</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Hoch</SelectItem><SelectItem value="urgent">Dringend</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="edit-criteria">Erfolgskriterien</Label><Textarea id="edit-criteria" value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} rows={4} placeholder="Ein Kriterium pro Zeile" /></div>{customFieldsQuery.isPending ? <p className="text-xs text-muted-foreground">Projektfelder werden geladen…</p> : customFieldsQuery.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>Projektfelder konnten nicht geladen werden: {formatError(customFieldsQuery.error)}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void customFieldsQuery.refetch()}>Projektfelder erneut laden</Button></div> : <><CustomFieldInputs fields={customFields} value={customFieldDraftValues} onChange={(key, value) => setCustomFieldDraftValues((current) => ({ ...current, [key]: value }))} idPrefix="edit-task-field" /><CustomFieldValues fields={customFields} values={task?.custom_fields ?? {}} onlyInactive /></>}{missingCustomFields.length > 0 && <p className="text-xs text-amber-800">Erforderlich: {missingCustomFields.join(', ')}</p>}<fieldset className="grid gap-2"><legend className="text-sm font-medium">Labels</legend>{labels.length ? labels.map((label) => <label key={label.id} className="flex items-center gap-2 text-sm"><Checkbox checked={labelIds.includes(label.id)} onCheckedChange={(checked) => setLabelIds((current) => checked ? [...current, label.id] : current.filter((id) => id !== label.id))} /><span className="size-2 rounded-full" style={{ backgroundColor: label.color }} /><span>{label.name}</span><span className="ml-auto text-xs text-muted-foreground">{label.kind === 'workflow' ? 'Workflow' : 'Thema'}</span></label>) : <p className="text-xs text-muted-foreground">Für dieses Projekt sind noch keine Labels angelegt.</p>}</fieldset></div><DialogFooter><Button variant="outline" onClick={() => setEditing(false)}>Abbrechen</Button><Button onClick={() => saveTask.mutate()} disabled={!title.trim() || customFieldsQuery.isPending || customFieldsQuery.isError || missingCustomFields.length > 0 || saveTask.isPending}>{saveTask.isPending ? 'Speichert…' : 'Änderungen speichern'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Meldung hinzufügen</DialogTitle><DialogDescription>Speichere eine nachvollziehbare Meldung zu einem Erfolgskriterium. Die Meldung ist keine automatische Codeprüfung.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label htmlFor="evidence-label">Bezeichnung</Label><Input id="evidence-label" value={evidenceLabel} onChange={(event) => setEvidenceLabel(event.target.value)} maxLength={200} /></div><div className="grid gap-2"><Label htmlFor="evidence-text">Meldung</Label><Textarea id="evidence-text" value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} rows={4} maxLength={10000} /></div><fieldset className="grid gap-2"><legend className="text-sm font-medium">Kriterien zuordnen</legend>{task?.criteria.map((criterion) => <label key={criterion.id} className="flex items-start gap-2 text-sm"><Checkbox checked={evidenceCriteria.includes(criterion.id)} onCheckedChange={(checked) => setEvidenceCriteria((current) => checked ? [...current, criterion.id] : current.filter((id) => id !== criterion.id))} /><span>{criterion.text}</span></label>)}</fieldset></div><DialogFooter><Button variant="outline" onClick={() => setEvidenceOpen(false)}>Abbrechen</Button><Button onClick={() => registerEvidence.mutate()} disabled={!evidenceLabel.trim() || !evidenceText.trim() || registerEvidence.isPending}>{registerEvidence.isPending ? 'Speichert…' : 'Meldung speichern'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(evidenceAssignmentTarget)} onOpenChange={(open) => {
        if (open || assignEvidence.isPending) return
        setEvidenceAssignmentTarget(undefined)
        setEvidenceAssignmentCriteria([])
        setEvidenceAssignmentError('')
        setEvidenceAssignmentProgress('')
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Kriterien zuordnen</DialogTitle>
            <DialogDescription>Ordne einen bestehenden Nachweis offenen Erfolgskriterien zu. Inhalt und Herkunft der Meldung bleiben erhalten; die Zuordnung bestätigt kein Kriterium.</DialogDescription>
          </DialogHeader>
          {evidenceAssignmentEvidence && <div className="rounded-lg border p-3"><p className="text-sm font-medium">{evidenceAssignmentEvidence.label}</p>{evidenceAssignmentEvidence.text && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{evidenceAssignmentEvidence.text}</p>}</div>}
          {evidenceAssignmentLinkedCriteria.length > 0 && <p role="status" className="text-sm text-muted-foreground">Bereits zugeordnet: {evidenceAssignmentLinkedCriteria.map((criterion) => criterion.text).join(' · ')}</p>}
          {evidenceAssignmentEvidence?.review_status === 'rejected' && <p role="alert" className="text-sm text-destructive">Dieser Nachweis wurde zurückgewiesen und kann nicht zugeordnet werden.</p>}
          {evidenceAssignmentIsStale && evidenceAssignmentEvidence && task && <p role="alert" className="text-sm text-destructive">Dieser Nachweis bezieht sich auf Ticketversion {evidenceAssignmentEvidence.task_revision}, aktuell ist Version {task.version}. Er lässt sich nicht zuordnen.</p>}
          {evidenceAssignmentAvailableCriteria.length > 0 ? <fieldset className="grid gap-2 py-2">
            <legend className="text-sm font-medium">Offene Kriterien</legend>
            {evidenceAssignmentAvailableCriteria.map((criterion) => <label key={criterion.id} className="flex items-start gap-2 text-sm">
              <Checkbox aria-label={criterion.text} checked={evidenceAssignmentCriteria.includes(criterion.id)} onCheckedChange={(checked) => {
                setEvidenceAssignmentError('')
                setEvidenceAssignmentCriteria((current) => checked ? current.includes(criterion.id) ? current : [...current, criterion.id] : current.filter((id) => id !== criterion.id))
              }} />
              <span>{criterion.text}</span>
            </label>)}
          </fieldset> : <p className="py-2 text-sm text-muted-foreground">{task?.criteria.length ? 'Es gibt keine offenen, noch nicht zugeordneten Kriterien.' : 'Für dieses Ticket sind keine Erfolgskriterien festgelegt.'}</p>}
          {evidenceAssignmentProgress && <p role="status" className="text-sm text-muted-foreground">{evidenceAssignmentProgress}</p>}
          {evidenceAssignmentError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{evidenceAssignmentError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEvidenceAssignmentTarget(undefined); setEvidenceAssignmentCriteria([]); setEvidenceAssignmentError(''); setEvidenceAssignmentProgress('') }} disabled={assignEvidence.isPending}>Abbrechen</Button>
            <Button onClick={() => assignEvidence.mutate()} disabled={assignEvidence.isPending || !evidenceAssignmentCriteria.some((id) => evidenceAssignmentAvailableCriteria.some((criterion) => criterion.id === id))}>
              {assignEvidence.isPending ? 'Speichert…' : 'Zuordnung speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingLink)} onOpenChange={(open) => { if (!open) { setEditingLink(undefined); setLinkForm(false) } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Link bearbeiten</DialogTitle><DialogDescription>Die Referenz bleibt in ihrer Sammlung und Reihenfolge. Gespeicherte Bestätigungen können dadurch ungültig werden.</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-2"><Label htmlFor="edit-link-title">Titel</Label><Input id="edit-link-title" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} maxLength={300} /></div><div className="grid gap-2"><Label htmlFor="edit-link-url">URL</Label><Input id="edit-link-url" type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} maxLength={4000} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label>Linktyp</Label><Select value={linkKind} onValueChange={(value) => setLinkKind(value as typeof linkKind)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{linkKinds.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Beziehung</Label><Select value={linkRelation} onValueChange={(value) => setLinkRelation(value as typeof linkRelation)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{linkRelations.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div></div></div><DialogFooter><Button variant="outline" onClick={() => { setEditingLink(undefined); setLinkForm(false) }}>Abbrechen</Button><Button onClick={() => updateLink.mutate()} disabled={!linkTitle.trim() || !linkUrl.trim() || updateLink.isPending}>{updateLink.isPending ? 'Speichert…' : 'Link speichern'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(removingLink)} onOpenChange={(open) => { if (!open) setRemovingLink(undefined) }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Link entfernen?</DialogTitle><DialogDescription>„{removingLink?.link.title}“ wird aus dieser Sammlung entfernt. Der Verlauf bleibt erhalten.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRemovingLink(undefined)}>Abbrechen</Button><Button variant="destructive" onClick={() => removeLink.mutate()} disabled={removeLink.isPending}>{removeLink.isPending ? 'Wird entfernt…' : 'Link entfernen'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => { if (!open) { setReviewTarget(undefined); setReviewReason('') } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Kriterium bestätigen</DialogTitle><DialogDescription>Die Bestätigung hält deine fachliche Entscheidung fest und bezieht sich auf die verknüpften Meldungen.</DialogDescription></DialogHeader><div className="grid gap-2 py-2"><Label htmlFor="review-reason">Begründung</Label><Textarea id="review-reason" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} rows={3} maxLength={2000} required /></div><DialogFooter><Button variant="outline" onClick={() => setReviewTarget(undefined)}>Abbrechen</Button><Button onClick={() => reviewCriterion.mutate()} disabled={!reviewReason.trim() || reviewCriterion.isPending}>{reviewCriterion.isPending ? 'Speichert…' : 'Fachlich bestätigen'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(restoreRevision)} onOpenChange={(open) => { if (!open) { setRestoreRevision(undefined); setRestoreReason('') } }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Ticketstand wiederherstellen</DialogTitle><DialogDescription>Die Wiederherstellung erzeugt eine neue Revision. Externe Agentarbeit wird dadurch nicht zurückgesetzt.</DialogDescription></DialogHeader><div className="grid gap-2 py-2"><Label htmlFor="restore-reason">Grund</Label><Textarea id="restore-reason" value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} rows={3} maxLength={2000} required /></div><DialogFooter><Button variant="outline" onClick={() => setRestoreRevision(undefined)}>Abbrechen</Button><Button onClick={() => restore.mutate()} disabled={!restoreReason.trim() || restore.isPending}>{restore.isPending ? 'Wird angefordert…' : 'Wiederherstellen'}</Button></DialogFooter></DialogContent></Dialog>
    </>
  )
}
