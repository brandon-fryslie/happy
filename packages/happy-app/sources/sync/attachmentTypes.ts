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

/** Result of a successful attachment upload — ready to build a file event. */
export type UploadedAttachment = {
    ref: string;
    name: string;
    size: number;
    width: number;
    height: number;
    thumbhash?: string;
};
