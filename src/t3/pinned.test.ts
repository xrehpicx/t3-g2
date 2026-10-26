import { describe, expect, it } from 'vitest'
import { pinnedThreads } from './pinned'
import type { ShellSnapshot, ThreadShell } from './types'

const t = (id: string, over: Partial<ThreadShell> = {}): ThreadShell => ({
  id, projectId: 'p1', title: id, status: 'idle', pinnedAt: '2026-01-01T00:00:00Z', pinOrderKey: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '', archivedAt: null, deletedAt: null,
  pendingRuntimeRequest: null, lineage: { relationshipToParent: null }, ...over,
})
const snap = (threads: ThreadShell[]): ShellSnapshot => ({ threads, projects: [{ id: 'p1', title: 'App' }] })

describe('pinnedThreads', () => {
  it('keeps only pinned, live, top-level threads', () => {
    const out = pinnedThreads(snap([
      t('a'), t('unpinned', { pinnedAt: null }), t('sub', { lineage: { relationshipToParent: 'subagent' } }),
      t('arch', { archivedAt: 'x' }), t('settled', { settledOverride: 'settled' }), t('active', { settledOverride: 'active' }), t('del', { deletedAt: 'x' }), t('fork', { lineage: { relationshipToParent: 'fork' } }),
    ]))
    expect(out.map(x => x.id)).toEqual(['a', 'active', 'fork'])
  })
  it('orders keyed pins by key, then keyless newest-first', () => {
    const out = pinnedThreads(snap([
      t('old', { createdAt: '2026-01-01T00:00:00Z' }),
      t('new', { createdAt: '2026-03-01T00:00:00Z' }),
      t('k2', { pinOrderKey: 'b' }),
      t('k1', { pinOrderKey: 'a' }),
    ]))
    expect(out.map(x => x.id)).toEqual(['k1', 'k2', 'new', 'old'])
  })
  it('resolves project names and input requests', () => {
    const [one] = pinnedThreads(snap([t('a', { pendingRuntimeRequest: { kind: 'approval' } })]))
    expect(one).toMatchObject({ project: 'App', needsInput: true })
  })
})

describe('effective status', () => {
  it('shows a thread as running after a steer, even though the old run reads cancelled', () => {
    const [one] = pinnedThreads(snap([t('a', { status: 'cancelled', activityRunStatus: 'running', activityRunStartedAt: '2026-01-01T00:00:00Z' })]))
    expect(one.status).toBe('running')
    expect(one.runStartedAt).toBe('2026-01-01T00:00:00Z')
  })
  it('falls back to the thread status when nothing is live', () => {
    const [one] = pinnedThreads(snap([t('a', { status: 'completed', activityRunStatus: null })]))
    expect(one.status).toBe('completed')
    expect(one.runStartedAt).toBeNull()
  })
})

describe('snoozed', () => {
  it('hides a pinned thread while its snooze is in the future, and shows it once it ends', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    const out = pinnedThreads(snap([t('snoozed', { snoozedUntil: future }), t('woke', { snoozedUntil: past }), t('plain')]))
    expect(out.map(x => x.id).sort()).toEqual(['plain', 'woke'])
  })
})
