export type ThreadStatus =
  | 'idle' | 'preparing' | 'queued' | 'starting' | 'running' | 'waiting'
  | 'completed' | 'interrupted' | 'failed' | 'cancelled' | 'rolled_back'

export interface ThreadShell {
  id: string
  projectId: string
  title: string
  status: ThreadStatus
  pinnedAt?: string | null
  pinOrderKey?: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
  lastVisitedAt?: string | null
  pendingRuntimeRequest: unknown | null
  activityRunStartedAt?: string | null
  /** Status of the run that is live right now. Wins over `status`, which can lag (a steer cancels the old run). */
  activityRunStatus?: string | null
  settledOverride?: 'settled' | 'active' | null
  snoozedUntil?: string | null
  lineage: { relationshipToParent?: string | null }
}

export interface ProjectShell {
  id: string
  title: string
}

export interface ShellSnapshot {
  threads: ThreadShell[]
  projects: ProjectShell[]
}

export interface ThreadMessage {
  id: number | string
  role: 'user' | 'assistant' | string
  text: string
  streaming: boolean
  createdAt: string
}

export interface ThreadBounded {
  projection: { messages: ThreadMessage[] }
}

export interface PinnedThread {
  machineId: string
  machineLabel: string
  id: string
  title: string
  project: string
  status: ThreadStatus
  needsInput: boolean
  updatedAt: string
  /** Set while a run is active; drives the live elapsed timer. */
  runStartedAt: string | null
}
