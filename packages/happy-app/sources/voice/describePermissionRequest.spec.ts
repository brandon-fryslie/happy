import { describe, it, expect } from 'vitest';
import { describePermissionRequest, permissionPrompt } from './describePermissionRequest';

describe('describePermissionRequest', () => {
    it('names the command for Bash rather than the tool', () => {
        expect(describePermissionRequest('Bash', { command: 'git push origin main' }))
            .toBe('The agent wants to run git push origin main.');
    });

    it('unwraps a shell-wrapped argv into the command a human would recognize', () => {
        // stringifyToolCommand already handles this; the point here is that the describer routes
        // Bash through it instead of stringifying the array.
        expect(describePermissionRequest('Bash', { command: ['bash', '-c', 'rm -rf build'] }))
            .toBe('The agent wants to run rm -rf build.');
    });

    it('speaks the tail of a path, not the whole thing', () => {
        expect(describePermissionRequest('Edit', { file_path: '/Users/bmf/code/happy/sources/voice/x.ts' }))
            .toBe('The agent wants to edit voice/x.ts.');
    });

    it('leaves a short path alone', () => {
        expect(describePermissionRequest('Read', { file_path: 'src/app.ts' }))
            .toBe('The agent wants to read src/app.ts.');
    });

    it('truncates an argument too long to listen to', () => {
        const long = 'a'.repeat(400);
        const spoken = describePermissionRequest('Bash', { command: long });
        expect(spoken.length).toBeLessThan(200);
        expect(spoken).toContain('and more');
    });

    describe('when there is nothing speakable', () => {
        // Each of these must still produce a usable sentence. The listener is being asked to approve
        // something, so an empty or malformed payload must not yield a sentence that trails off.
        it.each([
            ['null arguments', null],
            ['undefined arguments', undefined],
            ['a string instead of an object', 'oops'],
            ['an object with no known key', { unexpected: 1 }],
            ['a known key holding a non-string', { file_path: 42 }],
            ['a known key holding an empty string', { file_path: '' }],
        ])('names the tool given %s', (_label, args) => {
            expect(describePermissionRequest('Edit', args)).toBe('The agent wants to use Edit.');
        });
    });

    it('names an unknown tool instead of guessing at its arguments', () => {
        expect(describePermissionRequest('SomeNewTool', { whatever: 'x' }))
            .toBe('The agent wants to use SomeNewTool.');
    });

    it('always ends in a sentence that can be spoken', () => {
        // Anything reaching TTS must be a complete sentence — a fragment read aloud sounds like a
        // dropped connection, which is indistinguishable from the bug we are trying to avoid.
        const samples = [
            describePermissionRequest('Bash', { command: 'ls' }),
            describePermissionRequest('Unknown', null),
            describePermissionRequest('Grep', { pattern: 'TODO' }),
        ];
        for (const s of samples) {
            expect(s.endsWith('.')).toBe(true);
            expect(s.length).toBeGreaterThan(10);
        }
    });
});

describe('permissionPrompt', () => {
    it('appends the question so the listener knows an answer is wanted', () => {
        expect(permissionPrompt('Bash', { command: 'ls' }))
            .toBe('The agent wants to run ls. Say yes to allow, or no to deny.');
    });
});
