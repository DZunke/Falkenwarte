import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, CirclePlus, KeyRound, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Project } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type DecisionPolicy = components['schemas']['DecisionPolicy']
type DecisionPolicyWrite = components['schemas']['DecisionPolicyWrite']
type DecisionConfiguration = components['schemas']['DecisionConfiguration']
type DecisionConfigurationWrite = components['schemas']['DecisionConfigurationWrite']
type IntakeRequirement = components['schemas']['IntakeRequirement']

const thresholdFields: { key: keyof Pick<DecisionPolicyWrite, 'minimum_choice_probability' | 'minimum_choice_confidence' | 'minimum_choice_margin' | 'positive_tag_threshold' | 'missing_field_threshold'>; label: string; description: string }[] = [
  { key: 'minimum_choice_probability', label: 'Mindestwahrscheinlichkeit', description: 'Wahrscheinlichkeit des gewählten Themas oder Workflows.' },
  { key: 'minimum_choice_confidence', label: 'Mindestvertrauen', description: 'Confidence des gewählten Ergebnisses.' },
  { key: 'minimum_choice_margin', label: 'Mindestabstand', description: 'Abstand zum nächstbesten Vorschlag.' },
  { key: 'positive_tag_threshold', label: 'Zusätzliche Themen', description: 'Schwelle für weitere passende Themenlabels.' },
  { key: 'missing_field_threshold', label: 'Fehlende Angaben', description: 'Schwelle, ab der eine Rückfrage ausgelöst wird.' },
]

export default function DecisionSettingsPanel({ projects }: { projects: Project[] }) {
  const client = useQueryClient()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const project = projects.find((item) => item.id === projectId) ?? projects[0]
  const configurationQuery = useQuery({
    queryKey: ['decision-configuration'],
    queryFn: () => request(api.GET('/decision-configuration', {})),
  })
  const secretsQuery = useQuery({
    queryKey: ['secret-references'],
    queryFn: () => request(api.GET('/secret-references', { params: { query: { limit: 100 } } })),
  })
  const labelsQuery = useQuery({
    queryKey: ['project-labels', project?.id],
    enabled: Boolean(project),
    queryFn: () => request(api.GET('/projects/{project_id}/labels', { params: { path: { project_id: project!.id } } })),
  })
  const policyQuery = useQuery({
    queryKey: ['decision-policy', project?.id],
    enabled: Boolean(project),
    queryFn: () => request(api.GET('/projects/{project_id}/decision-policy', { params: { path: { project_id: project!.id } } })),
  })
  const [configurationDraft, setConfigurationDraft] = useState<DecisionConfigurationWrite>()
  const [policyDraft, setPolicyDraft] = useState<DecisionPolicyWrite>()
  const [secretLabel, setSecretLabel] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const secrets = secretsQuery.data?.items ?? []
  const workflowLabels = useMemo(
    () => (labelsQuery.data?.items ?? []).filter((label) => label.active && label.kind === 'workflow' && !label.system_managed),
    [labelsQuery.data?.items],
  )

  useEffect(() => {
    const configuration = configurationQuery.data as DecisionConfiguration | undefined
    if (configuration) {
      setConfigurationDraft({
        secret_reference_id: configuration.secret_reference_id ?? '',
        timeout_ms: configuration.timeout_ms,
        max_attempts: configuration.max_attempts,
        max_requests_per_hour: configuration.max_requests_per_hour,
      })
    }
  }, [configurationQuery.data])

  useEffect(() => {
    const policy = policyQuery.data as DecisionPolicy | undefined
    if (policy) {
      setPolicyDraft({
        enabled_for_manual: policy.enabled_for_manual,
        requirements: policy.requirements.map((requirement) => ({ ...requirement, workflow_label_ids: [...requirement.workflow_label_ids] })),
        minimum_choice_probability: policy.minimum_choice_probability,
        minimum_choice_confidence: policy.minimum_choice_confidence,
        minimum_choice_margin: policy.minimum_choice_margin,
        positive_tag_threshold: policy.positive_tag_threshold,
        missing_field_threshold: policy.missing_field_threshold,
        max_clarification_rounds: policy.max_clarification_rounds,
      })
    }
  }, [policyQuery.data])

  const createSecret = useMutation({
    mutationFn: () => request(api.POST('/secret-references', {
      params: mutationParams(),
      body: { label: secretLabel.trim(), value: secretValue },
    })),
    onSuccess: async (secret) => {
      setSecretLabel('')
      setSecretValue('')
      setConfigurationDraft((current) => current ? { ...current, secret_reference_id: secret.id } : current)
      await client.invalidateQueries({ queryKey: ['secret-references'] })
      toast.success('OpenAI-Secret sicher hinterlegt; wähle es aus und speichere die Verbindung.')
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const saveConfiguration = useMutation({
    mutationFn: () => {
      if (!configurationQuery.data || !configurationDraft?.secret_reference_id) throw new Error('Wähle eine konfigurierte OpenAI-Secret-Referenz aus.')
      return request(api.PUT('/decision-configuration', {
        params: mutationParams(configurationQuery.data.version),
        body: configurationDraft,
      }))
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['decision-configuration'] }); toast.success('Decisions-Verbindung gespeichert') },
    onError: async (error) => { toast.error(formatError(error)); await client.invalidateQueries({ queryKey: ['decision-configuration'] }) },
  })

  const savePolicy = useMutation({
    mutationFn: () => {
      if (!project || !policyQuery.data || !policyDraft) throw new Error('Einordnungsregeln sind nicht verfügbar.')
      if (policyDraft.requirements.some((requirement) => !requirement.field_key.trim() || !requirement.description.trim() || !requirement.question_template.trim())) {
        throw new Error('Jede Pflichtangabe braucht einen Schlüssel, eine Beschreibung und eine Rückfragevorlage.')
      }
      return request(api.PUT('/projects/{project_id}/decision-policy', {
        params: { path: { project_id: project.id }, ...mutationParams(policyQuery.data.version) },
        body: policyDraft,
      }))
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['decision-policy', project?.id] })
      toast.success('Einordnungsregeln gespeichert')
    },
    onError: async (error) => { toast.error(formatError(error)); await client.invalidateQueries({ queryKey: ['decision-policy', project?.id] }) },
  })

  const updateRequirement = (index: number, update: Partial<IntakeRequirement>) => {
    setPolicyDraft((current) => current ? {
      ...current,
      requirements: current.requirements.map((requirement, itemIndex) => itemIndex === index ? { ...requirement, ...update } : requirement),
    } : current)
  }

  const addRequirement = () => setPolicyDraft((current) => current ? {
    ...current,
    requirements: [...current.requirements, {
      field_key: `required_detail_${current.requirements.length + 1}`,
      description: '',
      question_template: '',
      workflow_label_ids: [],
      required: true,
    }],
  } : current)

  const removeRequirement = (index: number) => setPolicyDraft((current) => current ? {
    ...current,
    requirements: current.requirements.filter((_requirement, itemIndex) => itemIndex !== index),
  } : current)

  const updateConfigurationNumber = (key: 'timeout_ms' | 'max_attempts' | 'max_requests_per_hour', value: string) => {
    setConfigurationDraft((current) => current ? { ...current, [key]: value === '' ? 0 : Number(value) } : current)
  }

  const updateThreshold = (key: typeof thresholdFields[number]['key'], value: string) => {
    setPolicyDraft((current) => current ? { ...current, [key]: value === '' ? 0 : Number(value) } : current)
  }

  return <section className="space-y-5" aria-label="Entscheidungseinordnung">
    <header><h2 className="text-xl font-semibold tracking-tight">Einordnung</h2><p className="mt-1 text-sm text-muted-foreground">OpenAI Decisions ordnet technische Eingänge anhand deiner Projektlabels und versionierten Workflowrouten ein. Eine Route erlaubt keinen automatischen Start.</p></header>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />OpenAI Decisions</CardTitle><CardDescription>Fester Anbieter: OpenAI Decisions · Modell: gpt-6-luna. Der Schlüssel wird als Secret-Referenz gespeichert und nie wieder ausgelesen.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {configurationQuery.isError || secretsQuery.isError ? <p role="alert" className="text-sm text-destructive">Decisions-Konfiguration konnte nicht geladen werden. {formatError(configurationQuery.error ?? secretsQuery.error)}</p> : null}
        {configurationQuery.isPending || secretsQuery.isPending ? <p className="text-sm text-muted-foreground">Decisions-Verbindung wird geladen…</p> : <>
          {configurationQuery.data && <div className="flex flex-wrap items-center gap-2"><Badge variant={configurationQuery.data.state === 'ready' ? 'secondary' : 'outline'}>{configurationQuery.data.state === 'ready' ? 'Verbindung konfiguriert' : configurationQuery.data.state === 'unavailable' ? 'Verbindung nicht verfügbar' : 'Noch nicht konfiguriert'}</Badge><span className="text-xs text-muted-foreground">Konfiguriert wird nur die Decisions-Anbindung, nicht T3.</span></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="decisions-secret">OpenAI-Secret-Referenz</Label><Select value={configurationDraft?.secret_reference_id ?? ''} onValueChange={(value) => setConfigurationDraft((current) => current ? { ...current, secret_reference_id: value } : current)}><SelectTrigger id="decisions-secret"><SelectValue placeholder="Secret-Referenz wählen" /></SelectTrigger><SelectContent>{secrets.filter((secret) => secret.configured).map((secret) => <SelectItem key={secret.id} value={secret.id}>{secret.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="decisions-timeout">Zeitlimit (ms)</Label><Input id="decisions-timeout" type="number" min={500} max={30000} step={500} value={configurationDraft?.timeout_ms ?? ''} onChange={(event) => updateConfigurationNumber('timeout_ms', event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="decisions-attempts">Maximale Versuche</Label><Input id="decisions-attempts" type="number" min={1} max={3} value={configurationDraft?.max_attempts ?? ''} onChange={(event) => updateConfigurationNumber('max_attempts', event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="decisions-hourly-budget">Anfragen pro Stunde</Label><Input id="decisions-hourly-budget" type="number" min={1} max={10000} value={configurationDraft?.max_requests_per_hour ?? ''} onChange={(event) => updateConfigurationNumber('max_requests_per_hour', event.target.value)} /></div>
          </div>
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5"><Label htmlFor="new-decisions-secret-label">Neue Secret-Bezeichnung</Label><Input id="new-decisions-secret-label" value={secretLabel} onChange={(event) => setSecretLabel(event.target.value)} maxLength={120} placeholder="OpenAI Decisions" /></div>
            <div className="grid gap-1.5"><Label htmlFor="new-decisions-secret-value">OpenAI API-Schlüssel</Label><Input id="new-decisions-secret-value" type="password" autoComplete="new-password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} /></div>
            <Button variant="outline" disabled={!secretLabel.trim() || !secretValue || createSecret.isPending} onClick={() => createSecret.mutate()}>{createSecret.isPending ? 'Wird verschlüsselt…' : 'Secret anlegen'}</Button>
          </div>
          <div className="flex justify-end"><Button disabled={!configurationQuery.data || !configurationDraft?.secret_reference_id || saveConfiguration.isPending} onClick={() => saveConfiguration.mutate()}><Save />{saveConfiguration.isPending ? 'Speichert…' : 'Verbindung speichern'}</Button></div>
        </>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Rückfragen und Schwellen</CardTitle><CardDescription>Pflichtangaben werden aus festen Vorlagen erstellt; technische Eingänge bleiben immer klassifizierungspflichtig.</CardDescription></div><Button variant="outline" size="sm" disabled={!policyDraft} onClick={addRequirement}><CirclePlus />Pflichtangabe ergänzen</Button></div></CardHeader>
      <CardContent className="space-y-5">
        {projects.length > 0 && <div className="grid max-w-md gap-1.5"><Label htmlFor="decision-policy-project">Projekt</Label><Select value={project?.id} onValueChange={setProjectId}><SelectTrigger id="decision-policy-project"><SelectValue /></SelectTrigger><SelectContent>{projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}
        {!project && <p className="text-sm text-muted-foreground">Lege zuerst ein Projekt an, um Einordnungsregeln zu konfigurieren.</p>}
        {policyQuery.isError && <p role="alert" className="text-sm text-destructive">Projektregeln konnten nicht geladen werden. {formatError(policyQuery.error)}</p>}
        {policyQuery.isPending && project && <p className="text-sm text-muted-foreground">Projektregeln werden geladen…</p>}
        {project && policyDraft && <>
          <label className="flex items-start gap-3 rounded-lg border p-3"><Checkbox checked={policyDraft.enabled_for_manual} onCheckedChange={(checked) => setPolicyDraft((current) => current ? { ...current, enabled_for_manual: checked === true } : current)} /><span><span className="block text-sm font-medium">Handangelegte Tickets zusätzlich einordnen</span><span className="mt-1 block text-xs text-muted-foreground">Technische API- und MCP-Eingänge werden unabhängig davon immer geprüft.</span></span></label>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Pflichtangaben</h3><a href="#/labels" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Labels und Workflowrouten <ArrowUpRight className="size-3.5" /></a></div>
            {policyDraft.requirements.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Keine zusätzlichen Pflichtangaben. Ohne passende Frage entscheidet die Einordnung nur anhand von Labels und Routen.</p>}
            {policyDraft.requirements.map((requirement, index) => <fieldset key={`${requirement.field_key}-${index}`} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Pflichtangabe {index + 1}</p><p className="mt-1 text-xs text-muted-foreground">Die Frage wird aus deiner Vorlage gebildet und nicht vom Modell frei generiert.</p></div><Button type="button" variant="ghost" size="icon" aria-label={`Pflichtangabe ${index + 1} entfernen`} onClick={() => removeRequirement(index)}><Trash2 /></Button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor={`requirement-key-${index}`}>Feldschlüssel</Label><Input id={`requirement-key-${index}`} value={requirement.field_key} onChange={(event) => updateRequirement(index, { field_key: event.target.value })} maxLength={100} /></div>
                <div className="grid gap-1.5"><Label htmlFor={`requirement-description-${index}`}>Gesuchte Angabe</Label><Input id={`requirement-description-${index}`} value={requirement.description} onChange={(event) => updateRequirement(index, { description: event.target.value })} maxLength={500} /></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor={`requirement-question-${index}`}>Rückfrage an den ursprünglichen Agenten</Label><Textarea id={`requirement-question-${index}`} value={requirement.question_template} onChange={(event) => updateRequirement(index, { question_template: event.target.value })} rows={2} maxLength={1000} /></div>
              <fieldset className="space-y-2"><legend className="text-xs font-medium">Gilt nur für diese Workflows</legend>{workflowLabels.length === 0 ? <p className="text-xs text-muted-foreground">Noch keine aktiven Workflowlabels angelegt.</p> : <div className="grid gap-2 sm:grid-cols-2">{workflowLabels.map((label) => <label key={label.id} className="flex items-center gap-2 text-sm"><Checkbox checked={requirement.workflow_label_ids.includes(label.id)} onCheckedChange={(checked) => updateRequirement(index, { workflow_label_ids: checked === true ? [...new Set([...requirement.workflow_label_ids, label.id])] : requirement.workflow_label_ids.filter((id) => id !== label.id) })} />{label.name}</label>)}</div>}<p className="text-xs text-muted-foreground">Wenn keine Auswahl markiert ist, gilt die Rückfrage für alle Workflowlabels.</p></fieldset>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={requirement.required} onCheckedChange={(checked) => updateRequirement(index, { required: checked === true })} />Angabe ist erforderlich</label>
            </fieldset>)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {thresholdFields.map((field) => <div key={field.key} className="grid gap-1.5"><Label htmlFor={field.key}>{field.label} (0–1)</Label><Input id={field.key} type="number" min={0} max={1} step={0.01} value={policyDraft[field.key]} onChange={(event) => updateThreshold(field.key, event.target.value)} /><p className="text-xs text-muted-foreground">{field.description}</p></div>)}
            <div className="grid gap-1.5"><Label htmlFor="max-clarification-rounds">Maximale Rückfragerunden</Label><Input id="max-clarification-rounds" type="number" min={1} max={10} value={policyDraft.max_clarification_rounds} onChange={(event) => setPolicyDraft((current) => current ? { ...current, max_clarification_rounds: event.target.value === '' ? 0 : Number(event.target.value) } : current)} /><p className="text-xs text-muted-foreground">Danach wird eine offene Pflichtangabe an den Eigentümer eskaliert.</p></div>
          </div>
          <div className="flex justify-end"><Button disabled={!policyQuery.data || savePolicy.isPending} onClick={() => savePolicy.mutate()}><Save />{savePolicy.isPending ? 'Speichert…' : 'Projektregeln speichern'}</Button></div>
        </>}
      </CardContent>
    </Card>
  </section>
}
