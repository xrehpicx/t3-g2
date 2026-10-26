import { isMissing, type Insights, type ProviderLimits } from '../t3/insights'
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

function limitLines(machine: PageMachine, limits: ProviderLimits[], now: number): PageLine[] {
  const lines: PageLine[] = []
  for (const p of limits.filter(l => l.windows.length)) {
    const key = `${machine.id}:${p.instanceId}`
    p.windows.forEach((w, i) => {
      const reset = w.resetsAt ? `  ${until(w.resetsAt, now)}` : ''
      const pct = `${Math.round(w.usedPercent)}%`
      lines.push({ text: `${padTo(i ? '' : p.name, 90)}${padTo(w.label, 90)}${meter(w.usedPercent)} ${padTo(pct, 52)}${reset}`, select: key })
    })
    if (p.credits) lines.push({ text: `${padTo('', 90)}○ ${plural(p.credits, 'reset credit')} · tap the limit to use one`, dim: true })
  }
  const quiet = limits.filter(l => !l.windows.length).map(l => l.name)
  if (quiet.length) lines.push({ text: `${quiet.join(', ')}: no limits reported`, dim: true })
  return lines
}

export function usageLines(machines: PageMachine[], now: number): PageLine[] {
  const several = machines.length > 1
  const lines: PageLine[] = []
  for (const m of machines) {
    if (several) lines.push({ text: `${m.online ? MARK.new : MARK.done} ${m.label}` })
    const { limits, usage } = m.insights
    if (!limits) lines.push({ text: 'Limits: loading…', dim: true })
    else if (isMissing(limits)) lines.push({ text: `Limits: ${limits.missing}`, dim: true })
    else lines.push(...limitLines(m, limits, now))

    if (!usage) lines.push({ text: 'Spend: loading…', dim: true })
    else if (isMissing(usage)) lines.push({ text: `Spend: ${usage.missing}`, dim: true })
    else {
      const t = usage.today, w = usage.week
      lines.push({ text: `${padTo('Today', 80)}${padTo(money(t.costUsd), 80)}${padTo(`${tokens(t.tokens)} tokens`, 130)}${Math.round(t.cachedShare * 100)}% cached` })
      lines.push({ text: `${padTo('7 days', 80)}${padTo(money(w.costUsd), 80)}${padTo(`${tokens(w.tokens)} tokens`, 130)}${Math.round(w.cachedShare * 100)}% cached` })
      if (usage.models.length) {
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
  machines: PageMachine[]
  now: number
}

export function dashboardLines({ threads, unread, step, machines, now }: DashboardInput): PageLine[] {
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

  for (const t of threads.filter(t => t.needsInput || t.status === 'waiting').slice(0, 2)) lines.push({ text: `${MARK.ask} ${t.title}`, dim: true })
  for (const t of threads.filter(t => isBusy(t.status) && !t.needsInput).slice(0, 3)) {
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

  const spends = machines.map(m => m.insights.usage).filter((u): u is Exclude<typeof u, null | { missing: string }> => Boolean(u) && !isMissing(u))
  if (spends.length) {
    const today = spends.reduce((s, u) => s + u.today.costUsd, 0)
    const week = spends.reduce((s, u) => s + u.week.costUsd, 0)
    const toks = spends.reduce((s, u) => s + u.today.tokens, 0)
    lines.push({ text: `${padTo('Spend', 95)}today ${money(today)} · ${tokens(toks)} tokens · 7 days ${money(week)}` })
  }

  const busiest = machines.flatMap(m => (m.insights.limits && !isMissing(m.insights.limits) ? m.insights.limits : []))
    .filter(p => p.windows.length)
    .map(p => ({ name: p.name, w: p.windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a)) }))
  if (busiest.length) {
    const parts = [...new Set(busiest.map(b => `${b.name} ${Math.round(b.w.usedPercent)}% ${b.w.label.toLowerCase()}`))]
    lines.push({ text: `${padTo('Limits', 95)}${parts.join(' · ')}` })
  }

  const next = machines.flatMap(m => (m.insights.scheduled && !isMissing(m.insights.scheduled) ? m.insights.scheduled : []))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0]
  if (next) lines.push({ text: `${padTo('Next run', 95)}${next.title} · in ${until(next.nextRunAt, now)}` })
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
