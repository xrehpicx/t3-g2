import { assertAudible } from '../audio/wav'
import type { NewThreadSettings } from '../settings'
import type { Net } from '../net'
import { uploadAttachment } from './http'
import { rpc } from './rpc'
import type { Session } from './session'
import type { ServerConfig } from './serverConfig'

const uuid = () => crypto.randomUUID()

export const SCRATCH = 'scratch'

export class ReadOnlyError extends Error {
  constructor() {
    super('This pairing is read-only. Pair again with operate access.')
    this.name = 'ReadOnlyError'
  }
}

export const canOperate = (session: Session) => session.scope.split(/\s+/).includes('orchestration:operate')

export interface Attachment {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export async function uploadFile(net: Net, session: Session, file: Attachment) {
  const upload = await rpc<{ attachmentId: string; relativeUrl: string }>(net, session, 'attachments.createUploadUrl', {
    type: 'file', name: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.byteLength,
  })
  await uploadAttachment(net, session, upload.relativeUrl, file.bytes)
  return { type: 'file', id: upload.attachmentId, name: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.byteLength }
}

/** Resolves "scratch" to the server's no-project workspace, creating it on first use. */
async function resolveProject(net: Net, session: Session, projectId: string): Promise<string> {
  if (projectId !== SCRATCH) return projectId
  return (await rpc<{ projectId: string }>(net, session, 'projects.ensureScratch', {})).projectId
}

export function pickModel(settings: NewThreadSettings, config: ServerConfig | null) {
  if (settings.instanceId && settings.model) return { instanceId: settings.instanceId, model: settings.model }
  if (config?.defaultModel) return config.defaultModel
  throw new Error('No model configured. Pick one in settings.')
}

export interface LaunchInput {
  settings: NewThreadSettings
  config: ServerConfig | null
  title: string
  text: string
  attachment?: Attachment
}

/** Starts a new thread using the saved defaults. Returns the new thread's id. */
export async function launchThread(net: Net, session: Session, input: LaunchInput): Promise<string> {
  if (!canOperate(session)) throw new ReadOnlyError()
  if (input.attachment?.mimeType.startsWith('audio/')) assertAudible(input.attachment.bytes)
  const modelSelection = pickModel(input.settings, input.config)
  const [projectId, attachment] = await Promise.all([
    resolveProject(net, session, input.settings.projectId),
    input.attachment ? uploadFile(net, session, input.attachment) : Promise.resolve(null),
  ])
  const result = await rpc<{ threadId: string }>(net, session, 'orchestration.launchThread', {
    commandId: uuid(),
    creationSource: 'mobile',
    threadId: uuid(),
    projectId,
    title: input.title,
    generateTitle: false,
    modelSelection,
    runtimeMode: input.settings.runtimeMode,
    interactionMode: 'default',
    workspaceStrategy: { type: 'root' },
    initialMessage: { messageId: uuid(), text: input.text, attachments: attachment ? [attachment] : [] },
  })
  return result.threadId
}
