import { useQuery } from '@tanstack/react-query'
import { api, request } from './api'
import type { components } from '@/generated/api'

export async function fetchAllPages<T>(loadPage: (cursor?: string) => Promise<{ items: T[]; next_cursor?: string | null }>) {
  const items: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await loadPage(cursor)
    items.push(...page.items)
    cursor = page.next_cursor ?? undefined
    if (cursor) {
      if (cursors.has(cursor)) throw new Error('Die nächste Ergebnisseite konnte nicht eindeutig geladen werden.')
      cursors.add(cursor)
    }
  } while (cursor)
  return { items }
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/projects', { params: { query: { limit: 100, cursor } } }))),
  })
}

export function useConnections() {
  return useQuery({
    queryKey: ['connections', 'all'],
    queryFn: () => fetchAllPages((cursor) => request(api.GET('/connections', { params: { query: { limit: 100, cursor } } }))),
  })
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => request(api.GET('/dashboard', {})) })
}

export function useProjectStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-statuses', projectId],
    enabled: Boolean(projectId),
    queryFn: () => request(api.GET('/projects/{project_id}/statuses', { params: { path: { project_id: projectId! } } })),
  })
}

export function useProjectLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-labels', projectId],
    enabled: Boolean(projectId),
    queryFn: () => request(api.GET('/projects/{project_id}/labels', { params: { path: { project_id: projectId! } } })),
  })
}

export function useProjectCustomFields(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-custom-fields', projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const items: components['schemas']['CustomFieldDefinition'][] = []
      let cursor: string | undefined
      do {
        const page = await request(api.GET('/projects/{project_id}/custom-fields', {
          params: { path: { project_id: projectId! }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
        }))
        items.push(...page.items)
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      return { items }
    },
  })
}

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: ['boards', projectId],
    enabled: Boolean(projectId),
    queryFn: () => request(api.GET('/projects/{project_id}/boards', { params: { path: { project_id: projectId! }, query: { limit: 100, archived: false } } })),
  })
}

export function useBoardView(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board-view', boardId],
    enabled: Boolean(boardId),
    queryFn: () => request(api.GET('/boards/{board_id}/view', { params: { path: { board_id: boardId! }, query: { limit_per_column: 100 } } })),
  })
}

export function useTask(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', taskId],
    enabled: Boolean(taskId),
    queryFn: () => request(api.GET('/tasks/{task_id}', { params: { path: { task_id: taskId! } } })),
  })
}

export function useTaskLinks(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task-links', taskId],
    enabled: Boolean(taskId),
    queryFn: () => request(api.GET('/tasks/{task_id}/link-collections', { params: { path: { task_id: taskId! } } })),
  })
}
