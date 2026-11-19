import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, Clock3, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Label, type Project, type Task } from '@/lib/api'
import { useProjectLabels } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type IntakeStatus = components['schemas']['IntakeStatus']
type ClassificationRecord = components['schemas']['ClassificationRecord']
type Approval = components['schemas']['Approval']
type DecisionAnswer = components['schemas']['DecisionAnswer']

const outcomeLabels: Record<components['schemas']['IntakeOutcome'], string> = {
  accepted: 'Wird eingeordnet',
  ready: 'Eingeordnet',
  needs_information: 'Rückfrage an Agent',
  needs_human_decision: 'Menschliche Entscheidung nötig',
  classification_unavailable: 'Einordnung nicht verfügbar',
}

const reasonLabels: Record<string, string> = {
  routing_ambiguous: 'Mehrere Arbeitsabläufe passen',
  classification_unavailable: 'Einordnung konnte nicht abgeschlossen werden',
  decision_refused: 'Die Entscheidung wurde zurückgewiesen',
  intake_escalated: 'Die Rückfrage braucht eine menschliche Klärung',
  approval_pending: 'Ergebnismeldung wartet auf Freigabe',
  run_permission_in_t3: 'T3 wartet auf eine Berechtigungsentscheidung',
  auth_required: 'T3-Zugang benötigt eine Klärung',
  reconciliation_required: 'Ein T3-Auftrag muss abgeglichen werden',
}

export default function TaskDecisions({ task, project, onChanged }: { task: Task; project: Project; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const labelsQuery = useProjectLabels(project.id)
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: () => request(api.GET('/session', {})),
  })
  const isOwner = sessionQuery.data?.owner !== null && sessionQuery.data?.owner !== undefined
  const intakeQuery = useQuery({
    queryKey: ['task-intake', task.id],
    enabled: task.origin !== 'manual' || task.classification_required || task.intake_outcome !== null,
    queryFn: () => request(api.GET('/tasks/{task_id}/intake', { params: { path: { task_id: task.id } } })),
    refetchInterval: (query) => ['accepted', 'queued', 'running', 'stale'].includes(query.state.data?.outcome ?? '')
      || ['queued', 'running', 'stale'].includes(query.state.data?.assessment_status ?? '') ? 1000 : false,
  })
  const intake = intakeQuery.data as IntakeStatus | undefined
  const classificationId = intake?.classification_id ?? task.classification_id
  const classificationQuery = useQuery({
    queryKey: ['task-classification', task.id, classificationId],
    enabled: Boolean(classificationId),
    queryFn: () => request(api.GET('/tasks/{task_id}/classifications/{classification_id}', {
      params: { path: { task_id: task.id, classification_id: classificationId! } },
    })),
  })
  const classification = classificationQuery.data as ClassificationRecord | undefined
  const labels = labelsQuery.data?.items ?? []
  const topicLabels = useMemo(() => labels.filter((label) => label.active && label.kind === 'topic' && !label.system_managed), [labels])
  const workflowLabels = useMemo(() => labels.filter((label) => label.active && label.kind === 'workflow' && !label.system_managed), [labels])
  const runsQuery = useQuery({
    queryKey: ['task-runs', project.id, task.id],
    queryFn: () => request(api.GET('/runs', { params: { query: { project_id: project.id, task_id: task.id, limit: 100 } } })),
  })
  const runIds = (runsQuery.data?.items ?? []).map((run) => run.id).sort()
  const pendingApprovalsQuery = useQuery({
    queryKey: ['task-approvals', task.id, runIds.join(',')],
    enabled: runsQuery.isSuccess,
    queryFn: async () => {
      const pages = await Promise.all(runIds.map((runId) => request(api.GET('/approvals', {
        params: { query: { run_id: runId, status: 'pending', limit: 100 } },
      }))))
      return pages.flatMap((page) => page.items).filter((approval) => approval.status === 'pending')
    },
  })
  const pendingApprovals = pendingApprovalsQuery.data as Approval[] | undefined
  const visibleApprovals = pendingApprovals ?? []
  const [primaryTopicId, setPrimaryTopicId] = useState('')
  const [workflowLabelId, setWorkflowLabelId] = useState('')
  const [extraTopicIds, setExtraTopicIds] = useState<string[]>([])
  const [decisionReason, setDecisionReason] = useState('')
  const [approvalReasons, setApprovalReasons] = useState<Record<string, string>>({})
  const [writeError, setWriteError] = useState('')

  useEffect(() => {
    const topicId = task.primary_topic_label_id ?? classification?.primary_topic_label_id ?? topicLabels[0]?.id ?? ''
    const routeId = task.workflow_label_id ?? classification?.suggested_workflow_label_id ?? workflowLabels[0]?.id ?? ''
    setPrimaryTopicId(topicId)
    setWorkflowLabelId(routeId)
    setExtraTopicIds((task.label_ids ?? []).filter((id) => id !== topicId && topicLabels.some((label) => label.id === id)))
  }, [task.id, task.version, classification?.id, topicLabels, workflowLabels])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-intake', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-classification', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-runs', project.id, task.id] }),
      queryClient.invalidateQueries({ queryKey: ['task-approvals', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['history', task.id] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ])
    await onChanged()
  }

  const showWriteError = (error: unknown) => {
    const message = formatError(error)
    setWriteError(/geändert|version|aktuell/i.test(message)
      ? 'Das Ticket oder die Entscheidung wurde zwischenzeitlich geändert. Der aktuelle Stand wurde neu geladen; prüfe die offenen Angaben vor einem erneuten Versuch.'
      : message)
    toast.error(message)
    void refresh()
  }

  const decideIntake = useMutation({
    mutationFn: () => {
      if (!isOwner || !intake || !primaryTopicId || !workflowLabelId || !decisionReason.trim()) {
        throw new Error('Wähle ein Thema, einen Arbeitsablauf und begründe die Entscheidung.')
      }
      return request(api.POST('/tasks/{task_id}/intake/decision', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: {
          label_ids: [...new Set([primaryTopicId, ...extraTopicIds])],
          primary_topic_label_id: primaryTopicId,
          workflow_label_id: workflowLabelId,
          reason: decisionReason.trim(),
        },
      }))
    },
    onSuccess: async () => {
      setWriteError('')
      setDecisionReason('')
      await refresh()
      toast.success('Einordnung gespeichert')
    },
    onError: showWriteError,
  })

  const reclassify = useMutation({
    mutationFn: () => {
      if (!isOwner || !intake || !decisionReason.trim()) throw new Error('Gib einen Grund für die erneute Einordnung an.')
      return request(api.POST('/tasks/{task_id}/intake/reclassify', {
        params: { path: { task_id: task.id }, ...mutationParams(task.version) },
        body: { reason: decisionReason.trim(), prefer_wait_ms: 0 },
      }))
    },
    onSuccess: async () => {
      setWriteError('')
      setDecisionReason('')
      await refresh()
      toast.success('Erneute Einordnung angefordert')
    },
    onError: showWriteError,
  })

  const decideApproval = useMutation({
    mutationFn: ({ approval, decision }: { approval: Approval; decision: 'approved' | 'rejected' }) => {
      const reason = approvalReasons[approval.id]?.trim()
      if (!isOwner || approval.status !== 'pending' || !reason) throw new Error('Eine ausstehende Freigabe braucht eine begründete Entscheidung.')
      return request(api.POST('/approvals/{approval_id}/decision', {
        params: { path: { approval_id: approval.id }, ...mutationParams(approval.version) },
        body: { decision, result_digest: approval.result_digest, reason },
      }))
    },
    onSuccess: async (_approval, variables) => {
      setWriteError('')
      setApprovalReasons((current) => ({ ...current, [variables.approval.id]: '' }))
      await refresh()
      toast.success(variables.decision === 'approved' ? 'Ergebnismeldung angenommen' : 'Ergebnismeldung zurückgewiesen')
    },
    onError: showWriteError,
  })

  const reasonItems = task.human_attention.reasons.map((reason) => reasonLabels[reason] ?? reason)
  const hasIntake = Boolean(intake || task.origin !== 'manual' || task.classification_required)
  const ownerDecisionRequired = intake?.outcome === 'needs_human_decision' && intake.waiting_for === 'owner'
  const retryRequired = intake?.outcome === 'classification_unavailable'
  const requesterQuestion = intake?.outcome === 'needs_information' && intake.waiting_for === 'requester'

  return (
    <div className="space-y-4" data-testid="task-decisions">
      {writeError && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>{writeError}</p></div>}

      {hasIntake && <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" />Eingang und Einordnung</CardTitle><CardDescription className="mt-1">Ticketrevisionen und Antworten bleiben nachvollziehbar.</CardDescription></div>
            {intake && <Badge variant={intake.outcome === 'needs_human_decision' || intake.outcome === 'classification_unavailable' ? 'destructive' : 'secondary'}>{outcomeLabels[intake.outcome]}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {intakeQuery.isPending && <p className="text-sm text-muted-foreground">Eingangsstatus wird geladen…</p>}
          {intakeQuery.isError && <div role="alert" className="text-sm text-destructive">Eingangsstatus konnte nicht geladen werden. {formatError(intakeQuery.error)} <Button variant="ghost" size="sm" onClick={() => void intakeQuery.refetch()}>Erneut laden</Button></div>}
          {intake && <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Ticketrevision {task.version}</span><span>Bewertete Revision {intake.assessed_task_revision ?? 'steht aus'}</span><span>Taxonomie v{intake.taxonomy_version}</span><span>Routing v{intake.routing_rules_version}</span>{intake.assessment_status !== 'completed' && <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{intake.assessment_status === 'running' ? 'Wird geprüft' : 'Wartet auf Prüfung'}</span>}</div>
            {intake.missing_fields.length > 0 && <section className="space-y-2 rounded-lg border bg-muted/20 p-3" aria-label="Offene Rückfragen">
              <h3 className="text-sm font-medium">Offene Angaben</h3>
              {intake.missing_fields.map((field) => <div key={field.field_key} className="rounded-md bg-background p-2.5"><p className="text-sm">{field.question}</p><p className="mt-1 text-xs text-muted-foreground">Feld {field.field_key} · {field.addressed_to === 'requester' ? 'Agent antwortet' : 'Eigentümer klärt'}</p></div>)}
            </section>}
            {requesterQuestion && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">Diese Rückfrage richtet sich an den ursprünglichen Agenten. Er ergänzt die Angaben über MCP; eine Eigentümerentscheidung wird dadurch nicht vorweggenommen.</p>}
            {ownerDecisionRequired && <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4" aria-labelledby={`intake-decision-${task.id}`}>
              <div><h3 id={`intake-decision-${task.id}`} className="text-sm font-semibold">Eigentümerentscheidung</h3><p className="mt-1 text-xs text-muted-foreground">Prüfe die Einordnung und wähle den vorgesehenen Arbeitsablauf. Diese Auswahl erteilt keinen automatischen Start.</p></div>
              {!isOwner ? <p className="text-sm text-muted-foreground">Nur der Eigentümer kann diese Einordnung festlegen.</p> : <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><FieldLabel htmlFor={`primary-topic-${task.id}`}>Hauptthema</FieldLabel><Select value={primaryTopicId} onValueChange={setPrimaryTopicId}><SelectTrigger id={`primary-topic-${task.id}`}><SelectValue placeholder="Thema wählen" /></SelectTrigger><SelectContent>{topicLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-1.5"><FieldLabel htmlFor={`workflow-label-${task.id}`}>Arbeitsablauf</FieldLabel><Select value={workflowLabelId} onValueChange={setWorkflowLabelId}><SelectTrigger id={`workflow-label-${task.id}`}><SelectValue placeholder="Arbeitsablauf wählen" /></SelectTrigger><SelectContent>{workflowLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select></div>
                </div>
                {topicLabels.length > 1 && <fieldset className="space-y-2"><legend className="text-xs font-medium">Zusätzliche Themen</legend><div className="grid gap-2 sm:grid-cols-2">{topicLabels.filter((label) => label.id !== primaryTopicId).map((label) => <label key={label.id} className="flex items-center gap-2 text-sm"><Checkbox checked={extraTopicIds.includes(label.id)} onCheckedChange={(checked) => setExtraTopicIds((current) => checked ? [...new Set([...current, label.id])] : current.filter((id) => id !== label.id))} />{label.name}</label>)}</div></fieldset>}
                <div className="grid gap-1.5"><FieldLabel htmlFor={`intake-reason-${task.id}`}>Begründung</FieldLabel><Textarea id={`intake-reason-${task.id}`} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} maxLength={2000} rows={3} placeholder="Warum passt diese Einordnung?" /></div>
                <div className="flex justify-end"><Button onClick={() => decideIntake.mutate()} disabled={!primaryTopicId || !workflowLabelId || !decisionReason.trim() || decideIntake.isPending || !isOwner}>{decideIntake.isPending ? 'Speichert…' : 'Einordnung festlegen'}</Button></div>
              </>}
            </section>}
            {retryRequired && <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4"><div><h3 className="text-sm font-semibold">Einordnung erneut versuchen</h3><p className="mt-1 text-xs text-muted-foreground">Der Eingang bleibt gespeichert. Ein neuer Versuch verwendet die aktuelle Ticketrevision und Taxonomie.</p></div>{isOwner && <><div className="grid gap-1.5"><FieldLabel htmlFor={`retry-reason-${task.id}`}>Grund</FieldLabel><Textarea id={`retry-reason-${task.id}`} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} maxLength={2000} rows={2} placeholder="Warum soll erneut eingeordnet werden?" /></div><div className="flex justify-end"><Button variant="outline" onClick={() => reclassify.mutate()} disabled={!decisionReason.trim() || reclassify.isPending}>{reclassify.isPending ? 'Wird angefordert…' : <><RotateCcw />Erneut einordnen</>}</Button></div></>}</section>}
          </>}
          {classificationQuery.isPending && classificationId && <p className="text-xs text-muted-foreground">Klassifikationsnachweis wird geladen…</p>}
          {classificationQuery.isError && classificationId && <p role="alert" className="text-xs text-destructive">Klassifikationsnachweis konnte nicht geladen werden. {formatError(classificationQuery.error)}</p>}
          {classification && <ClassificationSummary classification={classification} labels={labels} />}
        </CardContent>
      </Card>}

      {task.human_attention.required && <Card className="border-amber-300 bg-amber-50/50">
        <CardHeader className="pb-2"><CardTitle className="text-base">Mensch erforderlich</CardTitle><CardDescription>Offene Gründe werden durch ihre passende Entscheidung geschlossen.</CardDescription></CardHeader>
        <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{reasonItems.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></CardContent>
      </Card>}

      {runsQuery.isError && <p role="alert" className="text-sm text-destructive">Freigaben konnten nicht geladen werden. {formatError(runsQuery.error)}</p>}
      {pendingApprovalsQuery.isError && <p role="alert" className="text-sm text-destructive">Freigaben konnten nicht geladen werden. {formatError(pendingApprovalsQuery.error)}</p>}
      {visibleApprovals.map((approval) => <ApprovalDecisionCard key={approval.id} approval={approval} isOwner={isOwner} reason={approvalReasons[approval.id] ?? ''} onReasonChange={(value) => setApprovalReasons((current) => ({ ...current, [approval.id]: value }))} onDecision={(decision) => decideApproval.mutate({ approval, decision })} pending={decideApproval.isPending} />)}
      {runsQuery.isSuccess && pendingApprovalsQuery.isSuccess && visibleApprovals.length === 0 && !hasIntake && !task.human_attention.required && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Für dieses Ticket gibt es keine offene Intake- oder Freigabeentscheidung.</p>}
    </div>
  )
}

function ClassificationSummary({ classification, labels }: { classification: ClassificationRecord; labels: Label[] }) {
  const labelName = (id: string | null) => id ? labels.find((label) => label.id === id)?.name ?? 'Unbekanntes Label' : 'Keine Auswahl'
  return <details className="rounded-lg border px-3 py-2.5">
    <summary className="cursor-pointer text-sm font-medium">Klassifikationsnachweis · Revision {classification.task_revision}{classification.applied ? '' : ' · nicht angewandt'}</summary>
    <div className="mt-3 space-y-3 text-xs">
      <div className="grid gap-1 text-muted-foreground sm:grid-cols-2"><p>Ergebnis: <strong className="font-medium text-foreground">{outcomeLabels[classification.outcome]}</strong></p><p>Taxonomie: v{classification.taxonomy_version} · Policy: v{classification.policy_version} · Routing: v{classification.routing_rules_version}</p><p>Hauptthema: {labelName(classification.primary_topic_label_id)}</p><p>Arbeitsablauf: {labelName(classification.suggested_workflow_label_id)}</p><p>Modell: {classification.model} · Versuch {classification.attempt_no}</p><p>Request-ID: {classification.provider_request_id ?? 'Vom Anbieter nicht geliefert'}</p></div>
      {classification.answers.length > 0 && <ul className="space-y-1 border-t pt-2">{classification.answers.map((answer, index) => <li key={`${answer.name}-${index}`}>{formatAnswer(answer, labelName)}</li>)}</ul>}
    </div>
  </details>
}

function formatAnswer(answer: DecisionAnswer, labelName: (id: string | null) => string) {
  if (answer.type === 'predicate') return `${answer.name}: ${(answer.probability * 100).toFixed(0)} %`
  if (answer.type === 'choice') return `${answer.name}: ${labelName(answer.choice)} · Sicherheit ${(answer.confidence * 100).toFixed(0)} %`
  if (answer.type === 'score') return `${answer.name}: ${answer.score} · Sicherheit ${(answer.confidence * 100).toFixed(0)} %`
  return `${answer.name}: zurückgewiesen`
}

function ApprovalDecisionCard({ approval, isOwner, reason, onReasonChange, onDecision, pending }: {
  approval: Approval
  isOwner: boolean
  reason: string
  onReasonChange: (value: string) => void
  onDecision: (decision: 'approved' | 'rejected') => void
  pending: boolean
}) {
  const canDecide = isOwner && approval.status === 'pending'
  return <Card className="border-amber-300 bg-amber-50/50" data-testid={`approval-${approval.id}`}>
    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-4" />Freigabe ausstehend</CardTitle><CardDescription>{approval.kind === 'review' ? 'Eine Reviewmeldung wartet auf deine Entscheidung.' : 'Eine Ergebnismeldung wartet auf deine Entscheidung.'}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Ticketrevision {approval.task_revision}</span><span>Ergebnis {approval.result_digest.slice(0, 12)}…</span><span>Angefragt {new Date(approval.requested_at).toLocaleString('de-DE')}</span></div>
      {!canDecide ? <p className="text-sm text-muted-foreground">Nur der Eigentümer kann diese Freigabe annehmen oder zurückweisen.</p> : <>
        <div className="grid gap-1.5"><FieldLabel htmlFor={`approval-reason-${approval.id}`}>Begründung</FieldLabel><Textarea id={`approval-reason-${approval.id}`} value={reason} onChange={(event) => onReasonChange(event.target.value)} rows={2} maxLength={2000} placeholder="Beziehe dich auf die gemeldeten Angaben." /></div>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => onDecision('rejected')} disabled={!reason.trim() || pending}>Zurückweisen</Button><Button onClick={() => onDecision('approved')} disabled={!reason.trim() || pending}><Check />Annehmen</Button></div>
      </>}
    </CardContent>
  </Card>
}
