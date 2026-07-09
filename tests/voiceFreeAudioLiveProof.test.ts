import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("voice free audio live proof contract", () => {
  const script = readFileSync("scripts/voice-free-audio-live-proof.ts", "utf8");
  const browserMicScript = readFileSync("scripts/voice-browser-mic-proof.ts", "utf8");
  const prodDeployScript = readFileSync("scripts/voice-prod-deploy-proof.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

  it("is exposed as a live npm proof command", () => {
    expect(pkg.scripts?.["voice:free-audio:live-proof"]).toBe("tsx scripts/voice-free-audio-live-proof.ts");
    expect(pkg.scripts?.["voice:local-audio:setup"]).toBe("tsx scripts/voice-local-audio-setup.ts");
    expect(pkg.scripts?.["voice:browser-mic:proof"]).toBe("tsx scripts/voice-browser-mic-proof.ts");
    expect(pkg.scripts?.["voice:prod-deploy:proof"]).toBe("tsx scripts/voice-prod-deploy-proof.ts");
  });

  it("requires runtime evidence before a lane can pass", () => {
    expect(script).toContain('schema: "voice-free-audio-live-proof-v1"');
    expect(script).toContain("browser-speech-synthesis-live");
    expect(script).toContain("openrouter-free-audio-input-chat-live");
    expect(script).toContain("openrouter-free-dedicated-stt-live");
    expect(script).toContain("openrouter-free-tts-live");
    expect(script).toContain("nvidia-direct-nemotron-audio-live");
    expect(script).toContain("local-piper-tts-live");
    expect(script).toContain("runLocalWhisperTranscription");
    expect(script).toContain("runLocalPiperSynthesis");
    expect(script).toContain("matchedExpectedTokens");
  });

  it("uses OpenRouter audio endpoints without allowing paid audio providers", () => {
    expect(script).toContain("/audio/transcriptions");
    expect(script).toContain("/audio/speech");
    expect(script).toContain("input_audio");
    expect(script).toContain('type LiveLaneCost = "free" | "prototype_free_trial" | "paid"');
    expect(script).toContain("input_modalities=audio&output_modalities=text");
    expect(script).toContain("output_modalities=transcription");
    expect(script).toContain("output_modalities=speech");
    expect(script).toContain("audioInputVariants");
    expect(script).toContain("OpenRouter SDK outbound schema");
    expect(script).toContain("isZeroPriced");
    expect(script).toContain('noPaidAudioProviderUsed: lanes.every((lane) => lane.cost !== "paid")');
  });

  it("has a direct Nvidia Nemotron audio probe using Nvidia's documented media shape", () => {
    expect(script).toContain("https://integrate.api.nvidia.com/v1");
    expect(script).toContain("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
    expect(script).toContain("NVIDIA_API_KEY");
    expect(script).toContain("audio_url");
    expect(script).toContain("data:audio/wav;base64");
    expect(script).toContain("/no_think");
    expect(script).toContain("chat_template_kwargs");
    expect(script).toContain('cost: "prototype_free_trial"');
  });

  it("writes rerunnable live receipts under .proofloop", () => {
    expect(script).toContain('resolve(".proofloop", "runs", "voice-free-audio-live")');
    expect(script).toContain('writeFileSync(resolve(OUT_DIR, "receipt.json")');
    expect(script).toContain('writeFileSync(resolve(LATEST_DIR, "scorecard.md")');
  });

  it("has a browser microphone proof that records and transcribes captured audio", () => {
    expect(browserMicScript).toContain('schema: "voice-browser-mic-proof-v1"');
    expect(browserMicScript).toContain("getUserMedia");
    expect(browserMicScript).toContain("MediaRecorder");
    expect(browserMicScript).toContain("--use-file-for-fake-audio-capture");
    expect(browserMicScript).toContain("faster_whisper");
  });

  it("has a production deploy proof for mic policy and fail-closed Convex voice routes", () => {
    expect(prodDeployScript).toContain('schema: "voice-prod-deploy-proof-v1"');
    expect(prodDeployScript).toContain("microphone=(self)");
    expect(prodDeployScript).toContain("/voice/transcribe");
    expect(prodDeployScript).toContain("/voice/synthesize");
    expect(prodDeployScript).toContain("missing room auth");
    expect(prodDeployScript).toContain("--real-provider");
    expect(prodDeployScript).toContain("--free-only");
    expect(prodDeployScript).toContain('optionValue("--tts-text") ?? "Proof complete."');
    expect(prodDeployScript).toContain("api.rooms.create");
    expect(prodDeployScript).toContain("api.rooms.leave");
    expect(prodDeployScript).toContain("prod-provider-audio-roundtrip");
    expect(prodDeployScript).toContain("stt provider:");
    expect(prodDeployScript).toContain("tts provider:");
    expect(prodDeployScript).toContain("hostedFreeProviderOk");
    expect(prodDeployScript).toContain("paidVoiceProviderBlocked");
    expect(prodDeployScript).toContain("Hosted free-tier TTS adapters fail closed");
    expect(prodDeployScript).toContain("transcribeWithNvidia");
    expect(prodDeployScript).toContain("synthesizeWithGemini");
    expect(prodDeployScript).toContain("synthesizeWithCloudflare");
    expect(prodDeployScript).toContain("synthesizeWithGoogleCloudTts");
    expect(prodDeployScript).toContain("hostedFreeTierAllowed");
    expect(prodDeployScript).toContain('resolve(".proofloop", "runs", "voice-prod-deploy")');
  });
});
