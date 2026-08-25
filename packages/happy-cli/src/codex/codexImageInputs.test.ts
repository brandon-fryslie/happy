import { describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { parseImageAttachment, partitionAttachmentOutcomes } from '@/attachments/imageAttachment';
import { writeCodexImageInputs } from './codexImageInputs';

/** Minimal blobs carrying only the magic header each format is recognised by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('writeCodexImageInputs', () => {
  it('converts proven wire attachments into localImage InputItems backed by real files', async () => {
    // The same path a wire attachment takes: bytes through the checkpoint,
    // then into the Codex input shape.
    const { ready } = partitionAttachmentOutcomes([
      parseImageAttachment('shot.png', PNG),
      parseImageAttachment('photo.jpg', JPEG),
    ]);

    const inputs = await writeCodexImageInputs(ready);
    try {
      expect(inputs.items).toHaveLength(2);
      expect(inputs.items[0]).toMatchObject({ type: 'localImage' });
      expect(inputs.items[1]).toMatchObject({ type: 'localImage' });

      const [first, second] = inputs.items;
      if (first.type !== 'localImage' || second.type !== 'localImage') throw new Error('expected localImage items');

      // Extension comes from the proven media type, order is preserved,
      // and the file holds the exact attachment bytes.
      expect(first.path.endsWith('.png')).toBe(true);
      expect(second.path.endsWith('.jpg')).toBe(true);
      expect(new Uint8Array(await readFile(first.path))).toEqual(PNG);
      expect(new Uint8Array(await readFile(second.path))).toEqual(JPEG);
    } finally {
      await inputs.cleanup();
    }
  });

  it('never uses the user-supplied name as a path component', async () => {
    const { ready } = partitionAttachmentOutcomes([
      parseImageAttachment('../../etc/passwd.png', PNG),
    ]);

    const inputs = await writeCodexImageInputs(ready);
    try {
      const [item] = inputs.items;
      if (item.type !== 'localImage') throw new Error('expected localImage item');
      expect(item.path).not.toContain('passwd');
      expect(item.path).not.toContain('..');
    } finally {
      await inputs.cleanup();
    }
  });

  it('cleanup removes the files it wrote', async () => {
    const { ready } = partitionAttachmentOutcomes([parseImageAttachment('shot.png', PNG)]);
    const inputs = await writeCodexImageInputs(ready);
    const [item] = inputs.items;
    if (item.type !== 'localImage') throw new Error('expected localImage item');

    await inputs.cleanup();

    await expect(stat(item.path)).rejects.toThrow();
  });

  it('handles a turn with no attachments as the same code path', async () => {
    const inputs = await writeCodexImageInputs([]);
    expect(inputs.items).toEqual([]);
    await inputs.cleanup();
  });
});
