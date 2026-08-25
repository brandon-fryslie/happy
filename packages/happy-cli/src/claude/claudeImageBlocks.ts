/**
 * The Anthropic SDK adapter for image attachments: proven attachments in,
 * content blocks the Agent SDK accepts out.
 *
 * Kept apart from attachments/imageAttachment.ts because importing the SDK's
 * types pulls its .d.mts into pkgroll's declaration bundle, which only the
 * launcher — never the package's public entry — can afford to reach.
 */

import type { ImageBlockParam } from '@anthropic-ai/sdk/resources';
import type { ImageAttachment, ImageMediaType } from '@/attachments/imageAttachment';

/**
 * An image block this module can actually emit. ImageBlockParam's `source` also
 * admits a URL variant we never produce, and a return type that admits it would
 * force every reader — including our own tests — to re-narrow a case that cannot
 * occur. [LAW:types-are-the-program] the strongest theorem that is still true.
 */
export type ClaudeImageBlock = ImageBlockParam & {
  source: { type: 'base64'; media_type: ImageMediaType; data: string };
};

/**
 * Residue: with mediaType already proven at the checkpoint, mapping to the SDK's
 * block shape is a total function — no format check, no skip, no branch.
 * [LAW:dataflow-not-control-flow]
 */
export function toClaudeImageBlocks(attachments: ImageAttachment[]): ClaudeImageBlock[] {
  return attachments.map((attachment) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: attachment.mediaType,
      data: Buffer.from(attachment.data).toString('base64'),
    },
  }));
}
