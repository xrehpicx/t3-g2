import { charWidth, fitWidth, LINE_PX, SAFETY_PX, textWidth, wrapWidth } from './font'
import type { ListField } from '../settings'
import type { Glance } from '../t3/machine'
import { isBusy } from '../t3/pinned'
import type { PinnedThread, ThreadMessage, ThreadStatus } from '../t3/types'

/**
 * Screen geometry. Every row is one 27 px text line; the 288 px screen holds 10. Rows sit 4 px from
 * the top so the last one clears the bottom edge.
 */
export const TOP = 4
export const rowY = (row: number) => TOP + row * LINE_PX
export const rowsH = (rows: number) => rows * LINE_PX
export const ROWS = 10

export const BAR_W = 20
export const FULL_W = 576
export const TEXT_W = FULL_W - BAR_W - 4

/** Thread screen: title row, status row, chat. List screen: header row, threads. */
export const THREAD_BODY_ROWS = ROWS - 2
export const LIST_ROWS = ROWS - 1

/** Keep only the tail of a conversation: the glasses never show more than a few turns. */
export const MAX_MESSAGES = 12

// --- symbols ---------------------------------------------------------------------------------

export type Mark = 'run' | 'ask' | 'new' | 'done' | 'idle' | 'fail' | 'stop'

export const MARK: Record<Mark, string> = { run: '▶', ask: '★', new: '●', done: '○', idle: '○', fail: '■', stop: '□' }

const BUSY = new Set(['preparing', 'queued', 'starting', 'running'])

export function markFor(status: ThreadStatus, needsInput: boolean, unread: boolean): Mark {
  if (needsInput || status === 'waiting') return 'ask'
  if (BUSY.has(status)) return 'run'
  if (status === 'failed') return 'fail'
  if (status === 'interrupted' || status === 'cancelled' || status === 'rolled_back') return 'stop'
  if (unread) return 'new'
  return status === 'completed' ? 'done' : 'idle'
}

const SPINNER = ['▁', '▃', '▅', '▇', '▅', '▃']
export const spinner = (tick: number) => SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length]

const LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
/** Peak (0..32768) to a meter glyph, on a log-ish curve so normal speech moves the bars. */
export function levelGlyph(peak: number): string {
  const n = Math.max(0, Math.min(1, Math.log10(1 + peak / 120) / Math.log10(1 + 32768 / 120)))
  return LEVELS[Math.round(n * (LEVELS.length - 1))]
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function age(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/**
 * Right-aligns `text` inside `widthPx` by padding with spaces (the font has no alignment). It stops
 * `SAFETY_PX` short of the edge: a line that spills over wraps and shoves every row below it.
 */
export function alignRight(text: string, widthPx: number): string {
  const pad = Math.max(0, Math.floor((widthPx - SAFETY_PX - textWidth(text)) / charWidth(' ')))
  return ' '.repeat(pad) + text
}

// --- list ------------------------------------------------------------------------------------

export interface ListRow {
  key: string
  mark: Mark | 'add' | 'sep'
  title: string
  /** Right column: run timer, or how long ago it changed. */
  side: string
  /** Shown after the title, dimmer in meaning if not in colour; dropped first when space is short. */
  detail: string
}

export function threadRow(t: PinnedThread, unread: boolean, now: number, detail = ''): ListRow {
  const mark = markFor(t.status, t.needsInput, unread)
  const side = mark === 'run' && t.runStartedAt ? clock(now - Date.parse(t.runStartedAt)) : mark === 'ask' ? 'you' : age(t.updatedAt, now)
  return { key: `${t.machineId}:${t.id}`, mark, title: t.title, side, detail }
}

/** What the user chose to see beside a thread's title, in a fixed order, as one line. */
export function listDetail(fields: readonly ListField[], t: PinnedThread, glance: Glance | undefined, showMachine: boolean): string {
  const oneLine = (text: string) => plainText(text).replace(/\s+/g, ' ').trim()
  const parts: string[] = []
  if (fields.includes('activity') && isBusy(t.status) && glance?.step) parts.push(glance.step)
  if (fields.includes('reply') && glance?.reply) parts.push(oneLine(glance.reply))
  if (fields.includes('project') && t.project) parts.push(t.project)
  if (fields.includes('machine') && showMachine) parts.push(t.machineLabel)
  return parts.filter(Boolean).join(' · ')
}

/** The divider before the threads that are not pinned. Not selectable. */
export const SEP_KEY = 'sep'
export const SEP_ROW: ListRow = { key: SEP_KEY, mark: 'sep', title: '── Other chats ──', side: '', detail: '' }

/** Threads waiting on you first, then ones with a new reply, then the rest. Each group keeps its order. */
export function attentionFirst(threads: PinnedThread[], unread: (t: PinnedThread) => boolean): PinnedThread[] {
  const rank = (t: PinnedThread) => {
    const mark = markFor(t.status, t.needsInput, unread(t))
    return mark === 'ask' ? 0 : mark === 'new' ? 1 : 2
  }
  return threads.map((t, i) => ({ t, i, r: rank(t) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.t)
}

export const NEW_ROW: ListRow = { key: 'new', mark: 'add', title: 'New thread', side: '', detail: '' }

/** The glasses list loads this many threads at a time, and the next batch as you reach the end. */
export const PAGE_SIZE = 10

/** `+ New thread` plus the first `loaded` threads. */
export function buildRows(
  threads: PinnedThread[],
  unread: (t: PinnedThread) => boolean,
  now: number,
  detail: (t: PinnedThread) => string = () => '',
  loaded: number = PAGE_SIZE,
  /** Threads from this index on are not pinned; a divider goes before the first one that is loaded. */
  split: number = threads.length,
): ListRow[] {
  const rows = threads.slice(0, loaded).map(t => threadRow(t, unread(t), now, detail(t)))
  return [NEW_ROW, ...(rows.length > split ? [...rows.slice(0, split), SEP_ROW, ...rows.slice(split)] : rows)]
}

/** How many threads to have loaded once the cursor is on row `cursor` (row 0 is `+ New thread`). */
export function loadedFor(loaded: number, cursor: number, total: number, page = PAGE_SIZE): number {
  // Cursor on the last loaded thread: bring in the next batch.
  return cursor >= loaded && loaded < total ? Math.min(total, loaded + page) : loaded
}

/** A solid bar beside the selected row reads at a glance; `>` is too thin on the display. */
const DETAIL_SEP = ' · '
/** Less than this and a detail says too little to be worth the room it takes from the title. */
const MIN_DETAIL_PX = 70

/** The title, then the detail in whatever room is left. The title keeps at least 55% of the room. */
export function titleWithDetail(title: string, detail: string, room: number): string {
  if (!detail) return fitWidth(title, room)
  const titleRoom = Math.max(Math.floor(room * 0.55), Math.min(textWidth(title), room - MIN_DETAIL_PX - textWidth(DETAIL_SEP)))
  const detailRoom = room - titleRoom - textWidth(DETAIL_SEP)
  if (detailRoom < MIN_DETAIL_PX) return fitWidth(title, room)
  const shownTitle = fitWidth(title, titleRoom)
  const spare = room - textWidth(shownTitle) - textWidth(DETAIL_SEP)
  return shownTitle + DETAIL_SEP + fitWidth(detail, spare)
}

/**
 * The list as two overlaid layers with identical line positions: every row except the selected one on
 * a dim layer, and only the selected row on a bright layer. Selection is shown by brightness alone, so
 * no column is spent on a cursor, and moving it is an in-place text update, never a page rebuild.
 * Each row is one line: mark, title, and the right-aligned side value.
 */
export function listLayers(rows: ListRow[], cursor: number, start: number, widthPx: number, visibleRows = LIST_ROWS) {
  const shown = rows.slice(start, start + visibleRows)
  const lines = shown.map(row => {
    const prefix = row.mark === 'sep' ? '' : `${row.mark === 'add' ? '+' : MARK[row.mark]} `
    const side = row.side ? `  ${row.side}` : ''
    const room = widthPx - textWidth(prefix) - textWidth(side) - 6
    const left = prefix + titleWithDetail(row.title, row.detail, room)
    return side ? left + alignRight(side, widthPx - textWidth(left) - 4) : left
  })
  const selected = cursor - start
  return {
    dim: lines.map((line, i) => (i === selected ? '' : line)).join('\n'),
    bright: lines.map((line, i) => (i === selected ? line : '')).join('\n'),
  }
}

/** Keeps the cursor inside the window, moving the window as little as possible. */
export function listStart(count: number, cursor: number, previous: number, visibleRows = LIST_ROWS): number {
  let start = Math.max(0, Math.min(previous, Math.max(0, count - visibleRows)))
  if (cursor < start) start = cursor
  else if (cursor >= start + visibleRows) start = cursor - visibleRows + 1
  return start
}

export interface HeaderMachine { label: string; connected: boolean }

/**
 * The list's header row: what needs you on the left, which machine you are talking to on the right.
 * Nothing in it is decoration; the old "PINNED 7" was just a count.
 */
export function listHeader(threads: PinnedThread[], machines: HeaderMachine[]): { left: string; right: string } {
  const ask = threads.filter(t => markFor(t.status, t.needsInput, false) === 'ask').length
  const run = threads.filter(t => markFor(t.status, t.needsInput, false) === 'run').length
  const parts: string[] = []
  if (ask) parts.push(`${MARK.ask} ${ask} ${ask === 1 ? 'needs' : 'need'} you`)
  if (run) parts.push(`${MARK.run} ${run} running`)
  const left = parts.length ? parts.join('   ') : threads.length ? 'All quiet' : 'Nothing pinned'

  const online = machines.filter(m => m.connected).length
  const dot = online === machines.length && machines.length ? MARK.new : MARK.done
  const right = !machines.length ? '' : machines.length === 1
    ? `${dot} ${machines[0].label}`
    : `${dot} ${online === machines.length ? `${machines.length} machines` : `${online} of ${machines.length} online`}`
  return { left, right }
}

/** The Chats page header: how many open threads are not pinned, and how many have a new reply. */
export function chatsHeader(threads: PinnedThread[], unread: (t: PinnedThread) => boolean): string {
  const fresh = threads.filter(t => markFor(t.status, t.needsInput, unread(t)) === 'new').length
  const ask = threads.filter(t => markFor(t.status, t.needsInput, false) === 'ask').length
  return [
    threads.length ? `${threads.length} other ${threads.length === 1 ? 'chat' : 'chats'}` : 'No other chats',
    ask ? `${MARK.ask} ${ask}` : '',
    fresh ? `${MARK.new} ${fresh} new` : '',
  ].filter(Boolean).join('   ')
}

/**
 * A scrollbar as two layers drawn in the same place: a dim `│` track on every row, and the same thin
 * glyph bright where the thumb is. Brightness, not a block glyph, marks the position. Empty when
 * everything fits.
 */
export function scrollbar(total: number, start: number, visibleRows: number): { track: string; thumb: string } {
  if (total <= visibleRows) return { track: '', thumb: '' }
  const size = Math.max(1, Math.round((visibleRows / total) * visibleRows))
  const maxStart = total - visibleRows
  const top = Math.round((Math.min(start, maxStart) / maxStart) * (visibleRows - size))
  const rows = Array.from({ length: visibleRows }, (_, i) => i >= top && i < top + size)
  return {
    track: rows.map(on => (on ? '' : '│')).join('\n'),
    thumb: rows.map(on => (on ? '┃' : '')).join('\n'),
  }
}

// --- thread ----------------------------------------------------------------------------------

export const TITLE_SIDE_W = 150

/** Room for the time of day at the right end of the header row. */
export const CLOCK_W = 100

/** "3:05 PM", "15:05", or '' when hidden. */
export function formatClock(date: Date, format: 'off' | '12h' | '24h'): string {
  if (format === 'off') return ''
  const m = String(date.getMinutes()).padStart(2, '0')
  const h = date.getHours()
  if (format === '24h') return `${String(h).padStart(2, '0')}:${m}`
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

/** Strips markdown markers the glasses can't render. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ')
}

const VOICE_PREFIX = 'Voice message from my Even G2 glasses'

export function displayText(message: Pick<ThreadMessage, 'role' | 'text'>): string {
  if (message.role === 'user' && message.text.startsWith(VOICE_PREFIX)) return '(voice message)'
  return plainText(message.text).trim()
}

/**
 * Chat lines. Your messages are one line starting with `>`, cut with `…` if longer; messages from
 * another agent are one line starting with `▷` and the sending thread's name; turns are separated by a blank line; a reply
 * still being written ends with `…`. Only the last few messages are used.
 */
export const AGENT_MARK = '▷'

/** A message one agent sent another: shown as one line, `▷ sender: message`. */
export const isFromAgent = (m: Pick<ThreadMessage, 'role' | 'createdBy' | 'senderThreadId'>) =>
  m.role === 'user' && (m.createdBy === 'agent' || Boolean(m.senderThreadId))

export function chatLines(
  messages: ThreadMessage[],
  widthPx = TEXT_W,
  limit = MAX_MESSAGES,
  senderName: (threadId: string) => string | undefined = () => undefined,
  gap = true,
): string[] {
  const lines: string[] = []
  const recent = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-limit)
  const youPrefix = '> '
  for (const message of recent) {
    const text = displayText(message)
    if (!text) continue
    if (gap && lines.length) lines.push('')
    if (isFromAgent(message)) {
      const from = (message.senderThreadId && senderName(message.senderThreadId)) || 'agent'
      lines.push(fitWidth(`${AGENT_MARK} ${from}: ${text.replace(/\s+/g, ' ')}`, widthPx))
    } else if (message.role === 'user') {
      // Your own messages take one line: you know what you said, the reply is what matters.
      lines.push(youPrefix + fitWidth(text, widthPx - textWidth(youPrefix)))
    } else {
      const body = wrapWidth(text, widthPx - charWidth('…'))
      if (message.streaming) body[body.length - 1] = `${body.at(-1) ?? ''}…`
      lines.push(...body)
    }
  }
  return lines
}

/** Thread scrollbar, measured from the bottom because the chat follows the newest line. */
export function chatBar(total: number, rows: number, fromBottom: number) {
  return scrollbar(total, Math.max(0, total - rows - fromBottom), rows)
}

export function titleBadge(mark: Mark, runMs: number | null): string {
  if (mark === 'run' && runMs !== null) return `${MARK.run} ${clock(runMs)}`
  if (mark === 'ask') return `${MARK.ask} needs you`
  if (mark === 'fail') return `${MARK.fail} failed`
  if (mark === 'stop') return `${MARK.stop} stopped`
  return `${MARK.done} ready`
}

// --- answering questions and approvals --------------------------------------------------------

export interface ChoiceRow {
  key: string
  label: string
  /** Secondary text, dimmer, after the label. */
  detail?: string
  mark: string
}

export interface AnswerView {
  head: string
  side: string
  /** The question or approval detail, wrapped. */
  prompt: string[]
  rows: ChoiceRow[]
}

const SELECTED = '●'
const UNSELECTED = '○'
const CHECKED = '■'
const UNCHECKED = '□'
export const DONE_KEY = '__done'

/** One question of a request: its options, checkboxes for multi-select, and a Done row. */
export function questionView(
  q: { header: string; question: string; options: Array<{ label: string; description?: string; value?: string }>; multiSelect?: boolean },
  index: number,
  total: number,
  chosen: string[],
  voiced: boolean,
): AnswerView {
  const valueOf = (o: { label: string; value?: string }) => o.value ?? o.label
  const rows: ChoiceRow[] = q.options.map(o => ({
    key: valueOf(o),
    label: o.label,
    detail: o.description,
    mark: q.multiSelect ? (chosen.includes(valueOf(o)) ? CHECKED : UNCHECKED) : chosen.includes(valueOf(o)) ? SELECTED : UNSELECTED,
  }))
  if (q.multiSelect) rows.push({ key: DONE_KEY, label: chosen.length ? `Done (${chosen.length})` : 'Done', mark: MARK.run })
  return {
    head: `${MARK.ask} ${total > 1 ? `Question ${index + 1} of ${total}` : 'Question'}`,
    side: voiced ? '● answered by voice' : q.header,
    prompt: wrapWidth(q.question, FULL_W - 8).slice(0, 3),
    rows,
  }
}

export function approvalView(what: string, detail: string, options: Array<{ decision: string; label: string }>): AnswerView {
  return {
    head: `${MARK.ask} ${what}`,
    side: '',
    prompt: detail ? wrapWidth(detail, FULL_W - 8).slice(0, 3) : [],
    rows: options.map(o => ({ key: o.decision, label: o.label, mark: o.decision === 'decline' || o.decision === 'cancel' ? '□' : MARK.run })),
  }
}

/** Description lines shown under an option; the highlighted one may use more. */
const DESC_LINES = 2
const DESC_LINES_SELECTED = 4

/** One option as lines: its label, then its description wrapped and indented under the label. */
function choiceBlock(row: ChoiceRow, selected: boolean, widthPx: number): string[] {
  const head = fitWidth(`${row.mark} ${row.label}`, widthPx - 4)
  if (!row.detail) return [head]
  const indent = ' '.repeat(Math.round(textWidth(`${row.mark} `) / charWidth(' ')))
  const limit = selected ? DESC_LINES_SELECTED : DESC_LINES
  const wrapped = wrapWidth(row.detail, widthPx - textWidth(indent) - SAFETY_PX - 6)
  const shown = wrapped.slice(0, limit)
  if (wrapped.length > limit) shown[limit - 1] = fitWidth(`${shown[limit - 1]} ${wrapped[limit]}`, widthPx - textWidth(indent) - 4)
  return [head, ...shown.map(line => indent + line)]
}

/**
 * The first row to show so the cursor row is fully visible in `visibleLines` lines, moving the window as
 * little as possible. Rows are several lines tall when they have a description.
 */
export function choiceStart(rows: ChoiceRow[], cursor: number, previous: number, visibleLines: number, widthPx = FULL_W): number {
  let start = Math.max(0, Math.min(previous, rows.length - 1))
  if (cursor < start) return cursor
  const height = (from: number) => {
    let lines = 0
    for (let i = from; i <= cursor; i++) lines += choiceBlock(rows[i], i === cursor, widthPx).length
    return lines
  }
  while (start < cursor && height(start) > visibleLines) start++
  return start
}

/**
 * Choice rows as dim/bright layers (selection by brightness). Each option is its label with its
 * description under it; rows that do not fit are left for scrolling.
 */
export function choiceLayers(rows: ChoiceRow[], cursor: number, start: number, visibleLines: number, widthPx = FULL_W) {
  const dim: string[] = []
  const bright: string[] = []
  for (let i = start; i < rows.length; i++) {
    const block = choiceBlock(rows[i], i === cursor, widthPx)
    if (dim.length + block.length > visibleLines && i > start) break
    for (const line of block.slice(0, visibleLines - dim.length)) {
      dim.push(i === cursor ? '' : line)
      bright.push(i === cursor ? line : '')
    }
  }
  return { dim: dim.join('\n'), bright: bright.join('\n') }
}
