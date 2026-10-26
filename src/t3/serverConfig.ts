export interface ModelOption {
  instanceId: string
  provider: string
  slug: string
  name: string
}

export interface ServerConfig {
  models: ModelOption[]
  defaultModel: { instanceId: string; model: string } | null
  defaultRuntimeMode: string | null
}

interface RawProvider {
  instanceId: string
  displayName?: string
  enabled?: boolean
  installed?: boolean
  models?: Array<{ slug: string; name?: string }>
}

interface RawConfig {
  providers?: RawProvider[]
  settings?: { defaultModelSelection?: { instanceId: string; model: string }; defaultRuntimeMode?: string }
}

/** Only providers a thread could actually start on: enabled and installed. */
export function parseServerConfig(raw: RawConfig): ServerConfig {
  const models: ModelOption[] = []
  for (const provider of raw.providers ?? []) {
    if (provider.enabled === false || provider.installed === false) continue
    for (const model of provider.models ?? []) {
      models.push({
        instanceId: provider.instanceId,
        provider: provider.displayName ?? provider.instanceId,
        slug: model.slug,
        name: model.name ?? model.slug,
      })
    }
  }
  const dm = raw.settings?.defaultModelSelection
  return {
    models,
    defaultModel: dm ? { instanceId: dm.instanceId, model: dm.model } : null,
    defaultRuntimeMode: raw.settings?.defaultRuntimeMode ?? null,
  }
}
