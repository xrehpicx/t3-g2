import type { ProjectShell, ShellSnapshot, ThreadShell } from './types'

export interface ShellState {
  threads: Map<string, ThreadShell>
  projects: Map<string, ProjectShell>
  sequence: number
}

export interface ShellItem {
  kind: string
  sequence?: number
  snapshot?: ShellSnapshot & { snapshotSequence?: number }
  thread?: ThreadShell
  threadId?: string
  location?: 'active' | 'archive'
  project?: ProjectShell
  projectId?: string
}

export function mergeSnapshot(state: ShellState, snapshot: ShellSnapshot & { snapshotSequence?: number }): ShellState {
  const threads = new Map(state.threads)
  for (const thread of snapshot.threads) threads.set(thread.id, thread)
  const projects = new Map(state.projects)
  for (const project of snapshot.projects) projects.set(project.id, project)
  return { threads, projects, sequence: Math.max(state.sequence, snapshot.snapshotSequence ?? 0) }
}

export const emptyShell = (): ShellState => ({ threads: new Map(), projects: new Map(), sequence: 0 })

export function fromSnapshot(snapshot: ShellSnapshot & { snapshotSequence?: number }): ShellState {
  return {
    threads: new Map(snapshot.threads.map(t => [t.id, t])),
    projects: new Map(snapshot.projects.map(p => [p.id, p])),
    sequence: snapshot.snapshotSequence ?? 0,
  }
}

/** Applies one pushed shell item. Returns the same state object when nothing changed. */
export function applyShellItem(state: ShellState, item: ShellItem): ShellState {
  switch (item.kind) {
    case 'snapshot':
      // The first snapshot of a connection is complete (see `replaceShell`); the ones that follow are
      // partial batches (for example projects with resolved repository identity), so they merge.
      return item.snapshot ? mergeSnapshot(state, item.snapshot) : state
    case 'thread.updated': {
      if (!item.thread) return state
      const threads = new Map(state.threads)
      // Archived threads leave the active set rather than lingering with a stale status.
      if (item.location === 'archive') threads.delete(item.thread.id)
      else threads.set(item.thread.id, item.thread)
      return { ...state, threads, sequence: Math.max(state.sequence, item.sequence ?? 0) }
    }
    case 'thread.removed': {
      if (!item.threadId || !state.threads.has(item.threadId)) return state
      const threads = new Map(state.threads)
      threads.delete(item.threadId)
      return { ...state, threads, sequence: Math.max(state.sequence, item.sequence ?? 0) }
    }
    case 'project.updated': {
      if (!item.project) return state
      const projects = new Map(state.projects)
      projects.set(item.project.id, item.project)
      return { ...state, projects, sequence: Math.max(state.sequence, item.sequence ?? 0) }
    }
    case 'project.removed': {
      if (!item.projectId || !state.projects.has(item.projectId)) return state
      const projects = new Map(state.projects)
      projects.delete(item.projectId)
      return { ...state, projects }
    }
    default:
      return state
  }
}
