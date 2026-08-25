import { HappyError } from '@/utils/errors';

// [LAW:dataflow-not-control-flow] One unconditional request path, mirroring ./apiSummarize. The
// variability is in the response, never in which operations run.
//
// Calls an OpenAI-compatible /audio/transcriptions endpoint and returns the recognized text. Same
// base URL and key as summarization, because for OpenAI they are the same server — but note that a
// local Ollama serves /chat/completions and NOT /audio/transcriptions, so a user pointing
// summarization at Ollama needs a separate endpoint here. The error below says so explicitly rather
// than letting a 404 read as a network problem.

/** Whisper is the transcription model every OpenAI-compatible server implements. */
export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1';

export interface TranscribeOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Local file URI produced by the recorder. */
    fileUri: string;
    /** Container of the recording; must match what the recorder actually wrote. */
    fileName: string;
    mimeType: string;
}

export async function transcribeSpeech(opts: TranscribeOptions): Promise<string> {
    const { baseUrl, apiKey, model, fileUri, fileName, mimeType } = opts;

    const url = baseUrl.replace(/\/+$/, '') + '/audio/transcriptions';

    // React Native's fetch turns a {uri, name, type} part into a real multipart file upload. Do NOT
    // set Content-Type by hand — the runtime has to add the multipart boundary, and overriding it
    // produces a body the server cannot parse.
    const form = new FormData();
    form.append('file', { uri: fileUri, name: fileName, type: mimeType } as unknown as Blob);
    form.append('model', model);
    // The answer is one word. Naming the language stops the transcriber from "recognizing" a short
    // English utterance as some other language, which turns a clean "yes" into an unclear answer.
    form.append('language', 'en');

    const headers: Record<string, string> = {};
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
        response = await fetch(url, { method: 'POST', headers, body: form });
    } catch {
        throw new HappyError(
            `Could not reach the transcription endpoint at ${url}. Check your network and the Base URL in Speak Sessions settings.`,
            true,
        );
    }

    if (!response.ok) {
        // [LAW:no-silent-failure] A 404 here almost always means the base URL points at a server
        // that does chat but not audio — Ollama being the common case. Saying so beats a bare status.
        let detail = '';
        try {
            const body = await response.text();
            if (body) detail = `: ${body.slice(0, 200)}`;
        } catch { /* unreadable body */ }
        const hint = response.status === 404
            ? ' — this endpoint does not serve /audio/transcriptions; a local Ollama cannot transcribe.'
            : '';
        throw new HappyError(
            `Transcription request failed (${response.status})${detail}${hint}`,
            response.status >= 500,
        );
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new HappyError('Transcription endpoint returned invalid JSON', false);
    }

    const text = extractText(body);
    // [LAW:parse-dont-validate] An empty or missing `text` is not an empty answer — it means we did
    // not get one. Returning '' would look exactly like the user saying nothing, so it fails here
    // instead and lets the caller distinguish "silence" from "the transcriber misbehaved".
    if (text === null) {
        throw new HappyError('Transcription endpoint returned no text field', false);
    }
    return text.trim();
}

function extractText(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const text = (body as { text?: unknown }).text;
    return typeof text === 'string' ? text : null;
}
