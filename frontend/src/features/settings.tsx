import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Copy, KeyRound, LockKeyhole, Save, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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

const capabilityOptions = [
  ['tasks.read', 'Tickets lesen'], ['tasks.write', 'Tickets bearbeiten'], ['tasks.links.write', 'Ticketlinks melden'],
  ['runs.read', 'Aufträge lesen'], ['runs.report', 'Ergebnismeldungen senden'], ['tasks.intake.read', 'Intake lesen'],
] as const

const jobLabels: Record<string, string> = { queued: 'Wartet', running: 'Wird erstellt', ready: 'Bereit', failed: 'Fehlgeschlagen', restoring: 'Wird wiederhergestellt' }

export default function SettingsView() {
  const client = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => request(api.GET('/settings', {})) })
  const ownerQuery = useQuery({ queryKey: ['owner'], queryFn: () => request(api.GET('/owner', {})) })
  const projectsQuery = useProjects()
  const tokensQuery = useQuery({ queryKey: ['tokens'], queryFn: () => request(api.GET('/tokens', { params: { query: { limit: 100 } } })) })
  const secretsQuery = useQuery({ queryKey: ['secret-references'], queryFn: () => request(api.GET('/secret-references', { params: { query: { limit: 100 } } })) })
  const backupsQuery = useQuery({ queryKey: ['backups'], queryFn: () => request(api.GET('/backups', { params: { query: { limit: 100 } } })) })
  const exportsQuery = useQuery({ queryKey: ['exports'], queryFn: () => request(api.GET('/exports', { params: { query: { limit: 100 } } })) })
  const [displayName, setDisplayName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [locale, setLocale] = useState('')
  const [theme, setTheme] = useState<'system' | 'light' | 'dark' | ''>('')
  const [retentionDays, setRetentionDays] = useState('')
  const [eventRetentionHours, setEventRetentionHours] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [tokenLabel, setTokenLabel] = useState('')
  const [tokenProjectIds, setTokenProjectIds] = useState<string[]>([])
  const [tokenCapabilities, setTokenCapabilities] = useState<string[]>(['tasks.read'])
  const [tokenDays, setTokenDays] = useState('90')
  const [issuedToken, setIssuedToken] = useState<string | null>(null)
  const [secretLabel, setSecretLabel] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [exportProjectIds, setExportProjectIds] = useState<string[]>([])
  const [restoreReason, setRestoreReason] = useState('')
  const [restoreBackupId, setRestoreBackupId] = useState('')

  const projects = projectsQuery.data?.items ?? []
  const settings = settingsQuery.data
  const owner = ownerQuery.data

  const refresh = async () => Promise.all([
    client.invalidateQueries({ queryKey: ['settings'] }), client.invalidateQueries({ queryKey: ['owner'] }),
    client.invalidateQueries({ queryKey: ['tokens'] }), client.invalidateQueries({ queryKey: ['secret-references'] }),
    client.invalidateQueries({ queryKey: ['backups'] }), client.invalidateQueries({ queryKey: ['exports'] }),
  ])

  if ([settingsQuery, ownerQuery, projectsQuery, tokensQuery, secretsQuery, backupsQuery, exportsQuery].some((query) => query.isPending)) {
    return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
  }
  const pageError = settingsQuery.error ?? ownerQuery.error ?? projectsQuery.error ?? tokensQuery.error ?? secretsQuery.error ?? backupsQuery.error ?? exportsQuery.error
  if (pageError) return <Card><CardContent className="p-6"><h2 className="font-semibold">Einstellungen konnten nicht geladen werden</h2><p className="mt-2 text-sm text-muted-foreground">{formatError(pageError)}</p><Button variant="outline" className="mt-4" onClick={() => void refresh()}>Erneut laden</Button></CardContent></Card>

  const ownerMutation = useMutation({
    mutationFn: () => request(api.PATCH('/owner', {
      params: mutationParams(owner!.version), body: { display_name: displayName || owner!.display_name, timezone: timezone || owner!.timezone, locale: locale || owner!.locale },
    })),
    onSuccess: async () => { await refresh(); toast.success('Eigentümerprofil gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const settingsMutation = useMutation({
    mutationFn: () => request(api.PATCH('/settings', {
      params: mutationParams(settings!.version), body: {
        timezone: timezone || settings!.timezone, locale: locale || settings!.locale, theme: theme || settings!.theme,
        default_parallel_runs: 1,
        api_idempotency_retention_days: Number(retentionDays || settings!.api_idempotency_retention_days),
        ui_event_retention_hours: Number(eventRetentionHours || settings!.ui_event_retention_hours),
      },
    })),
    onSuccess: async () => { await refresh(); toast.success('Einstellungen gespeichert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const passwordMutation = useMutation({
    mutationFn: () => request(api.POST('/owner/password', { params: mutationParams(owner!.version), body: { current_password: currentPassword, new_password: newPassword } })),
    onSuccess: async () => { setCurrentPassword(''); setNewPassword(''); toast.success('Passwort geändert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const createToken = useMutation({
    mutationFn: () => {
      if (tokenProjectIds.length === 0 || tokenCapabilities.length === 0) throw new Error('Wähle mindestens ein Projekt und eine Berechtigung.')
      const expiresAt = new Date(Date.now() + Number(tokenDays) * 86_400_000).toISOString()
      return request(api.POST('/tokens', { params: mutationParams(), body: { label: tokenLabel.trim(), project_ids: tokenProjectIds, capabilities: tokenCapabilities, expires_at: expiresAt } }))
    },
    onSuccess: async (result) => { setIssuedToken(result.token); setTokenLabel(''); await refresh(); toast.success('Technisches Token erstellt') },
    onError: (error) => toast.error(formatError(error)),
  })

  const revokeToken = useMutation({
    mutationFn: (token: NonNullable<typeof tokensQuery.data>['items'][number]) => request(api.DELETE('/tokens/{token_id}', { params: { path: { token_id: token.id }, ...mutationParams(token.version) } })),
    onSuccess: async () => { await refresh(); toast.success('Token widerrufen') },
    onError: (error) => toast.error(formatError(error)),
  })

  const createSecret = useMutation({
    mutationFn: () => request(api.POST('/secret-references', { params: mutationParams(), body: { label: secretLabel.trim(), value: secretValue } })),
    onSuccess: async () => { setSecretLabel(''); setSecretValue(''); await refresh(); toast.success('Zugangsdaten sicher hinterlegt') },
    onError: (error) => toast.error(formatError(error)),
  })
  const rotateSecret = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => request(api.PUT('/secret-references/{secret_id}', {
      params: { path: { secret_id: id }, ...mutationParams(version) }, body: { value: secretValue },
    })),
    onSuccess: async () => { setSecretValue(''); await refresh(); toast.success('Zugangsdaten erneuert') },
    onError: (error) => toast.error(formatError(error)),
  })

  const createBackup = useMutation({
    mutationFn: () => request(api.POST('/backups', { params: mutationParams(), body: { include_artifacts: false } })),
    onSuccess: async () => { await refresh(); toast.success('Backup angenommen') },
    onError: (error) => toast.error(formatError(error)),
  })
  const restoreBackup = useMutation({
    mutationFn: () => {
      const backup = backupsQuery.data!.items.find((item) => item.id === restoreBackupId)
      if (!backup?.manifest) throw new Error('Das ausgewählte Backup besitzt kein gültiges Manifest.')
      return request(api.POST('/backups/{backup_id}/restore', {
        params: { path: { backup_id: backup.id }, ...mutationParams(backup.version) },
        body: { database_sha256: backup.manifest.database_sha256, reason: restoreReason.trim() },
      }))
    },
    onSuccess: async () => { setRestoreReason(''); await refresh(); toast.success('Wiederherstellung angenommen. Danach muss die T3-Inventur abgeschlossen werden.') },
    onError: (error) => toast.error(formatError(error)),
  })

  const createExport = useMutation({
    mutationFn: () => request(api.POST('/exports', { params: mutationParams(), body: { project_ids: exportProjectIds, format: 'json', include_history: true, include_artifacts: false } })),
    onSuccess: async () => { await refresh(); toast.success('Export angenommen') },
    onError: (error) => toast.error(formatError(error)),
  })

  const tokens = tokensQuery.data?.items ?? []
  const secrets = secretsQuery.data?.items ?? []
  const backups = backupsQuery.data?.items ?? []
  const exports = exportsQuery.data?.items ?? []
  const selectedBackup = backups.find((backup) => backup.id === restoreBackupId)

  return (
    <main className="space-y-6">
      <header><p className="text-sm text-muted-foreground">Eigentümer, Zugang und Betrieb</p><h1 className="text-2xl font-semibold tracking-tight">Einstellungen</h1></header>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="size-4 text-muted-foreground" />Eigentümerprofil</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="owner-display-name">Anzeigename</Label><Input id="owner-display-name" value={displayName || owner!.display_name} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="owner-timezone">Zeitzone</Label><Input id="owner-timezone" value={timezone || owner!.timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={80} /></div><div className="space-y-1.5"><Label htmlFor="owner-locale">Sprache</Label><Input id="owner-locale" value={locale || owner!.locale} onChange={(event) => setLocale(event.target.value)} maxLength={20} /></div></div>
          <Button variant="outline" disabled={ownerMutation.isPending} onClick={() => ownerMutation.mutate()}><Save />Profil speichern</Button>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Lokale Oberfläche</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Farbschema</Label><Select value={theme || settings!.theme} onValueChange={(value) => setTheme(value as typeof theme)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Hell</SelectItem><SelectItem value="dark">Dunkel</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="setting-timezone">Zeitzone</Label><Input id="setting-timezone" value={timezone || settings!.timezone} onChange={(event) => setTimezone(event.target.value)} /></div></div>
          <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5"><Label htmlFor="setting-locale">Sprache</Label><Input id="setting-locale" value={locale || settings!.locale} onChange={(event) => setLocale(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="idempotency-retention">Idempotenz (Tage)</Label><Input id="idempotency-retention" type="number" min={30} max={3650} value={retentionDays || settings!.api_idempotency_retention_days} onChange={(event) => setRetentionDays(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="event-retention">Live-Hinweise (Std.)</Label><Input id="event-retention" type="number" min={1} max={8760} value={eventRetentionHours || settings!.ui_event_retention_hours} onChange={(event) => setEventRetentionHours(event.target.value)} /></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>Wartungsmodus</span><Badge variant={settings!.maintenance_mode ? 'outline' : 'secondary'}>{settings!.maintenance_mode ? 'Aktiv' : 'Inaktiv'}</Badge></div>
          <p className="text-xs text-muted-foreground">Gleichzeitige T3-Aufträge pro Projektbindung sind im aktuellen Umfang auf eins begrenzt.</p>
          <Button variant="outline" disabled={settingsMutation.isPending} onClick={() => settingsMutation.mutate()}><Save />Einstellungen speichern</Button>
        </CardContent></Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="size-4 text-muted-foreground" />Passwort ändern</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="current-password">Aktuelles Passwort</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="new-password">Neues Passwort</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} /></div>
          <Button variant="outline" disabled={!currentPassword || newPassword.length < 12 || passwordMutation.isPending} onClick={() => passwordMutation.mutate()}>Passwort aktualisieren</Button>
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />Technische Principals</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="token-label">Tokenname</Label><Input id="token-label" value={tokenLabel} onChange={(event) => setTokenLabel(event.target.value)} placeholder="Agent für Projekt A" maxLength={120} /></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Projektzugriff</legend><div className="grid gap-2 sm:grid-cols-2">{projects.map((project) => <label key={project.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={tokenProjectIds.includes(project.id)} onChange={(event) => setTokenProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />{project.name}</label>)}</div></fieldset>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Berechtigungen</legend><div className="grid gap-2 sm:grid-cols-2">{capabilityOptions.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={tokenCapabilities.includes(key)} onChange={(event) => setTokenCapabilities((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{label}</label>)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><div className="space-y-1.5"><Label htmlFor="token-days">Gültigkeit (Tage)</Label><Input id="token-days" type="number" min={1} max={3650} value={tokenDays} onChange={(event) => setTokenDays(event.target.value)} /></div><Button disabled={!tokenLabel.trim() || tokenProjectIds.length === 0 || tokenCapabilities.length === 0 || createToken.isPending} onClick={() => createToken.mutate()}>Token ausstellen</Button></div>
          {issuedToken && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"><p className="text-sm font-medium">Dieses Token wird nur jetzt angezeigt. Kopiere es in den Agenten, der es verwenden soll.</p><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 break-all rounded bg-background p-2 text-xs">{issuedToken}</code><Button size="icon" variant="outline" aria-label="Token kopieren" onClick={() => { void navigator.clipboard.writeText(issuedToken); toast.success('Token kopiert') }}><Copy /></Button></div><Button variant="link" size="sm" className="mt-1 px-0" onClick={() => setIssuedToken(null)}>Anzeige schließen</Button></div>}
          <div className="space-y-2 border-t pt-3">{tokens.map((token) => <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{token.label}</p><p className="text-xs text-muted-foreground">{token.project_ids.length} Projekte · {token.capabilities.join(', ')} · bis {new Date(token.expires_at).toLocaleDateString()}</p></div>{token.revoked ? <Badge variant="outline">Widerrufen</Badge> : <Button variant="ghost" size="sm" disabled={revokeToken.isPending} onClick={() => { if (window.confirm(`Token „${token.label}“ widerrufen?`)) revokeToken.mutate(token) }}><Trash2 />Widerrufen</Button>}</div>)}{tokens.length === 0 && <p className="text-sm text-muted-foreground">Noch keine technischen Tokens.</p>}</div>
        </CardContent></Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />Secret-Referenzen</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="secret-label">Bezeichnung</Label><Input id="secret-label" value={secretLabel} onChange={(event) => setSecretLabel(event.target.value)} placeholder="T3-Zugang" /></div><div className="space-y-1.5"><Label htmlFor="secret-value">Zugangswert</Label><Input id="secret-value" type="password" autoComplete="new-password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} /></div></div>
          <Button variant="outline" disabled={!secretLabel.trim() || !secretValue || createSecret.isPending} onClick={() => createSecret.mutate()}>Verschlüsselt speichern</Button>
          <p className="text-xs text-muted-foreground">Zugangswerte werden nicht im Verlauf angezeigt. Eine Secret-Referenz wird erst von einem passenden Backendadapter verwendet.</p>
          <div className="space-y-2 border-t pt-3">{secrets.map((secret) => <div key={secret.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{secret.label}</p><p className="text-xs text-muted-foreground">{secret.configured ? 'Konfiguriert' : 'Wert fehlt'} · zuletzt erneuert {new Date(secret.rotated_at).toLocaleString()}</p></div><Button size="sm" variant="outline" disabled={!secretValue || rotateSecret.isPending} onClick={() => rotateSecret.mutate({ id: secret.id, version: secret.version })}>Erneuern</Button></div>)}{secrets.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Secret-Referenzen.</p>}</div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Archive className="size-4 text-muted-foreground" />Backup und Wiederherstellung</CardTitle></CardHeader><CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Backups enthalten ein Manifest mit Schema- und Pluginversionen. Nach einer Wiederherstellung ist zuerst die externe T3-Inventur abzuschließen.</p>
          <Button variant="outline" disabled={createBackup.isPending} onClick={() => createBackup.mutate()}>Backup erstellen</Button>
          <div className="space-y-2">{backups.map((backup) => <div key={backup.id} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Backup vom {new Date(backup.created_at).toLocaleString()}</p><Badge variant={backup.status === 'ready' ? 'secondary' : 'outline'}>{jobLabels[backup.status] ?? backup.status}</Badge></div>{backup.manifest && <p className="mt-1 break-all text-xs text-muted-foreground">Datenbank SHA-256 · {backup.manifest.database_sha256}</p>}{backup.error && <p className="mt-1 text-xs text-destructive">{backup.error}</p>}{backup.download_url && <a className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline" href={backup.download_url}>Backup herunterladen</a>}<Button variant="ghost" size="sm" className="mt-2" disabled={backup.status !== 'ready' || !settings!.maintenance_mode} onClick={() => setRestoreBackupId(backup.id)}>Zur Wiederherstellung auswählen</Button></div>)}{backups.length === 0 && <p className="text-sm text-muted-foreground">Noch keine lokalen Backups erstellt.</p>}</div>
          {selectedBackup && <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-sm font-medium">Wiederherstellung für Backup vom {new Date(selectedBackup.created_at).toLocaleString()}</p><p className="text-xs text-muted-foreground">Die Wiederherstellung verlangt Wartungsmodus und angehaltene Worker.</p><Label htmlFor="restore-reason">Grund</Label><Textarea id="restore-reason" value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} maxLength={2000} /><Button variant="outline" disabled={!settings!.maintenance_mode || !restoreReason.trim() || restoreBackup.isPending} onClick={() => restoreBackup.mutate()}>Wiederherstellung anfordern</Button></div>}
        </CardContent></Card>
      </section>

      <Card><CardHeader><CardTitle>Projekt-Export</CardTitle></CardHeader><CardContent className="space-y-4">
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Projekte auswählen</legend><div className="grid gap-2 sm:grid-cols-3">{projects.map((project) => <label key={project.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={exportProjectIds.includes(project.id)} onChange={(event) => setExportProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />{project.name}</label>)}</div></fieldset>
        <Button variant="outline" disabled={exportProjectIds.length === 0 || createExport.isPending} onClick={() => createExport.mutate()}>JSON-Export anfordern</Button>
        <div className="space-y-2 border-t pt-3">{exports.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{item.format.toUpperCase()} · {item.project_ids.length} Projekte</p><p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()} {item.sha256 ? `· SHA-256 ${item.sha256}` : ''}</p></div><Badge variant={item.status === 'ready' ? 'secondary' : 'outline'}>{jobLabels[item.status] ?? item.status}</Badge>{item.download_url && <a className="text-xs text-primary underline-offset-4 hover:underline" href={item.download_url}>Export herunterladen</a>}</div>)}{exports.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Exportaufträge.</p>}</div>
      </CardContent></Card>
    </main>
  )
}
