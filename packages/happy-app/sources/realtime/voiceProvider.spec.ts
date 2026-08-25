import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '@/sync/settings';

// The module under test reads one build-time config value through @/config, which pulls
// in expo-constants and a native module. Stubbing it here keeps the test about the
// mapping from settings to provider, and gives the "Happy points somewhere else" case a
// value distinguishable from ElevenLabs'.
vi.mock('@/config', () => ({
    config: { voiceLivekitUrl: 'wss://livekit.sanctuary.gdn' },
}));

const {
    ELEVENLABS_LIVEKIT_URL,
    HAPPY_LIVEKIT_URL,
    livekitUrlFor,
    requireMintAndDialAgree,
    voiceMint,
} = await import('./voiceProvider');

function settings(overrides: Partial<Settings>): Settings {
    return {
        voiceBypassToken: false,
        voiceCustomAgentId: null,
        voiceCustomElevenLabsApiKey: null,
        ...overrides,
    } as Settings;
}

describe('voiceMint', () => {
    it('mints through Happy when the bypass is off, whatever credentials are lying around', () => {
        expect(voiceMint(settings({
            voiceCustomAgentId: 'agent_leftover',
            voiceCustomElevenLabsApiKey: 'sk-leftover',
        }))).toEqual({ kind: 'happy' });
    });

    it('carries the credentials it proved present', () => {
        expect(voiceMint(settings({
            voiceBypassToken: true,
            voiceCustomAgentId: 'agent_mine',
            voiceCustomElevenLabsApiKey: 'sk-mine',
        }))).toEqual({ kind: 'byo', agentId: 'agent_mine', apiKey: 'sk-mine' });
    });

    it.each([
        ['no key', { voiceCustomAgentId: 'agent_mine', voiceCustomElevenLabsApiKey: null }],
        ['no agent', { voiceCustomAgentId: null, voiceCustomElevenLabsApiKey: 'sk-mine' }],
        ['neither', { voiceCustomAgentId: null, voiceCustomElevenLabsApiKey: null }],
        ['blank key', { voiceCustomAgentId: 'agent_mine', voiceCustomElevenLabsApiKey: '' }],
    ])('reports a bypass with %s as incomplete rather than as Happy', (_, credentials) => {
        expect(voiceMint(settings({ voiceBypassToken: true, ...credentials })))
            .toEqual({ kind: 'byo-incomplete' });
    });
});

describe('livekitUrlFor', () => {
    it('sends a Happy-minted call to the configured deployment', () => {
        expect(livekitUrlFor({ kind: 'happy' })).toBe('wss://livekit.sanctuary.gdn');
        expect(HAPPY_LIVEKIT_URL).toBe('wss://livekit.sanctuary.gdn');
    });

    it('sends every BYO call to ElevenLabs, whose key minted it', () => {
        expect(livekitUrlFor({ kind: 'byo', agentId: 'a', apiKey: 'k' }))
            .toBe(ELEVENLABS_LIVEKIT_URL);
        expect(livekitUrlFor({ kind: 'byo-incomplete' })).toBe(ELEVENLABS_LIVEKIT_URL);
    });
});

describe('requireMintAndDialAgree', () => {
    it('lets a session through when the SDK is pointed where the token is good', () => {
        expect(() => requireMintAndDialAgree(HAPPY_LIVEKIT_URL, HAPPY_LIVEKIT_URL))
            .not.toThrow();
    });

    it('stops the call the settings changed under, naming both providers', () => {
        // The live case: a Happy-minted token in hand, the hook re-rendered onto
        // ElevenLabs' SFU because BYO was toggled during the fetch.
        expect(() => requireMintAndDialAgree(ELEVENLABS_LIVEKIT_URL, HAPPY_LIVEKIT_URL))
            .toThrow(/minted for wss:\/\/livekit\.sanctuary\.gdn.*configured for wss:\/\/livekit\.rtc\.elevenlabs\.io/);
    });

    it('stops a call started before any render configured the SDK', () => {
        expect(() => requireMintAndDialAgree(null, HAPPY_LIVEKIT_URL)).toThrow();
    });
});
