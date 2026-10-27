import { useEffect, useState, useSyncExternalStore } from 'react'
import { StatusDot } from 'even-toolkit/web/status-dot'
import type { Fleet, FleetState } from '../fleet'
import { AlertsTab } from './tabs/AlertsTab'
import { DisplayTab } from './tabs/DisplayTab'
import { MachinesTab } from './tabs/MachinesTab'
import { PagesTab } from './tabs/PagesTab'
import { ThreadsTab } from './tabs/ThreadsTab'
import { VoiceTab } from './tabs/VoiceTab'
import { REPO_URL, useScrollFocusedIntoView, type Toast } from './ui'

export { REPO_URL }

const TABS = [
  { id: 'threads', label: 'Threads' },
  { id: 'pages', label: 'Pages' },
  { id: 'display', label: 'Display' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'voice', label: 'Voice' },
  { id: 'machines', label: 'Machines' },
] as const
type TabId = typeof TABS[number]['id']

const TAB_KEY = 't3g2.tab'
const readTab = (): TabId => {
  try {
    const saved = sessionStorage.getItem(TAB_KEY)
    return TABS.some(t => t.id === saved) ? (saved as TabId) : 'threads'
  } catch { return 'threads' }
}

function useFleet(fleet: Fleet): FleetState {
  return useSyncExternalStore(listener => fleet.subscribe(listener), () => fleet.state)
}

export function App({ fleet }: { fleet: Fleet }) {
  const state = useFleet(fleet)
  useScrollFocusedIntoView()

  const paired = state.machines.length > 0
  const [saved, setSaved] = useState<TabId>(readTab)
  // With nothing paired the only useful page is the one for pairing.
  const tab: TabId = paired ? saved : 'machines'
  const choose = (id: TabId) => {
    setSaved(id)
    try { sessionStorage.setItem(TAB_KEY, id) } catch { /* private mode */ }
    window.scrollTo({ top: 0 })
  }

  const [toast, setToast] = useState<Toast | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  const live = state.machines.filter(m => m.link === 'live').length
  const status = !paired ? 'Not connected' : live === state.machines.length ? 'Connected' : live ? `${live} of ${state.machines.length} connected` : 'Offline'

  return (
    <div className="min-h-screen bg-bg max-w-xl mx-auto">
      <div className="sticky top-0 z-40 bg-bg px-3 pt-4">
        <header className="flex items-center justify-between px-1">
          <h1 className="text-[24px] tracking-[-0.72px] font-normal m-0">T3 Code</h1>
          <span className="flex items-center gap-2 text-[13px] text-text-dim">
            <StatusDot connected={paired && live === state.machines.length} />
            {state.phase === 'loading' ? 'Starting…' : status}
          </span>
        </header>
        {paired && (
          <nav role="tablist" aria-label="Settings" className="mt-3 -mx-3 px-3 flex gap-3 overflow-x-auto border-b border-border [scrollbar-width:none]">
            {TABS.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => choose(t.id)}
                className={`shrink-0 pb-2 pt-1 text-[13px] border-b-2 -mb-px cursor-pointer ${tab === t.id ? 'border-accent text-text' : 'border-transparent text-text-dim'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <main className="px-3">
        {toast && (
          <div role="status" className={`fixed inset-x-3 bottom-4 z-50 mx-auto max-w-xl px-4 py-3 text-[15px] shadow-lg ${toast.ok ? 'bg-accent text-text-highlight' : 'bg-negative text-text-highlight'}`}>{toast.text}</div>
        )}
        {state.notice && <p className="mt-4 bg-negative-alpha px-4 py-3 text-[13px] text-negative">{state.notice}</p>}

        {tab === 'threads' && <ThreadsTab fleet={fleet} state={state} onToast={setToast} />}
        {tab === 'pages' && <PagesTab fleet={fleet} state={state} onToast={setToast} />}
        {tab === 'display' && <DisplayTab fleet={fleet} state={state} />}
        {tab === 'alerts' && <AlertsTab fleet={fleet} state={state} />}
        {tab === 'voice' && <VoiceTab fleet={fleet} state={state} />}
        {tab === 'machines' && <MachinesTab fleet={fleet} state={state} />}

        {/* Always-present space so the last fields can scroll up above the keyboard, and a way to help. */}
        <footer className="mt-12 pb-[60vh] px-1 text-[13px] text-text-dim">
          <p className="m-0">Open source. Help make this better:</p>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-text underline break-all">{REPO_URL.replace(/^\w+:\/\//, '')}</a>
        </footer>
      </main>
    </div>
  )
}
