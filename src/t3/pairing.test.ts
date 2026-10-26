import { describe, expect, it } from 'vitest'
import { parsePairing } from './pairing'

describe('parsePairing', () => {
  it('reads a full pairing link with the token in the hash', () => {
    expect(parsePairing('https://mac.tail1.ts.net/pair#token=ABC123')).toEqual({ origin: 'https://mac.tail1.ts.net', credential: 'ABC123' })
  })
  it('reads a token query parameter', () => {
    expect(parsePairing('http://10.0.1.5:3773/?token=XYZ').credential).toBe('XYZ')
  })
  it('combines a bare host with a separate code and defaults to https', () => {
    expect(parsePairing('mac.tail1.ts.net', ' CODE ')).toEqual({ origin: 'https://mac.tail1.ts.net', credential: 'CODE' })
  })
  it('keeps an explicit port and drops the path', () => {
    expect(parsePairing('http://100.1.2.3:3773/some/path', 'c').origin).toBe('http://100.1.2.3:3773')
  })
  it('rejects empty input and missing codes', () => {
    expect(() => parsePairing('')).toThrow(/server address/)
    expect(() => parsePairing('mac.ts.net')).toThrow(/pairing code/)
    expect(() => parsePairing('ftp://x', 'c')).toThrow(/http/)
  })
})
