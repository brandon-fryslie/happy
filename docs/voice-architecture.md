# Voice Architecture

How the ElevenLabs voice assistant integrates with the Happy app, routes messages to sessions, and manages context delivery.

## Components

```text
SessionView.tsx            UI — mic button, triggers voice start/stop
RealtimeSession.ts         Lifecycle — start/stop, token fetch, session routing state
RealtimeVoiceSession.tsx   Native ElevenLabs bridge (useConversation hook)
RealtimeVoiceSession.web.tsx  Web ElevenLabs bridge (same interface)
voiceHooks.ts              Context delivery — formats and routes app events to voice agent
contextFormatters.ts       Text formatters for session context, messages, permissions
realtimeClientTools.ts     Tool implementations the voice agent can invoke
voiceConfig.ts             Feature flags and constants
storage.ts                 Global state (realtimeStatus, realtimeMode)
types.ts                   Shared type definitions
```

## Session Routing

Tool calls are routed by the agent, not by the app: `sendMessageToSession` takes the target `sessionId` as a parameter, and `processPermissionRequest` finds the owning session by looking up its `requestId` in `storage`. The agent learns both ids from the context Happy injects — see [Voice Agent Tools](#voice-agent-tools).

A single module-level variable `currentSessionId` in `RealtimeSession.ts` tracks which session the user is looking at. Its one consumer is **focus dedup**: `voiceHooks.onSessionFocus()` compares against it to avoid re-injecting context for the already-focused session. When the user navigates to a different session while voice is active, `onSessionFocus` updates it and injects the new session's context, which is how the agent comes to know the newly focused session's id.

```text
User taps mic on Session A
  │
  v
startRealtimeSession("A")
  └──> currentSessionId = "A"

User navigates to Session B
  │
  v
sync.onSessionVisible("B")
  └──> voiceHooks.onSessionFocus("B")
         ├──> setCurrentRealtimeSessionId("B")
         └──> injects "Session became focused: B"

Voice agent calls sendMessageToSession({ sessionId: "B", message: ... })
```

## Voice Start

When the voice session starts, `onVoiceStarted(sessionId)` builds an initial prompt containing:

1. **Session directory** — one-liner per active session (id + summary), so the agent knows all available targets.
2. **Current session context** — full dump via `injectSessionContext(sessionId)`: session metadata, path, summary, and message history.

```text
onVoiceStarted("A")
  │
  ├──> formatSessionDirectory()
  │      → "Available sessions:\n- abc: "Refactor auth"\n- def: "Fix dark mode""
  │
  └──> injectSessionContext("A")
         → "# Session ID: abc\n# Project path: ...\n## History\n..."
```

## Context Delivery

App events are delivered to the voice agent through two channels with different semantics:

### sendContext() — silent background injection

Calls `voice.sendContextualUpdate()`. The agent receives the information but does **not** respond. Always sent immediately, never queued.

Used for: new messages, session focus changes, session online/offline, full session dumps.

### sendPrompt() — triggers agent response

Calls `voice.sendTextMessage()`. Acts as a user turn — the agent will respond. **Queued while anyone is speaking**, flushed as a single batch when mode transitions to `idle`.

Used for: permission requests, ready events (agent finished working).

### Batching

When the user or agent is speaking, prompts queue up in `pendingPrompts[]`. A zustand subscription on `realtimeMode` triggers `flushPendingPrompts()` when mode returns to `idle`, joining all queued prompts into a single `sendTextMessage` call.

```text
realtimeMode = 'agent-speaking'
  │
  ├── onReady("abc")        → sendPrompt() → queued
  ├── onPermission("abc")   → sendPrompt() → queued
  ├── onMessages("abc")     → sendContext() → sent immediately
  │
  v
realtimeMode → 'idle'
  │
  v
flushPendingPrompts()
  └──> voice.sendTextMessage(joined prompts)
```

### Session Context Injection

`injectSessionContext(sessionId)` is the shared code path for injecting full session context. It is used by both `onVoiceStarted` (to build the initial prompt string) and `onSessionFocus` (to send a contextual update). It tracks which sessions have already been shown via `shownSessions` to avoid redundant dumps.

## Realtime Mode

`realtimeMode` in storage tracks who is currently speaking:

| Mode | Meaning | Source |
|------|---------|--------|
| `idle` | Nobody is talking | Default / after speech ends |
| `agent-speaking` | ElevenLabs agent is producing audio | `onModeChange({ mode: 'speaking' })` |
| `user-speaking` | User mic VAD is above threshold | `onVadScore({ vadScore })` |

Priority: `agent-speaking` > `user-speaking` > `idle`. If both fire simultaneously, agent wins (user speech during agent output is likely crosstalk).

### VAD Detection

ElevenLabs provides `onVadScore({ vadScore: number })` — a continuous 0-1 signal for user microphone activity. We derive a binary state with debounce:

- `vadScore > VAD_THRESHOLD` (0.5) → `user-speaking`, reset silence timer
- `vadScore <= VAD_THRESHOLD` → start silence timer (`VAD_SILENCE_MS` = 300ms), transition to `idle` on timeout

Agent mode changes (`onModeChange`) take priority over VAD. When `onModeChange` reports `'speaking'`, we set `agent-speaking` regardless of VAD. When it reports `'listening'`, we defer to VAD state.

```text
ElevenLabs SDK
  │
  ├── onModeChange({ mode: 'speaking' })
  │     └──> realtimeMode = 'agent-speaking'
  │
  ├── onModeChange({ mode: 'listening' })
  │     └──> realtimeMode = (VAD active ? 'user-speaking' : 'idle')
  │
  └── onVadScore({ vadScore })
        └──> if agent not speaking:
               vadScore > 0.5 → 'user-speaking'
               vadScore ≤ 0.5 → debounce → 'idle'
```

## Voice Agent Tools

The tool names and their parameter schemas are declared once, in `voiceToolContract.ts`. `realtimeClientTools.ts` registers handlers against that declaration, and the BYO agent setup guide in Settings renders its published signatures from it, so the two cannot drift into describing different tools.

- **`sendMessageToSession(sessionId: string, message: string)`** — sends a text message to the named session via `sync.sendMessage(sessionId, message)`, along with any images queued in that session's composer.
- **`processPermissionRequest(requestId: string, decision: "allow" | "deny")`** — allows or denies a pending permission request. The owning session is found by scanning `storage` for the request, so the agent does not supply it.

Both ids are things the agent reads back out of the injected context rather than facts it holds: `contextFormatters.ts` puts session ids in the opening session directory (`- <id>: "<summary>"`), in `# Session ID:` headers, and in every focus/online/offline line, and wraps each permission request's id in `<request_id>` tags. A call that omits its id is rejected by the contract's schema rather than defaulted to the focused session — a message delivered to a plausible-but-wrong session is indistinguishable from success.

## Lifecycle

```text
App mounts RealtimeVoiceSession component
  └──> useConversation() hook initializes
  └──> registerVoiceSession(impl) — makes the instance available globally

User taps mic
  └──> voiceHooks.onVoiceStarted(sessionId) — builds initial prompt
  └──> startRealtimeSession(sessionId, prompt)
         ├──> fetchVoiceToken() — server-side gating (see plans/elevenlabs-voice-usage-gating.md)
         ├──> currentSessionId = sessionId
         └──> voiceSession.startSession({ token, initialContext, ... })

User taps mic again (or navigates away)
  └──> stopRealtimeSession()
         ├──> voiceSession.endSession()
         ├──> currentSessionId = null
         └──> voiceHooks.onVoiceStopped() — clears state
```

## Related

- `docs/plans/elevenlabs-voice-usage-gating.md` — usage gating and paywall flow for voice sessions.
