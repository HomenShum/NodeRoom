/**
 * convex/modelProxy.ts
 *
 * Server-side proxy for OpenRouter chat completions. The browser must NEVER
 * hold an OpenRouter API key (see scripts/security-gate.ts — VITE_OPENROUTER_*
 * is in the frontendSecretEnvPattern and openrouter.ai/api is in
 * forbiddenBrowserProviders). This action is the only sanctioned lane for
 * @bench:* live LLM calls to reach OpenRouter from a NodeRoom surface.
 *
 * Contract:
 *   action openRouterChat({ taskId, instruction, prompt, model, responseSchema? })
 *     -> { content, error, model, dryRun }
 *
 * Behavior:
 *   - If OPENROUTER_API_KEY is missing in the Convex deployment env, returns
 *     dryRun=true with a friendly error string. The key is NEVER logged.
 *   - Per-session rate limit (in-memory, best-effort) of 30 calls/min.
 *     Convex actions are stateless across cold starts, so this is a soft
 *     ceiling for hot-instance abuse; harder limits live in convex/sec.ts.
 *   - Input validation: instruction length cap + model allow-list.
 *   - 60s outbound timeout via AbortController.
 *   - Returns only the assistant message content (no raw provider payload).
 */

import { v } from "convex/values";
import { action } from "./_generated/server";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_INSTRUCTION_CHARS = 20_000;
const RATE_LIMIT_PER_MIN = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const ALLOWED_MODELS: ReadonlySet<string> = new Set([
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "openai/gpt-4.1-mini",
]);

// Best-effort per-session counter. Lives in module scope; reset on cold start.
// Hot instances will enforce; cold-starts mean we under-count, never over-count.
const rateBuckets: Map<string, { count: number; windowStart: number }> = new Map();

function checkRateLimit(sessionKey: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(sessionKey);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(sessionKey, { count: 1, windowStart: now });
    return { ok: true, retryAfterMs: 0 };
  }
  if (bucket.count >= RATE_LIMIT_PER_MIN) {
    return {
      ok: false,
      retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart),
    };
  }
  bucket.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

// Cheap GC so the map can't grow unbounded across the lifetime of a hot instance.
function gcRateBuckets(): void {
  if (rateBuckets.size < 512) return;
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(key);
  }
}

type OpenRouterChoice = {
  message?: { role?: string; content?: string | null };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: string | number };
};

export const openRouterChat = action({
  args: {
    taskId: v.string(),
    instruction: v.string(),
    prompt: v.string(),
    model: v.string(),
    responseSchema: v.optional(v.any()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    content: string | null;
    error: string | null;
    model: string;
    dryRun: boolean;
  }> => {
    const { taskId, instruction, prompt, model, responseSchema } = args;
    const modelOut = model;

    // 1) Key presence check. Friendly dryRun if missing — NEVER log the key itself.
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey.length < 8) {
      return {
        content: null,
        error:
          "OPENROUTER_API_KEY is not configured on this Convex deployment. " +
          "Set it via `npx convex env set OPENROUTER_API_KEY <key> --prod` and retry.",
        model: modelOut,
        dryRun: true,
      };
    }

    // 2) Input validation.
    if (typeof instruction !== "string" || instruction.length === 0) {
      return {
        content: null,
        error: "instruction must be a non-empty string.",
        model: modelOut,
        dryRun: false,
      };
    }
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      return {
        content: null,
        error: `instruction exceeds ${MAX_INSTRUCTION_CHARS} chars (got ${instruction.length}).`,
        model: modelOut,
        dryRun: false,
      };
    }
    if (typeof prompt !== "string") {
      return {
        content: null,
        error: "prompt must be a string.",
        model: modelOut,
        dryRun: false,
      };
    }
    if (!ALLOWED_MODELS.has(model)) {
      return {
        content: null,
        error: `model '${model}' is not in the allow-list. Permitted: ${[...ALLOWED_MODELS].join(", ")}.`,
        model: modelOut,
        dryRun: false,
      };
    }

    // 3) Rate limit, scoped to taskId (proxy for session in current dispatcher
    // contract). Per global rule (Agentic reliability #1 BOUND): map has GC + cap.
    gcRateBuckets();
    const rate = checkRateLimit(taskId);
    if (!rate.ok) {
      return {
        content: null,
        error: `Rate limit: ${RATE_LIMIT_PER_MIN} calls/min/session. Retry in ${Math.ceil(rate.retryAfterMs / 1000)}s.`,
        model: modelOut,
        dryRun: false,
      };
    }

    // 4) Build the OpenRouter request. Vercel-AI-SDK style: messages array
    // with system + user roles. Structured-output hint piggybacks via the
    // optional responseSchema arg (OpenRouter passes it through to providers
    // that support JSON-mode; harmless to those that don't).
    const messages = [
      { role: "system" as const, content: instruction },
      { role: "user" as const, content: prompt },
    ];

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    };
    if (responseSchema && typeof responseSchema === "object") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: `bench_${taskId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`,
          strict: true,
          schema: responseSchema,
        },
      };
    }

    // 5) Outbound fetch with 60s timeout.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "http-referer": "https://noderoom.app",
          "x-title": "NodeRoom Benchmark Proxy",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      const aborted = (err as { name?: string })?.name === "AbortError";
      return {
        content: null,
        error: aborted
          ? `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
          : `OpenRouter network error: ${(err as Error)?.message ?? "unknown"}.`,
        model: modelOut,
        dryRun: false,
      };
    }
    clearTimeout(timeoutHandle);

    if (!response.ok) {
      // Read at most ~4KB of the body so we never spill a giant provider payload
      // into Convex logs. Status code is the trustworthy signal here.
      let snippet = "";
      try {
        const text = await response.text();
        snippet = text.slice(0, 4096);
      } catch {
        snippet = "<unreadable body>";
      }
      return {
        content: null,
        error: `OpenRouter HTTP ${response.status}: ${snippet}`,
        model: modelOut,
        dryRun: false,
      };
    }

    let parsed: OpenRouterResponse;
    try {
      parsed = (await response.json()) as OpenRouterResponse;
    } catch (err) {
      return {
        content: null,
        error: `OpenRouter returned non-JSON: ${(err as Error)?.message ?? "parse failed"}.`,
        model: modelOut,
        dryRun: false,
      };
    }

    if (parsed.error?.message) {
      return {
        content: null,
        error: `OpenRouter error: ${parsed.error.message}`,
        model: modelOut,
        dryRun: false,
      };
    }

    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
    const content =
      typeof choice?.message?.content === "string" ? choice.message.content : null;

    if (content === null) {
      return {
        content: null,
        error: "OpenRouter response did not include assistant message content.",
        model: modelOut,
        dryRun: false,
      };
    }

    return {
      content,
      error: null,
      model: modelOut,
      dryRun: false,
    };
  },
});
