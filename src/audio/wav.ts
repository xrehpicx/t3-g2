export const SAMPLE_RATE = 16_000
export const BYTES_PER_SECOND = SAMPLE_RATE * 2

/** Wrap raw 16 kHz mono signed 16-bit little-endian PCM (what the Even SDK emits) in a WAV container. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(out.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  out.set(pcm, 44)
  return out
}

export const durationMs = (pcm: Uint8Array) => Math.round((pcm.byteLength / BYTES_PER_SECOND) * 1000)

/** Peak amplitude, 0..32768. Used to refuse sending a recording of silence. */
export function peak(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2))
  let max = 0
  for (let i = 0; i < view.byteLength; i += 2) max = Math.max(max, Math.abs(view.getInt16(i, true)))
  return max
}

export const MIN_SPEECH_MS = 500
/** Below this peak (of 32768) a recording is treated as silence: mic noise floor, not speech. */
export const SILENCE_PEAK = 250

export type AudioProblem = 'empty' | 'short' | 'silent'

/** Why a recording must not be sent, or null if it can be. */
export function audioProblem(pcm: Uint8Array): AudioProblem | null {
  if (pcm.byteLength < 2) return 'empty'
  if (durationMs(pcm) < MIN_SPEECH_MS) return 'short'
  if (peak(pcm) < SILENCE_PEAK) return 'silent'
  return null
}

export const AUDIO_PROBLEM_TEXT: Record<AudioProblem, string> = {
  empty: 'No audio captured. Try again.',
  short: 'Too short. Hold while you speak.',
  silent: "Didn't hear anything. Try again.",
}

export class EmptyAudioError extends Error {
  constructor(problem: AudioProblem) {
    super(AUDIO_PROBLEM_TEXT[problem])
    this.name = 'EmptyAudioError'
  }
}

/** Throws unless the WAV (as built by pcm16ToWav) holds audible speech. Last line of defence before upload. */
export function assertAudible(wav: Uint8Array): void {
  const problem = audioProblem(wav.subarray(44))
  if (problem) throw new EmptyAudioError(problem)
}
