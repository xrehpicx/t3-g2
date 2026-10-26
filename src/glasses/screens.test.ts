import { describe, expect, it } from 'vitest'
import { SAFETY_PX, textWidth } from './font'
import {
  alignRight, CLOCK_W, listDetail, titleWithDetail, formatClock, chatBar, chatLines, clock, listLayers, listHeader, listStart, markFor,
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
  const rows = [NEW_ROW, threadRow(thread({ status: 'running', runStartedAt: '2026-01-01T00:58:55Z' }), false, NOW), threadRow(thread({ title: 'x'.repeat(200) }), false, NOW)]
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
    expect(textWidth(padded)).toBeLessThanOrEqual(80 - SAFETY_PX)
    expect(textWidth(padded)).toBeGreaterThan(80 - SAFETY_PX - 6)
  })
  it('scrolls the window minimally to keep the cursor visible', () => {
    expect(listStart(20, 0, 0, 9)).toBe(0)
    expect(listStart(20, 12, 0, 9)).toBe(4)
    expect(listStart(20, 5, 4, 9)).toBe(4)
    expect(listStart(20, 2, 4, 9)).toBe(2)
  })
  it('reads what needs you first, then what is running, and says so when it is quiet', () => {
    const mac = [{ label: 'MacBook Pro', connected: true }]
    expect(listHeader([thread({ needsInput: true }), thread({ needsInput: true })], mac).left).toBe('★ 2 need you')
    expect(listHeader([thread()], mac).left).toBe('All quiet')
    expect(listHeader([], mac).left).toBe('Nothing pinned')
  })
  it('names the machine on the right, and says when some are offline', () => {
    expect(listHeader([], [{ label: 'MacBook Pro', connected: true }]).right).toBe('● MacBook Pro')
    expect(listHeader([], [{ label: 'MacBook Pro', connected: false }]).right).toBe('○ MacBook Pro')
    const two = [{ label: 'a', connected: true }, { label: 'b', connected: true }]
    expect(listHeader([], two).right).toBe('● 2 machines')
    expect(listHeader([], [two[0], { label: 'b', connected: false }]).right).toBe('○ 1 of 2 online')
    expect(listHeader([], []).right).toBe('')
  })
  it('summarises with symbols', () => {
    const mac = [{ label: 'MacBook Pro', connected: true }]
    expect(listHeader([thread({ status: 'running' }), thread({ needsInput: true }), thread()], mac).left).toBe('★ 1 needs you   ▶ 1 running')
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

import { DEFAULT_VOICE_PROMPT } from '../config'
import { voiceText } from '../settings'
import { approvalView, buildRows, choiceLayers, DONE_KEY, loadedFor, PAGE_SIZE, questionView } from './screens'

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
  const many = Array.from({ length: 25 }, (_, i) => thread({ id: `t${i}`, title: `Thread ${i}` }))
  const none = () => false
  it('starts with + New thread and the first ten threads', () => {
    const rows = buildRows(many, none, NOW)
    expect(rows).toHaveLength(1 + PAGE_SIZE)
    expect(rows[0].key).toBe('new')
    expect(rows.at(-1)?.key).toBe('m:t9')
  })
  it('shows everything when there are fewer than a page', () => {
    expect(buildRows(many.slice(0, 4), none, NOW)).toHaveLength(5)
  })
  it('has no show more row: more threads just load as you scroll', () => {
    expect(buildRows(many, none, NOW).some(r => /more|less/i.test(r.title))).toBe(false)
    expect(buildRows(many, none, NOW, undefined, 20)).toHaveLength(21)
  })
})

describe('loadedFor', () => {
  it('loads the next ten when the cursor reaches the last loaded thread', () => {
    expect(loadedFor(10, 10, 25)).toBe(20)
    expect(loadedFor(20, 20, 25)).toBe(25)
  })
  it('does nothing while the cursor is earlier in the list', () => {
    expect(loadedFor(10, 5, 25)).toBe(10)
    expect(loadedFor(10, 9, 25)).toBe(10)
  })
  it('never loads past the total and keeps what is loaded', () => {
    expect(loadedFor(25, 25, 25)).toBe(25)
    expect(loadedFor(20, 3, 25)).toBe(20)
  })
})

describe('a ticking timer never wraps the row', () => {
  it('keeps the whole line inside the width for every second of a timer', () => {
    for (let seconds = 0; seconds < 3600; seconds += 7) {
      const row = threadRow(thread({ status: 'running', runStartedAt: new Date(NOW - seconds * 1000).toISOString() }), false, NOW)
      const { bright } = listLayers([row], 0, 0, 576)
      expect(textWidth(bright)).toBeLessThanOrEqual(576 - SAFETY_PX)
    }
  })
})

describe('density', () => {
  it('compact chat drops the blank line between messages', () => {
    const ms = [msg('user', 'hi'), msg('assistant', 'hello')]
    expect(chatLines(ms)).toEqual(['> hi', '', 'hello'])
    expect(chatLines(ms, undefined, undefined, undefined, false)).toEqual(['> hi', 'hello'])
  })
})

describe('voice instructions in the chat', () => {
  it('collapse to "(voice message)", with the reply-size note appended', () => {
    expect(chatLines([msg('user', voiceText({ voicePrompt: DEFAULT_VOICE_PROMPT, density: 'compact' }))])).toEqual(['> (voice message)'])
  })
})

describe('formatClock', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 27, h, m)
  it('formats 12-hour, 24-hour and hidden', () => {
    expect(formatClock(at(15, 5), '12h')).toBe('3:05 PM')
    expect(formatClock(at(0, 7), '12h')).toBe('12:07 AM')
    expect(formatClock(at(12, 0), '12h')).toBe('12:00 PM')
    expect(formatClock(at(15, 5), '24h')).toBe('15:05')
    expect(formatClock(at(0, 7), '24h')).toBe('00:07')
    expect(formatClock(at(15, 5), 'off')).toBe('')
  })
  it('always fits the room reserved for it', () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 8, 41, 59]) {
      const text = formatClock(at(h, m), '12h')
      expect(textWidth(text) + SAFETY_PX).toBeLessThanOrEqual(CLOCK_W)
    }
  })
})

describe('list details', () => {
  const t = (over: Partial<PinnedThread> = {}) => thread({ title: 'Fix login', project: 'storefront', machineLabel: 'imaimain', status: 'running', ...over })
  const glance = { step: '$ pnpm test', reply: '## Done\n\nAll **green**.' }
  it('shows only what is chosen, in a fixed order', () => {
    expect(listDetail(['activity'], t(), glance, true)).toBe('$ pnpm test')
    expect(listDetail(['machine', 'project', 'activity'], t(), glance, true)).toBe('$ pnpm test · storefront · imaimain')
    expect(listDetail([], t(), glance, true)).toBe('')
  })
  it('shows what a thread is doing only while it is running', () => {
    expect(listDetail(['activity', 'project'], t({ status: 'completed' }), glance, false)).toBe('storefront')
    expect(listDetail(['activity'], t(), undefined, false)).toBe('')
  })
  it('flattens the latest reply to one plain line', () => {
    expect(listDetail(['reply'], t(), glance, false)).toBe('Done All green.')
  })
  it('names the machine only when there are several', () => {
    expect(listDetail(['machine'], t(), glance, false)).toBe('')
  })
  it('fits the detail beside the title without overflowing', () => {
    const room = 400
    for (const title of ['Hi', 'Fix flaky checkout e2e test', 'x'.repeat(120)]) {
      const line = titleWithDetail(title, '$ pnpm test:e2e checkout --repeat 50', room)
      expect(textWidth(line)).toBeLessThanOrEqual(room)
    }
    expect(titleWithDetail('Fix flaky checkout e2e test', '$ pnpm test', room)).toContain(' · $ pnpm test')
  })
  it('keeps the title when there is no room to say anything useful', () => {
    expect(titleWithDetail('Fix flaky checkout e2e test', 'detail', 120)).not.toContain('·')
  })
  it('lets a long title keep most of the line', () => {
    const line = titleWithDetail('x'.repeat(120), 'detail text here', 400)
    expect(textWidth(line.split(' · ')[0])).toBeGreaterThanOrEqual(400 * 0.5)
  })
})
