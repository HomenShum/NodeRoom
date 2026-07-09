import { describe, expect, it, vi } from "vitest";
import { synthesizeVoiceSpeech, transcribeVoiceBlob } from "../src/voice";
import type { Actor } from "../src/engine/types";

const actor: Actor = { kind: "user", id: "u1", name: "Maya" };
const requester = { actor, token: "test-token-with-sufficient-entropy-1234567890" };

describe("voice provider HTTP client", () => {
  it("posts audio to the authenticated Convex transcription endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toBeUndefined();
      const body = init?.body as FormData;
      expect(body.get("roomId")).toBe("room1");
      expect(JSON.parse(String(body.get("requester")))).toMatchObject({ actor: { id: "u1", name: "Maya" } });
      expect(body.get("locale")).toBe("en-US");
      expect(body.get("audio")).toBeTruthy();
      return Response.json({ text: "ask nodeagent to summarize the room", model: "gpt-4o-mini-transcribe", durationMs: 120 });
    });

    const result = await transcribeVoiceBlob({
      siteUrl: "https://example.convex.site",
      roomId: "room1",
      requester,
      audio: new Blob(["audio"], { type: "audio/webm" }),
      locale: "en-US",
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.convex.site/voice/transcribe");
    expect(result).toEqual({ text: "ask nodeagent to summarize the room", model: "gpt-4o-mini-transcribe", durationMs: 120 });
  });

  it("posts narration text to the authenticated Convex synthesis endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        roomId: "room1",
        requester: { actor: { id: "u1", name: "Maya" } },
        text: "NodeAgent is working.",
        voice: "coral",
      });
      return new Response(new Blob(["mp3"], { type: "audio/mpeg" }));
    });

    const audio = await synthesizeVoiceSpeech({
      siteUrl: "https://example.convex.site/",
      roomId: "room1",
      requester,
      utterance: { id: "utt1", text: "NodeAgent is working.", priority: "low", source: "job_event" },
      voice: "coral",
      fetch: fetchMock,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.convex.site/voice/synthesize");
    expect(audio.size).toBeGreaterThan(0);
  });
});
