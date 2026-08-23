/**
 * The border checkpoint for image attachments arriving from the app.
 *
 * Bytes come off the wire untrusted twice over: the download may fail to
 * decrypt, and the app-supplied mimeType is unreliable (iOS pickers report
 * "image/heic", or nothing at all, while the Anthropic API enforces a strict
 * enum on image.source.base64.media_type). Everything inland — the message
 * queue, the SDK launcher — consumes ClaudeImageAttachment, whose mediaType
 * has been proven against the blob's own magic header, so no code downstream
 * of this module ever re-asks whether an attachment is sendable.
 *
 * Rejections keep the filename and a typed reason rather than collapsing into
 * absence, so the caller can tell the user which image did not reach Claude.
 *
 * Deliberately free of any Anthropic SDK import: this module is reachable from
 * the package's public entry, and the SDK's type declarations do not survive
 * the declaration bundle. Shaping attachments into SDK blocks is the separate
 * job of claudeImageBlocks.ts. [LAW:decomposition]
 */

/** The four formats the Anthropic API accepts for a base64 image block. */
export type ClaudeImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * An attachment proven sendable: the bytes carry the magic header of a format
 * Claude accepts, and mediaType is that proof. [LAW:parse-dont-validate] this
 * type cannot be constructed without passing parseClaudeImageAttachment.
 */
export type ClaudeImageAttachment = {
  name: string;
  data: Uint8Array;
  mediaType: ClaudeImageMediaType;
};

export type AttachmentRejectionReason = 'unreadable' | 'unsupported-format';

export type RejectedAttachment = {
  name: string;
  reason: AttachmentRejectionReason;
};

/**
 * The typed failure arm of the checkpoint. [LAW:parse-dont-validate] the
 * rejected case is a variant the caller must handle by structure, never a
 * success-shaped empty value that launders a failure into plausible output.
 */
export type AttachmentOutcome =
  | { kind: 'ready'; attachment: ClaudeImageAttachment }
  | { kind: 'rejected'; rejection: RejectedAttachment };

/** Magic headers, longest-prefix first. Data, so adding a format is not a code edit. */
const MAGIC_HEADERS: ReadonlyArray<{ mediaType: ClaudeImageMediaType; matches: (b: Uint8Array) => boolean }> = [
  { mediaType: 'image/png', matches: (b) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mediaType: 'image/jpeg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: 'image/gif', matches: (b) => b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    mediaType: 'image/webp',
    matches: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/**
 * The checkpoint itself: raw decrypted bytes in, a stamped attachment or a
 * typed rejection out. The app's claimed mimeType is deliberately not a
 * parameter — trusting it is what shipped HTTP 400s to the Anthropic API.
 */
export function parseClaudeImageAttachment(name: string, data: Uint8Array): AttachmentOutcome {
  const match = MAGIC_HEADERS.find((header) => header.matches(data));
  return match
    ? { kind: 'ready', attachment: { name, data, mediaType: match.mediaType } }
    : { kind: 'rejected', rejection: { name, reason: 'unsupported-format' } };
}

/** An attachment that never got as far as the checkpoint — download or decrypt failed. */
export function unreadableAttachment(name: string): AttachmentOutcome {
  return { kind: 'rejected', rejection: { name, reason: 'unreadable' } };
}

/**
 * Split a drained batch into what Claude will see and what it will not.
 * Both halves are returned: [LAW:no-silent-failure] the rejected half is the
 * only record that an image the user attached is about to go missing.
 */
export function partitionAttachmentOutcomes(outcomes: AttachmentOutcome[]): {
  ready: ClaudeImageAttachment[];
  rejected: RejectedAttachment[];
} {
  const ready: ClaudeImageAttachment[] = [];
  const rejected: RejectedAttachment[] = [];
  for (const outcome of outcomes) {
    // The one branch left is the domain's own discriminator — exhaustive, not defensive.
    if (outcome.kind === 'ready') {
      ready.push(outcome.attachment);
    } else {
      rejected.push(outcome.rejection);
    }
  }
  return { ready, rejected };
}

const REJECTION_TEXT: Record<AttachmentRejectionReason, string> = {
  unreadable: 'could not be downloaded or decrypted',
  'unsupported-format': 'is not a format Claude can read (supported: PNG, JPEG, GIF, WebP)',
};

/**
 * The notice shown in the session when an attachment does not reach Claude.
 * Named per file, because "one of your images failed" sends the user hunting.
 */
export function describeRejectedAttachments(rejected: RejectedAttachment[]): string {
  const lines = rejected.map((r) => `• ${r.name} ${REJECTION_TEXT[r.reason]}`);
  return `${rejected.length} attachment${rejected.length === 1 ? '' : 's'} did not reach Claude:\n${lines.join('\n')}`;
}
