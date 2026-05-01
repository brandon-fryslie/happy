# Initial Brainstorm — Improvements & Feature Bets

> Living document. Written from a developer / feature-addition perspective after a first pass through the codebase. Not a roadmap — a menu of bets, ranked roughly by leverage. Cross-link to design docs in `docs/` and `design-docs/` as ideas firm up.

## A. Voice — built on top of the BYO ElevenLabs work

The BYO API-key path on `voice-byo-elevenlabs` opens up several adjacent improvements that upstream can't easily ship because they don't have user keys:

1. **Custom ElevenLabs base URL** — ElevenLabs supports white-label/regional endpoints; let users override the host. Trivial change on top of BYO.
2. **Drop ElevenLabs entirely as an option** — Pluggable voice backends: OpenAI Realtime, Deepgram Nova-3 + Cartesia, local Whisper + Piper. The current `RealtimeVoiceSession.tsx` interface (`startSession`/`endSession`/`sendTextMessage`/`sendContextualUpdate`) is the right boundary — implement it for one more provider and the architecture answers whether it's reusable.
3. **Voice → Codex/Gemini parity** — `realtimeClientTools.ts` only exposes `messageClaudeCode` and `processPermissionRequest`. Codex sessions get no voice control. Generalize the tool to `messageActiveSession` and let routing handle provider dispatch.
4. **Local STT/TTS for transcript-only mode** — Many users want voice input → text without realtime turn-taking. Cheaper, no per-minute cost, no third-party data exposure.
5. **Per-session voice context budget** — `voiceHooks.onSessionFocus()` re-injects context on every focus; for long sessions this hits the agent's context window hard. Cap and summarize.

## B. CLI — daemon hardening

The fix in `2a899e1b` (orphan claude reaper) suggests this area is fragile. Likely follow-ups:

1. **Crash dumps from the daemon** — Right now `daemon.state.json` records PID and port but not "why did the previous daemon die." A small ring buffer of last-N exit reasons would cut debugging time on the "my sessions vanished" complaints.
2. **Unified launcher abstraction** — `claude/`, `codex/`, `gemini/`, `openclaw/` each re-implement spawn + signal forwarding + JSONL ingestion + session protocol mapping. Pulling out a `LocalLauncher` interface would shrink code and make the next provider (anthropic-cli? amp? cline?) a config change rather than a directory.
3. **Daemon-less mode for CI** — Many users would run `happy claude` in CI/scripts where backgrounding makes no sense. A `--no-daemon` ergonomic flag (foreground only, no machine registration, no remote control) would broaden the audience.
4. **`happy doctor` integration tests** — `doctor.ts` already enumerates env state; pairing it with a self-test mode (spawn a throwaway session against the configured server, round-trip a message, validate decryption) would surface broken installs immediately.

## C. App — user-facing low-hanging fruit

1. **Inline diff viewer for `Edit`/`Write` tool calls** — Some of this exists (`feat/diffs-sidebar-resume-cleanup` branch in upstream); it's a high-value polish target if not yet on main.
2. **Session search** — Settings list grows quickly. Full-text over the user's own decrypted messages, client-side only.
3. **Session pin / favorite** — Trivial state add, big QoL.
4. **Mobile push when long-running tool calls finish** — The infra (`AccountPushToken`) is there. Triggering on `turn-end` for sessions that've been backgrounded for >N seconds is mostly wiring.
5. **Codium experimental desktop** — `packages/codium` is a fresh Electron scaffold; if the user wants a true native desktop instead of Tauri-wrapped web, this is where the bet lives. Unclear how much momentum it has.
6. **Speech preview in input field** — Show partial transcription while user is dictating (currently it appears after final). UX win for long messages.

## D. Server — observability & operations

1. **Per-user usage dashboards** — The Prometheus metrics added in upstream `8bc38c91` (client/client_type labels) are the foundation; a Grafana board that surfaces per-user QPS, encryption errors, and message latency would let the operator triage support tickets faster.
2. **Voice usage cache** — Every `POST /v1/voice/conversations` round-trips to ElevenLabs to fetch the last 30 days of conversations to compute used-seconds. That's an N+1 pattern at startup of every voice session. A short-TTL Redis cache keyed by `elevenUserId` would cut latency and ElevenLabs API quota burn.
3. **Idempotency keys** — `docs/api.md` says all operations should be idempotent, but the actual deduplication strategy varies. A standard `Idempotency-Key` header + Redis SETNX cache for write endpoints would harden the contract.
4. **Server-side abuse limits on BYO voice** — A user could write a script to spam `POST /v1/voice/byo-token` and use the Happy server as a free token-mint proxy. Rate-limit per `userId` or require a small server-side cost (signed nonce, etc.).

## E. Cross-cutting / architecture bets

1. **Replace the dual envelope (legacy + session-protocol) with one** — `legacyProtocol.ts` and `sessionProtocol.ts` coexist in `happy-wire`. Every new feature has to think about both. There's a `provider-envelope-redesign` plan in `docs/plans/`; following through would reduce ongoing cost.
2. **Clean up the "encrypted settings JSON" pattern** — `Account.settings` is a single encrypted blob that the app parses with partial-Zod-merge for forward/back compat. As that grows, granular settings sync would be cheaper than re-shipping the whole blob on every change. Possibly a CRDT or a per-key versioned field.
3. **Make the variability in launchers data-driven** — Many `if launcher === 'claude'` branches scattered around. A `Launcher` capability table (supports streaming? supports MCP? JSONL path? signal handling?) would absorb these into one place.
4. **Replace `module-level let currentSessionId` in voice routing** — Single source of truth, but mutable global. A scoped voice-session object owned by the React tree would survive hot-reload and hold up better when we eventually want concurrent voice sessions across tabs / windows.
5. **Test infrastructure for the CLI's encryption** — `encryption.ts` is critical, has no mocks, but tests are scattered. A dedicated round-trip test suite (encrypt → wire → decrypt for each variant in `docs/encryption.md`) would catch protocol drift before users do.

## F. Fork-specific QoL

1. **`pnpm fork:diff`** — Convenience script wrapping `git log upstream/main..HEAD --stat` so the divergence is one keystroke away.
2. **CI to keep the fork honest** — A scheduled GitHub Action that fetches upstream and posts a comment listing new upstream commits not yet rebased / merged.
3. **Pre-commit hook to lint `FORK_CHANGES.md`** — Block commits that change files outside the standard "no need to track" set without a corresponding `FORK_CHANGES.md` entry. Tactical, but cheap insurance.
4. **`happy upstream-status` CLI subcommand** — Dev-only; tells the user how far behind upstream the local fork is and which packages are most affected.

## G. Speculative / longer bets

1. **Local-first agent runs** — Today the encrypted blob round-trips through the server even for purely local use. A peer-to-peer mode (LAN-only Bonjour, or libp2p) would let phone↔CLI work without internet for users who care.
2. **Replay / branch sessions** — The session protocol already preserves enough information to fork a conversation at an arbitrary turn. Surfacing this as a UI affordance ("rewind", "branch from here") would be unique vs. raw `claude` / `codex`.
3. **Voice-driven multi-agent orchestration** — The `messageClaudeCode` tool currently routes to one session. With BYO agents and routing intelligence in the voice agent's prompt, you could have one voice front-end driving multiple coding-agent backends ("ask claude to do X while codex finishes Y").
4. **Agent-level analytics** — Time-on-task per session, tool-call mix, permission denial rate. Useful for any user trying to evaluate which agent (claude vs codex) is better for what.

## How to use this doc

- When picking up something here, copy the line into a working ticket and edit there. Don't expand entries in place — they should stay one-liner-to-paragraph hooks that survive between sessions.
- When something ships or gets explicitly rejected, mark it with ✅ or ❌ and a one-line postmortem so the next pass doesn't re-propose it.
- New ideas: prefer adding under the existing sections (A–G) and only create a new section when there's a clear new theme.
