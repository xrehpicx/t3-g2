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
}

export type Density = 'comfortable' | 'compact'

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

export const DEFAULT_SETTINGS: NewThreadSettings = {
  projectId: 'scratch',
  instanceId: '',
  model: '',
  runtimeMode: 'full-access',
  voicePrompt: DEFAULT_VOICE_PROMPT,
  sendDelay: DEFAULT_SEND_DELAY,
  density: 'comfortable',
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
  }
}

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
