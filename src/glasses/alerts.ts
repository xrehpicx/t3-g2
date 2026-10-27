import type { AlertSettings } from '../settings'
import { isAsking, isBusy } from '../t3/pinned'
import type { PinnedThread, ThreadStatus } from '../t3/types'
import { MARK } from './screens'

/** What an alert does when you tap it. */
export type AlertAction = { thread: { machineId: string; threadId: string } } | 'usage'

export interface Alert {
  /** One short line for the header. */
  text: string
  /** Stable, so the same change is announced once. */
  key: string
  action?: AlertAction
}

export interface ThreadSnap {
  title: string
  status: ThreadStatus
  needsInput: boolean
  machineId: string
  threadId: string
  /** The thread backs a page, so finishing means the page was rewritten. */
  page: boolean
}

export type SnapMap = Map<string, ThreadSnap>

const keyOf = (t: { machineId: string; id: string }) => `${t.machineId}:${t.id}`

export function snapshotOf(threads: PinnedThread[], pageKeys: ReadonlySet<string> = new Set()): SnapMap {
  return new Map(threads.map(t => [keyOf(t), { title: t.title, status: t.status, needsInput: t.needsInput, machineId: t.machineId, threadId: t.id, page: pageKeys.has(keyOf(t)) }]))
}

/**
 * What changed between two looks at the threads: a thread started waiting on you, finished, or failed.
 * A thread seen for the first time is not a change, and neither is anything while `prev` is null (the
 * first look after start-up).
 */
export function threadAlerts(prev: SnapMap | null, next: SnapMap, settings: AlertSettings): Alert[] {
  if (!prev) return []
  const alerts: Alert[] = []
  for (const [key, now] of next) {
    const before = prev.get(key)
    if (!before) continue
    const action = { thread: { machineId: now.machineId, threadId: now.threadId } }
    if (settings.needsYou && isAsking(now) && !isAsking(before)) {
      alerts.push({ key: `${key}:ask`, text: `${MARK.ask} ${now.title} needs you`, action })
    } else if (now.status === 'failed' && before.status !== 'failed') {
      if (settings.failed) alerts.push({ key: `${key}:fail`, text: `${MARK.fail} ${now.title} failed`, action })
    } else if (now.status === 'completed' && isBusy(before.status) && !isAsking(now)) {
      if (now.page ? settings.pageUpdated : settings.finished) {
        alerts.push({ key: `${key}:done`, text: now.page ? `${MARK.new} ${now.title} updated` : `${MARK.done} ${now.title} finished`, action })
      }
    }
  }
  return alerts
}

/** Warnings not already showing, and the set of warnings that are showing now (so a recovered pool can warn again). */
export function freshWarnings<W extends { key: string }>(warnings: W[], active: ReadonlySet<string>): { fresh: W[]; active: Set<string> } {
  return { fresh: warnings.filter(w => !active.has(w.key)), active: new Set(warnings.map(w => w.key)) }
}

/** Collapses a burst of alerts into one line: the newest, and how many others came with it. */
export function summarize(alerts: Alert[]): Alert | null {
  const last = alerts.at(-1)
  if (!last) return null
  return alerts.length > 1 ? { ...last, text: `${last.text}  +${alerts.length - 1}` } : last
}

/** Today's spend is at or over the daily budget. */
export const overBudget = (spent: number | null, budget: number) => budget > 0 && spent !== null && spent >= budget
