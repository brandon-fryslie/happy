import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { fetchModelRoster, toModelRosterEntries } from './modelRoster'

// Shape observed from `query().supportedModels()` on Claude Code 2.1.226.
const SDK_MODELS: ModelInfo[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 4.6 with 1M context · Most capable for complex work',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
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
    })
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
