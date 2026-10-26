import type { ThreadMessage } from './types'

/** Loose view of the turn items the server pushes; only the fields we label are read. */
export interface TurnItem {
  id: string
  type: string
  status: string
  ordinal?: number
  startedAt?: string | null
  fileName?: string
  input?: unknown
  toolName?: string | null
  pattern?: string
  patterns?: string[]
  steps?: Array<{ text: string; status: string }>
  streaming?: boolean
  exitCode?: number
  outputIndicatesFailure?: boolean
}

export interface Step {
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
  ordinal: number
}

const LIVE = new Set(['running', 'pending', 'waiting', 'idle'])
const MAX_STEPS = 60

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function toolArgument(input: unknown): string {
  if (typeof input === 'string') return oneLine(input)
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
      const value = o[key]
      if (typeof value === 'string' && value) return key.endsWith('path') ? base(value) : oneLine(value)
    }
  }
  return ''
}

/** A short human label for what an item is doing, or null for items that are not activity. */
export function labelFor(item: TurnItem): string | null {
  switch (item.type) {
    case 'command_execution': return `$ ${oneLine(typeof item.input === 'string' ? item.input : '')}`.trim()
    case 'file_change': return `edit ${base(item.fileName ?? 'file')}`
    case 'file_search': return `search ${item.pattern ?? ''}`.trim()
    case 'web_search': return `web ${item.patterns?.[0] ?? ''}`.trim()
    case 'dynamic_tool': {
      const arg = toolArgument(item.input)
      return `${item.toolName ?? 'tool'}${arg ? ' ' + arg : ''}`
    }
    case 'reasoning': return 'thinking'
    case 'assistant_message': return item.streaming ? 'writing reply' : null
    case 'subagent': return 'subagent working'
    case 'todo_list': {
      const step = item.steps?.find(s => s.status === 'running') ?? item.steps?.find(s => s.status === 'pending')
      return step ? `plan: ${oneLine(step.text)}` : null
    }
    case 'approval_request': return 'needs your approval'
    case 'user_input_request': return 'asking you a question'
    default: return null
  }
}

function stepStatus(item: TurnItem): Step['status'] {
  if (LIVE.has(item.status)) return 'running'
  if (item.status === 'failed' || item.outputIndicatesFailure || (item.exitCode ?? 0) !== 0) return 'failed'
  return 'done'
}

/** Live view of one thread: its messages plus the trail of what the agent has been doing. */
export interface ThreadLive {
  sequence: number
  messages: ThreadMessage[]
  steps: Step[]
}

export const emptyLive = (): ThreadLive => ({ sequence: 0, messages: [], steps: [] })

function upsertStep(steps: Step[], item: TurnItem): Step[] {
  const label = labelFor(item)
  if (!label) return steps
  const step: Step = { id: item.id, label, status: stepStatus(item), ordinal: item.ordinal ?? Number.MAX_SAFE_INTEGER }
  const at = steps.findIndex(s => s.id === item.id)
  const next = at >= 0 ? steps.map((s, i) => (i === at ? { ...step, ordinal: s.ordinal } : s)) : [...steps, step]
  next.sort((a, b) => a.ordinal - b.ordinal)
  return next.slice(-MAX_STEPS)
}

function upsertMessage(messages: ThreadMessage[], message: ThreadMessage): ThreadMessage[] {
  const at = messages.findIndex(m => m.id === message.id)
  if (at >= 0) return messages.map((m, i) => (i === at ? message : m))
  return [...messages, message].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function fromSnapshot(snapshot: {
  snapshotSequence: number
  projection: { messages: ThreadMessage[]; visibleTurnItems?: Array<{ item?: TurnItem }> }
}): ThreadLive {
  let steps: Step[] = []
  for (const row of snapshot.projection.visibleTurnItems ?? []) if (row.item) steps = upsertStep(steps, row.item)
  return { sequence: snapshot.snapshotSequence, messages: snapshot.projection.messages, steps }
}

export interface ThreadEvent {
  kind: string
  sequence?: number
  event?: { type: string; payload?: unknown }
}

/** Applies one pushed stream item. Unknown events only advance the resume cursor. */
export function applyEvent(live: ThreadLive, item: ThreadEvent): ThreadLive {
  if (item.kind !== 'event' || !item.event) return live
  const sequence = Math.max(live.sequence, item.sequence ?? 0)
  const { type, payload } = item.event
  if (type === 'message.updated') {
    return { ...live, sequence, messages: upsertMessage(live.messages, payload as ThreadMessage) }
  }
  if (type === 'turn-item.updated') return { ...live, sequence, steps: upsertStep(live.steps, payload as TurnItem) }
  return sequence === live.sequence ? live : { ...live, sequence }
}

export const currentStep = (live: ThreadLive): Step | null => live.steps.findLast(s => s.status === 'running') ?? null
