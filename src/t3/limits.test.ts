import { describe, expect, it } from 'vitest'
import {
  accountOrder, dedupeAccounts, isPerModelWindow, visibleLimits, families, freeAt, isFree, limitWarnings, mergeAccounts, providerAccounts, shortNames, sourceAccounts,
  spanText, windowTag, type LimitAccount, type LimitWindow, type RawSource,
} from './limits'

const NOW = Date.parse('2026-10-27T00:00:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const win = (label: string, used: number, resetsInMins?: number, kind = label.startsWith('Session') ? 'session' : 'weekly'): LimitWindow =>
  ({ id: label, kind, label, usedPercent: used, ...(resetsInMins === undefined ? {} : { resetsAt: at(resetsInMins) }) })
const account = (name: string, windows: LimitWindow[], over: Partial<LimitAccount> = {}): LimitAccount => ({
  key: `s/${name}`, driver: 'claudeAgent', provider: 'Claude', name: `${name}@x.com`, email: `${name}@x.com`, plan: null, source: 'Proxy',
  machineId: 'm', workspaceId: null, windows, credits: 0, reset: null, unavailable: null, ...over,
})

describe('reading T3 Code data', () => {
  const raw: RawSource[] = [{
    id: 'proxy', label: 'IMAI Proxy',
    accounts: [
      { id: 'claude-a.json', driver: 'claudeAgent', email: 'a@x.com', plan: 'Claude Subscription', usageLimits: { windows: [win('Session', 10, 50), win('Weekly', 100, 900)] } },
      { id: 'codex-b', driver: 'codex', email: 'b@x.com', workspaceId: 'ws1', usageLimits: { windows: [win('Weekly', 35, 5000)], resetCredits: { availableCount: 1, nextCreditId: 'c1' } } },
    ],
  }]
  it('turns source accounts into accounts, with how to spend their reset credit', () => {
    const [a, b] = sourceAccounts(raw, 'm')
    expect(a).toMatchObject({ key: 'proxy/claude-a.json', provider: 'Claude', name: 'a@x.com', source: 'IMAI Proxy', credits: 0, reset: null })
    expect(b).toMatchObject({ provider: 'Codex', credits: 1, reset: { sourceId: 'proxy', accountId: 'codex-b', creditId: 'c1' } })
  })
  it('turns signed-in providers into accounts that reset by instance', () => {
    const [p] = providerAccounts([{ instanceId: 'codex', driver: 'codex', displayName: 'Codex', auth: { workspaceId: 'ws1' }, usageLimits: { windows: [win('Weekly', 35, 5000)], resetCredits: { availableCount: 2 } } }], 'm')
    expect(p).toMatchObject({ key: 'm/provider/codex', name: 'Codex', workspaceId: 'ws1', reset: { instanceId: 'codex' } })
  })
  it('marks providers with no windows as unavailable, and skips disabled ones', () => {
    const list = providerAccounts([
      { instanceId: 'cursor', driver: 'cursor', displayName: 'Cursor', usageLimits: { windows: [], unavailable: { reason: 'unsupported' } } },
      { instanceId: 'grok', driver: 'grok', enabled: false, usageLimits: { windows: [] } },
      { instanceId: 'pi', driver: 'pi' },
    ], 'm')
    expect(list).toHaveLength(1)
    expect(list[0].unavailable).toBe('unsupported')
  })
  it('drops a signed-in provider that a source also lists (same workspace), and de-duplicates across machines', () => {
    const fromSource = sourceAccounts(raw, 'm')
    const provider = providerAccounts([{ instanceId: 'codex', driver: 'codex', auth: { workspaceId: 'ws1' }, usageLimits: { windows: [win('Weekly', 35)] } }, { instanceId: 'cursor', driver: 'cursor', usageLimits: { windows: [] } }], 'm')
    expect(mergeAccounts(provider, fromSource).map(a => a.key)).toEqual(['proxy/claude-a.json', 'proxy/codex-b', 'm/provider/cursor'])
    expect(dedupeAccounts([fromSource, sourceAccounts(raw, 'other')])).toHaveLength(2)
  })
})

describe('one account', () => {
  it('is free until a window is full, and free again when the last full window resets', () => {
    const free = account('a', [win('Session', 40, 60), win('Weekly', 90, 900)])
    const blocked = account('b', [win('Session', 100, 60), win('Weekly', 100, 900)])
    expect(isFree(free)).toBe(true)
    expect(freeAt(free)).toBeNull()
    expect(isFree(blocked)).toBe(false)
    expect(freeAt(blocked)).toBe(NOW + 900 * 60_000) // the weekly outlasts the session
  })
  it('tags windows and shortens names only when that stays unambiguous', () => {
    expect([windowTag(win('Session', 0)), windowTag(win('Weekly', 0)), windowTag(win('Weekly · Fable', 0))]).toEqual(['S', 'W', 'F'])
    const names = shortNames([account('raj', []), account('hitesh', []), { ...account('raj', [], { key: 'other' }), email: 'raj@y.com' }])
    expect(names.get('s/hitesh')).toBe('hitesh')
    expect(names.get('s/raj')).toBe('raj@x.com')
  })
  it('formats spans of time', () => {
    expect([spanText(0), spanText(59 * 60_000), spanText(134 * 60_000), spanText(99 * 3_600_000)]).toEqual(['0m', '59m', '2h 14m', '4d 3h'])
  })
})

describe('pooling accounts', () => {
  const claude = [
    account('alex', [win('Session', 0), win('Weekly', 100, 300)]),
    account('blake', [win('Session', 65, 120), win('Weekly', 100, 5000)]),
    account('casey', [win('Session', 100, 59), win('Weekly', 29, 8000)]),
    account('drew', [win('Session', 20, 200), win('Weekly', 20, 7000)]),
  ]
  const codex = [account('x', [win('Weekly', 36, 6000)], { key: 'c/x', driver: 'codex', provider: 'Codex' })]
  const [claudeFamily, codexFamily] = families([...claude, ...codex])

  it('counts accounts that are free, and pools each window', () => {
    expect(claudeFamily).toMatchObject({ provider: 'Claude', counted: 4, free: 1 })
    const weekly = claudeFamily.windows.find(w => w.label === 'Weekly')!
    expect(weekly).toMatchObject({ accounts: 4, withRoom: 2 })
    expect(weekly.usedPercent).toBeCloseTo((100 + 100 + 29 + 20) / 4)
    expect(weekly.firstReset).toEqual({ at: NOW + 300 * 60_000, name: 'alex' })
    expect(claudeFamily.windows.map(w => w.label)).toEqual(['Session', 'Weekly'])
  })
  it('says which blocked account is usable again first, and the earliest reset of anything', () => {
    expect(claudeFamily.nextFree).toEqual({ at: NOW + 59 * 60_000 > NOW + 5000 * 60_000 ? 0 : NOW + 59 * 60_000, name: 'casey' })
    expect(claudeFamily.nextReset).toEqual({ at: NOW + 59 * 60_000, name: 'casey' })
    expect(codexFamily).toMatchObject({ provider: 'Codex', counted: 1, free: 1 })
  })
  it('orders accounts: free ones with the most left first, then blocked ones by when they free up', () => {
    expect(accountOrder(claude).map(a => a.name)).toEqual(['drew@x.com', 'casey@x.com', 'alex@x.com', 'blake@x.com'])
  })
  it('keeps accounts without limits out of the pool but in the list', () => {
    const [f] = families([account('a', [win('Weekly', 10)]), account('none', [], { unavailable: 'unsupported' })])
    expect(f).toMatchObject({ counted: 1, free: 1 })
    expect(f.accounts).toHaveLength(2)
  })
})

describe('per-model limits', () => {
  const a = account('a', [win('Session', 10, 60), win('Weekly', 40, 900), win('Weekly · Fable', 100, 900)])
  it('can be left out, and then no longer block the account or count in the pool', () => {
    expect(isFree(a)).toBe(false)
    const [shown] = visibleLimits([a], false)
    expect(shown.windows.map(w => w.label)).toEqual(['Session', 'Weekly'])
    expect(isFree(shown)).toBe(true)
    expect(families(visibleLimits([a], false))[0].windows.map(w => w.label)).toEqual(['Session', 'Weekly'])
    expect(limitWarnings(visibleLimits([a], false), 90, NOW)).toEqual([])
    expect(limitWarnings([a], 90, NOW)).toHaveLength(1)
  })
  it('are all shown by default, untouched', () => {
    expect(visibleLimits([a], true)).toEqual([a])
    expect(isPerModelWindow(win('Weekly', 0))).toBe(false)
  })
})

describe('limit warnings', () => {
  const pool = [account('a', [win('Weekly', 100, 600)]), account('b', [win('Weekly', 90, 3000)])]
  it('judges the whole pool, not each account', () => {
    expect(limitWarnings(pool, 90, NOW)).toEqual([{ key: 'claudeAgent:Weekly', text: 'Claude weekly: 5% left across 2 · resets in 10h 0m' }])
    expect(limitWarnings([account('a', [win('Weekly', 100, 600)]), account('b', [win('Weekly', 10)])], 90, NOW)).toEqual([])
  })
  it('says when the next account frees up if none is free', () => {
    const blocked = [account('a', [win('Weekly', 100, 600)]), account('b', [win('Weekly', 100, 300)])]
    expect(limitWarnings(blocked, 90, NOW)[0].text).toBe('Claude weekly: 0% left across 2 · next free in 5h 0m')
  })
  it('names a single account plainly, and is off at 0', () => {
    expect(limitWarnings([account('a', [win('Weekly', 92, 60)], { driver: 'codex', provider: 'Codex' })], 90, NOW)[0].text).toBe('Codex weekly 92% used · resets in 1h 0m')
    expect(limitWarnings(pool, 0, NOW)).toEqual([])
  })
})
