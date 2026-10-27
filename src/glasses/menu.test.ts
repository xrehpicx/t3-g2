import { describe, expect, it } from 'vitest'
import { menuLabel } from './controller'

describe('menu labels', () => {
  it('fit the firmware’s 32 bytes, cut on a character boundary', () => {
    expect(menuLabel('Jump to top')).toBe('Jump to top')
    const long = menuLabel('Open: Migrate billing to the v2 API and update every caller')
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(32)
    expect(long.endsWith('…')).toBe(true)
    const wide = menuLabel('● ★ ▶ ■ □ ○ ● ★ ▶ ■ □ ○ ● ★ ▶')
    expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(32)
    expect(menuLabel('   ')).toBe('·')
  })
})
