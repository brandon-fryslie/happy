import * as React from 'react';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import { useSession, useSetting } from '@/sync/storage';
import { storage } from '@/sync/storage';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { askPermissionAloud, type RecordAnswer } from '@/voice/handsFreePermission';
import { resolveConfig } from './useTtsPlayer';
import type { AbortToken } from '@/voice/playMp3';
import { log } from '@/log';

// Watcher hook. Mounts alongside useTtsAutoMode in SessionView and, in hands-free mode only, reads
// each new permission request aloud and acts on the spoken answer.
//
// Why this exists: before it, the hands-free loop died at every permission prompt. The agent would
// stop and wait for a tap that a user with a pocketed phone was never going to give, which made
// hands-free useful only until the first tool call — usually seconds.
//
// [LAW:single-enforcer] The decision is applied through the same sessionAllow/sessionDeny ops the
// tap-to-approve UI and the ConvAI tool both use. Voice is a new way to reach the decision, never a
// second implementation of what a decision does.

/** Pause after speech ends before recording, so the tail of our own audio isn't captured as an answer. */
const SETTLE_MS = 300;

export function useHandsFreePermissions(sessionId: string): void {
    const enabled = useSetting('ttsEnabled');
    const autoSpeak = useSetting('ttsAutoSpeak');
    const handsFree = enabled && autoSpeak === 'hands-free';

    const session = useSession(sessionId);
    const requests = session?.agentState?.requests;

    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    // Requests already spoken for, so a re-render or a state echo cannot start a second prompt for
    // the same request. Never cleared: a request id is unique and answering one twice is worse than
    // holding a few dozen strings.
    const handledRef = React.useRef<Set<string>>(new Set());
    const busyRef = React.useRef(false);
    const abortRef = React.useRef<AbortToken | null>(null);

    // [LAW:no-ambient-temporal-coupling] Recording is a capability handed to the loop, not something
    // it reaches for. The hook owns the recorder's lifecycle because expo-audio requires a component
    // to; the loop only needs "give me some audio".
    const recordAnswer = React.useCallback<RecordAnswer>(async (seconds) => {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
            log.log('[perm-voice] microphone permission denied; cannot hear an answer');
            return null;
        }

        await recorder.prepareToRecordAsync();
        recorder.record();
        await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
        await recorder.stop();

        const uri = recorder.uri;
        if (!uri) {
            log.log('[perm-voice] recorder produced no file');
            return null;
        }
        // HIGH_QUALITY writes .m4a on iOS and Android alike; the container has to match what we
        // tell the transcriber, or it rejects the upload.
        return { uri, fileName: 'answer.m4a', mimeType: 'audio/m4a' };
    }, [recorder]);

    React.useEffect(() => {
        if (!handsFree || !requests) {
            return;
        }

        const pending = Object.entries(requests)
            .filter(([id]) => !handledRef.current.has(id));
        if (pending.length === 0 || busyRef.current) {
            return;
        }

        const [requestId, request] = pending[0];
        handledRef.current.add(requestId);
        busyRef.current = true;

        const token: AbortToken = { aborted: false, wakeup: () => { /* installed by playMp3 */ } };
        abortRef.current = token;

        (async () => {
            try {
                const config = resolveConfig(storage.getState().settings);
                await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));

                const decision = await askPermissionAloud(request.tool, request.arguments, {
                    config,
                    recordAnswer,
                    token,
                });

                if (token.aborted) {
                    return;
                }

                // [LAW:no-silent-failure] 'unclear' leaves the request pending on purpose. Denying
                // an answer we could not hear would look like a decision the user made, and it
                // would throw away the agent's work. An unanswered prompt is still on screen and
                // still tappable; a wrongly-denied one is gone.
                if (decision === 'unclear') {
                    log.log(`[perm-voice] no clear answer for ${requestId}; leaving it for the user to tap`);
                    return;
                }

                log.log(`[perm-voice] ${decision} ${requestId} by voice`);
                await (decision === 'allow'
                    ? sessionAllow(sessionId, requestId)
                    : sessionDeny(sessionId, requestId));
            } catch (e) {
                // Auto-fire must not pop a modal over a user who cannot see the screen, but the
                // failure still has to land somewhere reachable.
                log.log(`[perm-voice] failed for ${requestId}: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
                busyRef.current = false;
                if (abortRef.current === token) {
                    abortRef.current = null;
                }
            }
        })();
    }, [handsFree, requests, sessionId, recordAnswer]);

    React.useEffect(() => {
        // Stop talking and listening when the view goes away or the session changes.
        return () => {
            const token = abortRef.current;
            if (token) {
                token.aborted = true;
                token.wakeup();
            }
        };
    }, [sessionId]);
}
