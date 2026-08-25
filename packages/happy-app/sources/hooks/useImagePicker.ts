/**
 * Image attachment state for one composer: what is queued, and every way to queue it.
 *
 * Three sources feed the same queue — the library picker here, and web paste and drop
 * through `addImages`. [LAW:single-enforcer] `addImages` is where the limits are
 * applied, so every source obeys them and hears about it the same way. Previously the
 * picker checked the 10MB limit and paste did not, which meant a pasted screenshot too
 * large to upload was accepted silently and failed minutes later, after send, as a
 * generic "upload failed".
 *
 * Note: fileSize from expo-image-picker is optional — some platforms do not
 * provide it (returns undefined → size=0). Such files pass the client-side
 * size check; the server enforces the limit on upload.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { t } from '@/text';
import {
    MAX_IMAGES_PER_MESSAGE,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_MB,
    type AttachmentPreview,
} from '@/sync/attachmentTypes';

export { MAX_IMAGES_PER_MESSAGE, MAX_FILE_SIZE };
export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<void>;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addImages: (images: AttachmentPreview[]) => void;
};

export function useImagePicker(): UseImagePickerResult {
    const [selectedImages, setSelectedImages] = useState<AttachmentPreview[]>([]);
    // Ref tracks current count to avoid stale closures on rapid taps.
    const selectedCountRef = useRef(0);
    useEffect(() => {
        selectedCountRef.current = selectedImages.length;
    }, [selectedImages]);

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

    /**
     * The one gate every attachment passes through, whatever picked it.
     *
     * Refusals are announced rather than absorbed: dropping twenty-five screenshots at
     * once used to append twenty and discard five without a word, which looks exactly
     * like the app losing them. When both limits bite at once the size warning wins —
     * it is the more surprising of the two, and stacking two modals is worse than
     * deferring one message the user will see on their next attempt.
     */
    const addImages = useCallback((images: AttachmentPreview[]) => {
        const oversized = images.filter(img => img.size > MAX_FILE_SIZE);
        const admissible = images.filter(img => img.size <= MAX_FILE_SIZE);

        const remaining = Math.max(0, MAX_IMAGES_PER_MESSAGE - selectedCountRef.current);
        const accepted = admissible.slice(0, remaining);

        if (accepted.length > 0) {
            // Advance the count here rather than waiting for the effect above to
            // reconcile it: two calls landing in the same tick would otherwise both
            // read the same pre-append count and together overshoot the limit.
            selectedCountRef.current += accepted.length;
            setSelectedImages(prev => [...prev, ...accepted]);
        }

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
    }, []);

    const pickImages = useCallback(async () => {
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        // Not the limit — addImages is. This only avoids opening a picker whose every
        // result would be refused, and caps the OS selection UI to what will fit.
        const remaining = MAX_IMAGES_PER_MESSAGE - selectedCountRef.current;
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

        // No size or count check here on purpose — addImages applies both, for every
        // source. `selectionLimit` above is a courtesy to the OS picker, not the limit.
        addImages(previews);
    }, [requestPermission, addImages]);

    const removeImage = useCallback((id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    }, []);

    const clearImages = useCallback(() => {
        setSelectedImages([]);
    }, []);

    return { selectedImages, pickImages, removeImage, clearImages, addImages };
}
