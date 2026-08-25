import { describe, expect, it } from 'vitest';
import { imageDimensionsOf } from './imageDimensions';
import type { ClaudeImageAttachment, ClaudeImageMediaType } from '@/claude/claudeImageAttachment';

function attachment(mediaType: ClaudeImageMediaType, data: Uint8Array): ClaudeImageAttachment {
    return { name: 'fixture', data, mediaType };
}

function pngHeader(width: number, height: number): Uint8Array {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
    new DataView(b.buffer).setUint32(16, width);
    new DataView(b.buffer).setUint32(20, height);
    return b;
}

function gifHeader(width: number, height: number): Uint8Array {
    const b = new Uint8Array(10);
    b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    new DataView(b.buffer).setUint16(6, width, true);
    new DataView(b.buffer).setUint16(8, height, true);
    return b;
}

/** SOI, one APP0 padding segment, then SOF0 carrying the frame size. */
function jpegHeader(width: number, height: number): Uint8Array {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x00];
    return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

function webpLosslessHeader(width: number, height: number): Uint8Array {
    const b = new Uint8Array(30);
    b.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 0);
    b[20] = 0x2f;
    const bits = (width - 1) | ((height - 1) << 14);
    b[21] = bits & 0xff;
    b[22] = (bits >> 8) & 0xff;
    b[23] = (bits >> 16) & 0xff;
    b[24] = (bits >> 24) & 0xff;
    return b;
}

describe('imageDimensionsOf', () => {
    it('reads PNG IHDR dimensions', () => {
        expect(imageDimensionsOf(attachment('image/png', pngHeader(1920, 1080)))).toEqual({ width: 1920, height: 1080 });
    });

    it('reads GIF logical screen dimensions', () => {
        expect(imageDimensionsOf(attachment('image/gif', gifHeader(320, 240)))).toEqual({ width: 320, height: 240 });
    });

    it('walks JPEG markers to the SOF frame header', () => {
        expect(imageDimensionsOf(attachment('image/jpeg', jpegHeader(2560, 1440)))).toEqual({ width: 2560, height: 1440 });
    });

    it('reads WebP VP8L packed dimensions', () => {
        expect(imageDimensionsOf(attachment('image/webp', webpLosslessHeader(800, 600)))).toEqual({ width: 800, height: 600 });
    });

    it('returns null for a header truncated past its magic bytes', () => {
        expect(imageDimensionsOf(attachment('image/png', pngHeader(64, 64).slice(0, 12)))).toBeNull();
    });

    it('returns null for zero-sized dimensions rather than emitting a degenerate aspect', () => {
        expect(imageDimensionsOf(attachment('image/gif', gifHeader(0, 100)))).toBeNull();
    });
});
