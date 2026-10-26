import type { Net } from '../net'
import { mintSocketTicket } from './http'
import { failureMessage } from './rpc'
import type { Session } from './session'

export interface StreamHandle {
  close(): void
}

interface StreamOptions<T> {
  net: Net
  session: Session
  tag: string
  /** Re-evaluated on every (re)connect so callers can resume from their last sequence. */
  payload: () => unknown
  onItem: (item: T) => void
  onState?: (state: 'connecting' | 'live' | 'retrying') => void
  onAuthLost?: () => void
}

const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

/**
 * A long-lived RPC subscription. Frames arrive as `Chunk` batches that must each be acked; any
 * failure or close reconnects with backoff and a fresh socket ticket, so a phone sleeping or
 * changing network recovers on its own.
 */
export function openStream<T>(options: StreamOptions<T>): StreamHandle {
  let closed = false
  let socket: WebSocket | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const retry = () => {
    if (closed) return
    options.onState?.('retrying')
    timer = setTimeout(connect, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)])
  }

  async function connect() {
    if (closed) return
    options.onState?.('connecting')
    let ticket: string
    try {
      ticket = await mintSocketTicket(options.net, options.session)
    } catch (error) {
      if (error instanceof Error && error.name === 'AuthError') return options.onAuthLost?.()
      return retry()
    }
    if (closed) return
    const query = new URLSearchParams({
      clientSurface: 'mobile', clientDeviceType: 'mobile', connectionMethod: 'direct',
      orchestrationProtocol: '2', wsTicket: ticket,
    })
    const id = String(Math.random()).slice(2)
    const ws = new options.net.WebSocket(`${options.session.origin.replace(/^http/, 'ws')}/ws?${query}`)
    socket = ws
    ws.onopen = () => {
      attempt = 0
      ws.send(JSON.stringify({ _tag: 'Request', id, tag: options.tag, payload: options.payload(), headers: [] }))
    }
    ws.onmessage = event => {
      let frame: { _tag: string; requestId?: string; values?: T[]; exit?: { _tag: string } }
      try { frame = JSON.parse(String(event.data)) } catch { return }
      if (frame._tag === 'Chunk' && String(frame.requestId) === id) {
        options.onState?.('live')
        for (const value of frame.values ?? []) options.onItem(value)
        ws.send(JSON.stringify({ _tag: 'Ack', requestId: id }))
      } else if (frame._tag === 'Exit' && String(frame.requestId) === id) {
        // The server ended the stream (for example a failure). Reconnect rather than going quiet.
        ws.close()
        if (frame.exit && frame.exit._tag === 'Failure') console.warn('[t3-g2] stream failed:', failureMessage(frame.exit as never))
      }
    }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = () => { if (socket === ws) { socket = null; retry() } }
  }

  void connect()
  return {
    close() {
      closed = true
      clearTimeout(timer)
      const ws = socket
      socket = null
      try { ws?.close() } catch { /* already closed */ }
    },
  }
}
