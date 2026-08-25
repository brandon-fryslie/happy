import { synthesizeSpeech } from '@/sync/llm/apiTts';
import { transcribeSpeech, DEFAULT_TRANSCRIBE_MODEL } from '@/sync/llm/apiTranscribe';
import { acquireAudioSession, releaseAudioSession } from '@/audio/audioSession';
import { classifySpokenDecision, type SpokenDecision } from './spokenDecision';
import { permissionPrompt, PERMISSION_QUESTION } from './describePermissionRequest';
import { playMp3, type AbortToken } from './playMp3';
import type { File } from 'expo-file-system';
import type { AudioPlayer } from 'expo-audio';
import type { ResolvedConfig } from '@/hooks/useTtsPlayer';
import { log } from '@/log';

// The hands-free permission loop: say what the agent wants to do, listen for a spoken answer, and
// turn that answer into a decision.
//
// [LAW:effects-at-boundaries] The two decisions in this file — what to say (./describePermissionRequest)
// and what an answer means (./spokenDecision) — are both pure and tested separately. What is left
// here is the sequencing of effects, which is why this module has no branching logic worth testing
// and those two do.

/** How long to listen for an answer. Long enough for "go ahead", short enough not to feel stuck. */
const LISTEN_SECONDS = 4;

/** One re-ask on an unclear answer. Beyond that, asking again is nagging rather than helping. */
const MAX_ATTEMPTS = 2;

export interface RecordAnswer {
    /**
     * Record for `seconds` and return a local file URI plus its container.
     *
     * Injected rather than imported because recording lives behind expo-audio's `useAudioRecorder`
     * hook, which can only be called from a component. Passing the capability in also keeps this
     * module testable without a device.
     */
    (seconds: number): Promise<{ uri: string; fileName: string; mimeType: string } | null>;
}

export interface HandsFreePermissionDeps {
    config: ResolvedConfig;
    recordAnswer: RecordAnswer;
    token: AbortToken;
}

/** Speak one line and wait for it to finish. */
async function say(config: ResolvedConfig, text: string, token: AbortToken): Promise<void> {
    const audio = await synthesizeSpeech({
        provider: config.provider,
        apiKey: config.speechKey,
        voiceId: config.voiceId,
        modelId: config.speechModel,
        text,
    });
    if (token.aborted) return;

    // A holder rather than two `let`s: TypeScript does not track assignments made inside a callback,
    // so plain locals narrow to `never` by the time the finally block reads them.
    const held: { file: File | null; player: AudioPlayer | null } = { file: null, player: null };
    try {
        await playMp3(audio, `perm-${Date.now()}.mp3`, token, {
            setFile: (f) => { held.file = f; },
            setPlayer: (p) => { held.player = p; },
        });
    } finally {
        // Deleting only after playback has finished: the player streams from this file, so an
        // earlier delete truncates the sentence.
        try { held.player?.remove(); } catch { /* already gone */ }
        try { held.file?.delete(); } catch { /* never created */ }
    }
}

/** Record an answer and transcribe it. Returns the raw transcript, or null if nothing was captured. */
async function listen(deps: HandsFreePermissionDeps): Promise<string | null> {
    const { config, recordAnswer, token } = deps;

    // Recording needs the microphone AND background execution; holding the claim for exactly the
    // recording window means the session drops back to playback-only the moment we stop listening.
    await acquireAudioSession('hands-free-listen');
    try {
        const recording = await recordAnswer(LISTEN_SECONDS);
        if (!recording || token.aborted) {
            return null;
        }
        return await transcribeSpeech({
            baseUrl: config.llmBaseUrl,
            apiKey: config.llmApiKey,
            // Not a setting. [LAW:no-mode-explosion] — whisper-1 is what every OpenAI-compatible
            // server that serves audio at all implements, so a knob here would be a permanent option
            // with no second value anyone needs.
            model: DEFAULT_TRANSCRIBE_MODEL,
            fileUri: recording.uri,
            fileName: recording.fileName,
            mimeType: recording.mimeType,
        });
    } finally {
        await releaseAudioSession('hands-free-listen');
    }
}

/**
 * Ask about one pending request and return what the user said.
 *
 * Returns 'unclear' when every attempt failed to produce an answer we may act on. The caller must
 * leave the request pending in that case — never assume a decision. An unanswered prompt that stays
 * on screen is recoverable; a request denied because the phone was in a pocket is not.
 */
export async function askPermissionAloud(
    tool: string,
    args: unknown,
    deps: HandsFreePermissionDeps,
): Promise<SpokenDecision> {
    const { config, token } = deps;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (token.aborted) return 'unclear';

        // First time round explain what is being asked; on a re-ask just repeat the question, since
        // the listener already heard the description and repeating it in full is tiresome.
        const line = attempt === 1
            ? permissionPrompt(tool, args)
            : `Sorry, I didn't catch that. ${PERMISSION_QUESTION}`;

        await say(config, line, token);
        if (token.aborted) return 'unclear';

        const transcript = await listen(deps);
        const decision = classifySpokenDecision(transcript ?? '');
        log.log(`[perm-voice] attempt=${attempt} heard=${JSON.stringify(transcript)} decision=${decision}`);

        if (decision !== 'unclear') {
            return decision;
        }
    }

    return 'unclear';
}
