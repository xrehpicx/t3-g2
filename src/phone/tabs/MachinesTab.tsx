import { useEffect, useState } from 'react'
import { Button } from 'even-toolkit/web/button'
import { ListItem } from 'even-toolkit/web/list-item'
import { StatusDot } from 'even-toolkit/web/status-dot'
import { CANDIDATE_ORIGINS } from '../../config'
import type { Fleet, FleetState, FoundMachine } from '../../fleet'
import type { DiagStep } from '../../t3/diagnose'
import { Diagnostics, PairForm, Section } from '../ui'

/** The command that makes a pairing code with every scope the app can use. Only the first two are needed. */
export const PAIR_COMMAND = 't3 auth pairing create --scope orchestration:read --scope orchestration:operate --scope diagnostics:read --scope providers:manage'

/** Paired machines, ones found nearby, and adding more. */
export function MachinesTab({ fleet, state }: { fleet: Fleet; state: FleetState }) {
  const [found, setFound] = useState<FoundMachine[]>([])
  useEffect(() => {
    if (!CANDIDATE_ORIGINS.length) return
    let live = true
    const scan = () => fleet.discover(CANDIDATE_ORIGINS).then(f => live && setFound(f))
    void scan()
    const timer = setInterval(scan, 20_000)
    return () => { live = false; clearInterval(timer) }
  }, [fleet, state.machines.length])

  const [diag, setDiag] = useState<Record<string, DiagStep[] | 'running'>>({})
  const test = (id: string) => {
    setDiag(d => ({ ...d, [id]: 'running' }))
    void fleet.diagnose(id).then(steps => setDiag(d => ({ ...d, [id]: steps })))
  }
  const [addOpen, setAddOpen] = useState(false)

  return (
    <>
      <Section
        label="Machines"
        note={<>Get a pairing code on the machine running T3: <code className="font-mono">{PAIR_COMMAND}</code>. Only the first two scopes are needed; <code className="font-mono">diagnostics:read</code> adds spend and <code className="font-mono">providers:manage</code> lets you use reset credits.{state.machines.length > 0 && ' Swipe a machine left to remove it.'}</>}
      >
        {state.machines.map(m => (
          <div key={m.id}>
            <ListItem
              title={m.label}
              subtitle={[m.host, m.link === 'live' ? 'Connected' : m.link === 'retrying' ? 'Reconnecting' : 'Connecting', m.canOperate ? '' : 'Read-only'].filter(Boolean).join(' · ')}
              leading={<StatusDot connected={m.link === 'live'} />}
              trailing={<Button size="sm" variant="secondary" onClick={() => test(m.id)}>Test</Button>}
              onDelete={() => { if (confirm(`Disconnect ${m.label}?`)) return fleet.remove(m.id) }}
            />
            {diag[m.id] && <Diagnostics steps={diag[m.id]} />}
          </div>
        ))}
        {found.map(f => <PairForm key={f.origin} fleet={fleet} origin={f.origin} label={`${f.label} found nearby`} />)}
        {(addOpen || (!state.machines.length && !found.length))
          ? <PairForm fleet={fleet} />
          : <ListItem title="Add a machine by address" onPress={() => setAddOpen(true)} />}
        {!fleet.demoActive && <ListItem title="Try the demo" subtitle="Sample threads, no server needed" onPress={() => void fleet.startDemo()} />}
      </Section>
    </>
  )
}
