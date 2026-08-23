/**
 * Type definitions for Claude Code SDK integration
 * Re-exports from official @anthropic-ai/claude-agent-sdk with adapter types
 */

// Re-export message types from official SDK
export type {
    SDKMessage,
    SDKUserMessage,
    SDKAssistantMessage,
    SDKSystemMessage,
    SDKResultMessage,
    PermissionResult,
    CanUseTool,
} from '@anthropic-ai/claude-agent-sdk'

// Re-export AbortError class
export { AbortError } from '@anthropic-ai/claude-agent-sdk'

// Alias for backward compatibility
import type { CanUseTool, EffortLevel } from '@anthropic-ai/claude-agent-sdk'
export type CanCallToolCallback = CanUseTool

/**
 * The Claude effort ladder, ordered shallowest to deepest.
 *
 * [LAW:one-source-of-truth] This array is the only place the ladder is written
 * down in the CLI. The type, the wire-boundary guard, and the SDK option all
 * derive from it, so a level cannot be added to some of them and missed by the
 * rest — the failure that kept `xhigh` unreachable through four transcriptions.
 */
export const CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[]

export type ClaudeEffort = typeof CLAUDE_EFFORT_LEVELS[number]

/**
 * [LAW:types-are-the-program] Proof that the ladder above still covers the SDK's
 * own union. The `satisfies` on the array catches a level the SDK dropped; this
 * catches one the SDK added — together they make an upstream change a build
 * failure here rather than a level users silently cannot select.
 */
type SdkEffortLevelsCovered = EffortLevel extends ClaudeEffort ? true : never
const _sdkEffortLevelsCovered: SdkEffortLevelsCovered = true

/**
 * The single parse boundary for effort arriving off the wire, where it is an
 * untyped value from a client that may be older or newer than this CLI.
 * [LAW:parse-dont-validate] Narrowing here is what lets every caller downstream
 * hold a `ClaudeEffort` instead of a cast.
 */
export function isClaudeEffort(value: unknown): value is ClaudeEffort {
    return typeof value === 'string' && (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value)
}

/**
 * Adapter type for query options.
 * Maps to official SDK's Options type but preserves existing field names
 * used throughout the codebase. The query() wrapper handles the translation.
 */
export interface QueryOptions {
    abort?: AbortSignal
    allowedTools?: string[]
    appendSystemPrompt?: string
    customSystemPrompt?: string
    cwd?: string
    disallowedTools?: string[]
    maxTurns?: number
    mcpServers?: Record<string, unknown>
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
    continue?: boolean
    resume?: string
    model?: string
    fallbackModel?: string
    strictMcpConfig?: boolean
    canCallTool?: CanCallToolCallback
    /** Path to a settings JSON file to pass to Claude via --settings */
    settingsPath?: string
    /**
     * Effort level passed straight through to the Claude Agent SDK option
     * of the same name — controls how much thinking/reasoning Claude
     * applies on each turn. See CLAUDE_EFFORT_LEVELS for the ladder.
     */
    effort?: ClaudeEffort
}

/**
 * Query prompt types
 */
import type { SDKMessage as _SDKMessage } from '@anthropic-ai/claude-agent-sdk'
export type QueryPrompt = string | AsyncIterable<_SDKMessage>
