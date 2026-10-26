import type { Net } from '../net'
import { mintSocketTicket } from './http'
import type { Session } from './session'

interface Exit {
  _tag: 'Success' | 'Failure'
  value?: unknown
  cause?: Array<{ _tag: string; error?: { message?: string }; defect?: unknown }>
}

/** Some servers take several seconds to accept a socket (a busy remote box over Tailscale). */
const OPEN_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 30_000
/** Close an idle connection after this long; the next call reopens it. */
const IDLE_CLOSE_MS = 120_000

export class SocketBlockedError extends Error {
  constructor(origin: string) {
    super(`Can't open a live connection to ${new URL(origin).host}. Pair it by its https address.`)
    this.name = 'SocketBlockedError'
  }
}

export function failureMessage(exit: Exit): string {
  for (const part of exit.cause ?? []) {
    if (part.error?.message) return part.error.message
    if (part._tag === 'Die') return String(part.defect ?? 'Request rejected')
  }
  return 'Request failed'
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One reusable socket per server for request/response calls. Opening a socket costs a ticket mint
 * plus a TLS + upgrade handshake (seconds on a slow link), so a voice send that makes two calls pays
 * that once, not twice. The socket is warmed when a thread opens, so a send is usually instant.
 */
class RpcConnection {
  private socket: WebSocket | null = null
  private opening: Promise<WebSocket> | null = null
  private pending = new Map<string, Pending>()
  private idle: ReturnType<typeof setTimeout> | undefined
  private next = 0

  constructor(private readonly net: Net, private readonly session: Session) {}

  warm() { void this.open().catch(() => {}) }

  private open(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket)
    this.opening ??= this.connect().finally(() => { this.opening = null })
    return this.opening
  }

  private async connect(): Promise<WebSocket> {
    const ticket = await mintSocketTicket(this.net, this.session)
    const query = new URLSearchParams({
      clientSurface: 'mobile', clientDeviceType: 'mobile', connectionMethod: 'direct',
      orchestrationProtocol: '2', wsTicket: ticket,
    })
    const socket = new this.net.WebSocket(`${this.session.origin.replace(/^http/, 'ws')}/ws?${query}`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { try { socket.close() } catch { /* closed */ } reject(new SocketBlockedError(this.session.origin)) }, OPEN_TIMEOUT_MS)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new SocketBlockedError(this.session.origin)) }
    })
    socket.onmessage = event => this.onFrame(String(event.data))
    socket.onclose = () => this.dropped(socket)
    socket.onerror = () => { /* onclose follows */ }
    this.socket = socket
    return socket
  }

  private onFrame(raw: string) {
    let frame: { _tag: string; requestId?: string; exit?: Exit }
    try { frame = JSON.parse(raw) } catch { return }
    if (frame._tag !== 'Exit' || !frame.exit) return
    const id = String(frame.requestId)
    const waiter = this.pending.get(id)
    if (!waiter) return
    this.pending.delete(id)
    clearTimeout(waiter.timer)
    if (frame.exit._tag === 'Success') waiter.resolve(frame.exit.value)
    else waiter.reject(new Error(failureMessage(frame.exit)))
    this.scheduleIdle()
  }

  private dropped(socket: WebSocket) {
    if (this.socket !== socket) return
    this.socket = null
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Connection to T3 dropped. Try again.'))
      this.pending.delete(id)
    }
  }

  private scheduleIdle() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      if (this.pending.size) return this.scheduleIdle()
      const socket = this.socket
      this.socket = null
      try { socket?.close() } catch { /* closed */ }
    }, IDLE_CLOSE_MS)
  }

  async call<T>(tag: string, payload: unknown): Promise<T> {
    const socket = await this.open()
    const id = `g2-${++this.next}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('T3 accepted the request but did not answer in time.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      socket.send(JSON.stringify({ _tag: 'Request', id, tag, payload, headers: [] }))
    })
  }
}

const connections = new Map<string, RpcConnection>()

function connection(net: Net, session: Session): RpcConnection {
  const key = `${session.origin}|${session.accessToken}`
  let existing = connections.get(key)
  if (!existing) {
    existing = new RpcConnection(net, session)
    connections.set(key, existing)
  }
  return existing
}

/** Opens (or keeps) the request socket ahead of time so the next call does not pay the handshake. */
export const warmRpc = (net: Net, session: Session) => connection(net, session).warm()

export function rpc<T>(net: Net, session: Session, tag: string, payload: unknown): Promise<T> {
  return connection(net, session).call<T>(tag, payload)
}
