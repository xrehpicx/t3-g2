import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS, type AlertSettings } from '../settings'
import type { PinnedThread } from '../t3/types'
import { freshWarnings, overBudget, snapshotOf, summarize, threadAlerts } from './alerts'

const thread = (over: Partial<PinnedThread> = {}): PinnedThread => ({
  machineId: 'm', machineLabel: 'Mac', id: 't1', title: 'Fix login', project: '', status: 'running', needsInput: false,
  updatedAt: '2026-10-27T00:00:00Z', runStartedAt: null, ...over,
})
const alertsFor = (before: PinnedThread, after: PinnedThread, settings: AlertSettings = DEFAULT_ALERTS, pages: string[] = []) =>
  threadAlerts(snapshotOf([before], new Set(pages)), snapshotOf([after], new Set(pages)), settings)

describe('thread alerts', () => {
  it('announces a thread that starts waiting on you, and opens it on tap', () => {
    const [a] = alertsFor(thread(), thread({ status: 'waiting', needsInput: true }))
    expect(a.text).toBe('★ Fix login needs you')
    expect(a.action).toEqual({ thread: { machineId: 'm', threadId: 't1' } })
  })
  it('announces finishing and failing', () => {
    expect(alertsFor(thread(), thread({ status: 'completed' }))[0].text).toBe('○ Fix login finished')
    expect(alertsFor(thread(), thread({ status: 'failed' }))[0].text).toBe('■ Fix login failed')
  })
  it('says nothing for the first look, a thread seen for the first time, or no change', () => {
    expect(threadAlerts(null, snapshotOf([thread({ status: 'failed' })]), DEFAULT_ALERTS)).toEqual([])
    expect(threadAlerts(snapshotOf([]), snapshotOf([thread({ status: 'failed' })]), DEFAULT_ALERTS)).toEqual([])
    expect(alertsFor(thread(), thread())).toEqual([])
    expect(alertsFor(thread({ status: 'failed' }), thread({ status: 'failed' }))).toEqual([])
  })
  it('does not announce a thread that was already waiting, or one that finished only because it is now waiting', () => {
    expect(alertsFor(thread({ needsInput: true, status: 'waiting' }), thread({ needsInput: true, status: 'waiting' }))).toEqual([])
    expect(alertsFor(thread(), thread({ status: 'completed', needsInput: true }))[0].text).toBe('★ Fix login needs you')
  })
  it('respects each switch', () => {
    const off = { ...DEFAULT_ALERTS, needsYou: false, finished: false, failed: false }
    expect(alertsFor(thread(), thread({ status: 'waiting', needsInput: true }), off)).toEqual([])
    expect(alertsFor(thread(), thread({ status: 'completed' }), off)).toEqual([])
    expect(alertsFor(thread(), thread({ status: 'failed' }), off)).toEqual([])
  })
  it('treats a page thread finishing as the page being updated, and only if that is switched on', () => {
    expect(alertsFor(thread(), thread({ status: 'completed' }), DEFAULT_ALERTS, ['m:t1'])).toEqual([])
    const on = { ...DEFAULT_ALERTS, pageUpdated: true }
    expect(alertsFor(thread(), thread({ status: 'completed' }), on, ['m:t1'])[0].text).toBe('● Fix login updated')
  })
})

describe('warnings and summaries', () => {
  it('shows a warning once, and again after the pool recovers', () => {
    const w = [{ key: 'a', text: 'A' }, { key: 'b', text: 'B' }]
    const first = freshWarnings(w, new Set())
    expect(first.fresh.map(x => x.key)).toEqual(['a', 'b'])
    expect(freshWarnings(w, first.active).fresh).toEqual([])
    const recovered = freshWarnings([w[0]], first.active)
    expect(recovered.fresh).toEqual([])
    expect(freshWarnings(w, recovered.active).fresh.map(x => x.key)).toEqual(['b'])
  })
  it('collapses a burst into the newest alert and a count', () => {
    expect(summarize([])).toBeNull()
    expect(summarize([{ key: 'a', text: 'one' }])?.text).toBe('one')
    expect(summarize([{ key: 'a', text: 'one' }, { key: 'b', text: 'two' }, { key: 'c', text: 'three' }])?.text).toBe('three  +2')
  })
  it('is over budget at or past the budget, never when it is off or unknown', () => {
    expect([overBudget(50, 50), overBudget(49.99, 50), overBudget(900, 0), overBudget(null, 50)]).toEqual([true, false, false, false])
  })
})
