import { HappyError } from '@/utils/errors';

// [LAW:dataflow-not-control-flow] Single unconditional request path; failure surfaces as HappyError.
//
// Calls ElevenLabs text-to-speech streaming endpoint and returns the full mp3 byte buffer. The
// caller is responsible for writing it to a temp file and playing it. We don't actually stream the
// audio while it's downloading — for short summaries the overhead of true streaming is not worth
// the complexity.

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

export interface SynthesizeSpeechOptions {
    apiKey: string;
    voiceId: string;
    text: string;
    modelId?: string;
}

export async function synthesizeSpeech(opts: SynthesizeSpeechOptions): Promise<ArrayBuffer> {
    const { apiKey, voiceId, text, modelId = DEFAULT_MODEL_ID } = opts;

    const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
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
        });
    } catch (err) {
        throw new HappyError(
            'Could not reach ElevenLabs. Check your network connection.',
            true,
        );
    }

    if (!response.ok) {
        let detail = '';
        try {
            const body = await response.text();
            if (body) detail = `: ${body.slice(0, 200)}`;
        } catch { /* ignore */ }
        throw new HappyError(
            `ElevenLabs TTS request failed (${response.status})${detail}`,
            response.status >= 500,
        );
    }

    try {
        return await response.arrayBuffer();
    } catch {
        throw new HappyError('Failed to read audio response from ElevenLabs', true);
    }
}
