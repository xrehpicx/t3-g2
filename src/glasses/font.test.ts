import { describe, expect, it } from 'vitest'
import { fitWidth, renderable, SAFETY_PX, textWidth, wrapWidth } from './font'

describe('font metrics', () => {
  it('sums measured advances', () => {
    expect(textWidth('il')).toBe(9)
    expect(textWidth('mm')).toBe(32)
    expect(textWidth('●')).toBe(20)
  })
  it('treats unknown glyphs as full-width', () => {
    expect(textWidth('日')).toBe(20)
  })
  it('swaps glyphs the font drops', () => {
    expect(renderable('use `npm`')).toBe("use 'npm'")
  })
})

describe('fitWidth', () => {
  it('leaves headroom at the end of the line', () => {
    expect(textWidth(fitWidth('a'.repeat(100), 120))).toBeLessThanOrEqual(120 - SAFETY_PX)
  })
  it('keeps text that fits', () => {
    expect(fitWidth('hello', 200)).toBe('hello')
  })
  it('truncates with an ellipsis inside the budget', () => {
    const out = fitWidth('a'.repeat(100), 120)
    expect(out.endsWith('…')).toBe(true)
    expect(textWidth(out)).toBeLessThanOrEqual(120)
  })
})

describe('wrapWidth', () => {
  it('never produces a line wider than the budget', () => {
    const text = 'The quick brown fox jumps over the lazy dog. WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW and more words here.'
    for (const line of wrapWidth(text, 200)) expect(textWidth(line)).toBeLessThanOrEqual(200)
  })
  it('fills lines rather than breaking early', () => {
    const lines = wrapWidth('aaa bbb ccc ddd', textWidth('aaa bbb') + SAFETY_PX)
    expect(lines).toEqual(['aaa bbb', 'ccc ddd'])
  })
  it('keeps blank lines between paragraphs', () => {
    expect(wrapWidth('one\n\ntwo', 300)).toEqual(['one', '', 'two'])
  })
})
