import type { PinnedThread, ShellSnapshot, ThreadShell, ThreadStatus } from './types'

const BUSY = new Set(['preparing', 'queued', 'starting', 'running', 'waiting'])

export const isBusy = (status: string) => BUSY.has(status)

/**
 * What the thread is doing now. `status` reflects the latest finished run, so after a steer it reads
 * `cancelled` while the replacement run is going; `activityRunStatus` is the live run when there is one.
 */
export function effectiveStatus(t: Pick<ThreadShell, 'status' | 'activityRunStatus'>): ThreadStatus {
  const live = t.activityRunStatus
  return live && BUSY.has(live) ? (live as ThreadStatus) : t.status
}

export const isSnoozed = (t: Pick<ThreadShell, 'snoozedUntil'>, now = Date.now()) =>
  Boolean(t.snoozedUntil) && Date.parse(t.snoozedUntil!) > now

/**
 * Shown on the glasses: pinned and not settled, snoozed, archived or deleted (T3's rules: settled is
 * `settledOverride === 'settled'`, snoozed is `snoozedUntil` in the future). Subagent children never show.
 */
export const isGlassesThread = (t: ThreadShell, now = Date.now()) => Boolean(t.pinnedAt) && isOpenThread(t, now)

/** Not settled, snoozed, archived or deleted, and not a subagent's: a thread you would actually pick up. */
export const isOpenThread = (t: ThreadShell, now = Date.now()) =>
  t.settledOverride !== 'settled' && !isSnoozed(t, now) &&
  !t.archivedAt && !t.deletedAt && t.lineage.relationshipToParent !== 'subagent'

/** The rest of your chats: open threads that are not pinned. */
export const isOtherThread = (t: ThreadShell, now = Date.now()) => !t.pinnedAt && isOpenThread(t, now)

/** Same ordering as the T3 sidebar's pinned block: keyed threads first, then newest-created. */
function byPinOrder(a: ThreadShell, b: ThreadShell): number {
  const ka = a.pinOrderKey ?? null
  const kb = b.pinOrderKey ?? null
  if (ka !== null && kb !== null) return ka < kb ? -1 : ka > kb ? 1 : a.id.localeCompare(b.id)
  if (ka !== null) return -1
  if (kb !== null) return 1
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)
}

export function pinnedThreads(snapshot: ShellSnapshot, machine = { id: '', label: '' }): PinnedThread[] {
  const projects = new Map(snapshot.projects.map(p => [p.id, p.title]))
  return snapshot.threads
    .filter(t => isGlassesThread(t))
    .sort(byPinOrder)
    .map(t => toPinned(t, projects, machine))
}

export function toPinned(t: ThreadShell, projects: Map<string, string>, machine: { id: string; label: string }): PinnedThread {
  return {
      machineId: machine.id,
      machineLabel: machine.label,
      id: t.id,
      title: t.title,
      project: projects.get(t.projectId) ?? '',
      status: effectiveStatus(t),
      needsInput: t.pendingRuntimeRequest !== null,
      updatedAt: t.updatedAt,
      runStartedAt: isBusy(effectiveStatus(t)) ? t.activityRunStartedAt ?? null : null,
  }
}

/** True when the thread is waiting on you: a question, an approval, or a status of `waiting`. */
export const isAsking = (t: Pick<PinnedThread, 'needsInput' | 'status'>) => t.needsInput || t.status === 'waiting'

/** Threads that are waiting on you first, then the rest. Both groups keep their pin order. */
export function askingFirst<T extends Pick<PinnedThread, 'needsInput' | 'status'>>(threads: T[]): T[] {
  return [...threads.filter(isAsking), ...threads.filter(t => !isAsking(t))]
}
