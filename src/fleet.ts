import type { Net } from './net'
import { DEFAULT_SETTINGS, loadSettings, normalizePages, PAGE_PROMPT, saveSettings, threadPageId, type NewThreadSettings, type Page, type ThreadPage } from './settings'
import { CANDIDATE_ORIGINS } from './config'
import { diagnose, type DiagStep } from './t3/diagnose'
import { exchangePairing, fetchDescriptor, type Descriptor } from './t3/http'
import { canOperate } from './t3/launch'
import { askingFirst } from './t3/pinned'
import { DEMO_ID, DEMO_PAGE_THREAD, DemoMachine } from './t3/demo'
import { Machine, type LinkState, type MachineRecord } from './t3/machine'
import { parsePairing } from './t3/pairing'
import { sessionExpired, type Store } from './t3/session'
import type { PinnedThread } from './t3/types'

export interface MachineView {
  id: string
  label: string
  host: string
  link: LinkState
  error: string | null
  canOperate: boolean
  threadCount: number
}

export interface FoundMachine {
  origin: string
  label: string
  os: string
}

export type Phase = 'loading' | 'unpaired' | 'ready'

export interface FleetState {
  phase: Phase
  machines: MachineView[]
  defaultMachineId: string | null
  threads: PinnedThread[]
  /** Open threads that are not pinned, newest first, across every machine. */
  others: PinnedThread[]
  settings: NewThreadSettings
  notice: string | null
}

type Listener = (state: FleetState) => void
/** The glasses screen, if one is connected. Returns false when it is busy (recording, sending). */
export type OpenHandler = (machineId: string, threadId: string) => boolean | Promise<boolean>

const MACHINES_KEY = 't3g2.machines'
const DEFAULT_KEY = 't3g2.defaultMachine'
const DEMO_KEY = 't3g2.demo'

/** Every paired T3 server, merged into one pinned list, plus the defaults for starting new threads. */
export class Fleet {
  state: FleetState = { phase: 'loading', machines: [], defaultMachineId: null, threads: [], others: [], settings: DEFAULT_SETTINGS, notice: null }
  private machines = new Map<string, Machine>()
  private listeners = new Set<Listener>()
  private openHandler: OpenHandler | null = null
  private flush: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly net: Net,
    private readonly store: Store,
    private readonly clientLabel: string,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Registered by the glasses UI so the phone page can send a thread to it. */
  setOpenHandler(handler: OpenHandler | null) { this.openHandler = handler }

  /** Open a thread on the glasses. `no-glasses` when none are connected, `busy` mid-recording. */
  async openOnGlasses(machineId: string, threadId: string): Promise<'ok' | 'busy' | 'no-glasses'> {
    if (!this.openHandler) return 'no-glasses'
    return (await this.openHandler(machineId, threadId)) ? 'ok' : 'busy'
  }

  machine(id: string | null | undefined): Machine | undefined {
    return id ? this.machines.get(id) : undefined
  }

  get defaultMachine(): Machine | undefined {
    return this.machine(this.state.defaultMachineId) ?? this.machines.values().next().value
  }

  async init() {
    const settings = await loadSettings(this.store)
    let records: MachineRecord[] = []
    try { records = JSON.parse((await this.store.get(MACHINES_KEY)) ?? '[]') } catch { records = [] }
    const expired = records.filter(r => sessionExpired(r.session))
    records = records.filter(r => !sessionExpired(r.session))
    const defaultMachineId = await this.store.get(DEFAULT_KEY)
    this.state = { ...this.state, settings, defaultMachineId, notice: expired.length ? `${expired.map(r => r.label).join(', ')}: session expired. Pair again.` : null }
    for (const record of records) this.attach(record)
    const demo = await this.store.get(DEMO_KEY)
    if (demo) this.attachDemo(demo === 'showcase')
    if (expired.length) await this.persist()
    this.recompute(true)
    void this.upgradeRoutes()
    setInterval(() => void this.upgradeRoutes(), 60_000)
    // Snoozes end on the clock, not on a server event; re-evaluate the list so woken threads reappear.
    setInterval(() => this.recompute(), 30_000)
  }

  /**
   * The Even app can open secure sockets to https hosts but not reliably to plain-http addresses, and
   * sending needs a socket. If a machine we reach over http is also reachable over https, move to that.
   * The same session works on either route, so nobody has to pair again.
   */
  async upgradeRoutes() {
    const secure = CANDIDATE_ORIGINS.filter(origin => origin.startsWith('https:'))
    if (!secure.length) return
    for (const machine of [...this.machines.values()]) {
      if (machine.session.origin.startsWith('https:')) continue
      for (const origin of secure) {
        const descriptor = await fetchDescriptor(this.net, origin, 4_000).catch(() => null)
        if (descriptor?.environmentId !== machine.id) continue
        machine.stop()
        this.attach({ ...machine.record, session: { ...machine.session, origin } })
        await this.persist()
        this.recompute(true)
        break
      }
    }
  }

  diagnose(id: string): Promise<DiagStep[]> {
    const machine = this.machines.get(id)
    return machine ? diagnose(this.net, machine.session) : Promise.resolve([])
  }

  private attach(record: MachineRecord) {
    this.machines.get(record.id)?.stop()
    const machine = new Machine(this.net, record, () => this.recompute(), id => void this.authLost(id))
    this.machines.set(record.id, machine)
    machine.start()
  }

  private attachDemo(showcase = false) {
    this.machines.get(DEMO_ID)?.stop()
    const demo = new DemoMachine(this.net, () => this.recompute(), showcase)
    this.machines.set(DEMO_ID, demo)
    demo.start()
  }

  /** Sample threads that work without a server. Remembered across launches until removed. */
  async startDemo(showcase = false) {
    this.attachDemo(showcase)
    if (!this.state.defaultMachineId || !this.machines.has(this.state.defaultMachineId)) this.state = { ...this.state, defaultMachineId: DEMO_ID }
    await this.store.set(DEMO_KEY, showcase ? 'showcase' : '1')
    // The demo comes with one page made by a thread, so that feature can be tried without a server.
    const page = { id: threadPageId(DEMO_ID, DEMO_PAGE_THREAD), machineId: DEMO_ID, threadId: DEMO_PAGE_THREAD, title: 'PRs & deploys' }
    const { threadPages, pages } = this.state.settings
    if (!threadPages.some(p => p.id === page.id)) await this.updateSettings({ threadPages: [...threadPages, page], pages: [...pages, page.id] })
    await this.persist()
    this.recompute(true)
  }

  get demoActive() { return this.machines.has(DEMO_ID) }

  async pair(host: string, code: string) {
    const target = parsePairing(host, code)
    const descriptor = await fetchDescriptor(this.net, target.origin)
    const session = await exchangePairing(this.net, target, this.clientLabel)
    const record: MachineRecord = { id: descriptor.environmentId, label: descriptor.label, session }
    this.attach(record)
    if (!this.state.defaultMachineId || this.state.defaultMachineId === DEMO_ID) this.state = { ...this.state, defaultMachineId: record.id }
    this.state = { ...this.state, notice: null }
    await this.persist()
    this.recompute(true)
  }

  /** Looks for unpaired T3 servers at the given origins. Unreachable ones are simply absent. */
  async discover(origins: string[]): Promise<FoundMachine[]> {
    const probed = await Promise.all(origins.map(async origin => {
      try { return { origin, descriptor: await fetchDescriptor(this.net, origin, 4_000) as Descriptor } } catch { return null }
    }))
    const seen = new Set<string>()
    const found: FoundMachine[] = []
    for (const hit of probed) {
      if (!hit || this.machines.has(hit.descriptor.environmentId) || seen.has(hit.descriptor.environmentId)) continue
      seen.add(hit.descriptor.environmentId)
      found.push({ origin: hit.origin, label: hit.descriptor.label, os: hit.descriptor.platform?.os ?? '' })
    }
    return found
  }

  async remove(id: string) {
    if (id === DEMO_ID) await this.store.remove(DEMO_KEY)
    this.machines.get(id)?.stop()
    this.machines.delete(id)
    if (this.state.defaultMachineId === id) this.state = { ...this.state, defaultMachineId: this.machines.keys().next().value ?? null }
    await this.persist()
    this.recompute(true)
  }

  private async authLost(id: string) {
    const label = this.machines.get(id)?.record.label ?? 'A server'
    await this.remove(id)
    this.state = { ...this.state, notice: `${label} rejected this device. Pair it again.` }
    this.recompute(true)
  }

  async setDefaultMachine(id: string) {
    this.state = { ...this.state, defaultMachineId: id }
    await this.store.set(DEFAULT_KEY, id)
    this.recompute(true)
  }

  /** Shows or hides a page on the glasses. The last page cannot be hidden. */
  async setPageEnabled(page: Page, on: boolean) {
    const { pages, threadPages, startPage } = this.state.settings
    const next = normalizePages(on ? [...pages, page] : pages.filter(p => p !== page), threadPages)
    if (!on && next.length === pages.length) return // it was the only one
    await this.updateSettings({ pages: next, startPage: next.includes(startPage) ? startPage : next[0] })
  }

  /** Makes a thread into a glasses page, telling it how to write one. */
  async adoptPage(machineId: string, threadId: string) {
    const machine = this.machines.get(machineId)
    const thread = machine?.thread(threadId)
    if (!machine || !thread) throw new Error('That thread is no longer available.')
    await machine.sendText(thread, `${PAGE_PROMPT} keep showing what this thread is about.`)
    await this.addPage({ id: threadPageId(machineId, threadId), machineId, threadId, title: thread.title })
  }

  /** Starts a thread that builds a page from a description. */
  async makePage(description: string) {
    const machine = this.defaultMachine
    if (!machine) throw new Error('No T3 machine paired.')
    const title = `Glasses page: ${description.slice(0, 40)}`
    const threadId = await machine.launch({ settings: this.state.settings, title, text: `${PAGE_PROMPT}\n\n${description}` })
    await this.addPage({ id: threadPageId(machine.id, threadId), machineId: machine.id, threadId, title: description.slice(0, 24) })
  }

  private async addPage(page: ThreadPage) {
    const { threadPages, pages } = this.state.settings
    if (threadPages.some(p => p.id === page.id)) return
    await this.updateSettings({ threadPages: [...threadPages, page], pages: [...pages, page.id] })
  }

  async removePage(id: Page) {
    const { threadPages, pages, startPage } = this.state.settings
    const nextPages = normalizePages(pages.filter(p => p !== id), threadPages.filter(p => p.id !== id))
    await this.updateSettings({
      threadPages: threadPages.filter(p => p.id !== id),
      pages: nextPages,
      startPage: nextPages.includes(startPage) ? startPage : nextPages[0],
    })
  }

  async renamePage(id: Page, title: string) {
    await this.updateSettings({ threadPages: this.state.settings.threadPages.map(p => (p.id === id ? { ...p, title } : p)) })
  }

  async updateSettings(patch: Partial<NewThreadSettings>) {
    const settings = { ...this.state.settings, ...patch }
    this.state = { ...this.state, settings }
    await saveSettings(this.store, settings)
    this.recompute(true)
  }

  private async persist() {
    await this.store.set(MACHINES_KEY, JSON.stringify([...this.machines.values()].filter(m => m.id !== DEMO_ID).map(m => m.record)))
    if (this.state.defaultMachineId) await this.store.set(DEFAULT_KEY, this.state.defaultMachineId)
    else await this.store.remove(DEFAULT_KEY)
  }

  /** Coalesces bursts of stream events so the glasses are not redrawn faster than BLE can follow. */
  private recompute(immediate = false) {
    const run = () => {
      this.flush = undefined
      const machines = [...this.machines.values()]
      const threads = askingFirst(machines.flatMap(m => m.pinned()))
      const pageThreads = new Set(this.state.settings.threadPages.map(p => p.id))
      const others = machines.flatMap(m => m.others()).filter(t => !pageThreads.has(threadPageId(t.machineId, t.id))).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      this.state = {
        ...this.state,
        phase: this.state.phase === 'loading' && !immediate ? 'loading' : machines.length ? 'ready' : 'unpaired',
        threads,
        others,
        machines: machines.map(m => ({
          id: m.id, label: m.record.label, host: new URL(m.session.origin).host, link: m.link, error: m.error,
          canOperate: canOperate(m.session), threadCount: m.pinned().length,
        })),
      }
      for (const listener of this.listeners) listener(this.state)
    }
    if (immediate) { clearTimeout(this.flush); run(); return }
    this.flush ??= setTimeout(run, 150)
  }
}
