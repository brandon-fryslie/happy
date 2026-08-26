/**
 * Behaviour tests for startFileWatcher.
 *
 * The contract has two halves that used to be in tension: a file that does not
 * exist yet must be waited for quietly, and changes must still be delivered once
 * it appears - including when the parent directory does not exist either.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logLines: string[] = [];
vi.mock('@/ui/logger', () => ({
    logger: {
        debug: (message: string) => { logLines.push(message); },
        infoDeveloper: (message: string) => { logLines.push(message); },
    }
}));

const { startFileWatcher } = await import('./startFileWatcher');

/** Polls a condition instead of sleeping a fixed amount, to stay off the clock. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) return true;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return condition();
}

describe('startFileWatcher', () => {
    let dir: string;
    let stop: (() => void) | null = null;

    beforeEach(async () => {
        logLines.length = 0;
        dir = await mkdtemp(join(tmpdir(), 'happy-file-watcher-'));
    });

    afterEach(async () => {
        stop?.();
        stop = null;
        await rm(dir, { recursive: true, force: true });
    });

    it('waits quietly for a file that does not exist yet, then reports its changes', async () => {
        const file = join(dir, 'session.jsonl');
        const changes: string[] = [];

        stop = startFileWatcher(file, (f) => { changes.push(f); });

        // Give the watcher time to spin, if it were going to.
        await new Promise(resolve => setTimeout(resolve, 2500));
        expect(logLines.filter(l => l.includes('does not exist yet'))).toHaveLength(1);
        expect(logLines.filter(l => l.includes('Watch failed'))).toHaveLength(0);
        expect(changes).toHaveLength(0);

        await writeFile(file, 'first\n');
        await waitFor(() => logLines.some(l => l.includes('Watching')));

        await appendFile(file, 'second\n');
        expect(await waitFor(() => changes.length > 0)).toBe(true);
        expect(changes[0]).toBe(file);
    }, 15000);

    it('waits for a file whose parent directory does not exist yet', async () => {
        const projectDir = join(dir, 'not-created-yet');
        const file = join(projectDir, 'session.jsonl');
        const changes: string[] = [];

        stop = startFileWatcher(file, (f) => { changes.push(f); });

        await new Promise(resolve => setTimeout(resolve, 1500));
        expect(logLines.filter(l => l.includes('Watch failed'))).toHaveLength(0);

        await mkdir(projectDir);
        await writeFile(file, 'first\n');
        expect(await waitFor(() => logLines.some(l => l.includes('Watching')))).toBe(true);

        await appendFile(file, 'second\n');
        expect(await waitFor(() => changes.length > 0)).toBe(true);
    }, 15000);

    it('stops reporting changes once cancelled', async () => {
        const file = join(dir, 'session.jsonl');
        const changes: string[] = [];
        await writeFile(file, 'first\n');

        const cancel = startFileWatcher(file, (f) => { changes.push(f); });
        await waitFor(() => logLines.some(l => l.includes('Watching')));
        cancel();

        await appendFile(file, 'second\n');
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(changes).toHaveLength(0);
    }, 15000);
});
