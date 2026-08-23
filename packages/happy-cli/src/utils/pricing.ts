import { Usage } from '../api/types';

/**
 * Cost of a Claude turn, derived from the usage the agent reports and the
 * published rate card for the model that served it.
 *
 * Rates are USD per million tokens, transcribed from
 * https://platform.claude.com/docs/en/about-claude/pricing (read 2026-08-23).
 * Sonnet 5's $2/$10 launch pricing is now its standard price — the increase to
 * $3/$15 once scheduled for 2026-09-01 was cancelled, so no rate here expires.
 */
export interface ModelRates {
  input: number
  output: number
}

// [LAW:one-source-of-truth] One constant per published rate tier. Several model
// ids share a tier; pointing them at one object keeps a rate from drifting in
// one row while its twin stays behind.
const FABLE_TIER: ModelRates = { input: 10.0, output: 50.0 }
const OPUS_TIER: ModelRates = { input: 5.0, output: 25.0 }
const OPUS_LEGACY_TIER: ModelRates = { input: 15.0, output: 75.0 }
const SONNET_5_TIER: ModelRates = { input: 2.0, output: 10.0 }
const SONNET_TIER: ModelRates = { input: 3.0, output: 15.0 }
const HAIKU_TIER: ModelRates = { input: 1.0, output: 5.0 }
const HAIKU_LEGACY_TIER: ModelRates = { input: 0.8, output: 4.0 }

/**
 * Rate card keyed on the model ids Anthropic actually publishes, with any dated
 * snapshot suffix stripped (see MODEL_RATES lookup below). Models retired from
 * the first-party API are kept while they remain reachable through Bedrock or
 * Google Cloud, which Claude Code can be pointed at.
 */
const MODEL_RATES: Record<string, ModelRates> = {
  'claude-fable-5': FABLE_TIER,
  'claude-mythos-5': FABLE_TIER,

  'claude-opus-5': OPUS_TIER,
  'claude-opus-4-8': OPUS_TIER,
  'claude-opus-4-7': OPUS_TIER,
  'claude-opus-4-6': OPUS_TIER,
  'claude-opus-4-5': OPUS_TIER,
  'claude-opus-4-1': OPUS_LEGACY_TIER,
  // Claude Opus 4 answers to the `-4-0` alias and to `claude-opus-4-20250514`,
  // which loses its date below and lands on the bare `claude-opus-4`.
  'claude-opus-4-0': OPUS_LEGACY_TIER,
  'claude-opus-4': OPUS_LEGACY_TIER,

  'claude-sonnet-5': SONNET_5_TIER,
  'claude-sonnet-4-6': SONNET_TIER,
  'claude-sonnet-4-5': SONNET_TIER,
  'claude-sonnet-4-0': SONNET_TIER,
  'claude-sonnet-4': SONNET_TIER,

  'claude-haiku-4-5': HAIKU_TIER,
  'claude-3-5-haiku': HAIKU_LEGACY_TIER,
}

// Cache rates are exact multiples of a model's base input rate for every row on
// the pricing page, so they are computed rather than stored: a stored copy is a
// second representation of the same fact, free to drift from the input rate
// sitting next to it.
const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2.0
const CACHE_READ_MULTIPLIER = 0.1

// Anthropic publishes an id per model and, for some, a dated snapshot of it
// (`claude-haiku-4-5-20251001`). The date names a build, never a price.
const DATED_SNAPSHOT_SUFFIX = /-\d{8}$/

/**
 * The single crossing from an arbitrary model string to a model we hold rates
 * for. Returns null rather than a stand-in tier when the id is unknown, so a
 * caller cannot mistake "we cannot price this" for "this was cheap".
 *
 * [LAW:parse-dont-validate] The `ModelRates` it hands back is the proof the
 * lookup succeeded; nothing downstream re-checks the id.
 */
export function resolveModelRates(modelId: string | undefined): ModelRates | null {
  // [LAW:no-defensive-null-guards] `model` is optional on Claude's assistant
  // messages, so absence is a real state of the domain rather than a symptom.
  if (!modelId) {
    return null
  }
  return MODEL_RATES[modelId.replace(DATED_SNAPSHOT_SUFFIX, '')] ?? null
}

export interface CostBreakdown {
  total: number
  input: number
  output: number
}

/**
 * Price one turn's usage, or return null when the serving model has no
 * published rate here — a new model, or Claude Code's `<synthetic>` marker on
 * locally generated messages.
 *
 * Cache writes are split by TTL because they are billed differently: a 1-hour
 * write costs twice the base input rate against a 5-minute write's 1.25x, and
 * agent sessions do use the 1-hour tier. Older payloads carry only the
 * undifferentiated `cache_creation_input_tokens`, which is priced as 5-minute.
 */
export function calculateCost(usage: Usage, modelId?: string): CostBreakdown | null {
  const rates = resolveModelRates(modelId)
  if (!rates) {
    return null
  }

  const fiveMinuteWriteTokens = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0
  const oneHourWriteTokens = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0

  const perToken = (tokens: number, rate: number) => (tokens / 1_000_000) * rate

  const input = perToken(usage.input_tokens, rates.input)
    + perToken(fiveMinuteWriteTokens, rates.input * CACHE_WRITE_5M_MULTIPLIER)
    + perToken(oneHourWriteTokens, rates.input * CACHE_WRITE_1H_MULTIPLIER)
    + perToken(usage.cache_read_input_tokens ?? 0, rates.input * CACHE_READ_MULTIPLIER)
  const output = perToken(usage.output_tokens, rates.output)

  return { total: input + output, input, output }
}
