import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { AsyncLock } from '@/utils/lock';
import { log } from '@/log';
import { deriveAudioMode, type AudioClaim } from './audioSessionMode';

// [LAW:no-shared-mutable-globals] The iOS/Android audio session is process-wide mutable state.
// Before this module it had no owner: RealtimeSession configured it as a side effect of requesting
// microphone permission, and the TTS player free-rode on whatever config happened to be active —
// which is why auto-speak was gated to the foreground. This module is that missing owner: the only
// place in the app that calls setAudioModeAsync, with claims as its explicit API.
//
// [LAW:one-source-of-truth] The claim set is the single truth; the AudioMode is derived from it on
// every change and never stored. Two representations of "what the session should be" cannot drift
// because there is only one, and the other is recomputed.
//
// [LAW:effects-at-boundaries] This is the effectful edge. The decision of what the session should
// be lives in ./audioSessionMode, which touches no platform API.

export type { AudioClaim };

const activeClaims = new Set<AudioClaim>();

// setAudioModeAsync races badly against itself: two interleaved calls can apply in either order and
// leave the session reflecting the loser. [LAW:no-ambient-temporal-coupling] — serialize the writes
// rather than trusting that callers never overlap.
const lock = new AsyncLock();

/**
 * Push the configuration implied by the current claims to the platform.
 *
 * [LAW:dataflow-not-control-flow] Runs identically on every claim change, including the change to
 * zero claims. There is no "skip the write when nothing is claimed" case — that branch is exactly
 * how the session ends up latched in a stale state nobody wrote deliberately.
 */
async function apply(): Promise<void> {
    // Derivation happens INSIDE the lock, not outside: deriving first would let two overlapping
    // calls each snapshot the claim set, then apply in either order, leaving the session reflecting
    // whichever write landed last rather than the current claims.
    //
    // [LAW:no-silent-failure] No try/catch. A session that refuses to configure means background
    // speech silently does not play — precisely the failure this module exists to end. Swallowing
    // it here would recreate the bug one layer down.
    await lock.inLock(async () => {
        const mode = deriveAudioMode(activeClaims);
        // Configuring the session is not the same as holding it. On iOS the thing that actually keeps
        // a backgrounded app running is an ACTIVE AVAudioSession — UIBackgroundModes:audio grants
        // execution while audio is live, not to an idle app. expo-audio activates implicitly when
        // playback starts, which is too late for a claim whose job is to be ready before there is
        // anything to play. Claiming is therefore both operations, and releasing the last claim hands
        // the session back so other apps resume.
        const active = activeClaims.size > 0;
        // [LAW:no-silent-failure] This session's failure mode is silence, which is indistinguishable
        // from "nothing to say". Recording what was actually written — and on whose behalf — is the
        // only way a missing voice can be traced back to a session that was never configured.
        log.log(`[audio] claims=[${[...activeClaims].join(',')}] background=${mode.shouldPlayInBackground} recording=${mode.allowsRecording} active=${active}`);
        // [LAW:dataflow-not-control-flow] Both writes happen on every claim change, including the
        // change to zero claims. Skipping either when "nothing is claimed" is exactly how the session
        // ends up latched in a state nobody wrote deliberately.
        await setAudioModeAsync(mode);
        await setIsAudioActiveAsync(active);
    });
}

/** Declare that `claim` needs the audio session, and reconfigure to satisfy it. */
export async function acquireAudioSession(claim: AudioClaim): Promise<void> {
    activeClaims.add(claim);
    await apply();
}

/** Withdraw `claim`, reconfiguring down to what the remaining claims still need. */
export async function releaseAudioSession(claim: AudioClaim): Promise<void> {
    activeClaims.delete(claim);
    await apply();
}
