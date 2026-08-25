/**
 * Pixel dimensions read straight from an image's header bytes.
 *
 * The CLI has no canvas or native image decoder, but the app's FileView wants
 * a real aspect ratio to lay out an inline image before the blob downloads.
 * Every format Claude accepts states its dimensions in the first few dozen
 * bytes, so a header read covers exactly the formats that can reach us.
 *
 * Input is a ClaudeImageAttachment, whose mediaType was proven against the
 * magic header at the checkpoint — so dispatch is a total lookup over the
 * four-format enum, never a guess. [LAW:parse-dont-validate] consumes the
 * stamp instead of re-sniffing.
 */
import type { ClaudeImageAttachment, ClaudeImageMediaType } from '@/claude/claudeImageAttachment';

export type ImageDimensions = { width: number; height: number };

function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function u24le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

/** PNG: IHDR is always the first chunk — width/height at fixed offsets 16/20. */
function pngDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * JPEG: walk the marker stream to the first frame header (SOF). Dimensions
 * live in the frame header, not at a fixed offset, because arbitrary APPn /
 * comment segments precede it.
 */
function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    // Standalone markers (RST, TEM) carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { width: u16be(b, o + 7), height: u16be(b, o + 5) };
    }
    o += 2 + u16be(b, o + 2);
  }
  return null;
}

/** GIF: logical screen size sits right after the 6-byte signature. */
function gifDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/**
 * WebP: the first chunk after the RIFF header decides the layout — lossy
 * (VP8), lossless (VP8L), or extended (VP8X) each state dimensions their
 * own way.
 */
function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8 ') {
    // Key-frame start code 9d 01 2a, then 14-bit width/height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

const PARSERS: Record<ClaudeImageMediaType, (b: Uint8Array) => ImageDimensions | null> = {
  'image/png': pngDimensions,
  'image/jpeg': jpegDimensions,
  'image/gif': gifDimensions,
  'image/webp': webpDimensions,
};

/**
 * Null means the header was malformed past its magic bytes — the image may
 * still decode; the caller just loses the pre-download aspect ratio.
 */
export function imageDimensionsOf(attachment: ClaudeImageAttachment): ImageDimensions | null {
  const parsed = PARSERS[attachment.mediaType](attachment.data);
  if (!parsed || parsed.width <= 0 || parsed.height <= 0) return null;
  return parsed;
}
