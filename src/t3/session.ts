export interface Session {
  origin: string
  accessToken: string
  expiresAt: number
  scope: string
}

/** Storage seam: Even's bridge storage on device, localStorage elsewhere. */
export interface Store {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export function sessionExpired(session: Session, now = Date.now()): boolean {
  return now >= session.expiresAt - 60_000
}
