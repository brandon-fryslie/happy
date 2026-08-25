import { describe, expect, it } from "vitest";
import { BYO_CONVAI_API, ELEVENLABS_ORIGIN, meteredConvaiApi } from "./voiceProvider";

describe("meteredConvaiApi", () => {
    it("calls ElevenLabs when nothing points it elsewhere", () => {
        expect(meteredConvaiApi({})).toBe("https://api.elevenlabs.io/v1/convai");
    });

    it("calls the configured origin, keeping the ConvAI path this service speaks", () => {
        expect(meteredConvaiApi({ VOICE_CONVAI_ORIGIN: "https://openconv.sanctuary.gdn" }))
            .toBe("https://openconv.sanctuary.gdn/v1/convai");
    });

    it("survives a trailing slash rather than building a double-slashed URL", () => {
        expect(meteredConvaiApi({ VOICE_CONVAI_ORIGIN: "https://openconv.sanctuary.gdn//" }))
            .toBe("https://openconv.sanctuary.gdn/v1/convai");
    });

    it("reads an empty value as unconfigured — a Nomad template that resolved to nothing", () => {
        expect(meteredConvaiApi({ VOICE_CONVAI_ORIGIN: "" }))
            .toBe("https://api.elevenlabs.io/v1/convai");
    });
});

describe("BYO_CONVAI_API", () => {
    it("stays at ElevenLabs, because the key it presents is an ElevenLabs key", () => {
        expect(BYO_CONVAI_API).toBe(`${ELEVENLABS_ORIGIN}/v1/convai`);
        expect(BYO_CONVAI_API).toBe("https://api.elevenlabs.io/v1/convai");
    });
});
