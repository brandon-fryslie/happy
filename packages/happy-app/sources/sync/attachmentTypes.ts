/**
 * Shared types for image attachment upload pipeline.
 * Defined here (not in hooks/) to avoid circular dependencies:
 * hooks/ imports from sync/, so sync/ cannot import from hooks/.
 */

export type AttachmentPreview = {
    /** Stable unique identifier for use as React key and for removal. */
    id: string;
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    /** May be 0 if the system did not provide the file size. */
    size: number;
    name: string;
    thumbhash?: string;
};

/**
 * The limits on what may be attached to one message.
 *
 * [LAW:one-source-of-truth] These live here, next to the type they constrain, because
 * both sides need them and neither may import the other: `sync/` speaks to the server
 * and `hooks/` drives the composer. Before this, 10MB was written down twice — in the
 * picker that warned about it and in the upload client that reported the server's 413 —
 * and two copies of a number are two numbers waiting to disagree.
 */
export const MAX_IMAGES_PER_MESSAGE = 20;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / 1024 / 1024;

/**
 * Why some of the incoming images were turned away, when some were.
 *
 * [LAW:types-are-the-program] At most one refusal is representable, which is the whole
 * point: when both limits bite at once the user must see one message, not two stacked
 * modals. Making that a variant rather than a pair of booleans means the precedence
 * rule is decided once, in `admitAttachments`, instead of being re-derived by every
 * caller that renders it.
 */
export type AttachmentRefusal =
    /** At least one image was over `MAX_FILE_SIZE`. Carries them for naming in the message. */
    | { kind: 'oversized'; images: AttachmentPreview[] }
    /** Everything was small enough, but the queue would have exceeded the count limit. */
    | { kind: 'over-count' };

export type AttachmentAdmission = {
    /** The images to append, already truncated to what the count limit allows. */
    accepted: AttachmentPreview[];
    /** What to tell the user, or `null` when everything was admitted. */
    refusal: AttachmentRefusal | null;
};

/**
 * Decide which of `incoming` may join a queue that already holds `queued`.
 *
 * [LAW:effects-at-boundaries] Pure, so the rule can be checked directly rather than
 * inferred from which modal appeared. `queueAttachments` is the boundary that applies
 * the decision and announces the refusal.
 *
 * The size refusal wins when both limits trip together: it is the more surprising of
 * the two, and a user who hears only about the count limit would retry with the same
 * oversized file. The count refusal is not lost so much as deferred — the next attempt
 * reports it, because the queue is still full.
 */
export function admitAttachments(
    queued: AttachmentPreview[],
    incoming: AttachmentPreview[],
): AttachmentAdmission {
    const oversized = incoming.filter((img) => img.size > MAX_FILE_SIZE);
    const admissible = incoming.filter((img) => img.size <= MAX_FILE_SIZE);

    const remaining = Math.max(0, MAX_IMAGES_PER_MESSAGE - queued.length);
    const accepted = admissible.slice(0, remaining);

    return {
        accepted,
        refusal: oversized.length > 0
            ? { kind: 'oversized', images: oversized }
            : admissible.length > accepted.length
                ? { kind: 'over-count' }
                : null,
    };
}

/** Result of a successful attachment upload — ready to build a file event. */
export type UploadedAttachment = {
    ref: string;
    name: string;
    size: number;
    width: number;
    height: number;
    thumbhash?: string;
};
