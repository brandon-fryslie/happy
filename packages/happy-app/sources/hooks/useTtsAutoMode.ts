import * as React from 'react';
import { AppState } from 'react-native';
import { useSession, useSessionMessages, useSetting } from '@/sync/storage';
import type { TtsPlayer } from './useTtsPlayer';
import { acquireAudioSession, releaseAudioSession } from '@/audio/audioSession';

// [LAW:dataflow-not-control-flow] The decision to fire is a pure function of (settings, last
// agent-text id, thinking state, app foreground, cooldown elapsed). The effect's body always runs
// on every relevant change; the dataflow either triggers play or does nothing — no nested
// conditional skips that vary the effect's identity.
//
// Watcher hook. Mounts in SessionView and triggers play('continue') when a new agent-text message
// finishes streaming. Owns its debounce + cooldown — does not race with manual plays because the
// caller's TtsPlayer instance has a single AsyncLock.

const DEBOUNCE_MS = 1500;

// [LAW:dataflow-not-control-flow] The two speaking modes differ in values, not in which checks
// run. Both go through the same gate below; the mode only changes what the gate is comparing to.
//
// The foreground numbers are the original tuning, and they are courtesy constraints: don't talk
// over a user who is looking at the screen and can already read the reply. Hands-free inverts the
// premise — the user cannot see the screen, so a skipped message is a message lost, and a cooldown
// that swallows the second of two quick replies is the failure rather than the politeness.
const AUTO_SPEAK_POLICY = {
    foreground: { requiresForeground: true, cooldownMs: 30_000 },
    'hands-free': { requiresForeground: false, cooldownMs: 0 },
} as const;

export function useTtsAutoMode(sessionId: string, player: TtsPlayer): void {
    const enabled = useSetting('ttsEnabled');
    const autoSpeak = useSetting('ttsAutoSpeak');
    const handsFree = autoSpeak === 'hands-free';
    const { messages } = useSessionMessages(sessionId);
    const session = useSession(sessionId);
    const thinking = session?.thinking ?? false;

    const lastFiredAtRef = React.useRef(0);
    const lastTriggeredAgentIdRef = React.useRef<string | null>(null);
    const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Hands-free needs an audio session that survives backgrounding; without it expo-audio's
    // default foreground-only session drops playback the moment the screen locks. Held for as
    // long as the mode is on, released when it goes off or the view unmounts.
    React.useEffect(() => {
        if (!enabled || !handsFree) {
            return;
        }
        acquireAudioSession('hands-free-speech');
        return () => {
            releaseAudioSession('hands-free-speech');
        };
    }, [enabled, handsFree]);

    React.useEffect(() => {
        if (!enabled || autoSpeak === 'off') {
            // Make sure no pending debounce fires after the user disables auto-mode.
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            return;
        }

        // Find the most recent agent-text id (skip tool calls, events, user-text).
        let latestAgentId: string | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].kind === 'agent-text') {
                latestAgentId = messages[i].id;
                break;
            }
        }

        // Nothing to do until there's an agent-text message we haven't already triggered for, and
        // the agent has stopped streaming.
        if (!latestAgentId || latestAgentId === lastTriggeredAgentIdRef.current || thinking) {
            return;
        }

        // Clear any prior debounce — message list may still be mutating.
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;

            const now = Date.now();
            const policy = AUTO_SPEAK_POLICY[autoSpeak];
            const foregroundSatisfied = !policy.requiresForeground || AppState.currentState === 'active';
            const cooldownElapsed = (now - lastFiredAtRef.current) >= policy.cooldownMs;
            const alreadyBusy = player.isPlaying || player.isLoading;

            if (!foregroundSatisfied || !cooldownElapsed || alreadyBusy) {
                return;
            }

            lastFiredAtRef.current = now;
            lastTriggeredAgentIdRef.current = latestAgentId;
            // Errors here surface via Modal in the player's HappyError path if the consumer wraps
            // play with useHappyAction. Bare promise rejection from auto-mode is silently dropped
            // — auto fires shouldn't pop modals on background activity.
            player.play('continue').catch(() => { /* swallow */ });
        }, DEBOUNCE_MS);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [enabled, autoSpeak, messages, thinking, player, sessionId]);
}
