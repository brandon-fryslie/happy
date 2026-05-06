# Fork Changes — `brandon-fryslie/happy`

> **Keep this file current.** Any commit that diverges from upstream `slopus/happy` should be reflected here in the same change. New entries go at the top of the relevant section. Use `git log upstream/main..HEAD --stat` to audit drift.

Upstream remote: `https://github.com/slopus/happy.git` (`upstream`).
Fork remote: `git@github.com:brandon-fryslie/happy.git` (`origin`).

## Branches

- `main` — fork's mainline; tracks `origin/main`. Currently 5 commits ahead of `upstream/main`.
- `voice-byo-elevenlabs` — in-progress feature branch for BYO ElevenLabs API-key voice path (1 commit ahead of `main`).

## Merged-to-fork-`main` changes (vs `upstream/main`)

### Image paste in user messages (lit `brandon-image-input-7cx.1`)

End-to-end image input for Claude sessions. The user pastes a screenshot in the mobile/web app; the image attaches as a thumbnail chip alongside the in-progress text; on send, the message rides through the encrypted protocol as Anthropic-shaped image content blocks and reaches the Claude SDK's `query()` directly — no translation layer. Claude's response, the message history, and round-trips render the inline base64 in `<Image>` thumbnails on every connected client.

**Why this is fork-only for now:** the upstream wire schema (`@slopus/happy-wire`'s `UserMessageSchema`) is text-only — `content: { type: "text", text: string }`. Extending it requires bumping the CLI minimum version because old CLIs Zod-reject anything that isn't that exact shape. Upstream maintainers may want a different transport (encrypted-upload via the Artifact pattern) before accepting; this fork ships the pragmatic inline-base64 path first.

**Wire shape — same as Anthropic's `ContentBlockParam`:** `UserMessage.content` becomes a union of the legacy text object **or** `Array<TextBlock | ImageBlock>` where `ImageBlock = {type:'image', source:{type:'base64', media_type, data}}`. `claudeRemote.ts` no longer stringifies before pushing to the SDK — the wire shape *is* the SDK shape, so content arrays pass through unchanged.

**Transport choice:** inline base64 inside the existing encrypted message envelope. No new server endpoints. No S3 lifecycle. Claude API accepts inline base64 natively (cap ~5 MB / image; screenshots are typically under 1 MB). Encrypted upload via the Artifact pattern is the planned follow-up for >5 MB images (lit `brandon-image-input-7cx.3`).

**Compatibility:** new `MINIMUM_CLI_VERSION_FOR_IMAGES = '1.2.0'` in `packages/happy-app/sources/utils/versionUtils.ts`. The attach UI / paste capture in `SessionView.tsx` is gated on `isVersionSupported(cliVersion, MINIMUM_CLI_VERSION_FOR_IMAGES) && (flavor === undefined || flavor === 'claude')`. Older CLIs (or non-Claude agents) silently lose the paste UX rather than failing schema validation server-side. CLI bumped 1.1.8-1 → 1.2.0 in this change.

**Files touched:**
- `packages/happy-wire/src/legacyProtocol.ts` — extend `UserMessageSchema`, export `TextBlock` / `ImageBlock` / `ContentBlock`.
- `packages/happy-cli/src/api/types.ts` — mirror the wire schema; add `extractMessageText` / `getMessageContent` helpers.
- `packages/happy-cli/src/utils/MessageQueue2.ts` — `QueueMessage = string | ContentBlock[]`; `mergeQueueMessages` produces a unified array when any item is one, joins as string otherwise. `flattenQueueMessageToText` is the boundary helper for non-Claude agents.
- `packages/happy-cli/src/claude/claudeRemote.ts`, `claudeRemoteLauncher.ts` — `nextMessage` returns `string | ContentBlock[]`; SDK push site forwards content as-is.
- `packages/happy-cli/src/{codex,gemini,openclaw,agent/acp}/run*.ts` — flatten content arrays to text at the agent boundary (image blocks dropped for non-Claude agents until per-agent support lands).
- `packages/happy-app/sources/sync/sync.ts` — `sendMessage` accepts `images?: ImageAttachment[]`; builds the wire content array when present.
- `packages/happy-app/sources/sync/typesRaw.ts` + `reducer/reducer.ts` — schema accepts the union; reducer extracts text + image previews from either shape; `UserTextMessage` carries optional `images` for render.
- `packages/happy-app/sources/components/MultiTextInput.web.tsx` — DOM `paste` event handler; FileReader → base64 → `onPasteImages`.
- `packages/happy-app/sources/components/MultiTextInput.tsx` — iOS 16+ `TextInput.onPaste`; supports both raw-base64 items and `file://` URIs (read via `expo-file-system`).
- `packages/happy-app/sources/components/AgentInput.tsx` — thumbnail strip with X-to-remove; `attachments` / `onPasteImages` / `onAttachPress` props; send button activates with attachments alone.
- `packages/happy-app/sources/components/MessageView.tsx` — `UserTextBlock` renders attached images as `<Image>` tiles above the text bubble.
- `packages/happy-app/sources/-session/SessionView.tsx` — version-gated wiring of attachments state into AgentInput.
- All 10 translation files — `agentInput.attachImage` added.

**Why CLI bumped to 1.2.0:** old `UserMessageSchema` Zod-validates strictly against `{type:'text',text}`; an array trips the parse at `apiSession.routeIncomingMessage` and the message gets routed to `emit('message', ...)` instead of `pendingMessageCallback`. The bump lets the app detect compatible CLIs and show the paste UI only when it'll actually work.

**Out of scope (tracked under epic `brandon-image-input-7cx`):**
- Codex / Gemini image content (`.2`)
- Encrypted-upload path for large images (`.3`)
- Web/Tauri drag-and-drop (`.4`)
- Tool-result image rendering (`.5`)
- Voice-mode image input (`.6`)
- Native Android image-paste investigation (`.7`)

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
