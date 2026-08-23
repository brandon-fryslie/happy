# Open-Source Voice Replacement

Replace the ElevenLabs Conversational AI and TTS services with a self-hosted, API-compatible open-source alternative. Happy changes only URLs — no functionality changes, no SDK forks.

## Status

Spec only — nothing implemented as of 2026-08-23. The server still calls `api.elevenlabs.io` (`voiceRoutes.ts`) and the app still calls it for TTS (`apiTts.ts`). No tracking ticket filed.

## What ElevenLabs provides today

Happy uses two distinct ElevenLabs products:

**Conversational AI (ConvAI)** — a real-time, bidirectional voice agent. The user speaks into the mic, the system transcribes speech, runs it through an LLM with tool-calling, synthesizes the response as audio, and streams it back — all in real time over WebRTC (native) or WebSocket (web). The agent can invoke client-side tools (`sendMessageToSession`, `processPermissionRequest`) and receives runtime context injections and system prompt overrides.

**Text-to-Speech (TTS)** — a simple REST endpoint. The app sends text, gets back an mp3 buffer. Used independently of the voice agent for reading session summaries aloud.

The replacement service must implement both.

## Current integration surface

### Three layers of contact

1. **Happy server → ElevenLabs REST API** (server-side, `voiceRoutes.ts`). The server mints conversation tokens, queries usage history.

2. **ElevenLabs client SDKs → ElevenLabs infrastructure** (client-side). The `@elevenlabs/react-native` and `@elevenlabs/react` SDKs connect to ElevenLabs' LiveKit server (native) or WebSocket endpoint (web) to stream bidirectional audio.

3. **Happy app → ElevenLabs TTS REST API** (client-side, `apiTts.ts`). Direct HTTP call for one-shot speech synthesis.

### SDK configurability (no fork needed)

Every URL the ElevenLabs SDKs use is overridable:

| URL | Default | Override option |
|---|---|---|
| LiveKit WebRTC (web) | `wss://livekit.rtc.elevenlabs.io` | `livekitUrl` on `SessionConfig` — the knob Happy's web client actually needs |
| WebSocket signaling (web, unused by Happy) | `wss://api.elevenlabs.io` | `origin` on `SessionConfig` |
| LiveKit WebRTC (native) | `wss://livekit.rtc.elevenlabs.io` | `serverUrl` on `useConversation` / `ElevenLabsProvider` |
| Token fetch (if SDK mints its own) | `https://api.elevenlabs.io/v1/convai/conversation/token` | `tokenFetchUrl`; **bypassed entirely** when `conversationToken` is supplied (Happy already does this) |

Happy already supplies `conversationToken` directly (minted server-side), so the SDK never calls ElevenLabs' token endpoint itself. The only SDK-level URL that matters at runtime is the **LiveKit/WebSocket server** it connects to for audio transport.

## API surface to replicate

### 1. ConvAI REST API (consumed by Happy server)

#### `GET /v1/convai/conversation/token`

Mints a short-lived conversation token (LiveKit JWT) that the client SDK uses to join a WebRTC room.

```
GET /v1/convai/conversation/token?agent_id={agentId}&participant_name={userId}
Headers: xi-api-key: {apiKey}

Response 200:
{ "token": "<LiveKit JWT>" }
```

The JWT payload must contain:
- `video.room` — a room name containing a conversation ID matching the pattern `conv_[a-zA-Z0-9]+`
- Standard LiveKit claims (identity, room permissions, server URL)

The replacement service creates a LiveKit room, spawns the voice agent into it, mints a participant token, and returns it.

#### `GET /v1/convai/conversations`

Lists past conversations for usage tracking.

```
GET /v1/convai/conversations?user_id={userId}&created_after={ISO8601}&page_size=100
Headers: xi-api-key: {apiKey}

Response 200:
{
  "conversations": [
    { "call_duration_secs": 42 },
    { "call_duration_secs": 180 },
    ...
  ]
}
```

Happy sums `call_duration_secs` to compute total usage. The replacement service must persist conversation records with duration tracking.

### 2. LiveKit-compatible real-time transport (consumed by client SDKs)

The native SDK (`@elevenlabs/react-native`) connects directly to a LiveKit server using the `serverUrl` and the JWT from step 1. The replacement must run a LiveKit server that:

- Accepts the JWT minted by the token endpoint
- Hosts rooms where the voice agent and the client participate
- Supports standard LiveKit audio tracks (the SDK publishes a mic track, the agent publishes a response track)

### 3. WebSocket signaling protocol (consumed by web SDK) — not used by Happy

**Verified 2026-08-23** against the installed `@elevenlabs/client` (`dist/lib.modern.js`): the transport resolves as `config.connectionType ?? (config.conversationToken ? "webrtc" : "websocket")`. Both of Happy's web paths — gated and BYO — pass a `conversationToken` (`RealtimeSession.ts`), so the web SDK already runs over LiveKit WebRTC, the same transport as native. The protocol below applies only to public-agent sessions started with a bare `agentId`, which no live Happy path does. Kept as reference in case such a path is added.

The web SDK (`@elevenlabs/react`) connects via WebSocket to `{origin}/v1/convai/conversation?agent_id={agentId}`. This is the signaling layer that wraps the audio exchange for web clients (where raw LiveKit WebRTC may not be used).

The WebSocket protocol must support:
- **Authentication** — via subprotocol `bearer.<token>` or via `conversationToken` in the initial message
- **Bidirectional audio** — the client sends PCM audio frames; the server sends synthesized audio frames
- **Agent mode changes** — server sends events that map to `onModeChange({ mode: 'speaking' | 'listening' })`
- **VAD scores** — server sends continuous `vadScore` (0.0–1.0) events consumed by the client's `onVadScore` callback
- **Text messages** — `sendUserMessage(text)` and `sendContextualUpdate(text)` from client to agent
- **Client tool invocations** — server sends tool-call requests; client executes and returns results
- **Dynamic variables** — `sessionId`, `initialConversationContext` passed at session start
- **Agent overrides** — `prompt`, `firstMessage`, `language` overrides at session start
- **Session lifecycle** — connect/disconnect events, conversation ID assignment

This protocol is **the most significant reverse-engineering task**. The ElevenLabs web SDK source (in `node_modules/@elevenlabs/client`) is minified but readable, and the protocol messages can be captured with a WebSocket inspector during a live session. The replacement must speak this exact protocol, since the unmodified `@elevenlabs/react` SDK is the client.

### 4. TTS REST API (consumed by Happy app directly)

```
POST /v1/text-to-speech/{voiceId}/stream
Headers:
  xi-api-key: {apiKey}
  Content-Type: application/json
  Accept: audio/mpeg

Body:
{
  "text": "Hello, world",
  "model_id": "eleven_turbo_v2_5",
  "output_format": "mp3_44100_128"
}

Response 200: audio/mpeg binary stream
```

The replacement must accept the same request shape and return an mp3 audio buffer. The `voiceId` and `model_id` parameters map to whatever voice/model the open-source TTS engine exposes — the replacement can define its own voice catalog as long as IDs are stable.

## The agent pipeline

Inside a voice conversation, the replacement service runs a pipeline that processes each turn:

```
User speaks
    ↓
VAD (voice activity detection) → emits vadScore events to client
    ↓
STT (speech-to-text) → transcribes audio to text
    ↓
LLM (language model) → generates response, may invoke client tools
    ↓
TTS (text-to-speech) → synthesizes response audio
    ↓
Audio streamed back to user
```

### Pipeline requirements

**VAD**: Must emit continuous scores (0.0–1.0) at a rate the client can use for real-time user-speaking detection. The client applies a 0.5 threshold with 300ms debounce.

**STT**: Must handle streaming audio input and produce incremental transcriptions with low enough latency for conversational turn-taking. The system prompt and conversation context are text — only the user's spoken input needs transcription.

**LLM**: Must support:
- System prompt injection (the voice system prompt from `voiceSystemPrompt.ts`)
- Dynamic variables (`sessionId`, `initialConversationContext`)
- First-message override (agent speaks first on session start)
- Language selection (the agent speaks in the user's preferred language)
- Client tool calling — the agent can invoke `sendMessageToSession` and `processPermissionRequest`, which execute on the client and return results
- Contextual updates — silent context injections that inform the agent without triggering a response (new messages, session focus changes, agent status updates)
- Text messages — user text messages that do trigger a response (queued prompt flushes)

**TTS**: Must produce audio with low enough latency for conversational flow. The current ElevenLabs system streams audio token-by-token as the LLM generates, so the user hears the response start before the full text is generated. The replacement should do the same.

**Tool calling protocol**: The agent declares available tools. When it wants to invoke one, it sends a tool-call message over the signaling channel. The client SDK dispatches to the registered `clientTools` handler, executes it, and returns the result. The two tools currently registered:

- `sendMessageToSession({ sessionId: string, message: string })` → returns `"sent"`
- `processPermissionRequest({ requestId: string, decision: 'allow' | 'deny' })` → returns `"done"`

## Components to build

### 1. LiveKit server

**What**: An open-source LiveKit server instance for WebRTC media transport.

**Technology**: [LiveKit](https://github.com/livekit/livekit) (Go, Apache 2.0). Self-hostable, single binary. Handles room management, participant connections, audio/video track routing, and JWT-based auth.

**Work**: Deploy and configure. Generate signing keys. No custom code — LiveKit is a turnkey server.

### 2. Voice agent (the core)

**What**: A process that joins each LiveKit room as a participant, receives the user's audio, runs the STT → LLM → TTS pipeline, and publishes response audio back to the room. Also manages the signaling protocol for tool calls, VAD scores, mode changes, and context updates.

**Technology**: [LiveKit Agents](https://github.com/livekit/agents) (Python, Apache 2.0). This is LiveKit's framework for building exactly this kind of voice agent. It provides:
- `VoicePipelineAgent` — orchestrates VAD + STT + LLM + TTS with automatic turn detection, interruption handling, and streaming TTS
- Plugin ecosystem for STT (Whisper, Deepgram, AssemblyAI), LLM (OpenAI-compatible, Anthropic, local), and TTS (Cartesia, Piper, Coqui, ElevenLabs, OpenAI)
- Built-in function/tool calling support
- Automatic room joining via webhook dispatch

**Work**: Build an agent using `VoicePipelineAgent` that:
- Accepts the system prompt, dynamic variables, first message, and language from session metadata (set when the room is created or passed via room metadata)
- Registers the two client tools and relays invocations over the LiveKit data channel
- Handles `sendContextualUpdate` and `sendUserMessage` text messages from the client
- Emits mode-change and VAD-score events in the format the ElevenLabs SDK expects

### 3. WebSocket signaling gateway (for web clients) — not required

**What**: A WebSocket server at `/v1/convai/conversation` that speaks the ElevenLabs web signaling protocol, translating between the web SDK's WebSocket frames and the LiveKit room.

**Technology**: A Node.js or Python service. Acts as a bridge: the web SDK connects via WebSocket; the gateway joins the LiveKit room on the web client's behalf, proxying audio and signaling.

**Work**: None, as long as web clients keep receiving a `conversationToken` — the SDK then picks WebRTC and never opens the signaling WebSocket. If a token-less public-agent path is ever added, this gateway becomes necessary and the protocol has to be captured:

1. **Capture the protocol**: Run a live ElevenLabs web session with WebSocket inspection (Chrome DevTools → Network → WS). Document every message type, direction, and payload shape.
2. **Implement the gateway**: Translate each ElevenLabs WebSocket message type to/from the LiveKit room's data channels and audio tracks.
3. **Alternative**: If the protocol is too complex to replicate faithfully, fork `@elevenlabs/react` (~4 files, ~500 lines) to use LiveKit's web SDK directly instead of the custom WebSocket protocol. This is a fallback — the user's preference is no client changes.

### 4. REST API server

**What**: An HTTP server implementing the four endpoints described in "API surface to replicate."

**Technology**: Any HTTP framework (Fastify, Express, FastAPI). Thin layer over LiveKit's server SDK (for token minting) and a small database (for conversation history/duration tracking).

**Work**:
- **Token endpoint**: Use LiveKit's server SDK to create a room, set room metadata (agent config, system prompt, user ID), and mint a participant JWT. The JWT must encode the room name as `conv_{id}` so Happy server's regex extraction works.
- **Conversations endpoint**: Store conversation records (user ID, start time, duration) in a database. Return them filtered by `user_id` and `created_after` with `call_duration_secs`.
- **TTS endpoint**: Accept text + voice ID + model ID, run the TTS engine, return mp3 audio. Can share the same TTS engine used by the voice agent pipeline.
- **Auth**: Accept `xi-api-key` header for authentication (or simplify to a shared secret, since Happy server is the only caller).

### 5. TTS engine (shared by agent pipeline and REST endpoint)

**What**: An open-source text-to-speech engine that produces natural-sounding speech with low latency.

**Options** (ranked by quality/latency tradeoff):

| Engine | License | Quality | Latency | Notes |
|---|---|---|---|---|
| [Piper](https://github.com/rhasspy/piper) | MIT | Good | Very low (~50ms) | C++, ONNX models, many voices, best latency |
| [Coqui TTS / XTTS](https://github.com/coqui-ai/TTS) | MPL 2.0 | Excellent | Medium (~200-500ms) | Python, voice cloning, multilingual |
| [Bark](https://github.com/suno-ai/bark) | MIT | Excellent | High (~2-5s) | Great quality, too slow for real-time conversation |
| [StyleTTS 2](https://github.com/yl4579/StyleTTS2) | MIT | Excellent | Medium | Human-level quality on benchmarks |
| [OpenAI-compatible TTS](https://platform.openai.com/docs/guides/text-to-speech) | N/A (API) | Excellent | Low | Not open source, but the LiveKit Agents plugin ecosystem supports it as a fallback |

For the real-time agent pipeline, **Piper** or **Coqui XTTS** are the practical choices. Piper for speed, Coqui for quality and multilingual support. The REST TTS endpoint can use the same engine.

### 6. STT engine

**Options**:

| Engine | License | Quality | Latency | Notes |
|---|---|---|---|---|
| [Whisper](https://github.com/openai/whisper) | MIT | Excellent | Medium | The standard; `faster-whisper` (CTranslate2) for speed |
| [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) | MIT | Excellent | Low | C++ port, runs on CPU efficiently |
| [Vosk](https://github.com/alphacep/vosk-api) | Apache 2.0 | Good | Very low | Lightweight, good for streaming |
| [Deepgram Nova](https://deepgram.com/) | N/A (API) | Excellent | Very low | Not open source, but best streaming latency |

LiveKit Agents has built-in plugins for Whisper (via `faster-whisper`), Deepgram, and others. For fully self-hosted, **faster-whisper** is the standard choice.

### 7. VAD engine

LiveKit Agents includes **Silero VAD** by default — a small, fast neural VAD model (MIT license). It produces the same kind of continuous activity scores the ElevenLabs SDK expects. No additional work needed beyond configuration.

## What changes in Happy

All changes are URL-only. No functionality changes, no SDK forks.

### Happy server (`voiceRoutes.ts`)

```diff
- const ELEVEN_LABS_API = "https://api.elevenlabs.io/v1/convai";
+ const ELEVEN_LABS_API = "https://voice.your-domain.com/v1/convai";
```

The `xi-api-key` header and all request/response shapes stay identical. If the replacement service doesn't need per-user API keys (since you control it), the auth header can accept a shared secret in the same `xi-api-key` field.

### Happy app — SDK configuration (`RealtimeVoiceSession.tsx` / `.web.tsx`)

Pass the replacement server URLs when starting sessions:

```typescript
// Native: pass serverUrl to ElevenLabsProvider or useConversation
serverUrl: 'wss://livekit.your-domain.com'

// Web: pass livekitUrl to useConversation / startSession (WebRTC transport)
livekitUrl: 'wss://livekit.your-domain.com'
```

Both are typed options on the installed SDKs: `serverUrl` on `ElevenLabsProvider`/`useConversation` in `@elevenlabs/react-native`, `livekitUrl` on `SessionConfig` in `@elevenlabs/client`. They can be passed in the `useConversation()` config or in the `startSession()` options.

### Happy app — TTS client (`apiTts.ts`)

```diff
- const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
+ const ELEVENLABS_BASE = 'https://voice.your-domain.com';
```

### Configuration approach

All three URLs should come from a single environment variable or app config value (e.g., `VOICE_SERVICE_URL`) rather than being hardcoded, so switching between ElevenLabs and the self-hosted service is a config change.

## What stays the same in Happy

- The `@elevenlabs/react-native` and `@elevenlabs/react` SDK packages remain as dependencies (they're just LiveKit/WebSocket clients with a convenience API)
- All voice UI components (`VoiceAssistantStatusBar`, `VoiceBars`, `AgentInput` mic button)
- The voice lifecycle (`RealtimeSession.ts` — start/stop/register)
- Client tools (`realtimeClientTools.ts`)
- Voice hooks and context formatters
- System prompt construction
- Usage gating logic on the server (it just queries the replacement API instead of ElevenLabs)
- The BYO path can be removed or repurposed (no longer needed when you own the service)

## Deployment topology

```
Happy App (native/web)
    │
    ├── WebRTC ──→ LiveKit Server (wss://livekit.your-domain.com)
    │                    ↕
    │              Voice Agent (LiveKit Agents, Python)
    │                ├── STT: faster-whisper
    │                ├── LLM: Claude API / OpenAI-compatible
    │                ├── TTS: Piper or Coqui XTTS
    │                └── VAD: Silero
    │
    └── WebSocket ──→ WS Gateway (wss://voice.your-domain.com/v1/convai/conversation)
                         ↕
                    LiveKit Server (same instance)

Happy Server
    │
    └── HTTP ──→ REST API Server (https://voice.your-domain.com)
                    ├── /v1/convai/conversation/token  (mints LiveKit JWTs)
                    ├── /v1/convai/conversations        (usage history from DB)
                    └── /v1/text-to-speech/{voiceId}/stream (TTS)
```

The LiveKit server, voice agent, WS gateway, and REST API can all run on a single machine for a small deployment. The LLM is the only component that likely stays external (Claude API or similar) unless you run a local model.

## Open questions to resolve during implementation

**1. WebSocket signaling protocol fidelity — resolved 2026-08-23.** Happy's web clients connect over LiveKit WebRTC, not the proprietary WebSocket protocol, because both web paths supply a `conversationToken`. Web and native therefore need the same thing: a LiveKit server plus an agent in the room. The WebSocket protocol only becomes relevant if a token-less public-agent path is added.

**2. Client tool invocation mechanism.** LiveKit Agents supports function calling, but the tool invocation messages must arrive in the exact format the ElevenLabs SDK's `clientTools` dispatch expects. This needs protocol-level testing: start a session, trigger a tool call, inspect the message format.

**3. VAD score delivery format.** The ElevenLabs SDK calls `onVadScore({ vadScore: number })`. The replacement must deliver scores in this exact shape. LiveKit Agents' Silero VAD produces scores internally — the question is how they're surfaced to the client. On native (LiveKit WebRTC), this may require a custom data channel message. On web (WebSocket), it's part of the signaling protocol.

**4. Agent-side "mode" events.** The SDK calls `onModeChange({ mode: 'speaking' | 'listening' })`. The replacement agent must emit these at the right moments (when TTS audio starts/stops playing on the client). LiveKit Agents tracks agent speaking state internally, but the delivery mechanism to the client SDK needs verification.

**5. Voice/model ID mapping.** The TTS REST endpoint accepts a `voiceId` and `model_id`. The replacement defines its own voice catalog. Happy's settings UI (`tts.tsx`) lets users enter a voice ID — this needs to map to whatever voices the replacement engine offers. The default voice ID in Happy is `21m00Tcm4TlvDq8ikWAM` (ElevenLabs "Rachel") — the replacement needs a default that this maps to.

**6. Multilingual support.** The voice agent receives a `language` override (e.g., `en`, `ja`, `es`). The STT engine must handle the corresponding language, and the TTS engine must have voices for it. Piper has models for many languages; Coqui XTTS is inherently multilingual. The LLM handles language natively.

**7. GPU requirements.** Real-time STT (faster-whisper) and high-quality TTS (Coqui XTTS) benefit significantly from GPU acceleration. Piper runs well on CPU. The deployment hardware choice depends on which engines are selected and what latency is acceptable.
