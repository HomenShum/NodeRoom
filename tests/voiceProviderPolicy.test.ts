import { describe, expect, it } from "vitest";
import type { Actor } from "../src/engine/types";
import {
  FallbackTextToSpeechAdapter,
  createVoiceTextToSpeechAdapter,
  isVoiceClientFreeOnly,
  resolveVoiceClientSttProviderOrder,
  resolveVoiceClientTtsProviderOrder,
  type TextToSpeechAdapter,
  type VoiceNarrationUtterance,
} from "../src/voice";

const actor: Actor = { kind: "user", id: "u1", name: "Maya" };
const requester = { actor, token: "test-token-with-sufficient-entropy-1234567890" };

describe("voice client provider policy", () => {
  it("maps free-provider names onto the client adapters without duplicates", () => {
    expect(resolveVoiceClientSttProviderOrder({ VITE_VOICE_STT_PROVIDER_ORDER: "nvidia,browser,openai" })).toEqual(["provider", "browser"]);
    expect(resolveVoiceClientTtsProviderOrder({ VITE_VOICE_TTS_PROVIDER_ORDER: "browser,gemini,google-ai,google-cloud,cloudflare,openai" })).toEqual(["browser", "provider"]);
  });

  it("keeps hosted TTS out of browser free-only mode unless explicitly allowed", () => {
    const config = {
      siteUrl: "https://example.convex.site",
      roomId: "room1",
      requester,
    };
    expect(isVoiceClientFreeOnly({ VITE_NODEROOM_FREE_ONLY: "1" })).toBe(true);
    expect(createVoiceTextToSpeechAdapter(config, {
      VITE_NODEROOM_FREE_ONLY: "1",
      VITE_VOICE_TTS_PROVIDER_ORDER: "provider",
    })).toBeNull();
    expect(createVoiceTextToSpeechAdapter(config, {
      VITE_NODEROOM_FREE_ONLY: "1",
      VITE_VOICE_TTS_PROVIDER_ORDER: "provider",
      VITE_VOICE_TTS_ALLOW_HOSTED_IN_FREE_ONLY: "1",
    })).not.toBeNull();
  });

  it("falls through to the next TTS adapter after a recoverable adapter failure", async () => {
    const spoken: string[] = [];
    const failing: TextToSpeechAdapter = {
      async speak() {
        throw new Error("first_unavailable");
      },
      stop() {},
    };
    const passing: TextToSpeechAdapter = {
      async speak(utterance: VoiceNarrationUtterance) {
        spoken.push(utterance.text);
      },
      stop() {},
    };

    const adapter = new FallbackTextToSpeechAdapter([failing, passing]);
    await adapter.speak({ id: "utt1", text: "NodeAgent is working.", priority: "low", source: "job_event" });

    expect(spoken).toEqual(["NodeAgent is working."]);
  });
});
