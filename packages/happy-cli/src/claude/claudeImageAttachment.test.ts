import { describe, expect, it } from 'vitest';
import {
  describeRejectedAttachments,
  parseClaudeImageAttachment,
  partitionAttachmentOutcomes,
  unreadableAttachment,
  type AttachmentOutcome,
} from './claudeImageAttachment';
import { toClaudeImageBlocks } from './claudeImageBlocks';

/** Minimal blobs carrying only the magic header each format is recognised by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
/** HEIC — what an iOS picker hands over, and what the Anthropic API rejects. */
const HEIC = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

describe('parseClaudeImageAttachment', () => {
  it.each([
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
  ])('stamps %s bytes with the media type Claude accepts', (_label, bytes, expected) => {
    const outcome = parseClaudeImageAttachment('shot.bin', bytes);
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.attachment.mediaType).toBe(expected);
    expect(outcome.attachment.name).toBe('shot.bin');
  });

  it('derives the media type from the bytes, not from the filename', () => {
    // An iOS picker routinely names a JPEG ".heic"; the header is the truth.
    const outcome = parseClaudeImageAttachment('IMG_0042.heic', JPEG);
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.attachment.mediaType).toBe('image/jpeg');
  });

  it('rejects a genuinely unsupported format instead of guessing one', () => {
    const outcome = parseClaudeImageAttachment('IMG_0042.heic', HEIC);
    expect(outcome).toEqual({
      kind: 'rejected',
      rejection: { name: 'IMG_0042.heic', reason: 'unsupported-format' },
    });
  });

  it('rejects a truncated blob too short to identify', () => {
    const outcome = parseClaudeImageAttachment('empty.png', new Uint8Array([0x89]));
    expect(outcome.kind).toBe('rejected');
  });
});

describe('partitionAttachmentOutcomes', () => {
  it('keeps the name of every attachment that will not reach Claude', () => {
    const outcomes: AttachmentOutcome[] = [
      parseClaudeImageAttachment('good.png', PNG),
      parseClaudeImageAttachment('bad.heic', HEIC),
      unreadableAttachment('locked.png'),
    ];

    const { ready, rejected } = partitionAttachmentOutcomes(outcomes);

    expect(ready.map((a) => a.name)).toEqual(['good.png']);
    expect(rejected).toEqual([
      { name: 'bad.heic', reason: 'unsupported-format' },
      { name: 'locked.png', reason: 'unreadable' },
    ]);
  });

  it('reports nothing when every attachment is sendable', () => {
    const { ready, rejected } = partitionAttachmentOutcomes([
      parseClaudeImageAttachment('a.png', PNG),
      parseClaudeImageAttachment('b.jpg', JPEG),
    ]);
    expect(ready).toHaveLength(2);
    expect(rejected).toEqual([]);
  });
});

describe('describeRejectedAttachments', () => {
  it('names each file and why it was dropped', () => {
    const notice = describeRejectedAttachments([
      { name: 'bad.heic', reason: 'unsupported-format' },
      { name: 'locked.png', reason: 'unreadable' },
    ]);
    expect(notice).toContain('bad.heic');
    expect(notice).toContain('locked.png');
    expect(notice).toContain('PNG, JPEG, GIF, WebP');
    expect(notice).toContain('2 attachments');
  });

  it('stays grammatical for a single rejection', () => {
    const notice = describeRejectedAttachments([{ name: 'bad.heic', reason: 'unsupported-format' }]);
    expect(notice).toContain('1 attachment did not reach Claude');
  });
});

describe('toClaudeImageBlocks', () => {
  it('produces base64 image blocks in the shape the Anthropic SDK expects', () => {
    const { ready } = partitionAttachmentOutcomes([parseClaudeImageAttachment('shot.png', PNG)]);

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
    const { ready } = partitionAttachmentOutcomes([parseClaudeImageAttachment('shot.webp', WEBP)]);
    const [block] = toClaudeImageBlocks(ready);
    expect(new Uint8Array(Buffer.from(block.source.data, 'base64'))).toEqual(WEBP);
  });

  it('maps every attachment, preserving order', () => {
    const { ready } = partitionAttachmentOutcomes([
      parseClaudeImageAttachment('a.png', PNG),
      parseClaudeImageAttachment('b.gif', GIF),
    ]);
    expect(toClaudeImageBlocks(ready).map((b) => b.source.media_type)).toEqual(['image/png', 'image/gif']);
  });
});
