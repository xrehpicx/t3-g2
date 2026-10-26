import { describe, expect, it } from 'vitest'
import { applyEvent, currentStep, emptyLive, fromSnapshot, labelFor, type TurnItem } from './activity'
import type { ThreadMessage } from './types'

const item = (over: Partial<TurnItem> & { id: string; type: string }): TurnItem => ({ status: 'running', ordinal: 1, ...over })
const message = (id: string, role: string, text: string, at = '2026-01-01T00:00:00Z', streaming = false): ThreadMessage =>
  ({ id, role, text, streaming, createdAt: at })
const event = (type: string, payload: unknown, sequence = 1) => ({ kind: 'event', sequence, event: { type, payload } })

describe('labelFor', () => {
  it('describes shell commands on one line', () => {
    expect(labelFor(item({ id: 'a', type: 'command_execution', input: 'npm test\n  --run' }))).toBe('$ npm test --run')
  })
  it('shows only the file name for edits', () => {
    expect(labelFor(item({ id: 'a', type: 'file_change', fileName: '/x/y/layout.ts' }))).toBe('edit layout.ts')
  })
  it('pulls the useful argument out of tool input', () => {
    expect(labelFor(item({ id: 'a', type: 'dynamic_tool', toolName: 'Read', input: { file_path: '/a/b/c.ts' } }))).toBe('Read c.ts')
    expect(labelFor(item({ id: 'a', type: 'dynamic_tool', toolName: 'Grep', input: { pattern: 'foo' } }))).toBe('Grep foo')
    expect(labelFor(item({ id: 'a', type: 'dynamic_tool', toolName: null, input: {} }))).toBe('tool')
  })
  it('labels reasoning, streaming replies and approvals', () => {
    expect(labelFor(item({ id: 'a', type: 'reasoning' }))).toBe('thinking')
    expect(labelFor(item({ id: 'a', type: 'assistant_message', streaming: true }))).toBe('writing reply')
    expect(labelFor(item({ id: 'a', type: 'assistant_message', streaming: false }))).toBeNull()
    expect(labelFor(item({ id: 'a', type: 'approval_request' }))).toBe('needs your approval')
  })
  it('follows the active plan step', () => {
    const steps = [{ text: 'one', status: 'completed' }, { text: 'two', status: 'running' }]
    expect(labelFor(item({ id: 'a', type: 'todo_list', steps }))).toBe('plan: two')
  })
  it('ignores items that are not activity', () => {
    expect(labelFor(item({ id: 'a', type: 'checkpoint' }))).toBeNull()
  })
})

describe('applyEvent', () => {
  it('upserts messages and keeps them in time order', () => {
    let live = emptyLive()
    live = applyEvent(live, event('message.updated', message('b', 'assistant', 'later', '2026-01-01T00:00:02Z')))
    live = applyEvent(live, event('message.updated', message('a', 'user', 'first', '2026-01-01T00:00:01Z'), 2))
    expect(live.messages.map(m => m.id)).toEqual(['a', 'b'])
  })
  it('replaces a streaming message in place as it grows', () => {
    let live = applyEvent(emptyLive(), event('message.updated', message('a', 'assistant', 'He', undefined, true)))
    live = applyEvent(live, event('message.updated', message('a', 'assistant', 'Hello there', undefined, false), 2))
    expect(live.messages).toHaveLength(1)
    expect(live.messages[0]).toMatchObject({ text: 'Hello there', streaming: false })
  })
  it('tracks a step from running to done without moving it', () => {
    let live = applyEvent(emptyLive(), event('turn-item.updated', item({ id: 's', type: 'command_execution', input: 'ls', ordinal: 5 })))
    expect(currentStep(live)).toMatchObject({ label: '$ ls', status: 'running' })
    live = applyEvent(live, event('turn-item.updated', item({ id: 's', type: 'command_execution', input: 'ls', status: 'completed', ordinal: 9 }), 2))
    expect(currentStep(live)).toBeNull()
    expect(live.steps).toEqual([{ id: 's', label: '$ ls', status: 'done', ordinal: 5 }])
  })
  it('marks failures', () => {
    const live = applyEvent(emptyLive(), event('turn-item.updated', item({ id: 's', type: 'command_execution', input: 'x', status: 'completed', exitCode: 1 })))
    expect(live.steps[0]?.status).toBe('failed')
  })
  it('only advances the cursor for unrelated events and non-events', () => {
    const live = applyEvent(emptyLive(), event('thread.visited', {}, 42))
    expect(live).toMatchObject({ sequence: 42, messages: [], steps: [] })
    expect(applyEvent(live, { kind: 'synchronized' })).toBe(live)
  })
  it('never moves the cursor backwards', () => {
    const live = applyEvent({ ...emptyLive(), sequence: 50 }, event('thread.visited', {}, 10))
    expect(live.sequence).toBe(50)
  })
})

describe('snapshot and trail', () => {
  const live = fromSnapshot({
    snapshotSequence: 7,
    projection: {
      messages: [message('a', 'user', 'hi')],
      visibleTurnItems: [
        { item: item({ id: '1', type: 'file_change', fileName: 'a.ts', status: 'completed', ordinal: 1 }) },
        { item: item({ id: '2', type: 'dynamic_tool', toolName: 'Read', input: { path: '/x/b.ts' }, status: 'completed', ordinal: 2 }) },
        { item: item({ id: '3', type: 'command_execution', input: 'npm test', ordinal: 3 }) },
        { item: item({ id: '4', type: 'checkpoint', status: 'completed', ordinal: 4 }) },
      ],
    },
  })
  it('seeds the resume cursor and messages', () => {
    expect(live.sequence).toBe(7)
    expect(live.messages).toHaveLength(1)
  })
  it('finds what is running now', () => {
    expect(currentStep(live)?.label).toBe('$ npm test')
  })
})
