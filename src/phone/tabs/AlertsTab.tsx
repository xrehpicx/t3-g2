import { Select } from 'even-toolkit/web/select'
import type { Fleet, FleetState } from '../../fleet'
import { BUDGETS, LIMIT_THRESHOLDS, type AlertSettings } from '../../settings'
import { Row, Section, ToggleRow } from '../ui'

/** Short messages across the top of the glasses, and the spend budget. Everything here can be off. */
export function AlertsTab({ fleet, state }: { fleet: Fleet; state: FleetState }) {
  const a = state.settings.alerts
  const set = (patch: Partial<AlertSettings>) => void fleet.updateSettings({ alerts: { ...a, ...patch } })
  return (
    <>
      <Section label="Tell me on the glasses when" note="A message replaces the top row for a few seconds. While it shows, tap then hold opens the menu with a way to open the thread (or the Usage page, for limits).">
        <ToggleRow label="A thread needs me" hint="It asks a question or wants an approval." checked={a.needsYou} onChange={needsYou => set({ needsYou })} />
        <ToggleRow label="A thread finishes" checked={a.finished} onChange={finished => set({ finished })} />
        <ToggleRow label="A thread fails" checked={a.failed} onChange={failed => set({ failed })} />
        <ToggleRow label="One of my pages is rewritten" checked={a.pageUpdated} onChange={pageUpdated => set({ pageUpdated })} />
      </Section>
      <Section label="Limits and spend" note="A limit warning is about the whole pool: with several accounts it fires when they are nearly all used, not each time one fills up.">
        <Row label="Warn when a limit passes">
          <Select
            value={String(a.limitPercent)}
            options={LIMIT_THRESHOLDS.map(v => ({ value: String(v), label: v === 0 ? 'Never' : `${v}% used` }))}
            onValueChange={v => set({ limitPercent: Number(v) })}
          />
        </Row>
        <Row label="Daily budget" hint="Once today's spend reaches this, the header shows it.">
          <Select
            value={String(state.settings.dailyBudget)}
            options={BUDGETS.map(v => ({ value: String(v), label: v === 0 ? 'No budget' : `$${v} a day` }))}
            onValueChange={v => void fleet.updateSettings({ dailyBudget: Number(v) })}
          />
        </Row>
      </Section>
    </>
  )
}
