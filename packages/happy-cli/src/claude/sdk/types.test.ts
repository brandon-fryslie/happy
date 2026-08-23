import { describe, expect, it } from 'vitest'
import { CLAUDE_EFFORT_LEVELS, isClaudeEffort } from './types'

describe('claude effort ladder', () => {
    it('offers xhigh, between high and max', () => {
        const keys: readonly string[] = CLAUDE_EFFORT_LEVELS

        expect(keys).toContain('xhigh')
        expect(keys.indexOf('high')).toBeLessThan(keys.indexOf('xhigh'))
        expect(keys.indexOf('xhigh')).toBeLessThan(keys.indexOf('max'))
    })

    it('admits every level on the ladder', () => {
        for (const level of CLAUDE_EFFORT_LEVELS) {
            expect(isClaudeEffort(level)).toBe(true)
        }
    })

    // A client on a different ladder than this CLI is the case this guard
    // exists for — an unknown level must be dropped here rather than handed to
    // a Claude binary that would reject it mid-session.
    it('rejects levels it does not know and values that are not levels at all', () => {
        for (const value of ['ultra', 'HIGH', 'xHigh', '', 'none', 'minimal']) {
            expect(isClaudeEffort(value)).toBe(false)
        }

        for (const value of [undefined, null, 3, {}, ['high']]) {
            expect(isClaudeEffort(value)).toBe(false)
        }
    })
})
