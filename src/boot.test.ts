import { describe, expect, it } from 'vitest'
import { readBootHash } from './boot'

describe('readBootHash', () => {
  const hash = '#reset&defaults&server=https://mac.ts.net&token=abc&demo&showcase&permodel=off&page=usage&open=t1'

  it('reads the dev hashes', () => {
    expect(readBootHash(hash, true)).toEqual({
      reset: true,
      defaults: true,
      pair: { server: 'https://mac.ts.net', token: 'abc' },
      demo: true,
      showcase: true,
      perModelOff: true,
      startPage: 'usage',
      openId: 't1',
    })
  })

  it('ignores every hash in a packed build', () => {
    expect(readBootHash(hash, false)).toEqual({
      reset: false,
      defaults: false,
      pair: null,
      demo: false,
      showcase: false,
      perModelOff: false,
      startPage: null,
      openId: null,
    })
  })

  it('does not pair unless both the server and the token are present', () => {
    expect(readBootHash('#server=https://mac.ts.net', true).pair).toBeNull()
    expect(readBootHash('#token=abc', true).pair).toBeNull()
  })
})
