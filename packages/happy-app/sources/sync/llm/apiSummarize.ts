import { HappyError } from '@/utils/errors';

// [LAW:dataflow-not-control-flow] No conditional skipping — request always fires; variability lives
// in the response shape (HappyError on failure, summary string on success).
//
// Calls an OpenAI-compatible /chat/completions endpoint to summarize session messages for audio
// playback. Endpoint examples: https://api.openai.com/v1, http://ollama.local:11434/v1,
// https://openrouter.ai/api/v1.

const SYSTEM_PROMPT = `You produce concise spoken-word summaries of agent/user chat transcripts for audio playback.

Rules:
- Output plain prose only. No markdown, no bullet points, no headings, no code blocks, no asterisks.
- Under 3 short paragraphs total.
- Focus on outcomes, decisions, and concrete next actions — not the back-and-forth flow.
- Refer to participants as "you" (the user) and "the agent". Do not mention the user's name.
- If the transcript is short, the summary should be even shorter — do not pad.
- If nothing meaningful happened (greetings only, etc.), return a single sentence saying so.`;

export interface SummarizeOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: { role: 'user' | 'agent'; text: string }[];
}

export async function summarizeMessages(opts: SummarizeOptions): Promise<string> {
    const { baseUrl, apiKey, model, messages } = opts;

    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const transcript = messages
        .map(m => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.text}`)
        .join('\n\n');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Summarize this transcript for audio playback:\n\n${transcript}` },
                ],
                temperature: 0.3,
                stream: false,
            }),
        });
    } catch (err) {
        throw new HappyError(
            `Could not reach summarization endpoint at ${url}. Check your network and the LLM Base URL in TTS settings.`,
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
            `Summarization request failed (${response.status})${detail}`,
            response.status >= 500,
        );
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new HappyError('Summarization endpoint returned invalid JSON', false);
    }

    const content = extractFirstChoiceContent(body);
    if (!content) {
        throw new HappyError('Summarization endpoint returned no content', false);
    }
    return content.trim();
}

function extractFirstChoiceContent(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0];
    if (!first || typeof first !== 'object') return null;
    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== 'object') return null;
    const content = (message as { content?: unknown }).content;
    return typeof content === 'string' ? content : null;
}
