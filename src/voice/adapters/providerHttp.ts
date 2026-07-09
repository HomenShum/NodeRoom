import type { Actor } from "../../engine/types";
import type { VoiceNarrationUtterance } from "../types";

export type VoiceProviderActorProof = {
  actor: Actor;
  token?: string;
};

export type VoiceProviderClientConfig = {
  siteUrl: string;
  roomId: string;
  requester: VoiceProviderActorProof;
  fetch?: typeof fetch;
};

export type VoiceTranscriptionResult = {
  text: string;
  model?: string;
  durationMs?: number;
};

export type VoiceSynthesisOptions = {
  utterance: VoiceNarrationUtterance;
  voice?: string;
};

export async function transcribeVoiceBlob(
  config: VoiceProviderClientConfig & {
    audio: Blob;
    locale?: string;
    fileName?: string;
  },
): Promise<VoiceTranscriptionResult> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("voice_provider_fetch_unavailable");
  if (!config.audio.size) throw new Error("voice_provider_empty_audio");

  const body = new FormData();
  body.set("roomId", config.roomId);
  body.set("requester", JSON.stringify(config.requester));
  if (config.locale) body.set("locale", config.locale);
  body.set("audio", config.audio, config.fileName ?? "voice-command.webm");

  const response = await fetchImpl(providerUrl(config.siteUrl, "/voice/transcribe"), {
    method: "POST",
    body,
  });
  if (!response.ok) throw new Error(await responseError(response, "voice_transcription_failed"));
  const payload = await response.json().catch(() => null) as Partial<VoiceTranscriptionResult> | null;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) throw new Error("voice_transcription_empty");
  return {
    text,
    model: typeof payload?.model === "string" ? payload.model : undefined,
    durationMs: typeof payload?.durationMs === "number" ? payload.durationMs : undefined,
  };
}

export async function synthesizeVoiceSpeech(
  config: VoiceProviderClientConfig & VoiceSynthesisOptions,
): Promise<Blob> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("voice_provider_fetch_unavailable");
  const text = config.utterance.text.trim();
  if (!text) throw new Error("voice_provider_empty_tts_text");

  const response = await fetchImpl(providerUrl(config.siteUrl, "/voice/synthesize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: config.roomId,
      requester: config.requester,
      text,
      voice: config.voice,
      interrupt: config.utterance.interrupt === true,
    }),
  });
  if (!response.ok) throw new Error(await responseError(response, "voice_synthesis_failed"));
  const audio = await response.blob();
  if (!audio.size) throw new Error("voice_synthesis_empty");
  return audio;
}

function providerUrl(siteUrl: string, path: string): string {
  if (!siteUrl.trim()) throw new Error("voice_provider_site_url_required");
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return new URL(path.replace(/^\//, ""), base).toString();
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim() || `${fallback}:${response.status}`;
}
