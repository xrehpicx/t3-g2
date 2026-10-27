import { describe, expect, it } from 'vitest'
import type { Insights } from '../t3/insights'
import type { LimitAccount, LimitWindow } from '../t3/limits'
import type { PinnedThread } from '../t3/types'
import { textWidth } from './font'
import { approvalDecisions, askKey, dashboardLines, meter, money, pageDots, pageWindow, tokens, until, usageLines, requestSummary, taskKey, taskLines, todaySpend, type PageMachine } from './pages'

const NOW = Date.parse('2026-10-27T10:00:00Z')
const thread = (over: Partial<PinnedThread>): PinnedThread => ({
  machineId: 'm', machineLabel: 'Mac', id: 'x', title: 'Thread', project: '', status: 'completed',
  needsInput: false, updatedAt: '2026-10-27T09:00:00Z', runStartedAt: null, ...over,
})
const win = (label: string, used: number, resetsInMins?: number, kind = label.startsWith('Session') ? 'session' : 'weekly'): LimitWindow =>
  ({ id: label, kind, label, usedPercent: used, ...(resetsInMins === undefined ? {} : { resetsAt: new Date(NOW + resetsInMins * 60_000).toISOString() }) })
const acct = (name: string, windows: LimitWindow[], over: Partial<LimitAccount> = {}): LimitAccount => ({
  key: `s/${name}`, driver: 'claudeAgent', provider: 'Claude', name: `${name}@x.com`, email: `${name}@x.com`, plan: null, source: 'Proxy',
  machineId: 'm', workspaceId: null, windows, credits: 0, reset: null, unavailable: null, ...over,
})
const insights = (over: Partial<Insights> = {}): Insights => ({
  limits: [
    acct('alex', [win('Session', 0), win('Weekly', 100, 300)]),
    acct('blake', [win('Session', 65, 120), win('Weekly', 100, 5000)]),
    acct('casey', [win('Session', 100, 59), win('Weekly', 29, 8000)]),
    acct('drew', [win('Session', 20, 200), win('Weekly', 20, 7000)]),
    acct('cx', [win('Weekly', 82, 6000)], { key: 'c/cx', driver: 'codex', provider: 'Codex', name: 'cx@x.com', credits: 2, reset: { instanceId: 'codex' } }),
    acct('cursor', [], { key: 'm/provider/cursor', driver: 'cursor', provider: 'Cursor', name: 'Cursor', email: null, unavailable: 'unsupported' }),
  ],
  usage: { today: { costUsd: 42.18, tokens: 18_400_000, cachedShare: 0.94 }, week: { costUsd: 512.4, tokens: 241e6, cachedShare: 0.96 }, models: [{ model: 'claude-opus-5-5', costUsd: 468, tokens: 2e8 }] },
  host: { cpu: 0.19, usedMemoryBytes: 27e9, totalMemoryBytes: 39e9 },
  scheduled: [{ id: 't1', title: 'Nightly bump', enabled: true, nextRunAt: '2026-10-27T12:20:00Z', lastRunAt: null, lastRunStatus: null }],
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
  const overview = usageLines([machine()], NOW)
  const text = overview.map(l => l.text)
  it('pools each provider: how many accounts are free, which is next, and what is left in each window', () => {
    const claude = text.find(t => t.startsWith('Claude'))!
    expect(claude).toMatch(/Claude\s+1 of 4 free/)
    expect(text.some(t => /Session\s.*\d+% left\s+3\/4 free · 59m/.test(t))).toBe(true)
    expect(text.some(t => /Weekly\s.*\d+% left\s+2\/4 free · 5h 0m/.test(t))).toBe(true)
    expect(text.find(t => t.startsWith('Codex'))).toMatch(/Codex\s+cx@x\.com.*2 reset credits/)
    expect(text.some(t => t === 'Cursor: no limits reported')).toBe(true)
  })
  it('makes each provider a choice, keyed so a tap can open it', () => {
    expect(overview.filter(l => l.select).map(l => l.select)).toEqual(['fam:claudeAgent', 'fam:codex'])
  })
  it('does not list a provider as having no limits when its accounts do report them', () => {
    const mixed = usageLines([machine({ insights: insights({ limits: [acct('a', [win('Weekly', 10)]), acct('direct', [], { key: 'm/provider/claudeAgent', name: 'Claude', email: null, unavailable: 'unsupported' })] }) })], NOW)
    expect(mixed.some(l => /no limits reported/.test(l.text))).toBe(false)
  })
  it('says the next account to free up when none is free', () => {
    const none = usageLines([machine({ insights: insights({ limits: [acct('a', [win('Weekly', 100, 600)]), acct('b', [win('Weekly', 100, 300)])] }) })], NOW)
    expect(none[0].text).toMatch(/0 of 2 free\s+next free 5h 0m \(b\)/)
  })
  it('lists a provider\'s accounts with free ones first and when each blocked one comes back', () => {
    const lines = usageLines([machine()], NOW, 'claudeAgent')
    expect(lines[0].text).toMatch(/Claude\s+1 of 4 free/)
    const accounts = lines.filter(l => l.select)
    expect(accounts.map(l => l.select)).toEqual(['acct:s/drew', 'acct:s/casey', 'acct:s/alex', 'acct:s/blake'])
    expect(accounts[0].text).toMatch(/^○ drew\s+S 20% 3h 20m\s+W 20%/)
    expect(accounts[1].text).toMatch(/^■ casey\s+S 100% 59m\s+W 29% 5d 13h/)
    expect(accounts[2].text).toMatch(/^■ alex\s+S 0%\s+W 100% 5h 0m/)
  })
  it('shows spend, and says what is missing instead of failing', () => {
    expect(text.join('\n')).toMatch(/Today.*\$42\.18.*18\.4M tokens.*94% cached/)
    expect(text.join('\n')).toMatch(/opus-5-5 \$468/)
    const missing = usageLines([machine({ insights: insights({ usage: { missing: 'needs diagnostics:read' }, limits: null }) })], NOW).map(l => l.text)
    expect(missing).toEqual(['Limits: loading…', 'Spend: needs diagnostics:read'])
  })
  it('counts an account once when two machines report it', () => {
    const two = usageLines([machine(), machine({ id: 'n', label: 'imaimain' })], NOW)
    expect(two.filter(l => l.select).map(l => l.select)).toEqual(['fam:claudeAgent', 'fam:codex'])
    expect(two.find(l => l.text.startsWith('Claude'))!.text).toMatch(/1 of 4 free/)
  })
  it('keeps every line within the screen', () => {
    for (const l of [...overview, ...usageLines([machine()], NOW, 'claudeAgent')]) expect(textWidth(l.text)).toBeLessThan(576)
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
    expect(text.some(t => /^Limits\s+Claude 1\/4 free · 38% left · Codex 18% left$/.test(t))).toBe(true)
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

describe('dashboard actions', () => {
  const approval = { kind: 'approval' as const, requestId: 'r1', itemId: 'i1', what: 'Run a command?', detail: 'pnpm migrate', options: [{ decision: 'accept', label: 'Allow' }, { decision: 'acceptForSession', label: 'Allow for session' }, { decision: 'decline', label: 'Deny' }] }
  const question = { kind: 'question' as const, requestId: 'r2', itemId: 'i2', questions: [{ id: 'q', header: 'h', question: 'Which library?', options: [] }] }
  const asking = thread({ id: 'a', title: 'Migrate billing', needsInput: true })
  const input = { threads: [asking], unread: () => false, step: () => null, machines: [], now: NOW }

  it('names what an asking thread is waiting on, and makes the line choosable when actions are on', () => {
    const on = dashboardLines({ ...input, actions: true, request: () => approval })
    expect(on[1]).toMatchObject({ text: '★ Migrate billing · Run a command? pnpm migrate', select: askKey(asking) })
    expect(dashboardLines({ ...input, actions: true, request: () => question })[1].text).toBe('★ Migrate billing · Which library?')
    expect(dashboardLines({ ...input, actions: false, request: () => approval })[1]).toMatchObject({ dim: true })
    expect(dashboardLines({ ...input, actions: false, request: () => approval })[1].select).toBeUndefined()
  })
  it('summarises requests, and handles an unknown one', () => {
    expect(requestSummary(null)).toBe('')
    expect(requestSummary(approval)).toBe('Run a command? pnpm migrate')
  })
  it('finds which option allows and which denies, whatever the agent calls them', () => {
    expect(approvalDecisions(approval)).toEqual({ allow: 'accept', deny: 'decline' })
    expect(approvalDecisions({ ...approval, options: [{ decision: 'approve', label: 'Yes' }, { decision: 'reject', label: 'No' }] })).toEqual({ allow: 'approve', deny: 'reject' })
    expect(approvalDecisions({ ...approval, options: [{ decision: 'cancel', label: 'Cancel' }, { decision: 'proceed', label: 'Go' }] })).toEqual({ allow: 'proceed', deny: 'cancel' })
  })
  it('shows today against the budget on the spend line', () => {
    const line = dashboardLines({ ...input, machines: [machine()], budget: 50 }).find(l => l.text.startsWith('Spend'))!
    expect(line.text).toMatch(/today \$42\.18 of \$50 ·/)
    expect(todaySpend([machine()])).toBe(42.18)
    expect(todaySpend([machine({ insights: insights({ usage: null }) })])).toBeNull()
  })
})

describe('scheduled tasks page', () => {
  const tasks = [
    { id: 'a', title: 'Nightly bump', enabled: true, nextRunAt: '2026-10-27T12:20:00Z', lastRunAt: null, lastRunStatus: 'succeeded' },
    { id: 'b', title: 'Cost report', enabled: true, nextRunAt: '2026-10-30T10:00:00Z', lastRunAt: null, lastRunStatus: 'failed' },
    { id: 'c', title: 'Paused thing', enabled: false, nextRunAt: null, lastRunAt: null, lastRunStatus: null },
  ]
  const lines = taskLines([machine({ insights: insights({ scheduled: tasks }) })], NOW)
  it('lists each task with when it runs, marking failed and paused ones', () => {
    expect(lines.map(l => l.select)).toEqual([taskKey('m', 'a'), taskKey('m', 'b'), taskKey('m', 'c')])
    expect(lines[0].text).toMatch(/^○ Nightly bump\s+in 2h 20m$/)
    expect(lines[1].text).toMatch(/^■ Cost report\s+in 3d 0h$/)
    expect(lines[2].text).toMatch(/^□ Paused thing\s+paused$/)
  })
  it('explains an empty or unreadable list', () => {
    expect(taskLines([machine({ insights: insights({ scheduled: [] }) })], NOW)[0].text).toMatch(/No scheduled tasks/)
    expect(taskLines([machine({ insights: insights({ scheduled: { missing: 'denied' } }) })], NOW)[0].text).toBe('Scheduled tasks: denied')
  })
})
