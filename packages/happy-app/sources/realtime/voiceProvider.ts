import { config } from '@/config';
import type { Settings } from '@/sync/settings';

/**
 * Who mints a voice conversation, and therefore which LiveKit deployment the client
 * may dial.
 *
 * The conversation token is a JWT signed by one provider's LiveKit keys. Dialing a
 * different SFU with it does not fail loudly — the client lands in a room the agent is
 * not in and simply hears nothing — so the two questions are answered here, together,
 * from one value, and never separately at the two SDK call sites.
 */

/** The SFU every ElevenLabs-minted token admits to, and both SDKs' built-in default. */
export const ELEVENLABS_LIVEKIT_URL = 'wss://livekit.rtc.elevenlabs.io';

/**
 * The SFU behind whatever ConvAI provider Happy's server mints against.
 *
 * The one config value that points the app at a self-hosted service; unset means
 * Happy's server is still talking to ElevenLabs. It pairs with the server's
 * `VOICE_CONVAI_ORIGIN`, and the two have to name the same deployment — a token from
 * one provider presented to another's SFU is the silent failure described above.
 */
export const HAPPY_LIVEKIT_URL = config.voiceLivekitUrl || ELEVENLABS_LIVEKIT_URL;

/**
 * Which of the two mints a call goes through, with the credentials a BYO mint needs
 * already proven present.
 */
export type VoiceMint =
    | { kind: 'happy' }
    | { kind: 'byo'; agentId: string; apiKey: string }
    | { kind: 'byo-incomplete' };

/**
 * Reads the three BYO settings as the one fact they encode between them.
 *
 * Callers get a mint they can act on rather than three nullable fields they each have
 * to re-check: `byo` carries non-null credentials, so no call site downstream asks
 * again whether they were set.
 */
export function voiceMint(settings: Settings): VoiceMint {
    if (!settings.voiceBypassToken) {
        return { kind: 'happy' };
    }
    const { voiceCustomAgentId: agentId, voiceCustomElevenLabsApiKey: apiKey } = settings;
    return agentId && apiKey ? { kind: 'byo', agentId, apiKey } : { kind: 'byo-incomplete' };
}

/** The SFU a token from this mint admits to. Total: every mint has exactly one. */
export function livekitUrlFor(mint: VoiceMint): string {
    // Both BYO arms are ElevenLabs' — an incomplete one mints nothing, but if it ever
    // did it would be with the user's ElevenLabs key.
    return mint.kind === 'happy' ? HAPPY_LIVEKIT_URL : ELEVENLABS_LIVEKIT_URL;
}

/**
 * Refuses a session whose token was minted for one provider while the SDK is configured
 * to dial another's SFU.
 *
 * [LAW:no-silent-failure] Only the native bridge needs this, and only because the React
 * Native SDK fixes its `serverUrl` when the hook renders: the mint is chosen, a token is
 * fetched, and by the time the answer arrives the render that configured the SDK is
 * already in the past. They disagree exactly when the voice settings changed during that
 * fetch, which makes the whole call stale — the token carries the other provider's agent
 * and credentials, not merely the wrong SFU. Dialing anyway is the failure this feature
 * exists to prevent, and it is inaudible: the caller joins a room nobody is in.
 *
 * A free function rather than a line inside the bridge so the comparison can be tested
 * without standing up the SDK.
 */
export function requireMintAndDialAgree(dialed: string | null, minted: string): void {
    if (dialed !== minted) {
        throw new Error(
            `Voice settings changed while this session was starting: the token was minted for ${minted}, `
            + `but the SDK is configured for ${dialed}. Start the session again.`
        );
    }
}
