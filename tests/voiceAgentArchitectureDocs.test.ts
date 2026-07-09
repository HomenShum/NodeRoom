import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const adrPath = join(process.cwd(), "docs/architecture/VOICE_AGENT_MERGE_ADR.md");
const mapPath = join(process.cwd(), "docs/architecture/ROOM_OS_TO_NODEROOM_MAP.md");
const voiceSourceFiles = [
  "src/voice/types.ts",
  "src/voice/stateMachines.ts",
  "src/voice/commandClassifier.ts",
  "src/voice/gateway.ts",
  "src/voice/roomVoiceAdapter.ts",
  "src/voice/narration.ts",
  "src/voice/adapters/mock.ts",
  "src/voice/adapters/browserSpeech.ts",
  "src/voice/adapters/providerHttp.ts",
  "src/voice/adapters/providerSpeech.ts",
].map((path) => join(process.cwd(), path));

function read(path: string): string {
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
}

describe("voice agent architecture merge packet", () => {
  it("documents voice as a modality behind NodeRoom governance", () => {
    const adr = read(adrPath);
    for (const section of [
      "## Repository Audit Findings",
      "## Binding NodeRoom Decisions",
      "## Recommendation",
      "## VoiceSessionState",
      "## RoomCommandState",
      "## Bridge Design",
      "## Permission And Governance Model",
      "## Rejected Alternatives",
      "## Failure Modes",
      "## Migration Phases",
      "## Test Plan",
    ]) {
      expect(adr).toContain(section);
    }

    expect(adr).toContain("NodeRoom remains the source of truth");
    expect(adr).toContain("NodeAgent remains the work/execution layer");
    expect(adr).toContain("Voice must not directly mutate durable room state.");
    expect(adr).toContain("ClickHouse or analytics storage must not enter the live mutation path.");
    expect(adr).toContain("Existing text chat functionality must continue working.");
    expect(adr).toContain("Room OS worker coordination overlaps NodeAgent.");
    expect(adr).toContain('source: "voice"');
    expect(adr).toContain("requiresConfirmation");
    expect(adr).toContain('riskLevel: "read" | "draft" | "write" | "destructive"');
  });

  it("maps actual Room OS donor files without making them architecture owners", () => {
    const map = read(mapPath);
    expect(map).toContain("| Room OS module/file | Purpose | Reuse as-is / adapt / discard | NodeRoom target location | Risks | Tests required |");
    for (const donorFile of [
      "src/voice/voiceAgent.ts",
      "src/voice/runVoiceMvp.ts",
      "src/voice/localAudioAdapters.md",
      "src/core/types.ts",
      "src/core/roomReducer.ts",
      "src/core/speechActClassifier.ts",
      "src/core/guards.ts",
      "src/live/pipeline.ts",
      "src/live/roomServer.ts",
      "src/client/live/roomClient.ts",
      "convex/rooms.ts",
      "convex/openai.ts",
      "convex/coordinator.ts",
      "tests/liveSteering.test.ts",
    ]) {
      expect(map).toContain(`\`${donorFile}\``);
    }

    expect(map).toContain("Do not copy Room OS `RoomState` into NodeRoom.");
    expect(map).toContain("Do not make Room OS `roomServer.ts` the live backend for NodeRoom voice.");
    expect(map).toContain("No durable room mutation happens directly from the voice layer.");
  });

  it("keeps implementation phases and provider boundaries documented", () => {
    const adr = read(adrPath);
    const map = read(mapPath);
    expect(adr).toContain("Phase 1 and 2 can be");
    expect(adr).toContain("pure types/tests.");
    expect(adr).toContain("/voice/transcribe");
    expect(adr).toContain("keep `OPENAI_API_KEY`");
    expect(map).toContain("The first implementation slice added types and tests:");
    expect(map).toContain("The third slice mounted voice in the chat composer");
    expect(map).toContain("tests/voiceSession.test.ts");
    expect(map).toContain("tests/roomVoiceAdapter.test.ts");
    expect(map).toContain("tests/voiceProviderHttp.test.ts");
    expect(map).toContain("src/voice/roomVoiceAdapter.ts");
  });

  it("keeps voice implementation out of direct durable mutation APIs", () => {
    for (const file of voiceSourceFiles) {
      const source = read(file);
      expect(source).not.toMatch(/from\s+["'](?:\.\.\/\.\.\/)?convex\//);
      expect(source).not.toContain("useMutation(");
      expect(source).not.toContain("api.artifacts");
      expect(source).not.toContain("api.rooms");
      expect(source).not.toContain("ctx.db");
      expect(source).not.toContain("resolveProposal(");
      expect(source).not.toContain("applyCellEdit(");
    }
  });
});
