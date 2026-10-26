import { describe, expect, it } from 'vitest'
import { Fleet } from './fleet'
import type { Store } from './t3/session'

const memory = (): Store => {
  const data = new Map<string, string>()
  return { get: async k => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async k => void data.delete(k) }
}
const net = { fetch: () => { throw new Error('no network') }, WebSocket: class {}, inEven: false } as never

describe('Fleet.openOnGlasses', () => {
  it('says so when no glasses are connected', async () => {
    const fleet = new Fleet(net, memory(), 'test')
    expect(await fleet.openOnGlasses('demo', 'd1')).toBe('no-glasses')
  })
  it('hands the thread to the glasses', async () => {
    const fleet = new Fleet(net, memory(), 'test')
    const seen: Array<[string, string]> = []
    fleet.setOpenHandler((machineId, threadId) => { seen.push([machineId, threadId]); return true })
    expect(await fleet.openOnGlasses('demo', 'd1')).toBe('ok')
    expect(seen).toEqual([['demo', 'd1']])
  })
  it('reports busy when the glasses are mid-recording', async () => {
    const fleet = new Fleet(net, memory(), 'test')
    fleet.setOpenHandler(async () => false)
    expect(await fleet.openOnGlasses('demo', 'd1')).toBe('busy')
  })
  it('stops handing threads over once the glasses disconnect', async () => {
    const fleet = new Fleet(net, memory(), 'test')
    fleet.setOpenHandler(() => true)
    fleet.setOpenHandler(null)
    expect(await fleet.openOnGlasses('demo', 'd1')).toBe('no-glasses')
  })
})
