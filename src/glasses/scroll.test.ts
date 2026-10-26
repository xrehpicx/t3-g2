import { describe, expect, it } from 'vitest'
import { contentChanged, initialScroll, jumpToBottom, scrollNewer, scrollOlder, STEP, visible } from './scroll'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`)
const ROWS = 5

describe('following the bottom', () => {
  it('starts pinned to the newest lines', () => {
    const view = visible(lines(20), initialScroll(), ROWS)
    expect(view.lines).toEqual(['l15', 'l16', 'l17', 'l18', 'l19'])
    expect(view.older).toBe(true)
    expect(view.newer).toBe(false)
  })
  it('stays pinned as output arrives', () => {
    let s = contentChanged(initialScroll(), 20, ROWS)
    s = contentChanged(s, 26, ROWS)
    expect(s).toMatchObject({ fromBottom: 0, following: true, unseen: 0, total: 26 })
    expect(visible(lines(26), s, ROWS).lines.at(-1)).toBe('l25')
  })
  it('shows a short transcript whole, with no arrows', () => {
    const view = visible(lines(3), initialScroll(), ROWS)
    expect(view.lines).toHaveLength(3)
    expect(view.older || view.newer).toBe(false)
  })
})

describe('pausing when the user scrolls up', () => {
  const at = contentChanged(initialScroll(), 20, ROWS)
  it('pauses on the first swipe up and moves by a step', () => {
    const s = scrollOlder(at, 20, ROWS)
    expect(s).toMatchObject({ following: false, fromBottom: STEP })
    expect(visible(lines(20), s, ROWS).lines.at(-1)).toBe('l17')
  })
  it('keeps the same lines on screen when output arrives, and counts what landed below', () => {
    let s = scrollOlder(scrollOlder(at, 20, ROWS), 20, ROWS)
    const before = visible(lines(20), s, ROWS).lines
    s = contentChanged(s, 23, ROWS)
    expect(visible(lines(23), s, ROWS).lines).toEqual(before)
    expect(s.unseen).toBe(3)
    expect(s.following).toBe(false)
    s = contentChanged(s, 24, ROWS)
    expect(s.unseen).toBe(4)
  })
  it('cannot scroll past the oldest line', () => {
    let s = at
    for (let i = 0; i < 20; i++) s = scrollOlder(s, 20, ROWS)
    expect(s.fromBottom).toBe(15)
    expect(visible(lines(20), s, ROWS).lines[0]).toBe('l0')
    expect(visible(lines(20), s, ROWS).older).toBe(false)
  })
  it('ignores swipes when everything already fits', () => {
    const fits = contentChanged(initialScroll(), 3, ROWS)
    expect(scrollOlder(fits, 3, ROWS)).toBe(fits)
  })
})

describe('resuming', () => {
  const paused = (() => {
    let s = contentChanged(initialScroll(), 30, ROWS)
    for (let i = 0; i < 4; i++) s = scrollOlder(s, 30, ROWS)
    return contentChanged(s, 33, ROWS)
  })()
  it('steps back toward the bottom without resuming too early', () => {
    const s = scrollNewer(paused, 33, ROWS)
    expect(s.following).toBe(false)
    expect(s.fromBottom).toBe(paused.fromBottom - STEP)
  })
  it('snaps to the bottom and resumes once close enough, clearing the new-lines count', () => {
    let s = paused
    while (!s.following) s = scrollNewer(s, 33, ROWS)
    expect(s).toMatchObject({ fromBottom: 0, following: true, unseen: 0 })
  })
  it('jumpToBottom resumes immediately (used after sending a message)', () => {
    expect(jumpToBottom(paused)).toMatchObject({ fromBottom: 0, following: true, unseen: 0 })
  })
  it('does nothing when already following', () => {
    const s = contentChanged(initialScroll(), 20, ROWS)
    expect(scrollNewer(s, 20, ROWS)).toBe(s)
  })
})
