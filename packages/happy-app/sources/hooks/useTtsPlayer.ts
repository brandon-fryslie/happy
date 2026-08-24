import * as React from 'react';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { storage } from '@/sync/storage';
import { setTtsPosition, getTtsPosition, clearTtsPosition } from '@/sync/persistence';
import { summarizeMessages } from '@/sync/llm/apiSummarize';
import { synthesizeSpeech } from '@/sync/llm/apiTts';
import { resolveTtsVoiceAndModel, ttsProviderLabel, type TtsProvider } from '@/sync/llm/ttsProviders';
import { HappyError } from '@/utils/errors';
import { AsyncLock } from '@/utils/lock';
import type { Message } from '@/sync/typesMessage';

// [LAW:dataflow-not-control-flow] The play pipeline is one straight-line dataflow: read → slice →
// summarize → synthesize → write file → play → advance. Branching is confined to (a) "no work to
// do" (empty slice → HappyError) and (b) per-step abort handled by a single token, not scattered
// guards.
//
// [LAW:one-source-of-truth] Settings + messages are read fresh from storage.getState() at play-time
// rather than captured in closures, so a play triggered after auto-mode finishes always sees the
// current configuration and the up-to-date message list.

export type TtsPlayMode = 'continue' | 'from-last-user' | 'restart';

export interface TtsPlayer {
    isPlaying: boolean;
    isLoading: boolean;
    lastSpokenMessageId: string | null;
    /** Awaitable; intended to be wrapped with useHappyAction so HappyError surfaces as a modal. */
    play: (mode: TtsPlayMode) => Promise<void>;
    stop: () => void;
}

interface AbortToken {
    aborted: boolean;
    wakeup: () => void;
}

export function useTtsPlayer(sessionId: string): TtsPlayer {
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const [lastSpokenMessageId, setLastSpokenMessageId] = React.useState<string | null>(
        () => getTtsPosition(sessionId),
    );

    const lockRef = React.useRef(new AsyncLock());
    const playerRef = React.useRef<AudioPlayer | null>(null);
    const abortRef = React.useRef<AbortToken | null>(null);
    const tempFileRef = React.useRef<File | null>(null);

    React.useEffect(() => {
        // Re-read MMKV when sessionId changes (component reused for different session).
        setLastSpokenMessageId(getTtsPosition(sessionId));
    }, [sessionId]);

    const cleanup = React.useCallback(() => {
        if (playerRef.current) {
            try { playerRef.current.remove(); } catch { /* already removed */ }
            playerRef.current = null;
        }
        if (tempFileRef.current) {
            try { tempFileRef.current.delete(); } catch { /* may not exist */ }
            tempFileRef.current = null;
        }
    }, []);

    const stop = React.useCallback(() => {
        if (abortRef.current) {
            abortRef.current.aborted = true;
            abortRef.current.wakeup();
        }
        cleanup();
        setIsPlaying(false);
        setIsLoading(false);
    }, [cleanup]);

    React.useEffect(() => {
        // Stop on unmount or session change.
        return () => {
            stop();
        };
    }, [sessionId, stop]);

    const play = React.useCallback(async (mode: TtsPlayMode): Promise<void> => {
        await lockRef.current.inLock(async () => {
            const token: AbortToken = { aborted: false, wakeup: () => { /* installed below */ } };
            abortRef.current = token;
            setIsLoading(true);

            try {
                const state = storage.getState();
                const settings = state.settings;
                const sessionData = state.sessionMessages[sessionId];
                const allMessages: Message[] = sessionData?.messages ?? [];

                const config = resolveConfig(settings);
                const slice = sliceMessages(allMessages, mode, sessionId);

                if (slice.length === 0) {
                    throw new HappyError('No new messages to read.', false);
                }

                const summary = await summarizeMessages({
                    baseUrl: config.llmBaseUrl,
                    apiKey: config.llmApiKey,
                    model: config.llmModel,
                    messages: slice.map(m => ({
                        role: m.kind === 'user-text' ? 'user' : 'agent',
                        text: m.text,
                    })),
                });
                if (token.aborted) return;

                const audio = await synthesizeSpeech({
                    provider: config.provider,
                    apiKey: config.speechKey,
                    voiceId: config.voiceId,
                    modelId: config.speechModel,
                    text: summary,
                });
                if (token.aborted) return;

                const file = new File(Paths.cache, `tts-${sessionId}-${Date.now()}.mp3`);
                file.create({ overwrite: true });
                file.write(new Uint8Array(audio));
                tempFileRef.current = file;
                if (token.aborted) {
                    cleanup();
                    return;
                }

                const player = createAudioPlayer({ uri: file.uri });
                playerRef.current = player;
                setIsLoading(false);
                setIsPlaying(true);

                await new Promise<void>((resolve) => {
                    let settled = false;
                    const settle = () => {
                        if (settled) return;
                        settled = true;
                        resolve();
                    };
                    token.wakeup = settle;
                    const sub = player.addListener('playbackStatusUpdate', (status) => {
                        if (status.didJustFinish) {
                            sub.remove();
                            settle();
                        }
                    });
                    if (token.aborted) {
                        sub.remove();
                        settle();
                    }
                    player.play();
                });

                const lastId = slice[slice.length - 1].id;
                if (!token.aborted) {
                    setTtsPosition(sessionId, lastId);
                    setLastSpokenMessageId(lastId);
                }
            } finally {
                cleanup();
                setIsPlaying(false);
                setIsLoading(false);
                if (abortRef.current === token) {
                    abortRef.current = null;
                }
            }
        });
    }, [sessionId, cleanup]);

    return { isPlaying, isLoading, lastSpokenMessageId, play, stop };
}

interface ResolvedConfig {
    llmBaseUrl: string;
    llmApiKey: string;
    llmModel: string;
    provider: TtsProvider;
    speechKey: string;
    voiceId: string;
    speechModel: string;
}

// Where each vendor's speech credential comes from, including what it falls back to.
//
// [LAW:one-source-of-truth] Each entry names one canonical "user's key for this vendor". ElevenLabs
// falls back to the BYO voice key and OpenAI to the summarization key, so a user who already gave us
// the same credential elsewhere is never asked to paste it twice.
const SPEECH_KEY_SOURCES: Record<TtsProvider, (s: ReturnType<typeof storage.getState>['settings']) => string | undefined> = {
    elevenlabs: (s) => (s.ttsElevenLabsApiKey ?? s.voiceCustomElevenLabsApiKey)?.trim(),
    openai: (s) => (s.ttsOpenAiApiKey ?? s.ttsLlmApiKey)?.trim(),
};

const SPEECH_VOICE_SOURCES: Record<TtsProvider, (s: ReturnType<typeof storage.getState>['settings']) => string | null> = {
    elevenlabs: (s) => s.ttsVoiceId,
    openai: (s) => s.ttsOpenAiVoice,
};

function resolveConfig(settings: ReturnType<typeof storage.getState>['settings']): ResolvedConfig {
    const llmBaseUrl = settings.ttsLlmBaseUrl?.trim();
    const llmModel = settings.ttsLlmModel?.trim();
    const provider = settings.ttsProvider;
    const speechKey = SPEECH_KEY_SOURCES[provider](settings);
    // Defaults are provider-scoped, so the returned voice always belongs to the chosen vendor.
    const { voiceId, modelId: speechModel } = resolveTtsVoiceAndModel(
        provider,
        SPEECH_VOICE_SOURCES[provider](settings),
        settings.ttsSpeechModel,
    );

    if (!llmBaseUrl) {
        throw new HappyError('Configure the LLM Base URL in TTS Settings to enable summarize-and-speak.', false);
    }
    if (!llmModel) {
        throw new HappyError('Configure the LLM Model in TTS Settings to enable summarize-and-speak.', false);
    }
    if (!speechKey) {
        throw new HappyError(
            `Add a ${ttsProviderLabel(provider)} API key in Speak Sessions settings to enable summarize-and-speak.`,
            false,
        );
    }

    return {
        llmBaseUrl,
        llmApiKey: settings.ttsLlmApiKey?.trim() ?? '',
        llmModel,
        provider,
        speechKey,
        voiceId,
        speechModel,
    };
}

type Speakable = (Message & { kind: 'user-text' | 'agent-text' });

function sliceMessages(all: Message[], mode: TtsPlayMode, sessionId: string): Speakable[] {
    const speakable: Speakable[] = all.filter(
        (m): m is Speakable => m.kind === 'user-text' || m.kind === 'agent-text',
    );

    if (mode === 'restart') {
        clearTtsPosition(sessionId);
        return speakable;
    }

    if (mode === 'from-last-user') {
        let idx = -1;
        for (let i = speakable.length - 1; i >= 0; i--) {
            if (speakable[i].kind === 'user-text') { idx = i; break; }
        }
        return idx === -1 ? speakable : speakable.slice(idx);
    }

    // 'continue': everything strictly after the last spoken message.
    const lastSpoken = getTtsPosition(sessionId);
    if (!lastSpoken) return speakable;
    const idx = speakable.findIndex(m => m.id === lastSpoken);
    if (idx === -1) return speakable; // position points at a message we no longer have — read all.
    return speakable.slice(idx + 1);
}
