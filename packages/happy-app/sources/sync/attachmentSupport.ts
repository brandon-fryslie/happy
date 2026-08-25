import { isVersionSupported } from '@/utils/versionUtils';
import type { Metadata } from './storageTypes';

/**
 * First happy CLI version whose session runner recognises `file` events
 * (added by ca763b43, which landed after 1.1.8 was cut and shipped in the
 * 1.1.9 line). A host below this parses the event against no known schema and
 * drops the image without a word — so the app has to refuse up front rather
 * than trust the host to complain.
 */
export const MINIMUM_CLI_VERSION_FOR_ATTACHMENTS = '1.1.9';

/**
 * Whether a session can carry image attachments, and when it cannot, why.
 * Resolved once from session metadata so the composer's attach button and
 * sendMessage's refusal can never disagree about the same session.
 */
export type AttachmentSupport = 'supported' | 'unsupportedAgent' | 'outdatedCli';

export type BlockedAttachmentSupport = Exclude<AttachmentSupport, 'supported'>;

/**
 * [LAW:parse-dont-validate] The returned enum is the proof: callers branch on a
 * value that could not exist before this ran, instead of each re-deriving
 * "is this session image-capable" from raw metadata.
 */
export function resolveAttachmentSupport(metadata: Metadata | null | undefined): AttachmentSupport {
    // Claude merges downloaded blobs into content blocks; Codex writes them to
    // temp files and sends localImage input items. Both landed in the same
    // 1.1.9 line, so one version floor covers them. Gemini, ACP and OpenClaw
    // read message.content.text and ignore file events, and no CLI update
    // changes that — so flavor is the first thing we answer on.
    const flavor = metadata?.flavor;
    if (flavor && flavor !== 'claude' && flavor !== 'codex') {
        return 'unsupportedAgent';
    }

    // A session with no reported version predates createSessionMetadata writing
    // one, which puts it well below the floor; isVersionSupported already reads
    // absence as unsupported, so there is no separate case to handle here.
    if (!isVersionSupported(metadata?.version, MINIMUM_CLI_VERSION_FOR_ATTACHMENTS)) {
        return 'outdatedCli';
    }

    return 'supported';
}
