import { stringifyToolCommand } from '@/utils/toolCommand';

// Turning a pending permission request into a sentence worth hearing.
//
// The screen can afford a full path, a diff, and a JSON blob. Speech cannot: the listener has no
// scrollback, cannot skim, and is being asked to answer immediately. So this deliberately says less
// than the UI does — the tool, the one argument that identifies what is about to happen, and the
// question.
//
// Plain English rather than t(...): the output is spoken audio, not UI chrome, and it follows the
// same precedent as the summarizer's prompt in @/sync/llm/apiSummarize.

/** How long a spoken argument may get before it stops being listenable. */
const MAX_SPOKEN_ARG = 120;

interface ToolSpeech {
    /** Verb completing "wants to ...". */
    readonly verb: string;
    /** Argument keys to try, in order; the first one present is spoken. */
    readonly argKeys: readonly string[];
}

// [LAW:one-type-per-behavior] Every tool is described the same way — verb plus identifying argument.
// They differ only in which verb and which key, so they are rows rather than cases.
const TOOL_SPEECH: Record<string, ToolSpeech> = {
    Bash: { verb: 'run', argKeys: ['command'] },
    Read: { verb: 'read', argKeys: ['file_path', 'path'] },
    Write: { verb: 'write', argKeys: ['file_path', 'path'] },
    Edit: { verb: 'edit', argKeys: ['file_path', 'path'] },
    MultiEdit: { verb: 'edit', argKeys: ['file_path', 'path'] },
    NotebookEdit: { verb: 'edit', argKeys: ['notebook_path', 'file_path'] },
    Glob: { verb: 'search for', argKeys: ['pattern'] },
    Grep: { verb: 'search for', argKeys: ['pattern'] },
    WebFetch: { verb: 'fetch', argKeys: ['url'] },
    WebSearch: { verb: 'search the web for', argKeys: ['query'] },
    Task: { verb: 'start a task', argKeys: ['description'] },
};

const FALLBACK: ToolSpeech = { verb: 'use', argKeys: [] };

/**
 * Shorten a filesystem path to the part a listener can actually place.
 *
 * "/Users/bmf/code/happy/packages/happy-app/sources/voice/x.ts" read aloud in full is noise; the
 * last two segments are what identify the file to someone who knows the project.
 */
function speakablePath(value: string): string {
    const segments = value.split('/').filter((s) => s.length > 0);
    return segments.length <= 2 ? value : segments.slice(-2).join('/');
}

/**
 * Pull the identifying argument out of an untrusted payload.
 *
 * `arguments` is typed `z.any()` upstream, so this is a parse boundary: anything at all can arrive,
 * including null, a string, or an object missing every key we hoped for. Returning null for "nothing
 * speakable here" is the typed absence the caller handles — never a plausible-looking empty string.
 */
function extractSpokenArg(args: unknown, argKeys: readonly string[]): string | null {
    if (!args || typeof args !== 'object') {
        return null;
    }
    const record = args as Record<string, unknown>;

    for (const key of argKeys) {
        const raw = record[key];

        // Bash sends either a string or an argv array, and stringifyToolCommand already knows how to
        // unwrap `bash -c "..."` into the command a human would recognize.
        const value = key === 'command' ? stringifyToolCommand(raw) : (typeof raw === 'string' ? raw : null);
        if (!value) {
            continue;
        }

        const spoken = key.includes('path') ? speakablePath(value) : value;
        return spoken.length > MAX_SPOKEN_ARG
            ? `${spoken.slice(0, MAX_SPOKEN_ARG).trimEnd()}, and more`
            : spoken;
    }
    return null;
}

/**
 * The sentence to speak for one pending request, without the trailing question.
 *
 * Split from the question so a caller re-prompting after an unclear answer can repeat the question
 * alone rather than the whole description again.
 */
export function describePermissionRequest(tool: string, args: unknown): string {
    const speech = TOOL_SPEECH[tool] ?? FALLBACK;
    const arg = extractSpokenArg(args, speech.argKeys);

    // Naming the tool when there is no speakable argument keeps the sentence honest: "wants to use
    // WebSearch" tells the listener what they are approving, where a bare "wants to search the web"
    // would imply we knew the query when we did not.
    if (!arg) {
        return `The agent wants to use ${tool}.`;
    }
    return `The agent wants to ${speech.verb} ${arg}.`;
}

/** The question that invites a spoken answer. Kept separate so it can be repeated on its own. */
export const PERMISSION_QUESTION = 'Say yes to allow, or no to deny.';

/** The full prompt: what is about to happen, then the question. */
export function permissionPrompt(tool: string, args: unknown): string {
    return `${describePermissionRequest(tool, args)} ${PERMISSION_QUESTION}`;
}
