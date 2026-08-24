// [LAW:one-type-per-behavior] ElevenLabs and OpenAI are not two kinds of thing. They are two
// instances of one thing — "turn text into MP3 bytes" — differing only in URL, auth header, request
// body, and their default model and voice. All five of those are configuration, so they live as data
// in the table below. Adding a third vendor is a row here; no caller changes and nothing branches.
//
// [LAW:effects-at-boundaries] Pure by construction: this module builds request descriptions and
// never performs one. apiTts.ts is the edge that executes them, which is what lets the whole table
// be unit-tested with no network and no mocks.

/**
 * A speech-synthesis vendor.
 *
 * [LAW:types-are-the-program] The domain's own enum rather than a base-URL string. A URL would admit
 * endpoints whose auth scheme and body shape we do not know, and the caller would have to guess
 * which of the two request shapes to send. Naming the vendor makes that guess unrepresentable.
 */
export type TtsProvider = 'elevenlabs' | 'openai';

/** A ready-to-execute HTTP request. The caller performs it; nothing here does. */
export interface TtsRequest {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: string;
}

interface ProviderSpec {
    /** Vendor name as it appears in user-facing error messages. */
    readonly label: string;
    readonly defaultModelId: string;
    /**
     * Voice used when the user has not chosen one.
     *
     * Provider-scoped on purpose: 'alloy' means nothing to ElevenLabs and a Rachel UUID means
     * nothing to OpenAI. Because the default is reached through the provider key, a voice can never
     * be paired with a vendor that cannot serve it.
     */
    readonly defaultVoiceId: string;
    buildRequest(apiKey: string, voiceId: string, modelId: string, text: string): TtsRequest;
}

const PROVIDER_SPECS: Record<TtsProvider, ProviderSpec> = {
    elevenlabs: {
        label: 'ElevenLabs',
        defaultModelId: 'eleven_turbo_v2_5',
        defaultVoiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
        buildRequest: (apiKey, voiceId, modelId, text) => ({
            // The voice is part of the path here, so it must be escaped; OpenAI passes it in the body.
            url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
                text,
                model_id: modelId,
                output_format: 'mp3_44100_128',
            }),
        }),
    },
    openai: {
        label: 'OpenAI',
        defaultModelId: 'gpt-4o-mini-tts',
        defaultVoiceId: 'alloy',
        buildRequest: (apiKey, voiceId, modelId, text) => ({
            url: 'https://api.openai.com/v1/audio/speech',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
                model: modelId,
                voice: voiceId,
                input: text,
                response_format: 'mp3',
            }),
        }),
    },
};

/** The vendor's display name, for error messages the user will read. */
export function ttsProviderLabel(provider: TtsProvider): string {
    return PROVIDER_SPECS[provider].label;
}

/**
 * Fill in whatever the user left unset.
 *
 * [LAW:parse-dont-validate] Callers receive a model and voice that are guaranteed non-empty and
 * guaranteed to belong to `provider`, so no code downstream re-checks either one.
 */
export function resolveTtsVoiceAndModel(
    provider: TtsProvider,
    voiceId: string | null | undefined,
    modelId: string | null | undefined,
): { voiceId: string; modelId: string } {
    const spec = PROVIDER_SPECS[provider];
    return {
        voiceId: voiceId?.trim() || spec.defaultVoiceId,
        modelId: modelId?.trim() || spec.defaultModelId,
    };
}

/** Describe the synthesis call for `provider`. Performing it is apiTts.ts's job. */
export function buildTtsRequest(
    provider: TtsProvider,
    apiKey: string,
    voiceId: string,
    modelId: string,
    text: string,
): TtsRequest {
    return PROVIDER_SPECS[provider].buildRequest(apiKey, voiceId, modelId, text);
}
