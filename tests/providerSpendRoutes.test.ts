import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("provider spend route matrix", () => {
  it.each([
    ["private blocking agent", "convex/agent.ts", 'route: "private_agent"'],
    ["private persistent stream", "convex/http.ts", 'route: "private_stream"'],
    ["voice transcription", "convex/http.ts", 'route: "voice_stt"'],
    ["voice synthesis", "convex/http.ts", 'route: "voice_tts"'],
    ["capture pipeline", "convex/capturesNode.ts", 'route: "capture"'],
    ["embedding outbox", "convex/okfIndexer.ts", 'route: "embedding"'],
  ])("routes %s through the shared admission boundary", (_label, path, routeMarker) => {
    const source = read(path);
    expect(source).toContain("beginProviderSpend");
    expect(source).toContain(routeMarker);
  });

  it("requests provider usage from both streaming protocols before settling", () => {
    const source = read("convex/streamingModel.ts");
    expect(source).toContain("usageMetadata");
    expect(source).toContain("stream_options: { include_usage: true }");
    expect(source).toContain("cachedInputTokens");
  });

  it("counts active materialized reservations in launch snapshots", () => {
    const source = read("convex/usageLimits.ts");
    expect(source).toContain('query("creditReservations")');
    expect(source).toContain("sumPending(pendingGlobal)");
    expect(source).toContain("sumPending(pendingRoom)");
    expect(source).toContain("sumPending(pendingUser)");
  });
});
