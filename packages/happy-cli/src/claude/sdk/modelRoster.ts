/**
 * The Claude model roster, as the Claude CLI itself reports it.
 *
 * [LAW:one-source-of-truth] Which models exist, what they are called, and which
 * of them this account may run are facts the installed Claude CLI owns — they
 * differ by CLI version and by account. The app's hardcoded list is a second
 * copy of those facts and drifts from them; publishing this roster into session
 * metadata makes the app render the CLI's answer instead of its own guess.
 *
 * Note the roster is aliases, not pinned version ids: `supportedModels()` on
 * CLI 2.1.226 returns `default` / `sonnet` / `haiku` / `opus[1m]`, each with a
 * displayName and a description naming the version the alias currently resolves
 * to. So the version claim in a label is the CLI's own, which is exactly what
 * makes it safe to show.
 */

import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { Metadata } from '@/api/types'
import { logger } from '@/lib'

export type ModelRosterEntry = NonNullable<Metadata['models']>[number]

/** The subset of the SDK `Query` this module needs — the seam, not the object. */
export type SupportedModelsSource = {
  supportedModels(): Promise<ModelInfo[]>
}

export function toModelRosterEntries(models: ModelInfo[]): ModelRosterEntry[] {
  return models.map((model) => ({
    code: model.value,
    value: model.displayName,
    description: model.description,
  }))
}

/**
 * Ask the running CLI for its roster.
 *
 * Returns null — a typed "we do not know" rather than an empty roster — when
 * the control request fails or comes back empty, which is what a CLI too old to
 * answer looks like. Callers must then leave `metadata.models` untouched so the
 * app keeps whatever it already had; writing `[]` would claim the account has
 * no models at all.
 */
export async function fetchModelRoster(source: SupportedModelsSource): Promise<ModelRosterEntry[] | null> {
  let models: ModelInfo[]
  try {
    models = await source.supportedModels()
  } catch (error) {
    logger.warn('[claudeRemote] Failed to read the model roster from the CLI; continuing without it.', error)
    return null
  }

  if (models.length === 0) {
    logger.debug('[claudeRemote] CLI reported an empty model roster; leaving session metadata untouched')
    return null
  }

  return toModelRosterEntries(models)
}
