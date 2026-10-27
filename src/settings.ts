import { DEFAULT_SEND_DELAY, normalizeSendDelay } from './audio/hold'
import { DEFAULT_VOICE_PROMPT, OLD_VOICE_PROMPTS } from './config'
import type { Store } from './t3/session'

export type RuntimeMode = 'approval-required' | 'auto-accept-edits' | 'auto' | 'full-access'

/** Where new threads are created and how they run. Edited on the phone, never on the glasses. */
export interface NewThreadSettings {
  /** A project id, or 'scratch' for a "no project" thread. */
  projectId: string
  /** Empty means "use the server's default model". */
  instanceId: string
  model: string
  runtimeMode: RuntimeMode
  voicePrompt: string
  /** Seconds to wait before a voice message goes out, during which it can be cancelled. 0 sends at once. */
  sendDelay: number
  /** How much the glasses fit on screen. The font itself has a fixed size. */
  density: Density
  clock: ClockFormat
  /** Shown beside each thread title in the glasses list. */
  listFields: ListField[]
  /** Pages shown on the glasses, and the one the app opens on. */
  pages: Page[]
  startPage: Page
  threadPages: ThreadPage[]
  alerts: AlertSettings
  /** Daily spend, in dollars, past which the header warns. 0 is off. */
  dailyBudget: number
  /** Replies offered in the thread menu on the glasses; empty hides them. */
  quickReplies: string[]
  /** Approve or deny from the dashboard's "needs you" lines. */
  dashboardActions: boolean
}

/** Short alerts across the glasses header. Each is optional. */
export interface AlertSettings {
  needsYou: boolean
  finished: boolean
  failed: boolean
  /** A page made by a thread was rewritten. */
  pageUpdated: boolean
  /** Warn when a usage limit passes this percent. 0 is off. */
  limitPercent: number
}

export const LIMIT_THRESHOLDS = [0, 70, 80, 90, 95]
export const BUDGETS = [0, 10, 25, 50, 100, 250, 500]
export const DEFAULT_ALERTS: AlertSettings = { needsYou: true, finished: true, failed: true, pageUpdated: false, limitPercent: 90 }
export const DEFAULT_QUICK_REPLIES = ['Continue', 'Ship it', 'Explain briefly', 'Stop and summarize']
/** The glasses menu allows 10 items and 32 bytes per label. */
export const MAX_QUICK_REPLIES = 5
export const MAX_QUICK_REPLY = 28

/** Trimmed, de-duplicated, capped to what the glasses menu can show. */
export function normalizeQuickReplies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_REPLIES]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const text = typeof item === 'string' ? item.replace(/\s+/g, ' ').trim().slice(0, MAX_QUICK_REPLY) : ''
    if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); out.push(text) }
  }
  return out.slice(0, MAX_QUICK_REPLIES)
}

function normalizeAlerts(raw: unknown): AlertSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flag = (key: keyof Omit<AlertSettings, 'limitPercent'>) => (typeof o[key] === 'boolean' ? (o[key] as boolean) : DEFAULT_ALERTS[key])
  return {
    needsYou: flag('needsYou'), finished: flag('finished'), failed: flag('failed'), pageUpdated: flag('pageUpdated'),
    limitPercent: LIMIT_THRESHOLDS.includes(o.limitPercent as number) ? (o.limitPercent as number) : DEFAULT_ALERTS.limitPercent,
  }
}

export type Density = 'comfortable' | 'compact'

/** The glasses' built-in top-level pages, in the order they cycle. */
export type BuiltinPage = 'pinned' | 'chats' | 'dashboard' | 'usage' | 'tasks'

/** A page is a built-in one, or `thread:<machine>:<thread>`: a thread whose latest reply is the page. */
export type Page = BuiltinPage | `thread:${string}`

/** A page made by a thread: the thread keeps it up to date, and you change it by talking to the thread. */
export interface ThreadPage {
  id: `thread:${string}`
  machineId: string
  threadId: string
  title: string
  /** How the thread keeps the page current. */
  updates: PageUpdates
}

export type PageUpdates = 'timer' | 'events' | 'manual'

export const PAGE_UPDATES: Array<{ value: PageUpdates; label: string }> = [
  { value: 'timer', label: 'On a timer' },
  { value: 'events', label: 'When something happens' },
  { value: 'manual', label: 'Only when I ask' },
]

export const threadPageId = (machineId: string, threadId: string): ThreadPage['id'] => `thread:${machineId}:${threadId}`
export const isThreadPage = (page: Page): page is ThreadPage['id'] => page.startsWith('thread:')

export const PAGES: Array<{ value: BuiltinPage; label: string; hint: string }> = [
  { value: 'pinned', label: 'Pinned', hint: 'Your pinned threads.' },
  { value: 'chats', label: 'Chats', hint: 'Every other open thread, newest first.' },
  { value: 'dashboard', label: 'Dashboard', hint: 'What needs you, what is running, your machines, spend and limits.' },
  { value: 'usage', label: 'Usage', hint: 'Plan limits with reset credits, and token spend by model.' },
  { value: 'tasks', label: 'Scheduled tasks', hint: 'Your T3 scheduled tasks: run one now, or pause and resume it.' },
]

/** Enabled pages: built-ins in their fixed order, then thread pages in the order they were added. At least one. */
export function normalizePages(raw: unknown, threadPages: ThreadPage[] = []): Page[] {
  if (!Array.isArray(raw)) return [...PAGES.map(p => p.value), ...threadPages.map(p => p.id)]
  const pages: Page[] = [...PAGES.map(p => p.value).filter(v => raw.includes(v)), ...threadPages.map(p => p.id).filter(id => raw.includes(id))]
  return pages.length ? pages : ['pinned']
}

function normalizeThreadPages(raw: unknown): ThreadPage[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap(p => {
    if (!p || typeof p !== 'object') return []
    const { machineId, threadId, title, updates } = p as Record<string, unknown>
    if (typeof machineId !== 'string' || typeof threadId !== 'string' || !machineId || !threadId) return []
    const id = threadPageId(machineId, threadId)
    if (seen.has(id)) return []
    seen.add(id)
    return [{ id, machineId, threadId, title: typeof title === 'string' && title ? title : 'Page', updates: PAGE_UPDATES.some(u => u.value === updates) ? (updates as PageUpdates) : 'timer' }]
  })
}

/** What the thread list shows beside each title. Shown in this order, joined with " · ". */
export type ListField = 'activity' | 'reply' | 'project' | 'machine'

export const LIST_FIELDS: Array<{ value: ListField; label: string; hint: string }> = [
  { value: 'activity', label: 'What it is doing', hint: 'The step a running thread is on, like $ pnpm test or edit auth.ts.' },
  { value: 'reply', label: 'Latest reply', hint: "The start of the agent's newest message." },
  { value: 'project', label: 'Project', hint: "The thread's project." },
  { value: 'machine', label: 'Machine', hint: 'Which machine it runs on, when you have more than one.' },
]

/** Valid, de-duplicated and in display order. Anything that is not a list falls back to the default. */
export function normalizeListFields(raw: unknown): ListField[] {
  if (!Array.isArray(raw)) return [...DEFAULT_LIST_FIELDS]
  return LIST_FIELDS.map(f => f.value).filter(v => raw.includes(v))
}

/** The time of day in the glasses' header row. */
export type ClockFormat = 'off' | '12h' | '24h'

export const CLOCKS: Array<{ value: ClockFormat; label: string }> = [
  { value: '12h', label: '12-hour (3:05 PM)' },
  { value: '24h', label: '24-hour (15:05)' },
  { value: 'off', label: 'Hidden' },
]

export const DENSITIES: Array<{ value: Density; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export const RUNTIME_MODES: Array<{ value: RuntimeMode; label: string }> = [
  { value: 'approval-required', label: 'Ask before every action' },
  { value: 'auto-accept-edits', label: 'Auto-accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'full-access', label: 'Full access' },
]

const DEFAULT_LIST_FIELDS: ListField[] = ['activity', 'machine']

export const DEFAULT_SETTINGS: NewThreadSettings = {
  projectId: 'scratch',
  instanceId: '',
  model: '',
  runtimeMode: 'full-access',
  voicePrompt: DEFAULT_VOICE_PROMPT,
  sendDelay: DEFAULT_SEND_DELAY,
  density: 'comfortable',
  clock: '12h',
  listFields: DEFAULT_LIST_FIELDS,
  pages: PAGES.map(p => p.value),
  startPage: 'pinned',
  threadPages: [],
  alerts: DEFAULT_ALERTS,
  dailyBudget: 0,
  quickReplies: DEFAULT_QUICK_REPLIES,
  dashboardActions: true,
}

const KEY = 't3g2.settings'
const isRuntime = (v: unknown): v is RuntimeMode => RUNTIME_MODES.some(m => m.value === v)

const upgradePrompt = (prompt: string) => (!prompt || OLD_VOICE_PROMPTS.includes(prompt) ? DEFAULT_VOICE_PROMPT : prompt)

export function normalizeSettings(raw: unknown): NewThreadSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof NewThreadSettings, unknown>>
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
  return {
    projectId: text(o.projectId, DEFAULT_SETTINGS.projectId) || DEFAULT_SETTINGS.projectId,
    instanceId: text(o.instanceId, ''),
    model: text(o.model, ''),
    runtimeMode: isRuntime(o.runtimeMode) ? o.runtimeMode : DEFAULT_SETTINGS.runtimeMode,
    voicePrompt: upgradePrompt(text(o.voicePrompt, '').trim()),
    sendDelay: normalizeSendDelay(o.sendDelay),
    density: o.density === 'compact' ? 'compact' : 'comfortable',
    clock: CLOCKS.some(c => c.value === o.clock) ? (o.clock as ClockFormat) : DEFAULT_SETTINGS.clock,
    listFields: normalizeListFields(o.listFields),
    // Settings saved before the Scheduled tasks page existed (they have no `alerts` yet) get it switched on.
    ...pagesOf(Array.isArray(o.pages) && o.alerts === undefined && !o.pages.includes('tasks') ? [...o.pages, 'tasks'] : o.pages, o.startPage, normalizeThreadPages(o.threadPages)),
    alerts: normalizeAlerts(o.alerts),
    dailyBudget: BUDGETS.includes(o.dailyBudget as number) ? (o.dailyBudget as number) : 0,
    quickReplies: normalizeQuickReplies(o.quickReplies),
    dashboardActions: typeof o.dashboardActions === 'boolean' ? o.dashboardActions : true,
  }
}

function pagesOf(rawPages: unknown, rawStart: unknown, threadPages: ThreadPage[]) {
  const pages = normalizePages(rawPages, threadPages)
  return { pages, threadPages, startPage: pages.includes(rawStart as Page) ? (rawStart as Page) : pages[0] }
}

/**
 * Sent when a thread is made into a page. The page shows only the thread's latest reply, so every reply
 * has to be the whole page, sized for the glasses.
 */
/** How each way of updating is asked for. */
export const UPDATE_RULE: Record<PageUpdates, string> = {
  timer: 'To keep the page current, use schedule_task (bound to this thread) on a sensible interval; each run gathers fresh data and replies with the full page.',
  events: 'To keep the page current, use schedule_task with a webhook trigger (bound to this thread) for the events I care about, and tell me the webhook URL once in your first reply; each delivery gathers fresh data and replies with the full page.',
  manual: 'Do not schedule anything: update the page only when I ask.',
}

/**
 * Sent when a thread is made into a page. The page shows only the thread's latest reply, so every reply
 * has to be the whole page, sized for the glasses.
 */
export const pagePrompt = (updates: PageUpdates) =>
  'This thread is a live page on my Even G2 glasses. The page shows only your latest reply, on a small ' +
  'screen: 8 lines of about 50 characters. So every reply you write is the complete page: plain text, one ' +
  'short item per line, no markdown, tables, code blocks or html_render. When I ask for a change, reply with ' +
  'the whole updated page. ' + UPDATE_RULE[updates] + ' ' +
  'When a small chart helps, add one inline <svg> after the text: viewBox 0 0 288 120 or smaller, light strokes ' +
  '(white) on a transparent background, no text smaller than 14px, no scripts or external files. What I want on the page:'

export async function loadSettings(store: Store): Promise<NewThreadSettings> {
  const raw = await store.get(KEY)
  try { return normalizeSettings(raw ? JSON.parse(raw) : null) } catch { return { ...DEFAULT_SETTINGS } }
}

export const saveSettings = (store: Store, settings: NewThreadSettings) => store.set(KEY, JSON.stringify(settings))

/** How much of an agent's reply fits the glasses thread view at each density (about 50 characters a line). */
export const REPLY_FIT: Record<Density, { lines: number; chars: number }> = {
  comfortable: { lines: 6, chars: 300 },
  compact: { lines: 8, chars: 400 },
}

/** The text sent with a voice message: the user's instructions plus how much reply the screen can show. */
export function voiceText(settings: Pick<NewThreadSettings, 'voicePrompt' | 'density'>): string {
  const fit = REPLY_FIT[settings.density]
  return `${settings.voicePrompt}\n\nI read your reply on small glasses that fit about ${fit.lines} lines of 50 characters ` +
    `(roughly ${fit.chars} characters). Keep it that short if you can: answer first, plain text, no tables or code blocks.`
}
