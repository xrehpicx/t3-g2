export const SEND_HOLD_SECONDS = 3

export interface SendHold {
  /** Resolves true when the countdown ends, false if it was cancelled first. */
  done: Promise<boolean>
  cancel(): void
  readonly left: number
}

/**
 * A short grace period before a voice message goes out. `onTick` fires with the seconds left (3, 2, 1)
 * so the display can show the countdown, and `cancel()` stops it before anything is sent.
 */
export function startSendHold(onTick: (left: number) => void, seconds = SEND_HOLD_SECONDS): SendHold {
  let left = seconds
  let settled = false
  let timer: ReturnType<typeof setInterval> | undefined
  let finish: (sent: boolean) => void = () => {}
  const done = new Promise<boolean>(resolve => { finish = resolve })

  const end = (sent: boolean) => {
    if (settled) return
    settled = true
    clearInterval(timer)
    finish(sent)
  }
  timer = setInterval(() => {
    left -= 1
    if (left <= 0) return end(true)
    onTick(left)
  }, 1000)
  onTick(left)

  return { done, cancel: () => end(false), get left() { return left } }
}
