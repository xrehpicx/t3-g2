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

export type RequestResponse =
  | { decision: string }
  | { answers: Record<string, string | string[]>; voiceByQuestionId?: Record<string, Uint8Array> }

/**
 * Answers a question or approval the agent is waiting on. A spoken answer is attached to its question
 * as a WAV, with a text answer that tells the agent to transcribe it.
 */
export async function respondToRequest(net: Net, session: Session, threadId: string, requestId: string, response: RequestResponse) {
  if (!canOperate(session)) throw new ReadOnlyError()
  if ('decision' in response) {
    await rpc(net, session, 'orchestration.dispatchCommand', {
      type: 'runtime-request.respond', commandId: uuid(), threadId, requestId, decision: response.decision,
    })
    return
  }
  const attachmentsByQuestionId: Record<string, unknown[]> = {}
  for (const [questionId, wav] of Object.entries(response.voiceByQuestionId ?? {})) {
    assertAudible(wav)
    attachmentsByQuestionId[questionId] = [await uploadFile(net, session, { name: `answer-${questionId}.wav`, mimeType: 'audio/wav', bytes: wav })]
  }
  await rpc(net, session, 'orchestration.dispatchCommand', {
    type: 'runtime-request.respond', commandId: uuid(), threadId, requestId, answers: response.answers,
    ...(Object.keys(attachmentsByQuestionId).length ? { attachmentsByQuestionId } : {}),
  })
}

/** The text answer sent alongside a spoken one. */
export const VOICE_ANSWER = 'Answered by voice: the attached WAV is my answer. Transcribe it and use it.'
