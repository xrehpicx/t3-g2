import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Store } from './t3/session'

export const browserStore: Store = {
  async get(key) { try { return localStorage.getItem(key) } catch { return null } },
  async set(key, value) { try { localStorage.setItem(key, value) } catch { /* storage unavailable */ } },
  async remove(key) { try { localStorage.removeItem(key) } catch { /* storage unavailable */ } },
}

/**
 * Writes to both the Even SDK's storage and the WebView's own. Either has been reported to lose data
 * across launches (private builds get a new loopback origin each time), so reads take whichever has it.
 */
export function bridgeStore(bridge: EvenAppBridge): Store {
  return {
    async get(key) {
      const value = await bridge.getLocalStorage(key).catch(() => '')
      return value ? value : browserStore.get(key)
    },
    async set(key, value) {
      await Promise.all([bridge.setLocalStorage(key, value).catch(() => false), browserStore.set(key, value)])
    },
    async remove(key) {
      await Promise.all([bridge.setLocalStorage(key, '').catch(() => false), browserStore.remove(key)])
    },
  }
}
