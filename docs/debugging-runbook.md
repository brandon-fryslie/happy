# Debugging runbook — homelab deployment

For diagnosing "X doesn't work" reports against the homelab instance. It assumes the
reporter is using a phone you cannot drive yourself, so every step here is something
you can run from the Mac.

Everything below was verified against the running system on 2026-08-22.

## The shape of the system

Four tiers, and a message crosses all of them:

```
phone / webapp  ──socket.io+http──▶  happy-server  ──socket.io──▶  CLI daemon  ──spawns──▶  CLI session ──▶ claude
   (happy-app)                    (Nomad job `happy`)              (~/.happy)                                binary
```

The one fact that governs all debugging: **the server is blind to content.** Session
metadata, agent state, messages and machine state are encrypted on the client before
they leave it. The server routes ciphertext and never sees inside it.

Two consequences you will rely on constantly. First, any decryption or schema failure
is a *client-side* event — the server cannot report it and never will, so no amount of
server log reading will find it. Second, when the server says it delivered something
and the client shows nothing, the fault is almost always the client failing to decrypt
or parse, not the transport.

## What runs where

The Nomad job ID and the hostname deliberately do not match. Read this table before
concluding a service is missing.

| Nomad job | Serves | Hostname |
|---|---|---|
| `happy` | the API server | `happy-server.sanctuary.gdn` |
| `happy-webapp` | the web UI | `happy.sanctuary.gdn` |
| `happy-expo` | Expo dev client | `happy-expo.sanctuary.gdn` |
| `happy-test` | API, PR builds | `happy-server-test.sanctuary.gdn` |
| `happy-webapp-test` | web UI, PR builds | `happy-test.sanctuary.gdn` |

This Mac runs one profile, `~/.happy`, against `happy-server.sanctuary.gdn`. The URL
comes from `HAPPY_SERVER_URL`, exported in the dotfiles repo at `config/zshrc.home`.
Confirm with `happy doctor`, which prints the resolved server URL and home directory.

## Getting logs

### CLI and daemon

`~/.happy/logs/YYYY-MM-DD-HH-MM-SS-pid-<pid>.log`, with a `-daemon` suffix for the
daemon. One file per process, **timestamps in local time**, and nothing ever deletes
them. The newest file is the one you want:

```bash
ls -t ~/.happy/logs | head -5
cat ~/.happy/logs/$(ls -t ~/.happy/logs | head -1)
```

The daemon records its own path in `~/.happy/daemon.state.json` under `daemonLogPath`.
A daemon started by anything other than `daemon start-sync` writes a file *without* the
`-daemon` suffix, so sort by mtime rather than filtering on the name.

### Server

Read it from the Nomad API. Allocation IDs change on every restart, so discover it:

```bash
ALLOC=$(curl -s http://192.168.7.217:4646/v1/job/happy/allocations \
  | python3 -c "import json,sys; print([a['ID'] for a in json.load(sys.stdin) if a['ClientStatus']=='running'][0])")

curl -s "http://192.168.7.217:4646/v1/client/fs/logs/$ALLOC?task=happy&type=stdout&plain=true&origin=end&offset=200000"
```

The task is named `happy`, not `server` — asking for `task=server` returns
`unknown task name`. Output is pino, one structured record per event, and **timestamps
are UTC**.

### The phone

Two ways, and you will usually want the second.

The in-app buffer holds the last 5000 lines in RAM. The user reaches it through
Settings → enable dev mode → `/dev` → Logs, where there is a "copy all" button. It
needs no setup, which makes it the right call for a one-off.

For anything longer, run the collector and have the user point the app at it:

```bash
pnpm app-logs        # listens on :8787, writes ~/.happy/app-logs/<timestamp>.log
```

In the app: `/dev` → Log Server → `http://100.66.66.6:8787` (this Mac's tailnet
address — use it rather than a LAN IP, so the phone keeps reporting off your home
network). The app reads that URL once at startup, so it must be restarted afterwards.

Two things get dropped by default even with the collector running. `console.log`,
`info` and `debug` are discarded unless console output is enabled in the same dev
screen; only `warn` and `error` always come through. And the traffic is plaintext
HTTP — fine on the tailnet, not something to leave enabled.

## Correlating across tiers

`machineId` and `sessionId` are the only identifiers that appear on both the client and
the server. There is no request ID, no trace ID, and no shared per-message sequence
number; Fastify's `reqId` is a per-process counter that never leaves the server and is
never attached to socket events.

The richest single line in the system is the server's connection record, which ties
five identifiers together:

```
Token verified: <accountId>, clientType: machine-scoped, client: cli-daemon/1.2.0,
sessionId: <id|none>, machineId: <id>, socketId: <id>
```

**Correct for the clock before you correlate.** Server logs are UTC and CLI logs are
local, currently a six-hour gap. The same connection appears at `17:45:34` in the CLI
log and `23:45:34` on the server. Forget this and you will conclude that two records of
one event are unrelated.

## Symptom lookup

### "My phone doesn't show the session"

Start in the CLI log for that session and grep `Session created/loaded`. If it's
missing, the session was never created — look for `[API] [ERROR] Failed to get or
create session`. If it's present, take the session ID to the server log and grep
`Token verified:.*sessionId: <id>`.

If the server has the session and the phone still doesn't show it, you are past what
the server can tell you and it is a decrypt or parse failure on the phone. Get the
phone's logs and grep `SessionEncryption`. Two distinct lines now separate the two
causes: `Metadata DECRYPT failed` means the data key is wrong for that session, and
`Metadata SCHEMA parse failed` means client and server disagree about the shape, with
the offending zod issues attached.

Also worth a look on the server: `Dropping message from socket ... session <id> not
found`. That fires when a message arrives for a session the database doesn't have, or
one owned by a different account.

### "Permission prompts never arrive"

Grep the session's CLI log for `Permission request sent for tool call`. If it's absent
the agent never asked — check `Permission approved/denied` to see whether it
auto-resolved.

If it was sent, look for `agent-state update rejected by server`. That line means the
write carrying the prompt failed, and the CLI is now waiting forever on a prompt the
phone was never told about.

If the write succeeded, the prompt reached the phone as ciphertext and failed there.
Grep the phone's logs for `AgentState DECRYPT failed` or `AgentState SCHEMA parse
failed`. Both make the pending-request list look empty rather than broken, which is
why this presents as silence rather than an error.

### "I can't start a session from my phone"

This is an RPC from the phone to your daemon, and the server now distinguishes the two
failures. `RPC unroutable: no socket registered for room ...` means nothing had
registered the method after the reconnect grace period — the daemon is absent. `RPC
timeout` or `RPC target_disconnected` means the daemon was found and did not answer,
which is a different problem: up but wedged.

Both lines carry `method`, which embeds the `machineId`, so you can jump straight to
the matching daemon log.

### "The CLI hangs on startup"

Take the newest file in `~/.happy/logs` and read it top to bottom; the filename embeds
the PID and start time, so the hung process is easy to identify. The useful markers are
`Starting Happy background service`, `did not become ready within` (it gave up and
continued), `Daemon lock file already held` (it exited 0 without saying so), and
`Daemon version mismatch detected` (a possible restart loop).

If it hangs during authentication you will see the last line before auth and then
nothing at all: `packages/happy-cli/src/api/auth.ts` contains no logging whatsoever.

### "Connection keeps dropping"

The app logs socket status transitions as `SyncSocket: <from> → <to> (<reason>)`, once
per transition rather than once per retry. Reconnection is infinite with a 5-second
backoff, so a repeating pattern of the same transition is the tell.

## Known blind spots

Do not spend time hunting for evidence that isn't produced.

`happy doctor` reports "✓ Authenticated (credentials found)" purely because
`access.key` exists on disk. It never contacts the server. Point the CLI at a server
your key was not registered against and it will still print the checkmark while every
request returns 401. To actually confirm authentication, restart the daemon and look
for `Machine <id> registered/updated with server`, which is a real authenticated
round-trip.

**Server metrics are not being collected.** The server generates websocket connection
gauges, event counters, heartbeat counters, RPC histograms and Redis stream lag, and
serves them on port 9090 — which the Nomad job does not expose. VictoriaMetrics scrapes
the API port instead and gets a 404 every interval, and has done since 2026-06-04.
Tracked as `home-grafana-5jk` in home-infra. Until that lands there is no time-series
view of any of this, which is why the log lines above matter more than they otherwise
would.

Successful `update-metadata`, `update-state` and `session-alive` events are not logged
server-side at all, only counted. Absence of an error line for them proves nothing.

Decryption helpers below `SessionEncryption` still return `null` silently
(`sources/sync/encryption/encryptor.ts`, `encryption.ts`, `aes.web.ts`). The named
call sites now report, but a failure originating deeper will surface as one of those
messages rather than at its true origin.

Log files are never rotated or pruned, on either the CLI or the app collector. One file
per process, forever. The retired cloud profile had reached roughly 34,000.
