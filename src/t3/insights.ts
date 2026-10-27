import type { Net } from '../net'
import { mergeAccounts, providerAccounts, sourceAccounts, type LimitAccount, type RawSource, type ResetTarget } from './limits'
import { rpc } from './rpc'
import type { Session } from './session'
import { openStream } from './stream'

/**
 * Everything the dashboard and usage pages show about one machine, beyond its threads: provider
 * usage limits (and reset credits), token spend, the host's CPU and memory, and scheduled tasks.
 * Each part needs a different pairing scope, so each can be missing on its own.
 */

export const hasScope = (session: Session, scope: string) => session.scope.split(/\s+/).includes(scope)

export const DIAGNOSTICS_SCOPE = 'diagnostics:read'
export const PROVIDERS_SCOPE = 'providers:manage'

export interface SpendTotals {
  costUsd: number
  /** Input (cached and not) plus output. */
  tokens: number
  /** Share of input tokens served from cache, 0..1. */
  cachedShare: number
}

export interface UsageDigest {
  today: SpendTotals
  week: SpendTotals
  /** Last 7 days, most expensive first. */
  models: Array<{ model: string; costUsd: number; tokens: number }>
}

export interface HostResources {
  cpu: number | null
  usedMemoryBytes: number
  totalMemoryBytes: number
}

export interface ScheduledTask {
  id: string
  title: string
  enabled: boolean
  /** Null when paused or finished. */
  nextRunAt: string | null
  lastRunAt: string | null
  /** The last run's outcome, as the server words it (for example "succeeded" or "failed"). */
  lastRunStatus: string | null
}

/** A part that could not be read, with the reason shown in its place. */
export interface Missing { missing: string }

export interface Insights {
  /** Every account's usage limits: the machine's own providers plus any limit source's accounts. */
  limits: LimitAccount[] | Missing | null
  usage: UsageDigest | Missing | null
  host: HostResources | Missing | null
  scheduled: ScheduledTask[] | Missing | null
}

export const emptyInsights = (): Insights => ({ limits: null, usage: null, host: null, scheduled: null })
export const isMissing = (value: unknown): value is Missing => Boolean(value && typeof value === 'object' && 'missing' in value)

// --- reading --------------------------------------------------------------------------------

/**
 * Every account's limits, from the server's config stream: its first item is the configuration (with
 * each signed-in provider's limits), and a usage-limit source (a proxy holding several subscriptions)
 * announces its accounts right after. This reads what the server already knows, without asking it to
 * probe every provider again, then hangs up.
 */
export function readLimits(net: Net, session: Session, machineId: string, timeoutMs = 15_000, sourceGraceMs = 4_000): Promise<LimitAccount[]> {
  return new Promise((resolve, reject) => {
    let providers: Parameters<typeof providerAccounts>[0] | null = null
    let sources: RawSource[] | null = null
    let done = false
    let grace: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(grace)
      handle.close()
      if (!providers && !sources) return reject(new Error('The server did not report its limits.'))
      resolve(mergeAccounts(providerAccounts(providers ?? [], machineId), sourceAccounts(sources ?? [], machineId)))
    }
    const handle = openStream<{ type?: string; config?: { providers?: Parameters<typeof providerAccounts>[0] }; payload?: { sources?: RawSource[] } }>({
      net, session, tag: 'subscribeServerConfig',
      payload: () => ({ usageLimitSources: true, workspaceSnapshotsOnDemand: true }),
      onItem: item => {
        if (item.type === 'snapshot') {
          providers = item.config?.providers ?? []
          // A server with no limit source sends nothing more; give one a moment, then stop waiting.
          if (sources) finish()
          else grace = setTimeout(finish, sourceGraceMs)
        } else if (item.type === 'usageLimitSourcesUpdated') {
          sources = item.payload?.sources ?? []
          if (providers) finish()
        }
      },
    })
    const timer = setTimeout(finish, timeoutMs)
  })
}

interface RawBucket {
  day: string
  model: string
  costUsd: number
  totals: { uncachedInputTokens: number; cachedInputTokens: number; cacheCreationTokens: number; outputTokens: number }
}

/** A calendar day in `timeZone`, as YYYY-MM-DD. */
export function dayIn(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
}

function totals(buckets: RawBucket[]): SpendTotals {
  let cost = 0, input = 0, cached = 0, output = 0
  for (const b of buckets) {
    cost += b.costUsd
    input += b.totals.uncachedInputTokens + b.totals.cacheCreationTokens
    cached += b.totals.cachedInputTokens
    output += b.totals.outputTokens
  }
  const allInput = input + cached
  return { costUsd: cost, tokens: allInput + output, cachedShare: allInput ? cached / allInput : 0 }
}

export function digestUsage(buckets: RawBucket[], today: string): UsageDigest {
  const byModel = new Map<string, RawBucket[]>()
  for (const b of buckets) byModel.set(b.model, [...(byModel.get(b.model) ?? []), b])
  const models = [...byModel].map(([model, list]) => ({ model, ...totals(list) }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .map(({ model, costUsd, tokens }) => ({ model, costUsd, tokens }))
  return { today: totals(buckets.filter(b => b.day === today)), week: totals(buckets), models }
}

/** Spend over the last 7 days, scanned from the providers' transcripts on that machine. */
export async function readUsage(net: Net, session: Session, now = new Date()): Promise<UsageDigest> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const today = dayIn(now, timeZone)
  const sinceDay = dayIn(new Date(now.getTime() - 6 * 86_400_000), timeZone)
  const reply = await rpc<{ buckets: RawBucket[] }>(net, session, 'server.getUsageSummary', { sinceDay, untilDay: today, timeZone })
  return digestUsage(reply.buckets ?? [], today)
}

export async function readHost(net: Net, session: Session): Promise<HostResources> {
  const r = await rpc<{ cpuUtilization: number | null; availableMemoryBytes: number; totalMemoryBytes: number }>(net, session, 'server.getHostResources', {})
  return { cpu: r.cpuUtilization, usedMemoryBytes: r.totalMemoryBytes - r.availableMemoryBytes, totalMemoryBytes: r.totalMemoryBytes }
}

/** Every scheduled task: soonest first, paused ones last. */
export async function readScheduled(net: Net, session: Session): Promise<ScheduledTask[]> {
  const r = await rpc<{ tasks: Array<{ id: string; title: string; enabled: boolean; nextRunAt: string | null; lastRunAt?: string | null; lastRunStatus?: unknown }> }>(net, session, 'scheduledTasks.list', {})
  return sortTasks((r.tasks ?? []).map(t => ({
    id: t.id, title: t.title, enabled: t.enabled, nextRunAt: t.nextRunAt ?? null, lastRunAt: t.lastRunAt ?? null,
    lastRunStatus: typeof t.lastRunStatus === 'string' ? t.lastRunStatus : null,
  })))
}

export function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  const when = (t: ScheduledTask) => (t.enabled && t.nextRunAt ? Date.parse(t.nextRunAt) : Number.MAX_SAFE_INTEGER)
  return [...tasks].sort((a, b) => when(a) - when(b) || a.title.localeCompare(b.title))
}

export const runTaskNow = (net: Net, session: Session, id: string) => rpc(net, session, 'scheduledTasks.runNow', { id })
export const setTaskEnabled = (net: Net, session: Session, id: string, enabled: boolean) => rpc(net, session, 'scheduledTasks.setEnabled', { id, enabled })

export type ResetOutcome = 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'

/** Spends one reset credit to clear an account's usage limit now. */
export async function useResetCredit(net: Net, session: Session, target: ResetTarget): Promise<{ outcome: ResetOutcome; warning?: string }> {
  return rpc(net, session, 'provider.consumeResetCredit', target)
}

export const RESET_TEXT: Record<ResetOutcome, string> = {
  reset: 'Limit reset.',
  nothingToReset: 'Nothing to reset: the limit is not in use.',
  noCredit: 'No reset credits left.',
  alreadyRedeemed: 'That credit was already used.',
}
