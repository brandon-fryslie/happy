import type { VoiceSession } from './types';
import { fetchByoVoiceToken, fetchVoiceCredentials } from '@/sync/apiVoice';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { TokenStorage } from '@/auth/tokenStorage';
import { t } from '@/text';
import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/microphonePermissions';
import { acquireAudioSession, releaseAudioSession } from '@/audio/audioSession';
import { storage } from '@/sync/storage';
import {
    getVoiceMessageCount,
    getVoiceOnboardingPromptLoadCount,
    getVoiceSoftPaywallShownCount,
    incrementVoiceOnboardingPromptLoadCount,
    incrementVoiceSoftPaywallShown,
} from '@/sync/persistence';
import { buildVoiceFirstMessage, buildVoiceSystemPrompt } from './voiceSystemPrompt';
import { getVoiceUpsellVariant } from './voiceExperiment';

let voiceSession: VoiceSession | null = null;
let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;
let currentVoiceConversationId: string | null = null;
let currentVoiceSessionStartedAt: number | null = null;

/**
 * Start a voice session. Returns the ElevenLabs conversation ID if started, null otherwise.
 */
export async function startRealtimeSession(sessionId: string, initialContext?: string): Promise<string | null> {
    currentVoiceConversationId = null;
    currentVoiceSessionStartedAt = null;

    if (!voiceSession) {
        console.warn('No voice session registered');
        return null;
    }

    // Show connecting state immediately so the user sees feedback
    storage.getState().setRealtimeStatus('connecting');

    // Request microphone permission before starting voice session
    // Critical for iOS/Android - first session will fail without this
    const permissionResult = await requestMicrophonePermission();
    if (!permissionResult.granted) {
        storage.getState().setRealtimeStatus('disconnected');
        showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
        return null;
    }

    // Opens the session for duplex audio. Previously this happened inside
    // requestMicrophonePermission; it is stated here because it is this function's need.
    await acquireAudioSession('voice-conversation');

    try {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            storage.getState().setRealtimeStatus('disconnected');
            Modal.alert(t('common.error'), t('errors.authenticationFailed'));
            return null;
        }

        // BYO bypass — user-supplied agent + API key. Server mints with the user's key,
        // returning the same {conversationToken, conversationId, agentId} shape as the gated path.
        const { voiceBypassToken, voiceCustomAgentId, voiceCustomElevenLabsApiKey } = storage.getState().settings;
        if (voiceBypassToken && (!voiceCustomAgentId || !voiceCustomElevenLabsApiKey)) {
            storage.getState().setRealtimeStatus('disconnected');
            Modal.alert(
                t('common.error'),
                t('errors.voiceByoCredentialsMissing'),
            );
            return null;
        }
        if (voiceBypassToken && voiceCustomAgentId && voiceCustomElevenLabsApiKey) {
            console.log('[Voice] BYO mint via server, agent:', voiceCustomAgentId);
            const byo = await fetchByoVoiceToken(credentials, voiceCustomAgentId, voiceCustomElevenLabsApiKey);
            currentSessionId = sessionId;
            const startedConversationId = await voiceSession.startSession({
                sessionId,
                initialContext,
                conversationToken: byo.conversationToken,
                agentId: byo.agentId,
            });
            currentVoiceConversationId = byo.conversationId ?? startedConversationId;
            currentVoiceSessionStartedAt = Date.now();
            voiceSessionStarted = true;
            return currentVoiceConversationId;
        }

        const response = await fetchVoiceCredentials(credentials, sessionId);
        console.log('[Voice] fetchVoiceCredentials response:', response);

        if (!response.allowed) {
            storage.getState().setRealtimeStatus('disconnected');

            if (response.reason === 'voice_conversation_limit_reached') {
                Modal.alert(
                    t('errors.voiceLimitReachedTitle'),
                    t('errors.voiceConversationLimitReached'),
                );
                return null;
            }

            // Server hard-declined — must pay to continue
            console.log('[Voice] Not allowed (reason: %s), presenting must-pay paywall...', response.reason);
            const result = await sync.presentPaywall('voice_must_pay');
            console.log('[Voice] Must-pay paywall result:', result);
            if (result.purchased) {
                return startRealtimeSession(sessionId, initialContext);
            }
            return null;
        }

        const hasPro = storage.getState().purchases.entitlements['pro'] ?? false;
        const { voiceUpsellOverride, devModeEnabled } = storage.getState().localSettings;
        const voiceUpsellVariant = getVoiceUpsellVariant({
            override: voiceUpsellOverride,
            overrideEnabled: __DEV__ || devModeEnabled,
        });

        if (
            !hasPro &&
            voiceUpsellVariant === 'show-paywall-before-first-voice-chat' &&
            getVoiceSoftPaywallShownCount() < 1
        ) {
            console.log('[Voice] First voice attempt on free tier, showing soft paywall...');
            incrementVoiceSoftPaywallShown();
            const result = await sync.presentPaywall('voice_trial_eligible');
            console.log('[Voice] Soft paywall result:', result);
            // Dismissed or error — continue anyway, they can still use free tier.
        }

        currentSessionId = sessionId;
        const onboardingPromptLoadCount = getVoiceOnboardingPromptLoadCount();
        const voiceMessageCount = getVoiceMessageCount();
        const systemPrompt = buildVoiceSystemPrompt({
            initialContext,
            onboardingPromptLoadCount,
            voiceMessageCount,
            includePaidVoiceOnboarding: !hasPro && voiceUpsellVariant === 'voice-onboarding-and-upsell',
        });
        const firstMessage = buildVoiceFirstMessage({
            hasPro,
            onboardingPromptLoadCount,
            includePaidVoiceOnboarding: voiceUpsellVariant === 'voice-onboarding-and-upsell',
        });

        const startedConversationId = await voiceSession.startSession({
            sessionId,
            initialContext,
            systemPrompt,
            firstMessage,
            conversationToken: response.conversationToken,
            agentId: response.agentId,
            userId: response.elevenUserId,
        });
        if (!hasPro && voiceUpsellVariant === 'voice-onboarding-and-upsell') {
            incrementVoiceOnboardingPromptLoadCount();
        }
        currentVoiceConversationId = response.conversationId ?? startedConversationId;
        currentVoiceSessionStartedAt = Date.now();
        voiceSessionStarted = true;
        return currentVoiceConversationId;
    } catch (error) {
        console.error('Failed to start realtime session:', error);
        storage.getState().setRealtimeStatus('disconnected');
        currentSessionId = null;
        currentVoiceConversationId = null;
        currentVoiceSessionStartedAt = null;
        voiceSessionStarted = false;
        Modal.alert(t('common.error'), t('errors.voiceServiceUnavailable'));
        return null;
    } finally {
        // [LAW:no-ambient-temporal-coupling] One release point for the many `return null` exits
        // above. The claim is held exactly while a conversation is live, and `voiceSessionStarted`
        // is the state that says whether one is — so every path that failed to start one gives
        // the session back here instead of leaking it until the next app launch.
        if (!voiceSessionStarted) {
            await releaseAudioSession('voice-conversation');
        }
    }
}

export async function stopRealtimeSession() {
    // Released before the guard below, not inside it: releasing a claim that is not held is a
    // no-op on the set, so this runs on every teardown path rather than only the one where a
    // voiceSession object happens to exist.
    await releaseAudioSession('voice-conversation');

    if (!voiceSession) {
        return;
    }

    try {
        await voiceSession.endSession();
    } catch (error) {
        console.error('Failed to stop realtime session:', error);
    } finally {
        currentSessionId = null;
        currentVoiceConversationId = null;
        currentVoiceSessionStartedAt = null;
        voiceSessionStarted = false;
    }
}

export function registerVoiceSession(session: VoiceSession) {
    if (voiceSession) {
        console.warn('Voice session already registered, replacing with new one');
    }
    voiceSession = session;
}

export function isVoiceSessionStarted(): boolean {
    return voiceSessionStarted;
}

export function getVoiceSession(): VoiceSession | null {
    return voiceSession;
}

export function getCurrentRealtimeSessionId(): string | null {
    return currentSessionId;
}

export function getCurrentVoiceConversationId(): string | null {
    return currentVoiceConversationId;
}

export function getCurrentVoiceSessionDurationSeconds(): number | undefined {
    if (currentVoiceSessionStartedAt === null) {
        return undefined;
    }
    return Math.max(0, Math.round((Date.now() - currentVoiceSessionStartedAt) / 1000));
}

export function setCurrentRealtimeSessionId(sessionId: string) {
    currentSessionId = sessionId;
}
