import { useQuery } from '@tanstack/react-query'
import { api, request } from './api'
import type { Project } from './api'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const items: Project[] = []
      let cursor: string | undefined
      do {
        const page = await request(api.GET('/projects', { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }))
        items.push(...page.items)
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      return { items }
    },
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
