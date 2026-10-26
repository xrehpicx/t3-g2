import type { AudioInputSource, EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MAX_RECORD_MS } from '../config'
import { BYTES_PER_SECOND } from './wav'

export interface Recording {
  pcm: Uint8Array
}

type RecorderState = 'idle' | 'opening' | 'recording' | 'paused'

/**
 * Push-to-talk capture that can be paused and resumed.
 *
 * - `release()` may arrive while the mic is still opening (a quick hold), so the intent is recorded
 *   and honoured once it opens instead of leaving the mic running.
 * - `pause()` turns the mic off but keeps what was said, so a notification or a double tap does not
 *   throw the recording away. `start()` while paused resumes and appends.
 */
export class Recorder {
  private state: RecorderState = 'idle'
  private chunks: Uint8Array[] = []
  private bytes = 0
  private generation = 0
  private releaseRequested = false
  private limitTimer: ReturnType<typeof setTimeout> | undefined
  /** Time recorded in earlier segments, before the current one started. */
  private bankedMs = 0
  private segmentStart = 0

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly onLimit: () => void,
  ) {}

  get busy() { return this.state !== 'idle' }
  get recording() { return this.state === 'recording' }
  get paused() { return this.state === 'paused' }
  get elapsedMs() {
    return this.bankedMs + (this.state === 'recording' ? Date.now() - this.segmentStart : 0)
  }
  get releasedWhileOpening() { return this.releaseRequested }

  /** Starts a new recording, or resumes a paused one. */
  async start(source: AudioInputSource): Promise<boolean> {
    if (this.state === 'opening' || this.state === 'recording') return false
    const resuming = this.state === 'paused'
    const generation = ++this.generation
    this.state = 'opening'
    this.releaseRequested = false
    if (!resuming) {
      this.chunks = []
      this.bytes = 0
      this.bankedMs = 0
    }
    let opened = false
    try {
      opened = await this.bridge.audioControl(true, source)
    } catch {
      opened = false
    }
    if (generation !== this.generation) {
      if (opened) await this.bridge.audioControl(false).catch(() => {})
      return false
    }
    if (!opened) {
      this.state = resuming ? 'paused' : 'idle'
      return false
    }
    this.state = 'recording'
    this.segmentStart = Date.now()
    clearTimeout(this.limitTimer)
    this.limitTimer = setTimeout(this.onLimit, Math.max(0, MAX_RECORD_MS - this.bankedMs))
    return true
  }

  push(chunk: Uint8Array) {
    if (this.state !== 'recording') return
    this.chunks.push(chunk)
    this.bytes += chunk.byteLength
    if (this.bytes >= (MAX_RECORD_MS / 1000) * BYTES_PER_SECOND) this.onLimit()
  }

  /** Mic off, audio kept. No-op unless recording. */
  async pause(): Promise<boolean> {
    if (this.state === 'opening') {
      // Abandon the open in flight; nothing was captured in this segment yet.
      this.generation++
      this.state = this.bytes ? 'paused' : 'idle'
      return this.state === 'paused'
    }
    if (this.state !== 'recording') return false
    this.bankedMs += Date.now() - this.segmentStart
    clearTimeout(this.limitTimer)
    this.state = 'paused'
    await this.bridge.audioControl(false).catch(() => {})
    return true
  }

  /** Ends the recording and returns it. Returns null if the mic is still opening (honoured later). */
  async release(): Promise<Recording | null> {
    if (this.state === 'opening') {
      this.releaseRequested = true
      return null
    }
    if (this.state === 'recording') await this.bridge.audioControl(false).catch(() => {})
    if (this.state !== 'recording' && this.state !== 'paused') return null
    const pcm = new Uint8Array(this.bytes)
    let offset = 0
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.reset()
    return { pcm }
  }

  async cancel() {
    this.generation++
    if (this.state === 'recording') await this.bridge.audioControl(false).catch(() => {})
    this.reset()
  }

  private reset() {
    clearTimeout(this.limitTimer)
    this.state = 'idle'
    this.chunks = []
    this.bytes = 0
    this.bankedMs = 0
    this.releaseRequested = false
  }
}
