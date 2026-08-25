/**
 * The border checkpoint for image attachments arriving from the app.
 *
 * Bytes come off the wire untrusted twice over: the download may fail to
 * decrypt, and the app-supplied mimeType is unreliable (iOS pickers report
 * "image/heic", or nothing at all, while agent APIs enforce strict format
 * enums — Anthropic's image.source.base64.media_type being the strictest).
 * Everything inland — the message queues, the agent launchers — consumes
 * ImageAttachment, whose mediaType has been proven against the blob's own
 * magic header, so no code downstream of this module ever re-asks whether an
 * attachment is sendable.
 *
 * Rejections keep the filename and a typed reason rather than collapsing into
 * absence, so the caller can tell the user which image did not reach the agent.
 *
 * Deliberately free of any agent-SDK import: this module is shared by every
 * runner (Claude, Codex) and reachable from the package's public entry, and
 * SDK type declarations do not survive the declaration bundle. Shaping proven
 * attachments into each SDK's input shape is the separate job of the per-agent
 * adapters (claude/claudeImageBlocks.ts, codex/codexImageInputs.ts).
 * [LAW:decomposition]
 */

/**
 * The image formats Happy's attachment pipeline forwards to agents. The set is
 * anchored on the strictest consumer (Anthropic's base64 media_type enum);
 * Codex sniffs formats itself and reads at least this set.
 */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * An attachment proven sendable: the bytes carry the magic header of a
 * supported format, and mediaType is that proof. [LAW:parse-dont-validate]
 * this type cannot be constructed without passing parseImageAttachment.
 */
export type ImageAttachment = {
  name: string;
  data: Uint8Array;
  mediaType: ImageMediaType;
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
  | { kind: 'ready'; attachment: ImageAttachment }
  | { kind: 'rejected'; rejection: RejectedAttachment };

/** Magic headers, longest-prefix first. Data, so adding a format is not a code edit. */
const MAGIC_HEADERS: ReadonlyArray<{ mediaType: ImageMediaType; matches: (b: Uint8Array) => boolean }> = [
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
export function parseImageAttachment(name: string, data: Uint8Array): AttachmentOutcome {
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
 * Split a drained batch into what the agent will see and what it will not.
 * Both halves are returned: [LAW:no-silent-failure] the rejected half is the
 * only record that an image the user attached is about to go missing.
 */
export function partitionAttachmentOutcomes(outcomes: AttachmentOutcome[]): {
  ready: ImageAttachment[];
  rejected: RejectedAttachment[];
} {
  const ready: ImageAttachment[] = [];
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
  'unsupported-format': 'is not a supported image format (supported: PNG, JPEG, GIF, WebP)',
};

/**
 * The notice shown in the session when an attachment does not reach the agent.
 * Named per file, because "one of your images failed" sends the user hunting.
 * agentName is the user-facing name of the runner ("Claude", "Codex").
 */
export function describeRejectedAttachments(rejected: RejectedAttachment[], agentName: string): string {
  const lines = rejected.map((r) => `• ${r.name} ${REJECTION_TEXT[r.reason]}`);
  return `${rejected.length} attachment${rejected.length === 1 ? '' : 's'} did not reach ${agentName}:\n${lines.join('\n')}`;
}
