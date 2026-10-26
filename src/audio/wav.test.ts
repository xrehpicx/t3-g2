import { describe, expect, it } from 'vitest'
import { assertAudible, audioProblem, durationMs, peak, pcm16ToWav } from './wav'

describe('pcm16ToWav', () => {
  const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
  const wav = pcm16ToWav(pcm)
  const view = new DataView(wav.buffer)
  it('writes a valid 16 kHz mono PCM header', () => {
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(4, true)).toBe(36 + pcm.length)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000)
    expect(view.getUint32(40, true)).toBe(pcm.length)
  })
  it('appends the samples unchanged', () => {
    expect([...wav.slice(44)]).toEqual([...pcm])
  })
})

describe('audio metrics', () => {
  it('computes duration from byte length', () => {
    expect(durationMs(new Uint8Array(32000))).toBe(1000)
  })
  it('finds the peak amplitude including negatives', () => {
    const buf = new Uint8Array(6)
    const v = new DataView(buf.buffer)
    v.setInt16(0, 100, true); v.setInt16(2, -900, true); v.setInt16(4, 300, true)
    expect(peak(buf)).toBe(900)
  })
  it('reads silence as zero', () => {
    expect(peak(new Uint8Array(100))).toBe(0)
  })
})

const tone = (ms: number, amplitude: number) => {
  const samples = Math.round((ms / 1000) * 16000)
  const buf = new Uint8Array(samples * 2)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, Math.round(Math.sin(i / 8) * amplitude), true)
  return buf
}

describe('audioProblem', () => {
  it('rejects nothing, too little, and silence', () => {
    expect(audioProblem(new Uint8Array(0))).toBe('empty')
    expect(audioProblem(new Uint8Array(1))).toBe('empty')
    expect(audioProblem(tone(200, 8000))).toBe('short')
    expect(audioProblem(new Uint8Array(32000))).toBe('silent')
    expect(audioProblem(tone(1000, 100))).toBe('silent')
  })
  it('accepts audible speech of a sensible length', () => {
    expect(audioProblem(tone(600, 4000))).toBeNull()
    expect(audioProblem(tone(5000, 12000))).toBeNull()
  })
})

describe('assertAudible', () => {
  it('refuses a WAV with no samples, however well-formed the header is', () => {
    expect(() => assertAudible(pcm16ToWav(new Uint8Array(0)))).toThrow(/No audio/)
  })
  it('refuses a silent WAV', () => {
    expect(() => assertAudible(pcm16ToWav(new Uint8Array(64000)))).toThrow(/hear anything/)
  })
  it('lets real speech through', () => {
    expect(() => assertAudible(pcm16ToWav(tone(1000, 6000)))).not.toThrow()
  })
})
