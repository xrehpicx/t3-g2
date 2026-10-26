import type { Net } from '../net'
import { AuthError, fetchDescriptor } from './http'
import { canOperate } from './launch'
import { rpc } from './rpc'
import type { Session } from './session'

export interface DiagStep {
  name: string
  ok: boolean
  ms: number
  detail: string
}

async function timed(name: string, run: () => Promise<string>): Promise<DiagStep> {
  const started = Date.now()
  try {
    return { name, ok: true, ms: Date.now() - started, detail: await run() }
  } catch (error) {
    return { name, ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : String(error) }
  }
}

/** A step-by-step check of one machine, readable on the phone: which hop fails is the whole answer. */
export async function diagnose(net: Net, session: Session): Promise<DiagStep[]> {
  const host = new URL(session.origin).host
  const steps: DiagStep[] = []
  const reach = await timed('Reach server', async () => {
    const d = await fetchDescriptor(net, session.origin, 8_000)
    return `${d.label} at ${host}`
  })
  steps.push(reach)
  if (!reach.ok) return steps

  steps.push(await timed('Signed in', async () => {
    const response = await net.fetch(`${session.origin}/api/auth/session`, {
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-t3-orchestration-protocol': '2' },
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 401 || response.status === 403) throw new AuthError()
    if (!response.ok) throw new Error(`Server returned ${response.status}`)
    return 'session accepted'
  }))

  steps.push(await timed('Live connection', async () => {
    const config = await rpc<{ providers?: unknown[] }>(net, session, 'server.getConfig', {})
    return `${session.origin.startsWith('https') ? 'wss' : 'ws'} ok, ${config.providers?.length ?? 0} providers`
  }))

  steps.push({
    name: 'Can send',
    ok: canOperate(session),
    ms: 0,
    detail: canOperate(session) ? 'operate access' : 'read-only pairing: pair again with orchestration:operate',
  })
  return steps
}
