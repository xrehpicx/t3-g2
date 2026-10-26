import { describe, expect, it } from 'vitest'
import { OLD_VOICE_PROMPTS } from './config'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings, voiceText } from './settings'
import type { Store } from './t3/session'

const memory = (): Store => {
  const data = new Map<string, string>()
  return { get: async k => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async k => void data.delete(k) }
}

describe('voiceText', () => {
  it('adds how much reply fits, more when compact', () => {
    const a = voiceText({ voicePrompt: 'Hi.', density: 'comfortable' })
    const b = voiceText({ voicePrompt: 'Hi.', density: 'compact' })
    expect(a).toMatch(/^Hi\.\n\n.*6 lines of 50 characters \(roughly 300/)
    expect(b).toMatch(/8 lines of 50 characters \(roughly 400/)
  })
})

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
  it('keeps a valid send delay (including off) and resets anything else to the default', () => {
    expect(normalizeSettings({ sendDelay: 0 }).sendDelay).toBe(0)
    expect(normalizeSettings({ sendDelay: 10 }).sendDelay).toBe(10)
    expect(normalizeSettings({ sendDelay: 7 }).sendDelay).toBe(DEFAULT_SETTINGS.sendDelay)
    expect(normalizeSettings({}).sendDelay).toBe(3)
  })
  it('keeps chosen list fields in display order, drops junk, and allows none', () => {
    expect(normalizeSettings({}).listFields).toEqual(['activity', 'machine'])
    expect(normalizeSettings({ listFields: ['machine', 'reply', 'nope', 'reply'] }).listFields).toEqual(['reply', 'machine'])
    expect(normalizeSettings({ listFields: [] }).listFields).toEqual([])
    expect(normalizeSettings({ listFields: 'activity' }).listFields).toEqual(['activity', 'machine'])
  })
  it('defaults to comfortable density and keeps compact', () => {
    expect(normalizeSettings({}).density).toBe('comfortable')
    expect(normalizeSettings({ density: 'compact' }).density).toBe('compact')
    expect(normalizeSettings({ density: 'huge' }).density).toBe('comfortable')
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
