import type { AgentMessage, AgentModel, AgentStep, AgentTool, AgentToolChoice, RoomTools, ToolCall } from "../core/types";
import { runAgent } from "../core/runtime";
import { normalizeInteropModelRoute } from "./modelInterop";

export type LangChainMessageLike = {
  role?: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
  additional_kwargs?: Record<string, unknown>;
};

export type LangChainChatModelLike = {
  name?: string;
  model?: string;
  modelName?: string;
  lc_id?: () => string[];
  bindTools?: (tools: LangChainToolLike[], config?: Record<string, unknown>) => LangChainChatModelLike;
  invoke(input: LangChainMessageLike[] | unknown, config?: Record<string, unknown>): Promise<unknown>;
};

export type LangChainToolLike = {
  name: string;
  description: string;
  schema?: unknown;
  invoke?: (args: unknown) => Promise<unknown>;
  call?: (args: unknown) => Promise<unknown>;
  func?: (args: unknown) => Promise<unknown>;
};

export type LangChainAgentModelOptions = {
  name?: string;
  route?: string;
  invocationConfig?: Record<string, unknown>;
};

export function createLangChainAgentModel(chatModel: LangChainChatModelLike, options: LangChainAgentModelOptions = {}): AgentModel {
  const route = normalizeInteropModelRoute(options.route ?? modelNameFor(chatModel));
  const name = options.name ?? `langchain:${route.provider}:${route.modelId}`;
  return {
    name,
    async next({ system, messages, tools, signal, onTextDelta, toolChoice }): Promise<AgentStep> {
      const toolDefs = langChainToolDefinitions(tools);
      const runnable = typeof chatModel.bindTools === "function" && toolDefs.length
        ? chatModel.bindTools(toolDefs, langChainToolChoiceConfig(toolChoice))
        : chatModel;
      const output = await runnable.invoke(
        toLangChainMessages(system, messages),
        { ...options.invocationConfig, signal },
      );
      const normalized = normalizeLangChainModelOutput(output);
      if (normalized.text && onTextDelta) await onTextDelta(normalized.text);
      return normalized;
    },
  };
}

export function nodeAgentAsRunnable(args: {
  rt: RoomTools;
  model: AgentModel;
  tools: AgentTool[];
  systemPrompt?: string;
  maxSteps?: number;
  contextBuilder?: Parameters<typeof runAgent>[0]["contextBuilder"];
}) {
  return {
    name: "noderoom-nodeagent",
    async invoke(input: string | { goal?: string; input?: string; question?: string }, config: Record<string, unknown> = {}) {
      const goal = typeof input === "string"
        ? input
        : input.goal ?? input.input ?? input.question ?? "";
      return runAgent({
        rt: args.rt,
        model: args.model,
        tools: args.tools,
        goal,
        maxSteps: typeof config.maxSteps === "number" ? config.maxSteps : args.maxSteps,
        systemPrompt: args.systemPrompt,
        contextBuilder: args.contextBuilder,
      });
    },
  };
}

export function roomToolAsLangChainTool(tool: AgentTool, rt: RoomTools): LangChainToolLike {
  const invoke = async (args: unknown) => tool.execute(args, rt);
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    invoke,
    call: invoke,
    func: invoke,
  };
}

export function toLangChainMessages(system: string, messages: AgentMessage[]): LangChainMessageLike[] {
  return [
    { role: "system", content: system },
    ...messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          name: message.toolName,
          tool_call_id: message.toolCallId,
        };
      }
      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls?.map(toLangChainToolCall),
        };
      }
      return { role: "user", content: message.content };
    }),
  ];
}

export function langChainToolDefinitions(tools: AgentTool[]): LangChainToolLike[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
  }));
}

export function normalizeLangChainModelOutput(output: unknown): AgentStep {
  const object = objectRecord(output);
  const text = extractText(object ?? output);
  const toolCalls = extractToolCalls(object);
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    usage: extractUsage(object),
  };
}

function toLangChainToolCall(call: ToolCall): Record<string, unknown> {
  return {
    id: call.id,
    name: call.tool,
    args: call.args,
    additional_kwargs: call.providerMetadata,
  };
}

function extractToolCalls(output: Record<string, unknown> | undefined): ToolCall[] {
  const calls = [
    ...arrayValue(output?.tool_calls),
    ...arrayValue(output?.toolCalls),
    ...arrayValue(objectRecord(output?.additional_kwargs)?.tool_calls),
  ];
  return calls.map((raw, index) => {
    const call = objectRecord(raw) ?? {};
    const fn = objectRecord(call.function);
    return {
      id: stringValue(call.id) || stringValue(call.tool_call_id) || `langchain_tool_${index + 1}`,
      tool: stringValue(call.name) || stringValue(call.toolName) || stringValue(fn?.name),
      args: argsValue(call.args ?? call.input ?? fn?.arguments),
      providerMetadata: objectRecord(call.additional_kwargs) ?? objectRecord(call.providerMetadata),
    };
  }).filter((call) => call.tool);
}

function extractUsage(output: Record<string, unknown> | undefined): AgentStep["usage"] {
  const usage = objectRecord(output?.usage_metadata)
    ?? objectRecord(output?.usage)
    ?? objectRecord(objectRecord(output?.response_metadata)?.tokenUsage)
    ?? objectRecord(objectRecord(output?.response_metadata)?.usage);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens ?? usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens);
  const outputTokens = numberValue(usage.output_tokens ?? usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: numberValue(usage.cached_input_tokens ?? usage.cachedInputTokens),
  };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("");
  const object = objectRecord(value);
  if (!object) return "";
  if (typeof object.text === "string") return object.text;
  if (typeof object.content === "string") return object.content;
  if (Array.isArray(object.content)) return object.content.map(extractText).filter(Boolean).join("");
  if (typeof object.kwargs === "object") return extractText((object.kwargs as Record<string, unknown>).content);
  return "";
}

function argsValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return objectRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return objectRecord(value) ?? {};
}

function langChainToolChoiceConfig(toolChoice?: AgentToolChoice): Record<string, unknown> {
  return toolChoice === "required" ? { tool_choice: "any" } : {};
}

function modelNameFor(model: LangChainChatModelLike): string {
  if (typeof model.model === "string") return model.model;
  if (typeof model.modelName === "string") return model.modelName;
  if (typeof model.name === "string") return model.name;
  const id = model.lc_id?.();
  return id?.join(":") || "langchain:unknown:model";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
