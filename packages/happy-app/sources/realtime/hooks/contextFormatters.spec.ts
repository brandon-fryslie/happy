import { describe, it, expect } from 'vitest';
import { formatSendAnswer, formatAttachmentsQueued, formatSessionFull } from './contextFormatters';

describe('formatSendAnswer', () => {
    it('keeps the agent terse when everything went out', () => {
        expect(formatSendAnswer(null)).toContain('sent');
        expect(formatSendAnswer(null)).toContain('DO NOT say anything else');
    });

    // The whole point of the outcome reaching the agent: a modal is the only other
    // notice, and it reaches a user looking at the screen — not the one using voice.
    it('tells the agent to speak up when the host cannot take images', () => {
        const answer = formatSendAnswer({ reason: 'unsupported-host', count: 2 });

        expect(answer).toContain('2 attached images');
        expect(answer).toContain('cannot receive images');
        expect(answer).toContain('tell the user');
        expect(answer).not.toContain('DO NOT say anything else');
    });

    it('tells the agent to speak up when the upload failed', () => {
        const answer = formatSendAnswer({ reason: 'upload-failed', count: 3 });

        expect(answer).toContain('3 attached images');
        expect(answer).toContain('upload failed');
        expect(answer).toContain('tell the user');
        expect(answer).not.toContain('DO NOT say anything else');
    });

    // Only the counted slots pluralize; the reason phrase says "images" either way.
    it('speaks of one image in the singular', () => {
        const answer = formatSendAnswer({ reason: 'upload-failed', count: 1 });

        expect(answer).toContain('1 attached image did not go');
        expect(answer).toContain('their image could not be sent');
        expect(answer).not.toContain('attached images');
    });

    // Every drop must reach the agent: a silent variant would restore the exact bug
    // this formatter exists to close.
    it('never answers with the bare terse form once anything was dropped', () => {
        const reasons = ['unsupported-host', 'upload-failed'] as const;
        reasons.forEach((reason) => {
            [1, 5].forEach((count) => {
                expect(formatSendAnswer({ reason, count })).not.toBe(formatSendAnswer(null));
            });
        });
    });
});

describe('formatSessionFull staged images', () => {
    const session = { id: 'session-a', metadata: { summary: { text: 'work' }, path: '/tmp' } } as never;

    it('says nothing about images when none are staged', () => {
        expect(formatSessionFull(session, [], 0)).not.toContain('Attached images');
    });

    // The live subscription only reports growth, so images staged before voice started
    // produce no announcement at all — this dump is the agent's only chance to learn.
    it('reports images staged before the agent was listening', () => {
        const dump = formatSessionFull(session, [], 3);

        expect(dump).toContain('Attached images');
        expect(dump).toContain('3 images are attached');
        expect(dump).toContain('included automatically');
    });

    it('counts a single staged image in the singular', () => {
        expect(formatSessionFull(session, [], 1)).toContain('image is attached');
    });
});

describe('formatAttachmentsQueued', () => {
    // The promise this makes to the agent is what formatSendAnswer has to be able to
    // walk back, so the two are checked together.
    it('promises queued images will ride along with the next message', () => {
        const queued = formatAttachmentsQueued('session-a', 2, 3);

        expect(queued).toContain('session-a');
        expect(queued).toContain('2 images');
        expect(queued).toContain('3 now queued');
        expect(queued).toContain('included automatically');
    });

    it('counts a single image in the singular', () => {
        expect(formatAttachmentsQueued('session-a', 1, 1)).toContain('an image');
    });
});
