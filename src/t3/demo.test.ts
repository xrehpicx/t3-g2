import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../settings'
import type { ThreadLive } from './activity'
import { DemoMachine } from './demo'

const net = { fetch: () => { throw new Error('demo must not touch the network') }, WebSocket: class {}, inEven: false } as never

describe('DemoMachine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows pinned threads, one running and one waiting on you, without any network', () => {
    const demo = new DemoMachine(net, () => {})
    demo.start()
    const pinned = demo.pinned()
    expect(pinned.length).toBeGreaterThanOrEqual(3)
    expect(pinned.some(t => t.status === 'running' && t.runStartedAt)).toBe(true)
    expect(pinned.some(t => t.needsInput)).toBe(true)
    expect(demo.link).toBe('live')
    demo.stop()
  })

  it('reports changing activity on the running thread', async () => {
    const demo = new DemoMachine(net, () => {})
    demo.start()
    const seen: string[] = []
    demo.openThread('d1', live => { if (live.steps[0]) seen.push(live.steps[0].label) })
    await vi.advanceTimersByTimeAsync(8_000)
    expect(new Set(seen).size).toBeGreaterThan(1)
    demo.stop()
  })

  it('answers a voice message with a reply that streams in and then completes', async () => {
    const demo = new DemoMachine(net, () => {})
    demo.start()
    let last: ThreadLive | null = null
    demo.openThread('d3', live => { last = live })
    await demo.sendVoice({ id: 'd3' })
    expect(demo.thread('d3')?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(10_000)
    const messages = (last as unknown as ThreadLive).messages
    expect(messages.at(-2)?.text).toBe('(voice message)')
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', streaming: false })
    expect(messages.at(-1)?.text).toContain('demo mode')
    expect(demo.thread('d3')?.status).toBe('completed')
    demo.stop()
  })

  it('starts a new thread that the feed can find', async () => {
    const demo = new DemoMachine(net, () => {})
    demo.start()
    const id = await demo.launch({ settings: DEFAULT_SETTINGS, title: 'Glasses test', text: 'x' })
    expect(demo.thread(id)?.title).toBe('Glasses test')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(demo.thread(id)?.status).toBe('completed')
    demo.stop()
  })
})
