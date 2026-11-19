import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { useProjects } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

type RecoveryInventory = components['schemas']['RecoveryInventory']
type RecoveryEntry = components['schemas']['RecoveryEntry']
type RecoveryDecision = components['schemas']['RecoveryInventoryDecision']
type Disposition = Extract<RecoveryDecision, { action: 'resolve_entry' }>['disposition']

const entryLabels: Record<RecoveryEntry['entry_kind'], string> = {
  known_run: 'Bekannter Falkenwarte-Auftrag',
  unlisted_external_activity: 'T3-Projektaktivität prüfen',
  registered_external_start: 'Nachträglich registrierter T3-Auftrag',
}

const entryStatusLabels: Record<RecoveryEntry['status'], string> = {
  pending: 'Abgleich läuft',
  owner_review_required: 'Prüfung durch Eigentümer erforderlich',
  stopped: 'In T3 beendet',
  resolved: 'Geklärt',
}

const dispositionLabels: Record<Disposition, string> = {
  confirmed_stopped_in_t3: 'In T3 beendet',
  confirmed_not_started: 'Nicht gestartet',
  reviewed_no_additional_runs: 'Projekt geprüft, keine weiteren Aufträge offen',
}

const runStateLabels: Record<components['schemas']['RunState'], string> = {
  queued: 'Wartet auf Start',
  dispatching: 'Wird an T3 übergeben',
  running: 'Läuft',
  waiting_input: 'Wartet auf Eingabe',
  auth_blocked: 'T3-Autorisierung erforderlich',
  reconciling: 'Wird mit T3 abgeglichen',
  cancel_requested: 'Abbruch angefordert',
  result_reported: 'Ergebnis gemeldet',
  verifying: 'Ergebnis wird geprüft',
  succeeded: 'Erfolgreich beendet',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  abandoned: 'Aufgegeben',
}

const activeRunStates = new Set<components['schemas']['RunState']>([
  'queued', 'dispatching', 'running', 'waiting_input', 'auth_blocked', 'reconciling',
  'cancel_requested', 'result_reported', 'verifying',
])

function entryProjectLabel(entry: RecoveryEntry, projects: components['schemas']['Project'][]) {
  return projects.find((project) => project.id === entry.project_id)?.name ?? `Projekt ${entry.project_id}`
}

function RecoveryEntryCard({
  entry,
  projectName,
  runQuery,
  onResolve,
  pending,
}: {
  entry: RecoveryEntry
  projectName: string
  runQuery?: UseQueryResult<components['schemas']['Run'], Error>
  onResolve: (decision: Extract<RecoveryDecision, { action: 'resolve_entry' }>) => void
  pending: boolean
}) {
  const [disposition, setDisposition] = useState<Disposition>(
    entry.entry_kind === 'unlisted_external_activity' ? 'reviewed_no_additional_runs' : 'confirmed_stopped_in_t3',
  )
  const [reason, setReason] = useState('')
  const run = runQuery?.data as components['schemas']['Run'] | undefined
  const activeRun = run ? activeRunStates.has(run.state) : false
  const canResolve = entry.entry_kind === 'unlisted_external_activity'
    ? entry.status !== 'resolved'
    : entry.entry_kind === 'registered_external_start'
      ? entry.status === 'stopped'
      : Boolean(run && !activeRun)
  const choices: Disposition[] = entry.entry_kind === 'unlisted_external_activity'
    ? ['reviewed_no_additional_runs']
    : ['confirmed_stopped_in_t3', 'confirmed_not_started']
  const blockedReason = entry.entry_kind === 'known_run'
    ? runQuery?.isError
      ? `Auftragsstatus konnte nicht geladen werden: ${formatError(runQuery.error)}`
      : runQuery?.isPending
        ? 'Auftragsstatus wird geladen.'
        : activeRun
          ? 'Dieser Falkenwarte-Auftrag ist noch aktiv. Er muss zuerst über T3 abgeglichen und beendet werden.'
          : ''
    : entry.entry_kind === 'registered_external_start' && entry.status !== 'stopped'
      ? 'Eine Klärung ist erst möglich, wenn T3 den Auftrag als beendet meldet.'
      : ''

  return (
    <article className="space-y-3 rounded-lg border p-4" aria-label={entryLabels[entry.entry_kind]}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">{entryLabels[entry.entry_kind]}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
        </div>
        <Badge variant={entry.status === 'resolved' ? 'secondary' : entry.status === 'stopped' ? 'outline' : 'destructive'}>
          {entryStatusLabels[entry.status]}
        </Badge>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {entry.entry_kind === 'known_run' && entry.run_id && <div><dt className="text-muted-foreground">Falkenwarte-Auftrag</dt><dd className="mt-0.5 break-all">{entry.run_id}</dd></div>}
        {entry.connection_id && <div><dt className="text-muted-foreground">T3-Verbindung</dt><dd className="mt-0.5 break-all">{entry.connection_id}</dd></div>}
        {entry.external_project_id && <div><dt className="text-muted-foreground">T3-Projekt</dt><dd className="mt-0.5 break-all">{entry.external_project_id}</dd></div>}
        {entry.external_thread_id && <div><dt className="text-muted-foreground">T3-Thread</dt><dd className="mt-0.5 break-all">{entry.external_thread_id}</dd></div>}
        {entry.external_run_id && <div><dt className="text-muted-foreground">T3-Auftrag</dt><dd className="mt-0.5 break-all">{entry.external_run_id}</dd></div>}
        {entry.observed_status && <div><dt className="text-muted-foreground">Letzter T3-Status</dt><dd className="mt-0.5">{entry.observed_status}</dd></div>}
        {entry.last_observed_at && <div><dt className="text-muted-foreground">Zuletzt abgeglichen</dt><dd className="mt-0.5">{new Date(entry.last_observed_at).toLocaleString('de-DE')}</dd></div>}
      </dl>
      {entry.reason && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.reason}</p>}
      {entry.last_error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">T3-Abgleich: {entry.last_error}</p>}
      {run && <p className="text-sm text-muted-foreground">Falkenwarte-Auftragsstatus: <span className="font-medium text-foreground">{runStateLabels[run.state]}</span></p>}

      {entry.status !== 'resolved' && <div className="grid gap-3 rounded-md bg-muted/40 p-3">
        {blockedReason && <p className="text-sm text-muted-foreground">{blockedReason}</p>}
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(14rem,1.2fr)]">
          <div className="grid gap-1.5">
            <Label htmlFor={`recovery-disposition-${entry.id}`}>Klärung</Label>
            <Select value={disposition} onValueChange={(value) => setDisposition(value as Disposition)}>
              <SelectTrigger id={`recovery-disposition-${entry.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>{choices.map((choice) => <SelectItem key={choice} value={choice}>{dispositionLabels[choice]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`recovery-reason-${entry.id}`}>Begründung</Label>
            <Textarea id={`recovery-reason-${entry.id}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={2000} placeholder="Was wurde in T3 geprüft oder bestätigt?" />
          </div>
        </div>
        <div><Button size="sm" variant="outline" disabled={!canResolve || !reason.trim() || pending} onClick={() => onResolve({ action: 'resolve_entry', entry_id: entry.id, disposition, reason: reason.trim() })}>Eintrag als geklärt markieren</Button></div>
      </div>}
      {entry.status === 'resolved' && entry.disposition && <p className="text-sm text-muted-foreground">{dispositionLabels[entry.disposition]}{entry.resolved_at ? ` · ${new Date(entry.resolved_at).toLocaleString('de-DE')}` : ''}</p>}
    </article>
  )
}

export default function RecoveryInventoryPanel() {
  const client = useQueryClient()
  const [registerProjectId, setRegisterProjectId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [externalRunId, setExternalRunId] = useState('')
  const [registrationReason, setRegistrationReason] = useState('')
  const [confirmReason, setConfirmReason] = useState('')
  const inventoryQuery = useQuery({
    queryKey: ['recovery-inventory'],
    queryFn: () => request(api.GET('/recovery/inventory', {})),
  })
  const projectsQuery = useProjects()
  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: () => request(api.GET('/connections', { params: { query: { limit: 100 } } })),
  })
  const inventory = inventoryQuery.data as RecoveryInventory | undefined
  const projects = projectsQuery.data?.items ?? []
  const boundProjects = projects.filter((project) => project.active_binding_id)
  const bindingQuery = useQuery({
    queryKey: ['project-binding', registerProjectId],
    enabled: Boolean(registerProjectId),
    queryFn: () => request(api.GET('/projects/{project_id}/binding', { params: { path: { project_id: registerProjectId } } })),
  })
  const runQueries = useQueries({
    queries: (inventory?.entries ?? []).filter((entry) => entry.entry_kind === 'known_run' && Boolean(entry.run_id)).map((entry) => ({
      queryKey: ['run', entry.run_id],
      queryFn: () => request(api.GET('/runs/{run_id}', { params: { path: { run_id: entry.run_id! } } })),
    })),
  })
  const runQueryById = useMemo(() => new Map(
    (inventory?.entries ?? []).filter((entry) => entry.entry_kind === 'known_run' && Boolean(entry.run_id)).map((entry, index) => [entry.id, runQueries[index]]),
  ), [inventory?.entries, runQueries])
  const decisionMutation = useMutation({
    mutationFn: (decision: RecoveryDecision) => request(api.POST('/recovery/inventory/decision', { params: mutationParams(), body: decision })),
    onSuccess: async (updated, decision) => {
      await client.invalidateQueries({ queryKey: ['recovery-inventory'] })
      if (decision.action === 'register_external_start') {
        setThreadId('')
        setExternalRunId('')
        setRegistrationReason('')
      }
      if (decision.action === 'confirm_inventory') setConfirmReason('')
      void updated
    },
  })
  const registerBinding = bindingQuery.data
  const connectionName = connectionsQuery.data?.items.find((connection) => connection.id === registerBinding?.connection_id)?.name
  const recoveryGate = inventory && 'gate' in inventory ? inventory.gate : undefined
  const entries = inventory?.entries ?? []
  const unresolvedEntries = entries.filter((entry) => entry.status !== 'resolved')
  const decisionError = decisionMutation.error
  const refreshCurrentState = async () => {
    await Promise.all([
      inventoryQuery.refetch(),
      client.invalidateQueries({ queryKey: ['run'] }),
    ])
  }

  if (inventoryQuery.isPending || projectsQuery.isPending || connectionsQuery.isPending) {
    return <Card><CardHeader><CardTitle>T3-Abgleich nach Wiederherstellung</CardTitle></CardHeader><CardContent className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-24" /></CardContent></Card>
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-muted-foreground" />T3-Abgleich nach Wiederherstellung</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {inventoryQuery.error || projectsQuery.error || connectionsQuery.error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formatError(inventoryQuery.error ?? projectsQuery.error ?? connectionsQuery.error)}<Button variant="link" className="ml-2 h-auto p-0 text-current" onClick={() => { void inventoryQuery.refetch(); void projectsQuery.refetch(); void connectionsQuery.refetch() }}>Erneut laden</Button></div>
          : !recoveryGate ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><p className="text-sm text-muted-foreground">Keine offene Wiederherstellungsinventur.</p><Button variant="outline" size="sm" onClick={() => void refreshCurrentState()}><RefreshCw />Aktuellen Stand laden</Button></div>
            : <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{recoveryGate.status === 'inventory_required' ? 'Inventur erforderlich · neue Starts sind gesperrt' : 'Inventur abgeschlossen'}</p><Badge variant={recoveryGate.status === 'released' ? 'secondary' : 'destructive'}>{recoveryGate.status === 'released' ? 'Freigegeben' : 'Offen'}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">Wiederhergestellt am {new Date(recoveryGate.completed_at).toLocaleString('de-DE')}. Grund: {recoveryGate.reason}</p>
                {recoveryGate.backup_id && <p className="mt-1 break-all text-xs text-muted-foreground">Backup {recoveryGate.backup_id}</p>}
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void refreshCurrentState()}><RefreshCw />Aktuellen Stand laden</Button>
              </div>

              {decisionError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formatError(decisionError)}</p>}

              {recoveryGate.status === 'inventory_required' && <section className="space-y-3 rounded-lg border p-4">
                <div><h3 className="font-medium">Unbekannten T3-Auftrag registrieren</h3><p className="mt-1 text-sm text-muted-foreground">Trage jeden in T3 aktiven, in Falkenwarte noch nicht bekannten Auftrag einzeln ein. Der Auftrag wird danach beobachtet und muss erst enden, bevor du ihn klären kannst.</p></div>
                {boundProjects.length === 0 ? <p className="text-sm text-muted-foreground">Es gibt kein Projekt mit aktivem T3-Binding. Richte zuerst ein Binding unter „Agents &amp; T3“ ein.</p> : <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label htmlFor="recovery-project">Falkenwarte-Projekt</Label><Select value={registerProjectId} onValueChange={setRegisterProjectId}><SelectTrigger id="recovery-project"><SelectValue placeholder="Projekt wählen" /></SelectTrigger><SelectContent>{boundProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-1.5"><Label>T3-Projektbindung</Label><div className="min-h-10 rounded-md border bg-muted/30 px-3 py-2 text-sm">{bindingQuery.isPending ? 'Binding wird geladen…' : bindingQuery.error ? <span className="text-destructive">{formatError(bindingQuery.error)}</span> : registerBinding ? <span className="break-all">{connectionName ?? registerBinding.connection_id} · {registerBinding.external_project_id}</span> : 'Projekt wählen'}</div></div>
                  <div className="grid gap-1.5"><Label htmlFor="recovery-thread-id">T3-Thread-ID</Label><Input id="recovery-thread-id" value={threadId} onChange={(event) => setThreadId(event.target.value)} maxLength={500} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="recovery-run-id">T3-Auftrags-ID (optional)</Label><Input id="recovery-run-id" value={externalRunId} onChange={(event) => setExternalRunId(event.target.value)} maxLength={500} /></div>
                  <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="recovery-registration-reason">Begründung der Registrierung</Label><Textarea id="recovery-registration-reason" value={registrationReason} onChange={(event) => setRegistrationReason(event.target.value)} rows={2} maxLength={2000} placeholder="Wo wurde der Auftrag in T3 gefunden?" /></div>
                  <div className="sm:col-span-2"><Button variant="outline" disabled={!registerBinding || !threadId.trim() || !registrationReason.trim() || decisionMutation.isPending} onClick={() => decisionMutation.mutate({
                    action: 'register_external_start',
                    reason: registrationReason.trim(),
                    external_start: {
                      project_id: registerProjectId,
                      connection_id: registerBinding!.connection_id,
                      external_project_id: registerBinding!.external_project_id,
                      thread_id: threadId.trim(),
                      ...(externalRunId.trim() ? { run_id: externalRunId.trim() } : {}),
                    },
                  })}>{decisionMutation.isPending ? 'Wird registriert…' : 'T3-Auftrag registrieren'}</Button></div>
                </div>}
              </section>}

              <section className="space-y-3" aria-label="Wiederherstellungsinventur">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Einträge einzeln prüfen</h3><Badge variant="outline">{entries.length - unresolvedEntries.length} von {entries.length} geklärt</Badge></div>
                {entries.length === 0 ? <p className="rounded-md border p-3 text-sm text-muted-foreground">Für diese Wiederherstellung sind keine T3-Projekte oder laufenden Aufträge aufgeführt.</p> : entries.map((entry) => <RecoveryEntryCard key={entry.id} entry={entry} projectName={entryProjectLabel(entry, projects)} runQuery={runQueryById.get(entry.id)} pending={decisionMutation.isPending} onResolve={(decision) => decisionMutation.mutate(decision)} />)}
              </section>

              {recoveryGate.status === 'inventory_required' && <section className="space-y-3 rounded-lg border border-primary/20 bg-accent/30 p-4">
                <div><h3 className="font-medium">Gesamte T3-Projektaktivität bestätigen</h3><p className="mt-1 text-sm text-muted-foreground">Diese Freigabe wird erst möglich, wenn jeder Eintrag einzeln geklärt ist. Sie erklärt keine offenen Einträge pauschal für erledigt.</p></div>
                <div className="grid gap-2"><Label htmlFor="recovery-confirm-reason">Begründung für die Freigabe</Label><Textarea id="recovery-confirm-reason" value={confirmReason} onChange={(event) => setConfirmReason(event.target.value)} rows={2} maxLength={2000} placeholder="Bestätige, dass alle T3-Projekte und Aufträge abgeglichen wurden." /></div>
                <Button disabled={unresolvedEntries.length > 0 || !confirmReason.trim() || decisionMutation.isPending} onClick={() => decisionMutation.mutate({ action: 'confirm_inventory', reason: confirmReason.trim() })}>{decisionMutation.isPending ? 'Wird bestätigt…' : 'T3-Inventur abschließen und Starts freigeben'}</Button>
              </section>}
            </>}
      </CardContent>
    </Card>
  )
}
