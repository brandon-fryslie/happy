import { z } from 'zod';

/**
 * The published contract for the voice client tools: each tool name, and the exact
 * parameter schema that name accepts.
 *
 * Both facts are written down here and nowhere else. `realtimeClientTools` registers
 * these names against these schemas, and the BYO agent setup guide publishes the
 * signatures rendered below, so a rename or a parameter change reaches the dispatcher
 * and the agent-facing guide together or not at all. They drifted once already: the
 * guide advertised `messageClaudeCode(message)` against a dispatcher that only ever
 * answered to `sendMessageToSession(sessionId, message)`.
 */
// [LAW:one-source-of-truth] the SDK registration and the BYO guide are both derived from this
export const VOICE_TOOL_PARAMETERS = {
    sendMessageToSession: z.object({
        sessionId: z.string().min(1),
        message: z.string().min(1),
    }),
    processPermissionRequest: z.object({
        requestId: z.string().min(1),
        decision: z.enum(['allow', 'deny']),
    }),
} as const;

export type VoiceToolName = keyof typeof VOICE_TOOL_PARAMETERS;

/**
 * Render one parameter's type the way an ElevenLabs tool definition spells it.
 *
 * An unrepresentable schema throws instead of rendering a placeholder: a guide that
 * understates a parameter is how a BYO agent ships tool calls that never dispatch,
 * which is the exact failure this module exists to make unrepresentable.
 */
// [LAW:no-silent-failure] a parameter we cannot render is a guide that would lie about it
function renderParameterType(schema: z.ZodTypeAny): string {
    if (schema instanceof z.ZodString) {
        return 'string';
    }
    if (schema instanceof z.ZodEnum) {
        return schema.options.map((option: string) => `"${option}"`).join(' | ');
    }
    throw new Error(`voiceToolContract: no signature rendering for ${schema.constructor.name}`);
}

function renderSignature(name: string, parameters: z.ZodObject<z.ZodRawShape>): string {
    const rendered = Object.entries(parameters.shape)
        .map(([parameter, schema]) => `${parameter}: ${renderParameterType(schema)}`)
        .join(', ');
    return `${name}(${rendered})`;
}

/**
 * The tool signatures exactly as a BYO agent must declare them, one bullet per line,
 * ready to interpolate into the translated setup guide. Identifiers only — there is
 * nothing here for a translator to touch.
 */
export const VOICE_TOOL_SIGNATURES: string = Object.entries(VOICE_TOOL_PARAMETERS)
    .map(([name, parameters]) => `• ${renderSignature(name, parameters)}`)
    .join('\n');
