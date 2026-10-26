import { describe, expect, it } from 'vitest'
import { textWidth } from './font'
import {
  alignRight, chatBar, chatLines, clock, listLayers, listHeader, listStart, markFor,
  MAX_MESSAGES, NEW_ROW, rowY, scrollbar, spinner, levelGlyph, TEXT_W, threadRow, titleBadge,
} from './screens'
import type { PinnedThread, ThreadMessage } from '../t3/types'

const thread = (over: Partial<PinnedThread> = {}): PinnedThread => ({
  machineId: 'm', machineLabel: 'Mac', id: 'a', title: 'Fix login', project: 'app', status: 'completed',
  needsInput: false, updatedAt: '2026-01-01T00:00:00Z', runStartedAt: null, ...over,
})
const msg = (role: string, text: string, streaming = false): ThreadMessage => ({ id: text, role, text, streaming, createdAt: '' })
const NOW = Date.parse('2026-01-01T01:00:00Z')

describe('geometry', () => {
  it('fits 10 rows of 27 px inside 288 px', () => {
    expect(rowY(10)).toBeLessThanOrEqual(288)
  })
})

describe('marks', () => {
  it('ranks needs-you over running over the rest', () => {
    expect(markFor('running', true, false)).toBe('ask')
    expect(markFor('running', false, true)).toBe('run')
    expect(markFor('completed', false, true)).toBe('new')
    expect(markFor('completed', false, false)).toBe('done')
    expect(markFor('failed', false, false)).toBe('fail')
    expect(markFor('cancelled', false, false)).toBe('stop')
  })
})

describe('list', () => {
  const rows = [NEW_ROW, threadRow(thread({ status: 'running', runStartedAt: '2026-01-01T00:58:55Z' }), false, NOW, false), threadRow(thread({ title: 'x'.repeat(200) }), false, NOW, false)]
  it('puts the run timer and ages in the right column', () => {
    expect(rows[1].side).toBe('1:05')
    expect(rows[2].side).toBe('1h')
  })
  it('puts the selected row alone on the bright layer, at the same line position', () => {
    const { dim, bright } = listLayers(rows, 1, 0, 556)
    const d = dim.split('\n'), b = bright.split('\n')
    expect(d).toHaveLength(3)
    expect(b).toHaveLength(3)
    expect(b[1].startsWith('▶ ')).toBe(true)
    expect(d[1]).toBe('')
    expect(b[0]).toBe('')
    expect(d[0].startsWith('+ New thread')).toBe(true)
  })
  it('keeps every row on one line, side value right-aligned at the edge', () => {
    const { dim, bright } = listLayers(rows, 1, 0, 556)
    for (const line of [...dim.split('\n'), ...bright.split('\n')]) expect(textWidth(line)).toBeLessThanOrEqual(556)
    const running = bright.split('\n')[1]
    expect(running.trimEnd().endsWith('1:05')).toBe(true)
    expect(textWidth(running)).toBeGreaterThan(556 - 20)
  })
  it('right-aligns the side column', () => {
    const padded = alignRight('12h', 80)
    expect(padded.trimStart()).toBe('12h')
    expect(textWidth(padded)).toBeLessThanOrEqual(80)
    expect(textWidth(padded)).toBeGreaterThan(80 - 6)
  })
  it('scrolls the window minimally to keep the cursor visible', () => {
    expect(listStart(20, 0, 0, 9)).toBe(0)
    expect(listStart(20, 12, 0, 9)).toBe(4)
    expect(listStart(20, 5, 4, 9)).toBe(4)
    expect(listStart(20, 2, 4, 9)).toBe(2)
  })
  it('summarises with symbols', () => {
    expect(listHeader([thread({ status: 'running' }), thread({ needsInput: true }), thread()], 1)).toBe('PINNED 3   ▶ 1   ★ 1')
  })
})

describe('scrollbar', () => {
  it('is empty when everything fits', () => {
    expect(scrollbar(5, 0, 9)).toEqual({ track: '', thumb: '' })
  })
  it('puts the bright thumb where the view is, and the dim track everywhere else', () => {
    const top = scrollbar(18, 0, 9)
    expect(top.thumb.split('\n').slice(0, 5)).toEqual(['┃', '┃', '┃', '┃', '┃'])
    expect(top.track.split('\n').slice(0, 6)).toEqual(['', '', '', '', '', '│'])
    const bottom = scrollbar(18, 9, 9)
    expect(bottom.thumb.split('\n').at(-1)).toBe('┃')
    expect(bottom.track.split('\n')[0]).toBe('│')
  })
  it('sits at the bottom while the chat follows the latest', () => {
    const bar = chatBar(40, 8, 0)
    expect(bar.thumb.split('\n').at(-1)).toBe('┃')
    expect(bar.track.split('\n')[0]).toBe('│')
  })
})

describe('chat lines', () => {
  it('marks your lines, separates turns, and ends a streaming reply with an ellipsis', () => {
    expect(chatLines([msg('user', 'hi'), msg('system', 'x'), msg('assistant', 'hello', true)])).toEqual(['> hi', '', 'hello…'])
  })
  it('keeps your messages to one line, cut with an ellipsis', () => {
    const lines = chatLines([msg('user', 'word '.repeat(80)), msg('assistant', 'ok')])
    expect(lines[0].startsWith('> ')).toBe(true)
    expect(lines[0].endsWith('…')).toBe(true)
    expect(textWidth(lines[0])).toBeLessThanOrEqual(TEXT_W)
    expect(lines).toEqual([lines[0], '', 'ok'])
  })
  it('uses the full width but never exceeds it', () => {
    const lines = chatLines([msg('assistant', 'word '.repeat(200))])
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(TEXT_W)
    expect(textWidth(lines[0])).toBeGreaterThan(TEXT_W - 60)
  })
  it('only keeps the last few messages', () => {
    const many = Array.from({ length: 40 }, (_, i) => msg('assistant', `m${i}`))
    const lines = chatLines(many)
    expect(lines.filter(Boolean)).toHaveLength(MAX_MESSAGES)
    expect(lines.at(-1)).toBe('m39')
  })
  it('shows a message from another agent as one line with the sending thread name', () => {
    const fromAgent: ThreadMessage = { ...msg('user', 'GATE2 → DESK: #6707 not merged yet because the proof heading is missing'), createdBy: 'agent', senderThreadId: 't9' }
    const lines = chatLines([fromAgent, msg('assistant', 'On it.')], TEXT_W, MAX_MESSAGES, id => (id === 't9' ? 'Keel gate runner 2' : undefined))
    expect(lines[0].startsWith('▷ Keel gate runner 2: GATE2 → DESK')).toBe(true)
    expect(textWidth(lines[0])).toBeLessThanOrEqual(TEXT_W)
    expect(lines.slice(1)).toEqual(['', 'On it.'])
  })
  it('falls back to "agent" when the sending thread is unknown', () => {
    const lines = chatLines([{ ...msg('user', 'hi'), createdBy: 'agent' }])
    expect(lines).toEqual(['▷ agent: hi'])
  })
  it('collapses our voice prompt', () => {
    expect(chatLines([msg('user', 'Voice message from my Even G2 glasses, attached...')])).toEqual(['> (voice message)'])
  })
})

describe('live indicators', () => {
  it('cycles the spinner', () => {
    expect(new Set(Array.from({ length: 6 }, (_, i) => spinner(i))).size).toBeGreaterThan(3)
  })
  it('maps silence low and loud speech high', () => {
    expect(levelGlyph(0)).toBe('▁')
    expect(levelGlyph(32767)).toBe('█')
    expect(['▄', '▅', '▆']).toContain(levelGlyph(2500))
  })
  it('badges the title', () => {
    expect(titleBadge('run', 65_000)).toBe('▶ 1:05')
    expect(titleBadge('ask', null)).toBe('★ needs you')
    expect(clock(3_725_000)).toBe('1:02:05')
  })
})

import { approvalView, buildRows, choiceLayers, DONE_KEY, LESS_KEY, MORE_KEY, questionView } from './screens'

describe('answer screens', () => {
  const q = { header: 'Library', question: 'Which charting library should we use?', options: [{ label: 'Recharts', description: '98 kB' }, { label: 'Visx' }] }
  it('shows a single-choice question with radio marks and the header on the side', () => {
    const v = questionView(q, 0, 2, ['Visx'], false)
    expect(v.head).toBe('★ Question 1 of 2')
    expect(v.side).toBe('Library')
    expect(v.prompt).toEqual(['Which charting library should we use?'])
    expect(v.rows.map(r => `${r.mark} ${r.label}`)).toEqual(['○ Recharts', '● Visx'])
  })
  it('adds checkboxes and a Done row for multi-select', () => {
    const v = questionView({ ...q, multiSelect: true }, 1, 2, ['Recharts'], false)
    expect(v.rows.map(r => r.mark)).toEqual(['■', '□', '▶'])
    expect(v.rows.at(-1)).toMatchObject({ key: DONE_KEY, label: 'Done (1)' })
  })
  it('says when the answer was given by voice', () => {
    expect(questionView(q, 0, 1, [], true).side).toBe('● answered by voice')
    expect(questionView(q, 0, 1, [], false).head).toBe('★ Question')
  })
  it('shows approvals with their options and a muted deny', () => {
    const v = approvalView('Run a command?', 'pnpm db:migrate', [{ decision: 'accept', label: 'Allow' }, { decision: 'decline', label: 'Deny' }])
    expect(v.head).toBe('★ Run a command?')
    expect(v.rows.map(r => `${r.mark} ${r.label}`)).toEqual(['▶ Allow', '□ Deny'])
  })
  it('lays choices out one per line, cursor row bright, details only when they fit', () => {
    const v = questionView(q, 0, 1, [], false)
    const { dim, bright } = choiceLayers(v.rows, 1, 0, 5)
    expect(dim.split('\n')).toEqual(['○ Recharts   98 kB', ''])
    expect(bright.split('\n')).toEqual(['', '○ Visx'])
  })
})

describe('buildRows', () => {
  const many = Array.from({ length: 8 }, (_, i) => thread({ id: `t${i}`, title: `Thread ${i}` }))
  const none = () => false
  it('shows everything when it is short, with no Show more row', () => {
    const rows = buildRows(many.slice(0, 5), none, NOW, false, false)
    expect(rows.map(r => r.key)).toEqual(['new', 'm:t0', 'm:t1', 'm:t2', 'm:t3', 'm:t4'])
  })
  it('starts with five threads and a Show more row that counts the rest', () => {
    const rows = buildRows(many, none, NOW, false, false)
    expect(rows).toHaveLength(1 + 5 + 1)
    expect(rows.at(-1)).toMatchObject({ key: MORE_KEY, mark: 'more', title: 'Show 3 more' })
  })
  it('expands to all of them with a Show less row at the end', () => {
    const rows = buildRows(many, none, NOW, false, true)
    expect(rows).toHaveLength(1 + 8 + 1)
    expect(rows.at(-1)).toMatchObject({ key: LESS_KEY, mark: 'less', title: 'Show less' })
    expect(rows[8].key).toBe('m:t7')
  })
  it('draws the toggle rows with arrows', () => {
    const rows = buildRows(many, none, NOW, false, false)
    const { dim } = listLayers(rows, 0, 0, 556, 10)
    expect(dim.split('\n').at(-1)).toBe('▼ Show 3 more')
  })
})
