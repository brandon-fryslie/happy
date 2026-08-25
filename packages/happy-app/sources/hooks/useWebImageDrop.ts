/**
 * Attach images dropped onto the window (web and Tauri desktop).
 *
 * Drop is paste's sibling: a different browser event carrying the same File objects to
 * the same place. Only the event handling lives here — `@/utils/imageFiles.web` owns
 * turning files into attachments, and the `onAddImages` this is given owns the limits.
 * [LAW:single-enforcer] Passing `undefined` is how a session that cannot take images
 * switches drop off, the same prop and the same condition that hides the attach button
 * and disables paste; nothing here re-derives that capability.
 *
 * The listeners sit on `document`, matching the paste handler in AgentInput, because the
 * composer renders through react-native-web and has no DOM node to hand out. Landing
 * anywhere in the window is also the better target — aiming at a one-line text input
 * with a file under the cursor is a poor thing to ask of anyone.
 *
 * On Tauri this works only because the window sets `dragDropEnabled: false`. Left at its
 * default, Tauri swallows OS file drops at the native layer to emit its own Rust-side
 * event and the webview never sees them. Disabling it lets desktop and web run this one
 * implementation instead of a second, path-based one behind a `fs` capability.
 *
 * @returns whether a file drag is currently over the window, for rendering the overlay.
 */
import * as React from 'react';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { t } from '@/text';
import { generateThumbhash } from '@/utils/thumbhash';
import { dragCarriesFiles, DragDepth } from '@/utils/dropTarget';
import type { AttachmentPreview } from '@/sync/attachmentTypes';

type AddImages = (images: AttachmentPreview[]) => void;

export function useWebImageDrop(onAddImages: AddImages | undefined): boolean {
    const [isDragActive, setIsDragActive] = React.useState(false);

    // Read through a ref so a caller passing a fresh closure each render does not
    // detach and reattach the listeners mid-drag, which would strand the depth count.
    const onAddImagesRef = React.useRef(onAddImages);
    onAddImagesRef.current = onAddImages;

    const enabled = Platform.OS === 'web' && !!onAddImages;

    React.useEffect(() => {
        if (!enabled) {
            setIsDragActive(false);
            return;
        }

        const depth = new DragDepth();

        const onDragEnter = (e: DragEvent) => {
            if (!dragCarriesFiles(e.dataTransfer?.types)) return;
            e.preventDefault();
            depth.enter();
            setIsDragActive(true);
        };

        const onDragOver = (e: DragEvent) => {
            if (!dragCarriesFiles(e.dataTransfer?.types)) return;
            // Required, every time: a dragover that is not defaultPrevented tells the
            // browser this is not a drop target, and no drop event ever arrives.
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        };

        // Deliberately not gated on dragCarriesFiles, unlike its siblings. A leave we
        // fail to count leaves the overlay covering the app until the next drag, which
        // is far worse than hiding it a moment early — and since only a file drag can
        // raise the count, an uncounted leave can only ever clamp at zero.
        const onDragLeave = () => {
            if (!depth.leave()) setIsDragActive(false);
        };

        const onDrop = (e: DragEvent) => {
            if (!dragCarriesFiles(e.dataTransfer?.types)) return;
            // Also required, and for a harsher reason: an un-prevented file drop makes
            // the browser navigate to the file, tearing down the session.
            e.preventDefault();
            depth.reset();
            setIsDragActive(false);

            // Copy the file list out now, before anything yields. The DataTransfer is
            // emptied the moment this handler returns, so the dynamic import below is
            // already too late to read it — the File objects themselves stay valid.
            const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
            if (dropped.length === 0) return;

            void (async () => {
                const { filterImageFiles, imageFilesToAttachments } = await import('@/utils/imageFiles.web');
                const images = filterImageFiles(dropped);

                if (images.length === 0) {
                    // We swallowed the drop to protect the session, so the files went
                    // nowhere and left no trace. Say so rather than look broken.
                    Modal.alert(
                        t('imageUpload.notAnImageTitle'),
                        t('imageUpload.notAnImageMessage'),
                        [{ text: t('common.ok') }],
                    );
                    return;
                }

                const attachments = await imageFilesToAttachments(images, 'drop', generateThumbhash);
                if (attachments.length > 0) {
                    onAddImagesRef.current?.(attachments);
                }
            })();
        };

        document.addEventListener('dragenter', onDragEnter);
        document.addEventListener('dragover', onDragOver);
        document.addEventListener('dragleave', onDragLeave);
        document.addEventListener('drop', onDrop);
        return () => {
            document.removeEventListener('dragenter', onDragEnter);
            document.removeEventListener('dragover', onDragOver);
            document.removeEventListener('dragleave', onDragLeave);
            document.removeEventListener('drop', onDrop);
            setIsDragActive(false);
        };
    }, [enabled]);

    return isDragActive;
}
