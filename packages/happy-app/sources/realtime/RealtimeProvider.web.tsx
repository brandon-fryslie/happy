import React from 'react';
import { RealtimeVoiceSession } from './RealtimeVoiceSession';
import { useVoiceSessionGeneration } from '@/sync/storage';

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
    // Force RealtimeVoiceSession to remount between sessions, for the same
    // reason as native: @elevenlabs/client depends on livekit-client, and the
    // conversationToken we start with selects the WebRTC path — so there IS a
    // LiveKit Room here, and a Room can't be reused after disconnect. This
    // re-key is load-bearing, not defensive.
    //
    // It previously read "uses a plain WebSocket — no LiveKit Room to go stale".
    // That was false, and it cost an investigation: it sent the hunt for a dead
    // conversation_config_override to the server side of a wire that was working.
    const generation = useVoiceSessionGeneration();
    return (
        <>
            <RealtimeVoiceSession key={generation} />
            {children}
        </>
    );
};
