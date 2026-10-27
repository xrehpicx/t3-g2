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
import { isThreadPage, pagePrompt, PAGES, threadPageId, voiceText, type Page, type PageUpdates, type ThreadPage } from '../settings'
import { isMissing, RESET_TEXT, type Insights } from '../t3/insights'
import { families, limitWarnings, type LimitAccount } from '../t3/limits'
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
import { freshWarnings, overBudget, snapshotOf, summarize, threadAlerts, type Alert, type SnapMap } from './alerts'
import { accountKey, approvalDecisions, askKey, dashboardLines, money, pageDots, pageWindow, taskKey, taskLines, todaySpend, usageAccounts, usageLines, type PageLine, type PageMachine } from './pages'
import { extractSvg, hashText, renderSvgPng, type RenderedImage } from './svgImage'
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
const MENU_BACK = 8
const MENU_TASK_RUN = 9
const MENU_TASK_PAUSE = 10
const MENU_PAGE_REFRESH = 11
/** Menu ids for quick replies: MENU_QUICK + the reply's index. */
const MENU_QUICK = 40
/** How long an alert stays in the header. */
const ALERT_MS = 8_000
/** Menu ids for switching page: MENU_PAGE + the page's index in PAGES. */
const MENU_PAGE = 20
const ROWS_TOTAL = 10
/** Body rows on the dashboard and usage pages, between the header and the status row. */
const PAGE_ROWS = ROWS_TOTAL - 2

/** Container ids/names are shared across screens; each screen uses a subset. */
const C = {
  head: [1, 'head'], side: [2, 'side'], status: [3, 'status'], body: [4, 'body'], bar: [5, 'bar'], selected: [6, 'selected'], input: [7, 'input'], prompt: [8, 'prompt'], thumb: [9, 'thumb'], clock: [10, 'clock'],
} as const

/** The glasses allow 8 text containers per page (one is the invisible input layer). */
const MAX_TEXT_BOXES = 7
/** Dropped first, if a page would have too many: the scrollbar, then the clock, then the dim layer. */
const SHED_ORDER: Slot[] = ['thumb', 'bar', 'clock', 'prompt']
const IMAGE_ID = 11

const encoder = new TextEncoder()
/** A menu label within the firmware's 32 UTF-8 bytes, cut on a character boundary. */
export function menuLabel(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim() || '·'
  if (encoder.encode(clean).length <= 32) return clean
  let out = ''
  for (const char of clean) {
    if (encoder.encode(`${out}${char}…`).length > 32) break
    out += char
  }
  return `${out.trimEnd()}…`
}
/** How long a first tap stays armed, waiting for the second. */
const ARM_MS = 6_000
const MENU_ALLOW = 12
const MENU_DENY = 13
const MENU_OPEN_ALERT = 14
const IMAGE_NAME = 'image'

/** A picture on a page: a PNG for the glasses' image container. */
interface ImageSlot { key: string; x: number; y: number; w: number; h: number; png: Uint8Array }
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
  private latest: { layout: string; boxes: Box[]; menu?: Array<[number, string]>; image?: ImageSlot } | null = null
  private cursorKey = 'new'
  /** The top-level page the list screen shows. */
  private page: Page | null = null
  private pageTop = 0
  /** Index into the usage page's choices (its limits). */
  private pageCursor = 0
  /** A limit whose reset credit is waiting for a second tap to confirm. */
  /** Something waiting for a second tap to confirm: a reset credit, an approval, a task run. */
  private armedState: { kind: 'reset' | 'allow' | 'task'; key: string; until: number } | null = null
  /** A first tap waiting for the second, until it expires (so a stray tap minutes later cannot confirm it). */
  private get armed(): { kind: 'reset' | 'allow' | 'task'; key: string } | null {
    if (this.armedState && Date.now() > this.armedState.until) this.armedState = null
    return this.armedState
  }
  private set armed(value: { kind: 'reset' | 'allow' | 'task'; key: string } | null) {
    this.armedState = value ? { ...value, until: Date.now() + ARM_MS } : null
  }
  /** The provider whose accounts the Usage page is listing; null is the overview. */
  private usageDriver: string | null = null
  private pageImage: { key: string; png: RenderedImage | null } | null = null
  /** The last look at the threads, to notice what changed. */
  private lastSnap: SnapMap | null = null
  private limitActive = new Set<string>()
  private alert: (Alert & { until: number }) | null = null
  private alertTimer: ReturnType<typeof setTimeout> | undefined
  /** The live thread behind a thread page, while that page is showing. */
  private pageStream: { id: string; handle: OpenThread } | null = null
  private pageLive: ThreadLive = emptyLive()
  /** What the compose screen starts: a thread, or a thread that becomes a page. */
  private composeKind: 'thread' | 'page' = 'thread'
  /** How a page started by voice keeps itself current. */
  private composeUpdates: PageUpdates = 'timer'
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
    this.checkAlerts(state)
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
  private draw(nextLayout: string, nextBoxes: Box[], menu?: Array<[number, string]>, image?: ImageSlot): Promise<void> {
    // Only the newest frame matters: a frame queued behind a slow BLE update is dropped rather than
    // painted late over a newer screen.
    // The firmware takes at most 10 menu items of 32 bytes each, and rejects the whole page otherwise.
    if (menu) {
      const ids = new Set<number>()
      menu = menu.filter(([id]) => (ids.has(id) ? false : (ids.add(id), true))).slice(0, 10).map(([id, name]) => [id, menuLabel(name)])
    }
    // The menu and picture are only applied when the page is rebuilt, so a change to either is a new layout.
    const signature = `${nextLayout}|${menu ? menu.map(([id, name]) => `${id}=${name}`).join(',') : ''}|${image?.key ?? ''}`
    // Past the container limit the firmware rejects the whole page and keeps showing the old one, so
    // shed the least important layers instead.
    const boxes = [...nextBoxes]
    for (const slot of SHED_ORDER) {
      if (boxes.length <= MAX_TEXT_BOXES) break
      const at = boxes.findIndex(b => b.slot === slot)
      if (at >= 0) boxes.splice(at, 1)
    }
    if (boxes.length > MAX_TEXT_BOXES) console.error('[t3-g2] too many containers on', nextLayout, boxes.length)
    this.latest = { layout: signature, boxes, menu, image }
    this.rendering = this.rendering.catch(() => {}).then(async () => {
      const frame = this.latest
      if (!frame) return
      this.latest = null
      const { layout, boxes, menu, image } = frame
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
      const imageObject = image ? [new this.sdk.ImageContainerProperty({
        xPosition: image.x, yPosition: image.y, width: image.w, height: image.h, containerID: IMAGE_ID, containerName: IMAGE_NAME,
      })] : undefined
      const page = {
        containerTotalNum: textObject.length + (imageObject?.length ?? 0), textObject,
        ...(imageObject ? { imageObject } : {}), ...(menuObject ? { menuObject } : {}),
      }
      let shown = true
      if (!this.created) {
        const result = await this.bridge.createStartUpPageContainer(new this.sdk.CreateStartUpPageContainer(page))
        // A reloaded WebView already owns a page; replace it instead.
        this.created = result === 0 || await this.bridge.rebuildPageContainer(new this.sdk.RebuildPageContainer(page))
        shown = this.created
        if (!this.created) console.error('[t3-g2] could not create the glasses page', result)
      } else if (!(await this.bridge.rebuildPageContainer(new this.sdk.RebuildPageContainer(page)))) {
        console.error('[t3-g2] page rebuild rejected', layout)
        shown = false
      }
      // The old page is still up if the glasses refused this one. Forget that this layout is showing, so
      // the next frame rebuilds instead of writing new text into the wrong page.
      if (!shown) { this.layout = ''; return }
      if (image) await this.bridge.updateImageRawData(new this.sdk.ImageRawDataUpdate({ containerID: IMAGE_ID, containerName: IMAGE_NAME, imageData: image.png })).catch(() => undefined)
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
    if (this.page === 'tasks') return this.renderTasks()
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
    ], [...this.alertMenu(), ...this.pageMenu(), [MENU_JUMP_TOP, 'Jump to top'], [MENU_NEW_PAGE, 'New page by voice']])
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

  /** The header row every page shares: an alert or the page's own summary, then the page dots and the time. */
  private headerBoxes(left: string): { key: string; boxes: Box[] } {
    const alert = this.activeAlert()
    const offline = this.fleet.state.machines.filter(m => m.link !== 'live')
    const spent = todaySpend(this.pageMachines())
    const budget = this.fleet.state.settings.dailyBudget
    const warnings = [
      overBudget(spent, budget) ? `$ ${money(spent ?? 0)} of $${budget}` : '',
      offline.length ? `${MARK.done} ${offline.length === 1 ? offline[0].label : `${offline.length} machines`} offline` : '',
    ].filter(Boolean)
    const dots = this.pages.length > 1 ? pageDots(this.pages, this.page ?? '') : ''
    const time = formatClock(new Date(), this.fleet.state.settings.clock)
    const right = [dots, time].filter(Boolean).join('   ')
    // A fixed width, so the page is not rebuilt as the minutes change the clock's text.
    const rightW = (dots ? textWidth(dots) + SAFETY_PX + 16 : 0) + (time ? CLOCK_W : 0)
    const text = alert ? alert.text : [left, ...warnings].filter(Boolean).join('   ')
    return {
      key: String(rightW),
      boxes: [
        { slot: 'head', x: 0, y: rowY(0), w: FULL_W - rightW, h: rowsH(1), text: fitWidth(text, FULL_W - rightW - 8), brightness: BRIGHT },
        ...(right ? [{ slot: 'side' as const, x: FULL_W - rightW, y: rowY(0), w: rightW, h: rowsH(1), text: alignRight(right, rightW), brightness: DIM }] : []),
      ],
    }
  }

  /** Menu entries that switch page; the current page is marked. */
  private pageMenu(): Array<[number, string]> {
    if (this.pages.length < 2) return []
    return this.pages.slice(0, 6).map((page, i) => [MENU_PAGE + i, `${page === this.page ? '● ' : ''}${this.pageLabel(page)}`])
  }

  /** Stops following the threads a list or the dashboard was showing; the next page says what it needs. */
  private unwatchAll() {
    for (const m of this.fleet.state.machines) this.fleet.machine(m.id)?.watch([], { activity: false, reply: false })
  }

  private switchPage(page: Page) {
    if (!this.pages.includes(page)) return
    this.unwatchAll()
    this.page = page
    this.cursorKey = 'new'
    this.listTop = 0
    this.loaded = PAGE_SIZE
    this.pageTop = 0
    this.pageCursor = 0
    this.armed = null
    this.usageDriver = null
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

  /**
   * Keeps the numbers behind the pages and alerts fresh. A page being looked at refreshes what it shows;
   * otherwise only what an alert or the budget needs, and only if that is switched on.
   */
  private refreshInsights() {
    if (this.fleet.state.phase !== 'ready') return
    const { alerts, dailyBudget } = this.fleet.state.settings
    const parts = new Set<keyof Insights>()
    if (this.screen === 'list') {
      if (this.page === 'dashboard') ['host', 'limits', 'usage', 'scheduled'].forEach(p => parts.add(p as keyof Insights))
      else if (this.page === 'usage') { parts.add('limits'); parts.add('usage') }
      else if (this.page === 'tasks') parts.add('scheduled')
    }
    if (alerts.limitPercent > 0) parts.add('limits')
    if (dailyBudget > 0) parts.add('usage')
    if (!parts.size) return
    for (const m of this.fleet.state.machines) this.fleet.machine(m.id)?.refreshInsights(false, [...parts])
  }

  /** A page of lines (dashboard, usage, a thread page): dim and normal lines, an optional bright choice, a status row. */
  private drawPage(kind: string, left: string, lines: PageLine[], selected: string | null, status: { text: string; brightness: number }, menu: Array<[number, string]>, image?: ImageSlot) {
    const cursorLine = selected ? lines.findIndex(l => l.select === selected) : -1
    this.pageTop = pageWindow(lines, this.pageTop, PAGE_ROWS, cursorLine)
    const shown = lines.slice(this.pageTop, this.pageTop + PAGE_ROWS)
    const bar = scrollbar(lines.length, this.pageTop, PAGE_ROWS)
    const width = image ? image.x - 8 : FULL_W - (bar.thumb ? BAR_W + 4 : 0)
    const chosen = (l: PageLine) => selected !== null && l.select === selected
    const layer = (keep: (l: PageLine) => boolean) => shown.map(l => (keep(l) ? clipWidth(l.text, width - 6) : '')).join('\n')
    const head = this.headerBoxes(left)
    // Containers are scarce (see MAX_TEXT_BOXES): the highlight layer is only there when something can be
    // chosen, and the dim layer folds into the main one when a scrollbar needs the room.
    const choosable = selected !== null
    const foldDim = bar.thumb && choosable
    const hasDim = !foldDim && lines.some(l => l.dim)
    return this.draw(`page:${kind}:${bar.thumb ? 'bar' : 'nobar'}:${choosable ? 'sel' : 'view'}:${hasDim ? 'dim' : 'flat'}:${head.key}`, [
      ...head.boxes,
      // With a choice on the page, everything else steps down so the highlighted line stands out.
      { slot: 'body', x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(l => !chosen(l) && (foldDim || !l.dim)), brightness: choosable ? DIM : MID },
      ...(hasDim ? [{ slot: 'prompt' as const, x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(l => !chosen(l) && Boolean(l.dim)), brightness: 1 }] : []),
      ...(choosable ? [{ slot: 'selected' as const, x: 0, y: rowY(1), w: width, h: rowsH(PAGE_ROWS), text: layer(chosen), brightness: BRIGHT }] : []),
      ...(bar.thumb ? this.barBoxes(bar, rowY(1), rowsH(PAGE_ROWS)) : []),
      { slot: 'status', x: 0, y: rowY(1 + PAGE_ROWS), w: FULL_W, h: rowsH(1), text: fitWidth(status.text, FULL_W - 4), brightness: status.brightness },
    ], menu, image)
  }

  private pageNotice(fallback: string) {
    return this.notice ? { text: this.notice, brightness: BRIGHT } : { text: fallback, brightness: DIM }
  }

  /** The lines of the page being shown, for working out what can be chosen. */
  private pageLines(): PageLine[] {
    if (this.page === 'dashboard') return dashboardLines(this.dashboardInput()).slice(1)
    if (this.page === 'tasks') return taskLines(this.pageMachines(), Date.now())
    return usageLines(this.pageMachines(), Date.now(), this.usageDriver)
  }

  private choices(lines: PageLine[]): string[] {
    return [...new Set(lines.flatMap(l => (l.select ? [l.select] : [])))]
  }

  /** The key of the highlighted choice, keeping the cursor inside the list. */
  private chosenKey(lines: PageLine[]): string | null {
    const keys = this.choices(lines)
    this.pageCursor = Math.max(0, Math.min(this.pageCursor, keys.length - 1))
    return keys[this.pageCursor] ?? null
  }

  // --- dashboard ----------------------------------------------------------------------------

  private dashboardInput() {
    const all = [...this.pinnedList, ...this.otherList]
    return {
      threads: all, unread: this.unread, now: Date.now(), machines: this.pageMachines(),
      budget: this.fleet.state.settings.dailyBudget, actions: this.fleet.state.settings.dashboardActions,
      step: (t: PinnedThread) => this.machineOf(t)?.glance(t.id)?.step ?? null,
      request: (t: PinnedThread) => this.machineOf(t)?.glance(t.id)?.request ?? null,
    }
  }

  private renderDashboard() {
    this.closePageStream()
    const input = this.dashboardInput()
    // Follow the threads that are working or asking, so the dashboard can say what each is doing.
    for (const m of this.fleet.state.machines) {
      const busy = input.threads.filter(t => t.machineId === m.id && (isBusy(t.status) || t.needsInput))
      this.fleet.machine(m.id)?.watch(busy.slice(0, 6), { activity: true, reply: false })
    }
    const [summary, ...lines] = dashboardLines(input)
    const selected = this.chosenKey(lines)
    const asking = selected ? input.threads.find(t => askKey(t) === selected) : undefined
    const request = asking ? input.request(asking) : null
    const status = this.armed?.kind === 'allow' && asking
      ? { text: `tap again to allow · swipe: cancel · menu: deny`, brightness: BRIGHT }
      : this.notice ? this.pageNotice('')
      : asking ? this.pageNotice(request?.kind === 'approval' ? 'tap twice: allow · menu: deny' : 'tap: open and answer')
      : this.pageNotice('tap+hold: pages')
    // The summary ("★ 2 need you ▶ 1 running") is the header; the page needs no title.
    const actions: Array<[number, string]> = request?.kind === 'approval' ? [[MENU_ALLOW, 'Allow'], [MENU_DENY, 'Deny']] : []
    return this.drawPage('dashboard', summary.text, lines, selected, status, [...this.alertMenu(), ...actions, ...this.pageMenu(), [MENU_REFRESH, 'Refresh']])
  }

  /** The thread on the dashboard's highlighted line, with what it is waiting on. */
  private askedThread() {
    const input = this.dashboardInput()
    const [, ...lines] = dashboardLines(input)
    const key = this.chosenKey(lines)
    const thread = key ? input.threads.find(t => askKey(t) === key) : undefined
    return thread ? { thread, key: key!, request: input.request(thread), machine: this.machineOf(thread) } : null
  }

  /** First tap on an approval asks, second allows; a question opens its thread. */
  private async tapDashboard() {
    const asked = this.askedThread()
    if (!asked) return
    const { thread, key, request, machine } = asked
    if (request?.kind !== 'approval') return void this.open(thread)
    if (this.armed?.kind !== 'allow' || this.armed.key !== key) { this.armed = { kind: 'allow', key }; return void this.renderDashboard() }
    this.armed = null
    await this.answerApproval(thread, request, machine, 'allow')
  }

  /** Allow or deny from the menu: an explicit choice, so no second tap. */
  private async decideDashboard(which: 'allow' | 'deny') {
    const asked = this.askedThread()
    if (!asked || asked.request?.kind !== 'approval') return
    this.armed = null
    await this.answerApproval(asked.thread, asked.request, asked.machine, which)
  }

  private async answerApproval(thread: PinnedThread, request: Extract<PendingRequest, { kind: 'approval' }>, machine: Machine | undefined, which: 'allow' | 'deny') {
    if (!machine) return
    const decisions = approvalDecisions(request)
    try {
      await machine.respond(thread.id, request.requestId, { decision: decisions[which] })
      await this.showNotice(`${which === 'allow' ? '● allowed' : '■ denied'}: ${thread.title}`, 4000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
  }

  // --- usage ----------------------------------------------------------------------------------

  private renderUsage() {
    this.closePageStream()
    const machines = this.pageMachines()
    const lines = usageLines(machines, Date.now(), this.usageDriver)
    const selected = this.chosenKey(lines)
    const account = selected?.startsWith('acct:') ? this.accountFor(selected) : null
    const status = this.armed?.kind === 'reset' && account
      ? { text: `tap again to spend a reset credit on ${account.name} (${account.credits} left) · swipe: cancel`, brightness: BRIGHT }
      : this.notice ? this.pageNotice('')
      : this.usageDriver ? this.pageNotice(account?.credits ? 'tap: use a reset credit · double tap: back' : 'swipe: accounts · double tap: back')
      : this.pageNotice(selected ? 'tap: see each account · swipe: next provider' : 'tap+hold: pages')
    const menu: Array<[number, string]> = [...this.alertMenu(), ...this.pageMenu(), [MENU_REFRESH, 'Refresh'], ...(this.usageDriver ? [[MENU_BACK, 'Back to overview'] as [number, string]] : [])]
    const title = this.usageDriver ? `${families(usageAccounts(machines)).find(f => f.driver === this.usageDriver)?.provider ?? 'Usage'} accounts` : 'Usage'
    return this.drawPage(`usage:${this.usageDriver ?? ''}`, title, lines, selected, status, menu)
  }

  private accountFor(key: string): LimitAccount | null {
    return usageAccounts(this.pageMachines()).find(a => accountKey(a.key) === key) ?? null
  }

  /** On the overview a tap opens a provider's accounts; on an account it asks, then spends a reset credit. */
  private async tapUsage() {
    const key = this.chosenKey(usageLines(this.pageMachines(), Date.now(), this.usageDriver))
    if (!key) return
    if (key.startsWith('fam:')) {
      this.usageDriver = key.slice(4)
      this.pageCursor = 0
      this.pageTop = 0
      this.armed = null
      return void this.renderUsage()
    }
    const account = this.accountFor(key)
    if (!account) return
    const machine = this.fleet.machine(account.machineId)
    if (!account.credits || !account.reset) return this.showNotice(account.windows.length ? `${account.name}: no reset credits.` : `${account.name}: no limits reported.`, 3000)
    if (!machine?.canReset) return this.showNotice('Resetting needs providers:manage. Pair again with that scope.', 6000)
    if (this.armed?.kind !== 'reset' || this.armed.key !== key) { this.armed = { kind: 'reset', key }; return void this.renderUsage() }
    this.armed = null
    await this.showNotice(`resetting ${account.name}…`, 20_000)
    try {
      const result = await machine.resetLimit(account.reset)
      await this.showNotice(result.warning ?? RESET_TEXT[result.outcome], 5000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
  }

  // --- scheduled tasks ----------------------------------------------------------------------------

  /** The task on the highlighted line, and the machine that owns it. */
  private selectedTask() {
    const machines = this.pageMachines()
    const key = this.chosenKey(taskLines(machines, Date.now()))
    if (!key) return null
    for (const m of machines) {
      const tasks = m.insights.scheduled
      const task = tasks && !isMissing(tasks) ? tasks.find(t => taskKey(m.id, t.id) === key) : undefined
      if (task) return { key, task, machine: this.fleet.machine(m.id) }
    }
    return null
  }

  private renderTasks() {
    this.closePageStream()
    const lines = taskLines(this.pageMachines(), Date.now())
    const selected = this.chosenKey(lines)
    const chosen = this.selectedTask()
    const status = this.armed?.kind === 'task' && chosen
      ? { text: `tap again: run "${chosen.task.title}" now · swipe: cancel`, brightness: BRIGHT }
      : this.notice ? this.pageNotice('')
      : chosen ? this.pageNotice(chosen.task.enabled ? 'tap twice: run now · menu: pause' : 'paused · menu: resume')
      : this.pageNotice('tap+hold: pages')
    const menu: Array<[number, string]> = [
      ...this.alertMenu(),
      ...(chosen ? [[MENU_TASK_RUN, 'Run now'], [MENU_TASK_PAUSE, chosen.task.enabled ? 'Pause' : 'Resume']] as Array<[number, string]> : []),
      ...this.pageMenu(),
      [MENU_REFRESH, 'Refresh'],
    ]
    return this.drawPage('tasks', 'Scheduled tasks', lines, selected, status, menu)
  }

  private async tapTasks() {
    const chosen = this.selectedTask()
    if (!chosen) return
    if (!chosen.task.enabled) return this.showNotice('Paused. Resume it from the menu.', 3000)
    if (this.armed?.kind !== 'task' || this.armed.key !== chosen.key) { this.armed = { kind: 'task', key: chosen.key }; return void this.renderTasks() }
    this.armed = null
    await this.runSelectedTask()
  }

  private async runSelectedTask() {
    const chosen = this.selectedTask()
    if (!chosen?.machine) return
    if (!chosen.machine.canOperateTasks) return this.showNotice('Running tasks needs operate access. Pair again with it.', 6000)
    try {
      await chosen.machine.runTask(chosen.task.id)
      await this.showNotice(`● started: ${chosen.task.title}`, 4000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
  }

  private async toggleSelectedTask() {
    const chosen = this.selectedTask()
    if (!chosen?.machine) return
    if (!chosen.machine.canOperateTasks) return this.showNotice('Pausing tasks needs operate access. Pair again with it.', 6000)
    this.armed = null
    try {
      await chosen.machine.setTaskPaused(chosen.task.id, chosen.task.enabled)
      await this.showNotice(`${chosen.task.enabled ? '□ paused' : '● resumed'}: ${chosen.task.title}`, 3000)
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
      this.pageImage = null
      this.pageStream = { id: page, handle: machine.openThread(meta.threadId, live => { this.pageLive = live; this.scheduleRender() }) }
    }
    const thread = machine.thread(meta.threadId)
    const reply = this.pageLive.messages.findLast(m => m.role === 'assistant' && m.text.trim())
    // A chart in the reply is drawn as a picture beside the text.
    const { text, svg } = reply ? extractSvg(reply.text) : { text: '', svg: null }
    const image = svg ? this.imageFor(svg) : null
    const textWidthPx = image ? FULL_W - BAR_W - 4 - image.w - 8 : TEXT_W
    const body = reply ? plainText(text).split('\n').flatMap(line => (line.trim() ? wrapWidth(line, textWidthPx - 8) : [''])) : []
    const lines: PageLine[] = !this.pageLive.sequence && !reply ? [{ text: 'Loading…', dim: true }]
      : body.length ? body.map(text => ({ text })) : [{ text: 'Nothing here yet. Hold to say what this page should show.', dim: true }]
    const busy = thread ? isBusy(thread.status) : false
    const step = currentStep(this.pageLive)
    const updated = reply ? `updated ${age(reply.createdAt, Date.now())} ago` : ''
    const status = this.recorder.busy || this.sending || this.hold ? this.statusRow(busy)
      : busy ? { text: `${spinner(this.tick)} updating${step ? ` · ${step.label}` : '…'}`, brightness: MID }
      : this.pageNotice([updated, 'hold: change this page'].filter(Boolean).join('   ·   '))
    const title = meta.title || thread?.title || 'Page'
    const slot: ImageSlot | undefined = image ? { key: image.key, x: FULL_W - BAR_W - 4 - image.w, y: rowY(1), w: image.w, h: image.h, png: image.png } : undefined
    return this.drawPage(`tpage:${page}`, title, lines, null, status, [...this.voiceMenu(), ...this.alertMenu(), [MENU_PAGE_REFRESH, 'Update this page'], ...this.pageMenu(), [MENU_NEW_PAGE, 'New page by voice']], slot)
  }

  /** The picture for a page's SVG: drawn once per distinct SVG, shown when ready. */
  private imageFor(svg: string): { key: string; png: Uint8Array; w: number; h: number } | null {
    const key = hashText(svg)
    if (this.pageImage?.key === key) return this.pageImage.png ? { key, ...this.pageImage.png } : null
    this.pageImage = { key, png: null }
    // A WebView that will not draw the SVG (or read the canvas back) just shows no picture.
    void renderSvgPng(svg).catch(() => null).then(rendered => {
      if (this.pageImage?.key !== key) return
      this.pageImage = { key, png: rendered }
      if (rendered) this.scheduleRender()
    })
    return null
  }

  /** Asks the thread behind the page to rewrite it now. */
  private async refreshThreadPage() {
    const meta = this.page && isThreadPage(this.page) ? this.threadPage(this.page) : undefined
    const machine = meta && this.fleet.machine(meta.machineId)
    const thread = meta && machine?.thread(meta.threadId)
    if (!machine || !thread) return
    try {
      await machine.sendText(thread, 'Update this page now with fresh data. Reply with the whole page.')
      await this.showNotice('● asked for an update', 3000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
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
    this.unwatchAll()
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
      { slot: 'head', x: 0, y: rowY(0), w: edge - TITLE_SIDE_W, h: rowsH(1), text: fitWidth(this.activeAlert()?.text ?? title, edge - TITLE_SIDE_W - 8), brightness: BRIGHT },
      { slot: 'side', x: edge - TITLE_SIDE_W, y: rowY(0), w: TITLE_SIDE_W, h: rowsH(1), text: badge, brightness: mark === 'run' || mark === 'ask' ? BRIGHT : DIM },
      ...time.boxes,
      // Chat sits between the title and the live line, so the newest activity is at the bottom, under the newest message.
      { slot: 'body', x: 0, y: rowY(1), w: TEXT_W, h: rowsH(rows), text: loading ? 'Loading…' : bottomAnchor(view.lines, rows) || 'No messages yet.', brightness: MID },
      ...this.barBoxes(bar, rowY(1), rowsH(rows)),
      { slot: 'status', x: 0, y: rowY(1 + rows), w: FULL_W, h: rowsH(1), text: fitWidth(status.text, FULL_W - 4), brightness: status.brightness },
    ], [...this.voiceMenu(), ...this.alertMenu(), ...this.quickMenu()])
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

  // --- alerts ------------------------------------------------------------------------------

  /** The alert in the header, while it is fresh. */
  private activeAlert(): Alert | null {
    if (this.alert && Date.now() >= this.alert.until) this.alert = null
    return this.alert
  }

  private showAlert(alert: Alert | null) {
    if (!alert) return
    this.alert = { ...alert, until: Date.now() + ALERT_MS }
    clearTimeout(this.alertTimer)
    this.alertTimer = setTimeout(() => { this.alert = null; void this.refresh() }, ALERT_MS + 50)
    void this.refresh()
  }

  /** Is this thread the one the user is looking at? Then it needs no announcement. */
  private isWatching(a: Alert): boolean {
    const target = a.action
    if (!target || target === 'usage') return false
    if (this.screen === 'thread' && this.current) return this.current.machineId === target.thread.machineId && this.current.id === target.thread.threadId
    const page = this.page && this.screen === 'list' && isThreadPage(this.page) ? this.threadPage(this.page) : undefined
    return Boolean(page && page.machineId === target.thread.machineId && page.threadId === target.thread.threadId)
  }

  /** Looks for what changed since last time (a thread needs you, finished, failed) and for limits running out. */
  private checkAlerts(state: FleetState) {
    const { alerts } = state.settings
    // Threads behind pages are not pinned or listed, so look them up by id.
    const pageThreads = state.settings.threadPages.flatMap(p => { const t = this.fleet.machine(p.machineId)?.thread(p.threadId); return t ? [t] : [] })
    const pageKeys = new Set(pageThreads.map(keyOf))
    const next = snapshotOf([...state.threads, ...state.others, ...pageThreads], pageKeys)
    const changes = threadAlerts(this.lastSnap, next, alerts).filter(a => !this.isWatching(a))
    this.lastSnap = next

    const warnings = limitWarnings(usageAccounts(this.pageMachines()), alerts.limitPercent, Date.now())
    const { fresh, active } = freshWarnings(warnings, this.limitActive)
    this.limitActive = active
    const limit: Alert[] = this.page === 'usage' ? [] : fresh.map(w => ({ key: w.key, text: `${MARK.ask} ${w.text}`, action: 'usage' as const }))
    this.showAlert(summarize([...limit, ...changes]))
  }

  /** What a tap does on an alert: open the thread, or go to Usage. */
  private followAlert(): boolean {
    const alert = this.activeAlert()
    if (!alert?.action) return false
    this.alert = null
    clearTimeout(this.alertTimer)
    if (alert.action === 'usage') {
      if (this.pages.includes('usage')) this.switchPage('usage')
      else void this.renderList()
    } else {
      const { machineId, threadId } = alert.action.thread
      const thread = this.fleet.machine(machineId)?.thread(threadId)
      if (thread) void this.open(thread)
    }
    return true
  }

  /** While an alert shows, the menu offers to open what it is about. */
  private alertMenu(): Array<[number, string]> {
    const alert = this.activeAlert()
    return alert?.action ? [[MENU_OPEN_ALERT, alert.action === 'usage' ? 'Open Usage' : `Open: ${alert.text.replace(/^\S+\s/, '')}`]] : []
  }

  /** Canned replies in the thread menu: one tap sends the words. */
  private quickMenu(): Array<[number, string]> {
    if (this.hold || this.recorder.busy) return []
    return this.fleet.state.settings.quickReplies.slice(0, 5).map((text, i) => [MENU_QUICK + i, text])
  }

  private async sendQuick(text: string) {
    const thread = this.current
    const machine = thread && this.machineOf(thread)
    if (!thread || !machine || this.screen !== 'thread') return
    try {
      await machine.sendText(thread, text)
      this.scroll = jumpToBottom(this.scroll)
      await this.showNotice(`● sent: ${text}`, 3000)
    } catch (error) {
      await this.showNotice(error, 6000)
    }
  }

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
      settings, title, text: forPage ? `${pagePrompt(this.composeUpdates)}\n\n${voiceText(settings)}` : voiceText(settings),
      attachment: { name: `voice-${Date.now()}.wav`, mimeType: 'audio/wav', bytes: wav },
    })
    if (forPage) {
      const id = threadPageId(machine.id, threadId)
      const page: ThreadPage = { id, machineId: machine.id, threadId, title: 'New page', updates: this.composeUpdates }
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
      } else if (item >= MENU_QUICK && item < MENU_QUICK + 5) {
        const reply = this.fleet.state.settings.quickReplies[item - MENU_QUICK]
        if (reply) void this.sendQuick(reply)
      } else if (item === MENU_BACK) {
        this.usageDriver = null; this.pageCursor = 0; this.pageTop = 0; this.armed = null
        void this.renderList()
      } else if (item === MENU_TASK_RUN) {
        void this.runSelectedTask()
      } else if (item === MENU_TASK_PAUSE) {
        void this.toggleSelectedTask()
      } else if (item === MENU_PAGE_REFRESH) {
        void this.refreshThreadPage()
      } else if (item === MENU_OPEN_ALERT) {
        this.followAlert()
      } else if (item === MENU_ALLOW || item === MENU_DENY) {
        void this.decideDashboard(item === MENU_ALLOW ? 'allow' : 'deny')
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
      else if (this.armed) { this.armed = null; void this.renderList() }
      else if (this.page === 'usage' && this.usageDriver) { this.usageDriver = null; this.pageCursor = 0; this.pageTop = 0; void this.renderList() }
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
      else if (this.screen === 'list' && this.page === 'dashboard') void this.tapDashboard()
      else if (this.screen === 'list' && this.page === 'tasks') void this.tapTasks()
      else if (this.screen === 'list' && this.page && isThreadPage(this.page)) { this.pageTop = 0; void this.renderList() }
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
      if (this.screen === 'list' && (this.page === 'usage' || this.page === 'tasks' || this.page === 'dashboard')) {
        this.armed = null
        // Move the highlight when there is something to choose, otherwise scroll.
        if (this.choices(this.pageLines()).length) this.pageCursor = Math.max(0, this.pageCursor + (up ? -1 : 1))
        else this.pageTop = Math.max(0, this.pageTop + (up ? -1 : 1))
        void this.renderList()
      } else if (this.screen === 'list' && this.page && isThreadPage(this.page)) {
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
