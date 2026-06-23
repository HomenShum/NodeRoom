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

type OpenAiChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: OpenAiChatResponse["usage"];
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
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const TRANSIENT_RE = /(\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable)/i;

export function convexModel(modelId: string, options: { entrypoint?: ProviderRouteEntrypoint } = {}): AgentModel {
  const aliasModelId = resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  let resolvedModelId = aliasModelId;
  return {
    get name() {
      return resolvedModelId;
    },
    async next({ system, messages, tools, signal, onTextDelta }) {
      // Gateway PII firewall — redact PII/secrets from the system + user content before the prompt leaves.
      const safeSystem = redactPII(system).text;
      const safeMessages = messages.map((m) => (m.role === "user" && m.content ? { ...m, content: redactPII(m.content).text } : m));
      const { step, resolvedModel } = await generateConvexAgentStep(aliasModelId, safeSystem, safeMessages, tools, entrypoint, signal, onTextDelta);
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
  onTextDelta?: (text: string) => void | Promise<void>,
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
            apiKey: envValue("OPENROUTER_API_KEY"),
            headers: openRouterHeaders(),
            modelId: candidate.id,
            system,
            messages,
            tools,
            signal,
            onTextDelta,
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
      step: withProviderRoute(await withRetry(() => providerStep(modelId, system, messages, tools, signal, onTextDelta), signal), providerRoute),
      resolvedModel: modelId,
    };
  } catch (error) {
    const fb = fallbackModelFor(modelId);
    if (!fb || signal?.aborted) throw error;
    const providerRoute = assertProviderRouteAllowed({ model: fb, entrypoint, env: process.env });
    return {
      step: withProviderRoute(await withRetry(() => providerStep(fb, system, messages, tools, signal, onTextDelta), signal), providerRoute),
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
  onTextDelta?: (text: string) => void | Promise<void>,
) {
  const provider = getProviderForModel(modelId);
  if (provider === "openai") {
    return openAiCompatibleStep({
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: requireEnv("OPENAI_API_KEY"),
      headers: {},
      modelId,
      system,
      messages,
      tools,
      signal,
      onTextDelta,
    });
  }
  if (provider === "openrouter") {
    return openAiCompatibleStep({
      endpoint: `${openRouterBaseUrl()}/chat/completions`,
      apiKey: envValue("OPENROUTER_API_KEY"),
      headers: openRouterHeaders(),
      modelId,
      system,
      messages,
      tools,
      signal,
      onTextDelta,
    });
  }
  if (provider === "anthropic") return anthropicStep(modelId, system, messages, tools, signal);
  if (provider === "gemini") {
    if (onTextDelta) {
      try {
        return await geminiStreamStep(modelId, system, messages, tools, signal, onTextDelta);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    return geminiStep(modelId, system, messages, tools, signal);
  }
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
  onTextDelta?: (text: string) => void | Promise<void>;
}) {
  if (args.onTextDelta) {
    try {
      return await openAiCompatibleStreamStep({ ...args, onTextDelta: args.onTextDelta });
    } catch (error) {
      if (args.signal?.aborted) throw error;
      // Some OpenAI-compatible providers/models reject stream_options or tool streaming. Keep the
      // durable job reliable by falling back to the established blocking request path.
    }
  }

  return openAiCompatibleBlockingStep(args);
}

async function openAiCompatibleBlockingStep(args: {
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
    ...openAiCompatibleTokenLimitParam(args.modelId, args.endpoint, modelMaxOutputTokens()),
    ...openAiCompatibleProviderOptions(args.modelId, args.endpoint),
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

async function openAiCompatibleStreamStep(args: {
  endpoint: string;
  apiKey?: string;
  headers: Record<string, string>;
  modelId: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  onTextDelta: (text: string) => void | Promise<void>;
}) {
  const res = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...args.headers,
      ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
    },
    body: JSON.stringify(removeUndefined({
      model: args.modelId,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: args.system }, ...toOpenAiMessages(args.messages)],
      tools: args.tools.length ? args.tools.map(openAiTool) : undefined,
      tool_choice: args.tools.length ? "auto" : undefined,
      ...openAiCompatibleTokenLimitParam(args.modelId, args.endpoint, modelMaxOutputTokens()),
      ...openAiCompatibleProviderOptions(args.modelId, args.endpoint),
    })),
    signal: args.signal,
  });

  const toolCallParts = new Map<number, { id?: string; name?: string; argsText: string }>();
  let text = "";
  let usage: OpenAiChatResponse["usage"] | undefined;

  await readSse(res, async (data) => {
    let parsed: OpenAiChatStreamChunk;
    try {
      parsed = JSON.parse(data) as OpenAiChatStreamChunk;
    } catch {
      return;
    }
    if (parsed.usage) usage = parsed.usage;
    for (const choice of parsed.choices ?? []) {
      const delta = choice.delta;
      const textDelta = delta?.content ?? "";
      if (textDelta) {
        text += textDelta;
        await args.onTextDelta(textDelta);
      }
      for (const toolDelta of delta?.tool_calls ?? []) {
        const index = typeof toolDelta.index === "number" ? toolDelta.index : toolCallParts.size;
        const current = toolCallParts.get(index) ?? { argsText: "" };
        if (toolDelta.id) current.id = toolDelta.id;
        if (toolDelta.function?.name) current.name = toolDelta.function.name;
        if (toolDelta.function?.arguments) current.argsText += toolDelta.function.arguments;
        toolCallParts.set(index, current);
      }
    }
  });

  const toolCalls = [...toolCallParts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]): ToolCall => ({
      id: tc.id || crypto.randomUUID(),
      tool: tc.name ?? "unknown_tool",
      args: parseJsonObject(tc.argsText || "{}"),
    }));
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: {
      inputTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
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
    max_tokens: modelMaxOutputTokens(),
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
    generationConfig: { maxOutputTokens: modelMaxOutputTokens() },
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

async function geminiStreamStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  onTextDelta: (text: string) => void | Promise<void>,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"))}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(removeUndefined({
      systemInstruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
      tools: tools.length ? [{ functionDeclarations: tools.map(geminiTool) }] : undefined,
      generationConfig: { maxOutputTokens: modelMaxOutputTokens() },
    })),
    signal,
  });

  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: GeminiResponse["usageMetadata"] | undefined;

  await readSse(res, async (data) => {
    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(data) as GeminiResponse;
    } catch {
      return;
    }
    if (parsed.usageMetadata) usage = parsed.usageMetadata;
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if ("text" in part) {
        const delta = part.text ?? "";
        if (delta) {
          text += delta;
          await onTextDelta(delta);
        }
      } else if ("functionCall" in part) {
        toolCalls.push({
          id: crypto.randomUUID(),
          tool: part.functionCall?.name ?? "unknown_tool",
          args: part.functionCall?.args ?? {},
          providerMetadata: part.thoughtSignature || part.thought_signature ? { geminiThoughtSignature: part.thoughtSignature ?? part.thought_signature } : undefined,
        });
      }
    }
  });

  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
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

export function toolParameters(toolName: string): JsonObject {
  const string = { type: "string" };
  const number = { type: "number" };
  const integer = { type: "integer" };
  const boolean = { type: "boolean" };
  const any = {};
  const stringArray = { type: "array", items: string };
  const numberRecord = { type: "object", additionalProperties: number };
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
  const bbox = {
    type: "object",
    properties: {
      x: number,
      y: number,
      width: number,
      height: number,
      unit: { type: "string", enum: ["px", "pt", "normalized"] },
    },
    required: ["x", "y", "width", "height"],
  };
  const op = {
    type: "object",
    properties: { elementId: string, value: any, baseVersion: { type: "integer" } },
    required: ["elementId", "value", "baseVersion"],
  };
  const chartPoint = {
    type: "object",
    properties: { label: string, value: number, sourceRef: string, estimated: boolean },
    required: ["label", "value"],
  };
  const evidenceCardInput = {
    type: "object",
    properties: {
      label: string,
      sourceRef: string,
      quote: string,
      kind: { type: "string", enum: ["source", "upload", "computed", "manual"] },
      confidence: number,
      status: { type: "string", enum: ["verified", "needs_review", "manual", "estimated"] },
    },
    required: ["label"],
  };
  const evidenceCard = {
    type: "object",
    properties: {
      id: string,
      label: string,
      sourceRef: string,
      quote: string,
      kind: { type: "string", enum: ["source", "upload", "computed", "manual"] },
      confidence: number,
      status: { type: "string", enum: ["verified", "needs_review", "manual", "estimated"] },
      reviewNote: string,
    },
    required: ["id", "label", "sourceRef", "quote", "kind", "confidence", "status"],
  };
  const schemas: Record<string, JsonObject> = {
    read_range: { type: "object", properties: { elementIds: stringArray, artifactId: string }, required: ["elementIds"] },
    search_sheet_context: { type: "object", properties: { query: string, artifactId: string, limit: integer }, required: ["query"] },
    list_artifacts: { type: "object", properties: {}, required: [] },
    propose_lock: { type: "object", properties: { elementIds: stringArray, reason: string, artifactId: string }, required: ["elementIds", "reason"] },
    edit_cell: { type: "object", properties: { elementId: string, value: any, baseVersion: integer, kind: { type: "string", enum: ["set", "create", "delete"] }, artifactId: string }, required: ["elementId", "value", "baseVersion"] },
    write_cell_result: {
      type: "object",
      properties: {
        elementId: string,
        value: any,
        baseVersion: integer,
        status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
        confidence: number,
        normalizedValue: any,
        formula: string,
        error: string,
        evidence: { type: "array", items: evidence },
        kind: { type: "string", enum: ["set", "create"] },
        artifactId: string,
      },
      required: ["elementId", "value", "baseVersion", "evidence"],
    },
    update_wiki: {
      type: "object",
      properties: { artifactId: string, content: string, citesArtifactIds: stringArray, baseVersion: integer, elementId: string },
      required: ["artifactId", "content", "citesArtifactIds", "baseVersion"],
    },
    reconcile_cell: {
      type: "object",
      properties: { elementId: string, expectedValue: any, baseVersion: integer, artifactId: string },
      required: ["elementId", "expectedValue", "baseVersion"],
    },
    run_algorithm_artifact: {
      type: "object",
      properties: {
        artifactId: string,
        artifact: {
          type: "object",
          properties: {
            schema: integer,
            algorithmId: string,
            name: string,
            description: string,
            kind: { type: "string", enum: ["spreadsheet_formula"] },
            language: { type: "string", enum: ["formula_dsl", "noderoom_dsl"] },
            inputs: { type: "array", items: { type: "object", properties: { id: string, elementId: string, label: string }, required: ["id", "elementId"] } },
            outputs: { type: "array", items: { type: "object", properties: { id: string, elementId: string, expression: string, format: { type: "string", enum: ["number", "currency", "percent"] }, label: string }, required: ["id", "elementId", "expression"] } },
            constraints: { type: "object", properties: { deterministic: boolean, noNetwork: boolean, noRandom: boolean, noDateNow: boolean, maxInputs: integer, maxOutputs: integer } },
            evidencePolicy: { type: "object", properties: { requireSourceCells: boolean } },
            tests: { type: "array", items: { type: "object", properties: { name: string, inputs: numberRecord, expected: numberRecord, tolerance: number }, required: ["name", "inputs", "expected"] } },
          },
          required: ["schema", "algorithmId", "name", "kind", "language", "inputs", "outputs"],
        },
      },
      required: ["artifact"],
    },
    create_draft: { type: "object", properties: { ops: { type: "array", items: op }, blockedByLockId: string, note: string, artifactId: string }, required: ["ops", "blockedByLockId", "note"] },
    release_lock: { type: "object", properties: { lockId: string }, required: ["lockId"] },
    say: { type: "object", properties: { text: string }, required: ["text"] },
    fetch_source: { type: "object", properties: { url: string }, required: ["url"] },
    write_locked_cell: {
      type: "object",
      properties: { elementId: string, value: any, baseVersion: integer, reason: string, artifactId: string },
      required: ["elementId", "value", "baseVersion"],
    },
    write_locked_cells: {
      type: "object",
      properties: { ops: { type: "array", items: op }, reason: string, artifactId: string },
      required: ["ops"],
    },
    write_locked_cell_result: {
      type: "object",
      properties: {
        elementId: string,
        value: any,
        baseVersion: integer,
        status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
        confidence: number,
        normalizedValue: any,
        formula: string,
        error: string,
        evidence: { type: "array", items: evidence },
        artifactId: string,
      },
      required: ["elementId", "value", "baseVersion", "evidence"],
    },
    write_locked_cell_results: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              elementId: string,
              value: any,
              baseVersion: integer,
              status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
              confidence: number,
              normalizedValue: any,
              formula: string,
              error: string,
              evidence: { type: "array", items: evidence },
            },
            required: ["elementId", "value", "baseVersion", "evidence"],
          },
        },
        reason: string,
        artifactId: string,
      },
      required: ["ops"],
    },
    okf_list_concepts: { type: "object", properties: { type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: [] },
    okf_read_concept: { type: "object", properties: { conceptId: string }, required: ["conceptId"] },
    okf_full_text_search: { type: "object", properties: { query: string, fields: { type: "array", items: { type: "string", enum: ["title", "description", "body", "citations"] } }, type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: ["query"] },
    okf_semantic_search: { type: "object", properties: { query: string, type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: ["query"] },
    okf_search_skills: { type: "object", properties: { query: string, skill_categories: stringArray, skill_trust_min: { type: "string", enum: ["untrusted", "community", "verified"] }, limit: integer }, required: ["query"] },
    okf_filter: { type: "object", properties: { type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: [] },
    okf_glob: { type: "object", properties: { pattern: string, limit: integer }, required: ["pattern"] },
    okf_regex: { type: "object", properties: { pattern: string, pathPrefix: string, caseSensitive: boolean, limit: integer }, required: ["pattern"] },
    okf_backlinks: { type: "object", properties: { conceptId: string, depth: integer, limit: integer }, required: ["conceptId"] },
    okf_expand_neighbors: { type: "object", properties: { conceptId: string, linkDepth: integer, includeCitations: boolean, includeBacklinks: boolean, limit: integer }, required: ["conceptId", "linkDepth"] },
    source_resolve_citation: { type: "object", properties: { evidenceId: string }, required: ["evidenceId"] },
    source_open_literal: { type: "object", properties: { sourceArtifactId: string, page: integer, row: number, column: string, bbox }, required: ["sourceArtifactId"] },
    source_compare_claim: {
      type: "object",
      properties: {
        claim: string,
        evidenceRefs: {
          type: "array",
          items: { type: "object", properties: { evidenceId: string, conceptId: string, citationId: string, sourceArtifactId: string }, required: ["evidenceId"] },
        },
      },
      required: ["claim", "evidenceRefs"],
    },
    build_evidence_cards: { type: "object", properties: { evidence: { type: "array", items: evidenceCardInput } }, required: ["evidence"] },
    compute_runway_milestones: { type: "object", properties: { company: string, cashUsd: number, monthlyBurnUsd: number, momGrowthRate: number, source: string }, required: ["company", "cashUsd", "monthlyBurnUsd"] },
    validate_chart_against_source_cells: { type: "object", properties: { sourceCells: numberRecord, series: { type: "array", items: chartPoint }, tolerance: number }, required: ["sourceCells", "series"] },
    render_chart_artifact: { type: "object", properties: { title: string, chartSvg: string, narrative: string, sourceRefs: stringArray }, required: ["title", "chartSvg"] },
    generate_banker_coach_cues: { type: "object", properties: { company: string, claim: string, evidenceCards: { type: "array", items: evidenceCard }, runwayMonths: number, status: string }, required: ["company", "claim", "evidenceCards"] },
    create_review_round_update: { type: "object", properties: { roomTitle: string, company: string, materialChanges: stringArray, openQuestions: stringArray, nextActions: stringArray, sourceRefs: stringArray }, required: ["roomTitle", "materialChanges"] },
    export_downstream_draft: {
      type: "object",
      properties: {
        artifact: {
          type: "object",
          properties: { id: string, title: string, kind: string, body: string, sourceArtifactIds: stringArray, sourceUrls: stringArray, createdAt: number },
          required: ["id", "title", "kind", "body", "sourceArtifactIds", "sourceUrls"],
        },
        destinations: { type: "array", items: { type: "string", enum: ["gmail", "notion", "slack", "linear", "linkedin", "crm_csv"] } },
      },
      required: ["artifact"],
    },
    set_artifact_meta: { type: "object", properties: { artifactId: string, title: string, summary: string, tags: stringArray }, required: ["artifactId"] },
    define_columns: {
      type: "object",
      properties: {
        artifactId: string,
        baseVersion: number,
        mode: { type: "string", enum: ["replace", "merge"] },
        columns: { type: "array", items: { type: "object", properties: { label: string, type: { type: "string", enum: ["text", "number", "date", "currency", "boolean", "json"] }, agentWritable: boolean }, required: ["label"] } },
      },
      required: ["baseVersion", "columns"],
    },
    capture_source: { type: "object", properties: { url: string, goal: string }, required: ["url", "goal"] },
    sec_facts: { type: "object", properties: { company: string, concept: string }, required: ["company", "concept"] },
    cite_in_file: { type: "object", properties: { target: string, label: string, fileName: string }, required: ["target"] },
    skill_search: { type: "object", properties: { query: string, k: integer, skill_categories: stringArray, skill_trust_min: { type: "string", enum: ["untrusted", "community", "verified"] } }, required: ["query"] },
    load_skill: { type: "object", properties: { idOrUrl: string }, required: ["idOrUrl"] },
  };
  return schemas[toolName] ?? { type: "object", properties: {}, required: [] };
}

async function readSse(res: Response, onData: (data: string) => Promise<void>): Promise<void> {
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider stream failed ${res.status}: ${detail.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    await onData(data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await processLine(buffer);
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
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for convexModel provider calls`);
  return value;
}

function openRouterBaseUrl(): string {
  return envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
}

function modelMaxOutputTokens(): number {
  return envNumber("AGENT_MODEL_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS, 1_024, 32_000);
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(envValue(name) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function openAiCompatibleProviderOptions(modelId: string, endpoint: string): JsonObject {
  // GLM reasoning models served through OpenRouter/vLLM can spend the entire output cap on
  // hidden thinking and then return Wafer's "response was truncated" error. Keep NodeAgent
  // tool turns in instruction-following mode unless a caller deliberately overrides the model.
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
  const raw = Number(envValue("OPENROUTER_FREE_AUTO_LIMIT") ?? 8);
  return Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 8;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
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
