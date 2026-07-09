import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("hosted free-tier voice TTS providers", () => {
  const httpSource = readFileSync("convex/http.ts", "utf8");
  const envExample = readFileSync(".env.example", "utf8");

  it("keeps hosted free-tier providers behind explicit free-only confirmation flags", () => {
    expect(httpSource).toContain('type VoiceTtsProvider = "openai" | "cloudflare" | "gemini" | "google" | "disabled"');
    expect(httpSource).toContain("hostedFreeTierAllowed");
    expect(httpSource).toContain("VOICE_CLOUDFLARE_FREE_TIER_CONFIRMED");
    expect(httpSource).toContain("VOICE_GEMINI_TTS_FREE_TIER_CONFIRMED");
    expect(httpSource).toContain("VOICE_GOOGLE_TTS_FREE_TIER_CONFIRMED");
    expect(httpSource).toContain("VOICE_ALLOW_METERED_FREE_TIER");
  });

  it("wires the documented hosted TTS adapters without making OpenAI the free-only default", () => {
    expect(httpSource).toContain("synthesizeWithGemini");
    expect(httpSource).toContain("https://generativelanguage.googleapis.com/v1beta/models");
    expect(httpSource).toContain("gemini-3.1-flash-tts-preview");
    expect(httpSource).toContain(":generateContent");
    expect(httpSource).toContain('responseModalities: ["AUDIO"]');
    expect(httpSource).toContain("prebuiltVoiceConfig");
    expect(httpSource).toContain("pcm16ToWav");

    expect(httpSource).toContain("synthesizeWithCloudflare");
    expect(httpSource).toContain("@cf/myshell-ai/melotts");
    expect(httpSource).toContain("cloudflareAudioBase64");
    expect(httpSource).toContain("compactCloudflareAudio");
    expect(httpSource).toContain("downsampleWavPcm16");

    expect(httpSource).toContain("synthesizeWithGoogleCloudTts");
    expect(httpSource).toContain("https://texttospeech.googleapis.com/v1/text:synthesize");
    expect(httpSource).toContain("VOICE_GOOGLE_TTS_MAX_CHARS_PER_REQUEST");

    expect(httpSource).toContain('return uniqueProviders.length ? uniqueProviders : [freeOnlyMode() ? "disabled" : "openai"]');
  });

  it("documents the provider order and quota controls for production env setup", () => {
    expect(envExample).toContain("VOICE_TTS_PROVIDER_ORDER=gemini,cloudflare,google,openai");
    expect(envExample).toContain("VOICE_ALLOW_METERED_FREE_TIER=0");
    expect(envExample).toContain("VOICE_GEMINI_TTS_FREE_TIER_CONFIRMED=0");
    expect(envExample).toContain("VOICE_CLOUDFLARE_FREE_TIER_CONFIRMED=0");
    expect(envExample).toContain("VOICE_GOOGLE_TTS_FREE_TIER_CONFIRMED=0");
    expect(envExample).toContain("VOICE_GOOGLE_TTS_MAX_CHARS_PER_REQUEST=900");
  });
});
