import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { fetchModelRoster, toModelRosterEntries } from './modelRoster'

// Shape observed from `query().supportedModels()` against the bundled CLI on
// 2026-08-23. Both rows are load-bearing: `default` reports the full ladder,
// `haiku` reports no effort fields at all, which is what the app has to read as
// "this model takes no effort setting".
const SDK_MODELS: ModelInfo[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
  },
]

describe('toModelRosterEntries', () => {
  it('publishes the CLI model key as the code the app sends back', () => {
    expect(toModelRosterEntries(SDK_MODELS).map((entry) => entry.code)).toEqual(['default', 'haiku'])
  })

  it('carries the CLI display name and description through as the label', () => {
    expect(toModelRosterEntries(SDK_MODELS)[1]).toEqual({
      code: 'haiku',
      value: 'Haiku',
      description: 'Haiku 4.5 · Fastest for quick answers',
      effortLevels: [],
    })
  })

  it('publishes the effort levels a model accepts', () => {
    expect(toModelRosterEntries(SDK_MODELS)[0].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('reports no effort levels for a model the CLI describes without them', () => {
    expect(toModelRosterEntries(SDK_MODELS)[1].effortLevels).toEqual([])
  })

  it('says nothing about effort when the CLI claims support but names no levels', () => {
    const [entry] = toModelRosterEntries([
      { value: 'mystery', displayName: 'Mystery', description: 'unenumerated', supportsEffort: true },
    ])
    expect(entry.effortLevels).toBeUndefined()
  })
})

describe('fetchModelRoster', () => {
  it('returns the roster the CLI reports', async () => {
    const roster = await fetchModelRoster({ supportedModels: async () => SDK_MODELS })
    expect(roster).toEqual(toModelRosterEntries(SDK_MODELS))
  })

  it('reports not-knowing rather than an empty roster when the CLI cannot answer', async () => {
    const roster = await fetchModelRoster({
      supportedModels: async () => {
        throw new Error('control request not supported')
      },
    })
    expect(roster).toBeNull()
  })

  it('reports not-knowing when the CLI answers with no models', async () => {
    expect(await fetchModelRoster({ supportedModels: async () => [] })).toBeNull()
  })
})
