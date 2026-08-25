import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// [LAW:one-source-of-truth] The one place that knows how synthesized audio becomes sound: write the
// bytes to a cache file, hand the file to a player, wait for the end, and clean up. Both callers —
// the message reader in @/hooks/useTtsPlayer and the permission prompt in ./speakOnce — go through
// here, so there is a single answer to "how does the app play a spoken line".

/**
 * Cancellation shared with the caller.
 *
 * `wakeup` is installed by playMp3 and lets a caller cut a play short: flipping `aborted` alone
 * would not resolve the promise, because it is waiting on a playback event that will never come once
 * the user has moved on.
 */
export interface AbortToken {
    aborted: boolean;
    wakeup: () => void;
}

/**
 * Resources handed back as they are created, so the caller can tear them down from elsewhere —
 * a stop button, an unmount, a session change. Playback owns the happy path; only the caller knows
 * when the world has changed underneath it.
 */
export interface PlaybackResources {
    setFile(file: File | null): void;
    setPlayer(player: AudioPlayer | null): void;
}

/**
 * Play mp3 bytes to completion.
 *
 * Resolves when playback finishes or the token is aborted, whichever comes first. Deleting the file
 * is the caller's job via `resources` — the file must outlive this call, since the player streams
 * from it and a delete here would cut playback off mid-sentence.
 */
export async function playMp3(
    audio: ArrayBuffer,
    fileName: string,
    token: AbortToken,
    resources: PlaybackResources,
): Promise<void> {
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(new Uint8Array(audio));
    resources.setFile(file);

    if (token.aborted) {
        return;
    }

    const player = createAudioPlayer({ uri: file.uri });
    resources.setPlayer(player);

    await new Promise<void>((resolve) => {
        // [LAW:no-ambient-temporal-coupling] `settled` rather than trusting that the finish event
        // and an abort cannot both arrive. Either may land first, and resolving twice or waiting
        // forever are both real outcomes of assuming an order.
        let settled = false;
        const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        token.wakeup = settle;
        const sub = player.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish) {
                sub.remove();
                settle();
            }
        });

        // An abort between the check above and the listener being attached would otherwise wait on
        // a playback that the caller has already given up on.
        if (token.aborted) {
            sub.remove();
            settle();
            return;
        }

        player.play();
    });
}
