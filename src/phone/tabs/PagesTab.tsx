import { useState } from 'react'
import { Button } from 'even-toolkit/web/button'
import { Input } from 'even-toolkit/web/input'
import { Select } from 'even-toolkit/web/select'
import { Textarea } from 'even-toolkit/web/textarea'
import type { Fleet, FleetState } from '../../fleet'
import { isThreadPage, PAGE_UPDATES, PAGES, type Page, type PageUpdates } from '../../settings'
import { Row, Section, Toggle, ToggleRow, type Toast } from '../ui'

const UPDATE_OPTIONS = PAGE_UPDATES.map(u => ({ value: u.value, label: u.label }))

/** Which pages the glasses have, which one they open on, and pages made by threads. */
export function PagesTab({ fleet, state, onToast }: { fleet: Fleet; state: FleetState; onToast: (t: Toast) => void }) {
  const s = state.settings
  const [idea, setIdea] = useState('')
  const [updates, setUpdates] = useState<PageUpdates>('timer')
  const [busy, setBusy] = useState(false)
  const [adopt, setAdopt] = useState('')
  const label = (page: Page) => (isThreadPage(page) ? s.threadPages.find(p => p.id === page)?.title ?? 'Page' : PAGES.find(p => p.value === page)?.label ?? page)
  const candidates = [...state.threads, ...state.others].filter(t => !s.threadPages.some(p => p.machineId === t.machineId && p.threadId === t.id))
  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true)
    try { await work(); onToast({ text: done, ok: true }) } catch (error) { onToast({ text: error instanceof Error ? error.message : String(error), ok: false }) }
    setBusy(false)
  }
  return (
    <>
      <Section label="Pages on the glasses" note="Tap, then hold, on the glasses to switch pages. Double tap goes back to the one they open on.">
        {PAGES.map(p => <ToggleRow key={p.value} label={p.label} hint={p.hint} checked={s.pages.includes(p.value)} onChange={on => void fleet.setPageEnabled(p.value, on)} />)}
        <Row label="Open on">
          <Select value={s.startPage} options={s.pages.map(p => ({ value: p, label: label(p) }))} onValueChange={startPage => void fleet.updateSettings({ startPage: startPage as Page })} />
        </Row>
        <ToggleRow label="Answer from the dashboard" hint="Allow or deny an agent's approval right from the dashboard's “needs you” lines." checked={s.dashboardActions} onChange={dashboardActions => void fleet.updateSettings({ dashboardActions })} />
      </Section>

      {s.threadPages.length > 0 && (
        <Section label="Your pages">
          {s.threadPages.map(p => (
            <div key={p.id} className="bg-surface px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <Input value={p.title} onChange={e => void fleet.renamePage(p.id, e.target.value)} aria-label="Page name" className="min-w-0 flex-1" />
                <Toggle checked={s.pages.includes(p.id)} onChange={on => void fleet.setPageEnabled(p.id, on)} label={`Show ${p.title}`} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Select value={p.updates} options={UPDATE_OPTIONS} onValueChange={v => void fleet.setPageUpdates(p.id, v as PageUpdates)} />
                <Button size="sm" variant="ghost" onClick={() => void fleet.removePage(p.id)}>Remove</Button>
              </div>
              <p className="text-[13px] text-text-dim m-0">{state.machines.find(m => m.id === p.machineId)?.label ?? 'Unpaired machine'} · changing how it updates tells its thread</p>
            </div>
          ))}
        </Section>
      )}

      <Section label="Make a page" note="A thread builds the page and keeps it current. Change it later by holding to talk on that page, or ask for a refresh from the menu.">
        <div className="bg-surface p-3 space-y-2">
          <Textarea value={idea} onChange={e => setIdea(e.target.value)} rows={2} placeholder="My open PRs and CI status" aria-label="What the new page should show" />
          <div className="flex items-center justify-between gap-3">
            <Select value={updates} options={UPDATE_OPTIONS} onValueChange={v => setUpdates(v as PageUpdates)} />
            <Button size="sm" disabled={!idea.trim() || busy} onClick={() => void run(async () => { await fleet.makePage(idea.trim(), updates); setIdea('') }, 'Page added. Its thread is building it now.')}>Make page</Button>
          </div>
        </div>
        {candidates.length > 0 && (
          <Row label="Use a thread" hint="Turns an existing thread into a page. It gets a short note on how to write for the glasses.">
            <Select
              value={adopt}
              placeholder="Pick a thread"
              options={candidates.slice(0, 30).map(t => ({ value: `${t.machineId}\u0000${t.id}`, label: t.title }))}
              onValueChange={v => {
                setAdopt(v)
                const [machineId, threadId] = v.split('\u0000')
                void run(() => fleet.adoptPage(machineId, threadId, updates), 'Page added.').then(() => setAdopt(''))
              }}
            />
          </Row>
        )}
      </Section>
    </>
  )
}
