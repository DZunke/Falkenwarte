import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, mutationParams, request } from './api'

type LiveStatus = 'connecting' | 'connected' | 'reconnecting'

/** Re-fetch public JSON snapshots after every connection and coalesce bursts of outbox hints. */
export function useLive(authenticated: boolean): LiveStatus {
  const client = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    if (!authenticated) return
    const controller = new AbortController()
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout>
    let refresh: ReturnType<typeof setTimeout> | undefined
    let backoff = 1000
    const seen = new Set<string>()

    function snapshot() {
      if (refresh) return
      refresh = setTimeout(() => {
        refresh = undefined
        void client.invalidateQueries({ predicate: query => !['session', 'bootstrap'].includes(String(query.queryKey[0])) })
      }, 80)
    }

    function reconnect() {
      source?.close()
      clearTimeout(timer)
      if (controller.signal.aborted) return
      setStatus('reconnecting')
      if (!navigator.onLine) return
      timer = setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 30_000)
    }

    async function connect() {
      if (controller.signal.aborted) return
      try {
        const config = await request(api.GET('/live/config', { signal: controller.signal }))
        const renewal = await api.POST('/live/authorize', { params: mutationParams(), body: {}, signal: controller.signal })
        if (renewal.response.status === 401) {
          await client.invalidateQueries({ queryKey: ['session'] })
          return
        }
        if (!renewal.data) throw new Error('Der Live-Zugang ist nicht verfügbar.')
        if (controller.signal.aborted) return
        const url = new URL(config.public_url, location.href)
        if (url.origin !== location.origin) throw new Error('Der Live-Kanal benötigt dieselbe Adresse wie die Anwendung.')
        for (const topic of renewal.data.topics) url.searchParams.append('match', topic)
        source?.close()
        source = new EventSource(url, { withCredentials: true })
        source.onopen = () => {
          backoff = 1000
          setStatus('connected')
          snapshot()
        }
        source.onmessage = event => {
          try {
            const data = JSON.parse(event.data) as { event_id?: string }
            if (!data.event_id || seen.has(data.event_id)) return
            seen.add(data.event_id)
            if (seen.size > 512) seen.delete(seen.values().next().value!)
          } catch {
            // An unreadable hint still requires fresh authoritative state.
          }
          snapshot()
        }
        source.onerror = reconnect
        timer = setTimeout(connect, Math.max(1000, Date.parse(renewal.data.expires_at) - Date.now() - 30_000))
      } catch {
        reconnect()
      }
    }

    window.addEventListener('offline', reconnect)
    window.addEventListener('online', reconnect)
    void connect()
    return () => {
      window.removeEventListener('offline', reconnect)
      window.removeEventListener('online', reconnect)
      controller.abort()
      source?.close()
      clearTimeout(timer)
      clearTimeout(refresh)
    }
  }, [authenticated, client])
  return status
}
