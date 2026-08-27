/**
 * The pending-attachment queue for every session's composer, keyed by session id.
 *
 * [LAW:no-shared-mutable-globals] This store is the queue's single owner. It used to
 * live as component state inside the composer, which made it invisible to every other
 * sender — a voice-dictated message silently dropped the images sitting in the strip,
 * because the voice tool had no way to reach them. Now the composer, the picker, paste,
 * drop, and the voice tool all go through this one API, and any consumer that takes the
 * queue is reflected back into the strip automatically because the strip reads the same
 * state.
 *
 * [LAW:single-enforcer] `queueAttachments` is the one gate every attachment passes
 * through, whatever picked it — library picker, web paste, or drag-and-drop. It applies
 * the size and count limits and announces refusals, so every source obeys the limits
 * and hears about them the same way. When both limits bite at once the size warning
 * wins — it is the more surprising of the two, and stacking two modals is worse than
 * deferring one message the user will see on their next attempt.
 *
 * Keying by session id is what makes cross-session leaks unrepresentable: a consumer
 * can only take the queue of the session it names, so images queued for session A can
 * never ride along on a message to session B.
 */
import { create } from 'zustand';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    MAX_IMAGES_PER_MESSAGE,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_MB,
    type AttachmentPreview,
} from '@/sync/attachmentTypes';

type AttachmentQueues = Record<string, AttachmentPreview[]>;

const useAttachmentQueueStore = create<{ queues: AttachmentQueues }>(() => ({
    queues: {},
}));

// Stable empty result so the selector doesn't fabricate a new array (and a re-render)
// on every store change for sessions with nothing queued.
const NO_ATTACHMENTS: AttachmentPreview[] = [];

/** Reactive read of one session's queue — this is what the composer strip renders. */
export function useSessionAttachments(sessionId: string): AttachmentPreview[] {
    return useAttachmentQueueStore((s) => s.queues[sessionId] ?? NO_ATTACHMENTS);
}

/** Non-reactive read, for callers that need the current count synchronously. */
export function getSessionAttachments(sessionId: string): AttachmentPreview[] {
    return useAttachmentQueueStore.getState().queues[sessionId] ?? NO_ATTACHMENTS;
}

/**
 * Queue images for a session, enforcing the per-message limits.
 * Refusals are announced rather than absorbed: dropping twenty-five screenshots at
 * once used to append twenty and discard five without a word, which looks exactly
 * like the app losing them.
 */
export function queueAttachments(sessionId: string, images: AttachmentPreview[]): void {
    const oversized = images.filter((img) => img.size > MAX_FILE_SIZE);
    const admissible = images.filter((img) => img.size <= MAX_FILE_SIZE);

    const current = getSessionAttachments(sessionId);
    const remaining = Math.max(0, MAX_IMAGES_PER_MESSAGE - current.length);
    const accepted = admissible.slice(0, remaining);

    if (accepted.length > 0) {
        useAttachmentQueueStore.setState((s) => ({
            queues: withQueue(s.queues, sessionId, [...(s.queues[sessionId] ?? []), ...accepted]),
        }));
    }

    // The refusal alerts below stay outside the updater: a state updater must be pure
    // and may be invoked more than once, which would stutter the modal.

    if (oversized.length > 0) {
        Modal.alert(
            t('imageUpload.fileTooLargeTitle'),
            oversized.length === 1
                ? t('imageUpload.fileTooLargeMessage', { name: oversized[0].name, maxMb: MAX_FILE_SIZE_MB })
                : t('imageUpload.filesTooLargeMessage', { count: oversized.length, maxMb: MAX_FILE_SIZE_MB }),
            [{ text: t('common.ok') }],
        );
    } else if (admissible.length > accepted.length) {
        Modal.alert(
            t('imageUpload.limitTitle'),
            t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
            [{ text: t('common.ok') }],
        );
    }
}

export function removeAttachment(sessionId: string, id: string): void {
    useAttachmentQueueStore.setState((s) => {
        const filtered = (s.queues[sessionId] ?? []).filter((img) => img.id !== id);
        return { queues: withQueue(s.queues, sessionId, filtered) };
    });
}

export function clearAttachments(sessionId: string): void {
    useAttachmentQueueStore.setState((s) => ({ queues: withQueue(s.queues, sessionId, []) }));
}

/**
 * Consume-and-clear: hand the caller everything queued for this session and empty the
 * queue in the same step. This is the seam a send path uses — one call, and the strip
 * visibly empties because it renders this same state.
 */
export function takeAttachments(sessionId: string): AttachmentPreview[] {
    const taken = getSessionAttachments(sessionId);
    if (taken.length > 0) {
        clearAttachments(sessionId);
    }
    return taken;
}

/** One session's queue growing, as reported to subscribers. `added` is always >= 1. */
export type AttachmentAddition = {
    sessionId: string;
    /** How many images this change appended. */
    added: number;
    /** How many are queued for the session after the change. */
    total: number;
};

/**
 * Observe queue growth across all sessions; the voice layer uses this to tell the
 * agent that images are waiting to ride along.
 *
 * The store does the diffing rather than handing out before/after maps, because
 * "which sessions gained images" is the only question any subscriber has ever asked,
 * and a subscriber holding two raw maps would have to re-derive it — differently, and
 * eventually wrongly, in each new subscriber. [LAW:types-are-the-program] the callback
 * signature carries the answer, so there is no growth-vs-shrink logic left downstream.
 *
 * Fires on every queue change, with an empty list when the change was a removal or a
 * take. [LAW:dataflow-not-control-flow] the listener always runs and maps over the
 * list; an empty list is the identity case, not a skipped call.
 */
export function subscribeQueueChanges(
    listener: (additions: AttachmentAddition[]) => void,
): () => void {
    return useAttachmentQueueStore.subscribe((state, prevState) => {
        listener(additionsBetween(state.queues, prevState.queues));
    });
}

/**
 * Pure diff — every session in `next` is measured against `prev`, then the ones that
 * grew are selected. [LAW:effects-at-boundaries] no sending happens here; the caller
 * owns that. Sessions absent from `next` cannot have grown, so iterating `next` is
 * complete.
 */
function additionsBetween(next: AttachmentQueues, prev: AttachmentQueues): AttachmentAddition[] {
    return Object.entries(next)
        .map(([sessionId, images]) => ({
            sessionId,
            // A session with nothing queued holds no key at all (see withQueue), so
            // absence here genuinely means zero rather than standing in for a missing
            // value — this is the domain's own optionality, not a defensive guard.
            added: images.length - (prev[sessionId]?.length ?? 0),
            total: images.length,
        }))
        .filter((addition) => addition.added > 0);
}

// An emptied session's key is deleted rather than kept as [], so the queues map only
// ever holds sessions that actually have something pending.
function withQueue(queues: AttachmentQueues, sessionId: string, images: AttachmentPreview[]): AttachmentQueues {
    if (images.length === 0) {
        const { [sessionId]: _removed, ...rest } = queues;
        return rest;
    }
    return { ...queues, [sessionId]: images };
}
