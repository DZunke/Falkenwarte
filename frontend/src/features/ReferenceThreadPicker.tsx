import { useId, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { components } from '@/generated/api'
import { api, formatError, request, type Project } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Selection = {
  connectionId: string
  value: string
  onChange: (threadId: string) => void
}

function threadOptionLabel(thread: components['schemas']['T3Thread']) {
  const provider = thread.provider_instance_id ?? 'nicht in der Threadliste übermittelt'
  const model = thread.model ?? 'nicht in der Threadliste übermittelt'

  return `${thread.title} · Providerinstanz ${provider} · Modell ${model} · Thread-ID ${thread.id}`
}

export function ReferenceThreadPicker({ connectionId, projects, value, onChange }: Selection & { projects: Project[] }) {
  const projectSelectId = `thread-project-${useId()}`
  const [chosenProject, setChosenProject] = useState('')
  const projectId = projects.length === 1 ? projects[0].id : chosenProject
  if (!connectionId || !projects.length) {
    return <p className="text-sm text-muted-foreground">Wähle eine Verbindung und ein erlaubtes Projekt, um einen Referenzthread aus T3 zu verwenden.</p>
  }

  return (
    <div className="space-y-3">
      {projects.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor={projectSelectId}>Projekt für die Threadliste</Label>
          <Select value={chosenProject} onValueChange={(id) => { setChosenProject(id); onChange('') }}>
            <SelectTrigger id={projectSelectId}><SelectValue placeholder="Projekt wählen" /></SelectTrigger>
            <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {projectId && <ProjectThreads key={projectId} projectId={projectId} connectionId={connectionId} value={value} onChange={onChange} />}
    </div>
  )
}

function ProjectThreads({ projectId, connectionId, value, onChange }: Selection & { projectId: string }) {
  const id = useId()
  const threadSelectId = `thread-choice-${id}`
  const manualThreadId = `profile-thread-${id}`
  const [manual, setManual] = useState(false)
  const binding = useQuery({
    queryKey: ['project-binding', projectId],
    queryFn: async () => {
      const response = await api.GET('/projects/{project_id}/binding', { params: { path: { project_id: projectId } } })
      if (response.response.status === 404) return null
      return request(Promise.resolve(response))
    },
  })
  const matchingBinding = binding.data?.active && binding.data.connection_id === connectionId
  const threads = useInfiniteQuery({
    queryKey: ['reference-threads', connectionId, projectId, binding.data?.version],
    enabled: Boolean(matchingBinding && !manual),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => request(api.GET('/projects/{project_id}/t3-threads', {
      params: { path: { project_id: projectId }, query: { limit: 50, cursor: pageParam } },
    })),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })

  if (binding.isPending) return <p role="status" className="text-sm text-muted-foreground">Projektbindung wird geladen…</p>
  if (binding.isError) return (
    <div role="alert" className="text-sm">
      <p>{formatError(binding.error)}</p>
      <Button variant="link" onClick={() => void binding.refetch()}>Erneut laden</Button>
    </div>
  )
  if (!matchingBinding) return <p className="text-sm">Verbinde dieses Projekt unter <a className="underline" href="#/agents">Agents &amp; T3</a> mit der gewählten T3-Verbindung.</p>

  const items = threads.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="space-y-2">
      {manual ? (
        <div className="space-y-1.5">
          <Label htmlFor={manualThreadId}>T3-Referenzthread-ID</Label>
          <Input id={manualThreadId} value={value} maxLength={256} onChange={(event) => onChange(event.target.value)} />
        </div>
      ) : (
        <>
          {threads.isLoading && <p role="status" className="text-sm text-muted-foreground">Referenzthreads werden aus T3 geladen…</p>}
          {items.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={threadSelectId}>Referenzthread aus T3</Label>
              <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={threadSelectId} className="w-full max-w-full"><SelectValue placeholder="Thread wählen" /></SelectTrigger>
                <SelectContent className="max-w-[min(90vw,36rem)]">{items.map((thread) => <SelectItem key={thread.id} className="whitespace-normal break-words" value={thread.id}>{threadOptionLabel(thread)}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Falkenwarte liest Providerinstanz und Modell aus T3 und übergibt sie an einen neuen Auftrags-Thread. Der vorhandene Threadverlauf wird nicht fortgesetzt.</p>
            </div>
          )}
          {threads.isSuccess && !items.length && <p className="text-sm text-muted-foreground">T3 meldet für dieses Projekt keine Referenzthreads.</p>}
          {threads.isError && (
            <div role="alert" className="text-sm">
              <p>{formatError(threads.error)}</p>
              <Button variant="link" size="sm" onClick={() => void (threads.isFetchNextPageError ? threads.fetchNextPage() : threads.refetch())}>Erneut laden</Button>
            </div>
          )}
          {threads.hasNextPage && !threads.isFetchNextPageError && <Button variant="outline" size="sm" disabled={threads.isFetchingNextPage} onClick={() => void threads.fetchNextPage()}>Weitere Threads laden</Button>}
        </>
      )}
      <Button variant="link" size="sm" onClick={() => { setManual(!manual); onChange('') }}>{manual ? 'Thread aus T3 wählen' : 'ID manuell eingeben'}</Button>
    </div>
  )
}
