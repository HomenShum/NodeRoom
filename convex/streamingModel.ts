/**
 * Provider token streaming for the private NodeAgent reply — the generation half of the
 * persistent-text-streaming integration (convex/streaming.ts owns persistence, convex/http.ts
 * owns the route). True SSE for Gemini and every OpenAI-compatible endpoint (OpenRouter hosts
 * the rest of the supported catalog); the same PII firewall as convexModel runs before the
 * prompt leaves. No tools here on purpose: the private agent is a read-only consult, so this is
 * a single streamed completion — the exact shape the component is built for.
 */
import { redactPII } from "../src/nodeagent/guardrails/gateway";
import { assertProviderRouteAllowed } from "../src/nodeagent/guardrails/egressPolicy";
import { openAiCompatibleTokenLimitParam } from "../src/nodeagent/models/openAiTokenLimit";

export type StreamAppend = (text: string) => Promise<void>;

const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(optionalEnv(name) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function maxOutputTokens(): number {
  return envNumber("PRIVATE_AGENT_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS, 1_024, 16_000);
}

function openAiCompatibleProviderOptions(modelId: string, endpoint: string): Record<string, unknown> {
  if (!isOpenRouterEndpoint(endpoint) || !/^z-ai\/glm-|^glm-/i.test(modelId)) return {};
  return { chat_template_kwargs: { enable_thinking: false } };
}

function isOpenRouterEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.includes("openrouter.ai");
  } catch {
    return endpoint.includes("openrouter");
  }
}

/** Stream the reply token-by-token into `append`; resolves with the full accumulated text. */
export async function streamPrivateReplyText(
  modelId: string,
  system: string,
  userMsg: string,
  append: StreamAppend,
): Promise<string> {
  const route = assertProviderRouteAllowed({ model: modelId, entrypoint: "private_agent", env: process.env });
  const safeSystem = redactPII(system).text;
  const safeUser = redactPII(userMsg).text;
  if (route.provider === "gemini") return geminiStream(route.resolvedModel, safeSystem, safeUser, append);
  if (route.provider === "openai") {
    return openAiCompatibleStream(
      "https://api.openai.com/v1/chat/completions",
      requireEnv("OPENAI_API_KEY"), {}, route.resolvedModel, safeSystem, safeUser, append,
    );
  }
  // vendor/model ids (deepseek/…, anthropic/…, z-ai/…) ride OpenRouter's OpenAI-compatible SSE.
  if (route.provider !== "openrouter") throw new Error(`private_stream_provider_unsupported:${route.provider}`);
  const openRouterBaseUrl = optionalEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
  return openAiCompatibleStream(
    `${openRouterBaseUrl}/chat/completions`,
    requireEnv("OPENROUTER_API_KEY"),
    { "HTTP-Referer": "https://noderoom.live", "X-Title": "NodeRoom" },
    route.resolvedModel, safeSystem, safeUser, append,
  );
}

/** Minimal SSE line reader: handles cross-chunk line splits; awaits the handler so chunk order
 *  (and therefore the component's persisted order) is preserved. */
async function readSse(res: Response, onData: (data: string) => Promise<void>): Promise<void> {
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`stream HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      await onData(data);
    }
  }
}

async function geminiStream(modelId: string, system: string, userMsg: string, append: StreamAppend): Promise<string> {
  const key = requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: { maxOutputTokens: maxOutputTokens() },
    }),
  });
  let full = "";
  await readSse(res, async (data) => {
    try {
      const parsed = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const delta = (parsed.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (delta) { full += delta; await append(delta); }
    } catch { /* non-JSON keepalive line — skip */ }
  });
  return full;
}

async function openAiCompatibleStream(
  endpoint: string,
  apiKey: string,
  extraHeaders: Record<string, string>,
  modelId: string,
  system: string,
  userMsg: string,
  append: StreamAppend,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      ...openAiCompatibleTokenLimitParam(modelId, endpoint, maxOutputTokens()),
      ...openAiCompatibleProviderOptions(modelId, endpoint),
      messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
    }),
  });
  let full = "";
  await readSse(res, async (data) => {
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = parsed.choices?.[0]?.delta?.content ?? "";
      if (delta) { full += delta; await append(delta); }
    } catch { /* keepalive/comment line — skip */ }
  });
  return full;
}
