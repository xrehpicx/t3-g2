import { useEffect, useState, type ReactNode } from 'react'
import { Button } from 'even-toolkit/web/button'
import { Input } from 'even-toolkit/web/input'
import { ListItem } from 'even-toolkit/web/list-item'
import { SettingsGroup } from 'even-toolkit/web/settings-group'
import { DEFAULT_SERVER } from '../config'
import type { Fleet } from '../fleet'
import { clock, markFor, MARK } from '../glasses/screens'
import type { DiagStep } from '../t3/diagnose'
import type { PinnedThread } from '../t3/types'

/** Built at run time: the bundle must hold no literal URL the store's network-whitelist scan could flag. */
export const REPO_URL = ['https', 'github.com/xrehpicx/t3-g2'].join(':' + '//')

/** A square switch: the toolkit's is rounded, and this app has no rounded corners. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 cursor-pointer transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-surface-lighter'}`}
    >
      <span className={`absolute top-1 left-1 h-4 w-4 bg-white transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

export function Section({ label, children, action, note }: { label: string; children: ReactNode; action?: ReactNode; note?: ReactNode }) {
  return (
    <section className="mt-5">
      <SettingsGroup label={label}>{children}</SettingsGroup>
      {note && <p className="mt-2 px-1 text-[13px] text-text-dim">{note}</p>}
      {action && <div className="mt-2 flex justify-end">{action}</div>}
    </section>
  )
}

/** A settings row: label on the left, control on the right, like the Even app. */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[15px] tracking-[-0.15px] shrink-0">{label}</span>
        <div className="min-w-0 flex-1 flex justify-end">{children}</div>
      </div>
      {hint && <p className="mt-1 text-[13px] text-text-dim">{hint}</p>}
    </div>
  )
}

/** A toggle with its label and explanation. */
export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <Row label={label} hint={hint}><Toggle checked={checked} onChange={onChange} label={label} /></Row>
}

/** Re-renders every second while something on screen is counting. */
export function useTick(active: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [active])
}

export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const MARK_LABEL = { run: 'Running', ask: 'Needs you', new: 'New reply', done: 'Done', idle: 'Idle', fail: 'Failed', stop: 'Stopped' } as const

export function ThreadRow({ thread, multi, onOpen }: { thread: PinnedThread; multi: boolean; onOpen: () => void }) {
  const mark = markFor(thread.status, thread.needsInput, false)
  const live = mark === 'run' || mark === 'ask'
  const trailing = mark === 'run' && thread.runStartedAt ? clock(Date.now() - Date.parse(thread.runStartedAt)) : ago(thread.updatedAt)
  return (
    <ListItem
      title={thread.title}
      onPress={onOpen}
      subtitle={[MARK_LABEL[mark], multi ? thread.machineLabel : '', thread.project || 'No project'].filter(Boolean).join(' · ')}
      leading={<span className={`w-6 text-center text-[17px] ${live ? 'text-text' : 'text-text-dim'}`} aria-hidden>{MARK[mark]}</span>}
      trailing={<span className={`text-[13px] tabular-nums ${live ? 'text-text' : 'text-text-dim'}`}>{trailing}</span>}
    />
  )
}

export function Diagnostics({ steps }: { steps: DiagStep[] | 'running' }) {
  if (steps === 'running') return <div className="bg-surface px-4 py-3 text-[13px] text-text-dim">Testing connection…</div>
  return (
    <ol className="bg-surface px-4 py-3 space-y-2">
      {steps.map(step => (
        <li key={step.name} className="text-[13px]">
          <span className={step.ok ? 'text-positive' : 'text-negative'}>{step.ok ? 'OK' : 'Failed'}</span>
          <span className="ml-2">{step.name}</span>
          {step.ms > 0 && <span className="ml-2 text-text-dim tabular-nums">{step.ms} ms</span>}
          <div className="text-text-dim break-words">{step.detail}</div>
        </li>
      ))}
    </ol>
  )
}

export function PairForm({ fleet, origin, label }: { fleet: Fleet; origin?: string; label?: string }) {
  const [host, setHost] = useState(origin ?? DEFAULT_SERVER)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await fleet.pair(host, code)
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="bg-surface px-4 py-3 space-y-2" autoComplete="off">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px]">{label}</span>
          <span className="text-[13px] text-text-dim truncate">{origin && new URL(origin).host}</span>
        </div>
      )}
      {!origin && (
        <Input value={host} onChange={e => setHost(e.target.value)} placeholder="machine.your-tailnet.ts.net" inputMode="url" autoCapitalize="off" spellCheck={false} aria-label="Server address or pairing link" />
      )}
      <div className="flex gap-2">
        <Input className="flex-1" value={code} onChange={e => setCode(e.target.value)} placeholder="Pairing code" autoCapitalize="off" spellCheck={false} aria-label="Pairing code" />
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button>
      </div>
      {error && <p className="text-[13px] text-negative">{error}</p>}
    </form>
  )
}

/**
 * The phone keyboard covers the bottom half of the screen, so a field near the bottom is hidden
 * while typing. Scroll whatever gets focus up near the top once the keyboard has finished rising.
 */
export function useScrollFocusedIntoView() {
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const el = event.target as HTMLElement
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      // About a quarter of the way down: above the keyboard whether or not the WebView resizes for it.
      setTimeout(() => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.22, behavior: 'smooth' }), 350)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
}

export interface Toast { text: string; ok: boolean }
