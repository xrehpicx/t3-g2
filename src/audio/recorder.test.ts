import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Recorder } from './recorder'

const fakeBridge = () => {
  const calls: boolean[] = []
  return { calls, bridge: { audioControl: vi.fn(async (open: boolean) => { calls.push(open); return true }) } as never }
}
const chunk = (n: number) => new Uint8Array(n).fill(1)

describe('Recorder pause/resume', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps audio across a pause and appends after resume', async () => {
    const { bridge, calls } = fakeBridge()
    const r = new Recorder(bridge, () => {})
    await r.start(0 as never)
    r.push(chunk(100))
    vi.advanceTimersByTime(2000)
    expect(await r.pause()).toBe(true)
    expect(r.paused).toBe(true)
    r.push(chunk(999)) // ignored while paused: the mic is off
    vi.advanceTimersByTime(10_000) // time spent reading notifications does not count
    expect(r.elapsedMs).toBe(2000)
    await r.start(0 as never)
    expect(r.recording).toBe(true)
    r.push(chunk(50))
    vi.advanceTimersByTime(1000)
    expect(r.elapsedMs).toBe(3000)
    const out = await r.release()
    expect(out?.pcm.byteLength).toBe(150)
    expect(calls).toEqual([true, false, true, false])
    expect(r.busy).toBe(false)
  })

  it('can send straight from paused without reopening the mic', async () => {
    const { bridge, calls } = fakeBridge()
    const r = new Recorder(bridge, () => {})
    await r.start(0 as never)
    r.push(chunk(64))
    await r.pause()
    const out = await r.release()
    expect(out?.pcm.byteLength).toBe(64)
    expect(calls).toEqual([true, false])
  })

  it('cancel throws the recording away', async () => {
    const { bridge } = fakeBridge()
    const r = new Recorder(bridge, () => {})
    await r.start(0 as never)
    r.push(chunk(64))
    await r.pause()
    await r.cancel()
    expect(r.busy).toBe(false)
    expect(await r.release()).toBeNull()
  })

  it('a pause before anything was captured just stops', async () => {
    const { bridge } = fakeBridge()
    const r = new Recorder(bridge, () => {})
    await r.start(0 as never)
    await r.pause()
    expect(r.paused).toBe(true)
    expect((await r.release())?.pcm.byteLength).toBe(0)
  })
})
