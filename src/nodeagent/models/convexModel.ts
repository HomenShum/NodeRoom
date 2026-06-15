/**
 * Convex-safe AgentModel implementation.
 *
 * The local eval/provider-parser path can keep using the Vercel AI SDK, but
 * Convex function modules should avoid importing it directly because the remote
 * analyzer can evaluate bundled dependencies before the Node action runs. This
 * file implements the small AgentModel seam with direct provider HTTP calls.
 */

import type { AgentMessage, AgentModel, AgentStep, AgentTool, ToolCall } from "../core/types";
import { getModelPricing, getProviderForModel, resolveModelAlias } from "./modelCatalog";
import { isOpenRouterFreeAutoModel, selectOpenRouterFreeModels } from "./openRouterFreeModels";
import { openAiCompatibleTokenLimitParam } from "./openAiTokenLimit";
import { redactPII } from "../guardrails/gateway";
import { assertProviderRouteAllowed, type ProviderRouteEntrypoint, type ProviderRouteReceipt } from "../guardrails/egressPolicy";

type JsonObject = Record<string, unknown>;

type OpenAiToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

type AnthropicResponse = {
  content?: Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; id?: string; name?: string; input?: JsonObject }
  >;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<
        | { text?: string }
        | { functionCall?: { name?: string; args?: JsonObject }; thoughtSignature?: string; thought_signature?: string }
      >;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const OPENROUTER_REFERER = "https://noderoom.local";
const OPENROUTER_TITLE = "NodeRoom benchmark";
const DEFAULT_MAX_TOKENS = 1024;
const TRANSIENT_RE = /(\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable)/i;

export function convexModel(modelId: string, options: { entrypoint?: ProviderRouteEntrypoint } = {}): AgentModel {
  const aliasModelId = resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  let resolvedModelId = aliasModelId;
  return {
    get name() {
      return resolvedModelId;
    },
    async next({ system, messages, tools, signal }) {
      // Gateway PII firewall — redact PII/secrets from the system + user content before the prompt leaves.
      const safeSystem = redactPII(system).text;
      const safeMessages = messages.map((m) => (m.role === "user" && m.content ? { ...m, content: redactPII(m.content).text } : m));
      const { step, resolvedModel } = await generateConvexAgentStep(aliasModelId, safeSystem, safeMessages, tools, entrypoint, signal);
      resolvedModelId = resolvedModel;
      return step;
    },
  };
}

export function convexPriceRun(modelId: string, inTok: number, outTok: number): number {
  const pricing = getModelPricing(resolveModelAlias(modelId));
  return (inTok * (pricing?.inputPer1M ?? 1) + outTok * (pricing?.outputPer1M ?? 5)) / 1_000_000;
}

async function generateConvexAgentStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  entrypoint: ProviderRouteEntrypoint,
  signal?: AbortSignal,
) {
  assertProviderRouteAllowed({ model: modelId, entrypoint, env: process.env });
  if (isOpenRouterFreeAutoModel(modelId)) {
    const candidates = await selectOpenRouterFreeModels({
      mode: tools.length ? "agent" : "chat",
      limit: openRouterFreeAutoLimit(),
      signal,
    });
    let lastError: unknown;
    const attempted: string[] = [];
    for (const candidate of candidates) {
      attempted.push(candidate.id);
      try {
        const providerRoute = assertProviderRouteAllowed({ model: candidate.id, entrypoint, env: process.env });
        return {
          step: withProviderRoute(await withRetry(() => openAiCompatibleStep({
            endpoint: `${openRouterBaseUrl()}/chat/completions`,
            apiKey: process.env.OPENROUTER_API_KEY,
            headers: openRouterHeaders(),
            modelId: candidate.id,
            system,
            messages,
            tools,
            signal,
          }), signal), providerRoute),
          resolvedModel: candidate.id,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw new Error(`openrouter/free-auto failed for ${attempted.join(", ")}: ${shortProviderError(lastError)}`);
  }

  try {
    const providerRoute = assertProviderRouteAllowed({ model: modelId, entrypoint, env: process.env });
    return {
      step: withProviderRoute(await withRetry(() => providerStep(modelId, system, messages, tools, signal), signal), providerRoute),
      resolvedModel: modelId,
    };
  } catch (error) {
    const fb = fallbackModelFor(modelId);
    if (!fb || signal?.aborted) throw error;
    const providerRoute = assertProviderRouteAllowed({ model: fb, entrypoint, env: process.env });
    return {
      step: withProviderRoute(await withRetry(() => providerStep(fb, system, messages, tools, signal), signal), providerRoute),
      resolvedModel: fb,
    };
  }
}

async function providerStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
) {
  const provider = getProviderForModel(modelId);
  if (provider === "openai") {
    return openAiCompatibleStep({
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: process.env.OPENAI_API_KEY,
      headers: {},
      modelId,
      system,
      messages,
      tools,
      signal,
    });
  }
  if (provider === "openrouter") {
    return openAiCompatibleStep({
      endpoint: `${openRouterBaseUrl()}/chat/completions`,
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: openRouterHeaders(),
      modelId,
      system,
      messages,
      tools,
      signal,
    });
  }
  if (provider === "anthropic") return anthropicStep(modelId, system, messages, tools, signal);
  if (provider === "gemini") return geminiStep(modelId, system, messages, tools, signal);
  throw new Error(`convexModel(): no provider for "${modelId}"`);
}

async function openAiCompatibleStep(args: {
  endpoint: string;
  apiKey?: string;
  headers: Record<string, string>;
  modelId: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
}) {
  const res = await postJson<OpenAiChatResponse>(args.endpoint, {
    model: args.modelId,
    messages: [{ role: "system", content: args.system }, ...toOpenAiMessages(args.messages)],
    tools: args.tools.length ? args.tools.map(openAiTool) : undefined,
    tool_choice: args.tools.length ? "auto" : undefined,
    ...openAiCompatibleTokenLimitParam(args.modelId, args.endpoint, DEFAULT_MAX_TOKENS),
  }, {
    ...args.headers,
    ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
  }, args.signal);

  const message = res.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((tc): ToolCall => ({
    id: tc.id || crypto.randomUUID(),
    tool: tc.function?.name ?? "unknown_tool",
    args: parseJsonObject(tc.function?.arguments ?? "{}"),
  }));
  return {
    text: message.content || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: {
      inputTokens: res.usage?.prompt_tokens ?? res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? res.usage?.output_tokens ?? 0,
    },
  };
}

async function anthropicStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
) {
  const res = await postJson<AnthropicResponse>("https://api.anthropic.com/v1/messages", {
    model: modelId,
    max_tokens: DEFAULT_MAX_TOKENS,
    system,
    messages: toAnthropicMessages(messages),
    tools: tools.length ? tools.map(anthropicTool) : undefined,
  }, {
    "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
  }, signal);

  const parts = res.content ?? [];
  const text = parts
    .filter((p): p is { type: "text"; text?: string } => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const toolCalls = parts
    .filter((p): p is { type: "tool_use"; id?: string; name?: string; input?: JsonObject } => p.type === "tool_use")
    .map((p): ToolCall => ({
      id: p.id || crypto.randomUUID(),
      tool: p.name ?? "unknown_tool",
      args: p.input ?? {},
    }));
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    },
  };
}

async function geminiStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"))}`;
  const res = await postJson<GeminiResponse>(url, {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    tools: tools.length ? [{ functionDeclarations: tools.map(geminiTool) }] : undefined,
    generationConfig: { maxOutputTokens: DEFAULT_MAX_TOKENS },
  }, {}, signal);

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p): p is { text?: string } => "text" in p)
    .map((p) => p.text ?? "")
    .join("");
  const toolCalls = parts
    .filter((p): p is { functionCall: { name?: string; args?: JsonObject }; thoughtSignature?: string; thought_signature?: string } => "functionCall" in p)
    .map((p): ToolCall => ({
      id: crypto.randomUUID(),
      tool: p.functionCall.name ?? "unknown_tool",
      args: p.functionCall.args ?? {},
      providerMetadata: p.thoughtSignature || p.thought_signature ? { geminiThoughtSignature: p.thoughtSignature ?? p.thought_signature } : undefined,
    }));
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: {
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function toOpenAiMessages(messages: AgentMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.tool, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      name: m.toolName,
      content: m.content,
    };
  });
}

function toAnthropicMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.tool, input: tc.args });
      }
      return { role: "assistant", content };
    }
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      };
    }
    return { role: "user", content: m.content };
  });
}

function toGeminiContents(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        const thoughtSignature = typeof tc.providerMetadata?.geminiThoughtSignature === "string" ? tc.providerMetadata.geminiThoughtSignature : undefined;
        parts.push({
          functionCall: { name: tc.tool, args: tc.args },
          ...(thoughtSignature ? { thoughtSignature } : {}),
        });
      }
      return { role: "model", parts };
    }
    if (m.role === "tool") {
      return {
        role: "user",
        parts: [{
          functionResponse: {
            name: m.toolName,
            response: parseJsonObject(m.content, { result: m.content }),
          },
        }],
      };
    }
    return { role: "user", parts: [{ text: m.content }] };
  });
}

function openAiTool(tool: AgentTool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.name),
    },
  };
}

function anthropicTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: toolParameters(tool.name),
  };
}

function geminiTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toolParameters(tool.name),
  };
}

function toolParameters(toolName: string): JsonObject {
  const string = { type: "string" };
  const number = { type: "number" };
  const any = {};
  const stringArray = { type: "array", items: string };
  const evidence = {
    type: "object",
    properties: {
      id: string,
      kind: { type: "string", enum: ["upload", "source", "computed", "manual"] },
      label: string,
      source: string,
      sourceStorageId: string,
      sourceArtifactId: string,
      providerFileId: string,
      sheetName: string,
      row: number,
      column: string,
      page: number,
      bbox: {
        type: "object",
        properties: {
          x: number,
          y: number,
          width: number,
          height: number,
          unit: { type: "string", enum: ["px", "pt", "normalized"] },
        },
      },
      url: string,
      snippet: string,
      confidence: number,
    },
    required: ["kind", "label"],
  };
  const op = {
    type: "object",
    properties: { elementId: string, value: any, baseVersion: { type: "integer" } },
    required: ["elementId", "value", "baseVersion"],
  };
  const schemas: Record<string, JsonObject> = {
    read_range: { type: "object", properties: { elementIds: stringArray }, required: ["elementIds"] },
    propose_lock: { type: "object", properties: { elementIds: stringArray, reason: string }, required: ["elementIds", "reason"] },
    edit_cell: { type: "object", properties: { elementId: string, value: any, baseVersion: { type: "integer" } }, required: ["elementId", "value", "baseVersion"] },
    write_cell_result: {
      type: "object",
      properties: {
        elementId: string,
        value: any,
        baseVersion: { type: "integer" },
        status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
        confidence: number,
        normalizedValue: any,
        error: string,
        evidence: { type: "array", items: evidence },
      },
      required: ["elementId", "value", "baseVersion", "evidence"],
    },
    create_draft: { type: "object", properties: { ops: { type: "array", items: op }, blockedByLockId: string, note: string }, required: ["ops", "blockedByLockId", "note"] },
    release_lock: { type: "object", properties: { lockId: string }, required: ["lockId"] },
    say: { type: "object", properties: { text: string }, required: ["text"] },
    fetch_source: { type: "object", properties: { url: string }, required: ["url"] },
  };
  return schemas[toolName] ?? { type: "object", properties: {}, required: [] };
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(removeUndefined(body)),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider request failed ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => [key, removeUndefined(val)]),
  );
}

function parseJsonObject(text: string, fallback: JsonObject = {}): JsonObject {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : fallback;
  } catch {
    return fallback;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for convexModel provider calls`);
  return value;
}

function openRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
}

function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": OPENROUTER_REFERER,
    "X-Title": OPENROUTER_TITLE,
  };
}

function fallbackModelFor(modelId: string): string | undefined {
  const fb = process.env.AGENT_FALLBACK_MODEL?.trim();
  return fb && resolveModelAlias(fb) !== modelId ? resolveModelAlias(fb) : undefined;
}

function openRouterFreeAutoLimit(): number {
  const raw = Number(process.env.OPENROUTER_FREE_AUTO_LIMIT ?? 8);
  return Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 8;
}

function withProviderRoute<T extends AgentStep>(step: T, providerRoute: ProviderRouteReceipt): T & { providerRoute: ProviderRouteReceipt } {
  return { ...step, providerRoute };
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "AbortError" || /\baborted\b/i.test(error.message))) return false;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSIENT_RE.test(message);
}

function retryBackoffMs(attempt: number): number {
  const base = 2_000 * Math.pow(3, attempt - 1);
  return base + Math.floor(Math.random() * 0.3 * base);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isTransientError(error) || attempt > maxRetries) throw error;
      await abortableSleep(retryBackoffMs(attempt), signal);
    }
  }
  throw lastError;
}

function shortProviderError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(process.env)) {
    if (value && value.length > 12) message = message.replaceAll(value, "[redacted]");
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}
