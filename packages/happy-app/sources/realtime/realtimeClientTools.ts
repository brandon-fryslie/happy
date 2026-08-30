import { z } from 'zod';
import { sync } from '@/sync/sync';
import { takeAttachments } from '@/sync/attachmentQueue';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { trackVoicePermissionResponse } from '@/track';
import { getVoiceSession, isVoiceSessionStarted } from './RealtimeSession';
import { VOICE_TOOL_PARAMETERS, type VoiceToolName } from './voiceToolContract';
import {
    getVoiceMessageCount,
    incrementVoiceMessageCount,
} from '@/sync/persistence';

/**
 * One handler per name in the contract, each taking parameters already parsed against
 * that name's schema. The mapped type is what keeps the two in step: a handler with no
 * contract entry, or a contract entry with no handler, is a compile error.
 */
// [LAW:types-are-the-program] the registered tool set is the contract's key set, by construction
type VoiceToolHandlers = {
    [K in VoiceToolName]: (parameters: z.infer<(typeof VOICE_TOOL_PARAMETERS)[K]>) => Promise<string>;
};

const handlers: VoiceToolHandlers = {
    /**
     * Send a message to a specific Claude Code session. The agent reads the session id
     * out of the context Happy injects (the session directory, focus and status lines).
     */
    sendMessageToSession: async ({ sessionId, message }) => {
        console.log('📤 Sending message to session:', sessionId);
        // Images the user queued in the composer ride along with the dictated text.
        // Taking by sessionId is what keeps them from leaking: voice can address any
        // session, and only the queue belonging to the addressed one is consumed.
        await sync.sendMessage(sessionId, message, {
            source: 'voice',
            attachments: takeAttachments(sessionId),
        });
        incrementVoiceMessageCount();
        const voiceMessageCount = getVoiceMessageCount();
        if (isVoiceSessionStarted()) {
            getVoiceSession()?.sendContextualUpdate([
                '# Runtime counters updated',
                `- voice_message_count: ${voiceMessageCount}`,
            ].join('\n'));
        }
        return "sent [DO NOT say anything else, simply say 'sent']";
    },

    /**
     * Respond to a permission request from a Claude Code session. The agent reads the
     * request id out of the `<request_id>` tag Happy injects with the request.
     */
    processPermissionRequest: async ({ requestId, decision }) => {
        // Find which session owns this request
        const sessions = storage.getState().sessions;
        let sessionId: string | null = null;
        for (const [id, session] of Object.entries(sessions)) {
            if (session?.agentState?.requests?.[requestId]) {
                sessionId = id;
                break;
            }
        }

        if (!sessionId) {
            console.error('❌ No session found with request:', requestId);
            return "error (permission request not found)";
        }

        console.log('🔍 processPermissionRequest:', decision, 'for session:', sessionId, 'request:', requestId);

        try {
            if (decision === 'allow') {
                await sessionAllow(sessionId, requestId);
                trackVoicePermissionResponse(true);
            } else {
                await sessionDeny(sessionId, requestId);
                trackVoicePermissionResponse(false);
            }
            return "done [DO NOT say anything else, simply say 'done']";
        } catch (error) {
            console.error('❌ Failed to process permission:', error);
            return `error (failed to ${decision} permission)`;
        }
    },
};

/**
 * The one place tool arguments cross from the voice agent into the app, so the one
 * place they are parsed. Handlers receive the parsed value and never re-check it.
 */
// [LAW:parse-dont-validate] one checkpoint stamps the arguments; nothing inland asks again
function dispatch<K extends VoiceToolName>(name: K): (parameters: unknown) => Promise<string> {
    return async (parameters: unknown) => {
        const parsed = VOICE_TOOL_PARAMETERS[name].safeParse(parameters);
        if (!parsed.success) {
            console.error(`❌ Invalid parameters for ${name}:`, parsed.error);
            return `error (invalid parameters for ${name})`;
        }
        return handlers[name](parsed.data);
    };
}

/**
 * Static client tools for the realtime voice interface, name-keyed the way the
 * ElevenLabs SDK expects. These tools allow the voice assistant to interact with
 * Claude Code sessions.
 */
export const realtimeClientTools: Record<VoiceToolName, (parameters: unknown) => Promise<string>> =
    Object.fromEntries(
        (Object.keys(handlers) as VoiceToolName[]).map((name) => [name, dispatch(name)]),
    ) as Record<VoiceToolName, (parameters: unknown) => Promise<string>>;
