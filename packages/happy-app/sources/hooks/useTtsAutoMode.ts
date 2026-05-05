import * as React from 'react';
import { AppState } from 'react-native';
import { useSession, useSessionMessages, useSetting } from '@/sync/storage';
import type { TtsPlayer } from './useTtsPlayer';

// [LAW:dataflow-not-control-flow] The decision to fire is a pure function of (settings, last
// agent-text id, thinking state, app foreground, cooldown elapsed). The effect's body always runs
// on every relevant change; the dataflow either triggers play or does nothing — no nested
// conditional skips that vary the effect's identity.
//
// Watcher hook. Mounts in SessionView and triggers play('continue') when a new agent-text message
// finishes streaming. Owns its debounce + cooldown — does not race with manual plays because the
// caller's TtsPlayer instance has a single AsyncLock.

const DEBOUNCE_MS = 1500;
const COOLDOWN_MS = 30_000;

export function useTtsAutoMode(sessionId: string, player: TtsPlayer): void {
    const enabled = useSetting('ttsEnabled');
    const autoMode = useSetting('ttsAutoMode');
    const { messages } = useSessionMessages(sessionId);
    const session = useSession(sessionId);
    const thinking = session?.thinking ?? false;

    const lastFiredAtRef = React.useRef(0);
    const lastTriggeredAgentIdRef = React.useRef<string | null>(null);
    const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        if (!enabled || !autoMode) {
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
            const inForeground = AppState.currentState === 'active';
            const cooldownElapsed = (now - lastFiredAtRef.current) >= COOLDOWN_MS;
            const alreadyBusy = player.isPlaying || player.isLoading;

            if (!inForeground || !cooldownElapsed || alreadyBusy) {
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
    }, [enabled, autoMode, messages, thinking, player, sessionId]);
}
