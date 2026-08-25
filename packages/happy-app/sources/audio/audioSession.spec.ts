import { describe, it, expect } from 'vitest';
import { deriveAudioMode, type AudioClaim } from './audioSessionMode';

// [LAW:behavior-not-structure] These assert the contract — "what session config does this set of
// claims imply" — not how the derivation is implemented. The claim table could become a lookup, a
// reduce, or a bitmask and every test below should still pass unchanged.

const mode = (...claims: AudioClaim[]) => deriveAudioMode(new Set(claims));

describe('deriveAudioMode', () => {
    it('asks for nothing when no claim is held', () => {
        expect(mode()).toMatchObject({ allowsRecording: false, shouldPlayInBackground: false });
    });

    it('opens the microphone for a voice conversation', () => {
        expect(mode('voice-conversation')).toMatchObject({ allowsRecording: true });
    });

    it('keeps playback alive in the background for hands-free speech', () => {
        expect(mode('hands-free-speech')).toMatchObject({ shouldPlayInBackground: true });
    });

    it('satisfies every held claim at once rather than letting the last one win', () => {
        // The bug this module exists to prevent: configuring the session for whichever feature
        // most recently asked, silently revoking what the other one needs. Starting a voice
        // conversation while hands-free is on must not end background playback.
        expect(mode('voice-conversation', 'hands-free-speech')).toMatchObject({
            allowsRecording: true,
            shouldPlayInBackground: true,
        });
    });

    it('gives back what a released claim was holding', () => {
        // Releasing is only real if the derived mode drops the flag. expo-audio merges partial
        // writes, so a mode that omitted the field instead of setting it false would leave the
        // released claim's configuration latched on.
        expect(mode('hands-free-speech', 'voice-conversation')).toMatchObject({ shouldPlayInBackground: true });
        expect(mode('voice-conversation')).toMatchObject({ shouldPlayInBackground: false });
    });

    it('opens the microphone in the background to hear a permission answer', () => {
        // Listening for a spoken yes/no needs both halves at once: hands-free-speech alone cannot
        // record, and voice-conversation alone dies when the screen locks.
        expect(mode('hands-free-listen')).toMatchObject({
            allowsRecording: true,
            shouldPlayInBackground: true,
        });
    });

    it('keeps background playback while listening, so speaking and hearing can overlap', () => {
        // The permission loop holds both: it has just finished speaking the prompt and is now
        // recording the answer. Releasing the listen claim must not end background speech.
        expect(mode('hands-free-speech', 'hands-free-listen')).toMatchObject({
            allowsRecording: true,
            shouldPlayInBackground: true,
        });
        expect(mode('hands-free-speech')).toMatchObject({
            allowsRecording: false,
            shouldPlayInBackground: true,
        });
    });

    it('never lets the hardware mute switch silence the agent', () => {
        for (const m of [mode(), mode('voice-conversation'), mode('hands-free-speech'), mode('hands-free-listen')]) {
            expect(m.playsInSilentMode).toBe(true);
        }
    });
});
