/**
 * The composer's handle on one session's attachment queue: what is queued, and every
 * way to queue it.
 *
 * State and limits live in `@/sync/attachmentQueue` — a store keyed by session id, so
 * senders outside this component tree (the voice tool) can see and consume the queue.
 * This hook contributes only the library-picker mechanics: permission prompt, the OS
 * picker, and preview construction. The picker, web paste, and drop all feed the same
 * `addImages`, which is the store's single limit gate.
 *
 * Note: fileSize from expo-image-picker is optional — some platforms do not
 * provide it (returns undefined → size=0). Such files pass the client-side
 * size check; the server enforces the limit on upload.
 */
import { useCallback, useMemo } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { t } from '@/text';
import {
    MAX_IMAGES_PER_MESSAGE,
    MAX_FILE_SIZE,
    type AttachmentPreview,
} from '@/sync/attachmentTypes';
import {
    useSessionAttachments,
    getSessionAttachments,
    queueAttachments,
    removeAttachment,
} from '@/sync/attachmentQueue';

export { MAX_IMAGES_PER_MESSAGE, MAX_FILE_SIZE };
export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<void>;
    removeImage: (id: string) => void;
    addImages: (images: AttachmentPreview[]) => void;
};

export function useImagePicker(sessionId: string): UseImagePickerResult {
    const selectedImages = useSessionAttachments(sessionId);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web') return true;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Modal.alert(
                t('imageUpload.permissionTitle'),
                t('imageUpload.permissionMessage'),
                [{ text: t('common.ok') }],
            );
            return false;
        }
        return true;
    }, []);

    const pickImages = useCallback(async () => {
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        // Not the limit — queueAttachments is. This only avoids opening a picker whose
        // every result would be refused, and caps the OS selection UI to what will fit.
        const remaining = MAX_IMAGES_PER_MESSAGE - getSessionAttachments(sessionId).length;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], // expo-image-picker ~55: MediaTypeOptions deprecated
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 1, // no recompression — preserve original for Claude
            exif: false,
        });

        if (result.canceled || !result.assets.length) return;

        const previews: AttachmentPreview[] = [];

        for (const asset of result.assets) {
            // Skip thumbhash if dimensions are unavailable (prevents divide-by-zero).
            const thumbhash = (asset.width > 0 && asset.height > 0)
                ? await generateThumbhash(asset.uri, asset.width, asset.height)
                : undefined;

            previews.push({
                id: `pick_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                uri: asset.uri,
                width: asset.width,
                height: asset.height,
                mimeType: asset.mimeType ?? 'image/jpeg',
                size: asset.fileSize ?? 0,
                name: asset.fileName ?? `image_${Date.now()}.jpg`,
                thumbhash,
            });
        }

        // No size or count check here on purpose — queueAttachments applies both, for
        // every source. `selectionLimit` above is a courtesy to the OS picker.
        queueAttachments(sessionId, previews);
    }, [requestPermission, sessionId]);

    return useMemo(() => ({
        selectedImages,
        pickImages,
        removeImage: (id: string) => removeAttachment(sessionId, id),
        addImages: (images: AttachmentPreview[]) => queueAttachments(sessionId, images),
    }), [selectedImages, pickImages, sessionId]);
}
