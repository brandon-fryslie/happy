import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Identifies this client to the server in the X-Happy-Client header.
 *
 * [LAW:one-source-of-truth] One constant, because it was three hand-copied string
 * literals across api.ts and auth.ts — and every test that asserted the header spelled
 * it a fourth, fifth and sixth time. A version that lives in six places is a version
 * that gets bumped in five.
 */
export const HAPPY_CLIENT_ID = 'cli-control-plane/0.1.0';

export type Config = {
    serverUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    const serverUrl = (process.env.HAPPY_SERVER_URL ?? 'https://api.cluster-fluster.com').replace(/\/+$/, '');
    const homeDir = process.env.HAPPY_HOME_DIR ?? join(homedir(), '.happy');
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, homeDir, credentialPath };
}
