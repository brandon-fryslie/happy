# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **This is a fork.** Track all fork-specific changes in [`design-docs/FORK_CHANGES.md`](./design-docs/FORK_CHANGES.md). When you make any change that diverges from upstream `slopus/happy`, update that file in the same commit. Brainstorming notes live in [`design-docs/BRAINSTORM_INITIAL.md`](./design-docs/BRAINSTORM_INITIAL.md).

## What this is

Happy is a mobile/web/desktop client + CLI wrapper for Claude Code and Codex with end-to-end encrypted sync. The user runs `happy claude` or `happy codex` instead of the underlying agent; the CLI encrypts session data and pushes it to the Happy server, where mobile/web clients can pick up the conversation, send messages, and approve tool permissions remotely.

## Monorepo layout (pnpm workspaces)

| Package | Role | Stack |
|---|---|---|
| `packages/happy-cli` (`happy` on npm) | Wraps `claude`/`codex`/`gemini` binaries; runs the local daemon; speaks the encrypted protocol | Node 20, TypeScript, Socket.IO, node-pty, TweetNaCl |
| `packages/happy-app` | The mobile/web/Tauri-desktop client | React Native + Expo SDK 54, Unistyles, Expo Router v6, LiveKit, libsodium |
| `packages/happy-server` | Backend: HTTP + Socket.IO + Postgres + Redis + S3 + Prometheus | Fastify 5, Prisma + Postgres (PGlite for standalone dev), Redis, MinIO/S3 |
| `packages/happy-wire` (`@slopus/happy-wire`) | Shared Zod schemas for messages and the wire protocol | TypeScript, Zod, pkgroll |
| `packages/happy-agent` | Standalone CLI for driving sessions remotely (create/send/monitor) | TypeScript |
| `packages/happy-app-logs` | Log-collection helper for the app | TypeScript |
| `packages/codium` | Experimental Electron + Vite + React desktop scaffold | Electron, Vite, React |

## Commands you'll actually use

All commands run from the repo root unless noted. Use **pnpm**, never npm.

### Local dev — quickest path
```bash
# Backend (PGlite, no Docker; loads packages/happy-server/.env.dev; port 3005)
pnpm --filter happy-server standalone:dev

# Mobile app (Expo dev server)
pnpm --filter happy-app start

# CLI (install local build globally as `happy`, pointing at your local server)
pnpm --filter happy cli:install
HAPPY_SERVER_URL=http://localhost:3005 happy claude

# Web app
pnpm web

# Tauri desktop (macOS)
pnpm --filter happy-app tauri:dev
```

### Typecheck / build / test (per package)
```bash
pnpm --filter happy-server build         # tsc --noEmit
pnpm --filter happy-app   typecheck      # tsc --noEmit (run after every app change)
pnpm --filter happy       typecheck      # tsc --noEmit
pnpm --filter @slopus/happy-wire build   # tsc + pkgroll → dist/

pnpm --filter happy-server test          # vitest run
pnpm --filter happy       test           # vitest run (build first)
pnpm --filter happy-app   test           # vitest watch
pnpm --filter happy-agent test           # vitest run
pnpm --filter happy-agent test:integration

# Single test file
pnpm --filter happy-server vitest run sources/path/to/file.spec.ts
```

When you change `packages/happy-wire/src/*`, you **must** run `pnpm --filter @slopus/happy-wire build` before other packages' typechecks will see the new exports — server and app consume the built `dist/`, not the source.

### Multi-environment workflow (`environments/`)
The repo has a sophisticated dev-environment manager that provisions isolated Postgres/Redis/MinIO + lab-rat projects + per-env CLI homes. See `docs/dev-environments.md`. Common entry points:
```bash
pnpm env:list                      # show envs
pnpm env:new <name>                # create a new env
pnpm env:up                        # bring infra up for current env
pnpm env:server | env:web | env:cli  # run that component against the current env
```

## Big-picture architecture

```
Phone/Web/Desktop (happy-app)        CLI host (happy-cli)
        │                                    │
        │  Socket.IO + HTTP                  │  Socket.IO + HTTP
        │  (E2E-encrypted payloads)          │  (E2E-encrypted payloads)
        ▼                                    ▼
                  ┌──────────────────────────────────┐
                  │  happy-server (Fastify + S.IO)   │
                  │  Postgres / Redis / S3 / Metrics │
                  └──────────────────────────────────┘
                                 ▲
                                 │  shared schemas
                       packages/happy-wire (Zod)
```

### Encryption model — read first, edit carefully
The server is **blind to user content**. Session metadata, agent state, messages, machine state, artifacts, and KV values are all encrypted client-side (`packages/happy-cli/src/api/encryption.ts`, `packages/happy-app/sources/encryption/`) using TweetNaCl/libsodium and base64-encoded on the wire. New fields that should remain private must be encrypted in the **same place** as the surrounding payload — never add a plaintext sibling. See `docs/encryption.md` for the binary layouts.

### Realtime / RPC
Socket.IO carries two flavors of connection:
- **Session-scoped** (`ApiSessionClient`): receives `update` events, emits `message`, `update-metadata`, `update-state`, `session-alive`, `usage-report`.
- **Machine-scoped** (`ApiMachineClient`): heartbeats, daemon state, receives `spawn-session` RPCs from server/mobile.

RPC handlers (bash, file read/write, ripgrep, difftastic) are registered per-session via `registerCommonHandlers`. Mobile/web drives local actions through Socket.IO RPC — there is no broad REST surface for tool execution. See `docs/realtime-sync-and-rpc.md` and `docs/protocol.md`.

### CLI daemon
A single long-lived daemon per machine (PID + port stored in `~/.happy/daemon.state.json`) owns:
- The `ApiMachineClient` heartbeat
- A local control-server HTTP API on `127.0.0.1` for `/list`, `/spawn-session`, `/stop-session`, `/stop`, `/session-started`
- A map of child agent processes (claude / codex / gemini)

Sessions can be spawned by (a) the CLI directly in the foreground, (b) the daemon in the background, or (c) remote `spawn-session` RPCs forwarded by the server. Detail in `docs/cli-architecture.md`.

### Claude vs Codex integration
- **Claude local mode**: spawns the `claude` binary with stdio inherited; ingests JSONL session files via `sessionScanner` and maps records to the unified session protocol via `claude/utils/sessionProtocolMapper.ts`. Permission checks are bridged through an MCP server.
- **Claude remote mode**: uses `@anthropic-ai/claude-code` SDK; an `OutgoingMessageQueue` keeps ordering across the WebSocket.
- **Codex**: similar shape, in `src/codex/`.
- **Gemini**: in `src/gemini/`.

The unified envelope (`content.type === "session"`) is defined in `@slopus/happy-wire`; both Claude paths converge on `ApiSessionClient.sendClaudeSessionMessage()`. See `docs/session-protocol.md` and `docs/session-protocol-claude.md`.

### Voice (ElevenLabs)
The mobile app integrates ElevenLabs ConvAI for hands-free agent control (mic button in `SessionView.tsx`). `RealtimeSession.ts` is the lifecycle owner; `RealtimeVoiceSession.tsx` (native) and `.web.tsx` (web) are the SDK bridges. The voice agent invokes `messageClaudeCode` and `processPermissionRequest` tools, which route through the session that's currently visible (a single module-level `currentSessionId` is the source of truth — see `docs/voice-architecture.md`).

Tokens are minted server-side at `POST /v1/voice/conversations` using the server's `ELEVENLABS_API_KEY` for the default agent, with usage gating against ElevenLabs (free tier 20 min / 30 days, paid 5 hrs, max 100 conversations/30 days, queried directly from ElevenLabs — no local usage DB). A BYO path (this fork) lets users supply their own agent ID + API key.

## Where data lives

| Where | What |
|---|---|
| Server Postgres (`Account`, `Session`, `SessionMessage`, `Machine`, `Artifact`, `UploadedFile`, `UserKVStore`, `VoiceConversation`, `AccessKey`, `AccountPushToken`, etc.) | All user-content fields are **encrypted blobs** (`String`/`Bytes`); only routing/auth fields (publicKey, accountId, tags, timestamps, version counters) are plaintext |
| Server Redis | Cross-process pub/sub for Socket.IO + activity cache (production only; `pnpm dev`) |
| Server S3/MinIO | Uploaded files (also encrypted client-side) |
| `~/.happy/` (override: `HAPPY_HOME_DIR`) | CLI local state: `settings.json` (onboarding/profile), `access.key` (encryption keys), `daemon.state.json` (PID/port/version), `logs/` |
| App device storage | App settings (synced through the encrypted settings field on `Account`), credentials in platform secure storage, voice/speech caches |

Schema versioning: `packages/happy-app/sources/sync/settings.ts` uses a partial Zod parse and merges defaults so older clients silently preserve unknown fields and newer clients fall back to defaults. Don't break this contract — never delete or re-type a settings field without bumping `SUPPORTED_SCHEMA_VERSION`.

## Per-package conventions (deferred to subpackage CLAUDE.md)

Each package has its own CLAUDE.md with detailed rules. Read the relevant one before editing:
- `packages/happy-app/CLAUDE.md` — Unistyles patterns, i18n discipline (`t(...)` + all language files), `useHappyAction`, layout primitives, Avatar, never `Alert` (use `@/modal`), `expo-router` only, **always run `pnpm typecheck` after changes**.
- `packages/happy-server/CLAUDE.md` — 4-space indent, `@/` imports, Fastify+Zod routes, `inTx` for Prisma transactions, **never write Prisma migrations yourself** (only `pnpm generate`), idempotent endpoints, `.logs/MM-DD-HH-MM-SS.log` debugging tells.
- `packages/happy-cli/CLAUDE.md` — 2-space indent, `@/` imports, no top-of-file mocks (real API calls in tests), file-based logging only (don't disturb the agent's TTY), strict typing.

## Things that have bitten people

- `pnpm dev` for the server requires Docker (Postgres + Redis); `pnpm standalone:dev` does not — use the latter for solo work.
- The `happy-wire` package ships compiled artifacts. Forgetting to rebuild after editing schemas → confusing `has no exported member` errors in app/server.
- Voice "bypass" mode pre-fork connected the mobile SDK directly to ElevenLabs with just an `agent_id` (no auth) — that endpoint requires the agent to be public. The fork routes BYO bypass through the server with the user's API key (see `FORK_CHANGES.md`).
- The CLI launcher must reap the spawned `claude` binary on parent death, or the orphan stays attached to the TTY's foreground process group and steals keystrokes from the next session in the same pane (see fix `2a899e1b`).

## Reference docs in this repo

The `docs/` directory is the canonical written architecture. Start with `docs/README.md` for the index. Highlights:
- `docs/protocol.md`, `docs/api.md` — wire protocol, HTTP surface
- `docs/encryption.md` — client/server crypto layouts
- `docs/backend-architecture.md`, `docs/cli-architecture.md` — server + CLI structure with mermaid diagrams
- `docs/session-protocol.md`, `docs/session-protocol-claude.md` — unified chat envelopes, Claude-specific dedup
- `docs/realtime-sync-and-rpc.md`, `docs/multi-process.md` — Socket.IO + Redis behavior
- `docs/voice-architecture.md`, `docs/paid-voice.md` — ElevenLabs integration + gating
- `docs/dev-environments.md` — the `environments/` workflow
- `docs/permission-resolution.md` — how permission modes resolve across app + CLI
