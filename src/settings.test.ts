import { describe, expect, it } from 'vitest'
import { OLD_VOICE_PROMPTS } from './config'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from './settings'
import type { Store } from './t3/session'

const memory = (): Store => {
  const data = new Map<string, string>()
  return { get: async k => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async k => void data.delete(k) }
}

describe('settings', () => {
  it('falls back to defaults for missing or junk input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ runtimeMode: 'yolo', projectId: '' })).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps valid values and trims an empty voice prompt back to the default', () => {
    const s = normalizeSettings({ projectId: 'p1', instanceId: 'codex', model: 'm', runtimeMode: 'auto', voicePrompt: '   ' })
    expect(s).toMatchObject({ projectId: 'p1', instanceId: 'codex', model: 'm', runtimeMode: 'auto' })
    expect(s.voicePrompt).toBe(DEFAULT_SETTINGS.voicePrompt)
  })
  it('upgrades a saved copy of an old default prompt, but keeps custom prompts', () => {
    expect(normalizeSettings({ voicePrompt: OLD_VOICE_PROMPTS[0] }).voicePrompt).toBe(DEFAULT_SETTINGS.voicePrompt)
    expect(normalizeSettings({ voicePrompt: 'mine' }).voicePrompt).toBe('mine')
  })
  it('round-trips through the store and survives corrupt storage', async () => {
    const store = memory()
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS)
    await saveSettings(store, { ...DEFAULT_SETTINGS, projectId: 'x', model: 'y' })
    expect((await loadSettings(store)).projectId).toBe('x')
    await store.set('t3g2.settings', '{broken')
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS)
  })
})
