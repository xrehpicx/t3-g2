import type { Net } from '../net'
import type { PairingTarget } from './pairing'
import type { Session } from './session'
import type { ShellSnapshot, ThreadBounded } from './types'

const PROTOCOL = { 'x-t3-orchestration-protocol': '2' }

export class AuthError extends Error {
  constructor(message = 'Session expired. Pair again.') {
    super(message)
    this.name = 'AuthError'
  }
}

const headers = (session: Session, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${session.accessToken}`,
  ...PROTOCOL,
  ...extra,
})

async function json<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403) throw new AuthError()
  if (!response.ok) throw new Error(`T3 server returned ${response.status}.`)
  return (await response.json()) as T
}

/** Exchange a one-time pairing credential for a long-lived bearer session. */
export async function exchangePairing(net: Net, target: PairingTarget, label: string): Promise<Session> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: target.credential,
    subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    client_label: label,
    client_device_type: 'mobile',
  })
  const response = await net.fetch(`${target.origin}/oauth/token`, { method: 'POST', body })
  if (response.status === 400 || response.status === 401) {
    throw new Error('Pairing code rejected. Codes are single-use and expire in minutes; make a new one.')
  }
  const result = await json<{ access_token: string; expires_in: number; scope: string }>(response)
  return {
    origin: target.origin,
    accessToken: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
    scope: result.scope,
  }
}

export async function fetchShell(net: Net, session: Session): Promise<ShellSnapshot> {
  const response = await net.fetch(
    `${session.origin}/api/orchestration/shell?omitIdleSubagents=1&omitOlderSettled=1`,
    { headers: headers(session) },
  )
  return json<ShellSnapshot>(response)
}

export async function fetchThread(net: Net, session: Session, threadId: string): Promise<ThreadBounded> {
  const response = await net.fetch(
    `${session.origin}/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded?compactTurnItems=1&dedupeBodies=1&compactIds=1`,
    { headers: headers(session) },
  )
  return json<ThreadBounded>(response)
}

export async function mintSocketTicket(net: Net, session: Session): Promise<string> {
  const response = await net.fetch(`${session.origin}/api/auth/websocket-ticket`, {
    method: 'POST',
    headers: headers(session, { 'content-type': 'application/json' }),
    body: '{}',
  })
  return (await json<{ ticket: string }>(response)).ticket
}

export async function uploadAttachment(net: Net, session: Session, relativeUrl: string, bytes: Uint8Array): Promise<void> {
  const response = await net.fetch(`${session.origin}${relativeUrl}`, { method: 'POST', body: bytes as BodyInit })
  if (!response.ok) throw new Error(`Audio upload failed (${response.status}).`)
}

export interface Descriptor {
  environmentId: string
  label: string
  platform?: { os?: string }
}

/** Public identity of a server: lets re-pairing the same machine replace it instead of duplicating it. */
export async function fetchDescriptor(net: Net, origin: string, timeoutMs = 0): Promise<Descriptor> {
  const response = await net.fetch(`${origin}/.well-known/t3/environment`, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined)
  if (!response.ok) throw new Error('That address does not look like a T3 server.')
  const body = (await response.json()) as Partial<Descriptor>
  if (!body.environmentId) throw new Error('That address does not look like a T3 server.')
  return { environmentId: body.environmentId, label: body.label || new URL(origin).host }
}
