import { readBootHash } from './boot'
import { DEFAULT_SETTINGS } from './settings'
import './phone/theme.css'
import { resolveNet } from './net'

// Capture the browser transports before the SDK replaces them.
const net = resolveNet()
const sdk = await import('@evenrealities/even_hub_sdk')
const { Fleet } = await import('./fleet')
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { App } = await import('./phone/App')
const { bridgeStore, browserStore } = await import('./store')
const { GlassesController } = await import('./glasses/controller')

const root = document.querySelector<HTMLElement>('#app')!

// The bridge only resolves inside the Even app or simulator; fall back to the browser for plain dev.
const bridge = await Promise.race([
  sdk.waitForEvenAppBridge().catch(() => null),
  new Promise<null>(resolve => setTimeout(() => resolve(null), 2500)),
])
const store = bridge ? bridgeStore(bridge) : browserStore
const fleet = new Fleet(net, store, 'T3 Code G2')

createRoot(root).render(createElement(App, { fleet }))
await fleet.init()
// Dev-server only. A packed build ignores the hash, so a link cannot reset or re-pair the phone.
const boot = readBootHash(location.hash, import.meta.env.DEV)
if (boot.reset) {
  for (const m of fleet.state.machines) await fleet.remove(m.id)
  if (boot.defaults) await fleet.updateSettings({ ...DEFAULT_SETTINGS })
}
if (boot.pair && !fleet.state.machines.length) {
  history.replaceState(null, '', location.pathname)
  await fleet.pair(boot.pair.server, boot.pair.token).catch(() => {})
}
if (boot.showcase || (boot.demo && !fleet.demoActive)) {
  history.replaceState(null, '', location.pathname)
  await fleet.startDemo(boot.showcase)
}
if (boot.perModelOff) await fleet.updateSettings({ perModelLimits: false })
if (boot.startPage && fleet.state.settings.pages.includes(boot.startPage as never)) {
  await fleet.updateSettings({ startPage: boot.startPage as never })
}

if (bridge) await new GlassesController(sdk, bridge, fleet, store).start()

if (boot.openId && bridge) setTimeout(() => void fleet.openOnGlasses(fleet.defaultMachine?.id ?? '', boot.openId!), 1500)
