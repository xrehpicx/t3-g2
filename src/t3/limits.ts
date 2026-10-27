/**
 * Usage limits across every account. T3 Code reports them two ways: each provider's own sign-in
 * (`server.refreshProviders`), and any number of accounts behind a usage-limit source such as a proxy
 * that holds many Claude and Codex subscriptions (`subscribeServerConfig` with `usageLimitSources`).
 * Both become the same thing here: an account with windows, and optionally a reset credit.
 */

export interface LimitWindow {
  id: string
  kind: 'session' | 'weekly' | 'monthly' | 'other' | string
  /** "Session", "Weekly", "Weekly · Fable". */
  label: string
  usedPercent: number
  resetsAt?: string
  windowDurationMins?: number
}

/** How to spend a reset credit: a provider's own, or one held by a limit source. */
export type ResetTarget =
  | { instanceId: string }
  | { sourceId: string; accountId: string; creditId: string }

export interface LimitAccount {
  /** Unique across machines: a source account is the same account whichever machine reports it. */
  key: string
  /** The provider driver, e.g. `claudeAgent` or `codex`. */
  driver: string
  /** "Claude", "Codex". */
  provider: string
  /** The account's email, or the provider's name when it has none. */
  name: string
  email: string | null
  plan: string | null
  /** The limit source's label, when it came from one. */
  source: string | null
  /** The machine that reported it, which spends its reset credits. */
  machineId: string
  workspaceId: string | null
  windows: LimitWindow[]
  credits: number
  reset: ResetTarget | null
  /** Why there are no windows: the provider reports none, or the last check failed. */
  unavailable: string | null
}

// --- parsing ----------------------------------------------------------------------------------

interface RawLimits {
  windows?: LimitWindow[]
  resetCredits?: { availableCount?: number; nextCreditId?: string }
  unavailable?: { reason?: string; message?: string }
}

interface RawProvider {
  instanceId: string
  driver?: string
  displayName?: string
  enabled?: boolean
  auth?: { workspaceId?: string; email?: string }
  usageLimits?: RawLimits
}

export interface RawSource {
  id: string
  label: string
  error?: string
  accounts: Array<{
    id: string
    driver: string
    email?: string
    plan?: string
    workspaceId?: string
    usageLimits: RawLimits
  }>
}

const PROVIDER_NAMES: Record<string, string> = { claudeAgent: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok', opencode: 'OpenCode', antigravity: 'Antigravity', pi: 'Pi', muse: 'Muse' }
export const providerName = (driver: string) => PROVIDER_NAMES[driver] ?? driver

const windowsOf = (limits: RawLimits | undefined) => (limits?.windows ?? []).map(w => ({ ...w }))

/** Providers signed in on the machine itself. */
export function providerAccounts(providers: RawProvider[], machineId: string): LimitAccount[] {
  return providers
    .filter(p => p.enabled !== false && p.usageLimits)
    .map(p => {
      const limits = p.usageLimits!
      const windows = windowsOf(limits)
      const credits = limits.resetCredits?.availableCount ?? 0
      return {
        key: `${machineId}/provider/${p.instanceId}`,
        driver: p.driver ?? p.instanceId,
        provider: p.displayName || providerName(p.driver ?? p.instanceId),
        name: p.displayName || providerName(p.driver ?? p.instanceId),
        email: p.auth?.email ?? null,
        plan: null,
        source: null,
        machineId,
        workspaceId: p.auth?.workspaceId ?? null,
        windows,
        credits,
        reset: credits ? { instanceId: p.instanceId } : null,
        unavailable: windows.length ? null : limits.unavailable?.reason ?? 'unsupported',
      }
    })
}

/** Accounts held by usage-limit sources. */
export function sourceAccounts(sources: RawSource[], machineId: string): LimitAccount[] {
  return sources.flatMap(source => source.accounts.map(a => {
    const windows = windowsOf(a.usageLimits)
    const credits = a.usageLimits.resetCredits?.availableCount ?? 0
    const creditId = a.usageLimits.resetCredits?.nextCreditId
    return {
      key: `${source.id}/${a.id}`,
      driver: a.driver,
      provider: providerName(a.driver),
      name: a.email ?? a.id.replace(/\.json$/, ''),
      email: a.email ?? null,
      plan: a.plan ?? null,
      source: source.label,
      machineId,
      workspaceId: a.workspaceId ?? null,
      windows,
      credits,
      reset: credits && creditId ? { sourceId: source.id, accountId: a.id, creditId } : null,
      unavailable: windows.length ? null : a.usageLimits.unavailable?.reason ?? 'unsupported',
    } satisfies LimitAccount
  }))
}

/**
 * Both lists together. A provider signed in on the machine is often the same account a source also
 * lists (same workspace), so the source's copy wins and the provider's is dropped.
 */
export function mergeAccounts(providers: LimitAccount[], fromSources: LimitAccount[]): LimitAccount[] {
  const known = new Set(fromSources.map(a => a.workspaceId).filter((id): id is string => Boolean(id)))
  return [...fromSources, ...providers.filter(a => !a.workspaceId || !known.has(a.workspaceId))]
}

/** Accounts from several machines, each account once. */
export function dedupeAccounts(lists: LimitAccount[][]): LimitAccount[] {
  const seen = new Set<string>()
  return lists.flat().filter(a => (seen.has(a.key) ? false : (seen.add(a.key), true)))
}

// --- reading one account ------------------------------------------------------------------------

/** A window with nothing left. */
export const isFull = (w: LimitWindow) => w.usedPercent >= 100

const timeOf = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN)

/**
 * When an account can be used again: now if no window is full, otherwise the last reset among its full
 * windows (a weekly limit outlasts a session limit that resets sooner).
 */
export function freeAt(a: LimitAccount): number | null {
  const full = a.windows.filter(isFull)
  if (!full.length) return null
  const times = full.map(w => timeOf(w.resetsAt))
  return times.some(Number.isNaN) ? null : Math.max(...times)
}

export const isFree = (a: LimitAccount) => !a.windows.some(isFull)

/** Windows that say anything, in a steady order: session, weekly, then the rest. */
export function orderedWindows(a: LimitAccount): LimitWindow[] {
  const rank = (w: LimitWindow) => (w.kind === 'session' ? 0 : w.kind === 'weekly' && !w.label.includes('·') ? 1 : 2)
  return [...a.windows].sort((x, y) => rank(x) - rank(y) || x.label.localeCompare(y.label))
}

/** "S", "W", or the qualifier of "Weekly · Fable" ("F"). */
export function windowTag(w: LimitWindow): string {
  const suffix = w.label.split('·')[1]?.trim()
  if (suffix) return suffix[0].toUpperCase()
  return w.kind === 'session' ? 'S' : w.kind === 'weekly' ? 'W' : w.kind === 'monthly' ? 'M' : (w.label[0] ?? '?').toUpperCase()
}

/** The account's name, shortened to the part before the @ when that is enough to tell accounts apart. */
export function shortNames(accounts: LimitAccount[]): Map<string, string> {
  const locals = accounts.map(a => (a.email ? a.email.split('@')[0] : a.name))
  const names = new Map<string, string>()
  accounts.forEach((a, i) => {
    const unique = locals.filter(l => l === locals[i]).length === 1
    names.set(a.key, a.email && unique ? locals[i] : a.email ?? a.name)
  })
  return names
}

// --- pooling accounts ---------------------------------------------------------------------------

export interface PooledWindow {
  label: string
  kind: string
  accounts: number
  /** Accounts that still have room in this window. */
  withRoom: number
  /** Average used across accounts, 0..100. */
  usedPercent: number
  /** The earliest reset of any account's window, and whose it is. */
  firstReset: { at: number; name: string } | null
}

export interface Family {
  driver: string
  provider: string
  accounts: LimitAccount[]
  /** Accounts that report windows. */
  counted: number
  /** Accounts with no full window. */
  free: number
  windows: PooledWindow[]
  credits: number
  /** When the first blocked account is usable again, when none is free. */
  nextFree: { at: number; name: string } | null
  /** The earliest reset of any window at all, free or not. */
  nextReset: { at: number; name: string } | null
}

/** Every provider's accounts pooled: how many are free, how much is left overall, what resets first. */
export function families(accounts: LimitAccount[]): Family[] {
  const names = shortNames(accounts)
  const byDriver = new Map<string, LimitAccount[]>()
  for (const a of accounts) byDriver.set(a.driver, [...(byDriver.get(a.driver) ?? []), a])
  return [...byDriver].map(([driver, list]) => {
    const counted = list.filter(a => a.windows.length)
    const byLabel = new Map<string, Array<{ w: LimitWindow; a: LimitAccount }>>()
    for (const a of counted) for (const w of a.windows) byLabel.set(w.label, [...(byLabel.get(w.label) ?? []), { w, a }])
    const windows: PooledWindow[] = [...byLabel].map(([label, items]) => {
      const resets = items.filter(i => !Number.isNaN(timeOf(i.w.resetsAt))).sort((x, y) => timeOf(x.w.resetsAt) - timeOf(y.w.resetsAt))
      return {
        label, kind: items[0].w.kind, accounts: items.length,
        withRoom: items.filter(i => !isFull(i.w)).length,
        usedPercent: items.reduce((s, i) => s + i.w.usedPercent, 0) / items.length,
        firstReset: resets[0] ? { at: timeOf(resets[0].w.resetsAt), name: names.get(resets[0].a.key) ?? resets[0].a.name } : null,
      }
    }).sort((x, y) => (x.kind === 'session' ? 0 : x.kind === 'weekly' && !x.label.includes('·') ? 1 : 2) - (y.kind === 'session' ? 0 : y.kind === 'weekly' && !y.label.includes('·') ? 1 : 2) || x.label.localeCompare(y.label))

    const blocked = counted.map(a => ({ a, at: freeAt(a) })).filter((x): x is { a: LimitAccount; at: number } => x.at !== null).sort((x, y) => x.at - y.at)
    const allResets = windows.flatMap(w => (w.firstReset ? [w.firstReset] : [])).sort((x, y) => x.at - y.at)
    return {
      driver, provider: list[0].provider, accounts: list, counted: counted.length,
      free: counted.filter(isFree).length,
      windows,
      credits: list.reduce((s, a) => s + a.credits, 0),
      nextFree: blocked[0] ? { at: blocked[0].at, name: names.get(blocked[0].a.key) ?? blocked[0].a.name } : null,
      nextReset: allResets[0] ?? null,
    }
  }).filter(f => f.counted > 0 || f.accounts.length > 0)
}

/** Accounts in the order worth reading: free ones with the most left first, then blocked ones by when they free up. */
export function accountOrder(accounts: LimitAccount[]): LimitAccount[] {
  const left = (a: LimitAccount) => 100 - Math.max(0, ...a.windows.map(w => w.usedPercent))
  return [...accounts].sort((x, y) => {
    const fx = freeAt(x), fy = freeAt(y)
    if (x.windows.length === 0 || y.windows.length === 0) return Number(x.windows.length === 0) - Number(y.windows.length === 0)
    if ((fx === null) !== (fy === null)) return fx === null ? -1 : 1
    if (fx === null || fy === null) return left(y) - left(x) || x.name.localeCompare(y.name)
    return fx - fy || x.name.localeCompare(y.name)
  })
}

// --- alerts -------------------------------------------------------------------------------------

export interface LimitWarning {
  /** Stable across polls, so one warning is shown once. */
  key: string
  text: string
}

/**
 * Pools running low. Judged per provider and window over all its accounts, so a proxy with many
 * accounts warns when the whole pool is nearly spent, not each time one account fills up.
 */
export function limitWarnings(accounts: LimitAccount[], percent: number, now: number): LimitWarning[] {
  if (percent <= 0) return []
  return families(accounts).flatMap(f => f.windows.filter(w => w.usedPercent >= percent).map(w => {
    const many = f.counted > 1
    const left = Math.round(100 - w.usedPercent)
    const reset = f.nextFree && f.free === 0 ? ` · next free in ${spanText(f.nextFree.at - now)}` : w.firstReset ? ` · resets in ${spanText(w.firstReset.at - now)}` : ''
    return {
      key: `${f.driver}:${w.label}`,
      text: many ? `${f.provider} ${w.label.toLowerCase()}: ${left}% left across ${f.counted}${reset}` : `${f.provider} ${w.label.toLowerCase()} ${Math.round(w.usedPercent)}% used${reset}`,
    }
  }))
}

/** "59m", "2h 14m", "4d 3h". */
export function spanText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  const hours = Math.floor(mins / 60)
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
