import * as React from 'react';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { storage } from '@/sync/storage';
import { setTtsPosition, getTtsPosition, clearTtsPosition } from '@/sync/persistence';
import { summarizeMessages } from '@/sync/llm/apiSummarize';
import { synthesizeSpeech } from '@/sync/llm/apiTts';
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

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — sensible ElevenLabs default.

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
                    apiKey: config.elevenLabsKey,
                    voiceId: config.voiceId,
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
    elevenLabsKey: string;
    voiceId: string;
}

function resolveConfig(settings: ReturnType<typeof storage.getState>['settings']): ResolvedConfig {
    const llmBaseUrl = settings.ttsLlmBaseUrl?.trim();
    const llmModel = settings.ttsLlmModel?.trim();
    // [LAW:one-source-of-truth] One canonical "user's ElevenLabs key": the BYO voice key, with the
    // TTS-specific override taking precedence when set.
    const elevenLabsKey = (settings.ttsElevenLabsApiKey ?? settings.voiceCustomElevenLabsApiKey)?.trim();
    const voiceId = settings.ttsVoiceId?.trim() || DEFAULT_VOICE_ID;

    if (!llmBaseUrl) {
        throw new HappyError('Configure the LLM Base URL in TTS Settings to enable summarize-and-speak.', false);
    }
    if (!llmModel) {
        throw new HappyError('Configure the LLM Model in TTS Settings to enable summarize-and-speak.', false);
    }
    if (!elevenLabsKey) {
        throw new HappyError('Add an ElevenLabs API key in TTS Settings to enable summarize-and-speak.', false);
    }

    return {
        llmBaseUrl,
        llmApiKey: settings.ttsLlmApiKey?.trim() ?? '',
        llmModel,
        elevenLabsKey,
        voiceId,
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
