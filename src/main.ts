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
// #reset forgets every machine and the demo, for development. #defaults also puts the settings back.
if (new URLSearchParams(location.hash.slice(1)).has('reset')) {
  for (const m of fleet.state.machines) await fleet.remove(m.id)
  if (new URLSearchParams(location.hash.slice(1)).has('defaults')) await fleet.updateSettings({ ...DEFAULT_SETTINGS })
}

// Dev/QR sideload convenience: #server=…&token=… pairs without typing, then clears the hash.
const hash = new URLSearchParams(location.hash.slice(1))
const hashServer = hash.get('server')
const hashToken = hash.get('token')
if (hashServer && hashToken && !fleet.state.machines.length) {
  history.replaceState(null, '', location.pathname)
  await fleet.pair(hashServer, hashToken).catch(() => {})
}

// #demo starts demo mode (for screenshots and trying the app without a server).
// #showcase is the same with realistic names, for store screenshots.
if (hash.has('showcase') || (hash.has('demo') && !fleet.demoActive)) {
  history.replaceState(null, '', location.pathname)
  await fleet.startDemo(hash.has('showcase'))
}

// #page=<page id> opens the glasses on that page (for screenshots): pinned, chats, dashboard, usage, or thread:<machine>:<thread>.
// #permodel=off hides per-model limits (like Fable), for screenshots.
if (hash.get('permodel') === 'off') await fleet.updateSettings({ perModelLimits: false })
const startPage = hash.get('page')
if (startPage && fleet.state.settings.pages.includes(startPage as never)) await fleet.updateSettings({ startPage: startPage as never })

if (bridge) await new GlassesController(sdk, bridge, fleet, store).start()

// #open=<thread id> does what tapping that thread on the phone page does (for testing the handoff).
const openId = hash.get('open')
if (openId && bridge) setTimeout(() => void fleet.openOnGlasses(fleet.defaultMachine?.id ?? '', openId), 1500)
