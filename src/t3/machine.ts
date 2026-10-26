import type { Net } from '../net'
import { applyEvent, currentStep, fromSnapshot as liveFromSnapshot, type ThreadEvent, type ThreadLive } from './activity'
import { AuthError, fetchThread } from './http'
import { launchThread, type LaunchInput } from './launch'
import { isBusy, isGlassesThread, isOtherThread, toPinned } from './pinned'
import { rpc, warmRpc } from './rpc'
import { parseServerConfig, type ServerConfig } from './serverConfig'
import { respondToRequest, sendTextMessage, sendVoiceMessage, type RequestResponse } from './send'
import type { Session } from './session'
import { applyShellItem, emptyShell, type ShellItem, type ShellState } from './shellStore'
import { openStream, type StreamHandle } from './stream'
import type { PinnedThread, ThreadStatus } from './types'
import { fetchShell } from './http'
import { fromSnapshot as shellFromSnapshot } from './shellStore'

export interface MachineRecord {
  id: string
  label: string
  session: Session
}

export type LinkState = 'connecting' | 'live' | 'retrying'

export interface OpenThread {
  close(): void
}

/** A thread at a glance, for the list: what it is doing now and its latest reply. */
export interface Glance {
  /** The step the agent is on, e.g. "$ pnpm test"; null when nothing is running. */
  step: string | null
  /** The newest agent reply, as written. */
  reply: string | null
}

/** What the list wants to know about each visible thread. */
export interface GlanceWants { activity: boolean; reply: boolean }

interface Watched {
  live: ThreadLive | null
  /** The thread's `updatedAt` when its snapshot was last fetched (replies only change when it does). */
  fetchedFor: string
  stream: OpenThread | null
}

const FALLBACK_POLL_MS = 10_000
const THREAD_FALLBACK_POLL_MS = 4_000
const STREAM_GRACE_MS = 8_000

/** One paired T3 server: its live thread feed, plus everything we ask of it. */
export class Machine {
  link: LinkState = 'connecting'
  shell: ShellState = emptyShell()
  error: string | null = null
  private stream: StreamHandle | null = null
  private fallback: ReturnType<typeof setInterval> | undefined
  private lastLive = 0
  private firstSnapshot = true
  private configCache: Promise<ServerConfig> | null = null
  private watched = new Map<string, Watched>()

  constructor(
    private readonly net: Net,
    readonly record: MachineRecord,
    protected readonly onChange: () => void,
    private readonly onAuthLost: (id: string) => void,
  ) {}

  get id() { return this.record.id }

  /** Get the request socket ready (called when you start talking). */
  warm() { warmRpc(this.net, this.session) }
  get session() { return this.record.session }

  start() {
    this.stop()
    this.stream = openStream<ShellItem>({
      net: this.net,
      session: this.session,
      tag: 'orchestration.subscribeShell',
      payload: () => ({ omitIdleSubagents: true, omitOlderSettled: true }),
      onItem: item => {
        // The first snapshot on a (re)connection is authoritative; keep the old view until it lands.
        if (item.kind === 'snapshot' && item.snapshot && this.firstSnapshot) {
          this.firstSnapshot = false
          this.shell = shellFromSnapshot(item.snapshot)
        } else this.shell = applyShellItem(this.shell, item)
        this.error = null
        this.onChange()
      },
      onState: state => {
        this.link = state
        if (state !== 'live') this.firstSnapshot = true
        if (state === 'live') this.lastLive = Date.now()
        this.onChange()
      },
      onAuthLost: () => this.onAuthLost(this.id),
    })
    // The push stream is the primary path; this only runs while it is down (and so covers a
    // WebView that blocks sockets).
    this.fallback = setInterval(() => {
      if (this.link !== 'live' && Date.now() - this.lastLive > STREAM_GRACE_MS) void this.poll()
    }, FALLBACK_POLL_MS)
    void this.poll()
  }

  stop() {
    for (const w of this.watched.values()) w.stream?.close()
    this.watched.clear()
    this.stream?.close()
    this.stream = null
    clearInterval(this.fallback)
  }

  async poll() {
    try {
      this.shell = shellFromSnapshot(await fetchShell(this.net, this.session))
      this.error = null
    } catch (error) {
      if (error instanceof AuthError) return this.onAuthLost(this.id)
      this.error = error instanceof Error ? error.message : 'Could not reach this server.'
    }
    this.onChange()
  }

  pinned(): PinnedThread[] {
    const snapshot = { threads: [...this.shell.threads.values()], projects: [...this.shell.projects.values()] }
    const projects = new Map(snapshot.projects.map(p => [p.id, p.title]))
    return snapshot.threads
      .filter(t => isGlassesThread(t))
      .sort(pinOrder)
      .map(t => toPinned(t, projects, { id: this.id, label: this.record.label }))
  }

  /**
   * Keeps a light view of the threads the list is showing. A running thread is followed live (for its
   * current step); others are fetched once per change, and only when replies are wanted. Threads that
   * scroll out of view are dropped. Cheap to call on every redraw.
   */
  watch(visible: PinnedThread[], wants: GlanceWants) {
    const ids = new Set(visible.map(t => t.id))
    for (const [id, w] of this.watched) {
      if (ids.has(id)) continue
      w.stream?.close()
      this.watched.delete(id)
    }
    for (const t of visible) {
      let w = this.watched.get(t.id)
      if (!w) this.watched.set(t.id, w = { live: null, fetchedFor: '', stream: null })
      const entry = w
      if (wants.activity && isBusy(t.status)) {
        entry.stream ??= this.openThread(t.id, live => { entry.live = live; this.onChange() })
      } else {
        entry.stream?.close()
        entry.stream = null
        if (wants.reply && entry.fetchedFor !== t.updatedAt) {
          entry.fetchedFor = t.updatedAt
          void fetchThread(this.net, this.session, t.id)
            .then(snapshot => { entry.live = liveFromSnapshot(snapshot as never); this.onChange() })
            .catch(() => {}) // tried again when the thread next changes
        }
      }
    }
  }

  glance(threadId: string): Glance | undefined {
    const live = this.watched.get(threadId)?.live
    if (!live) return undefined
    const reply = live.messages.findLast(m => m.role === 'assistant' && m.text.trim())
    return { step: currentStep(live)?.label ?? null, reply: reply?.text ?? null }
  }

  /** Open threads that are not pinned, most recently changed first. */
  others(): PinnedThread[] {
    const projects = new Map([...this.shell.projects.values()].map(p => [p.id, p.title]))
    return [...this.shell.threads.values()]
      .filter(t => isOtherThread(t))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
      .map(t => toPinned(t, projects, { id: this.id, label: this.record.label }))
  }

  /** Any thread this server knows, pinned or not (used right after starting a new one). */
  thread(id: string): PinnedThread | undefined {
    const t = this.shell.threads.get(id)
    if (!t) return undefined
    const projects = new Map([...this.shell.projects.values()].map(p => [p.id, p.title]))
    return toPinned(t, projects, { id: this.id, label: this.record.label })
  }

  projects() {
    return [...this.shell.projects.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  config(): Promise<ServerConfig> {
    this.configCache ??= rpc<Parameters<typeof parseServerConfig>[0]>(this.net, this.session, 'server.getConfig', {})
      .then(parseServerConfig)
      .catch(error => { this.configCache = null; throw error })
    return this.configCache
  }

  /**
   * Loads a thread, then keeps it current from the push stream. If the stream cannot connect (some
   * WebViews block sockets) it falls back to refetching the snapshot every few seconds.
   */
  openThread(threadId: string, onLive: (live: ThreadLive) => void): OpenThread {
    warmRpc(this.net, this.session)
    let closed = false
    let live: ThreadLive | null = null
    let handle: StreamHandle | null = null
    let streaming = false
    let poller: ReturnType<typeof setInterval> | undefined
    const emit = (next: ThreadLive) => { live = next; if (!closed) onLive(next) }

    const load = async () => {
      const snapshot = await fetchThread(this.net, this.session, threadId)
      if (!closed) emit(liveFromSnapshot(snapshot as never))
    }

    void (async () => {
      try {
        await load()
      } catch (error) {
        if (error instanceof AuthError) return this.onAuthLost(this.id)
        this.error = error instanceof Error ? error.message : 'Could not load the thread.'
        this.onChange()
        return
      }
      if (closed) return
      handle = openStream<ThreadEvent>({
        net: this.net,
        session: this.session,
        tag: 'orchestration.subscribeThread',
        payload: () => ({ threadId, afterSequence: live?.sequence ?? 0 }),
        onItem: item => { if (live) emit(applyEvent(live, item)) },
        onState: state => { streaming = state === 'live' },
        onAuthLost: () => this.onAuthLost(this.id),
      })
      poller = setInterval(() => { if (!streaming && !closed) void load().catch(() => {}) }, THREAD_FALLBACK_POLL_MS)
    })()

    return { close() { closed = true; handle?.close(); clearInterval(poller) } }
  }

  sendVoice(thread: { id: string; status: ThreadStatus }, wav: Uint8Array, prompt: string) {
    return this.guard(() => sendVoiceMessage(this.net, this.session, thread, wav, prompt))
  }

  respond(threadId: string, requestId: string, response: RequestResponse) {
    return this.guard(() => respondToRequest(this.net, this.session, threadId, requestId, response))
  }

  sendText(thread: { id: string; status: ThreadStatus }, text: string) {
    return this.guard(() => sendTextMessage(this.net, this.session, thread, text))
  }

  async launch(input: Omit<LaunchInput, 'config'>) {
    const config = await this.config().catch(() => null)
    return this.guard(() => launchThread(this.net, this.session, { ...input, config }))
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof AuthError) this.onAuthLost(this.id)
      throw error
    }
  }
}

function pinOrder(a: { id: string; pinOrderKey?: string | null; createdAt: string }, b: typeof a): number {
  const ka = a.pinOrderKey ?? null
  const kb = b.pinOrderKey ?? null
  if (ka !== null && kb !== null) return ka < kb ? -1 : ka > kb ? 1 : a.id.localeCompare(b.id)
  if (ka !== null) return -1
  if (kb !== null) return 1
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)
}
