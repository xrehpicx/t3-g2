import { Select } from 'even-toolkit/web/select'
import type { Fleet, FleetState } from '../../fleet'
import { CLOCKS, DENSITIES, LIST_FIELDS, type ClockFormat, type Density, type ListField } from '../../settings'
import { Row, Section, ToggleRow } from '../ui'

const toggleField = (fields: ListField[], field: ListField, on: boolean): ListField[] =>
  LIST_FIELDS.map(f => f.value).filter(v => (v === field ? on : fields.includes(v)))

/** How the glasses look: how much fits, the clock, and what the thread list shows. */
export function DisplayTab({ fleet, state }: { fleet: Fleet; state: FleetState }) {
  const s = state.settings
  return (
    <>
      <Section label="Glasses display">
        <Row label="Density" hint="The glasses use one fixed font size, so this changes how much fits instead. Compact removes the gaps between chat messages.">
          <Select value={s.density} options={DENSITIES} onValueChange={density => void fleet.updateSettings({ density: density as Density })} />
        </Row>
        <Row label="Clock" hint="The time of day at the top right of the pages and of each thread.">
          <Select value={s.clock} options={CLOCKS} onValueChange={clock => void fleet.updateSettings({ clock: clock as ClockFormat })} />
        </Row>
      </Section>
      <Section label="Beside each thread in the list" note="Shown after the title, in this order, when there is room. Following what a thread is doing keeps a live connection open for the threads on screen.">
        {LIST_FIELDS.map(f => (
          <ToggleRow key={f.value} label={f.label} hint={f.hint} checked={s.listFields.includes(f.value)} onChange={on => void fleet.updateSettings({ listFields: toggleField(s.listFields, f.value, on) })} />
        ))}
      </Section>
    </>
  )
}
