import { describe, expect, it } from 'vitest';
import { resolveMessageModeMeta } from './messageMeta';

/**
 * The input type is derived from the resolver rather than hand-written, so a change to
 * its signature breaks this file at compile time. These tests used to cast their input
 * with `as any` and kept asserting a two-field result for as long as it took someone to
 * run them — `effort` had joined the contract and nothing here noticed.
 */
type ModeSession = Parameters<typeof resolveMessageModeMeta>[0];

function session(overrides: Partial<ModeSession> = {}): ModeSession {
    return {
        permissionMode: null,
        modelMode: null,
        effortLevel: null,
        metadata: null,
        ...overrides,
    };
}

describe('resolveMessageModeMeta', () => {
    it('sends explicit permission and model keys', () => {
        const meta = resolveMessageModeMeta(session({
            permissionMode: 'read-only',
            modelMode: 'gpt-5-high',
        }));

        expect(meta).toEqual({
            permissionMode: 'read-only',
            model: 'gpt-5-high',
            effort: null,
        });
    });

    it('forces bypass permissions in sandbox when mode is default', () => {
        const meta = resolveMessageModeMeta(session({
            permissionMode: 'default',
            metadata: { sandbox: { enabled: true } } as ModeSession['metadata'],
        }));

        expect(meta).toEqual({
            permissionMode: 'bypassPermissions',
            model: null,
            effort: null,
        });
    });

    it('keeps default permissions when sandbox is disabled', () => {
        const meta = resolveMessageModeMeta(session({
            modelMode: 'default',
            metadata: { sandbox: null } as ModeSession['metadata'],
        }));

        expect(meta).toEqual({
            permissionMode: 'default',
            model: null,
            effort: null,
        });
    });

    it('lets an explicit permission mode outrank the sandbox default', () => {
        const meta = resolveMessageModeMeta(session({
            permissionMode: 'read-only',
            metadata: { sandbox: { enabled: true } } as ModeSession['metadata'],
        }));

        expect(meta.permissionMode).toBe('read-only');
    });

    it('passes the chosen effort level through, and null when none is chosen', () => {
        expect(resolveMessageModeMeta(session({ effortLevel: 'high' })).effort).toBe('high');
        expect(resolveMessageModeMeta(session()).effort).toBeNull();
    });
});
