import { assertAudible } from '../audio/wav'
import type { Net } from '../net'
import { canOperate, ReadOnlyError, uploadFile } from './launch'
import { rpc } from './rpc'
import type { Session } from './session'
import type { ThreadStatus } from './types'

const uuid = () => crypto.randomUUID()

interface Target { id: string; status: ThreadStatus }

/**
 * Messages from the glasses always steer: the server folds them into the running turn if there is one,
 * and starts a turn otherwise. They are never queued behind the current run.
 */
function dispatchMessage(net: Net, session: Session, thread: Target, text: string, attachments: unknown[]) {
  void thread.status
  return rpc(net, session, 'orchestration.dispatchCommand', {
    type: 'message.dispatch',
    commandId: uuid(),
    createdBy: 'user',
    creationSource: 'mobile',
    threadId: thread.id,
    messageId: uuid(),
    text,
    attachments,
    deliveryIntent: 'steer',
    dispatchMode: { type: 'start_immediately' },
  })
}

/**
 * Sends a voice message by attaching the raw WAV to the thread. The agent transcribes it itself
 * (the prompt tells it how); nothing else on the phone or in the cloud touches the audio.
 */
export async function sendVoiceMessage(net: Net, session: Session, thread: Target, wav: Uint8Array, prompt: string, now = new Date()) {
  if (!canOperate(session)) throw new ReadOnlyError()
  assertAudible(wav)
  const name = `voice-${now.toISOString().replace(/[:.]/g, '-')}.wav`
  const attachment = await uploadFile(net, session, { name, mimeType: 'audio/wav', bytes: wav })
  await dispatchMessage(net, session, thread, prompt, [attachment])
}

export async function sendTextMessage(net: Net, session: Session, thread: Target, text: string) {
  if (!canOperate(session)) throw new ReadOnlyError()
  await dispatchMessage(net, session, thread, text, [])
}
