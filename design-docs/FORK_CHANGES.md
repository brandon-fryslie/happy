# Fork Changes — `brandon-fryslie/happy`

> **Keep this file current.** Any commit that diverges from upstream `slopus/happy` should be reflected here in the same change. New entries go at the top of the relevant section. Use `git log upstream/main..HEAD --stat` to audit drift.

Upstream remote: `https://github.com/slopus/happy.git` (`upstream`).
Fork remote: `git@github.com:brandon-fryslie/happy.git` (`origin`).

## Branches

- `main` — fork's mainline; tracks `origin/main`. Currently 5 commits ahead of `upstream/main`.
- `voice-byo-elevenlabs` — in-progress feature branch for BYO ElevenLabs API-key voice path (1 commit ahead of `main`).

## Merged-to-fork-`main` changes (vs `upstream/main`)

### Summarize-and-speak: on-device TTS for session messages (lit `brandon-tts-summarize-2yd`)

A new "Speak Sessions" feature in the mobile app that summarizes recent agent/user messages with a user-supplied OpenAI-compatible LLM and reads the summary aloud via the user's ElevenLabs API key. The defining architectural choice: **the feature is fully on-device**. The Happy server is normally blind to message content (E2E encrypted via libsodium); routing decrypted text through the server for LLM summarization would punch a hole in that invariant. React Native `fetch` calls have no CORS, so the app calls user-configured LLM and ElevenLabs endpoints directly with no backend involvement.

**Why upstream wouldn't do this as-is:** the natural place for "summarize a transcript" is a server-side endpoint that can choose a model, cache results, etc. — but doing so requires the server to read decrypted messages or trust client-supplied keys, both of which compromise the E2E story. This fork accepts the worse code-reuse story (no shared summarization service across web/desktop) in exchange for preserving the privacy invariant.

**Reuses an existing fork pattern:** the BYO `voiceCustomElevenLabsApiKey` (added in the `voice-byo-elevenlabs` work) is the canonical "user's ElevenLabs key" — TTS falls back to it when no TTS-specific key is set, so a user who already configured BYO voice doesn't have to re-paste anything.

**Flow:** SessionView mounts a single `useTtsPlayer(sessionId)` instance shared between the in-session control bar and the auto-mode watcher. Each play: read settings + messages from `storage.getState()` → slice by mode (`continue` / `from-last-user` / `restart`) → `POST {llmBaseUrl}/chat/completions` → `POST elevenlabs.io/v1/text-to-speech/{voiceId}/stream` → write mp3 to `expo-file-system` cache → play via `expo-audio` → on natural completion, advance the per-session position in MMKV. One `AsyncLock` serializes plays so auto-mode and manual taps can't race. `stop()` uses an abort token + externalized resolver to wake the playback `await` immediately.

**What this change does:**
- Settings schema: 7 new `tts*` fields in `packages/happy-app/sources/sync/settings.ts`; bumped `SUPPORTED_SCHEMA_VERSION` 2 → 3 (forward-compatible via the partial-Zod merge contract).
- Position tracking: `getTtsPosition` / `setTtsPosition` / `clearTtsPosition` in `persistence.ts` (key prefix `tts-position-{sessionId}`). Device-local; not synced.
- API clients: `sources/sync/llm/apiSummarize.ts` (OpenAI-compatible `/chat/completions`, normalizes trailing slashes, optional `Authorization` header for keyless local Ollama) and `sources/sync/llm/apiTts.ts` (`POST .../v1/text-to-speech/{voiceId}/stream`, `model_id: eleven_turbo_v2_5`, returns mp3 bytes). Both wrap fetch errors as `HappyError`.
- `useTtsPlayer` hook (`sources/hooks/useTtsPlayer.ts`) — single `AsyncLock`, single `AbortToken { aborted, wakeup }` per play; `play(mode)` is awaitable so callers can wrap with `useHappyAction` for `Modal` error surfacing.
- `useTtsAutoMode` hook (`sources/hooks/useTtsAutoMode.ts`) — debounced (1.5 s) and cooled-down (30 s) trigger; foreground-only; takes the same `TtsPlayer` as a parameter so it shares the lock with manual plays.
- TTS settings screen (`sources/app/(app)/settings/tts.tsx`), linked from `SettingsView`, registered in `(app)/_layout.tsx`.
- `TtsControlBar` component (`sources/components/TtsControlBar.tsx`) — speaker icon idle, spinner loading, stop while playing; long-press menu offers `Continue` / `From your last message` / `Restart from beginning`. Mounted alongside `VoiceAssistantStatusBar` in `SessionView.tsx`.
- 47 new translation keys (`settings.tts*`, `settingsTts.*`, `sessionTts.*`) in `_default.ts` and all 10 language files (en/ru/pl/es/ca/it/pt/ja/zh-Hans/zh-Hant). Brand names and literal IDs/URLs preserved verbatim.
- CHANGELOG version 10 entry; `changelog.json` regenerated.

**Files:** `packages/happy-app/sources/sync/settings.ts`, `packages/happy-app/sources/sync/settings.spec.ts`, `packages/happy-app/sources/sync/persistence.ts`, `packages/happy-app/sources/sync/llm/apiSummarize.ts`, `packages/happy-app/sources/sync/llm/apiTts.ts`, `packages/happy-app/sources/hooks/useTtsPlayer.ts`, `packages/happy-app/sources/hooks/useTtsAutoMode.ts`, `packages/happy-app/sources/app/(app)/settings/tts.tsx`, `packages/happy-app/sources/app/(app)/_layout.tsx`, `packages/happy-app/sources/components/TtsControlBar.tsx`, `packages/happy-app/sources/components/SettingsView.tsx`, `packages/happy-app/sources/-session/SessionView.tsx`, `packages/happy-app/sources/text/_default.ts`, `packages/happy-app/sources/text/translations/{en,ru,pl,es,ca,it,pt,ja,zh-Hans,zh-Hant}.ts`, `CHANGELOG.md`, `packages/happy-app/sources/changelog/changelog.json`.

### `docs: track CLAUDE.md` — un-ignore root developer guide
Upstream's `.gitignore` excludes `CLAUDE.md` (treated as per-developer scratch). This fork tracks it as the canonical onboarding doc for future Claude Code sessions. The line was removed from `.gitignore`; `CLAUDE.local.md` and `.claude/CLAUDE.md` remain ignored.

**Files:** `.gitignore`, `CLAUDE.md`, `design-docs/FORK_CHANGES.md`, `design-docs/BRAINSTORM_INITIAL.md`.


### `efeb78df` — `chore(happy-app): patch RN LogBox for copyable errors`
Dev-only React Native patches so error text from LogBox can be copied off-device. Adds `selectable=true` on the message body and code frame, a "Copy" button in the expanded inspector, and a "Copy" pill on the minimized notification bar. Patches are mutation-style `.cjs` scripts in `patches/` registered via `scripts/postinstall.cjs` (matches the project's existing patch convention rather than `patch-package` `.patch` files). Each patch validates its markers and fails loudly if RN's LogBox internals shift on SDK upgrade.

**Files:** `.mcp.json`, `patches/logbox-copy-button.cjs`, `patches/logbox-notification-copy-button.cjs`, `patches/logbox-notification-copy-feedback.cjs`, `patches/logbox-selectable-text.cjs`, `scripts/postinstall.cjs`.

### `2a899e1b` — `fix(cli): kill spawned claude binary when launcher exits`
The binary branch of `runClaudeCli` spawned `claude` with `stdio:'inherit'` but installed no parent→child signal handlers and no parent-death detection. When the launcher died (terminal close, OOM, `kill -TERM`), the orphaned `claude` was reparented to PID 1 and stayed in the TTY's foreground process group — the next `happy` session in the same pane saw "two cursors" / characters race-distributed between processes. Fix: install SIGINT/SIGTERM/SIGHUP/SIGQUIT forwarders, an exit handler that `SIGTERM`s the child, and a 1 Hz `ppid` watcher (unref'd) that fires when the launcher itself gets reparented. Verified locally with a synthetic launcher.

**Files:** `packages/happy-cli/scripts/claude_version_utils.cjs`.

### `8c3fa93f` — `chore: add cherry-chrome-mcp server to project MCP config`
Wires the `cherry-chrome-mcp` server into the project's `.mcp.json` so Claude Code instances opened in this repo can drive a Chrome browser for visual verification of UI work.

**Files:** `.mcp.json`.

### `717db9d8` — `refactor(happy-cli): drop conditional Co-Authored-By system prompt logic`
Co-author credits are no longer injected via the system prompt; the user's global commit guidance handles attribution. Collapses `systemPrompt` to the base prompt only.

**Files:** `packages/happy-cli/src/claude/utils/systemPrompt.ts`.

### `c9aeb2bc` — `chore(happy-app): allow env-driven overrides for app name, bundle ID, Apple team ID`
Adds `APP_DISPLAY_NAME`, `IOS_BUNDLE_ID`, and `IOS_APPLE_TEAM_ID` env vars so local builds can use a personal identity (e.g. `com.brandonfryslie.happy.dev` + a personal Apple team) without editing shared `app.config.js` defaults.

**Files:** `packages/happy-app/app.config.js`.

## In-progress (branch `voice-byo-elevenlabs`)

### `3f56920a` (+ uncommitted working tree) — BYO ElevenLabs API key + custom endpoint for voice
Replaces the broken upstream "Direct Connection" voice bypass — which only worked with public ElevenLabs agents because the SDK fetched conversation tokens unauthenticated — with a server-mediated mint using the user's own API key.

**Why it was broken upstream:** when `voiceBypassToken && voiceCustomAgentId` were both set, `RealtimeSession.ts` skipped the Happy server entirely and let `@elevenlabs/react-native` GET `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=…` with no auth header. ElevenLabs returns *"Neither authorization header nor xi-api-key received"* for any private (auth-required) agent. Making the agent public to work around it lets anyone on the internet burn the user's ElevenLabs credits and exposes the system prompt — not viable beyond local prototypes.

**What this change does:**
- New setting `voiceCustomElevenLabsApiKey` in `packages/happy-app/sources/sync/settings.ts` (nullable, sync-safe via the partial-Zod merge contract).
- New schemas `VoiceByoTokenRequestSchema` / `VoiceByoTokenResponseSchema` in `packages/happy-wire/src/voice.ts`.
- New authenticated route `POST /v1/voice/byo-token` in `packages/happy-server/sources/app/api/routes/voiceRoutes.ts` that takes `{agentId, apiKey}` from the user, forwards to ElevenLabs with `xi-api-key`, parses `conversation_id` from the JWT, returns the same `{conversationToken, conversationId, agentId}` shape as the gated path. The API key is never logged or stored server-side.
- New client helper `fetchByoVoiceToken()` in `packages/happy-app/sources/sync/apiVoice.ts`.
- `RealtimeSession.ts` BYO branch now mints via the server route and passes a real `conversationToken` to `voiceSession.startSession` — collapses both code paths to "always pass a token" (dataflow-pure shape). Alerts the user when bypass is on but credentials are missing instead of silently falling through to slopus's default agent.
- New "ElevenLabs API Key" prompt in voice settings UI; subtitle hides the key value.
- Translation keys `errors.voiceByoCredentialsMissing` and 5 `settingsVoice.customElevenLabsApiKey*` keys added to all 10 language files (English placeholder strings — flag for `i18n-translator` later).

**Files:** `packages/happy-wire/src/voice.ts`, `packages/happy-server/sources/app/api/routes/voiceRoutes.ts`, `packages/happy-app/sources/sync/settings.ts`, `packages/happy-app/sources/sync/apiVoice.ts`, `packages/happy-app/sources/realtime/RealtimeSession.ts`, `packages/happy-app/sources/app/(app)/settings/voice.tsx`, `packages/happy-app/sources/text/_default.ts`, `packages/happy-app/sources/text/translations/{en,ru,pl,es,it,pt,ca,zh-Hans,zh-Hant,ja}.ts`.

## Conventions for entries

Each entry should answer:
1. **What changed** (file-level summary, not a re-statement of the commit message).
2. **Why** the upstream behavior was insufficient — so a future reader can decide whether the patch is still load-bearing or whether upstream has caught up.
3. **What files** were touched (not a full diff — just the surface area).

Group entries under the branch they live on. When a feature branch merges into `main`, move its entries up into the merged section and drop the branch heading if the branch is deleted.
