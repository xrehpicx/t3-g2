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
}

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
  }
}

export async function loadSettings(store: Store): Promise<NewThreadSettings> {
  const raw = await store.get(KEY)
  try { return normalizeSettings(raw ? JSON.parse(raw) : null) } catch { return { ...DEFAULT_SETTINGS } }
}

export const saveSettings = (store: Store, settings: NewThreadSettings) => store.set(KEY, JSON.stringify(settings))
