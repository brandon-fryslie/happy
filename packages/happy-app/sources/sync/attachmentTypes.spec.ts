import { describe, it, expect } from 'vitest';
import {
    admitAttachments,
    MAX_FILE_SIZE,
    MAX_IMAGES_PER_MESSAGE,
    type AttachmentPreview,
} from './attachmentTypes';

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

function images(count: number, prefix = 'img', size = 1024): AttachmentPreview[] {
    return Array.from({ length: count }, (_, i) => image(`${prefix}-${i}`, size));
}

const TOO_BIG = MAX_FILE_SIZE + 1;

describe('admitAttachments', () => {
    it('admits everything when both limits have room', () => {
        const incoming = images(3);
        expect(admitAttachments([], incoming)).toEqual({ accepted: incoming, refusal: null });
    });

    it('admits an image sitting exactly on the size limit', () => {
        const incoming = [image('edge', MAX_FILE_SIZE)];
        expect(admitAttachments([], incoming)).toEqual({ accepted: incoming, refusal: null });
    });

    it('refuses oversized images by name and admits the rest', () => {
        const small = image('small');
        const big = image('big', TOO_BIG);

        const result = admitAttachments([], [small, big]);

        expect(result.accepted).toEqual([small]);
        expect(result.refusal).toEqual({ kind: 'oversized', images: [big] });
    });

    it('truncates to the room left in the queue and reports the count refusal', () => {
        const queued = images(MAX_IMAGES_PER_MESSAGE - 2, 'queued');
        const incoming = images(5, 'incoming');

        const result = admitAttachments(queued, incoming);

        expect(result.accepted).toEqual(incoming.slice(0, 2));
        expect(result.refusal).toEqual({ kind: 'over-count' });
    });

    it('fills the queue to exactly the limit without refusing', () => {
        const queued = images(MAX_IMAGES_PER_MESSAGE - 2, 'queued');
        const incoming = images(2, 'incoming');

        expect(admitAttachments(queued, incoming)).toEqual({ accepted: incoming, refusal: null });
    });

    it('admits nothing once the queue is full', () => {
        const result = admitAttachments(images(MAX_IMAGES_PER_MESSAGE, 'queued'), images(1, 'incoming'));

        expect(result.accepted).toEqual([]);
        expect(result.refusal).toEqual({ kind: 'over-count' });
    });

    // The count-limit check clamps at zero rather than going negative, so a queue that
    // somehow overshot the limit still refuses cleanly instead of slicing backwards.
    it('admits nothing when the queue is already past the limit', () => {
        const result = admitAttachments(images(MAX_IMAGES_PER_MESSAGE + 3, 'queued'), images(1, 'incoming'));

        expect(result.accepted).toEqual([]);
        expect(result.refusal).toEqual({ kind: 'over-count' });
    });

    // The precedence that keeps two modals from stacking: the size refusal is the more
    // surprising of the two, and the count refusal recurs on the next attempt anyway.
    it('reports the size refusal, not the count refusal, when both limits trip at once', () => {
        const queued = images(MAX_IMAGES_PER_MESSAGE - 1, 'queued');
        const incoming = [image('small-a'), image('small-b'), image('huge', TOO_BIG)];

        const result = admitAttachments(queued, incoming);

        expect(result.accepted).toEqual([image('small-a')]);
        expect(result.refusal).toEqual({ kind: 'oversized', images: [image('huge', TOO_BIG)] });
    });

    it('carries every oversized image so the message can count them', () => {
        const big = [image('big-a', TOO_BIG), image('big-b', TOO_BIG)];

        expect(admitAttachments([], big)).toEqual({
            accepted: [],
            refusal: { kind: 'oversized', images: big },
        });
    });

    it('refuses nothing when handed nothing', () => {
        expect(admitAttachments(images(3, 'queued'), [])).toEqual({ accepted: [], refusal: null });
    });
});
