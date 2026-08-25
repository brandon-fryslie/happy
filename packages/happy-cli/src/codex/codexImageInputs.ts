/**
 * The Codex adapter for image attachments: proven attachments in, localImage
 * InputItems out.
 *
 * Codex's app-server takes images by file path, not by inline bytes, so this
 * adapter's whole job is the effect the Claude adapter doesn't need: writing
 * each attachment to a private temp directory and handing back the paths —
 * plus the cleanup that unwinds the write once the turn no longer needs the
 * files. [LAW:effects-at-boundaries] the effect lives here, at the SDK edge,
 * and travels with an explicit cleanup instead of leaking files into tmpdir.
 *
 * Filenames are synthesized from index + proven media type, never from the
 * user-supplied attachment name — a name is data, not a path component.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageAttachment, ImageMediaType } from '@/attachments/imageAttachment';
import type { ImageInputItem } from './codexAppServerTypes';

/** Extension per proven media type — total over the enum, so no fallback arm. */
const EXTENSIONS: Record<ImageMediaType, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

export type CodexImageInputs = {
    items: ImageInputItem[];
    /** Removes the temp files backing `items`. Call once the turn has completed. */
    cleanup(): Promise<void>;
};

/**
 * Write attachments to a fresh temp directory and shape them as localImage
 * items, preserving order. The caller owns the returned cleanup:
 * [LAW:no-ambient-temporal-coupling] the files' lifetime is an explicit
 * hand-off, not an assumption about when tmpdir gets purged.
 */
export async function writeCodexImageInputs(attachments: ImageAttachment[]): Promise<CodexImageInputs> {
    const dir = await mkdtemp(join(tmpdir(), 'happy-codex-img-'));
    const items = await Promise.all(attachments.map(async (attachment, index): Promise<ImageInputItem> => {
        const path = join(dir, `img-${index}.${EXTENSIONS[attachment.mediaType]}`);
        await writeFile(path, attachment.data);
        return { type: 'localImage', path };
    }));
    return {
        items,
        cleanup: () => rm(dir, { recursive: true, force: true }),
    };
}
