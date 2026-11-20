import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { components } from '@/generated/api'
import { api, formatError, mutationParams, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Project = components['schemas']['Project']
type RemoteProject = components['schemas']['RemoteProject']
type ProjectBinding = components['schemas']['ProjectBinding']

export type BoundProject = {
  project: Project
  binding: ProjectBinding
}

type Props = {
  connectionId: string
  remoteProject: RemoteProject
  projects: Project[]
  boundProjects: BoundProject[]
  sourcesReady: boolean
  sourcesError: Error | null
  onReload: () => void
  onClose: () => void
}

type BindingSelection = {
  projectId: string
}

function projectSlug(name: string) {
  let slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  if (!/^[a-z]/.test(slug)) slug = `projekt-${slug}`
  slug = slug.slice(0, 63).replace(/-+$/g, '')

  return slug.length >= 2 ? slug : 't3-projekt'
}

async function currentBinding(projectId: string) {
  const result = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: projectId } } })
  if (result.response.status === 404) return null

  return request(Promise.resolve(result))
}

export function bindingsForT3Project(boundProjects: BoundProject[], connectionId: string, externalProjectId: string) {
  return boundProjects.filter(({ binding }) => binding.connection_id === connectionId && binding.external_project_id === externalProjectId)
}

export default function ProjectBindingDialog({ connectionId, remoteProject, projects, boundProjects, sourcesReady, sourcesError, onReload, onClose }: Props) {
  const queryClient = useQueryClient()
  const availableProjects = projects.filter((project) => !project.archived && project.active_binding_id === null)
  const [mode, setMode] = useState<'existing' | 'new'>(availableProjects.length > 0 ? 'existing' : 'new')
  const matchingProjects = availableProjects.filter((project) => project.name.toLocaleLowerCase() === remoteProject.title.toLocaleLowerCase())
  const initialProject = matchingProjects.length === 1 ? matchingProjects[0] : availableProjects.length === 1 ? availableProjects[0] : undefined
  const [selectedProjectId, setSelectedProjectId] = useState(initialProject?.id ?? '')
  const [projectName, setProjectName] = useState(remoteProject.title.slice(0, 140))
  const [projectSlugValue, setProjectSlugValue] = useState(projectSlug(remoteProject.title))
  const [slugEdited, setSlugEdited] = useState(false)
  const [createdProject, setCreatedProject] = useState<Project>()
  const [errorMessage, setErrorMessage] = useState<string>()
  const projectCreateKey = useRef<{ fingerprint: string; key: string } | undefined>(undefined)

  const idempotencyKeyForProjectDraft = () => {
    const fingerprint = JSON.stringify([projectName.trim(), projectSlugValue.trim()])
    if (projectCreateKey.current?.fingerprint !== fingerprint) {
      projectCreateKey.current = { fingerprint, key: crypto.randomUUID() }
    }

    return projectCreateKey.current.key
  }

  const bind = useMutation({
    mutationFn: async ({ projectId }: BindingSelection) => {
      let project: Project

      if (createdProject) {
        project = createdProject
      } else if (mode === 'new') {
        project = await request(api.POST('/projects', {
          params: { header: { 'Idempotency-Key': idempotencyKeyForProjectDraft() } },
          body: {
            slug: projectSlugValue.trim(),
            name: projectName.trim(),
            description: '',
            icon_key: 'folder-kanban',
            color: '#176447',
            completion_policy: {
              required_evidence_kinds: [],
              require_human_approval: false,
              require_review: false,
              require_human_confirmed_criteria: true,
            },
          },
        }))
        setCreatedProject(project)
      } else {
        const selected = availableProjects.find((candidate) => candidate.id === projectId)
        if (!selected) throw new Error('Das ausgewählte Projekt ist nicht mehr verfügbar. Lade die Projektliste neu und wähle ein freies Projekt.')
        project = selected
      }

      const latestResponse = await api.GET('/projects/{project_id}', { params: { path: { project_id: project.id } } })
      const latestProject = await request(Promise.resolve(latestResponse))
      if (latestProject.archived) throw new Error('Das Falkenwarte-Projekt wurde inzwischen archiviert. Wähle ein aktives Projekt.')

      const activeBinding = await currentBinding(project.id)
      if (activeBinding) {
        if (activeBinding.connection_id === connectionId && activeBinding.external_project_id === remoteProject.external_project_id) return activeBinding
        throw new Error('Dieses Falkenwarte-Projekt ist bereits mit einem T3-Projekt verbunden. Wähle ein freies Projekt.')
      }
      if (latestProject.active_binding_id !== null) throw new Error('Für dieses Falkenwarte-Projekt ist bereits eine Zuordnung vermerkt, die nicht geladen werden konnte. Aktualisiere die Projektliste, bevor du fortfährst.')

      return request(api.PUT('/projects/{project_id}/binding', {
        params: { path: { project_id: project.id }, ...mutationParams(latestProject.version) },
        body: { connection_id: connectionId, external_project_id: remoteProject.external_project_id, max_active_runs: 1 },
      }))
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-binding-index'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-profiles'] }),
      ])
      projectCreateKey.current = undefined
      toast.success('T3-Projekt mit Falkenwarte verbunden')
      onClose()
    },
    onError: async (error) => {
      setErrorMessage(formatError(error))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-binding-index'] }),
      ])
    },
  })

  const chosenProject = createdProject ?? availableProjects.find((project) => project.id === selectedProjectId)
  const duplicate = bindingsForT3Project(boundProjects, connectionId, remoteProject.external_project_id)
  const slugIsValid = /^[a-z][a-z0-9-]{1,62}$/.test(projectSlugValue.trim())
  const canBindExisting = Boolean(chosenProject && chosenProject.active_binding_id === null)
  const canCreateAndBind = Boolean(projectName.trim() && slugIsValid)
  const isReady = createdProject ? Boolean(createdProject.active_binding_id === null) : mode === 'existing' ? canBindExisting : canCreateAndBind

  return <Dialog open onOpenChange={(open) => { if (!open && !bind.isPending) onClose() }}>
    <DialogContent data-testid="t3-project-binding-dialog" className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>T3-Projekt verbinden</DialogTitle>
        <DialogDescription>„{remoteProject.title}“ wird mit einem Falkenwarte-Projekt verknüpft. Agenten und Ausführungsziele wählst du in T3.</DialogDescription>
      </DialogHeader>

      {sourcesError && <div role="alert" className="text-sm"><p>{formatError(sourcesError)}</p><Button variant="link" onClick={onReload}>Zuordnungen erneut laden</Button></div>}
      {!sourcesReady && !sourcesError && <p role="status" className="text-sm text-muted-foreground">Projektzuordnungen werden aktualisiert…</p>}
      {duplicate.length > 0 && <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm">Dieses T3-Projekt ist bereits mit Falkenwarte-Projekten verbunden.
        <ul className="mt-2 list-disc space-y-1 pl-5">{duplicate.map(({ project }) => <li key={project.id}><a className="font-medium underline underline-offset-4" href={`#/project/${encodeURIComponent(project.id)}/board`}>{project.name}</a></li>)}</ul>
      </div>}

      {duplicate.length === 0 && <div className="space-y-4">
        {!createdProject && <div className="flex flex-wrap gap-2" role="group" aria-label="Art des Falkenwarte-Projekts">
          <Button type="button" variant={mode === 'existing' ? 'default' : 'outline'} disabled={bind.isPending || availableProjects.length === 0} onClick={() => { setMode('existing'); setErrorMessage(undefined) }}>Vorhandenes Projekt wählen</Button>
          <Button type="button" variant={mode === 'new' ? 'default' : 'outline'} disabled={bind.isPending} onClick={() => { setMode('new'); setErrorMessage(undefined) }}>Neues Falkenwarte-Projekt anlegen</Button>
        </div>}

        {createdProject && <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm">Das Falkenwarte-Projekt <strong>{createdProject.name}</strong> ist angelegt. Die T3-Verbindung steht noch aus.</div>}

        {!createdProject && mode === 'existing' && <div className="space-y-1.5">
          <Label htmlFor="binding-project-select">Falkenwarte-Projekt</Label>
          <Select value={selectedProjectId || undefined} disabled={bind.isPending} onValueChange={(value) => { setSelectedProjectId(value); setErrorMessage(undefined) }}>
            <SelectTrigger id="binding-project-select" aria-label="Falkenwarte-Projekt"><SelectValue placeholder="Projekt wählen" /></SelectTrigger>
            <SelectContent>{availableProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
          </Select>
          {availableProjects.length === 0 && <p className="text-sm text-muted-foreground">Es gibt kein aktives, freies Falkenwarte-Projekt. Lege ein neues an.</p>}
        </div>}

        {!createdProject && mode === 'new' && <div className="grid gap-4">
          <div className="space-y-1.5"><Label htmlFor="binding-project-name">Projektname</Label><Input id="binding-project-name" aria-label="Projektname" value={projectName} maxLength={140} disabled={bind.isPending} onChange={(event) => { const value = event.target.value; setProjectName(value); if (!slugEdited) setProjectSlugValue(projectSlug(value)); setErrorMessage(undefined) }} /></div>
          <div className="space-y-1.5"><Label htmlFor="binding-project-slug">Kurzname</Label><Input id="binding-project-slug" aria-label="Kurzname" value={projectSlugValue} maxLength={63} disabled={bind.isPending} onChange={(event) => { setSlugEdited(true); setProjectSlugValue(event.target.value); setErrorMessage(undefined) }} /><p className="text-xs text-muted-foreground">Wird für Ticketkennungen verwendet. Erlaubt sind Kleinbuchstaben, Zahlen und Bindestriche.</p></div>
        </div>}

        {errorMessage && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</div>}
      </div>}

      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose} disabled={bind.isPending}>Abbrechen</Button>
        {duplicate.length === 0 && <Button type="button" onClick={() => { setErrorMessage(undefined); bind.mutate({ projectId: createdProject?.id ?? selectedProjectId }) }} disabled={bind.isPending || !sourcesReady || !isReady}>{bind.isPending && <LoaderCircle className="animate-spin" />}{createdProject || mode === 'existing' ? 'Projekt verbinden' : 'Projekt anlegen und verbinden'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
