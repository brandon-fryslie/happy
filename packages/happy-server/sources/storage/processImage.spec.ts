import sharp from 'sharp';
import { processImage } from './processImage';
import { describe, it, expect } from 'vitest';

/**
 * Inputs are generated rather than read from a checked-in binary. The previous version
 * of this file read sources/storage/__testdata__/image.jpg, which does not exist on this
 * branch, so the suite failed at the first line of the only test — and that test had no
 * expect() in it at all, meaning even with the fixture present it asserted nothing beyond
 * "did not throw". Generating the image keeps the test self-contained and lets it state
 * the actual contract.
 */
function solidImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp') {
    return sharp({
        create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })[format]().toBuffer();
}

describe('processImage', () => {
    it('reports the source dimensions and format, not the resized ones', async () => {
        const result = await processImage(await solidImage(200, 100, 'jpeg'));

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.format).toBe('jpeg');
    });

    it('fits the longest edge to 100px and preserves aspect ratio in the pixel buffer', async () => {
        // Landscape 200x100 scales to 100x50; the buffer is raw RGBA, so 4 bytes a pixel.
        const landscape = await processImage(await solidImage(200, 100, 'jpeg'));
        expect(landscape.pixels.length).toBe(100 * 50 * 4);

        // Portrait is the mirror case, and it is the branch a square-only fixture would
        // never have reached.
        const portrait = await processImage(await solidImage(100, 200, 'png'));
        expect(portrait.pixels.length).toBe(50 * 100 * 4);

        const square = await processImage(await solidImage(120, 120, 'png'));
        expect(square.pixels.length).toBe(100 * 100 * 4);
    });

    it('derives a non-empty base64 thumbhash', async () => {
        const result = await processImage(await solidImage(200, 100, 'jpeg'));

        expect(result.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
        expect(Buffer.from(result.thumbhash, 'base64').length).toBeGreaterThan(0);
    });

    it('rejects formats other than png and jpeg', async () => {
        await expect(processImage(await solidImage(120, 120, 'webp')))
            .rejects.toThrow('Unsupported image format');
    });
});
