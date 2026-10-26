export const SEND_DELAYS = [0, 1, 3, 5, 10] as const
export const DEFAULT_SEND_DELAY = 3

export type HoldResult = 'sent' | 'cancelled'

export interface SendHold {
  /** 'sent' when the countdown ends or the user skips it, 'cancelled' if cancelled first. */
  done: Promise<HoldResult>
  cancel(): void
  /** Skip the rest of the countdown and send now. */
  sendNow(): void
  /** Stop the clock (the glasses menu is open); `resume()` carries on from the same second. */
  pause(): void
  resume(): void
  readonly left: number
}

/**
 * A grace period before a voice message goes out. `onTick` fires with the seconds left so the display
 * can show the countdown. It can be cancelled, skipped, or paused while the user is busy elsewhere.
 */
export function startSendHold(onTick: (left: number) => void, seconds: number): SendHold {
  let left = seconds
  let settled = false
  let timer: ReturnType<typeof setInterval> | undefined
  let finish: (result: HoldResult) => void = () => {}
  const done = new Promise<HoldResult>(resolve => { finish = resolve })

  const end = (result: HoldResult) => {
    if (settled) return
    settled = true
    clearInterval(timer)
    finish(result)
  }
  const run = () => {
    clearInterval(timer)
    timer = setInterval(() => {
      left -= 1
      if (left <= 0) return end('sent')
      onTick(left)
    }, 1000)
  }
  run()
  onTick(left)

  return {
    done,
    cancel: () => end('cancelled'),
    sendNow: () => end('sent'),
    pause: () => { if (!settled) clearInterval(timer) },
    resume: () => { if (!settled) run() },
    get left() { return left },
  }
}

export const normalizeSendDelay = (value: unknown): number =>
  typeof value === 'number' && (SEND_DELAYS as readonly number[]).includes(value) ? value : DEFAULT_SEND_DELAY
