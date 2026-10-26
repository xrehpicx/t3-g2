import type {
  AudioInputSource as AudioSource,
  EvenAppBridge,
  EvenHubEvent,
  OsEventTypeList as EventType,
} from '@evenrealities/even_hub_sdk'
import { startSendHold, type SendHold } from '../audio/hold'
import { Recorder } from '../audio/recorder'
import { AUDIO_PROBLEM_TEXT, audioProblem, durationMs, peak, pcm16ToWav } from '../audio/wav'
import type { Fleet, FleetState } from '../fleet'
import { currentStep, emptyLive, type PendingRequest, type ThreadLive } from '../t3/activity'
import { isThreadPage, PAGE_PROMPT, PAGES, threadPageId, voiceText, type Page, type ThreadPage } from '../settings'
import { isMissing, RESET_TEXT } from '../t3/insights'
import { VOICE_ANSWER } from '../t3/send'
import { SCRATCH } from '../t3/launch'
import type { Machine, OpenThread } from '../t3/machine'
import { isBusy } from '../t3/pinned'
import type { PinnedThread } from '../t3/types'
import { clipWidth, fitWidth, SAFETY_PX, textWidth, wrapWidth } from './font'
import {
  age, alignRight, BAR_W, chatsHeader, MARK, plainText, chatBar, chatLines, clock, FULL_W, LIST_ROWS, listLayers,
  listHeader, listStart, levelGlyph, markFor, rowsH, rowY, scrollbar, spinner, TEXT_W, THREAD_BODY_ROWS,
  attentionFirst, buildRows, CLOCK_W, formatClock, listDetail, loadedFor, PAGE_SIZE, TITLE_SIDE_W, titleBadge, SEP_KEY, type ListRow,
  approvalView, choiceLayers, DONE_KEY, questionView, type AnswerView,
} from './screens'
import { dashboardLines, pageDots, pageWindow, usageLines, type PageLine, type PageMachine } from './pages'
import { contentChanged, initialScroll, jumpToBottom, scrollNewer, scrollOlder, visible, type ScrollState } from './scroll'

type Sdk = typeof import('@evenrealities/even_hub_sdk')
type Screen = 'status' | 'list' | 'thread' | 'compose' | 'answer'

const SEEN_KEY = 't3g2.seen'
const NOTICE_MS = 4_500
const RENDER_MS = 300
const LEVEL_SLOTS = 8
/** Items in the glasses' own menu (tap, then long press). */
const MENU_CANCEL_SEND = 1
const MENU_JUMP_TOP = 2
const MENU_RECORD = 3
const MENU_SEND_NOW = 4
const MENU_DISCARD = 5
const MENU_REFRESH = 6
const MENU_NEW_PAGE = 7
/** Menu ids for switching page: MENU_PAGE + the page's index in PAGES. */
const MENU_PAGE = 20
const ROWS_TOTAL = 10
/** Body rows on the dashboard and usage pages, between the header and the status row. */
const PAGE_ROWS = ROWS_TOTAL - 2

/** Container ids/names are shared across screens; each screen uses a subset. */
const C = {
  head: [1, 'head'], side: [2, 'side'], status: [3, 'status'], body: [4, 'body'], bar: [5, 'bar'], selected: [6, 'selected'], input: [7, 'input'], prompt: [8, 'prompt'], thumb: [9, 'thumb'], clock: [10, 'clock'],
} as const
type Slot = keyof typeof C

/** Text brightness, 0 (dimmest) to 4. */
const DIM = 2
const MID = 3
const BRIGHT = 4

const keyOf = (t: { machineId: string; id: string }) => `${t.machineId}:${t.id}`

/** Chat reads bottom-up: a short conversation sits just above the live line, not under the title. */
const bottomAnchor = (lines: string[], rows: number) =>
  lines.length ? [...Array(Math.max(0, rows - lines.length)).fill(''), ...lines].join('\n') : ''

interface Box { slot: Slot; x: number; y: number; w: number; h: number; text: string; brightness: number }

/**
 * The glasses UI. Every screen fills all 10 rows of the display:
 *
 *   list    PINNED 6   ▶ 1   ★ 1
 *           > ▶ glases                      3:12 │
 *             ○ local                         8m │
 *
 *   thread  glases                       ▶ 3:12
 *           ▅ $ npm test
 *           …chat, newest at the bottom…        █
 */
export class GlassesController {
  private screen: Screen = 'status'
  private created = false
  private layout = ''
  private sent = new Map<Slot, string>()
  private bright = new Map<Slot, number>()
  private pinnedList: PinnedThread[] = []
  private otherList: PinnedThread[] = []
  private current: PinnedThread | null = null
  private live: ThreadLive = emptyLive()
  private openThread: OpenThread | null = null
  private scroll: ScrollState = initialScroll()
  private recorder: Recorder
  private sending = false
  /** The 3-second grace period before a voice message goes out; a double tap cancels it. */
  private hold: SendHold | null = null
  private notice = ''
  private noticeTimer: ReturnType<typeof setTimeout> | undefined
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  private seen: Record<string, string> = {}
  private rendering: Promise<void> = Promise.resolve()
  /** A hands-free recording: started from the menu, so it keeps going after the touchpad is released. */
  private latched = false
  private latest: { layout: string; boxes: Box[]; menu?: Array<[number, string]> } | null = null
  private cursorKey = 'new'
  /** The top-level page the list screen shows. */
  private page: Page | null = null
  private pageTop = 0
  /** Index into the usage page's choices (its limits). */
  private pageCursor = 0
  /** A limit whose reset credit is waiting for a second tap to confirm. */
  private confirmReset: string | null = null
  /** The live thread behind a thread page, while that page is showing. */
  private pageStream: { id: string; handle: OpenThread } | null = null
  private pageLive: ThreadLive = emptyLive()
  /** What the compose screen starts: a thread, or a thread that becomes a page. */
  private composeKind: 'thread' | 'page' = 'thread'
  /** How many threads the list has loaded so far; grows by a page as you reach the end. */
  private loaded = PAGE_SIZE
  private listTop = 0
  private tick = 0
  private levels: string[] = []
  private composeModel = ''
  /** The question or approval being answered, and the answers so far. */
  private answer: {
    request: PendingRequest
    q: number
    cursor: number
    top: number
    chosen: Record<string, string[]>
    voiced: Record<string, Uint8Array>
  } | null = null

  constructor(
    private readonly sdk: Sdk,
    private readonly bridge: EvenAppBridge,
    private readonly fleet: Fleet,
    private readonly store: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> },
  ) {
    this.recorder = new Recorder(bridge, () => void this.stopAndSend())
  }

  async start() {
    try { this.seen = JSON.parse((await this.store.get(SEEN_KEY)) ?? '{}') } catch { this.seen = {} }
    this.bridge.onEvenHubEvent(event => this.onEvent(event))
    this.fleet.subscribe(state => void this.onFleet(state))
    this.fleet.setOpenHandler((machineId, threadId) => this.openFromPhone(machineId, threadId))
    // One clock drives timers, the activity spinner and the record meter. It only redraws what changed.
    setInterval(() => { this.tick++; this.refreshInsights(); void this.refresh() }, 1000)
    await this.onFleet(this.fleet.state)
  }

  // --- state -------------------------------------------------------------------------------

  private async onFleet(state: FleetState) {
    if (state.phase === 'loading') return this.showMessage('T3 Code', 'Connecting...')
    if (state.phase === 'unpaired') {
      this.closeThreadStream()
      this.screen = 'status'
      return this.showMessage('T3 Code', 'Not connected.\n\nOpen this app on your phone\nand pair it with your T3 Code machine.\n\nTap to try the demo.')
    }
    if (!this.page || !state.settings.pages.includes(this.page)) this.page = state.settings.startPage
    this.pinnedList = state.threads
    this.otherList = state.others
    this.markFirstSeen()
    if (this.screen === 'thread' && this.current) {
      const fresh = this.machineOf(this.current)?.thread(this.current.id)
      if (fresh) this.current = fresh
      return this.scheduleRender()
    }
    if (this.screen === 'compose') return
    const unreachable = state.machines.length > 0 && state.machines.every(m => m.link !== 'live' && m.error)
    if (unreachable && !state.threads.length) {
      this.screen = 'status'
      return this.showMessage('T3 Code', `Can't reach your machine.\n\n${state.machines[0]?.error ?? ''}\nRetrying...`)
    }
    if (this.screen !== 'list') { this.screen = 'list'; this.layout = '' }
    return this.renderList()
  }

  private machineOf(thread: { machineId: string }): Machine | undefined {
    return this.fleet.machine(thread.machineId)
  }

  private markFirstSeen() {
    let changed = false
    for (const thread of [...this.pinnedList, ...this.otherList]) {
      if (!(keyOf(thread) in this.seen)) { this.seen[keyOf(thread)] = thread.updatedAt; changed = true }
    }
    if (changed) void this.store.set(SEEN_KEY, JSON.stringify(this.seen))
  }

  /** Pinned threads, then the rest, each with what needs you and what is new on top. */
  private get threads(): PinnedThread[] {
    if (this.page === 'chats') return attentionFirst(this.otherList, this.unread)
    // With no Chats page, the other chats follow the pinned ones in their own section.
    const others = this.fleet.state.settings.pages.includes('chats') ? [] : this.otherList
    return [...attentionFirst(this.pinnedList, this.unread), ...attentionFirst(others, this.unread)]
  }

  private unread = (thread: PinnedThread) => thread.updatedAt > (this.seen[keyOf(thread)] ?? '')

  private markSeen(thread: PinnedThread) {
    this.seen[keyOf(thread)] = thread.updatedAt
    void this.store.set(SEEN_KEY, JSON.stringify(this.seen))
  }

  // --- drawing -----------------------------------------------------------------------------

  /**
   * Draws a screen. The first draw of a layout rebuilds the page; later draws with the same layout only
   * push the containers whose text or brightness changed, which is flicker-free and cheap over BLE.
   */
  private draw(nextLayout: string, nextBoxes: Box[], menu?: Array<[number, string]>): Promise<void> {
    // Only the newest frame matters: a frame queued behind a slow BLE update is dropped rather than
    // painted late over a newer screen.
    this.latest = { layout: nextLayout, boxes: nextBoxes, menu }
    this.rendering = this.rendering.catch(() => {}).then(async () => {
      const frame = this.latest
      if (!frame) return
      this.latest = null
      const { layout, boxes, menu } = frame
      if (layout === this.layout && this.created) {
        for (const box of boxes) {
          const text = box.text || ' '
          if (this.sent.get(box.slot) === text && this.bright.get(box.slot) === box.brightness) continue
          this.sent.set(box.slot, text)
          this.bright.set(box.slot, box.brightness)
          const [id, name] = C[box.slot]
          await this.bridge.textContainerUpgrade(new this.sdk.TextContainerUpgrade({
            containerID: id, containerName: name, content: text, textColor: box.brightness,
          })).catch(() => false)
        }
        return
      }
      this.layout = layout
      this.sent.clear()
      this.bright.clear()
      // Input goes to an empty full-screen layer underneath everything. The firmware animates a
      // scroll "bounce" on whichever container captures swipes; with nothing in it, nothing moves.
      const input = new this.sdk.TextContainerProperty({
        xPosition: 0, yPosition: 0, width: FULL_W, height: 288, containerID: C.input[0], containerName: C.input[1],
        content: ' ', isEventCapture: 1, paddingLength: 0, borderWidth: 0,
      })
      const textObject = [input, ...boxes.map(box => {
        const [id, name] = C[box.slot]
        const text = box.text || ' '
        this.sent.set(box.slot, text)
        this.bright.set(box.slot, box.brightness)
        return new this.sdk.TextContainerProperty({
          xPosition: box.x, yPosition: box.y, width: box.w, height: box.h,
          containerID: id, containerName: name, content: text, textColor: box.brightness,
          isEventCapture: 0, paddingLength: 0, borderWidth: 0,
        })
      })]
      // The menu is replaced wholesale on every rebuild, so each screen declares its own.
      const menuObject = menu
        ? new this.sdk.MenuContainerProperty({ menuItems: menu.map(([itemID, itemName]) => new this.sdk.MenuItemProperty({ itemID, itemName })) })
        : undefined
      const page = { containerTotalNum: textObject.length, textObject, ...(menuObject ? { menuObject } : {}) }
      if (!this.created) {
        const result = await this.bridge.createStartUpPageContainer(new this.sdk.CreateStartUpPageContainer(page))
        // A reloaded WebView already owns a page; replace it instead.
        this.created = result === 0 || await this.bridge.rebuildPageContainer(new this.sdk.RebuildPageContainer(page))
        if (!this.created) console.error('[t3-g2] could not create the glasses page', result)
      } else if (!(await this.bridge.rebuildPageContainer(new this.sdk.RebuildPageContainer(page)))) {
        console.error('[t3-g2] page rebuild rejected', layout)
      }
    })
    return this.rendering
  }

  /** Dim track and bright thumb, overlaid. */
  private barBoxes(bar: { track: string; thumb: string }, y: number, h: number): Box[] {
    return [
      { slot: 'bar', x: FULL_W - BAR_W, y, w: BAR_W, h, text: bar.track, brightness: 1 },
      { slot: 'thumb', x: FULL_W - BAR_W, y, w: BAR_W, h, text: bar.thumb, brightness: BRIGHT },
    ]
  }

  private showMessage(title: string, body: string) {
    return this.draw(`message:${title}:${body}`, [
      { slot: 'head', x: 0, y: rowY(0), w: FULL_W, h: rowsH(1), text: title, brightness: BRIGHT },
      { slot: 'body', x: 0, y: rowY(1), w: FULL_W, h: rowsH(9), text: body, brightness: MID },
    ])
  }

  private scheduleRender() {
    if (this.renderTimer) return
    this.renderTimer = setTimeout(() => { this.renderTimer = undefined; void this.refresh() }, RENDER_MS)
  }

  private refresh() {
    if (this.screen === 'answer') return this.renderAnswer()
    if (this.screen === 'list') return this.renderList()
    if (this.screen === 'thread') return this.renderThread()
    if (this.screen === 'compose') return this.renderCompose()
  }

  // --- list --------------------------------------------------------------------------------

  private rows(): ListRow[] {
    const { listFields } = this.fleet.state.settings
    const several = this.fleet.state.machines.length > 1
    const detail = (t: PinnedThread) => listDetail(listFields, t, this.machineOf(t)?.glance(t.id), several)
    return buildRows(this.threads, this.unread, Date.now(), detail, this.loaded, this.page === 'chats' ? undefined : this.pinnedList.length)
  }

  /** Tells each machine which threads the list is showing, so it can follow what they are doing. */
  private watchVisible() {
    const { listFields } = this.fleet.state.settings
    const wants = { activity: listFields.includes('activity'), reply: listFields.includes('reply') }
    // Rows are `+ New thread` then the threads; keep a little beyond the window so scrolling is instant.
    const shown = this.threads.slice(0, this.loaded).slice(Math.max(0, this.listTop - 1), this.listTop + LIST_ROWS + 1)
    for (const machine of this.fleet.state.machines) {
      const machineObject = this.fleet.machine(machine.id)
      machineObject?.watch(wants.activity || wants.reply ? shown.filter(t => t.machineId === machine.id) : [], wants)
    }
  }

  private cursor(rows: ListRow[]): number {
    const at = rows.findIndex(r => r.key === this.cursorKey)
    return at < 0 ? 0 : at
  }

  private renderList() {
    if (this.page === 'dashboard') return this.renderDashboard()
    if (this.page === 'usage') return this.renderUsage()
    if (this.page && isThreadPage(this.page)) return this.renderThreadPage(this.page)
    this.closePageStream()
    this.watchVisible()
    const rows = this.rows()
    const cursor = this.cursor(rows)
    this.listTop = listStart(rows.length, cursor, this.listTop)
    const bar = scrollbar(this.threads.length + 1 + (this.otherList.length ? 1 : 0), this.listTop, LIST_ROWS)
    const width = FULL_W - (bar.thumb ? BAR_W + 4 : 0)
    const { dim, bright } = listLayers(rows, cursor, this.listTop, width)
    const machines = this.fleet.state.machines.map(m => ({ label: m.label, connected: m.link === 'live' }))
    const left = this.page === 'chats' ? chatsHeader(this.otherList, this.unread) : listHeader(this.pinnedList, machines).left
    const head = this.headerBoxes(left)
    return this.draw(`list:${bar.thumb ? 'bar' : 'nobar'}:${head.key}`, [
      ...head.boxes,
      // Two layers at the same position: the selected row is bright, the rest dim.
      { slot: 'body', x: 0, y: rowY(1), w: width, h: rowsH(LIST_ROWS), text: dim, brightness: 1 },
      { slot: 'selected', x: 0, y: rowY(1), w: width, h: rowsH(LIST_ROWS), text: bright, brightness: BRIGHT },
      ...(bar.thumb ? this.barBoxes(bar, rowY(1), rowsH(LIST_ROWS)) : []),
    ], [...this.pageMenu(), [MENU_JUMP_TOP, 'Jump to top'], [MENU_NEW_PAGE, 'New page by voice']])
  }

  // --- pages -------------------------------------------------------------------------------

  private get pages(): Page[] { return this.fleet.state.settings.pages }

  private threadPage(page: Page): ThreadPage | undefined {
    return this.fleet.state.settings.threadPages.find(p => p.id === page)
  }

  private pageLabel(page: Page): string {
    if (isThreadPage(page)) return this.threadPage(page)?.title ?? 'Page'
    return PAGES.find(p => p.value === page)?.label ?? page
  }

  /** The header row every page shares: the page's own summary on the left, then which page this is, then the time. */
  private headerBoxes(left: string): { key: string; boxes: Box[] } {
    const offline = this.fleet.state.machines.filter(m => m.link !== 'live')
    const warn = offline.length ? `   ${MARK.done} ${offline.length === 1 ? offline[0].label : offline.length} offline` : ''
    const right = this.pages.length > 1 ? pageDots(this.pages, this.page ?? '') : ''
    const time = this.clockBox()
    const edge = FULL_W - time.w
    // Just wide enough for the dots, so the left side keeps the rest of the row.
    const rightW = right ? textWidth(right) + SAFETY_PX + 16 : 0
    return {
      key: `${time.w}:${rightW}`,
      boxes: [
        { slot: 'head', x: 0, y: rowY(0), w: edge - rightW, h: rowsH(1), text: fitWidth(left + warn, edge - rightW - 8), brightness: BRIGHT },
        ...(right ? [{ slot: 'side' as const, x: edge - rightW, y: rowY(0), w: rightW, h: rowsH(1), text: alignRight(right, rightW), brightness: DIM }] : []),
        ...time.boxes,
      ],
    }
  }

  /** Menu entries that switch page; the current page is marked. */
  private pageMenu(): Array<[number, string]> {
    if (this.pages.length < 2) return []
    return this.pages.slice(0, 7).map((page, i) => [MENU_PAGE + i, `${page === this.page ? '● ' : ''}${this.pageLabel(page)}`])
  }

  private switchPage(page: Page) {
    if (!this.pages.includes(page)) return
    this.page = page
    this.cursorKey = 'new'
    this.listTop = 0
    this.loaded = PAGE_SIZE
    this.pageTop = 0
    this.pageCursor = 0
    this.confirmReset = null
    this.screen = 'list'
    this.clearNotice()
    this.refreshInsights()
    void this.renderList()
  }

  private pageMachines(): PageMachine[] {
    return this.fleet.state.machines.map(m => ({
      id: m.id, label: m.label, online: m.link === 'live',
      insights: this.fleet.machine(m.id)?.insights ?? { limits: null, usage: null, host: null, scheduled: null },
    }))
  }

  /** Keeps the dashboard and usage numbers fresh while one of those pages is showing. */
  private refreshInsights() {
    if (this.screen !== 'list' || (this.page !== 'dashboard' && this.page !== 'usage')) return
    for (const m of this.fleet.state.machines) this.fleet.machine(m.id)?.refreshInsights()
  }

  /** A page of lines (dashboard, usage, a thread page): dim and normal lines, an optional bright choice, a status row. */
  private drawPage(kind: string, left: string, lines: PageLine[], selected: string | null, status: { text: string; brightness: number }, menu: Array<[number, string]>) {
    const cursorLine = selected ? lines.findIndex(l => l.select === selected) : -1
    this.pageTop = pageWindow(lines, this.pageTop, PAGE_ROWS, cursorLine)
    const shown = lines.slice(this.pageTop, this.pageTop + PAGE_ROWS)
    const bar = scrollbar(lines.length, this.pageTop, PAGE_ROWS)
    const width = FULL_W - (bar.thumb ? BAR_W + 4 : 0)
    const chosen = (l: PageLine) => selected !== null && l.select === selected
    const layer = (keep: (l: PageLine) => boolean) => shown.map(l => (keep(l) ? clipWidth(l.text, width - 6) : '')).join('\n')
    const head = this.headerBoxes(left)
    return this.draw(`page:${kind}:${bar.thumb ? 'bar' : 'nobar'}:${head.key}`, [
      ...head.boxes,
      { slot: 'body', x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(l => !chosen(l) && !l.dim), brightness: MID },
      { slot: 'prompt', x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(l => !chosen(l) && Boolean(l.dim)), brightness: 1 },
      { slot: 'selected', x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(chosen), brightness: BRIGHT },
      ...(bar.thumb ? this.barBoxes(bar, rowY(1), rowsH(PAGE_ROWS)) : []),
      { slot: 'status', x: 0, y: rowY(1 + PAGE_ROWS), w: FULL_W, h: rowsH(1), text: fitWidth(status.text, FULL_W - 4), brightness: status.brightness },
    ], menu)
  }

  private pageNotice(fallback: string) {
    return this.notice ? { text: this.notice, brightness: BRIGHT } : { text: fallback, brightness: DIM }
  }

  private renderDashboard() {
    this.closePageStream()
    const all = [...this.pinnedList, ...this.otherList]
    // Follow running threads so the dashboard can say what each is doing.
    for (const m of this.fleet.state.machines) {
      this.fleet.machine(m.id)?.watch(all.filter(t => t.machineId === m.id && isBusy(t.status)).slice(0, 3), { activity: true, reply: false })
    }
    const [summary, ...lines] = dashboardLines({
      threads: all, unread: this.unread, now: Date.now(), machines: this.pageMachines(),
      step: t => this.machineOf(t)?.glance(t.id)?.step ?? null,
    })
    const asking = all.find(t => t.needsInput || t.status === 'waiting')
    const status = this.pageNotice(asking ? `tap: open ${asking.title}` : 'tap+hold: pages')
    // The summary ("★ 2 need you ▶ 1 running") is the header; the page needs no title.
    return this.drawPage('dashboard', summary.text, lines, null, status, [...this.pageMenu(), [MENU_REFRESH, 'Refresh']])
  }

  private usageChoices(lines: PageLine[]): string[] {
    return [...new Set(lines.flatMap(l => (l.select ? [l.select] : [])))]
  }

  private renderUsage() {
    this.closePageStream()
    const machines = this.pageMachines()
    const lines = usageLines(machines, Date.now())
    const choices = this.usageChoices(lines)
    this.pageCursor = Math.max(0, Math.min(this.pageCursor, choices.length - 1))
    const selected = choices[this.pageCursor] ?? null
    const limit = selected ? this.limitFor(selected) : null
    const status = this.confirmReset && limit
      ? { text: `tap again to spend a reset credit on ${limit.provider.name} (${limit.provider.credits} left) · swipe: cancel`, brightness: BRIGHT }
      : this.pageNotice(limit?.provider.credits ? 'tap: use a reset credit on this limit' : 'swipe: limits · tap+hold: pages')
    return this.drawPage('usage', 'Usage', lines, selected, status, [...this.pageMenu(), [MENU_REFRESH, 'Refresh']])
  }

  private limitFor(key: string) {
    const [machineId, instanceId] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)]
    const machine = this.fleet.machine(machineId)
    const limits = machine?.insights.limits
    const provider = limits && !isMissing(limits) ? limits.find(p => p.instanceId === instanceId) : undefined
    return machine && provider ? { machine, provider } : null
  }

  /** First tap asks, second tap spends the credit. */
  private async tapUsage() {
    const choices = this.usageChoices(usageLines(this.pageMachines(), Date.now()))
    const key = choices[this.pageCursor]
    const limit = key ? this.limitFor(key) : null
    if (!key || !limit) return
    const { machine, provider } = limit
    if (!provider.credits) return this.showNotice(`No reset credits for ${provider.name}.`, 3000)
    if (!machine.canReset) return this.showNotice('Resetting needs providers:manage. Pair again with that scope.', 6000)
    if (this.confirmReset !== key) { this.confirmReset = key; return this.renderUsage() }
    this.confirmReset = null
    await this.showNotice(`resetting ${provider.name}…`, 20_000)
    try {
      const result = await machine.resetLimit(provider.instanceId)
      await this.showNotice(result.warning ?? RESET_TEXT[result.outcome], 5000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
  }

  // --- thread pages ----------------------------------------------------------------------------

  private closePageStream() {
    this.pageStream?.handle.close()
    this.pageStream = null
  }

  private renderThreadPage(page: ThreadPage['id']) {
    const meta = this.threadPage(page)
    const machine = meta && this.fleet.machine(meta.machineId)
    if (!meta || !machine) return this.drawPage('tpage', this.pageLabel(page), [{ text: 'This page\'s machine is not paired.', dim: true }], null, this.pageNotice(''), this.pageMenu())
    if (this.pageStream?.id !== page) {
      this.closePageStream()
      this.pageLive = emptyLive()
      this.pageStream = { id: page, handle: machine.openThread(meta.threadId, live => { this.pageLive = live; this.scheduleRender() }) }
    }
    const thread = machine.thread(meta.threadId)
    const reply = this.pageLive.messages.findLast(m => m.role === 'assistant' && m.text.trim())
    const body = reply ? plainText(reply.text).split('\n').flatMap(line => (line.trim() ? wrapWidth(line, TEXT_W - 8) : [''])) : []
    const lines: PageLine[] = !this.pageLive.sequence && !reply ? [{ text: 'Loading…', dim: true }]
      : body.length ? body.map(text => ({ text })) : [{ text: 'Nothing here yet. Hold to say what this page should show.', dim: true }]
    const busy = thread ? isBusy(thread.status) : false
    const step = currentStep(this.pageLive)
    const updated = reply ? `updated ${age(reply.createdAt, Date.now())} ago` : ''
    const status = this.recorder.busy || this.sending || this.hold ? this.statusRow(busy)
      : busy ? { text: `${spinner(this.tick)} updating${step ? ` · ${step.label}` : '…'}`, brightness: MID }
      : this.pageNotice([updated, 'hold: change this page'].filter(Boolean).join('   ·   '))
    const title = meta.title || thread?.title || 'Page'
    return this.drawPage(`tpage:${page}`, title, lines, null, status, [...this.pageMenu(), ...this.voiceMenu(), [MENU_NEW_PAGE, 'New page by voice']])
  }

  /** Back to `+ New thread` at the top of the list. */
  private jumpToTop() {
    this.cursorKey = 'new'
    this.listTop = 0
    void this.renderList()
  }

  private moveCursor(delta: number) {
    const rows = this.rows()
    let next = Math.max(0, Math.min(rows.length - 1, this.cursor(rows) + delta))
    if (rows[next].key === SEP_KEY) next += delta // the divider is a label, not a choice
    next = Math.max(0, Math.min(rows.length - 1, next))
    this.cursorKey = rows[next].key
    // Reached the last loaded thread: load the next page, so there is always more below.
    const sepAbove = rows.some((r, i) => r.key === SEP_KEY && i < next)
    this.loaded = loadedFor(this.loaded, next - (sepAbove ? 1 : 0), this.threads.length)
    void this.renderList()
  }

  private openCursor() {
    const rows = this.rows()
    const row = rows[this.cursor(rows)]
    if (row.key === 'new') return void this.openCompose()
    const thread = this.threads.find(t => keyOf(t) === row.key)
    if (thread) void this.open(thread)
  }

  // --- opened from the phone ---------------------------------------------------------------

  /**
   * The user tapped a thread on the phone page. Show it on the glasses from wherever they are, unless
   * they are mid-recording or sending, which a tap on the phone must not throw away.
   */
  private async openFromPhone(machineId: string, threadId: string): Promise<boolean> {
    if (this.recorder.busy || this.sending) return false
    const thread = this.fleet.machine(machineId)?.thread(threadId)
    if (!thread) return false
    this.answer = null
    await this.open(thread)
    return true
  }

  // --- thread ------------------------------------------------------------------------------

  private closeThreadStream() {
    this.openThread?.close()
    this.openThread = null
    clearTimeout(this.renderTimer)
    this.renderTimer = undefined
  }

  private async open(thread: PinnedThread) {
    this.closeThreadStream()
    this.closePageStream()
    const machine = this.machineOf(thread)
    if (!machine) return
    this.current = thread
    this.screen = 'thread'
    this.live = emptyLive()
    this.scroll = initialScroll()
    this.notice = ''
    this.markSeen(thread)
    this.openThread = machine.openThread(thread.id, live => {
      this.live = live
      if (this.screen === 'answer' && this.answer && !this.sending && !live.requests.some(r => r.requestId === this.answer!.request.requestId)) {
        void this.closeAnswer('Answered somewhere else.')
        return
      }
      if (this.current) this.markSeen(this.machineOf(this.current)?.thread(this.current.id) ?? this.current)
      this.scheduleRender()
    })
    await this.renderThread()
  }

  private async closeThread() {
    this.closeThreadStream()
    this.clearNotice()
    this.current = null
    this.screen = 'list'
    await this.renderList()
  }

  /** The status row: recording beats notices beats live activity beats the scroll hint. */
  private statusRow(busy: boolean): { text: string; brightness: number } {
    if (this.recorder.paused) {
      return { text: `□ paused ${clock(this.recorder.elapsedMs)}   hold: continue · tap: send · swipe: discard`, brightness: BRIGHT }
    }
    if (this.recorder.recording) {
      return { text: `● REC ${clock(this.recorder.elapsedMs)}   ${this.levels.join('')}   ${this.latched ? 'tap: send · double tap: pause' : 'release to send'}`, brightness: BRIGHT }
    }
    if (this.recorder.busy) return { text: '● opening mic…', brightness: BRIGHT }
    if (this.hold) return { text: `● sending in ${this.hold.left} · swipe: send now · tap+hold: cancel`, brightness: BRIGHT }
    if (this.sending) return { text: `${spinner(this.tick)} sending voice message…`, brightness: BRIGHT }
    if (this.notice) return { text: this.notice, brightness: BRIGHT }
    const unseen = !this.scroll.following ? `▼ ${this.scroll.unseen ? `${this.scroll.unseen} new · ` : ''}tap for latest   ` : ''
    const request = this.live.requests[0]
    if (request && this.scroll.following) {
      const what = request.kind === 'question'
        ? `${request.questions.length > 1 ? `${request.questions.length} questions` : 'a question'} for you`
        : request.what.replace(/\?$/, '')
      return { text: `★ ${what} · tap to answer`, brightness: BRIGHT }
    }
    if (busy && this.current) {
      const step = currentStep(this.live)
      const what = this.current.needsInput ? '★ waiting for you in T3' : `${spinner(this.tick)} ${step ? step.label : 'working…'}`
      return { text: fitWidth(unseen + what, FULL_W), brightness: BRIGHT }
    }
    if (unseen) return { text: unseen.trim(), brightness: MID }
    return { text: 'hold to talk   ·   tap+hold: hands-free', brightness: DIM }
  }

  /** Chat lines, naming the sending thread for agent-to-agent messages. */
  private chat() {
    const machine = this.current && this.machineOf(this.current)
    return chatLines(this.live.messages, undefined, undefined, id => machine?.shell.threads.get(id)?.title, this.fleet.state.settings.density !== 'compact')
  }

  /** The time of day at the right end of the header row, or nothing (and no reserved width) when hidden. */
  private clockBox(): { w: number; boxes: Box[] } {
    const text = formatClock(new Date(), this.fleet.state.settings.clock)
    if (!text) return { w: 0, boxes: [] }
    return { w: CLOCK_W, boxes: [{ slot: 'clock', x: FULL_W - CLOCK_W, y: rowY(0), w: CLOCK_W, h: rowsH(1), text: alignRight(text, CLOCK_W), brightness: DIM }] }
  }

  private renderThread() {
    if (!this.current) return
    const thread = this.current
    const busy = isBusy(thread.status)
    const rows = THREAD_BODY_ROWS
    const lines = this.chat()
    this.scroll = contentChanged(this.scroll, lines.length, rows)
    const view = visible(lines, this.scroll, rows)
    const loading = !this.live.sequence && !this.live.messages.length
    const mark = markFor(thread.status, thread.needsInput, false)
    const runMs = thread.runStartedAt ? Date.now() - Date.parse(thread.runStartedAt) : null
    const badge = alignRight(titleBadge(mark, runMs), TITLE_SIDE_W - 6)
    const time = this.clockBox()
    const edge = FULL_W - time.w
    const multi = this.fleet.state.machines.length > 1
    const title = [thread.title, multi ? thread.machineLabel : ''].filter(Boolean).join(' · ')
    const status = this.statusRow(busy)
    const bar = chatBar(lines.length, rows, this.scroll.fromBottom)
    return this.draw(`thread:${keyOf(thread)}:${time.w}`, [
      { slot: 'head', x: 0, y: rowY(0), w: edge - TITLE_SIDE_W, h: rowsH(1), text: fitWidth(title, edge - TITLE_SIDE_W - 8), brightness: BRIGHT },
      { slot: 'side', x: edge - TITLE_SIDE_W, y: rowY(0), w: TITLE_SIDE_W, h: rowsH(1), text: badge, brightness: mark === 'run' || mark === 'ask' ? BRIGHT : DIM },
      ...time.boxes,
      // Chat sits between the title and the live line, so the newest activity is at the bottom, under the newest message.
      { slot: 'body', x: 0, y: rowY(1), w: TEXT_W, h: rowsH(rows), text: loading ? 'Loading…' : bottomAnchor(view.lines, rows) || 'No messages yet.', brightness: MID },
      ...this.barBoxes(bar, rowY(1), rowsH(rows)),
      { slot: 'status', x: 0, y: rowY(1 + rows), w: FULL_W, h: rowsH(1), text: fitWidth(status.text, FULL_W - 4), brightness: status.brightness },
    ], this.voiceMenu())
  }

  // --- answering ---------------------------------------------------------------------------

  private openAnswer(request: PendingRequest) {
    this.answer = { request, q: 0, cursor: 0, top: 0, chosen: {}, voiced: {} }
    this.screen = 'answer'
    this.clearNotice()
    return this.renderAnswer()
  }

  private closeAnswer(notice?: string) {
    this.answer = null
    this.screen = 'thread'
    if (notice) void this.showNotice(notice)
    return this.renderThread()
  }

  private answerView(): AnswerView | null {
    const a = this.answer
    if (!a) return null
    if (a.request.kind === 'approval') return approvalView(a.request.what, a.request.detail, a.request.options)
    const q = a.request.questions[a.q]
    return questionView(q, a.q, a.request.questions.length, a.chosen[q.id] ?? [], Boolean(a.voiced[q.id]))
  }

  private answerHint(): { text: string; brightness: number } {
    if (this.recorder.busy || this.sending || this.hold || this.notice) return this.statusRow(false)
    const a = this.answer
    if (!a || a.request.kind === 'approval') return { text: 'tap: choose   ·   double tap: back', brightness: DIM }
    const q = a.request.questions[a.q]
    return { text: `${q.multiSelect ? 'tap: tick · Done to continue' : 'tap: choose'}   ·   hold: say it   ·   2x: back`, brightness: DIM }
  }

  private renderAnswer() {
    const view = this.answerView()
    if (!view || !this.answer) return
    const promptRows = view.prompt.length
    const first = 1 + promptRows + (promptRows ? 1 : 0)
    const visibleRows = ROWS_TOTAL - 1 - first
    const a = this.answer
    a.cursor = Math.max(0, Math.min(view.rows.length - 1, a.cursor))
    a.top = listStart(view.rows.length, a.cursor, a.top, visibleRows)
    const { dim, bright } = choiceLayers(view.rows, a.cursor, a.top, visibleRows)
    const side = alignRight(view.side, TITLE_SIDE_W + 60 - 6)
    const hint = this.answerHint()
    return this.draw(`answer:${a.request.requestId}:${a.q}:${promptRows}`, [
      { slot: 'head', x: 0, y: rowY(0), w: FULL_W - TITLE_SIDE_W - 60, h: rowsH(1), text: fitWidth(view.head, FULL_W - TITLE_SIDE_W - 68), brightness: BRIGHT },
      { slot: 'side', x: FULL_W - TITLE_SIDE_W - 60, y: rowY(0), w: TITLE_SIDE_W + 60, h: rowsH(1), text: side, brightness: DIM },
      ...(promptRows ? [{ slot: 'prompt' as const, x: 0, y: rowY(1), w: FULL_W, h: rowsH(promptRows), text: view.prompt.join('\n'), brightness: MID }] : []),
      { slot: 'body', x: 0, y: rowY(first), w: FULL_W, h: rowsH(visibleRows), text: dim, brightness: 1 },
      { slot: 'selected', x: 0, y: rowY(first), w: FULL_W, h: rowsH(visibleRows), text: bright, brightness: BRIGHT },
      { slot: 'status', x: 0, y: rowY(ROWS_TOTAL - 1), w: FULL_W, h: rowsH(1), text: fitWidth(hint.text, FULL_W - 4), brightness: hint.brightness },
    ])
  }

  /** Records the chosen row: approvals answer immediately; questions advance, then submit. */
  private async chooseAnswer() {
    const a = this.answer
    const view = this.answerView()
    if (!a || !view) return
    const row = view.rows[a.cursor]
    if (!row) return
    if (a.request.kind === 'approval') return this.submitAnswer({ decision: row.key })
    const q = a.request.questions[a.q]
    if (q.multiSelect) {
      if (row.key === DONE_KEY) {
        if (!(a.chosen[q.id]?.length) && !a.voiced[q.id]) return this.showNotice('Pick at least one, or hold to say it.', 2500)
        return this.nextQuestion()
      }
      const current = a.chosen[q.id] ?? []
      a.chosen[q.id] = current.includes(row.key) ? current.filter(k => k !== row.key) : [...current, row.key]
      delete a.voiced[q.id]
      return this.renderAnswer()
    }
    a.chosen[q.id] = [row.key]
    delete a.voiced[q.id]
    return this.nextQuestion()
  }

  private async nextQuestion() {
    const a = this.answer
    if (!a || a.request.kind !== 'question') return
    if (a.q < a.request.questions.length - 1) {
      a.q++
      a.cursor = 0
      a.top = 0
      return this.renderAnswer()
    }
    const answers: Record<string, string | string[]> = {}
    for (const q of a.request.questions) {
      answers[q.id] = a.voiced[q.id] ? VOICE_ANSWER : q.multiSelect ? (a.chosen[q.id] ?? []) : (a.chosen[q.id]?.[0] ?? '')
    }
    return this.submitAnswer({ answers, voiceByQuestionId: a.voiced })
  }

  private async submitAnswer(response: Parameters<Machine['respond']>[2]) {
    const a = this.answer
    const thread = this.current
    const machine = thread && this.machineOf(thread)
    if (!a || !thread || !machine) return
    this.sending = true
    await this.renderAnswer()
    try {
      await machine.respond(thread.id, a.request.requestId, response)
      this.sending = false
      this.live = { ...this.live, requests: this.live.requests.filter(r => r.requestId !== a.request.requestId) }
      this.scroll = jumpToBottom(this.scroll)
      await this.closeAnswer('● answer sent')
    } catch (error) {
      this.sending = false
      await this.showNotice(error, 8000)
    }
  }

  // --- compose -----------------------------------------------------------------------------

  private async openCompose(kind: 'thread' | 'page' = 'thread') {
    this.composeKind = kind
    this.closeThreadStream()
    this.closePageStream()
    this.screen = 'compose'
    this.clearNotice()
    this.composeModel = ''
    await this.renderCompose()
    const machine = this.fleet.defaultMachine
    if (machine && !this.fleet.state.settings.model) {
      const config = await machine.config().catch(() => null)
      this.composeModel = config?.defaultModel?.model ?? ''
      if (this.screen === 'compose') await this.renderCompose()
    }
  }

  private renderCompose() {
    const machine = this.fleet.defaultMachine
    const settings = this.fleet.state.settings
    const project = settings.projectId === SCRATCH ? 'No project' : machine?.projects().find(p => p.id === settings.projectId)?.title ?? 'Project'
    const model = settings.model || this.composeModel || 'default model'
    const status = this.statusRow(false)
    const body = [
      `${machine?.record.label ?? '?'}  ·  ${project}`,
      model,
      '',
      ...(this.composeKind === 'page'
        ? ['Say what this page should show, and how often', 'it should update. A thread builds it and keeps it fresh.']
        : ['Hold the touchpad and say what you want.', 'Release to start the thread.']),
    ].map(line => fitWidth(line, FULL_W - 8)).join('\n')
    return this.draw('compose', [
      { slot: 'head', x: 0, y: rowY(0), w: FULL_W, h: rowsH(1), text: this.composeKind === 'page' ? '+ New page' : '+ New thread', brightness: BRIGHT },
      { slot: 'status', x: 0, y: rowY(1), w: FULL_W, h: rowsH(1), text: this.recorder.busy || this.sending || this.hold || this.notice ? status.text : 'double tap to go back', brightness: this.recorder.busy || this.sending || this.hold || this.notice ? status.brightness : DIM },
      { slot: 'body', x: 0, y: rowY(3), w: FULL_W, h: rowsH(7), text: body, brightness: MID },
    ], this.voiceMenu())
  }

  // --- notices -----------------------------------------------------------------------------

  private clearNotice() {
    clearTimeout(this.noticeTimer)
    this.notice = ''
  }

  private async showNotice(message: unknown, ms = NOTICE_MS) {
    this.notice = message instanceof Error ? message.message : String(message)
    clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => { this.notice = ''; void this.refresh() }, ms)
    await this.refresh()
  }

  // --- voice -------------------------------------------------------------------------------

  /** The glasses menu (tap, then long press) on screens that can record. */
  private voiceMenu(): Array<[number, string]> {
    if (this.hold) return [[MENU_CANCEL_SEND, 'Cancel voice send']]
    if (this.latched && this.recorder.busy) return [[MENU_SEND_NOW, 'Send recording'], [MENU_DISCARD, 'Discard recording']]
    return [[MENU_RECORD, 'Record hands-free']]
  }

  private async startHandsFree() {
    if (this.hold || this.recorder.busy) return
    this.latched = true
    await this.startRecording()
    if (!this.recorder.busy) this.latched = false // the mic did not open, or the screen cannot record
  }

  private async startRecording() {
    if (this.hold) return
    if (this.screen === 'answer' && this.answer?.request.kind !== 'question') return
    const onPage = this.screen === 'list' && this.page !== null && isThreadPage(this.page)
    if ((this.screen !== 'thread' && this.screen !== 'compose' && this.screen !== 'answer' && !onPage) || this.sending) return
    if (this.recorder.busy && !this.recorder.paused) return
    const resuming = this.recorder.paused
    // Open the request socket now so sending on release doesn't wait for a handshake.
    const pageMeta = onPage ? this.threadPage(this.page!) : undefined
    const target = this.screen === 'compose' ? this.fleet.defaultMachine
      : pageMeta ? this.fleet.machine(pageMeta.machineId) : this.current && this.machineOf(this.current)
    target?.warm()
    this.clearNotice()
    if (!resuming) this.levels = Array.from({ length: LEVEL_SLOTS }, () => levelGlyph(0))
    const pending = this.refresh()
    const ok = await this.recorder.start(this.sdk.AudioInputSource.Glasses as AudioSource)
    await pending
    if (!ok) return this.showNotice('Mic unavailable. Check the Even app permissions.')
    if (this.recorder.releasedWhileOpening) return this.stopAndSend()
    await this.refresh()
  }

  private async stopAndSend() {
    this.latched = false
    const recording = await this.recorder.release()
    if (!recording) return this.refresh()
    // Nothing is uploaded unless it is audible speech.
    const problem = audioProblem(recording.pcm)
    if (problem) return this.showNotice(AUDIO_PROBLEM_TEXT[problem])
    const ms = durationMs(recording.pcm)

    const wav = pcm16ToWav(recording.pcm)
    // A spoken answer to the current question.
    if (this.screen === 'answer' && this.answer?.request.kind === 'question') {
      const q = this.answer.request.questions[this.answer.q]
      this.answer.voiced[q.id] = wav
      delete this.answer.chosen[q.id]
      return this.nextQuestion()
    }
    // A grace period to change your mind (set on the phone; 0 sends at once). A swipe sends now; the
    // glasses menu (tap, then long press) cancels.
    const delay = this.fleet.state.settings.sendDelay
    if (delay > 0) {
      const hold = startSendHold(() => void this.refresh(), delay)
      this.hold = hold
      void this.refresh() // the first tick fired before `this.hold` was set
      const result = await hold.done
      this.hold = null
      if (result === 'cancelled') return this.showNotice('Cancelled. Nothing was sent.', 3000)
    }

    this.sending = true
    await this.refresh()
    try {
      const page = this.screen === 'list' && this.page && isThreadPage(this.page) ? this.threadPage(this.page) : undefined
      if (this.screen === 'compose') await this.sendNewThread(wav)
      else if (page) await this.sendToPage(page, wav)
      else await this.sendReply(wav)
      this.sending = false
      if (this.screen === 'thread') await this.showNotice(`● sent ${(ms / 1000).toFixed(1)}s of audio, waiting for reply`)
    } catch (error) {
      this.sending = false
      await this.showNotice(error, 8000)
    }
  }

  private async sendReply(wav: Uint8Array) {
    const thread = this.current
    const machine = thread && this.machineOf(thread)
    if (!thread || !machine) throw new Error('This thread is no longer available.')
    await machine.sendVoice(thread, wav, voiceText(this.fleet.state.settings))
    this.scroll = jumpToBottom(this.scroll)
  }

  /** A voice message to the thread behind a page: what to change on it. */
  private async sendToPage(page: ThreadPage, wav: Uint8Array) {
    const machine = this.fleet.machine(page.machineId)
    const thread = machine?.thread(page.threadId)
    if (!machine || !thread) throw new Error('This page\'s thread is no longer available.')
    await machine.sendVoice(thread, wav, `${voiceText(this.fleet.state.settings)}\n\nThis is about the page you keep for my glasses: reply with the whole updated page.`)
    await this.showNotice('● sent, the page will update', 3000)
  }

  private async sendNewThread(wav: Uint8Array) {
    const machine = this.fleet.defaultMachine
    if (!machine) throw new Error('No T3 machine paired.')
    const settings = this.fleet.state.settings
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const forPage = this.composeKind === 'page'
    const title = forPage ? `Glasses page ${stamp}` : `Glasses ${stamp}`
    const threadId = await machine.launch({
      settings, title, text: forPage ? `${PAGE_PROMPT}\n\n${voiceText(settings)}` : voiceText(settings),
      attachment: { name: `voice-${Date.now()}.wav`, mimeType: 'audio/wav', bytes: wav },
    })
    if (forPage) {
      const id = threadPageId(machine.id, threadId)
      const page: ThreadPage = { id, machineId: machine.id, threadId, title: 'New page' }
      await this.fleet.updateSettings({
        threadPages: [...settings.threadPages, page],
        pages: [...settings.pages, id],
      })
      this.composeKind = 'thread'
      this.screen = 'list'
      return this.switchPage(id)
    }
    const project = settings.projectId === SCRATCH ? '' : machine.projects().find(p => p.id === settings.projectId)?.title ?? ''
    // The new thread may not be in the feed yet; open it from what we know and let the stream fill in.
    await this.open(machine.thread(threadId) ?? {
      machineId: machine.id, machineLabel: machine.record.label, id: threadId, title, project,
      status: 'starting', needsInput: false, updatedAt: new Date().toISOString(), runStartedAt: new Date().toISOString(),
    })
  }

  /** Keeps what was said; the user can continue, send, or discard. */
  private async pauseRecording() {
    if (await this.recorder.pause()) await this.refresh()
  }

  private async cancelRecording(reason?: string) {
    this.latched = false
    await this.recorder.cancel()
    if (reason) await this.showNotice(reason, 2500)
    else await this.refresh()
  }

  // --- input -------------------------------------------------------------------------------

  private onEvent(event: EvenHubEvent) {
    const { OsEventTypeList: T } = this.sdk
    if (event.audioEvent) {
      const chunk = new Uint8Array(event.audioEvent.audioPcm)
      this.recorder.push(chunk)
      if (this.recorder.recording) {
        this.levels = [...this.levels.slice(1 - LEVEL_SLOTS), levelGlyph(peak(chunk))]
        this.scheduleRender()
      }
      return
    }
    // A single tap is eventType 0, which protobuf omits, so default it only inside a present envelope.
    const typeOf = (envelope?: { eventType?: EventType }) => (envelope ? envelope.eventType ?? T.CLICK_EVENT : null)
    const sys = typeOf(event.sysEvent)
    const text = typeOf(event.textEvent)
    const list = typeOf(event.listEvent)
    const any = (type: EventType) => sys === type || text === type || list === type

    if (any(T.SYSTEM_EXIT_EVENT) || any(T.ABNORMAL_EXIT_EVENT)) {
      this.hold?.cancel()
      void this.cancelRecording()
      return
    }
    // The glasses' own menu (tap, then long press).
    if (event.menuItemClickEvent) {
      const item = event.menuItemClickEvent.itemID ?? -1
      if (item === MENU_CANCEL_SEND) {
        if (this.hold) this.hold.cancel()
        else void this.showNotice('Nothing to cancel.', 2000)
      } else if (item >= MENU_PAGE && item < MENU_PAGE + this.pages.length) {
        this.switchPage(this.pages[item - MENU_PAGE])
      } else if (item === MENU_REFRESH) {
        for (const m of this.fleet.state.machines) this.fleet.machine(m.id)?.refreshInsights(true)
      } else if (item === MENU_NEW_PAGE) {
        void this.openCompose('page')
      } else if (item === MENU_JUMP_TOP && this.screen === 'list') {
        this.jumpToTop()
      } else if (item === MENU_RECORD) {
        void this.startHandsFree()
      } else if (item === MENU_SEND_NOW) {
        void this.stopAndSend()
      } else if (item === MENU_DISCARD) {
        void this.cancelRecording('Recording discarded.')
      }
      return
    }
    // While a send is counting down, a swipe sends now. Everything else waits; cancelling is in the menu,
    // so a double tap meant for a notification cannot cancel it by accident.
    if (this.hold) {
      if (text === T.SCROLL_TOP_EVENT || text === T.SCROLL_BOTTOM_EVENT) this.hold.sendNow()
      else if (any(T.FOREGROUND_EXIT_EVENT)) this.hold.pause() // the menu or a notification is up
      else if (any(T.FOREGROUND_ENTER_EVENT)) this.hold.resume()
      return
    }
    // Something else took the screen (a notification, the Even menu): pause, don't lose the recording.
    if (any(T.FOREGROUND_EXIT_EVENT)) {
      void this.pauseRecording()
      return
    }
    if (any(T.FOREGROUND_ENTER_EVENT)) { void this.fleet.machine(this.current?.machineId ?? this.fleet.defaultMachine?.id)?.poll(); return }

    if (any(T.DOUBLE_CLICK_EVENT)) {
      // Double taps while talking are usually dismissing notifications. Pause on the first; while
      // paused, ignore them so the recording survives a stack of notifications.
      if (this.recorder.recording || (this.recorder.busy && !this.recorder.paused)) void this.pauseRecording()
      else if (this.recorder.paused) return
      else if (this.screen === 'answer') void this.closeAnswer()
      else if (this.screen === 'thread') void this.closeThread()
      else if (this.screen === 'compose') { this.screen = 'list'; void this.renderList() }
      else if (this.confirmReset) { this.confirmReset = null; void this.renderList() }
      else if (this.page !== this.fleet.state.settings.startPage) this.switchPage(this.fleet.state.settings.startPage)
      else void this.bridge.shutDownPageContainer(1)
      return
    }
    if (sys === T.LONG_PRESS_EVENT) {
      if (this.latched && !this.recorder.paused) return // hands-free: the touchpad is not held
      this.latched = false // holding to continue a paused hands-free recording goes back to push-to-talk
      if (this.screen === 'list' && this.page && isThreadPage(this.page)) void this.startRecording()
      else if (this.screen === 'list') { if (this.page === 'pinned' || this.page === 'chats') this.jumpToTop() }
      else void this.startRecording()
      return
    }
    if (sys === T.LONG_PRESS_RELEASE_EVENT) {
      if (this.latched) return
      if (this.recorder.recording || (this.recorder.busy && !this.recorder.paused)) void this.stopAndSend()
      return
    }

    if (this.recorder.paused) {
      if (any(T.CLICK_EVENT)) void this.stopAndSend()
      else if (text === T.SCROLL_TOP_EVENT || text === T.SCROLL_BOTTOM_EVENT) void this.cancelRecording('Recording discarded.')
      return
    }

    // A hands-free recording: tap sends. Swipes are ignored so a stray one cannot lose it.
    if (this.latched && this.recorder.busy) {
      if (any(T.CLICK_EVENT)) void this.stopAndSend()
      return
    }

    if (any(T.CLICK_EVENT)) {
      if (this.screen === 'status' && this.fleet.state.phase === 'unpaired') { void this.fleet.startDemo(); return }
      if (this.screen === 'list' && this.page === 'usage') void this.tapUsage()
      else if (this.screen === 'list' && this.page === 'dashboard') {
        const asking = [...this.pinnedList, ...this.otherList].find(t => t.needsInput || t.status === 'waiting')
        if (asking) void this.open(asking)
      } else if (this.screen === 'list' && this.page && isThreadPage(this.page)) { this.pageTop = 0; void this.renderList() }
      else if (this.screen === 'list') this.openCursor()
      else if (this.screen === 'answer') { if (!this.sending) void this.chooseAnswer() }
      // Tap in a thread: answer what the agent is asking, or jump back to the newest message.
      else if (this.screen === 'thread') {
        if (this.scroll.following && this.live.requests[0]) void this.openAnswer(this.live.requests[0])
        else { this.scroll = jumpToBottom(this.scroll); void this.renderThread() }
      }
      return
    }

    if (text === T.SCROLL_TOP_EVENT || text === T.SCROLL_BOTTOM_EVENT) {
      const up = text === T.SCROLL_TOP_EVENT
      if (this.screen === 'list' && this.page === 'usage') {
        this.confirmReset = null
        this.pageCursor = Math.max(0, this.pageCursor + (up ? -1 : 1))
        void this.renderList()
      } else if (this.screen === 'list' && (this.page === 'dashboard' || (this.page && isThreadPage(this.page)))) {
        this.pageTop = Math.max(0, this.pageTop + (up ? -1 : 1))
        void this.renderList()
      } else if (this.screen === 'list') this.moveCursor(up ? -1 : 1)
      else if (this.screen === 'answer' && this.answer) { this.answer.cursor += up ? -1 : 1; void this.renderAnswer() }
      else if (this.screen === 'thread') {
        const total = this.chat().length
        this.scroll = up ? scrollOlder(this.scroll, total, THREAD_BODY_ROWS) : scrollNewer(this.scroll, total, THREAD_BODY_ROWS)
        // Scrolling should feel immediate, not wait for the batched redraw.
        void this.renderThread()
      }
    }
  }
}
