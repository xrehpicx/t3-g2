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
}

export type Density = 'comfortable' | 'compact'

/** The glasses' built-in top-level pages, in the order they cycle. */
export type BuiltinPage = 'pinned' | 'chats' | 'dashboard' | 'usage'

/** A page is a built-in one, or `thread:<machine>:<thread>`: a thread whose latest reply is the page. */
export type Page = BuiltinPage | `thread:${string}`

/** A page made by a thread: the thread keeps it up to date, and you change it by talking to the thread. */
export interface ThreadPage {
  id: `thread:${string}`
  machineId: string
  threadId: string
  title: string
}

export const threadPageId = (machineId: string, threadId: string): ThreadPage['id'] => `thread:${machineId}:${threadId}`
export const isThreadPage = (page: Page): page is ThreadPage['id'] => page.startsWith('thread:')

export const PAGES: Array<{ value: BuiltinPage; label: string; hint: string }> = [
  { value: 'pinned', label: 'Pinned', hint: 'Your pinned threads.' },
  { value: 'chats', label: 'Chats', hint: 'Every other open thread, newest first.' },
  { value: 'dashboard', label: 'Dashboard', hint: 'What needs you, what is running, your machines, spend and limits.' },
  { value: 'usage', label: 'Usage', hint: 'Plan limits with reset credits, and token spend by model.' },
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
    const { machineId, threadId, title } = p as Record<string, unknown>
    if (typeof machineId !== 'string' || typeof threadId !== 'string' || !machineId || !threadId) return []
    const id = threadPageId(machineId, threadId)
    if (seen.has(id)) return []
    seen.add(id)
    return [{ id, machineId, threadId, title: typeof title === 'string' && title ? title : 'Page' }]
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
  pages: ['pinned', 'chats', 'dashboard', 'usage'],
  startPage: 'pinned',
  threadPages: [],
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
    ...pagesOf(o.pages, o.startPage, normalizeThreadPages(o.threadPages)),
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
export const PAGE_PROMPT =
  'This thread is a live page on my Even G2 glasses. The page shows only your latest reply, on a small ' +
  'screen: 8 lines of about 50 characters. So every reply you write is the complete page: plain text, one ' +
  'short item per line, no markdown, tables, code blocks or html_render. When I ask for a change, reply with ' +
  'the whole updated page. If the page should stay current, use schedule_task (bound to this thread) on a ' +
  'sensible interval, or a webhook trigger for events; each run gathers fresh data and replies with the full ' +
  'page. What I want on the page:'

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
