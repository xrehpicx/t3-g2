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
  // user_input_request / approval_request
  /** A string on some servers, a number on others; the commands that answer it take a string. */
  requestId?: string | number
  questions?: Question[]
  questionAnswer?: unknown
  requestKind?: string
  prompt?: string
  reason?: string
  options?: Array<{ decision: string; label: string; warning?: string }>
}

export interface QuestionOption {
  label: string
  description?: string
  value?: string
}

export interface Question {
  id: string
  header: string
  question: string
  options: QuestionOption[]
  multiSelect?: boolean
  allowCustomAnswer?: boolean
}

/** Something the agent is waiting on you for. */
export type PendingRequest =
  | { kind: 'question'; requestId: string; itemId: string; questions: Question[] }
  | { kind: 'approval'; requestId: string; itemId: string; what: string; detail: string; options: Array<{ decision: string; label: string; warning?: string }> }

const OPEN = new Set(['pending', 'waiting', 'running', 'idle'])

/** The request an item represents, if it is still open. */
export function requestFrom(item: TurnItem): PendingRequest | null {
  if (item.requestId === undefined || item.requestId === null || item.requestId === '' || !OPEN.has(item.status)) return null
  const requestId = String(item.requestId)
  if (item.type === 'user_input_request' && item.questions?.length && item.questionAnswer === undefined) {
    return { kind: 'question', requestId, itemId: item.id, questions: item.questions }
  }
  if (item.type === 'approval_request') {
    const what = APPROVAL_WHAT[item.requestKind ?? ''] ?? 'Approval needed'
    const options = item.options?.length
      ? item.options
      : [{ decision: 'accept', label: 'Allow' }, { decision: 'acceptForSession', label: 'Allow for this session' }, { decision: 'decline', label: 'Deny' }]
    return { kind: 'approval', requestId, itemId: item.id, what, detail: (item.prompt || item.reason || '').trim(), options }
  }
  return null
}

const APPROVAL_WHAT: Record<string, string> = {
  command: 'Run a command?',
  'file-read': 'Read a file?',
  'file-change': 'Change files?',
  'mcp-elicitation': 'A tool needs input',
  permission: 'Permission needed',
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
  /** Open questions and approvals, oldest first. */
  requests: PendingRequest[]
}

export const emptyLive = (): ThreadLive => ({ sequence: 0, messages: [], steps: [], requests: [] })

function upsertRequest(requests: PendingRequest[], item: TurnItem): PendingRequest[] {
  if (item.type !== 'user_input_request' && item.type !== 'approval_request') return requests
  const others = requests.filter(r => r.itemId !== item.id)
  const open = requestFrom(item)
  return open ? [...others, open] : others
}

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

/**
 * A snapshot fetched with compact ids refers to ids by position in its `ids` table: a request's
 * `requestId` is then a number, and the string the server's commands take is `ids[number]`.
 */
export function resolveRequestId(item: TurnItem, ids: readonly string[] | undefined): TurnItem {
  if (typeof item.requestId !== 'number' || !ids) return item
  const full = ids[item.requestId]
  return typeof full === 'string' ? { ...item, requestId: full } : item
}

export function fromSnapshot(snapshot: {
  snapshotSequence: number
  ids?: string[]
  projection: { messages: ThreadMessage[]; visibleTurnItems?: Array<{ item?: TurnItem }> }
}): ThreadLive {
  let steps: Step[] = []
  let requests: PendingRequest[] = []
  for (const row of snapshot.projection.visibleTurnItems ?? []) {
    if (!row.item) continue
    const item = resolveRequestId(row.item, snapshot.ids)
    steps = upsertStep(steps, item)
    requests = upsertRequest(requests, item)
  }
  return { sequence: snapshot.snapshotSequence, messages: snapshot.projection.messages, steps, requests }
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
  if (type === 'turn-item.updated') {
    const item = payload as TurnItem
    return { ...live, sequence, steps: upsertStep(live.steps, item), requests: upsertRequest(live.requests, item) }
  }
  return sequence === live.sequence ? live : { ...live, sequence }
}

export const currentStep = (live: ThreadLive): Step | null => live.steps.findLast(s => s.status === 'running') ?? null
