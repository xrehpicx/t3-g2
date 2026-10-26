import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from 'even-toolkit/web/button'
import { Input } from 'even-toolkit/web/input'
import { ListItem } from 'even-toolkit/web/list-item'
import { Select } from 'even-toolkit/web/select'
import { SettingsGroup } from 'even-toolkit/web/settings-group'
import { StatusDot } from 'even-toolkit/web/status-dot'
import { Textarea } from 'even-toolkit/web/textarea'
import { CANDIDATE_ORIGINS, DEFAULT_SERVER } from '../config'
import type { Fleet, FleetState, FoundMachine } from '../fleet'
import { clock, markFor, MARK } from '../glasses/screens'
import { DEFAULT_SETTINGS, RUNTIME_MODES, type RuntimeMode } from '../settings'
import type { DiagStep } from '../t3/diagnose'
import { SCRATCH } from '../t3/launch'
import type { ServerConfig } from '../t3/serverConfig'
import type { PinnedThread } from '../t3/types'

function useFleet(fleet: Fleet): FleetState {
  return useSyncExternalStore(listener => fleet.subscribe(listener), () => fleet.state)
}

/** Re-renders every second while something on screen is counting. */
function useTick(active: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [active])
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const MARK_LABEL = { run: 'Running', ask: 'Needs you', new: 'New reply', done: 'Done', idle: 'Idle', fail: 'Failed', stop: 'Stopped' } as const

function Section({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-6">
      <SettingsGroup label={label}>
        {children}
      </SettingsGroup>
      {action && <div className="mt-2 flex justify-end">{action}</div>}
    </section>
  )
}

/** A settings row: label on the left, control on the right, like the Even app. */
function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
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

function ThreadRow({ thread, multi, onOpen }: { thread: PinnedThread; multi: boolean; onOpen: () => void }) {
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

function Diagnostics({ steps }: { steps: DiagStep[] | 'running' }) {
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

function PairForm({ fleet, origin, label }: { fleet: Fleet; origin?: string; label?: string }) {
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
        <Input value={host} onChange={e => setHost(e.target.value)} placeholder="https://machine.your-tailnet.ts.net" inputMode="url" autoCapitalize="off" spellCheck={false} aria-label="Server address or pairing link" />
      )}
      <div className="flex gap-2">
        <Input className="flex-1" value={code} onChange={e => setCode(e.target.value)} placeholder="Pairing code" autoCapitalize="off" spellCheck={false} aria-label="Pairing code" />
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button>
      </div>
      {error && <p className="text-[13px] text-negative">{error}</p>}
    </form>
  )
}

export function App({ fleet }: { fleet: Fleet }) {
  const state = useFleet(fleet)
  const machine = fleet.defaultMachine
  const multi = state.machines.length > 1
  useTick(state.threads.some(t => t.runStartedAt))

  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [configError, setConfigError] = useState('')
  useEffect(() => {
    setConfig(null)
    setConfigError('')
    if (!machine) return
    let live = true
    machine.config().then(c => live && setConfig(c), e => live && setConfigError(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [machine?.id])

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

  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])
  const openOnGlasses = async (thread: PinnedThread) => {
    const result = await fleet.openOnGlasses(thread.machineId, thread.id)
    setToast(result === 'ok'
      ? { text: `Opened “${thread.title}” on your glasses`, ok: true }
      : { text: result === 'busy' ? 'Finish what you are doing on the glasses first' : 'Open this app from the glasses to connect them', ok: false })
  }

  const s = state.settings
  const [voice, setVoice] = useState(s.voicePrompt)
  useEffect(() => setVoice(s.voicePrompt), [s.voicePrompt])
  useEffect(() => {
    if (voice === s.voicePrompt) return
    const timer = setTimeout(() => void fleet.updateSettings({ voicePrompt: voice }), 500)
    return () => clearTimeout(timer)
  }, [voice])

  const projectOptions = useMemo(() => [
    { value: SCRATCH, label: 'No project' },
    ...(machine?.projects() ?? []).map(p => ({ value: p.id, label: p.title })),
  ], [machine, state])
  const modelOptions = useMemo(() => [
    { value: '', label: config?.defaultModel ? `Default (${config.defaultModel.model})` : 'Server default' },
    ...(config?.models ?? []).map(m => ({ value: `${m.instanceId}\u0000${m.slug}`, label: `${m.name} · ${m.provider}` })),
  ], [config])

  const live = state.machines.filter(m => m.link === 'live').length
  const status = !state.machines.length ? 'Not connected' : live === state.machines.length ? 'Connected' : live ? `${live} of ${state.machines.length} connected` : 'Offline'
  const readOnly = state.machines.find(m => m.id === machine?.id && !m.canOperate)

  return (
    <div className="min-h-screen bg-bg px-3 pt-4 pb-12 max-w-xl mx-auto">
      <header className="flex items-center justify-between px-1">
        <h1 className="text-[24px] tracking-[-0.72px] font-normal m-0">T3 Code</h1>
        <span className="flex items-center gap-2 text-[13px] text-text-dim">
          <StatusDot connected={state.machines.length > 0 && live === state.machines.length} />
          {state.phase === 'loading' ? 'Starting…' : status}
        </span>
      </header>

      {toast && (
        <div role="status" className={`fixed inset-x-3 bottom-4 z-50 mx-auto max-w-xl rounded-[6px] px-4 py-3 text-[15px] shadow-lg ${toast.ok ? 'bg-accent text-text-highlight' : 'bg-negative text-text-highlight'}`}>{toast.text}</div>
      )}

      {state.notice && <p className="mt-4 rounded-[6px] bg-negative-alpha px-4 py-3 text-[13px] text-negative">{state.notice}</p>}

      {state.machines.length > 0 && (
        <Section label="Pinned threads · tap to open on your glasses">
          {state.threads.length
            ? state.threads.map(t => <ThreadRow key={`${t.machineId}:${t.id}`} thread={t} multi={multi} onOpen={() => void openOnGlasses(t)} />)
            : <div className="bg-surface px-4 py-4 text-[15px] text-text-dim">Pin a thread in T3 and it shows up here and on your glasses.</div>}
        </Section>
      )}

      {machine && (
        <Section label="New threads from the glasses">
          {multi && (
            <Row label="Machine">
              <Select value={machine.id} options={state.machines.map(m => ({ value: m.id, label: m.label }))} onValueChange={id => void fleet.setDefaultMachine(id)} />
            </Row>
          )}
          <Row label="Project">
            <Select value={s.projectId} options={projectOptions} onValueChange={projectId => void fleet.updateSettings({ projectId })} />
          </Row>
          <Row label="Model" hint={configError ? `Couldn't load models: ${configError}` : undefined}>
            <Select
              value={s.model ? `${s.instanceId}\u0000${s.model}` : ''}
              options={modelOptions}
              disabled={!config}
              onValueChange={value => {
                const [instanceId = '', model = ''] = value.split('\u0000')
                void fleet.updateSettings({ instanceId, model })
              }}
            />
          </Row>
          <Row label="Permissions">
            <Select value={s.runtimeMode} options={RUNTIME_MODES} onValueChange={runtimeMode => void fleet.updateSettings({ runtimeMode: runtimeMode as RuntimeMode })} />
          </Row>
          {readOnly && <div className="bg-surface px-4 py-3 text-[13px] text-negative">This machine is paired read-only, so the glasses can watch but not send. Pair it again with operate access.</div>}
        </Section>
      )}

      {machine && (
        <Section
          label="Sent with every voice message"
          action={voice !== DEFAULT_SETTINGS.voicePrompt && <Button size="sm" variant="ghost" onClick={() => setVoice(DEFAULT_SETTINGS.voicePrompt)}>Reset to default</Button>}
        >
          <div className="bg-surface p-3">
            <Textarea value={voice} onChange={e => setVoice(e.target.value)} rows={4} spellCheck={false} aria-label="Instructions sent with voice messages" />
          </div>
        </Section>
      )}

      <Section label="Machines">
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
      <p className="mt-3 px-1 text-[13px] text-text-dim">
        Get a pairing code on the machine running T3: <code className="font-mono">t3 auth pairing create --scope orchestration:read --scope orchestration:operate</code>
        {state.machines.length > 0 && ' · Swipe a machine left to remove it.'}
      </p>
    </div>
  )
}
