/**
 * Which ConvAI API a voice conversation is minted against.
 *
 * The conversation token is a JWT signed by one provider's LiveKit deployment, so the
 * provider that mints it also decides which SFU the client may dial. Keeping the choice
 * in one function keeps those two from being answered separately and disagreeing —
 * a mismatch presents as a client that connects to a room nobody is in.
 */

/** ElevenLabs' own ConvAI origin. */
export const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";

// The SFU an ElevenLabs token admits to lives in the app's voiceProvider and only
// there. The server never dials one, so a copy here would be a second thing to update
// with nothing keeping the two equal. [LAW:one-source-of-truth]

/** The path both ElevenLabs and openconv serve the ConvAI surface at. */
const CONVAI_PATH = "/v1/convai";

/**
 * The ConvAI base URL the metered path calls: usage queries and token mints.
 *
 * Takes the environment rather than reading it, so the choice is a pure function of
 * configuration and the effect stays at the route that calls this.
 *
 * The operator supplies an origin, never a path: which path this service speaks ConvAI
 * over is the protocol's business, not theirs. `VOICE_CONVAI_ORIGIN` unset means
 * ElevenLabs, which is what an untouched deployment should do.
 */
export function meteredConvaiApi(env: NodeJS.ProcessEnv): string {
    const origin = env.VOICE_CONVAI_ORIGIN || ELEVENLABS_ORIGIN;
    return `${origin.replace(/\/+$/, "")}${CONVAI_PATH}`;
}

/**
 * The ConvAI base URL the bring-your-own-key path calls.
 *
 * A constant rather than configuration: BYO mints with a key the user holds an account
 * for, and that account is at ElevenLabs. Pointing it anywhere else would present the
 * user's own credential to a service that has never heard of it.
 */
export const BYO_CONVAI_API = `${ELEVENLABS_ORIGIN}${CONVAI_PATH}`;
