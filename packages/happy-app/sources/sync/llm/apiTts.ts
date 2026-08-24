import { HappyError } from '@/utils/errors';
import { buildTtsRequest, ttsProviderLabel, type TtsProvider } from './ttsProviders';

// [LAW:dataflow-not-control-flow] Single unconditional request path. The vendor changes what is in
// the request, never which operations run — that difference is carried by the provider table in
// ./ttsProviders, not by branching here.
//
// [LAW:effects-at-boundaries] This module is the edge: it performs the HTTP call and nothing else.
// Deciding what to send is pure and lives in ./ttsProviders.
//
// Returns the full mp3 byte buffer; the caller writes it to a temp file and plays it. We don't
// stream while downloading — for short summaries the overhead of true streaming isn't worth it.

export interface SynthesizeSpeechOptions {
    provider: TtsProvider;
    apiKey: string;
    voiceId: string;
    modelId: string;
    text: string;
}

export async function synthesizeSpeech(opts: SynthesizeSpeechOptions): Promise<ArrayBuffer> {
    const { provider, apiKey, voiceId, modelId, text } = opts;
    const label = ttsProviderLabel(provider);
    const request = buildTtsRequest(provider, apiKey, voiceId, modelId, text);

    let response: Response;
    try {
        response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: request.body,
        });
    } catch {
        throw new HappyError(`Could not reach ${label}. Check your network connection.`, true);
    }

    if (!response.ok) {
        // [LAW:no-silent-failure] Carry the vendor's own explanation through. A bare status leaves
        // the user guessing between a bad key, an unknown voice, and an exhausted quota — three
        // different fixes that otherwise look identical.
        let detail = '';
        try {
            const body = await response.text();
            if (body) detail = `: ${body.slice(0, 200)}`;
        } catch { /* body already consumed or unreadable */ }
        throw new HappyError(
            `${label} TTS request failed (${response.status})${detail}`,
            response.status >= 500,
        );
    }

    try {
        return await response.arrayBuffer();
    } catch {
        throw new HappyError(`Failed to read audio response from ${label}`, true);
    }
}
