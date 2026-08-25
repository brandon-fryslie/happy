/**
 * Turning image files the browser hands us into attachments the composer can show.
 *
 * Two events deliver image files on web — paste and drop — and they differ in exactly
 * one way: where the File objects come from. Everything after that (measure, thumbhash,
 * mint an id) is identical, so it lives here once.
 *
 * [LAW:one-source-of-truth] If paste and drop each grew their own copy of the tail, the
 * two would drift on the details that are easy to get subtly different — the fallback
 * mime type, the generated name, whether a failed file is dropped or kept.
 */
import type { AttachmentPreview } from '@/sync/attachmentTypes';

export function getImagesFromClipboard(event: ClipboardEvent): File[] {
    const items = event.clipboardData?.items;
    if (!items) return [];

    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) images.push(file);
        }
    }
    return images;
}

/**
 * The images among a set of dropped files.
 *
 * Takes files rather than the DragEvent on purpose: the caller has to copy them out of
 * `dataTransfer` synchronously anyway, since the transfer is emptied as soon as the drop
 * handler returns. A signature that accepted the event would invite reading it late.
 */
export function filterImageFiles(files: File[]): File[] {
    return files.filter((file) => file.type.startsWith('image/'));
}

export async function fileToAttachmentPreview(
    file: File,
    generateThumbhash: (uri: string, w: number, h: number) => Promise<string | undefined>,
): Promise<Omit<AttachmentPreview, 'id'> | null> {
    try {
        const uri = URL.createObjectURL(file);

        // Get dimensions by loading as an Image element
        const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const img = new Image();
            const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
            img.onload = () => {
                clearTimeout(timeout);
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('load error'));
            };
            img.src = uri;
        });

        const thumbhash = (width > 0 && height > 0)
            ? await generateThumbhash(uri, width, height)
            : undefined;

        return {
            uri,
            width,
            height,
            size: file.size,
            name: file.name || `image_${Date.now()}.png`,
            mimeType: file.type || 'image/png',
            thumbhash,
        };
    } catch {
        return null;
    }
}

/**
 * The whole tail, from files to attachments ready for `onAddImages`.
 *
 * `origin` only distinguishes the generated ids, so a pasted and a dropped copy of the
 * same screenshot remain separately removable. Files that fail to measure are skipped
 * rather than attached blank — an attachment with no dimensions cannot be rendered or
 * uploaded, so keeping it would only surface later as an unexplained upload failure.
 */
export async function imageFilesToAttachments(
    files: File[],
    origin: 'paste' | 'drop',
    generateThumbhash: (uri: string, w: number, h: number) => Promise<string | undefined>,
): Promise<AttachmentPreview[]> {
    const previews = await Promise.all(
        files.map((file) => fileToAttachmentPreview(file, generateThumbhash)),
    );
    return previews
        .filter((p): p is Omit<AttachmentPreview, 'id'> => p !== null)
        .map((p) => ({
            ...p,
            id: `${origin}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        }));
}
