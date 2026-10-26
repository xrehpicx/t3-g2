import { describe, expect, it } from 'vitest'
import { applyShellItem, fromSnapshot, wasOpened } from './shellStore'
import type { ThreadShell } from './types'

const thread = (id: string, over: Partial<ThreadShell> = {}): ThreadShell => ({
  id, projectId: 'p', title: id, status: 'idle', createdAt: '', updatedAt: '', archivedAt: null, deletedAt: null,
  pendingRuntimeRequest: null, lineage: {}, ...over,
})

describe('shell store', () => {
  const start = fromSnapshot({ threads: [thread('a'), thread('b')], projects: [{ id: 'p', title: 'App' }], snapshotSequence: 10 } as never)

  it('loads a snapshot', () => {
    expect(start.threads.size).toBe(2)
    expect(start.sequence).toBe(10)
  })
  it('replaces a thread when it updates and tracks the sequence', () => {
    const next = applyShellItem(start, { kind: 'thread.updated', sequence: 11, location: 'active', thread: thread('a', { status: 'running' }) })
    expect(next.threads.get('a')?.status).toBe('running')
    expect(next.sequence).toBe(11)
    expect(start.threads.get('a')?.status).toBe('idle')
  })
  it('adds threads it has not seen', () => {
    const next = applyShellItem(start, { kind: 'thread.updated', sequence: 12, location: 'active', thread: thread('c') })
    expect(next.threads.size).toBe(3)
  })
  it('drops archived and removed threads', () => {
    const archived = applyShellItem(start, { kind: 'thread.updated', sequence: 12, location: 'archive', thread: thread('a') })
    expect(archived.threads.has('a')).toBe(false)
    const removed = applyShellItem(start, { kind: 'thread.removed', sequence: 13, location: 'active', threadId: 'b' })
    expect([...removed.threads.keys()]).toEqual(['a'])
  })
  it('returns the same state for removals it cannot match and unknown items', () => {
    expect(applyShellItem(start, { kind: 'thread.removed', threadId: 'zzz' })).toBe(start)
    expect(applyShellItem(start, { kind: 'synchronized' })).toBe(start)
  })
  it('merges later snapshot batches instead of replacing (the server streams partial ones)', () => {
    const batch = { threads: [], projects: [{ id: 'q', title: 'Extra' }], snapshotSequence: 99 } as never
    const next = applyShellItem(start, { kind: 'snapshot', snapshot: batch })
    expect([...next.threads.keys()]).toEqual(['a', 'b'])
    expect([...next.projects.keys()].sort()).toEqual(['p', 'q'])
    expect(next.sequence).toBe(99)
  })
  it('upserts threads carried by a later batch', () => {
    const next = applyShellItem(start, { kind: 'snapshot', snapshot: { threads: [thread('a', { status: 'running' }), thread('n')], projects: [], snapshotSequence: 11 } as never })
    expect(next.threads.get('a')?.status).toBe('running')
    expect(next.threads.has('n')).toBe(true)
  })
})

describe('wasOpened', () => {
  const at = (openedAt?: number) => thread('a', openedAt === undefined ? {} : { opens: { openedAt } })
  it('is true only when openedAt moves forward', () => {
    expect(wasOpened(at(100), at(200))).toBe(true)
    expect(wasOpened(at(200), at(200))).toBe(false)
    expect(wasOpened(at(200), at(100))).toBe(false)
  })
  it('ignores threads that are new to us or have never been opened', () => {
    expect(wasOpened(undefined, at(200))).toBe(false)
    expect(wasOpened(at(undefined), at(200))).toBe(false)
    expect(wasOpened(at(100), at(undefined))).toBe(false)
  })
  it('is not triggered by background activity that only touches lastVisitedAt', () => {
    const before = { ...at(100), lastVisitedAt: '2026-01-01T00:00:00Z' }
    const after = { ...at(100), lastVisitedAt: '2026-01-01T00:05:00Z' }
    expect(wasOpened(before, after)).toBe(false)
  })
})
