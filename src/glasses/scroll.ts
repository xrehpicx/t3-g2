/**
 * Chat-style scrolling over a list of wrapped lines.
 *
 * - Pinned to the bottom by default: new output scrolls into view on its own.
 * - Swiping up pauses that. While paused the view stays put as output arrives, and we count what
 *   landed below so the user knows there is more.
 * - Swiping back down to within a step of the bottom snaps to it and resumes following.
 */
export interface ScrollState {
  /** Lines between the bottom of the view and the end of the transcript. 0 = at the bottom. */
  fromBottom: number
  following: boolean
  /** Lines that arrived below the view while paused. */
  unseen: number
  /** Transcript length last time we saw it, to measure growth. */
  total: number
}

export const STEP = 2

export const initialScroll = (): ScrollState => ({ fromBottom: 0, following: true, unseen: 0, total: 0 })

const maxOffset = (total: number, rows: number) => Math.max(0, total - rows)

/** Call whenever the transcript length changes. */
export function contentChanged(state: ScrollState, total: number, rows: number): ScrollState {
  if (total === state.total) return state
  if (state.following) return { fromBottom: 0, following: true, unseen: 0, total }
  const grew = Math.max(0, total - state.total)
  // Keep the same lines on screen: push the offset out by however much was appended.
  const fromBottom = Math.min(maxOffset(total, rows), state.fromBottom + grew)
  return { fromBottom, following: fromBottom === 0, unseen: fromBottom > 0 ? state.unseen + grew : 0, total }
}

export function scrollOlder(state: ScrollState, total: number, rows: number): ScrollState {
  const fromBottom = Math.min(maxOffset(total, rows), state.fromBottom + STEP)
  if (fromBottom === state.fromBottom) return state
  return { ...state, fromBottom, following: false }
}

export function scrollNewer(state: ScrollState, total: number, rows: number): ScrollState {
  void total
  void rows
  if (state.following) return state
  const next = state.fromBottom - STEP
  // Close enough to the bottom: land on it and resume following.
  if (next <= STEP / 2) return { ...state, fromBottom: 0, following: true, unseen: 0 }
  return { ...state, fromBottom: next }
}

export const jumpToBottom = (state: ScrollState): ScrollState => ({ ...state, fromBottom: 0, following: true, unseen: 0 })

export interface View {
  lines: string[]
  /** More lines exist above the view. */
  older: boolean
  /** More lines exist below the view. */
  newer: boolean
}

export function visible(lines: string[], state: ScrollState, rows: number): View {
  const end = Math.max(0, lines.length - state.fromBottom)
  const start = Math.max(0, end - rows)
  return { lines: lines.slice(start, end), older: start > 0, newer: end < lines.length }
}
