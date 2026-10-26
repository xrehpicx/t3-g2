import { charWidth, fitWidth, LINE_PX, textWidth, wrapWidth } from './font'
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

/** Right-aligns `text` inside `widthPx` by padding with spaces (the font has no alignment). */
export function alignRight(text: string, widthPx: number): string {
  const pad = Math.max(0, Math.floor((widthPx - textWidth(text)) / charWidth(' ')))
  return ' '.repeat(pad) + text
}

// --- list ------------------------------------------------------------------------------------

export interface ListRow {
  key: string
  mark: Mark | 'add'
  title: string
  /** Right column: run timer, or how long ago it changed. */
  side: string
}

export function threadRow(t: PinnedThread, unread: boolean, now: number, showMachine: boolean): ListRow {
  const mark = markFor(t.status, t.needsInput, unread)
  const side = mark === 'run' && t.runStartedAt ? clock(now - Date.parse(t.runStartedAt)) : mark === 'ask' ? 'you' : age(t.updatedAt, now)
  return { key: `${t.machineId}:${t.id}`, mark, title: showMachine ? `${t.title} · ${t.machineLabel}` : t.title, side }
}

export const NEW_ROW: ListRow = { key: 'new', mark: 'add', title: 'New thread', side: '' }

/** A solid bar beside the selected row reads at a glance; `>` is too thin on the display. */
/**
 * The list as two overlaid layers with identical line positions: every row except the selected one on
 * a dim layer, and only the selected row on a bright layer. Selection is shown by brightness alone, so
 * no column is spent on a cursor, and moving it is an in-place text update, never a page rebuild.
 * Each row is one line: mark, title, and the right-aligned side value.
 */
export function listLayers(rows: ListRow[], cursor: number, start: number, widthPx: number, visibleRows = LIST_ROWS) {
  const shown = rows.slice(start, start + visibleRows)
  const lines = shown.map(row => {
    const prefix = `${row.mark === 'add' ? '+' : MARK[row.mark]} `
    const side = row.side ? `  ${row.side}` : ''
    const title = fitWidth(row.title, widthPx - textWidth(prefix) - textWidth(side) - 6)
    const left = prefix + title
    return left + alignRight(side, widthPx - textWidth(left) - 4)
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

export function listHeader(threads: PinnedThread[], machines: number): string {
  const run = threads.filter(t => markFor(t.status, t.needsInput, false) === 'run').length
  const ask = threads.filter(t => markFor(t.status, t.needsInput, false) === 'ask').length
  const parts = [`PINNED ${threads.length}`]
  if (run) parts.push(`${MARK.run} ${run}`)
  if (ask) parts.push(`${MARK.ask} ${ask}`)
  if (machines > 1) parts.push(`${machines} machines`)
  return parts.join('   ')
}

/** Scroll position of the list as a proportional bar, one glyph per row. */
export function scrollbar(total: number, start: number, visibleRows: number): string {
  if (total <= visibleRows) return ''
  const thumb = Math.max(1, Math.round((visibleRows / total) * visibleRows))
  const maxStart = total - visibleRows
  const top = Math.round((start / maxStart) * (visibleRows - thumb))
  return Array.from({ length: visibleRows }, (_, i) => (i >= top && i < top + thumb ? '█' : '│')).join('\n')
}

// --- thread ----------------------------------------------------------------------------------

export const TITLE_SIDE_W = 150

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
): string[] {
  const lines: string[] = []
  const recent = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-limit)
  const youPrefix = '> '
  for (const message of recent) {
    const text = displayText(message)
    if (!text) continue
    if (lines.length) lines.push('')
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

/** Thread scrollbar: track `│` with a `█` thumb sized to the visible share. Empty when it all fits. */
export function chatBar(total: number, rows: number, fromBottom: number): string {
  if (total <= rows) return ''
  const maxOffset = total - rows
  return scrollbar(total, maxOffset - fromBottom, rows)
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

/** Choice rows as dim/bright layers (selection by brightness), each kept to one line. */
export function choiceLayers(rows: ChoiceRow[], cursor: number, start: number, visibleRows: number, widthPx = FULL_W) {
  const lines = rows.slice(start, start + visibleRows).map(row => {
    const head = `${row.mark} ${row.label}`
    if (!row.detail) return fitWidth(head, widthPx - 4)
    const room = widthPx - 4 - textWidth(head) - textWidth('   ')
    return room > 40 ? `${head}   ${fitWidth(row.detail, room)}` : fitWidth(head, widthPx - 4)
  })
  const selected = cursor - start
  return {
    dim: lines.map((line, i) => (i === selected ? '' : line)).join('\n'),
    bright: lines.map((line, i) => (i === selected ? line : '')).join('\n'),
  }
}
