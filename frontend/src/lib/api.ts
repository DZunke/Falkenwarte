import createClient from 'openapi-fetch'
import type { components, paths } from '@/generated/api'

export type Project = components['schemas']['Project']
export type Task = components['schemas']['Task']
export type Board = components['schemas']['Board']
export type TaskStatus = components['schemas']['TaskStatus']
export type Label = components['schemas']['LabelDefinition']
export type Session = components['schemas']['Session']
export type Actor = components['schemas']['actor']

export const api = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'same-origin',
})

let csrfToken: string | null = null

export function setCsrfToken(token: string | null) {
  csrfToken = token
}

api.use({
  onRequest({ request }) {
    if (!csrfToken || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return request
    const headers = new Headers(request.headers)
    headers.set('X-CSRF-Token', csrfToken)
    return new Request(request, { headers })
  },
})

export async function request<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const response = await result
  if (!response.response.ok) {
    const body = response.error as { detail?: string; title?: string; message?: string } | undefined
    throw new Error(body?.detail ?? body?.message ?? body?.title ?? `Anfrage fehlgeschlagen (${response.response.status})`)
  }
  return response.data as T
}

export function mutationParams(): { header: { 'Idempotency-Key': string } }
export function mutationParams(version: number): { header: { 'Idempotency-Key': string; 'If-Match': string } }
export function mutationParams(version?: number): { header: { 'Idempotency-Key': string; 'If-Match'?: string } } {
  const idempotencyKey = crypto.randomUUID()
  if (version === undefined) return { header: { 'Idempotency-Key': idempotencyKey } }
  return { header: { 'Idempotency-Key': idempotencyKey, 'If-Match': `"${version}"` } }
}

export function formatError(error: unknown) {
  return error instanceof Error ? error.message : 'Die Änderung konnte nicht gespeichert werden.'
}
