import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSendHold } from './hold'

describe('startSendHold', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts 3, 2, 1 and then lets the send go ahead', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left))
    expect(ticks).toEqual([3])
    await vi.advanceTimersByTimeAsync(3000)
    expect(ticks).toEqual([3, 2, 1])
    expect(await hold.done).toBe(true)
  })
  it('does not send before the full three seconds have passed', async () => {
    let result: boolean | null = null
    const hold = startSendHold(() => {})
    void hold.done.then(v => { result = v })
    await vi.advanceTimersByTimeAsync(2900)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(result).toBe(true)
  })
  it('cancelling inside the window means nothing is sent', async () => {
    const hold = startSendHold(() => {})
    await vi.advanceTimersByTimeAsync(1500)
    hold.cancel()
    expect(await hold.done).toBe(false)
  })
  it('stays cancelled and stops ticking', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left))
    hold.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await hold.done).toBe(false)
    expect(ticks).toEqual([3])
  })
  it('ignores a cancel that arrives after it already sent', async () => {
    const hold = startSendHold(() => {})
    await vi.advanceTimersByTimeAsync(3000)
    hold.cancel()
    expect(await hold.done).toBe(true)
  })
})
