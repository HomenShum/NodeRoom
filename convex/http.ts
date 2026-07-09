/**
 * HTTP surface — currently one route: the persistent-text-streaming driver for private NodeAgent
 * replies. The driving browser tab POSTs { streamId, requester } here and receives the token stream over
 * HTTP while the component persists sentence-flushed chunks to the DB for every other
 * tab/refresh (they read via streaming.getStreamBody). A second drive attempt gets the
 * component's 205 and falls back to the DB body — never a duplicate generation.
 *
 * CORS is open (*) like the component's reference app, but the endpoint still checks the room's
 * actor proof before generation starts. A second drive attempt gets the component's 205.
 */
import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { streamingComponent } from "./streaming";
import { streamPrivateReplyText } from "./streamingModel";
import { privateAgentSystemPrompt } from "./agent";

const http = httpRouter();
const assertVoiceRequesterRef = makeFunctionReference<"query">("voice:assertVoiceRequester");

const CORS = { "Access-Control-Allow-Origin": "*", Vary: "Origin" } as const;
type ActorProofBody = { actor: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string }; token: string };
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" } as const;
const VOICE_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_STT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
const NVIDIA_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
const CLOUDFLARE_AI_MODEL_TTS = "@cf/myshell-ai/melotts";
const GEMINI_TTS_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
type VoiceSttProvider = "openai" | "nvidia";
type VoiceTtsProvider = "openai" | "cloudflare" | "gemini" | "google" | "disabled";
type VoiceTranscription = { text: string; model: string; provider: VoiceSttProvider };
type VoiceSynthesis = { audio: ArrayBuffer; contentType: string; model: string; provider: VoiceTtsProvider };

http.route({
  path: "/stream-private-reply",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
    })),
});

http.route({
  path: "/voice/transcribe",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
    })),
});

http.route({
  path: "/voice/transcribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const startedAt = Date.now();
    const form = await request.formData().catch(() => null);
    if (!form) return textResponse("invalid form", 400);

    const roomId = stringField(form, "roomId");
    const requester = parseRequester(stringField(form, "requester"));
    const audio = form.get("audio");
    if (!roomId || !requester) return textResponse("missing room auth", 400);
    if (!isAudioFile(audio)) return textResponse("missing audio", 400);
    if (audio.size > VOICE_AUDIO_MAX_BYTES) return textResponse("audio too large", 413);

    try {
      await ctx.runQuery(assertVoiceRequesterRef, { roomId: roomId as never, requester });
    } catch {
      return textResponse("forbidden", 403);
    }

    const transcription = await transcribeVoiceAudio(audio);
    if (!transcription.ok) return textResponse(transcription.error, transcription.status);
    return new Response(JSON.stringify({
      text: transcription.value.text,
      model: transcription.value.model,
      provider: transcription.value.provider,
      durationMs: Date.now() - startedAt,
    }), { status: 200, headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/voice/synthesize",
  method: "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, {
      status: 204,
      headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
    })),
});

http.route({
  path: "/voice/synthesize",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json().catch(() => null) as {
        roomId?: unknown;
        requester?: unknown;
        text?: unknown;
        voice?: unknown;
      } | null;
      const roomId = typeof body?.roomId === "string" ? body.roomId : "";
      const requester = parseRequester(body?.requester);
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!roomId || !requester) return textResponse("missing room auth", 400);
      if (!text) return textResponse("missing text", 400);
      if (text.length > 4_000) return textResponse("text too long", 413);

      try {
        await ctx.runQuery(assertVoiceRequesterRef, { roomId: roomId as never, requester });
      } catch {
        return textResponse("forbidden", 403);
      }

      const synthesis = await synthesizeVoiceAudio(text, typeof body?.voice === "string" ? body.voice : undefined).catch((error) => ({
        ok: false as const,
        status: 502,
        error: providerExceptionText("voice synthesis failed", error),
      }));
      if (!synthesis.ok) return textResponse(synthesis.error, synthesis.status);
      return new Response(new Uint8Array(synthesis.value.audio), {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": synthesis.value.contentType,
          "Cache-Control": "no-store",
          "X-Voice-TTS-Provider": synthesis.value.provider,
          "X-Voice-TTS-Model": synthesis.value.model,
        },
      });
    } catch (error) {
      return textResponse(providerExceptionText("voice synthesis route failed", error), 502);
    }
  }),
});

http.route({
  path: "/stream-private-reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => null)) as { streamId?: string; requester?: ActorProofBody } | null;
    const streamId = body?.streamId;
    if (!streamId || typeof streamId !== "string") {
      return new Response("missing streamId", { status: 400, headers: CORS });
    }
    if (!body?.requester || typeof body.requester !== "object") {
      return new Response("missing requester", { status: 400, headers: CORS });
    }
    let meta;
    try {
      meta = await ctx.runQuery(internal.streaming.streamMeta, { streamId, requester: body.requester });
    } catch {
      return new Response("forbidden", { status: 403, headers: CORS });
    }
    if (!meta) return new Response("unknown stream", { status: 404, headers: CORS });

    const response = await streamingComponent.stream(ctx, request, streamId as StreamId, async (streamCtx, _req, _sid, append) => {
      const system = privateAgentSystemPrompt(meta.requesterName);
      const userMsg = `ROOM CONTEXT\n${meta.roomContext}\n\n${meta.requesterName} asks: ${meta.goal}`;
      let answer = "";
      try {
        answer = await streamPrivateReplyText(process.env.AGENT_MODEL ?? "gemini-3.5-flash", system, userMsg, append);
      } catch (error) {
        // HONEST_STATUS: the partial text persists, the error is visible text, never a silent 2xx void.
        const msg = `(private agent error: ${error instanceof Error ? error.message.slice(0, 160) : "model call failed"})`;
        await append(answer ? `\n${msg}` : msg);
        answer = answer ? `${answer}\n${msg}` : msg;
      }
      if (!answer.trim()) {
        answer = "I read the room but have nothing to add yet — ask me something specific about the data.";
        await append(answer);
      }
      await streamCtx.runMutation(internal.streaming.finalizeStreamMessage, { roomId: meta.roomId, clientMsgId: meta.clientMsgId, text: answer });
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Vary", "Origin");
    return response;
  }),
});

export default http;

async function transcribeVoiceAudio(audio: File): Promise<
  | { ok: true; value: VoiceTranscription }
  | { ok: false; status: number; error: string }
> {
  let last: { ok: false; status: number; error: string } | null = null;
  for (const provider of voiceSttProviders()) {
    const result = provider === "nvidia" ? await transcribeWithNvidia(audio) : await transcribeWithOpenAi(audio);
    if (result.ok) return result;
    last = result;
    if (result.status !== 503) return result;
  }
  return last ?? { ok: false, status: 503, error: "voice provider not configured" };
}

function voiceSttProviders(): VoiceSttProvider[] {
  const configured = [
    process.env.VOICE_STT_PROVIDER,
    ...(process.env.VOICE_STT_PROVIDER_ORDER ?? "").split(","),
  ];
  const providers = configured
    .map((value) => normalizeProvider(value))
    .filter((value): value is VoiceSttProvider => value === "nvidia" || value === "openai");
  return unique(providers).length ? unique(providers) : [freeOnlyMode() ? "nvidia" : "openai"];
}

async function synthesizeVoiceAudio(text: string, requestedVoice: string | undefined): Promise<
  | { ok: true; value: VoiceSynthesis }
  | { ok: false; status: number; error: string }
> {
  let last: { ok: false; status: number; error: string } | null = null;
  for (const provider of voiceTtsProviders()) {
    let result: { ok: true; value: VoiceSynthesis } | { ok: false; status: number; error: string };
    switch (provider) {
      case "cloudflare":
        result = await synthesizeWithCloudflare(text);
        break;
      case "gemini":
        result = await synthesizeWithGemini(text);
        break;
      case "google":
        result = await synthesizeWithGoogleCloudTts(text);
        break;
      case "openai":
        result = await synthesizeWithOpenAi(text, requestedVoice);
        break;
      case "disabled":
        result = { ok: false, status: 503, error: "free browser voice synthesis is client-side only" };
        break;
    }
    if (result.ok) return result;
    last = result;
    if (result.status !== 503) return result;
  }
  return last ?? { ok: false, status: 503, error: "voice synthesis provider not configured" };
}

function voiceTtsProviders(): VoiceTtsProvider[] {
  const configured = [
    process.env.VOICE_TTS_PROVIDER,
    ...(process.env.VOICE_TTS_PROVIDER_ORDER ?? "").split(","),
  ];
  const providers = configured
    .map((value) => normalizeProvider(value))
    .map((value): VoiceTtsProvider | null => {
      if (value === "cloudflare" || value === "openai" || value === "gemini" || value === "google" || value === "disabled") return value;
      if (value === "googleai" || value === "google-ai" || value === "google_ai") return "gemini";
      if (value === "googlecloud" || value === "google-cloud" || value === "google_cloud") return "google";
      if (value === "browser" || value === "local" || value === "piper") return "disabled";
      return null;
    })
    .filter((value): value is VoiceTtsProvider => value != null);
  const uniqueProviders = unique(providers);
  return uniqueProviders.length ? uniqueProviders : [freeOnlyMode() ? "disabled" : "openai"];
}

function normalizeProvider(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

async function transcribeWithOpenAi(audio: File): Promise<
  | { ok: true; value: VoiceTranscription }
  | { ok: false; status: number; error: string }
> {
  if (paidVoiceProviderBlocked()) return { ok: false, status: 403, error: "paid voice stt provider disabled in free-only mode" };
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, status: 503, error: "voice provider not configured" };

  const model = process.env.VOICE_OPENAI_STT_MODEL?.trim() || "gpt-4o-mini-transcribe";
  const upstreamForm = new FormData();
  upstreamForm.set("file", audio, audio.name || "voice-command.webm");
  upstreamForm.set("model", model);
  upstreamForm.set("response_format", "json");

  const upstream = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: upstreamForm,
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "voice transcription failed") };

  const payload = await upstream.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) return { ok: false, status: 502, error: "empty transcription" };
  return { ok: true, value: { text, model, provider: "openai" } };
}

async function transcribeWithNvidia(audio: File): Promise<
  | { ok: true; value: VoiceTranscription }
  | { ok: false; status: number; error: string }
> {
  const key = process.env.NVIDIA_API_KEY?.trim() || process.env.NVIDIA_NIM_API_KEY?.trim() || process.env.NGC_API_KEY?.trim() || process.env.NVCF_API_KEY?.trim();
  if (!key) return { ok: false, status: 503, error: "voice provider not configured" };
  const maxBytes = Number(process.env.VOICE_NVIDIA_AUDIO_MAX_BYTES ?? NVIDIA_AUDIO_MAX_BYTES);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && audio.size > maxBytes) {
    return { ok: false, status: 413, error: "audio too large for nvidia voice provider" };
  }

  const model = process.env.VOICE_NVIDIA_STT_MODEL?.trim() || NVIDIA_STT_MODEL;
  const mimeType = audio.type || mimeTypeForName(audio.name) || "audio/webm";
  const audioBase64 = arrayBufferToBase64(await audio.arrayBuffer());
  const upstream = await fetch(NVIDIA_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "/no_think" },
        {
          role: "user",
          content: [
            { type: "audio_url", audio_url: { url: `data:${mimeType};base64,${audioBase64}` } },
            { type: "text", text: "Transcribe this audio exactly. Return only the spoken words." },
          ],
        },
      ],
      temperature: 0,
      max_tokens: Number(process.env.VOICE_NVIDIA_STT_MAX_TOKENS ?? 220),
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "voice transcription failed") };

  const payload = await upstream.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const text = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content.trim() : "";
  if (!text) return { ok: false, status: 502, error: "empty transcription" };
  return { ok: true, value: { text, model, provider: "nvidia" } };
}

async function synthesizeWithOpenAi(text: string, requestedVoice: string | undefined): Promise<
  | { ok: true; value: VoiceSynthesis }
  | { ok: false; status: number; error: string }
> {
  if (paidVoiceProviderBlocked()) return { ok: false, status: 403, error: "paid voice tts provider disabled in free-only mode" };
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, status: 503, error: "voice provider not configured" };
  const voice = requestedVoice?.trim() || process.env.VOICE_OPENAI_TTS_VOICE?.trim() || "coral";
  const model = process.env.VOICE_OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
  const upstream = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      instructions: process.env.VOICE_OPENAI_TTS_INSTRUCTIONS?.trim() || "Speak clearly and concisely for a collaborative work room.",
    }),
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "voice synthesis failed") };
  return {
    ok: true,
    value: {
      audio: await upstream.arrayBuffer(),
      contentType: upstream.headers.get("Content-Type") || "audio/mpeg",
      model,
      provider: "openai",
    },
  };
}

async function synthesizeWithCloudflare(text: string): Promise<
  | { ok: true; value: VoiceSynthesis }
  | { ok: false; status: number; error: string }
> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || process.env.CLOUDFLARE_AI_API_TOKEN?.trim();
  if (!accountId || !token) return { ok: false, status: 503, error: "cloudflare voice provider not configured" };
  if (!hostedFreeTierAllowed("cloudflare")) return { ok: false, status: 403, error: "cloudflare tts free-tier not confirmed in free-only mode" };
  const model = process.env.VOICE_CLOUDFLARE_TTS_MODEL?.trim() || CLOUDFLARE_AI_MODEL_TTS;
  const lang = process.env.VOICE_CLOUDFLARE_TTS_LANG?.trim() || "en";
  const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg, application/json",
    },
    body: JSON.stringify({ prompt: text, lang }),
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "cloudflare voice synthesis failed") };
  const contentType = upstream.headers.get("Content-Type") || "";
  if (/^audio\//i.test(contentType)) {
    return { ok: true, value: { audio: await upstream.arrayBuffer(), contentType, model, provider: "cloudflare" } };
  }
  const payloadText = await upstream.text().catch(() => "");
  const audioBase64 = cloudflareAudioBase64(payloadText);
  if (!audioBase64) return { ok: false, status: 502, error: "cloudflare voice synthesis returned empty audio" };
  const rawAudio = base64ToArrayBuffer(audioBase64);
  const compactAudio = compactCloudflareAudio(rawAudio);
  return { ok: true, value: { audio: compactAudio.audio, contentType: compactAudio.contentType, model, provider: "cloudflare" } };
}

async function synthesizeWithGemini(text: string): Promise<
  | { ok: true; value: VoiceSynthesis }
  | { ok: false; status: number; error: string }
> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, status: 503, error: "gemini voice provider not configured" };
  if (!hostedFreeTierAllowed("gemini")) return { ok: false, status: 403, error: "gemini tts free-tier not confirmed in free-only mode" };
  const model = process.env.VOICE_GEMINI_TTS_MODEL?.trim() || GEMINI_TTS_MODEL;
  const voice = process.env.VOICE_GEMINI_TTS_VOICE?.trim() || "Kore";
  const prompt = geminiTtsPrompt(text);
  const headers: Record<string, string> = {
    "x-goog-api-key": key,
    "Content-Type": "application/json",
  };
  const apiRevision = process.env.VOICE_GEMINI_TTS_API_REVISION?.trim();
  if (apiRevision) headers["Api-Revision"] = apiRevision;

  const upstream = await fetch(`${GEMINI_TTS_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    }),
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "gemini voice synthesis failed") };
  const payload = await upstream.json().catch(() => null);
  const audio = geminiAudioPayload(payload);
  if (!audio?.data) return { ok: false, status: 502, error: "gemini voice synthesis returned empty audio" };

  const raw = base64ToArrayBuffer(audio.data);
  const contentType = audio.mimeType || "audio/wav";
  const wav = contentType.includes("wav") || looksLikeRiff(raw)
    ? raw
    : pcm16ToWav(raw, Number(process.env.VOICE_GEMINI_TTS_SAMPLE_RATE ?? 24_000), Number(process.env.VOICE_GEMINI_TTS_CHANNELS ?? 1));
  return { ok: true, value: { audio: wav, contentType: "audio/wav", model, provider: "gemini" } };
}

async function synthesizeWithGoogleCloudTts(text: string): Promise<
  | { ok: true; value: VoiceSynthesis }
  | { ok: false; status: number; error: string }
> {
  const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY?.trim() || process.env.GOOGLE_TTS_API_KEY?.trim();
  const accessToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN?.trim() || process.env.GOOGLE_TTS_ACCESS_TOKEN?.trim();
  if (!apiKey && !accessToken) return { ok: false, status: 503, error: "google cloud tts provider not configured" };
  if (!hostedFreeTierAllowed("google")) return { ok: false, status: 403, error: "google cloud tts free-tier not confirmed in free-only mode" };
  const maxChars = Number(process.env.VOICE_GOOGLE_TTS_MAX_CHARS_PER_REQUEST ?? 900);
  if (Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    return { ok: false, status: 413, error: "text too long for google cloud tts quota guard" };
  }

  const voiceName = process.env.VOICE_GOOGLE_TTS_VOICE?.trim() || "en-US-Standard-H";
  const languageCode = process.env.VOICE_GOOGLE_TTS_LANGUAGE?.trim() || "en-US";
  const audioEncoding = process.env.VOICE_GOOGLE_TTS_AUDIO_ENCODING?.trim() || "MP3";
  const url = apiKey ? `${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}` : GOOGLE_TTS_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding },
    }),
  });
  if (!upstream.ok) return { ok: false, status: 502, error: await boundedProviderError(upstream, "google cloud tts failed") };
  const payload = await upstream.json().catch(() => null) as { audioContent?: unknown } | null;
  const audioContent = typeof payload?.audioContent === "string" ? payload.audioContent : "";
  if (!audioContent) return { ok: false, status: 502, error: "google cloud tts returned empty audio" };
  return {
    ok: true,
    value: {
      audio: base64ToArrayBuffer(audioContent),
      contentType: contentTypeForGoogleEncoding(audioEncoding),
      model: `google-cloud-tts/${voiceName}`,
      provider: "google",
    },
  };
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function parseRequester(value: unknown): ActorProofBody | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const proof = parsed as Partial<ActorProofBody>;
  const actor = proof.actor;
  if (!actor || actor.kind !== "user" || typeof actor.id !== "string" || typeof actor.name !== "string") return null;
  if (proof.token !== undefined && typeof proof.token !== "string") return null;
  return { actor: { kind: "user", id: actor.id, name: actor.name }, token: proof.token ?? "" };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAudioFile(value: unknown): value is File {
  return !!value && typeof value === "object" && "arrayBuffer" in value && "size" in value && typeof value.size === "number";
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: CORS });
}

function providerExceptionText(fallback: string, error: unknown): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  return message ? `${fallback}: ${message.slice(0, 240)}` : fallback;
}

function freeOnlyMode(): boolean {
  return envFlag(process.env.NODEROOM_FREE_ONLY) || envFlag(process.env.VOICE_FREE_ONLY);
}

function paidVoiceProviderBlocked(): boolean {
  return freeOnlyMode() && !envFlag(process.env.VOICE_ALLOW_PAID_FALLBACK);
}

function hostedFreeTierAllowed(provider: "cloudflare" | "gemini" | "google"): boolean {
  if (!freeOnlyMode()) return true;
  if (provider === "cloudflare") return envFlag(process.env.VOICE_CLOUDFLARE_FREE_TIER_CONFIRMED) || envFlag(process.env.VOICE_ALLOW_METERED_FREE_TIER);
  if (provider === "gemini") return envFlag(process.env.VOICE_GEMINI_TTS_FREE_TIER_CONFIRMED) || envFlag(process.env.VOICE_ALLOW_METERED_FREE_TIER);
  return envFlag(process.env.VOICE_GOOGLE_TTS_FREE_TIER_CONFIRMED) || envFlag(process.env.VOICE_ALLOW_METERED_FREE_TIER);
}

function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function boundedProviderError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  return (text.trim() || fallback).slice(0, 500);
}

function mimeTypeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const clean = value.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outputLength = Math.floor(clean.length * 3 / 4) - padding;
  const bytes = new Uint8Array(Math.max(0, outputLength));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of clean) {
    if (char === "=") break;
    const code = base64Value(char);
    if (code < 0) continue;
    buffer = (buffer << 6) | code;
    bits += 6;
    if (bits >= 8 && offset < bytes.length) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  return bytes.buffer;
}

function base64Value(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (char === "+") return 62;
  if (char === "/") return 63;
  return -1;
}

function geminiTtsPrompt(text: string): string {
  const instructions = process.env.VOICE_GEMINI_TTS_INSTRUCTIONS?.trim() || "Read clearly and concisely for a collaborative work room.";
  return `${instructions}\n\n${text}`;
}

function cloudflareAudioBase64(payloadText: string): string {
  const payload = safeJson(payloadText) as { result?: { audio?: unknown } } | null;
  if (typeof payload?.result?.audio === "string") return payload.result.audio;
  const match = payloadText.match(/"audio"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? "";
}

function compactCloudflareAudio(audio: ArrayBuffer): { audio: ArrayBuffer; contentType: string } {
  if (!looksLikeRiff(audio)) return { audio, contentType: "audio/mpeg" };
  const maxBytes = Number(process.env.VOICE_CLOUDFLARE_TTS_MAX_BYTES ?? 96_000);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || audio.byteLength <= maxBytes) return { audio, contentType: "audio/wav" };
  return { audio: downsampleWavPcm16(audio, Number(process.env.VOICE_CLOUDFLARE_TTS_SAMPLE_RATE ?? 16_000)) ?? audio, contentType: "audio/wav" };
}

function downsampleWavPcm16(wav: ArrayBuffer, targetSampleRate: number): ArrayBuffer | null {
  const view = new DataView(wav);
  if (!looksLikeRiff(wav) || asciiAt(view, 8, 4) !== "WAVE") return null;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = asciiAt(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16) {
      audioFormat = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    }
    if (id === "data") {
      dataOffset = start;
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (audioFormat !== 1 || !channels || !sampleRate || bitsPerSample !== 16 || !dataOffset || !dataSize) return null;
  const targetRate = Math.max(8_000, Math.min(sampleRate, Math.floor(targetSampleRate || 16_000)));
  if (targetRate >= sampleRate) return wav;
  const source = new Int16Array(wav.slice(dataOffset, dataOffset + dataSize));
  const sourceFrames = Math.floor(source.length / channels);
  const targetFrames = Math.max(1, Math.floor(sourceFrames * targetRate / sampleRate));
  const target = new Int16Array(targetFrames);
  for (let frame = 0; frame < targetFrames; frame += 1) {
    const sourceFrame = Math.min(sourceFrames - 1, Math.floor(frame * sampleRate / targetRate));
    let sample = 0;
    for (let channel = 0; channel < channels; channel += 1) sample += source[sourceFrame * channels + channel] ?? 0;
    target[frame] = Math.max(-32768, Math.min(32767, Math.round(sample / channels)));
  }
  return pcm16ToWav(target.buffer.slice(0), targetRate, 1);
}

function asciiAt(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

function geminiAudioPayload(payload: unknown): { data: string; mimeType?: string } | null {
  const direct = objectValue(payload, "output_audio") ?? objectValue(payload, "outputAudio");
  const directPayload = audioDataFromObject(direct);
  if (directPayload) return directPayload;
  return firstInlineAudioPayload(payload);
}

function audioDataFromObject(value: unknown): { data: string; mimeType?: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const data = typeof record.data === "string" ? record.data : "";
  if (!data) return null;
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : typeof record.mime_type === "string" ? record.mime_type : undefined;
  return { data, mimeType };
}

function firstInlineAudioPayload(value: unknown): { data: string; mimeType?: string } | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstInlineAudioPayload(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const inlineData = objectValue(record, "inlineData") ?? objectValue(record, "inline_data");
  const inlinePayload = audioDataFromObject(inlineData);
  if (inlinePayload) return inlinePayload;
  for (const item of Object.values(record)) {
    const found = firstInlineAudioPayload(item);
    if (found) return found;
  }
  return null;
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function looksLikeRiff(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

function pcm16ToWav(pcm: ArrayBuffer, sampleRate: number, channels: number): ArrayBuffer {
  const pcmBytes = new Uint8Array(pcm);
  const wav = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(wav);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(wav, 44).set(pcmBytes);
  return wav;
}

function contentTypeForGoogleEncoding(encoding: string): string {
  const normalized = encoding.trim().toUpperCase();
  if (normalized === "OGG_OPUS") return "audio/ogg";
  if (normalized === "LINEAR16") return "audio/wav";
  return "audio/mpeg";
}
