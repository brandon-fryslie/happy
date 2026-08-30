import { describe, expect, it } from 'vitest';
import { VOICE_TOOL_PARAMETERS, VOICE_TOOL_SIGNATURES } from './voiceToolContract';

describe('voice tool contract', () => {
    it('publishes the signatures a BYO agent must declare', () => {
        // The contract a BYO agent is told to implement, spelled out once here so that
        // renaming a tool or changing a parameter cannot quietly leave the setup guide
        // describing tools the dispatcher does not answer to.
        expect(VOICE_TOOL_SIGNATURES).toBe([
            '• sendMessageToSession(sessionId: string, message: string)',
            '• processPermissionRequest(requestId: string, decision: "allow" | "deny")',
        ].join('\n'));
    });

    it('names every parameter it publishes in the schema it parses with', () => {
        Object.entries(VOICE_TOOL_PARAMETERS).forEach(([name, schema]) => {
            Object.keys(schema.shape).forEach((parameter) => {
                expect(VOICE_TOOL_SIGNATURES).toContain(`${parameter}:`);
            });
            expect(VOICE_TOOL_SIGNATURES).toContain(`${name}(`);
        });
    });

    it('rejects a call that omits the session it is meant to address', () => {
        // Not a defaulting-to-focused-session tool: an unaddressed message is an error,
        // never a message delivered somewhere plausible.
        expect(VOICE_TOOL_PARAMETERS.sendMessageToSession.safeParse({ message: 'hi' }).success).toBe(false);
        expect(VOICE_TOOL_PARAMETERS.processPermissionRequest.safeParse({ decision: 'allow' }).success).toBe(false);
    });
});
