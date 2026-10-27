import { describe, expect, it } from 'vitest'
import { extractSvg, hashText, imageSize, safeSvg } from './svgImage'

const SVG = '<svg viewBox="0 0 288 120"><polyline points="0,100 50,60 100,80" stroke="white" fill="none"/></svg>'

describe('inline SVG in a reply', () => {
  it('splits a reply into its text and the SVG, fenced or bare', () => {
    expect(extractSvg(`CI minutes this week\n\n${SVG}\nlast: 4m`)).toEqual({ text: 'CI minutes this week\n\nlast: 4m', svg: SVG })
    expect(extractSvg('Chart\n```svg\n' + SVG + '\n```\ndone').svg).toBe(SVG)
    expect(extractSvg('Chart\n```svg\n' + SVG + '\n```\ndone').text).toBe('Chart\n\ndone')
    expect(extractSvg('just text')).toEqual({ text: 'just text', svg: null })
  })
  it('refuses anything that could run or fetch', () => {
    expect(safeSvg(SVG)).toBe(true)
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="x()"></svg>',
      '<svg><foreignObject></foreignObject></svg>',
      '<svg><image href="https://x/y.png"/></svg>',
      '<svg><use href="https://x/y.svg#a"/></svg>',
      '<svg style="background:url(https://x/y.png)"></svg>',
      '<svg><style>@import "x.css"</style></svg>',
    ]) expect(safeSvg(bad)).toBe(false)
    expect(safeSvg('<svg><use href="#a"/><defs><linearGradient id="a"/></defs><rect fill="url(#a)"/></svg>')).toBe(false) // <use> is out entirely
    expect(safeSvg('<svg><defs><linearGradient id="a"/></defs><rect fill="url(#a)"/></svg>')).toBe(true)
  })
  it('sizes the picture to the glasses: at most 288 x 144, keeping proportions', () => {
    expect(imageSize('<svg viewBox="0 0 288 120">')).toEqual({ w: 288, h: 120 })
    expect(imageSize('<svg viewBox="0 0 100 100">')).toEqual({ w: 144, h: 144 })
    expect(imageSize('<svg width="600" height="150">')).toEqual({ w: 288, h: 72 })
    expect(imageSize('<svg>')).toEqual({ w: 288, h: 121 })
    expect(imageSize('<svg viewBox="0 0 1000 5">').h).toBeGreaterThanOrEqual(20)
  })
  it('hashes text stably and differently', () => {
    expect(hashText(SVG)).toBe(hashText(SVG))
    expect(hashText(SVG)).not.toBe(hashText(SVG + ' '))
  })
})
