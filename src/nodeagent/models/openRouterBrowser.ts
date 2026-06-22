/**
 * Browser-safe OpenRouter model adapter — used ONLY from the memory-lane
 * benchmark dispatcher path. Reads `import.meta.env.VITE_OPENROUTER_API_KEY` at
 * BUILD time (Vite inlines `import.meta.env.VITE_*` so the key only ships when
 * the env var was present when the bundle was built; CI/Vercel builds without
 * the var produce a bundle with the literal string `undefined` and the helpers
 * here return `null`).
 *
 * Why a separate adapter from `adapter.ts`?
 *   - `adapter.ts` imports `@ai-sdk/openai` + reads `process.env` → Node-only.
 *   - Vercel CSP `connect-src` MUST include `https://openrouter.ai` for direct
 *     browser fetches to succeed; see vercel.json (added in the same change).
 *   - Live OpenRouter calls from the browser ONLY fire on the `@bench:` path so
 *     non-bench memory-lane chats keep the deterministic scripted plan and
 *     never burn unprompted API spend.
 *
 * Safety contract:
 *   - Never logs the key (we don't `console.log(apiKey)`; we pass it to fetch).
 *   - Never calls fetch when the key is missing — the dispatcher reports an
 *     honest "no model key configured; dispatcher is dry-run only" message.
 *   - Returns null (not a fake AgentModel) when env is missing so callers can
 *     branch — preventing the "fake PASS" failure mode in the agentic
 *     reliability checklist (HONEST_STATUS).
 */

import type { AgentModel, AgentMessage, AgentStep, AgentTool, ToolCall } from "../core/types";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Default model id used when the dispatcher doesn't pass an explicit one.
 *  Cheap + tool-calling-capable; can be overridden via VITE_OPENROUTER_MODEL. */
export const DEFAULT_BROWSER_MODEL_ID = "openai/gpt-4o-mini";

/** Read a build-time env var. Returns `undefined` if not set OR set to the literal "undefined". */
function readBuildEnv(name: "VITE_OPENROUTER_API_KEY" | "VITE_OPENROUTER_MODEL"): string | undefined {
  // Access via the env object (Vite static-replaces `import.meta.env.VITE_*` at build time).
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const raw = env?.[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "undefined") return undefined;
  return trimmed;
}

/** True when a VITE_OPENROUTER_API_KEY was baked into this bundle. Safe to call anywhere. */
export function hasBrowserOpenRouterKey(): boolean {
  return readBuildEnv("VITE_OPENROUTER_API_KEY") !== undefined;
}

/** Resolved model id (override via VITE_OPENROUTER_MODEL, else DEFAULT_BROWSER_MODEL_ID). */
export function browserModelId(): string {
  return readBuildEnv("VITE_OPENROUTER_MODEL") ?? DEFAULT_BROWSER_MODEL_ID;
}

/**
 * Minimal Zod-3-object → JSON-Schema converter scoped to the shapes the
 * benchmark tools actually use (object with string/number/boolean/enum/array
 * properties). Avoids pulling a Node-only converter into the browser bundle.
 *
 * Falls back to `{ type: "object", additionalProperties: true }` for shapes the
 * converter doesn't recognize — the OpenRouter tool call still works because
 * the runtime re-validates the parsed args with the real zod schema before
 * dispatching to `tool.execute` (runtime.ts line ~172).
 */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const node = schema as { _def?: { typeName?: string; shape?: () => Record<string, unknown>; type?: unknown; values?: unknown[]; innerType?: unknown } };
  const def = node?._def;
  if (!def) return { type: "object", additionalProperties: true };
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, inner] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(inner);
        const innerDef = (inner as { _def?: { typeName?: string } })._def;
        if (innerDef?.typeName !== "ZodOptional" && innerDef?.typeName !== "ZodDefault" && innerDef?.typeName !== "ZodNullable") {
          required.push(key);
        }
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodArray": return { type: "array", items: zodToJsonSchema(def.type) };
    case "ZodEnum": return { type: "string", enum: def.values as string[] };
    case "ZodLiteral": return { const: (def as { value?: unknown }).value };
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return zodToJsonSchema(def.innerType);
    case "ZodUnion": {
      const opts = (def as { options?: unknown[] }).options ?? [];
      return { anyOf: opts.map((o) => zodToJsonSchema(o)) };
    }
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return { type: "object", additionalProperties: true };
  }
}

/** Convert nodeagent AgentMessage[] to OpenAI Chat Completions message format. */
function toOpenAIMessages(system: string, messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const entry: Record<string, unknown> = { role: "assistant", content: m.content || "" };
      if (m.toolCalls && m.toolCalls.length > 0) {
        entry.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.tool, arguments: JSON.stringify(tc.args ?? {}) },
        }));
      }
      out.push(entry);
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId ?? "", name: m.toolName ?? "", content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** Convert nodeagent tools to OpenAI/OpenRouter tool definitions. */
function toOpenAITools(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    },
  }));
}

export type LiveOpenRouterOptions = {
  modelId?: string;
  /** Site URL header (OpenRouter requires it for free models + analytics). */
  referer?: string;
  /** App name header. */
  appName?: string;
  /** Max tokens per completion (default 1024 — enough for our short tool-calling turns). */
  maxTokens?: number;
};

/**
 * Build a live OpenRouter-backed `AgentModel` that runs in the browser.
 *
 * Returns `null` when VITE_OPENROUTER_API_KEY is missing — callers MUST handle
 * this branch (the BenchmarkDispatcher emits an honest "dry-run only" message
 * and falls back to the deterministic scripted planner).
 */
export function liveOpenRouterModel(opts: LiveOpenRouterOptions = {}): AgentModel | null {
  const apiKey = readBuildEnv("VITE_OPENROUTER_API_KEY");
  if (!apiKey) return null;
  const modelId = opts.modelId ?? browserModelId();
  const referer = opts.referer ?? (typeof window !== "undefined" ? window.location.origin : "https://noderoom.live");
  const appName = opts.appName ?? "NodeRoom Benchmark Dispatcher";
  const maxTokens = opts.maxTokens ?? 1024;

  return {
    name: `openrouter:${modelId}`,
    async next({ system, messages, tools, signal }): Promise<AgentStep> {
      const body = {
        model: modelId,
        messages: toOpenAIMessages(system, messages),
        tools: tools.length > 0 ? toOpenAITools(tools) : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        max_tokens: maxTokens,
        temperature: 0.2,
      };
      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          // The key is sent over TLS to OpenRouter; never logged client-side.
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          // Optional but recommended by OpenRouter for free-tier routing & analytics.
          "http-referer": referer,
          "x-title": appName,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        // Surface a structured error to the runtime — the runtime treats thrown
        // errors as `runtime_error` handoffs (not a silent dishonest success).
        const text = await res.text().catch(() => "");
        throw new Error(`openrouter ${res.status}: ${text.slice(0, 240)}`);
      }
      const json = await res.json() as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      const msg = choice?.message;
      const rawToolCalls = msg?.tool_calls ?? [];
      const toolCalls: ToolCall[] = rawToolCalls.map((tc, i) => {
        let args: Record<string, unknown> = {};
        try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; }
        catch { args = {}; }
        return { id: tc.id || `or_${Date.now()}_${i}`, tool: tc.function.name, args };
      });
      const text = msg?.content ?? "";
      const done = toolCalls.length === 0 && (choice?.finish_reason === "stop" || !!text);
      return {
        text: text || undefined,
        toolCalls,
        done,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
