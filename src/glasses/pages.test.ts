import { describe, expect, it } from 'vitest'
import type { Insights } from '../t3/insights'
import type { PinnedThread } from '../t3/types'
import { textWidth } from './font'
import { dashboardLines, meter, money, pageDots, pageWindow, tokens, until, usageLines, type PageMachine } from './pages'

const NOW = Date.parse('2026-10-27T10:00:00Z')
const thread = (over: Partial<PinnedThread>): PinnedThread => ({
  machineId: 'm', machineLabel: 'Mac', id: 'x', title: 'Thread', project: '', status: 'completed',
  needsInput: false, updatedAt: '2026-10-27T09:00:00Z', runStartedAt: null, ...over,
})
const insights = (over: Partial<Insights> = {}): Insights => ({
  limits: [{ instanceId: 'codex', name: 'Codex', credits: 2, unavailable: null, windows: [
    { id: 'p', kind: 'session', label: '5 hours', usedPercent: 82, resetsAt: '2026-10-27T12:14:00Z' },
    { id: 'w', kind: 'weekly', label: 'Weekly', usedPercent: 35, resetsAt: '2026-10-31T13:00:00Z' },
  ] }, { instanceId: 'cursor', name: 'Cursor', credits: 0, unavailable: 'unsupported', windows: [] }],
  usage: { today: { costUsd: 42.18, tokens: 18_400_000, cachedShare: 0.94 }, week: { costUsd: 512.4, tokens: 241e6, cachedShare: 0.96 }, models: [{ model: 'claude-opus-5-5', costUsd: 468, tokens: 2e8 }] },
  host: { cpu: 0.19, usedMemoryBytes: 27e9, totalMemoryBytes: 39e9 },
  scheduled: [{ title: 'Nightly bump', nextRunAt: '2026-10-27T12:20:00Z' }],
  ...over,
})
const machine = (over: Partial<PageMachine> = {}): PageMachine => ({ id: 'm', label: 'MacBook Pro', online: true, insights: insights(), ...over })

describe('formatting', () => {
  it('formats money, tokens and time left', () => {
    expect([money(4.214), money(42.18), money(512.4), money(1840)]).toEqual(['$4.21', '$42.18', '$512', '$1.8k'])
    expect([tokens(950), tokens(18_400), tokens(18_400_000), tokens(241e6), tokens(1.2e9)]).toEqual(['950', '18k', '18.4M', '241M', '1.2B'])
    expect([until('2026-10-27T10:14:00Z', NOW), until('2026-10-27T12:14:00Z', NOW), until('2026-10-31T13:00:00Z', NOW)]).toEqual(['14m', '2h 14m', '4d 3h'])
    expect(until('2026-10-27T09:00:00Z', NOW)).toBe('0m')
  })
  it('draws a meter of fixed width', () => {
    expect(meter(0)).toBe('────────')
    expect(meter(50)).toBe('━━━━────')
    expect(meter(100)).toBe('━━━━━━━━')
    expect(meter(150)).toBe('━━━━━━━━')
  })
  it('marks the current page among dots', () => {
    expect(pageDots(['pinned', 'chats', 'usage'], 'usage')).toBe('○○●')
  })
})

describe('usage page', () => {
  const lines = usageLines([machine()], NOW)
  it('shows each limit window as a choice keyed by machine and provider', () => {
    const limits = lines.filter(l => l.select)
    expect(limits).toHaveLength(2)
    expect(limits.every(l => l.select === 'm:codex')).toBe(true)
    expect(limits[0].text).toMatch(/Codex.*5 hours.*82%.*2h 14m/)
  })
  it('mentions reset credits, providers without limits, and spend', () => {
    const text = lines.map(l => l.text).join('\n')
    expect(text).toMatch(/2 reset credits/)
    expect(text).toMatch(/Cursor: no limits reported/)
    expect(text).toMatch(/Today.*\$42\.18.*18\.4M tokens.*94% cached/)
    expect(text).toMatch(/opus-5-5 \$468/)
  })
  it('explains what is missing instead of failing', () => {
    const missing = usageLines([machine({ insights: insights({ usage: { missing: 'needs diagnostics:read' }, limits: null }) })], NOW)
    expect(missing.map(l => l.text)).toEqual(['Limits: loading…', 'Spend: needs diagnostics:read'])
  })
  it('names machines when there are several', () => {
    const two = usageLines([machine(), machine({ id: 'n', label: 'imaimain', online: false })], NOW)
    expect(two[0].text).toBe('● MacBook Pro')
    expect(two.some(l => l.text === '○ imaimain')).toBe(true)
    expect(two.filter(l => l.select).map(l => l.select)).toEqual(['m:codex', 'm:codex', 'n:codex', 'n:codex'])
  })
  it('keeps every line within the screen', () => {
    for (const l of lines) expect(textWidth(l.text)).toBeLessThan(576)
  })
})

describe('dashboard', () => {
  const threads = [
    thread({ id: 'a', title: 'Migrate billing', needsInput: true }),
    thread({ id: 'b', title: 'Fix flaky test', status: 'running', runStartedAt: '2026-10-27T09:57:00Z' }),
    thread({ id: 'c', title: 'Release notes', updatedAt: '2026-10-27T09:59:00Z' }),
  ]
  const lines = dashboardLines({ threads, unread: t => t.id === 'c', step: () => '$ pnpm test', machines: [machine(), machine({ id: 'n', label: 'imaimain', online: false })], now: NOW })
  const text = lines.map(l => l.text)
  it('leads with what needs you, then names it, then what is running', () => {
    expect(text[0]).toBe('★ 1 needs you   ▶ 1 running   ● 1 new')
    expect(text[1]).toBe('★ Migrate billing')
    expect(text[2]).toBe('▶ Fix flaky test · $ pnpm test')
  })
  it('shows machines, spend, the busiest limit and the next scheduled run', () => {
    expect(text.some(t => /^● MacBook Pro\s+CPU 19%\s+RAM 27 of 39 GB$/.test(t))).toBe(true)
    expect(text.some(t => /^○ imaimain\s+offline$/.test(t))).toBe(true)
    expect(text.some(t => /^Spend\s+today \$84\.36 · 36\.8M tokens · 7 days \$1\.0k$/.test(t))).toBe(true)
    expect(text.some(t => /^Limits\s+Codex 82% 5 hours$/.test(t))).toBe(true)
    expect(text.some(t => /^Next run\s+Nightly bump · in 2h 20m$/.test(t))).toBe(true)
  })
  it('says so when nothing needs you', () => {
    expect(dashboardLines({ threads: [], unread: () => false, step: () => null, machines: [], now: NOW })[0].text).toBe('All quiet. Nothing needs you.')
  })
})

describe('pageWindow', () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({ text: String(i) }))
  it('clamps scrolling and keeps the cursor in view', () => {
    expect(pageWindow(lines, 50, 8, -1)).toBe(12)
    expect(pageWindow(lines, 0, 8, 10)).toBe(3)
    expect(pageWindow(lines, 10, 8, 2)).toBe(2)
    expect(pageWindow(lines.slice(0, 3), 5, 8, -1)).toBe(0)
  })
})
