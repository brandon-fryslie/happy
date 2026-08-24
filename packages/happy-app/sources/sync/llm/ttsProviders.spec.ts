import { describe, it, expect } from 'vitest';
import { buildTtsRequest, resolveTtsVoiceAndModel, ttsProviderLabel } from './ttsProviders';

// [LAW:behavior-not-structure] These assert the contract each vendor's API actually requires — the
// URL it serves, the header it authenticates with, the body field names it reads. A different
// internal shape for the provider table would pass all of these unchanged; a wrong header name
// would not.

describe('resolveTtsVoiceAndModel', () => {
    it('defaults each vendor to a voice that vendor can actually serve', () => {
        expect(resolveTtsVoiceAndModel('openai', null, null).voiceId).toBe('alloy');
        expect(resolveTtsVoiceAndModel('elevenlabs', null, null).voiceId).toBe('21m00Tcm4TlvDq8ikWAM');
    });

    it('defaults each vendor to its own speech model', () => {
        expect(resolveTtsVoiceAndModel('openai', null, null).modelId).toBe('gpt-4o-mini-tts');
        expect(resolveTtsVoiceAndModel('elevenlabs', null, null).modelId).toBe('eleven_turbo_v2_5');
    });

    it('prefers the user’s choice over the default', () => {
        const { voiceId, modelId } = resolveTtsVoiceAndModel('openai', 'nova', 'tts-1-hd');
        expect(voiceId).toBe('nova');
        expect(modelId).toBe('tts-1-hd');
    });

    it('treats a blank or whitespace-only choice as unset', () => {
        // A cleared text field arrives as '' or '   ', never as null. Sending that as the voice
        // would 400 at the vendor, so it has to resolve to the default like any other absence.
        expect(resolveTtsVoiceAndModel('openai', '   ', '').voiceId).toBe('alloy');
        expect(resolveTtsVoiceAndModel('openai', '   ', '').modelId).toBe('gpt-4o-mini-tts');
    });
});

describe('buildTtsRequest', () => {
    it('authenticates ElevenLabs with xi-api-key and OpenAI with a bearer token', () => {
        expect(buildTtsRequest('elevenlabs', 'k', 'v', 'm', 't').headers['xi-api-key']).toBe('k');
        expect(buildTtsRequest('openai', 'k', 'v', 'm', 't').headers['Authorization']).toBe('Bearer k');
    });

    it('puts the ElevenLabs voice in the path and the OpenAI voice in the body', () => {
        const el = buildTtsRequest('elevenlabs', 'k', 'voice-1', 'm', 't');
        expect(el.url).toContain('/v1/text-to-speech/voice-1/stream');

        const oa = buildTtsRequest('openai', 'k', 'nova', 'm', 't');
        expect(oa.url).toBe('https://api.openai.com/v1/audio/speech');
        expect(JSON.parse(oa.body).voice).toBe('nova');
    });

    it('escapes a voice id that would otherwise break out of the ElevenLabs path', () => {
        const { url } = buildTtsRequest('elevenlabs', 'k', 'a/../b', 'm', 't');
        expect(url).toContain('a%2F..%2Fb');
    });

    it('sends each vendor the body field names it actually reads', () => {
        // The two APIs disagree on every name: text/input, model_id/model. Crossing them yields a
        // 400 that looks exactly like a bad key, so the mapping is worth pinning down.
        const el = JSON.parse(buildTtsRequest('elevenlabs', 'k', 'v', 'model-x', 'hello').body);
        expect(el).toMatchObject({ text: 'hello', model_id: 'model-x' });

        const oa = JSON.parse(buildTtsRequest('openai', 'k', 'v', 'model-x', 'hello').body);
        expect(oa).toMatchObject({ input: 'hello', model: 'model-x', response_format: 'mp3' });
    });

    it('asks both vendors for mp3, which is what the player writes and plays', () => {
        expect(buildTtsRequest('elevenlabs', 'k', 'v', 'm', 't').headers['Accept']).toBe('audio/mpeg');
        expect(buildTtsRequest('openai', 'k', 'v', 'm', 't').headers['Accept']).toBe('audio/mpeg');
    });
});

describe('ttsProviderLabel', () => {
    it('names the vendor for error messages the user will read', () => {
        expect(ttsProviderLabel('elevenlabs')).toBe('ElevenLabs');
        expect(ttsProviderLabel('openai')).toBe('OpenAI');
    });
});
