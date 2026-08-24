import type { AudioMode } from 'expo-audio';

// [LAW:effects-at-boundaries] The pure half of audio-session ownership: claims in, configuration
// out, no platform contact. Kept in its own module so it can be unit-tested with no mocks and no
// device — importing expo-audio for a value (rather than a type) pulls in React Native, which the
// test runner cannot parse.
//
// The AudioMode import is type-only and erased at build time, so this module stays free of runtime
// dependencies while the compiler still checks the derivation against expo-audio's real contract.
// [LAW:one-source-of-truth] — expo-audio defines the shape; nothing here redeclares it.

/**
 * A reason some part of the app needs the audio session configured a particular way.
 *
 * [LAW:types-are-the-program] Claims are the domain's own enum, not booleans. A caller cannot
 * express "I want background playback but not for any reason" — the need and its justification are
 * the same value, so releasing is exact rather than best-effort.
 */
export type AudioClaim =
    /** A LiveKit/ConvAI voice conversation is live: microphone open, duplex audio. */
    | 'voice-conversation'
    /** Hands-free TTS: the app speaks agent replies with the screen off or backgrounded. */
    | 'hands-free-speech';

type ClaimRequirements = {
    readonly allowsRecording: boolean;
    readonly shouldPlayInBackground: boolean;
};

// What each claim needs from the session. Adding a claim is adding a row here — [LAW:composability]'s
// data-fill test: a new reason to hold the session is new data, never new branching below.
const CLAIM_REQUIREMENTS: Record<AudioClaim, ClaimRequirements> = {
    'voice-conversation': { allowsRecording: true, shouldPlayInBackground: false },
    'hands-free-speech': { allowsRecording: false, shouldPlayInBackground: true },
};

/**
 * The session configuration implied by a set of claims.
 *
 * Every field is populated every time. expo-audio's `setAudioModeAsync` takes a `Partial<AudioMode>`
 * and MERGES it, so a partial result would let a released claim's flags stay latched on. Deriving
 * the whole mode is what makes release actually release.
 */
export function deriveAudioMode(claims: ReadonlySet<AudioClaim>): AudioMode {
    const required = [...claims].map((claim) => CLAIM_REQUIREMENTS[claim]);
    return {
        // Agent speech is the point of TTS; the hardware mute switch silencing it is never wanted.
        playsInSilentMode: true,
        allowsRecording: required.some((r) => r.allowsRecording),
        shouldPlayInBackground: required.some((r) => r.shouldPlayInBackground),
        // Happy talks over podcasts and music rather than stopping them — the user is listening to
        // the agent between other audio, not instead of it.
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
    };
}
