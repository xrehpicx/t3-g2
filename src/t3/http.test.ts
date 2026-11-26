import { describe, expect, it } from 'vitest'
import { uploadUrl } from './http'

describe('uploadUrl', () => {
  const origin = 'https://mac.tail.ts.net'

  it('keeps a path on the paired origin', () => {
    expect(uploadUrl(origin, '/api/attachments/voice.wav')).toBe('https://mac.tail.ts.net/api/attachments/voice.wav')
    expect(uploadUrl(origin, '/api/attachments/voice.wav?sig=abc')).toBe('https://mac.tail.ts.net/api/attachments/voice.wav?sig=abc')
  })

  it('rejects anything that would leave the paired origin', () => {
    for (const bad of [
      '@other.ts.net/voice.wav',
      'https://other.ts.net/voice.wav',
      '//other.ts.net/voice.wav',
      '/voice.wav@other.ts.net',
      'voice.wav',
      '',
      '/voice.wav\nHost: other.ts.net',
    ]) {
      expect(() => uploadUrl(origin, bad)).toThrow(/rejected/)
    }
  })
})
