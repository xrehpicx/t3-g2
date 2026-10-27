import { useEffect, useMemo, useState } from 'react'
import { Button } from 'even-toolkit/web/button'
import { Input } from 'even-toolkit/web/input'
import { Select } from 'even-toolkit/web/select'
import { Textarea } from 'even-toolkit/web/textarea'
import { SEND_DELAYS } from '../../audio/hold'
import type { Fleet, FleetState } from '../../fleet'
import { DEFAULT_QUICK_REPLIES, DEFAULT_SETTINGS, MAX_QUICK_REPLIES, MAX_QUICK_REPLY, REPLY_FIT, RUNTIME_MODES, type RuntimeMode } from '../../settings'
import { SCRATCH } from '../../t3/launch'
import type { ServerConfig } from '../../t3/serverConfig'
import { Row, Section } from '../ui'

/** The canned replies offered in the thread menu on the glasses. Saved a moment after you stop typing. */
function QuickReplies({ fleet, saved }: { fleet: Fleet; saved: string[] }) {
  const [items, setItems] = useState(saved)
  useEffect(() => setItems(saved), [saved.join('\u0000')])
  useEffect(() => {
    const cleaned = items.map(i => i.trim()).filter(Boolean)
    if (cleaned.join('\u0000') === saved.join('\u0000')) return
    const timer = setTimeout(() => void fleet.updateSettings({ quickReplies: cleaned }), 600)
    return () => clearTimeout(timer)
  }, [items])
  const change = (at: number, text: string) => setItems(list => list.map((x, i) => (i === at ? text : x)))
  return (
    <Section
      label="Quick replies"
      note={`In a thread on the glasses, tap then hold opens the menu: pick one and it is sent as a message. Up to ${MAX_QUICK_REPLIES}, short enough for the menu. Empty hides them.`}
      action={items.join() !== DEFAULT_QUICK_REPLIES.join() && <Button size="sm" variant="ghost" onClick={() => setItems([...DEFAULT_QUICK_REPLIES])}>Reset to default</Button>}
    >
      {items.map((text, i) => (
        <div key={i} className="bg-surface px-4 py-2 flex items-center gap-3">
          <Input value={text} maxLength={MAX_QUICK_REPLY} onChange={e => change(i, e.target.value)} aria-label={`Quick reply ${i + 1}`} className="min-w-0 flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setItems(list => list.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      {items.length < MAX_QUICK_REPLIES && (
        <div className="bg-surface px-4 py-2 flex justify-end"><Button size="sm" variant="secondary" onClick={() => setItems(list => [...list, ''])}>Add a reply</Button></div>
      )}
    </Section>
  )
}

/** Talking to threads: how voice messages go out, the canned replies, and what new threads start with. */
export function VoiceTab({ fleet, state }: { fleet: Fleet; state: FleetState }) {
  const s = state.settings
  const machine = fleet.defaultMachine
  const multi = state.machines.length > 1
  const readOnly = state.machines.find(m => m.id === machine?.id && !m.canOperate)

  const [voice, setVoice] = useState(s.voicePrompt)
  useEffect(() => setVoice(s.voicePrompt), [s.voicePrompt])
  useEffect(() => {
    if (voice === s.voicePrompt) return
    const timer = setTimeout(() => void fleet.updateSettings({ voicePrompt: voice }), 500)
    return () => clearTimeout(timer)
  }, [voice])

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

  const projectOptions = useMemo(() => [
    { value: SCRATCH, label: 'No project' },
    ...(machine?.projects() ?? []).map(p => ({ value: p.id, label: p.title })),
  ], [machine, state])
  const modelOptions = useMemo(() => [
    { value: '', label: config?.defaultModel ? `Default (${config.defaultModel.model})` : 'Server default' },
    ...(config?.models ?? []).map(m => ({ value: `${m.instanceId}\u0000${m.slug}`, label: `${m.name} · ${m.provider}` })),
  ], [config])

  return (
    <>
      <Section label="Voice messages">
        <Row label="Time to cancel" hint="After you release, wait this long before sending. Swipe to send straight away; tap, then hold, and pick Cancel voice send to cancel.">
          <Select
            value={String(s.sendDelay)}
            options={SEND_DELAYS.map(v => ({ value: String(v), label: v === 0 ? 'Send right away' : `${v} second${v === 1 ? '' : 's'}` }))}
            onValueChange={v => void fleet.updateSettings({ sendDelay: Number(v) })}
          />
        </Row>
      </Section>

      <QuickReplies fleet={fleet} saved={s.quickReplies} />

      <Section
        label="Sent with every voice message"
        action={voice !== DEFAULT_SETTINGS.voicePrompt && <Button size="sm" variant="ghost" onClick={() => setVoice(DEFAULT_SETTINGS.voicePrompt)}>Reset to default</Button>}
        note={`A note on how much reply fits your glasses (about ${REPLY_FIT[s.density].lines} lines, from the Display tab's density) is added after this.`}
      >
        <div className="bg-surface p-3">
          <Textarea value={voice} onChange={e => setVoice(e.target.value)} rows={4} spellCheck={false} aria-label="Instructions sent with voice messages" />
        </div>
      </Section>

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
    </>
  )
}
