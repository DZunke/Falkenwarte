import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request, type Board } from '@/lib/api'
import { fetchAllPages, useProjectLabels } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type BoardWorkflowPolicy = components['schemas']['BoardWorkflowPolicyConfig']

export default function BoardWorkflowSettings({ board, projectId, onSaved }: { board?: Board; projectId: string; onSaved: () => Promise<void> }) {
  const client = useQueryClient()
  const labelsQuery = useProjectLabels(projectId)
  const [open, setOpen] = useState(false)
  const [versionAtOpen, setVersionAtOpen] = useState<number | null>(null)
  const [configAtOpen, setConfigAtOpen] = useState<Board['config'] | null>(null)
  const [workflowId, setWorkflowId] = useState('none')
  const [manualLabelId, setManualLabelId] = useState('none')
  const [initialWorkflowId, setInitialWorkflowId] = useState('none')
  const [initialManualLabelId, setInitialManualLabelId] = useState('none')
  const [saveError, setSaveError] = useState('')
  const [reloadError, setReloadError] = useState('')

  const workflowsQuery = useQuery({
    queryKey: ['board-workflow-settings', projectId],
    enabled: open,
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/workflows', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const profilesQuery = useQuery({
    queryKey: ['board-workflow-settings-profiles', projectId],
    enabled: open,
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/agent-profiles', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))),
  })
  const bindingQuery = useQuery({
    queryKey: ['project-binding', projectId],
    enabled: open,
    queryFn: async () => {
      const response = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: projectId } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    },
  })

  const eligibleProfiles = useMemo(() => {
    const binding = bindingQuery.data?.active ? bindingQuery.data : null
    if (!binding) return []
    return (profilesQuery.data?.items ?? []).filter((profile) => profile.enabled
      && profile.configuration_valid
      && (profile.all_projects || profile.allowed_project_ids.includes(projectId))
      && profile.connection_id === binding.connection_id)
  }, [bindingQuery.data, profilesQuery.data, projectId])
  const eligibleProfileIds = useMemo(() => new Set(eligibleProfiles.map((profile) => profile.id)), [eligibleProfiles])
  const workflows = useMemo(() => (workflowsQuery.data?.items ?? []).filter((workflow) => workflow.enabled
    && (workflow.project_id === null || workflow.project_id === projectId)
    && workflow.stages.length > 0
    && workflow.stages.every((stage) => stage.agent_profile_id !== null && eligibleProfileIds.has(stage.agent_profile_id))), [eligibleProfileIds, projectId, workflowsQuery.data])
  const activeTopicLabels = useMemo(() => (labelsQuery.data?.items ?? []).filter((label) => label.active && label.kind === 'topic'), [labelsQuery.data])
  const storedPolicy = board?.config.workflow_policy
  const storedWorkflow = storedPolicy?.workflow_id ? (workflowsQuery.data?.items ?? []).find((workflow) => workflow.id === storedPolicy.workflow_id) : undefined
  const storedLabel = storedPolicy?.manual_label_id ? (labelsQuery.data?.items ?? []).find((label) => label.id === storedPolicy.manual_label_id) : undefined
  const isDirty = workflowId !== initialWorkflowId || manualLabelId !== initialManualLabelId
  const settingsLoading = workflowsQuery.isPending || profilesQuery.isPending || labelsQuery.isPending || bindingQuery.isPending
  const settingsError = workflowsQuery.error ?? profilesQuery.error ?? labelsQuery.error ?? bindingQuery.error

  function openSettings() {
    if (!board) return
    const policy = board.config.workflow_policy
    const currentWorkflowId = policy?.workflow_id ?? 'none'
    const currentLabelId = policy?.manual_label_id ?? 'none'
    setVersionAtOpen(board.version)
    setConfigAtOpen(board.config)
    setWorkflowId(currentWorkflowId)
    setManualLabelId(currentLabelId)
    setInitialWorkflowId(currentWorkflowId)
    setInitialManualLabelId(currentLabelId)
    setSaveError('')
    setReloadError('')
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: () => {
      if (!board || versionAtOpen === null || configAtOpen === null) throw new Error('Das Board ist nicht geladen. Öffne die Einstellungen erneut.')
      const config = { ...configAtOpen }
      if (workflowId === 'none') {
        delete config.workflow_policy
      } else {
        const policy: BoardWorkflowPolicy = { workflow_id: workflowId }
        if (manualLabelId !== 'none') policy.manual_label_id = manualLabelId
        config.workflow_policy = policy
      }
      return request(api.PATCH('/boards/{board_id}', {
        params: { path: { board_id: board.id }, ...mutationParams(versionAtOpen) },
        body: { config },
      }))
    },
    onSuccess: async () => {
      setOpen(false)
      setSaveError('')
      await Promise.all([
        client.invalidateQueries({ queryKey: ['boards', projectId] }),
        client.invalidateQueries({ queryKey: ['board-view', board?.id] }),
      ])
      await onSaved()
      toast.success('Boardworkflow gespeichert')
    },
    onError: (error) => {
      setSaveError(formatError(error))
      toast.error(formatError(error))
    },
  })

  const reloadCurrent = useMutation({
    mutationFn: async () => {
      if (!board) throw new Error('Das Board ist nicht geladen.')
      return request(api.GET('/boards/{board_id}', { params: { path: { board_id: board.id } } }))
    },
    onSuccess: (latest) => {
      const policy = latest.config.workflow_policy
      const currentWorkflowId = policy?.workflow_id ?? 'none'
      const currentLabelId = policy?.manual_label_id ?? 'none'
      setVersionAtOpen(latest.version)
      setConfigAtOpen(latest.config)
      setWorkflowId(currentWorkflowId)
      setManualLabelId(currentLabelId)
      setInitialWorkflowId(currentWorkflowId)
      setInitialManualLabelId(currentLabelId)
      setSaveError('')
      setReloadError('')
      void Promise.all([
        client.invalidateQueries({ queryKey: ['boards', projectId] }),
        client.invalidateQueries({ queryKey: ['board-view', board?.id] }),
      ])
      toast.success('Aktuelle Boardeinstellungen geladen')
    },
    onError: (error) => setReloadError(formatError(error)),
  })

  if (!board) return null

  return <>
    <Button variant="outline" size="sm" onClick={openSettings}><GitBranch />Workflowstandard</Button>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!save.isPending && !reloadCurrent.isPending) setOpen(nextOpen) }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Boardworkflow festlegen</DialogTitle>
          <DialogDescription>Diese Vorgabe gilt für neue Starts auf „{board.name}“. Sie startet keinen Workflow von selbst und ändert keine bestehenden Tickets oder laufenden Abläufe.</DialogDescription>
        </DialogHeader>
        {settingsLoading ? <p role="status" className="py-3 text-sm text-muted-foreground">Projektbindung, Rollen, Workflows und Themenlabels werden geladen…</p> : settingsError ? <div className="space-y-3 py-2"><p role="alert" className="text-sm text-destructive">{formatError(settingsError)}</p><Button variant="outline" size="sm" onClick={() => void Promise.all([workflowsQuery.refetch(), profilesQuery.refetch(), bindingQuery.refetch(), labelsQuery.refetch()])}>Einstellungen erneut laden</Button></div> : <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label htmlFor="board-default-workflow">Standardworkflow</Label><Select value={workflowId} onValueChange={(value) => { setWorkflowId(value); if (value === 'none') setManualLabelId('none'); setSaveError('') }}><SelectTrigger id="board-default-workflow"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Kein Workflowstandard</SelectItem>{storedWorkflow && !workflows.some((workflow) => workflow.id === storedWorkflow.id) && <SelectItem value={storedWorkflow.id} disabled>{storedWorkflow.name} · nicht mehr verfügbar</SelectItem>}{workflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.name} · Version {workflow.definition_version}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Beim ausdrücklichen Workflowstart im Ticket wird diese Vorlage vorausgewählt.</p>{workflows.length === 0 && <p className="text-xs text-muted-foreground">Für dieses Projekt ist keine aktive Workflowvorlage mit freigegebenen Rollen verfügbar.</p>}</div>
          <div className="grid gap-2"><Label htmlFor="board-manual-label">Label für manuelle Tickets</Label><Select value={workflowId === 'none' ? 'none' : manualLabelId} onValueChange={(value) => { setManualLabelId(value); setSaveError('') }} disabled={workflowId === 'none'}><SelectTrigger id="board-manual-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Kein Ausschlusslabel</SelectItem>{storedLabel && !activeTopicLabels.some((label) => label.id === storedLabel.id) && <SelectItem value={storedLabel.id} disabled>{storedLabel.name} · nicht mehr aktiv</SelectItem>}{activeTopicLabels.map((label) => <SelectItem key={label.id} value={label.id}>{label.name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Tickets mit diesem aktiven Themenlabel werden als manuelle Boardarbeit behandelt und starten nicht mit dem Boardworkflow.</p>{activeTopicLabels.length === 0 && workflowId !== 'none' && <p className="text-xs text-muted-foreground">Lege zuerst unter <strong>Labels</strong> ein aktives Themenlabel an, wenn einzelne Tickets vom Standard ausgenommen werden sollen.</p>}</div>
        </div>}
        {saveError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}<p className="mt-1 text-xs">Wenn sich die Boardversion geändert hat, lade die aktuelle Fassung und prüfe deine Auswahl erneut.</p><Button className="mt-2" variant="outline" size="sm" onClick={() => reloadCurrent.mutate()} disabled={reloadCurrent.isPending}>{reloadCurrent.isPending ? 'Wird geladen…' : 'Aktuelle Boardversion laden'}</Button></div>}
        {reloadError && <p role="alert" className="text-sm text-destructive">Die aktuelle Boardversion konnte nicht geladen werden: {reloadError}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending || reloadCurrent.isPending}>Abbrechen</Button><Button onClick={() => save.mutate()} disabled={settingsLoading || Boolean(settingsError) || workflowId !== 'none' && !workflows.some((workflow) => workflow.id === workflowId) && workflowId !== initialWorkflowId || !isDirty || save.isPending || reloadCurrent.isPending}>{save.isPending ? 'Speichert…' : 'Einstellungen speichern'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
