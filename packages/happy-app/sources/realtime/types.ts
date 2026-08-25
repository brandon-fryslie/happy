export interface VoiceSessionConfig {
    sessionId: string;
    initialContext?: string;
    systemPrompt?: string;
    firstMessage?: string;
    conversationToken?: string;
    agentId?: string;
    userId?: string;
    /**
     * LiveKit deployment this call's token was minted against. Required: a token
     * offered to the wrong SFU joins an empty room in silence rather than erroring,
     * so no caller gets to leave it to a default.
     */
    livekitUrl: string;
}

export interface VoiceSession {
    startSession(config: VoiceSessionConfig): Promise<string | null>;
    endSession(): Promise<void>;
    sendTextMessage(message: string): void;
    sendContextualUpdate(update: string): void;
}

export type ConversationStatus = 'disconnected' | 'connecting' | 'connected';
export type ConversationMode = 'idle' | 'agent-speaking' | 'user-speaking';
