import type { components } from '@/generated/api'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type CustomFieldDefinition = components['schemas']['CustomFieldDefinition']
export type CustomFields = components['schemas']['CustomFields']
export type CustomFieldDraft = Record<string, string | string[] | boolean | undefined>

const typeLabels: Record<CustomFieldDefinition['value_type'], string> = {
  text: 'Text',
  number: 'Zahl',
  boolean: 'Ja/Nein',
  date: 'Datum',
  choice: 'Auswahl',
  multi_choice: 'Mehrfachauswahl',
}

export function customFieldDraft(values: CustomFields): CustomFieldDraft {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.type === 'number' ? String(value.value) : value.value]))
}

function hasValue(field: CustomFieldDefinition, value: CustomFieldDraft[string]): boolean {
  if (field.value_type === 'boolean') return typeof value === 'boolean'
  if (field.value_type === 'multi_choice') return Array.isArray(value) && (!field.required || value.length > 0)
  if (typeof value !== 'string' || value.trim() === '') return false
  return field.value_type !== 'number' || Number.isFinite(Number(value))
}

export function missingRequiredCustomFields(fields: CustomFieldDefinition[], draft: CustomFieldDraft): string[] {
  return fields.filter((field) => field.active && field.required && !hasValue(field, draft[field.key])).map((field) => field.label)
}

export function customFieldsPayload(fields: CustomFieldDefinition[], draft: CustomFieldDraft): CustomFields {
  const values: Record<string, components['schemas']['CustomFieldValue']> = {}
  for (const field of fields) {
    if (!field.active) continue
    const raw = draft[field.key]
    if (raw === undefined) continue

    switch (field.value_type) {
      case 'text':
      case 'date':
      case 'choice':
        if (typeof raw === 'string' && raw.trim() !== '') values[field.key] = { type: field.value_type, value: raw }
        break
      case 'number':
        if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) values[field.key] = { type: 'number', value: Number(raw) }
        break
      case 'boolean':
        if (typeof raw === 'boolean') values[field.key] = { type: 'boolean', value: raw }
        break
      case 'multi_choice':
        if (Array.isArray(raw)) values[field.key] = { type: 'multi_choice', value: raw }
        break
    }
  }
  return values
}

export function CustomFieldInputs({ fields, value, onChange, idPrefix, disabled = false }: {
  fields: CustomFieldDefinition[]
  value: CustomFieldDraft
  onChange: (key: string, next: CustomFieldDraft[string]) => void
  idPrefix: string
  disabled?: boolean
}) {
  const activeFields = fields.filter((field) => field.active)
  if (!activeFields.length) return null

  return <fieldset className="grid gap-4 rounded-lg border p-4">
    <legend className="px-1 text-sm font-semibold">Projektfelder</legend>
    <p className="-mt-2 text-xs text-muted-foreground">Zusatzangaben, die für dieses Projekt festgelegt wurden.</p>
    {activeFields.map((field) => {
      const id = `${idPrefix}-${field.id}`
      const raw = value[field.key]
      const choices = field.choices
      return <div key={field.id} className="grid gap-2">
        {field.value_type === 'multi_choice' ? <fieldset className="grid gap-2">
          <legend className="flex flex-wrap items-center gap-2 text-sm font-medium">{field.label}{field.required && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Erforderlich</Badge>}</legend>
          {choices.map((choice, index) => <label key={choice} className="flex min-h-8 items-center gap-2 text-sm">
            <Checkbox id={`${id}-${index}`} checked={Array.isArray(raw) && raw.includes(choice)} disabled={disabled} onCheckedChange={(checked) => {
              const current = Array.isArray(raw) ? raw : []
              onChange(field.key, checked ? [...current, choice] : current.filter((item) => item !== choice))
            }} />
            <span>{choice}</span>
          </label>)}
        </fieldset> : <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            {field.required && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Erforderlich</Badge>}
          </div>
          {field.value_type === 'text' && <Input id={id} value={typeof raw === 'string' ? raw : ''} onChange={(event) => onChange(field.key, event.target.value)} maxLength={10000} disabled={disabled} required={field.required} />}
          {field.value_type === 'number' && <Input id={id} type="number" step="any" value={typeof raw === 'string' ? raw : ''} onChange={(event) => onChange(field.key, event.target.value)} disabled={disabled} required={field.required} />}
          {field.value_type === 'date' && <Input id={id} type="date" value={typeof raw === 'string' ? raw : ''} onChange={(event) => onChange(field.key, event.target.value)} disabled={disabled} required={field.required} />}
          {field.value_type === 'boolean' && <Select value={typeof raw === 'boolean' ? String(raw) : ''} onValueChange={(selected) => onChange(field.key, selected === 'true')} disabled={disabled}>
            <SelectTrigger id={id} aria-label={field.label}><SelectValue placeholder="Bitte auswählen" /></SelectTrigger>
            <SelectContent><SelectItem value="true">Ja</SelectItem><SelectItem value="false">Nein</SelectItem></SelectContent>
          </Select>}
          {field.value_type === 'choice' && <Select value={typeof raw === 'string' ? raw : ''} onValueChange={(selected) => onChange(field.key, selected)} disabled={disabled}>
            <SelectTrigger id={id} aria-label={field.label}><SelectValue placeholder="Bitte auswählen" /></SelectTrigger>
            <SelectContent>{choices.map((choice) => <SelectItem key={choice} value={choice}>{choice}</SelectItem>)}</SelectContent>
          </Select>}
        </>}
        <span className="text-xs text-muted-foreground">{typeLabels[field.value_type]}{field.plugin_id ? ' · Von einer Erweiterung verwaltet' : ''}</span>
      </div>
    })}
  </fieldset>
}

function displayValue(value: components['schemas']['CustomFieldValue']): string {
  if (value.type === 'boolean') return value.value ? 'Ja' : 'Nein'
  if (Array.isArray(value.value)) return value.value.join(', ')
  return String(value.value)
}

export function CustomFieldValues({ fields, values, includeInactive = true, onlyInactive = false }: {
  fields: CustomFieldDefinition[]
  values: CustomFields
  includeInactive?: boolean
  onlyInactive?: boolean
}) {
  const definitions = new Map(fields.map((field) => [field.key, field]))
  const entries = Object.entries(values).filter(([key]) => onlyInactive ? !definitions.get(key)?.active : includeInactive || definitions.get(key)?.active)
  if (!entries.length) return null

  return <dl className="grid gap-3 sm:grid-cols-2">
    {entries.map(([key, value]) => {
      const field = definitions.get(key)
      return <div key={key} className="min-w-0 rounded-lg border bg-card p-3">
        <dt className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{field?.label ?? key}</span>
          {field && !field.active && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Inaktiv · nur lesbar</Badge>}
        </dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{displayValue(value)}</dd>
      </div>
    })}
  </dl>
}
