import type { Net } from '../net'
import { currentStep, type PendingRequest, type ThreadLive } from './activity'
import type { Insights, ResetOutcome } from './insights'
import type { LaunchInput } from './launch'
import { Machine, type Glance, type OpenThread } from './machine'
import type { ServerConfig } from './serverConfig'
import { fromSnapshot } from './shellStore'
import type { ThreadMessage, ThreadShell, ThreadStatus } from './types'

export const DEMO_ID = 'demo'
/** A demo thread that keeps a glasses page, shown as a page in the demo. */
export const DEMO_PAGE_THREAD = 'p1'

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const MIN = 60_000

interface DemoThread {
  shell: ThreadShell
  messages: ThreadMessage[]
  /** Activity labels cycled while the thread is "running". */
  steps: string[]
  requests?: PendingRequest[]
}

let nextId = 0
const message = (role: 'user' | 'assistant', text: string, msAgo = 0, streaming = false): ThreadMessage =>
  ({ id: `demo-msg-${nextId++}`, role, text, streaming, createdAt: iso(msAgo) })

function thread(id: string, title: string, status: ThreadStatus, project: string, updatedMsAgo: number, extra: Partial<ThreadShell> = {}): ThreadShell {
  return {
    id, title, status, projectId: project, pinnedAt: iso(86_400_000), pinOrderKey: id,
    createdAt: iso(86_400_000), updatedAt: iso(updatedMsAgo), archivedAt: null, deletedAt: null,
    pendingRuntimeRequest: null, lineage: { relationshipToParent: null }, ...extra,
  }
}

/**
 * A pretend T3 machine so the app can be tried (and reviewed) without a server: a few pinned threads,
 * one of them working live, replies that stream in, and voice messages that get a canned answer.
 * Nothing leaves the device.
 */
export class DemoMachine extends Machine {
  private threads = new Map<string, DemoThread>()
  private listeners = new Map<string, Set<(live: ThreadLive) => void>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private step = 0
  private sequence = 1

  /**
   * `showcase` swaps the "Demo" labels for realistic ones, for store screenshots only. The live demo
   * keeps saying Demo so nobody mistakes it for a real machine.
   */
  constructor(net: Net, onChange: () => void, private readonly showcase = false) {
    super(net, {
      id: DEMO_ID,
      label: showcase ? 'MacBook Pro' : 'Demo',
      session: { origin: 'https://demo.invalid', accessToken: 'demo', expiresAt: Number.MAX_SAFE_INTEGER, scope: 'orchestration:read orchestration:operate' },
    }, onChange, () => {})
    this.seed()
  }

  private seed() {
    const add = (t: DemoThread) => this.threads.set(t.shell.id, t)
    add({
      shell: thread('d1', 'Fix flaky checkout e2e test', 'running', 'web', 0, { activityRunStatus: 'running', activityRunStartedAt: iso(3 * MIN) }),
      messages: [
        message('user', 'The checkout e2e test fails about one run in five on CI. Find out why and fix it.', 9 * MIN),
        message('assistant', 'Ran it 50 times locally and got 9 failures, all in the payment step. The test clicks Pay before the Stripe iframe finishes loading, so the click sometimes lands on a placeholder.', 6 * MIN),
        message('user', 'Fix it without adding sleeps.', 5 * MIN),
        { ...message('user', 'CI on main is blocked on this test. Ping me when it is green so I can cut the release.', 4 * MIN), createdBy: 'agent', senderThreadId: 'd3' },
        message('assistant', 'Waiting on the iframe ready event instead. Running the suite 50 more times to confirm.', 3 * MIN),
      ],
      steps: ['$ pnpm test:e2e checkout --repeat 50', 'Read tests/checkout.spec.ts', 'thinking', 'edit tests/checkout.spec.ts', 'edit src/payments/StripeFrame.tsx', '$ pnpm test:e2e checkout --repeat 50'],
    })
    add({
      shell: thread('d2', 'Migrate billing to v2 API', 'waiting', 'api', 4 * MIN, { pendingRuntimeRequest: { kind: 'approval' } }),
      messages: [
        message('user', 'Move the billing client to the v2 endpoints.', 30 * MIN),
        message('assistant', 'All 14 call sites are on v2 and the tests pass. Next step runs the invoices table migration, which needs your approval.', 4 * MIN),
      ],
      steps: [],
      requests: [{
        kind: 'approval', requestId: 'r-d2', itemId: 'i-d2', what: 'Run a command?',
        detail: 'pnpm db:migrate --env staging  (adds a currency column to invoices, about 40k rows)',
        options: [{ decision: 'accept', label: 'Allow' }, { decision: 'acceptForSession', label: 'Allow for this session' }, { decision: 'decline', label: 'Deny' }],
      }],
    })
    add({
      shell: thread('d7', 'Pick a charting library', 'waiting', 'web', 2 * MIN, { pendingRuntimeRequest: { kind: 'user_input' } }),
      messages: [
        message('user', 'We need charts on the analytics page. Compare the options and pick one.', 12 * MIN),
        message('assistant', 'Compared four options on bundle size, React 19 support and accessibility. Two are close, so I want your call.', 2 * MIN),
      ],
      steps: [],
      requests: [{
        kind: 'question', requestId: 'r-d7', itemId: 'i-d7',
        questions: [
          {
            id: 'lib', header: 'Library', question: 'Which charting library should we use?',
            options: [
              { label: 'Recharts', description: 'Most familiar, 98 kB' },
              { label: 'Visx', description: 'Smallest, more code to write' },
              { label: 'ECharts', description: 'Most features, 320 kB' },
            ],
          },
          {
            id: 'charts', header: 'Charts', question: 'Which charts are needed in the first version?', multiSelect: true,
            options: [{ label: 'Line' }, { label: 'Bar' }, { label: 'Funnel' }, { label: 'Heatmap' }],
          },
        ],
      }],
    })
    add({
      shell: thread('d3', 'Release notes for 2.4', 'completed', 'web', 25 * MIN),
      messages: [
        message('user', 'Draft release notes for 2.4 from the merged PRs.', 40 * MIN),
        message('assistant', 'Done. Highlights: search is 3x faster, drafts work offline, and the new share sheet. Full notes are in RELEASE.md.', 25 * MIN),
      ],
      steps: [],
    })
    add({
      shell: thread('d4', 'Why did CI get slow?', 'completed', 'web', 5 * 60 * MIN),
      messages: [
        message('user', 'CI builds went from 4 to 11 minutes this week. Why?', 6 * 60 * MIN),
        message('assistant', 'The Docker cache key changed on Monday, so every job rebuilds the base image. Restoring the old key brings builds back to about 4 minutes.', 5 * 60 * MIN),
      ],
      steps: [],
    })
    add({
      shell: thread('d5', 'Rate limit the public API', 'failed', 'api', 2 * 60 * MIN),
      messages: [
        message('user', 'Add per-key rate limiting to the public API.', 3 * 60 * MIN),
        message('assistant', 'Stopped: the Redis instance in staging refused connections, so I could not run the integration tests. Everything else is in place on the rate-limit branch.', 2 * 60 * MIN),
      ],
      steps: [],
    })
    add({
      shell: thread('d6', 'Onboarding email copy', 'completed', 'web', 26 * 60 * MIN),
      messages: [
        message('user', 'Tighten the welcome email. It is too long.', 27 * 60 * MIN),
        message('assistant', 'Cut it from 220 to 90 words and moved the setup link to the top.', 26 * 60 * MIN),
      ],
      steps: [],
    })
    const unpinned = { pinnedAt: null, pinOrderKey: null }
    add({
      shell: thread(DEMO_PAGE_THREAD, 'Glasses page: PRs and deploys', 'completed', 'web', 6 * MIN, unpinned),
      messages: [
        message('user', 'Show my open PRs waiting on review, CI status, and the last deploy. Refresh every 15 minutes.', 2 * 60 * MIN),
        message('assistant', [
          'PRs waiting on review (3)',
          '  #482 Stripe iframe ready event · 2 approvals',
          '  #479 Billing v2 client · changes requested',
          '  #471 Edge cache for product pages · new',
          'CI on main: green · 4m 12s',
          'Last deploy: web 2.4.0-rc2 · 38 min ago · healthy',
          'Next refresh in 9 min',
        ].join('\n'), 6 * MIN),
      ],
      steps: [],
    })
    add({
      shell: thread('o1', 'Spike: cache product pages at the edge', 'completed', 'web', 3 * 60 * MIN, unpinned),
      messages: [message('user', 'How much would edge caching help the product pages?', 4 * 60 * MIN), message('assistant', 'About 60% of requests are cacheable. A 5 minute TTL would cut origin load by half.', 3 * 60 * MIN)],
      steps: [],
    })
    add({
      shell: thread('o2', 'Bump Node to 24', 'completed', 'api', 2 * 24 * 60 * MIN, unpinned),
      messages: [message('user', 'Upgrade the API to Node 24.', 2 * 24 * 60 * MIN), message('assistant', 'Done. Tests pass and the Docker image is rebuilt.', 2 * 24 * 60 * MIN)],
      steps: [],
    })
    add({
      shell: thread('o3', 'Rename the checkout module', 'completed', 'web', 3 * 24 * 60 * MIN, unpinned),
      messages: [message('user', 'Rename checkout to purchase everywhere.', 3 * 24 * 60 * MIN), message('assistant', 'Renamed in 41 files.', 3 * 24 * 60 * MIN)],
      steps: [],
    })
    this.publish()
  }

  private publish() {
    this.shell = fromSnapshot({
      threads: [...this.threads.values()].map(t => t.shell),
      projects: [{ id: 'web', title: 'storefront' }, { id: 'api', title: 'billing-api' }],
    })
  }

  override start() {
    this.link = 'live'
    clearInterval(this.timer)
    // The running thread changes what it is doing every few seconds, like a real agent.
    this.timer = setInterval(() => { this.step++; this.emitAll(); this.changed() }, 2_500)
    this.changed()
  }

  override stop() { clearInterval(this.timer) }
  override async poll() { this.changed() }
  override warm() {}

  private demoCredits = 1
  /** Sample limits, spend and host numbers, so the dashboard and usage pages have something to show. */
  override refreshInsights() {
    const week = new Date(Date.now() + 4 * 86_400_000 + 3 * 3_600_000).toISOString()
    const session = new Date(Date.now() + 2 * 3_600_000 + 14 * 60_000).toISOString()
    const next: Insights = {
      limits: [
        { instanceId: 'codex', name: 'Codex', credits: this.demoCredits, unavailable: null, windows: [
          { id: 'primary', kind: 'session', label: '5 hours', usedPercent: this.demoCredits ? 82 : 0, resetsAt: session },
          { id: 'weekly', kind: 'weekly', label: 'Weekly', usedPercent: 35, resetsAt: week },
        ] },
        { instanceId: 'claudeAgent', name: 'Claude', credits: 0, unavailable: null, windows: [
          { id: 'weekly', kind: 'weekly', label: 'Weekly', usedPercent: 61, resetsAt: week },
        ] },
        { instanceId: 'cursor', name: 'Cursor', credits: 0, unavailable: 'unsupported', windows: [] },
      ],
      usage: {
        today: { costUsd: 42.18, tokens: 18_400_000, cachedShare: 0.94 },
        week: { costUsd: 512.4, tokens: 241_000_000, cachedShare: 0.96 },
        models: [
          { model: 'claude-opus-5-5', costUsd: 468.2, tokens: 214_000_000 },
          { model: 'gpt-5.5', costUsd: 31.9, tokens: 19_000_000 },
          { model: 'claude-sonnet-5-5', costUsd: 12.3, tokens: 8_000_000 },
        ],
      },
      host: { cpu: 0.19, usedMemoryBytes: 26.8e9, totalMemoryBytes: 38.6e9 },
      scheduled: [{ title: 'Nightly dependency bump', nextRunAt: new Date(Date.now() + 2 * 3_600_000 + 20 * 60_000).toISOString() }],
    }
    if (JSON.stringify(next.limits) !== JSON.stringify(this.insights.limits) || !this.insights.host) {
      this.insights = next
      queueMicrotask(() => this.changed())
    }
  }
  override get canReset() { return true }
  override async resetLimit(): Promise<{ outcome: ResetOutcome }> {
    if (!this.demoCredits) return { outcome: 'noCredit' }
    this.demoCredits = 0
    this.refreshInsights()
    return { outcome: 'reset' }
  }
  override watch() {}
  override glance(id: string): Glance | undefined {
    const t = this.threads.get(id)
    if (!t) return undefined
    const live = this.live(t)
    const reply = t.messages.findLast(m => m.role === 'assistant' && m.text.trim())
    return { step: currentStep(live)?.label ?? null, reply: reply?.text ?? null }
  }
  override config(): Promise<ServerConfig> {
    const model = this.showcase ? 'claude-sonnet-5-5' : 'demo-model'
    return Promise.resolve({ models: [{ instanceId: 'demo', provider: this.showcase ? 'Claude' : 'Demo', slug: model, name: this.showcase ? 'Claude Sonnet 5.5' : 'Demo model' }], defaultModel: { instanceId: 'demo', model }, defaultRuntimeMode: 'full-access' })
  }

  private changed() { this.onChange() }

  private live(t: DemoThread): ThreadLive {
    const running = t.shell.status === 'running' && t.steps.length > 0
    const label = running ? t.steps[this.step % t.steps.length] : null
    return {
      sequence: this.sequence++,
      messages: t.messages,
      steps: label ? [{ id: `${t.shell.id}-step`, label, status: 'running', ordinal: 1 }] : [],
      requests: t.requests ?? [],
    }
  }

  private emit(id: string) {
    const t = this.threads.get(id)
    if (!t) return
    for (const listener of this.listeners.get(id) ?? []) listener(this.live(t))
  }

  private emitAll() { for (const id of this.listeners.keys()) this.emit(id) }

  override openThread(threadId: string, onLive: (live: ThreadLive) => void): OpenThread {
    const set = this.listeners.get(threadId) ?? new Set()
    set.add(onLive)
    this.listeners.set(threadId, set)
    queueMicrotask(() => this.emit(threadId))
    return { close: () => set.delete(onLive) }
  }

  /** Voice in demo mode: the message shows up, then a reply streams in. Audio is discarded. */
  override async sendVoice(target: { id: string }) {
    const t = this.threads.get(target.id)
    if (!t) throw new Error('This thread is no longer available.')
    t.messages = [...t.messages, message('user', '(voice message)')]
    this.touch(t, 'running')
    this.emit(t.shell.id)
    this.reply(t, 'This is demo mode, so your voice message stayed on this device. Pair a T3 machine on your phone to talk to a real agent.')
  }

  override async sendText(target: { id: string }, text: string) {
    const t = this.threads.get(target.id)
    if (!t) throw new Error('This thread is no longer available.')
    t.messages = [...t.messages, message('user', text)]
    this.touch(t, 'running')
    this.emit(t.shell.id)
    this.reply(t, 'Demo page\nOn a real machine the agent would fill this in\nand keep it up to date.')
  }

  /** Answering in demo mode clears the request and gets a short reply. */
  override async respond(threadId: string, requestId: string, response: Parameters<Machine['respond']>[2]) {
    const t = this.threads.get(threadId)
    if (!t) throw new Error('This thread is no longer available.')
    t.requests = (t.requests ?? []).filter(r => r.requestId !== requestId)
    t.shell = { ...t.shell, pendingRuntimeRequest: null }
    const said = 'decision' in response
      ? response.decision === 'decline' ? 'Denied.' : 'Approved.'
      : Object.values(response.answers).map(a => (Array.isArray(a) ? a.join(', ') : a)).join(' · ')
    t.messages = [...t.messages, message('user', said)]
    this.touch(t, 'running')
    this.emit(t.shell.id)
    this.reply(t, 'decision' in response && response.decision === 'decline'
      ? 'Understood, skipping that step. Nothing was changed.'
      : 'Thanks, carrying on with that.')
  }

  override async launch(input: Omit<LaunchInput, 'config'>) {
    const id = `demo-new-${Date.now()}`
    const t: DemoThread = {
      shell: thread(id, input.title, 'running', input.settings.projectId === 'scratch' ? '' : input.settings.projectId, 0, { activityRunStatus: 'running', activityRunStartedAt: iso(0) }),
      messages: [message('user', '(voice message)')],
      steps: ['thinking', 'writing reply'],
    }
    this.threads.set(id, t)
    this.publish()
    this.changed()
    this.reply(t, 'New thread started in demo mode. On a real machine this would be your agent getting to work.')
    return id
  }

  private touch(t: DemoThread, status: ThreadStatus) {
    t.shell = { ...t.shell, status, updatedAt: iso(0), activityRunStatus: status === 'running' ? 'running' : null, activityRunStartedAt: status === 'running' ? iso(0) : null }
    this.publish()
    this.changed()
  }

  /** Streams a reply word by word, then finishes the run. */
  private reply(t: DemoThread, text: string) {
    const words = text.split(' ')
    const reply = message('assistant', '', 0, true)
    let shown = 0
    const tick = setInterval(() => {
      shown = Math.min(words.length, shown + 3)
      const done = shown >= words.length
      const current = { ...reply, text: words.slice(0, shown).join(' '), streaming: !done }
      t.messages = [...t.messages.filter(m => m.id !== reply.id), current]
      if (done) {
        clearInterval(tick)
        this.touch(t, 'completed')
      }
      this.emit(t.shell.id)
    }, 350)
  }
}
