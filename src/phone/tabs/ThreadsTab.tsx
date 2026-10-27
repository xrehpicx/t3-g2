import { useState } from 'react'
import { ListItem } from 'even-toolkit/web/list-item'
import type { Fleet, FleetState } from '../../fleet'
import type { PinnedThread } from '../../t3/types'
import { Section, ThreadRow, useTick, type Toast } from '../ui'

/** Each list shows this many threads until you ask for the rest. */
const LIMIT = 5

function ThreadList({ title, empty, threads, multi, onOpen }: { title: string; empty: string; threads: PinnedThread[]; multi: boolean; onOpen: (t: PinnedThread) => void }) {
  const [all, setAll] = useState(false)
  return (
    <Section label={title}>
      {threads.length
        ? (
          <>
            {(all ? threads : threads.slice(0, LIMIT)).map(t => <ThreadRow key={`${t.machineId}:${t.id}`} thread={t} multi={multi} onOpen={() => onOpen(t)} />)}
            {threads.length > LIMIT && <ListItem title={all ? 'Show fewer' : `Show ${threads.length - LIMIT} more`} onPress={() => setAll(v => !v)} />}
          </>
        )
        : <div className="bg-surface px-4 py-4 text-[15px] text-text-dim">{empty}</div>}
    </Section>
  )
}

/** Your threads. Tap one to open it on the glasses. */
export function ThreadsTab({ fleet, state, onToast }: { fleet: Fleet; state: FleetState; onToast: (t: Toast) => void }) {
  useTick(state.threads.some(t => t.runStartedAt))
  const multi = state.machines.length > 1
  const open = async (thread: PinnedThread) => {
    const result = await fleet.openOnGlasses(thread.machineId, thread.id)
    onToast(result === 'ok'
      ? { text: `Opened “${thread.title}” on your glasses`, ok: true }
      : { text: result === 'busy' ? 'Finish what you are doing on the glasses first' : 'Open this app from the glasses to connect them', ok: false })
  }
  return (
    <>
      <ThreadList title="Pinned · tap to open on your glasses" empty="Pin a thread in T3 and it shows up here and on your glasses." threads={state.threads} multi={multi} onOpen={open} />
      <ThreadList title="Other chats" empty="No other open threads." threads={state.others} multi={multi} onOpen={open} />
    </>
  )
}
