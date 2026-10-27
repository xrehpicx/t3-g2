import type { PendingRequest } from '../t3/activity'
import { isMissing, type Insights, type ScheduledTask } from '../t3/insights'
import { accountOrder, dedupeAccounts, families, isFree, orderedWindows, shortNames, spanText, windowTag, type LimitAccount } from '../t3/limits'
import { isBusy } from '../t3/pinned'
import type { PinnedThread } from '../t3/types'
import { charWidth, fitWidth, SAFETY_PX, textWidth } from './font'
import { MARK, markFor } from './screens'

/** One line of the dashboard or usage page. `select` makes it a choice (the key of what it picks). */
export interface PageLine {
  text: string
  select?: string
  dim?: boolean
}

export function money(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`
  if (usd >= 100) return `$${Math.round(usd)}`
  return `$${usd.toFixed(2)}`
}

export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${n >= 1e8 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

/** Time until `iso`: "14m", "2h 14m", "4d 3h". */
export function until(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  if (mins < 60) return `${mins}m`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  const hours = Math.floor(mins / 60)
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** A meter of `cells` thick (used) and thin (left) dashes. */
export function meter(percent: number, cells = 8): string {
  const used = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '━'.repeat(used) + '─'.repeat(cells - used)
}

/** Pads with spaces to roughly `px` wide, so columns line up in the proportional font. */
export function padTo(text: string, px: number): string {
  const fitted = textWidth(text) <= px - charWidth(' ') ? text : fitWidth(text, px - charWidth(' ') + SAFETY_PX)
  return fitted + ' '.repeat(Math.max(1, Math.round((px - textWidth(fitted)) / charWidth(' '))))
}

const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/^models\//, '')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export interface PageMachine {
  id: string
  label: string
  online: boolean
  insights: Insights
}

// --- usage ----------------------------------------------------------------------------------

/** Every account across machines, each once. */
export function usageAccounts(machines: PageMachine[]): LimitAccount[] {
  return dedupeAccounts(machines.map(m => (m.insights.limits && !isMissing(m.insights.limits) ? m.insights.limits : [])))
}

/** The key of a choosable provider line on the overview. */
export const familyKey = (driver: string) => `fam:${driver}`
/** The key of a choosable account line. */
export const accountKey = (key: string) => `acct:${key}`

function overviewLines(accounts: LimitAccount[], now: number): PageLine[] {
  const lines: PageLine[] = []
  for (const f of families(accounts).filter(f => f.counted > 0)) {
    const credits = f.credits ? `   ○ ${plural(f.credits, 'reset credit')}` : ''
    const head = f.counted > 1
      ? `${padTo(f.provider, 80)}${f.free} of ${f.counted} free${f.free === 0 && f.nextFree ? `   next free ${spanText(f.nextFree.at - now)} (${f.nextFree.name})` : f.nextReset ? `   next reset ${spanText(f.nextReset.at - now)} (${f.nextReset.name})` : ''}${credits}`
      : `${padTo(f.provider, 80)}${f.accounts[0].plan ?? f.accounts[0].name}${credits}`
    lines.push({ text: head, select: familyKey(f.driver) })
    for (const w of f.windows) {
      const left = Math.round(100 - w.usedPercent)
      const room = f.counted > 1 ? `${w.withRoom}/${w.accounts} free` : ''
      const reset = w.firstReset ? spanText(w.firstReset.at - now) : ''
      lines.push({ text: `${padTo('', 24)}${padTo(w.label, 128)}${meter(w.usedPercent, 5)} ${padTo(`${left}% left`, 88)}${[room, reset].filter(Boolean).join(' · ')}`, dim: true })
    }
  }
  const reporting = new Set(accounts.filter(a => a.windows.length).map(a => a.driver))
  const quiet = [...new Set(accounts.filter(a => !a.windows.length && !reporting.has(a.driver)).map(a => a.provider))]
  if (quiet.length) lines.push({ text: `${quiet.join(', ')}: no limits reported`, dim: true })
  return lines
}

/** One line per account of a provider: which windows are used up and when they come back. */
function accountLines(accounts: LimitAccount[], driver: string, now: number): PageLine[] {
  const family = families(accounts).find(f => f.driver === driver)
  if (!family) return [{ text: 'No accounts for this provider.', dim: true }]
  const names = shortNames(family.accounts)
  const lines: PageLine[] = [{ text: `${family.provider}   ${family.free} of ${family.counted} free · swipe to browse · double tap: back`, dim: true }]
  for (const a of accountOrder(family.accounts.filter(a => a.windows.length))) {
    const parts = orderedWindows(a).slice(0, 3).map(w => {
      const reset = w.resetsAt && w.usedPercent > 0 ? ` ${spanText(Date.parse(w.resetsAt) - now)}` : ''
      return `${windowTag(w)} ${Math.round(w.usedPercent)}%${reset}`
    })
    const mark = isFree(a) ? MARK.done : MARK.fail
    const credit = a.credits ? `  ○ ${a.credits}` : ''
    lines.push({ text: `${mark} ${padTo(names.get(a.key) ?? a.name, 110)}${parts.join('   ')}${credit}`, select: accountKey(a.key) })
  }
  return lines
}

/**
 * The Usage page. With no provider chosen it is the overview: each provider's accounts pooled (how many
 * are free, how much is left, which resets first), then spend. With one chosen it lists that provider's
 * accounts.
 */
export function usageLines(machines: PageMachine[], now: number, driver: string | null = null): PageLine[] {
  const accounts = usageAccounts(machines)
  const lines: PageLine[] = []
  if (driver) return accountLines(accounts, driver, now)

  const states = machines.map(m => m.insights.limits)
  if (accounts.length) lines.push(...overviewLines(accounts, now))
  else if (states.every(l => !l)) lines.push({ text: 'Limits: loading…', dim: true })
  else {
    const reason = states.find(isMissing)
    lines.push({ text: reason && isMissing(reason) ? `Limits: ${reason.missing}` : 'No usage limits reported.', dim: true })
  }

  const several = machines.length > 1
  for (const m of machines) {
    const usage = m.insights.usage
    const prefix = several ? `${m.label}  ` : ''
    if (!usage) lines.push({ text: `${prefix}Spend: loading…`, dim: true })
    else if (isMissing(usage)) lines.push({ text: `${prefix}Spend: ${usage.missing}`, dim: true })
    else {
      const t = usage.today, w = usage.week
      const cached = (x: typeof t) => `${padTo(money(x.costUsd), 80)}${padTo(`${tokens(x.tokens)} tokens`, 130)}${Math.round(x.cachedShare * 100)}% cached`
      // With several machines, the machine's name leads and the period follows it.
      lines.push({ text: `${several ? `${padTo(m.label, 130)}${padTo('today', 60)}` : padTo('Today', 80)}${cached(t)}` })
      lines.push({ text: `${several ? `${padTo('', 130)}${padTo('7 days', 60)}` : padTo('7 days', 80)}${cached(w)}` })
      if (usage.models.length && !several) {
        lines.push({ text: `${padTo('Top', 80)}${usage.models.slice(0, 3).map(x => `${shortModel(x.model)} ${money(x.costUsd)}`).join(' · ')}`, dim: true })
      }
    }
  }
  return lines
}

// --- dashboard ------------------------------------------------------------------------------

export interface DashboardInput {
  threads: PinnedThread[]
  unread: (t: PinnedThread) => boolean
  step: (t: PinnedThread) => string | null
  /** What an asking thread is waiting on, when known. */
  request?: (t: PinnedThread) => PendingRequest | null
  /** Daily spend limit in dollars; 0 is off. */
  budget?: number
  /** Make asking threads choosable, so approvals can be answered from here. */
  actions?: boolean
  machines: PageMachine[]
  now: number
}

/** The key of a choosable "needs you" line. */
export const askKey = (t: { machineId: string; id: string }) => `ask:${t.machineId}:${t.id}`

/** A short phrase for what the agent is waiting on: "Run a command?" or the question itself. */
export function requestSummary(request: PendingRequest | null | undefined): string {
  if (!request) return ''
  if (request.kind === 'approval') return [request.what, request.detail].filter(Boolean).join(' ')
  return request.questions[0]?.question ?? 'a question'
}

/** Which of an approval's options allow and which deny, whatever the agent calls them. */
export function approvalDecisions(request: Extract<PendingRequest, { kind: 'approval' }>): { allow: string; deny: string } {
  const decisions = request.options.map(o => o.decision)
  const isDeny = (d: string) => /decline|deny|reject|cancel/i.test(d)
  return {
    allow: decisions.includes('accept') ? 'accept' : decisions.find(d => !isDeny(d)) ?? decisions[0] ?? 'accept',
    deny: decisions.find(d => d === 'decline') ?? decisions.find(isDeny) ?? 'decline',
  }
}

export function dashboardLines({ threads, unread, step, request, budget = 0, actions = false, machines, now }: DashboardInput): PageLine[] {
  const lines: PageLine[] = []
  const marks = threads.map(t => markFor(t.status, t.needsInput, unread(t)))
  const count = (mark: string) => marks.filter(m => m === mark).length
  const ask = count('ask'), run = count('run'), fresh = count('new')
  const summary = [
    ask ? `${MARK.ask} ${ask} ${ask === 1 ? 'needs' : 'need'} you` : '',
    run ? `${MARK.run} ${run} running` : '',
    fresh ? `${MARK.new} ${fresh} new` : '',
  ].filter(Boolean)
  lines.push({ text: summary.length ? summary.join('   ') : 'All quiet. Nothing needs you.' })

  for (const t of threads.filter(t => t.needsInput || t.status === 'waiting').slice(0, 4)) {
    const what = requestSummary(request?.(t))
    lines.push({ text: `${MARK.ask} ${t.title}${what ? ` · ${what}` : ''}`, ...(actions ? { select: askKey(t) } : { dim: true }) })
  }
  for (const t of threads.filter(t => isBusy(t.status) && !t.needsInput && t.status !== 'waiting').slice(0, 3)) {
    const doing = step(t)
    lines.push({ text: `${MARK.run} ${t.title}${doing ? ` · ${doing}` : ''}`, dim: true })
  }

  for (const m of machines) {
    const host = m.insights.host
    const stats = !m.online ? 'offline'
      : host && !isMissing(host)
        ? `CPU ${host.cpu === null ? '?' : Math.round(host.cpu * 100)}%   RAM ${Math.round(host.usedMemoryBytes / 1e9)} of ${Math.round(host.totalMemoryBytes / 1e9)} GB`
        : 'connected'
    lines.push({ text: `${m.online ? MARK.new : MARK.done} ${padTo(m.label, 150)}${stats}` })
  }

  const todayCost = todaySpend(machines)
  const spends = machines.map(m => m.insights.usage).filter((u): u is Exclude<typeof u, null | { missing: string }> => Boolean(u) && !isMissing(u))
  if (spends.length) {
    const week = spends.reduce((s, u) => s + u.week.costUsd, 0)
    const toks = spends.reduce((s, u) => s + u.today.tokens, 0)
    const budgetNote = budget > 0 ? ` of $${budget}` : ''
    lines.push({ text: `${padTo('Spend', 95)}today ${money(todayCost ?? 0)}${budgetNote} · ${tokens(toks)} tokens · 7 days ${money(week)}` })
  }

  const pools = families(usageAccounts(machines)).filter(f => f.counted > 0).map(f => {
    const w = f.windows.find(x => x.kind === 'weekly' && !x.label.includes('·')) ?? f.windows[0]
    const left = w ? `${Math.round(100 - w.usedPercent)}% left` : ''
    return f.counted > 1 ? `${f.provider} ${f.free}/${f.counted} free · ${left}` : `${f.provider} ${left}`
  })
  if (pools.length) lines.push({ text: `${padTo('Limits', 95)}${pools.join(' · ')}` })

  const next = machines.flatMap(m => (m.insights.scheduled && !isMissing(m.insights.scheduled) ? m.insights.scheduled : []))
    .filter((t): t is ScheduledTask & { nextRunAt: string } => t.enabled && t.nextRunAt !== null)
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0]
  if (next) lines.push({ text: `${padTo('Next run', 95)}${next.title} · in ${until(next.nextRunAt, now)}` })
  return lines
}

/** Today's spend across every machine that reports it, or null when none does. */
export function todaySpend(machines: Array<{ insights: Insights }>): number | null {
  let total: number | null = null
  for (const m of machines) {
    const usage = m.insights.usage
    if (usage && !isMissing(usage)) total = (total ?? 0) + usage.today.costUsd
  }
  return total
}

// --- scheduled tasks ----------------------------------------------------------------------------

/** The key of a choosable task line: machine id, then task id. */
export const taskKey = (machineId: string, taskId: string) => `task:${machineId}:${taskId}`

export function taskLines(machines: PageMachine[], now: number): PageLine[] {
  const several = machines.length > 1
  const lines: PageLine[] = []
  for (const m of machines) {
    if (several) lines.push({ text: `${m.online ? MARK.new : MARK.done} ${m.label}` })
    const tasks = m.insights.scheduled
    if (!tasks) { lines.push({ text: 'Scheduled tasks: loading…', dim: true }); continue }
    if (isMissing(tasks)) { lines.push({ text: `Scheduled tasks: ${tasks.missing}`, dim: true }); continue }
    if (!tasks.length) { lines.push({ text: 'No scheduled tasks. Ask a thread to schedule one.', dim: true }); continue }
    for (const t of tasks) {
      const failed = /fail|error/i.test(t.lastRunStatus ?? '')
      const mark = !t.enabled ? MARK.stop : failed ? MARK.fail : MARK.done
      const when = !t.enabled ? 'paused' : t.nextRunAt ? `in ${until(t.nextRunAt, now)}` : 'done'
      lines.push({ text: `${mark} ${padTo(t.title, 330)}${when}`, select: taskKey(m.id, t.id) })
    }
  }
  return lines
}

/** The visible slice of page lines, keeping the cursor's line (if any) in view. */
export function pageWindow(lines: PageLine[], top: number, rows: number, cursorLine: number): number {
  let start = Math.max(0, Math.min(top, Math.max(0, lines.length - rows)))
  if (cursorLine >= 0) {
    if (cursorLine < start) start = cursorLine
    else if (cursorLine >= start + rows) start = cursorLine - rows + 1
  }
  return start
}

/** Which page this is, as a strip of dots with the current one filled: "○○●○". The page names itself on the left. */
export function pageDots(pages: readonly string[], current: string): string {
  return pages.map(p => (p === current ? MARK.new : MARK.done)).join('')
}
