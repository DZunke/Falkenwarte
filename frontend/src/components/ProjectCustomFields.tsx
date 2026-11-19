import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Project } from '@/lib/api'
import { useProjectCustomFields } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Definition = components['schemas']['CustomFieldDefinition']
type DefinitionWrite = components['schemas']['CustomFieldWrite']
type ValueType = Definition['value_type']

const valueTypeLabels: Record<ValueType, string> = {
  text: 'Text', number: 'Zahl', boolean: 'Ja/Nein', date: 'Datum', choice: 'Auswahl', multi_choice: 'Mehrfachauswahl',
}

export default function ProjectCustomFields({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const fieldsQuery = useProjectCustomFields(project.id)
  const [open, setOpen] = useState(false)
  const [editingField, setEditingField] = useState<Definition>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [valueType, setValueType] = useState<ValueType>('text')
  const [required, setRequired] = useState(false)
  const [active, setActive] = useState(true)
  const [choicesText, setChoicesText] = useState('')

  const resetEditor = () => {
    setEditingField(undefined)
    setKey('')
    setLabel('')
    setValueType('text')
    setRequired(false)
    setActive(true)
    setChoicesText('')
  }

  const beginCreate = () => {
    resetEditor()
    setEditorOpen(true)
  }

  const beginEdit = (field: Definition) => {
    setEditingField(field)
    setKey(field.key)
    setLabel(field.label)
    setValueType(field.value_type)
    setRequired(field.required)
    setActive(field.active)
    setChoicesText(field.choices.join('\n'))
    setEditorOpen(true)
  }

  const saveField = useMutation({
    mutationFn: async () => {
      const choices = ['choice', 'multi_choice'].includes(valueType)
        ? [...new Set(choicesText.split('\n').map((choice) => choice.trim()).filter(Boolean))]
        : []
      if (!label.trim()) throw new Error('Gib einen Feldnamen ein.')
      if (!/^[a-z][a-z0-9_.-]*\.[a-z][a-z0-9_-]*$/.test(key.trim())) throw new Error('Der Schlüssel muss einen Namensraum und Feldnamen enthalten, zum Beispiel projekt.erscheinungsdatum.')
      if (['choice', 'multi_choice'].includes(valueType) && choices.length === 0) throw new Error('Füge mindestens eine Auswahloption hinzu.')
      const body: DefinitionWrite = {
        key: key.trim(),
        label: label.trim(),
        value_type: valueType,
        required,
        choices,
        active,
      }
      if (editingField) {
        return request(api.PUT('/projects/{project_id}/custom-fields/{field_id}', {
          params: { path: { project_id: project.id, field_id: editingField.id }, ...mutationParams(editingField.version) },
          body,
        }))
      }
      return request(api.POST('/projects/{project_id}/custom-fields', {
        params: { path: { project_id: project.id }, ...mutationParams() },
        body,
      }))
    },
    onSuccess: async () => {
      setEditorOpen(false)
      resetEditor()
      await queryClient.invalidateQueries({ queryKey: ['project-custom-fields', project.id] })
      toast.success(editingField ? 'Projektfeld gespeichert' : 'Projektfeld angelegt')
    },
    onError: async (error) => {
      toast.error(formatError(error))
      await queryClient.invalidateQueries({ queryKey: ['project-custom-fields', project.id] })
    },
  })

  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={project.archived}>Zusatzfelder</Button>
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setEditorOpen(false); resetEditor() } }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Projektfelder</DialogTitle>
          <DialogDescription>Lege typisierte Zusatzangaben für alle Tickets dieses Projekts fest. Inaktive Felder und vorhandene Werte bleiben im Ticketverlauf lesbar.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[55vh] gap-3 overflow-y-auto py-1 pr-1">
          {fieldsQuery.isPending ? <p className="text-sm text-muted-foreground">Projektfelder werden geladen…</p> : fieldsQuery.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{formatError(fieldsQuery.error)}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void fieldsQuery.refetch()}>Erneut laden</Button></div> : fieldsQuery.data?.items.length ? fieldsQuery.data.items.map((field) => <article key={field.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{field.label}</h3><Badge variant="secondary">{valueTypeLabels[field.value_type]}</Badge>{field.required && <Badge variant="outline">Erforderlich</Badge>}{!field.active && <Badge variant="outline">Inaktiv</Badge>}</div>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{field.key}</p>
              {field.choices.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Auswahl: {field.choices.join(' · ')}</p>}
              {field.plugin_id && <p className="mt-1 text-xs text-muted-foreground">Von Erweiterung {field.plugin_id} verwaltet.</p>}
            </div>
            {!field.plugin_id && <Button size="sm" variant="outline" onClick={() => beginEdit(field)}>Feld bearbeiten: {field.label}</Button>}
          </article>) : <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Noch keine Zusatzfelder angelegt.</p>}
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => setOpen(false)}>Schließen</Button>
          <Button onClick={beginCreate} disabled={project.archived || fieldsQuery.isError}>Zusatzfeld anlegen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={editorOpen} onOpenChange={(next) => { setEditorOpen(next); if (!next) resetEditor() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingField ? 'Projektfeld bearbeiten' : 'Zusatzfeld anlegen'}</DialogTitle>
          <DialogDescription>Der Schlüssel bleibt nach dem Anlegen unveränderlich und wird in API und Verlauf verwendet.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-1 pr-1">
          <div className="grid gap-2"><Label htmlFor="custom-field-label">Feldname</Label><Input id="custom-field-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} autoFocus /></div>
          <div className="grid gap-2"><Label htmlFor="custom-field-key">Schlüssel</Label><Input id="custom-field-key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="projekt.erscheinungsdatum" disabled={Boolean(editingField)} maxLength={160} /><p className="text-xs text-muted-foreground">Format: namensraum.feldname, zum Beispiel projekt.erscheinungsdatum.</p></div>
          <div className="grid gap-2"><Label htmlFor="custom-field-type">Feldtyp</Label><Select value={valueType} onValueChange={(next) => setValueType(next as ValueType)} disabled={Boolean(editingField)}><SelectTrigger id="custom-field-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(valueTypeLabels).map(([value, title]) => <SelectItem key={value} value={value}>{title}</SelectItem>)}</SelectContent></Select></div>
          {['choice', 'multi_choice'].includes(valueType) && <div className="grid gap-2"><Label htmlFor="custom-field-choices">Auswahlen</Label><Textarea id="custom-field-choices" value={choicesText} onChange={(event) => setChoicesText(event.target.value)} placeholder={'Backlog\nIn Arbeit\nErledigt'} rows={4} /><p className="text-xs text-muted-foreground">Eine Option pro Zeile. Vorhandene Werte können nicht aus der Liste entfernt werden.</p></div>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={required} onCheckedChange={(checked) => setRequired(Boolean(checked))} />Erforderlich</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onCheckedChange={(checked) => setActive(Boolean(checked))} />Aktiv</label>
          {editingField?.plugin_id && <p className="text-xs text-muted-foreground">Diese Definition wird von der zugehörigen Erweiterung verwaltet.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setEditorOpen(false); resetEditor() }}>Abbrechen</Button><Button onClick={() => saveField.mutate()} disabled={!label.trim() || !key.trim() || saveField.isPending}>{saveField.isPending ? 'Speichert…' : 'Feld speichern'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
