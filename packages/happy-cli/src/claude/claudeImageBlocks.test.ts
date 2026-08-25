import { describe, expect, it } from 'vitest';
import { parseImageAttachment, partitionAttachmentOutcomes } from '@/attachments/imageAttachment';
import { toClaudeImageBlocks } from './claudeImageBlocks';

/** Minimal blobs carrying only the magic header each format is recognised by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('toClaudeImageBlocks', () => {
  it('produces base64 image blocks in the shape the Anthropic SDK expects', () => {
    const { ready } = partitionAttachmentOutcomes([parseImageAttachment('shot.png', PNG)]);

    const blocks = toClaudeImageBlocks(ready);

    expect(blocks).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: Buffer.from(PNG).toString('base64'),
        },
      },
    ]);
  });

  it('round-trips the exact bytes it was given', () => {
    const { ready } = partitionAttachmentOutcomes([parseImageAttachment('shot.webp', WEBP)]);
    const [block] = toClaudeImageBlocks(ready);
    expect(new Uint8Array(Buffer.from(block.source.data, 'base64'))).toEqual(WEBP);
  });

  it('maps every attachment, preserving order', () => {
    const { ready } = partitionAttachmentOutcomes([
      parseImageAttachment('a.png', PNG),
      parseImageAttachment('b.gif', GIF),
    ]);
    expect(toClaudeImageBlocks(ready).map((b) => b.source.media_type)).toEqual(['image/png', 'image/gif']);
  });
});
