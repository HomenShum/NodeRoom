import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("voice free audio proofloop contract", () => {
  const script = readFileSync("scripts/voice-free-audio-proofloop.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  it("is exposed as an npm proofloop command", () => {
    expect(pkg.scripts?.["voice:free-audio:proofloop"]).toBe("tsx scripts/voice-free-audio-proofloop.ts");
  });

  it("checks browser, local, and OpenRouter free audio surfaces", () => {
    expect(script).toContain("browser-speech-recognition");
    expect(script).toContain("browser-speech-synthesis");
    expect(script).toContain("local-whisper-stt");
    expect(script).toContain("local-kokoro-piper-tts");
    expect(script).toContain("openrouter-free-audio-input");
    expect(script).toContain("openrouter-free-audio-output");
  });

  it("treats hosted free audio as catalog candidates until live audio smokes pass", () => {
    expect(script).toContain("Audio-input text models may summarize or analyze audio instead of producing verbatim command transcription.");
    expect(script).toContain("Audio-output models in the free catalog may be music/audio generation, not conversational room narration.");
    expect(script).toContain("Run an explicit synthetic WAV transcription smoke before routing live voice commands through this lane.");
    expect(script).toContain("Run a streaming audio-output smoke and verify playable speech before routing narration through this lane.");
  });

  it("writes rerunnable proof receipts under .proofloop", () => {
    expect(script).toContain('schema: "voice-free-audio-proofloop-v1"');
    expect(script).toContain('resolve(".proofloop", "runs", "voice-free-audio")');
    expect(script).toContain('writeFileSync(resolve(outDir, "receipt.json")');
    expect(script).toContain('writeFileSync(resolve(outDir, "scorecard.md")');
  });
});
