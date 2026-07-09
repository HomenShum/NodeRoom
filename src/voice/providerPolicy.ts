import type { SpeechToTextAdapter, TextToSpeechAdapter } from "./gateway";
import type { VoiceProviderClientConfig } from "./adapters/providerHttp";
import {
  BrowserSpeechSynthesisAdapter,
  BrowserSpeechToTextAdapter,
  isBrowserSpeechRecognitionAvailable,
  isBrowserSpeechSynthesisAvailable,
} from "./adapters/browserSpeech";
import {
  ConvexProviderSpeechToTextAdapter,
  ConvexProviderTextToSpeechAdapter,
  isProviderSpeechRecordingAvailable,
} from "./adapters/providerSpeech";

export type VoiceClientSttProvider = "provider" | "browser";
export type VoiceClientTtsProvider = "browser" | "provider";

export type VoiceClientPolicyEnv = {
  VITE_NODEROOM_FREE_ONLY?: string;
  VITE_VOICE_STT_PROVIDER_ORDER?: string;
  VITE_VOICE_TTS_PROVIDER_ORDER?: string;
  VITE_VOICE_TTS_ALLOW_HOSTED_IN_FREE_ONLY?: string;
};

export type VoiceClientProviderConfig = VoiceProviderClientConfig & {
  providerMaxMs?: number;
  providerVoice?: string;
};

type VoicePolicyGlobal = typeof globalThis & {
  __NODEROOM_VOICE_CLIENT_POLICY_ENV__?: VoiceClientPolicyEnv;
};

const DEFAULT_STT_ORDER: VoiceClientSttProvider[] = ["provider", "browser"];
const DEFAULT_TTS_ORDER: VoiceClientTtsProvider[] = ["browser", "provider"];

const HOSTED_STT_ALIASES = new Set(["provider", "convex", "hosted", "nvidia", "cloudflare", "groq", "openai"]);
const HOSTED_TTS_ALIASES = new Set([
  "provider",
  "convex",
  "hosted",
  "cloudflare",
  "gemini",
  "google",
  "googleai",
  "google-ai",
  "google_ai",
  "googlecloud",
  "google-cloud",
  "google_cloud",
  "openai",
]);
const BROWSER_STT_ALIASES = new Set(["browser", "speechrecognition", "webspeech", "web-speech"]);
const BROWSER_TTS_ALIASES = new Set(["browser", "speechsynthesis", "webspeech", "web-speech"]);

export function voiceClientPolicyEnv(): VoiceClientPolicyEnv {
  return {
    ...((import.meta as unknown as { env?: VoiceClientPolicyEnv }).env ?? {}),
    ...((globalThis as VoicePolicyGlobal).__NODEROOM_VOICE_CLIENT_POLICY_ENV__ ?? {}),
  };
}

export function isVoiceClientFreeOnly(env: VoiceClientPolicyEnv = voiceClientPolicyEnv()): boolean {
  return envFlag(env.VITE_NODEROOM_FREE_ONLY);
}

export function resolveVoiceClientSttProviderOrder(env: VoiceClientPolicyEnv = voiceClientPolicyEnv()): VoiceClientSttProvider[] {
  return parseProviderOrder(env.VITE_VOICE_STT_PROVIDER_ORDER, DEFAULT_STT_ORDER, (token) => {
    if (HOSTED_STT_ALIASES.has(token)) return "provider";
    if (BROWSER_STT_ALIASES.has(token)) return "browser";
    return null;
  });
}

export function resolveVoiceClientTtsProviderOrder(env: VoiceClientPolicyEnv = voiceClientPolicyEnv()): VoiceClientTtsProvider[] {
  return parseProviderOrder(env.VITE_VOICE_TTS_PROVIDER_ORDER, DEFAULT_TTS_ORDER, (token) => {
    if (BROWSER_TTS_ALIASES.has(token)) return "browser";
    if (HOSTED_TTS_ALIASES.has(token)) return "provider";
    return null;
  });
}

export function createVoiceSpeechToTextAdapters(
  config: VoiceClientProviderConfig | null,
  env: VoiceClientPolicyEnv = voiceClientPolicyEnv(),
): SpeechToTextAdapter[] {
  const adapters: SpeechToTextAdapter[] = [];
  for (const provider of resolveVoiceClientSttProviderOrder(env)) {
    if (provider === "provider" && config?.siteUrl && config.requester && isProviderSpeechRecordingAvailable()) {
      adapters.push(new ConvexProviderSpeechToTextAdapter(config, { maxMs: config.providerMaxMs ?? 30_000 }));
    }
    if (provider === "browser" && isBrowserSpeechRecognitionAvailable()) {
      adapters.push(new BrowserSpeechToTextAdapter());
    }
  }
  return adapters;
}

export function createVoiceTextToSpeechAdapter(
  config: VoiceClientProviderConfig | null,
  env: VoiceClientPolicyEnv = voiceClientPolicyEnv(),
): TextToSpeechAdapter | null {
  const adapters: TextToSpeechAdapter[] = [];
  const freeOnly = isVoiceClientFreeOnly(env);
  const allowHostedInFreeOnly = envFlag(env.VITE_VOICE_TTS_ALLOW_HOSTED_IN_FREE_ONLY);
  for (const provider of resolveVoiceClientTtsProviderOrder(env)) {
    if (provider === "browser" && isBrowserSpeechSynthesisAvailable()) {
      adapters.push(new BrowserSpeechSynthesisAdapter());
    }
    if (provider === "provider" && config?.siteUrl && config.requester && (!freeOnly || allowHostedInFreeOnly)) {
      adapters.push(new ConvexProviderTextToSpeechAdapter(config, { voice: config.providerVoice }));
    }
  }
  return adapters.length ? new FallbackTextToSpeechAdapter(adapters) : null;
}

export class FallbackTextToSpeechAdapter implements TextToSpeechAdapter {
  constructor(private readonly adapters: TextToSpeechAdapter[]) {}

  async speak(utterance: Parameters<TextToSpeechAdapter["speak"]>[0]): Promise<void> {
    let lastError: unknown = null;
    for (const adapter of this.adapters) {
      try {
        await adapter.speak(utterance);
        return;
      } catch (error) {
        lastError = error;
        adapter.stop();
      }
    }
    throw lastError instanceof Error ? lastError : new Error("voice_tts_unavailable");
  }

  stop(): void {
    for (const adapter of this.adapters) adapter.stop();
  }
}

function parseProviderOrder<T extends string>(raw: string | undefined, fallback: T[], normalize: (token: string) => T | null): T[] {
  const providers: T[] = [];
  for (const token of (raw ?? "").split(",")) {
    const provider = normalize(token.trim().toLowerCase());
    if (provider && !providers.includes(provider)) providers.push(provider);
  }
  return providers.length ? providers : fallback;
}

function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
