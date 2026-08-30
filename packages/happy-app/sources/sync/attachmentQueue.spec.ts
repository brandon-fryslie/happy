import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MAX_FILE_SIZE, MAX_IMAGES_PER_MESSAGE, type AttachmentPreview } from './attachmentTypes';

// The store's only effect is announcing refusals. Stubbing the modal keeps these tests
// about the queue's behavior; the admission rule those alerts render is checked
// directly, and without mocks, in attachmentTypes.spec.ts.
const alert = vi.fn();
vi.mock('@/modal', () => ({ Modal: { alert: (...args: unknown[]) => alert(...args) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

const {
    queueAttachments,
    takeAttachments,
    removeAttachment,
    clearAttachments,
    getSessionAttachments,
    subscribeQueueChanges,
} = await import('./attachmentQueue');

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

function image(id: string, size = 1024): AttachmentPreview {
    return {
        id,
        uri: `file:///${id}.png`,
        width: 100,
        height: 100,
        mimeType: 'image/png',
        size,
        name: `${id}.png`,
    };
}

function images(count: number, prefix: string): AttachmentPreview[] {
    return Array.from({ length: count }, (_, i) => image(`${prefix}-${i}`));
}

beforeEach(() => {
    alert.mockClear();
    clearAttachments(SESSION_A);
    clearAttachments(SESSION_B);
});

describe('queueAttachments', () => {
    it('appends to the addressed session and leaves other sessions alone', () => {
        queueAttachments(SESSION_A, [image('a1')]);
        queueAttachments(SESSION_A, [image('a2')]);
        queueAttachments(SESSION_B, [image('b1')]);

        expect(getSessionAttachments(SESSION_A).map((i) => i.id)).toEqual(['a1', 'a2']);
        expect(getSessionAttachments(SESSION_B).map((i) => i.id)).toEqual(['b1']);
    });

    it('queues only what fits and announces the refusal', () => {
        queueAttachments(SESSION_A, images(MAX_IMAGES_PER_MESSAGE + 3, 'a'));

        expect(getSessionAttachments(SESSION_A)).toHaveLength(MAX_IMAGES_PER_MESSAGE);
        expect(alert).toHaveBeenCalledTimes(1);
    });

    it('queues nothing and announces when every image is oversized', () => {
        queueAttachments(SESSION_A, [image('huge', MAX_FILE_SIZE + 1)]);

        expect(getSessionAttachments(SESSION_A)).toEqual([]);
        expect(alert).toHaveBeenCalledTimes(1);
    });

    // Both limits tripping at once must still produce one modal, never two stacked.
    it('announces once when both limits trip together', () => {
        queueAttachments(SESSION_A, images(MAX_IMAGES_PER_MESSAGE - 1, 'fill'));
        alert.mockClear();

        queueAttachments(SESSION_A, [image('ok-a'), image('ok-b'), image('huge', MAX_FILE_SIZE + 1)]);

        expect(alert).toHaveBeenCalledTimes(1);
        expect(getSessionAttachments(SESSION_A)).toHaveLength(MAX_IMAGES_PER_MESSAGE);
    });

    it('says nothing when everything is admitted', () => {
        queueAttachments(SESSION_A, images(3, 'a'));

        expect(alert).not.toHaveBeenCalled();
    });
});

describe('takeAttachments', () => {
    it('hands back the queue and empties it in one step', () => {
        queueAttachments(SESSION_A, images(2, 'a'));

        expect(takeAttachments(SESSION_A).map((i) => i.id)).toEqual(['a-0', 'a-1']);
        expect(getSessionAttachments(SESSION_A)).toEqual([]);
    });

    it('is empty on a second take, so a repeated send cannot duplicate images', () => {
        queueAttachments(SESSION_A, images(2, 'a'));
        takeAttachments(SESSION_A);

        expect(takeAttachments(SESSION_A)).toEqual([]);
    });

    it('takes only the addressed session, so images cannot ride along to another', () => {
        queueAttachments(SESSION_A, [image('a1')]);
        queueAttachments(SESSION_B, [image('b1')]);

        takeAttachments(SESSION_A);

        expect(getSessionAttachments(SESSION_B).map((i) => i.id)).toEqual(['b1']);
    });

    it('is empty for a session that never queued anything', () => {
        expect(takeAttachments('never-used')).toEqual([]);
    });
});

describe('removeAttachment', () => {
    it('removes by id and leaves the rest in order', () => {
        queueAttachments(SESSION_A, images(3, 'a'));

        removeAttachment(SESSION_A, 'a-1');

        expect(getSessionAttachments(SESSION_A).map((i) => i.id)).toEqual(['a-0', 'a-2']);
    });

    it('ignores an id belonging to a different session', () => {
        queueAttachments(SESSION_A, [image('a1')]);
        queueAttachments(SESSION_B, [image('b1')]);

        removeAttachment(SESSION_B, 'a1');

        expect(getSessionAttachments(SESSION_A).map((i) => i.id)).toEqual(['a1']);
        expect(getSessionAttachments(SESSION_B).map((i) => i.id)).toEqual(['b1']);
    });
});

// An emptied session's key is dropped from the map rather than kept as []. The
// observable consequence is that every empty session reads as the same array, so the
// composer strip does not re-render each time some other session's queue changes.
describe('empty sessions', () => {
    it('read as one shared empty array, whether emptied or never used', () => {
        queueAttachments(SESSION_A, [image('a1')]);
        takeAttachments(SESSION_A);

        expect(getSessionAttachments(SESSION_A)).toBe(getSessionAttachments('never-used'));
    });

    it('still read as empty after their last image is removed individually', () => {
        queueAttachments(SESSION_A, [image('a1')]);

        removeAttachment(SESSION_A, 'a1');

        expect(getSessionAttachments(SESSION_A)).toBe(getSessionAttachments('never-used'));
    });
});

describe('subscribeQueueChanges', () => {
    it('reports how many images a session gained and how many it now holds', () => {
        const seen: unknown[] = [];
        const unsubscribe = subscribeQueueChanges((additions) => seen.push(additions));

        queueAttachments(SESSION_A, images(2, 'a'));
        queueAttachments(SESSION_A, images(1, 'more'));

        unsubscribe();
        expect(seen).toEqual([
            [{ sessionId: SESSION_A, added: 2, total: 2 }],
            [{ sessionId: SESSION_A, added: 1, total: 3 }],
        ]);
    });

    it('reports only the session that grew, not its untouched neighbour', () => {
        queueAttachments(SESSION_B, images(2, 'b'));

        const seen: unknown[] = [];
        const unsubscribe = subscribeQueueChanges((additions) => seen.push(additions));

        queueAttachments(SESSION_A, [image('a1')]);

        unsubscribe();
        expect(seen).toEqual([[{ sessionId: SESSION_A, added: 1, total: 1 }]]);
    });

    // Growth-only: a take or a removal must not be announced to the voice agent as
    // "images are waiting", which is what a naive before/after diff would produce.
    it('reports no additions when a queue shrinks', () => {
        queueAttachments(SESSION_A, images(2, 'a'));

        const seen: unknown[] = [];
        const unsubscribe = subscribeQueueChanges((additions) => seen.push(additions));

        removeAttachment(SESSION_A, 'a-0');
        takeAttachments(SESSION_A);

        unsubscribe();
        expect(seen).toEqual([[], []]);
    });

    it('stops reporting once unsubscribed', () => {
        const seen: unknown[] = [];
        subscribeQueueChanges((additions) => seen.push(additions))();

        queueAttachments(SESSION_A, [image('a1')]);

        expect(seen).toEqual([]);
    });
});
