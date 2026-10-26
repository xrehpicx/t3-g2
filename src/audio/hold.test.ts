import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SEND_DELAY, normalizeSendDelay, startSendHold } from './hold'

describe('startSendHold', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts down and then lets the send go ahead', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left), 3)
    expect(ticks).toEqual([3])
    await vi.advanceTimersByTimeAsync(3000)
    expect(ticks).toEqual([3, 2, 1])
    expect(await hold.done).toBe('sent')
  })
  it('honours other lengths', async () => {
    const hold = startSendHold(() => {}, 10)
    await vi.advanceTimersByTimeAsync(9900)
    let result: string | null = null
    void hold.done.then(v => { result = v })
    await vi.advanceTimersByTimeAsync(0)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(result).toBe('sent')
  })
  it('cancelling inside the window means nothing is sent, and stops the clock', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left), 3)
    await vi.advanceTimersByTimeAsync(1500)
    hold.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await hold.done).toBe('cancelled')
    expect(ticks).toEqual([3, 2])
  })
  it('sendNow skips the rest of the wait', async () => {
    const hold = startSendHold(() => {}, 10)
    await vi.advanceTimersByTimeAsync(1200)
    hold.sendNow()
    expect(await hold.done).toBe('sent')
  })
  it('a late cancel or skip changes nothing once it has settled', async () => {
    const hold = startSendHold(() => {}, 1)
    await vi.advanceTimersByTimeAsync(1000)
    hold.cancel()
    expect(await hold.done).toBe('sent')
    const cancelled = startSendHold(() => {}, 3)
    cancelled.cancel()
    cancelled.sendNow()
    expect(await cancelled.done).toBe('cancelled')
  })
  it('pauses while the menu is open and carries on from the same second', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left), 3)
    await vi.advanceTimersByTimeAsync(1000)
    hold.pause()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ticks).toEqual([3, 2])
    expect(hold.left).toBe(2)
    hold.resume()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await hold.done).toBe('sent')
  })
  it('does not start a second clock if resumed twice', async () => {
    const ticks: number[] = []
    const hold = startSendHold(left => ticks.push(left), 5)
    hold.resume()
    hold.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ticks).toEqual([5, 4])
    hold.cancel()
  })
})

describe('normalizeSendDelay', () => {
  it('accepts the offered choices, including off', () => {
    for (const v of [0, 1, 3, 5, 10]) expect(normalizeSendDelay(v)).toBe(v)
  })
  it('falls back to the default for anything else', () => {
    for (const v of [2, -1, 99, '3', null, undefined, NaN]) expect(normalizeSendDelay(v)).toBe(DEFAULT_SEND_DELAY)
  })
})
