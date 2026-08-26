/**
 * Watches a single file for changes, tolerating a file that does not exist yet.
 *
 * A Claude session JSONL is named before Claude Code creates it, so "not there
 * yet" is the normal opening state of every watcher - not a failure. It is
 * represented here as its own waiting state that blocks on a directory-creation
 * event, so the only thing that reaches the error path is a watch that is
 * genuinely broken, and it is not buried in noise when it happens.
 */

import { logger } from "@/ui/logger";
import { delay, exponentialBackoffDelay } from "@/utils/time";
import { watch } from "node:fs/promises";
import { watch as watchDirectory } from "node:fs";
import { access } from "node:fs/promises";
import { dirname } from "node:path";

const exists = (path: string) => access(path).then(() => true, () => false);

/** Deepest ancestor of `path` that currently exists - always terminates at root. */
async function nearestExistingAncestor(path: string): Promise<string> {
    let dir = dirname(path);
    while (dirname(dir) !== dir && !(await exists(dir))) {
        dir = dirname(dir);
    }
    return dir;
}

/**
 * Arms a one-shot directory-change signal.
 *
 * [LAW:no-ambient-temporal-coupling] The watcher is created and its listeners
 * attached in one synchronous block, so a change landing while the caller is
 * hitting the filesystem is still delivered. That is what lets the caller arm
 * first and check existence second, with no window in which the very creation
 * event it is waiting for can be missed.
 */
function armDirectoryChange(dir: string, signal: AbortSignal): { changed: Promise<void>, disarm: () => void } {
    const watcher = watchDirectory(dir, { persistent: true, signal });
    let settle!: () => void;
    let fail!: (e: unknown) => void;
    const changed = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
    watcher.on('change', () => settle());
    watcher.on('close', () => settle());
    watcher.on('error', (e) => fail(e));
    // The caller awaits `changed` only after an intervening filesystem check; mark
    // a rejection arriving in that gap as handled so it surfaces at the await
    // instead of as an unhandled rejection.
    changed.catch(() => { });
    return { changed, disarm: () => watcher.close() };
}

/**
 * Resolves once `file` exists, waiting on directory events rather than retrying.
 * Logs at most one line, and only when it actually has to wait.
 */
async function awaitFileCreation(file: string, signal: AbortSignal): Promise<void> {
    if (await exists(file)) return;
    logger.debug(`[FILE_WATCHER] ${file} does not exist yet, waiting for it to be created`);

    while (!signal.aborted) {
        // The parent may be missing too (a project directory Claude has not made
        // yet); watching the nearest existing ancestor walks down as it appears.
        const armed = armDirectoryChange(await nearestExistingAncestor(file), signal);
        try {
            if (await exists(file)) return;
            await armed.changed;
        } finally {
            armed.disarm();
        }
    }
}

export function startFileWatcher(file: string, onFileChange: (file: string) => void) {
    const abortController = new AbortController();
    const signal = abortController.signal;

    void (async () => {
        let failureCount = 0;
        while (!signal.aborted) {
            try {
                await awaitFileCreation(file, signal);
                if (signal.aborted) return;

                logger.debug(`[FILE_WATCHER] Watching ${file}`);
                failureCount = 0;
                for await (const _event of watch(file, { persistent: true, signal })) {
                    if (signal.aborted) return;
                    logger.debug(`[FILE_WATCHER] File changed: ${file}`);
                    onFileChange(file);
                }
                // The watch ended on its own - the file was replaced or removed, so
                // fall back into the waiting state rather than treating it as broken.
            } catch (e: unknown) {
                if (signal.aborted) return;
                // Everything reaching here is a watch that failed for a reason
                // someone needs to know about. Back off so a permanently broken
                // watch reports itself without drowning out the rest of the log.
                failureCount++;
                const backoff = exponentialBackoffDelay(failureCount, 1000, 30000, 10);
                logger.infoDeveloper(`[FILE_WATCHER] Watch failed for ${file} (attempt ${failureCount}), retrying in ${backoff}ms: ${e instanceof Error ? e.message : String(e)}`);
                await delay(backoff);
            }
        }
    })();

    return () => {
        abortController.abort();
    };
}
