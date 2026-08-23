import { describe, it, expect } from 'vitest';
import { MINIMUM_CLI_VERSION_FOR_ATTACHMENTS, resolveAttachmentSupport } from './attachmentSupport';
import type { Metadata } from './storageTypes';

function metadata(overrides: Partial<Metadata> = {}): Metadata {
    return { path: '/home/bmf/code/happy', host: 'workstation', ...overrides };
}

describe('resolveAttachmentSupport', () => {
    it('accepts a Claude session on the first CLI that routes file events', () => {
        expect(resolveAttachmentSupport(metadata({
            flavor: 'claude',
            version: MINIMUM_CLI_VERSION_FOR_ATTACHMENTS,
        }))).toBe('supported');
    });

    it('accepts a prerelease of the minimum, which is the build the feature shipped in', () => {
        expect(resolveAttachmentSupport(metadata({
            flavor: 'claude',
            version: '1.1.9-beta.0',
        }))).toBe('supported');
    });

    it('accepts CLIs newer than the minimum', () => {
        expect(resolveAttachmentSupport(metadata({ flavor: 'claude', version: '2.0.0' }))).toBe('supported');
    });

    it('rejects the last CLI released before file-event routing', () => {
        expect(resolveAttachmentSupport(metadata({ flavor: 'claude', version: '1.1.8' }))).toBe('outdatedCli');
    });

    it('rejects a session whose host reports no version at all', () => {
        expect(resolveAttachmentSupport(metadata({ flavor: 'claude' }))).toBe('outdatedCli');
    });

    it('rejects a session with no metadata yet', () => {
        expect(resolveAttachmentSupport(undefined)).toBe('outdatedCli');
    });

    it('treats an absent flavor as Claude, matching how the CLI labels local sessions', () => {
        expect(resolveAttachmentSupport(metadata({ version: '2.0.0' }))).toBe('supported');
    });

    it('blames the agent, not the CLI, when a non-Claude flavor runs a current CLI', () => {
        expect(resolveAttachmentSupport(metadata({ flavor: 'codex', version: '2.0.0' }))).toBe('unsupportedAgent');
    });

    it('still blames the agent when the CLI is also too old — updating happy would not help', () => {
        expect(resolveAttachmentSupport(metadata({ flavor: 'codex', version: '1.1.8' }))).toBe('unsupportedAgent');
    });
});
