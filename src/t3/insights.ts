import type { Net } from '../net'
import { rpc } from './rpc'
import type { Session } from './session'

/**
 * Everything the dashboard and usage pages show about one machine, beyond its threads: provider
 * usage limits (and reset credits), token spend, the host's CPU and memory, and scheduled tasks.
 * Each part needs a different pairing scope, so each can be missing on its own.
 */

export const hasScope = (session: Session, scope: string) => session.scope.split(/\s+/).includes(scope)

export const DIAGNOSTICS_SCOPE = 'diagnostics:read'
export const PROVIDERS_SCOPE = 'providers:manage'

export interface LimitWindow {
  id: string
  kind: 'session' | 'weekly' | 'monthly' | 'other' | string
  label: string
  usedPercent: number
  resetsAt?: string
}

export interface ProviderLimits {
  instanceId: string
  name: string
  windows: LimitWindow[]
  /** Reset credits that can be spent to clear the limit now. */
  credits: number
  /** Set when the provider reports no limits (unsupported, or the last check failed). */
  unavailable: string | null
}

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

export interface ScheduledRun {
  title: string
  nextRunAt: string
}

/** A part that could not be read, with the reason shown in its place. */
export interface Missing { missing: string }

export interface Insights {
  limits: ProviderLimits[] | Missing | null
  usage: UsageDigest | Missing | null
  host: HostResources | Missing | null
  scheduled: ScheduledRun[] | Missing | null
}

export const emptyInsights = (): Insights => ({ limits: null, usage: null, host: null, scheduled: null })
export const isMissing = (value: unknown): value is Missing => Boolean(value && typeof value === 'object' && 'missing' in value)

// --- reading --------------------------------------------------------------------------------

interface RawProvider {
  instanceId: string
  displayName?: string
  enabled?: boolean
  usageLimits?: {
    windows?: LimitWindow[]
    resetCredits?: { availableCount?: number }
    unavailable?: { reason?: string; message?: string }
  }
}

export function toLimits(providers: RawProvider[]): ProviderLimits[] {
  return providers
    .filter(p => p.enabled !== false && p.usageLimits)
    .map(p => ({
      instanceId: p.instanceId,
      name: p.displayName || p.instanceId,
      windows: p.usageLimits?.windows ?? [],
      credits: p.usageLimits?.resetCredits?.availableCount ?? 0,
      unavailable: p.usageLimits?.windows?.length ? null : p.usageLimits?.unavailable?.reason ?? 'unsupported',
    }))
}

/** Provider limits. `workspaceSnapshotsOnDemand` keeps the reply small (no per-project snapshots). */
export async function readLimits(net: Net, session: Session): Promise<ProviderLimits[]> {
  const reply = await rpc<{ providers: RawProvider[] }>(net, session, 'server.refreshProviders', { workspaceSnapshotsOnDemand: true })
  return toLimits(reply.providers ?? [])
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

export async function readScheduled(net: Net, session: Session): Promise<ScheduledRun[]> {
  const r = await rpc<{ tasks: Array<{ title: string; enabled: boolean; nextRunAt: string | null }> }>(net, session, 'scheduledTasks.list', {})
  return (r.tasks ?? [])
    .filter(t => t.enabled && t.nextRunAt)
    .map(t => ({ title: t.title, nextRunAt: t.nextRunAt! }))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
}

export type ResetOutcome = 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'

/** Spends one reset credit to clear a provider's usage limit now. */
export async function useResetCredit(net: Net, session: Session, instanceId: string): Promise<{ outcome: ResetOutcome; warning?: string }> {
  return rpc(net, session, 'provider.consumeResetCredit', { instanceId })
}

export const RESET_TEXT: Record<ResetOutcome, string> = {
  reset: 'Limit reset.',
  nothingToReset: 'Nothing to reset: the limit is not in use.',
  noCredit: 'No reset credits left.',
  alreadyRedeemed: 'That credit was already used.',
}
