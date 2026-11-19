import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, formatError, mutationParams, request, type Task } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export default function LinkNotesPanel({ taskId, projectId: _projectId }: { taskId: string; projectId?: string }) {
  const queryClient = useQueryClient()
  const [linkId, setLinkId] = useState('')
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const notesQuery = useQuery({
    queryKey: ['link-notes', taskId],
    queryFn: () => request(api.GET('/tasks/{task_id}/link-notes', { params: { path: { task_id: taskId } } })),
  })
  const linksQuery = useQuery({
    queryKey: ['task-links', taskId],
    queryFn: () => request(api.GET('/tasks/{task_id}/link-collections', { params: { path: { task_id: taskId } } })),
  })
  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => request(api.GET('/tasks/{task_id}', { params: { path: { task_id: taskId } } })),
  })
  const pluginQuery = useQuery({
    queryKey: ['plugin', 'falkenwarte.link-notes'],
    queryFn: () => request(api.GET('/plugins/{plugin_id}', { params: { path: { plugin_id: 'falkenwarte.link-notes' } } })),
  })
  const links = useMemo(() => linksQuery.data?.items.flatMap((collection) => collection.links) ?? [], [linksQuery.data])
  const notes = notesQuery.data?.items ?? []
  const task = taskQuery.data as Task | undefined
  const enabled = pluginQuery.data?.state === 'enabled'

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['link-notes', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['task-links', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
      queryClient.invalidateQueries({ queryKey: ['plugin', 'falkenwarte.link-notes'] }),
      queryClient.invalidateQueries({ queryKey: ['plugins'] }),
    ])
  }

  const createNote = useMutation({
    mutationFn: () => {
      if (!task) throw new Error('Das Ticket konnte nicht geladen werden.')
      return request(api.POST('/tasks/{task_id}/link-notes', {
        params: { path: { task_id: taskId }, ...mutationParams(task.version) },
        body: { link_id: linkId, note: draft.trim() },
      }))
    },
    onSuccess: async () => { setDraft(''); await refresh(); toast.success('Notiz ergänzt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const updateNote = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => {
      if (!task) throw new Error('Das Ticket konnte nicht geladen werden.')
      return request(api.PATCH('/tasks/{task_id}/link-notes/{note_id}', {
        params: { path: { task_id: taskId, note_id: id }, ...mutationParams(task.version) },
        body: { note: text.trim() },
      }))
    },
    onSuccess: async () => { setEditingId(null); setEditText(''); await refresh(); toast.success('Notiz gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const removeNote = useMutation({
    mutationFn: (id: string) => {
      if (!task) throw new Error('Das Ticket konnte nicht geladen werden.')
      return request(api.DELETE('/tasks/{task_id}/link-notes/{note_id}', {
        params: { path: { task_id: taskId, note_id: id }, ...mutationParams(task.version) },
      }))
    },
    onSuccess: async () => { await refresh(); toast.success('Notiz ausgeblendet') },
    onError: (error) => toast.error(formatError(error)),
  })

  if (notesQuery.isError || linksQuery.isError || pluginQuery.isError) {
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">Linknotizen konnten nicht geladen werden. {formatError(notesQuery.error ?? linksQuery.error ?? pluginQuery.error)}</CardContent></Card>
  }

  return (
    <section className="space-y-4" aria-labelledby="link-notes-heading">
      <div className="flex items-center gap-2">
        <NotebookPen className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="link-notes-heading" className="text-sm font-semibold">Linknotizen</h3>
        {!enabled && <span className="text-xs text-muted-foreground">Erweiterung deaktiviert · Notizen bleiben lesbar</span>}
      </div>

      {notes.length === 0 && <p className="text-sm text-muted-foreground">Zu diesem Ticketlink wurden noch keine Notizen erfasst.</p>}

      <div className="space-y-3">
        {notes.map((note) => {
          const link = links.find((item) => item.id === note.link_id)
          return (
            <article key={note.id} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-muted-foreground">{link?.title ?? 'Registrierter Ticketlink'}</p>
                  {link && <a className="text-xs text-primary underline-offset-4 hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>}
                </div>
                {enabled && <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Notiz bearbeiten" onClick={() => { setEditingId(note.id); setEditText(note.note) }}><Pencil /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Notiz ausblenden" disabled={removeNote.isPending} onClick={() => { if (window.confirm('Diese Notiz aus der Ticketansicht ausblenden? Der Eintrag bleibt in der Historie erhalten.')) removeNote.mutate(note.id) }}><Trash2 /></Button>
                </div>}
              </div>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Label htmlFor={`note-${note.id}`} className="sr-only">Notiz</Label>
                  <Textarea id={`note-${note.id}`} value={editText} onChange={(event) => setEditText(event.target.value)} maxLength={2000} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>Abbrechen</Button>
                    <Button size="sm" disabled={!editText.trim() || updateNote.isPending} onClick={() => updateNote.mutate({ id: note.id, text: editText })}>Speichern</Button>
                  </div>
                </div>
              ) : <p className="whitespace-pre-wrap text-sm">{note.note}</p>}
              <p className="mt-2 text-[11px] text-muted-foreground">{note.created_by.display_name ?? (note.created_by.kind === 'owner' ? 'Eigentümer' : 'Agent')} · {new Date(note.updated_at).toLocaleString()}</p>
            </article>
          )
        })}
      </div>

      {enabled && <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_2fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`link-note-link-${taskId}`}>Ticketlink</Label>
          <Select value={linkId} onValueChange={setLinkId}>
            <SelectTrigger id={`link-note-link-${taskId}`}><SelectValue placeholder="Link wählen" /></SelectTrigger>
            <SelectContent>{links.map((link) => <SelectItem key={link.id} value={link.id}>{link.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`link-note-text-${taskId}`}>Notiz</Label>
          <Textarea id={`link-note-text-${taskId}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Lokale Hinweise zu dieser Referenz" />
        </div>
        <Button disabled={!linkId || !draft.trim() || createNote.isPending || !task} onClick={() => createNote.mutate()}><Plus />Ergänzen</Button>
      </div>}
      {enabled && links.length === 0 && <p className="text-xs text-muted-foreground">Erfasse zuerst einen Link im Bereich „Referenzen“.</p>}
    </section>
  )
}
