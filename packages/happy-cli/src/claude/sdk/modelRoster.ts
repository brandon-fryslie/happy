/**
 * The Claude model roster, as the Claude CLI itself reports it.
 *
 * [LAW:one-source-of-truth] Which models exist, what they are called, which of
 * them this account may run, and what effort levels each one takes are facts the
 * installed Claude CLI owns — they differ by CLI version and by account, and the
 * effort answer has already changed twice between SDK versions (sonnet gained
 * `xhigh` and `max`; a `claude-fable-5` row appeared) while the app's copy of it
 * stood still. The app's hardcoded list is a second copy of those facts and
 * drifts from them; publishing this roster into session metadata makes the app
 * render the CLI's answer instead of its own guess.
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

/**
 * Effort capability as this CLI reports it, in the three states the app needs to
 * tell apart.
 *
 * `supportsEffort` false or absent is a positive claim — CLI 2.1.226 reports
 * neither field on `haiku`, meaning that model takes no effort setting — so it
 * becomes `[]` and the app hides the picker. `supportsEffort` true with no level
 * list is the CLI declining to enumerate; publishing `[]` there would turn "I did
 * not say" into "there are none", so the field is left off and the app falls back
 * to its own ladder.
 */
function toEffortLevels(model: ModelInfo): string[] | undefined {
  return model.supportsEffort ? model.supportedEffortLevels : []
}

export function toModelRosterEntries(models: ModelInfo[]): ModelRosterEntry[] {
  return models.map((model) => ({
    code: model.value,
    value: model.displayName,
    description: model.description,
    effortLevels: toEffortLevels(model),
    // [LAW:one-source-of-truth] Which model an alias runs is the CLI's fact, and
    // this is the CLI stating it. Passed through unmapped and left absent when
    // the CLI omits it — a resolved id is not derivable from the alias, so
    // guessing one would manufacture the very claim this field exists to source.
    resolvedModel: model.resolvedModel,
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
