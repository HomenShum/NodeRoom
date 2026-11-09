/**
 * NodeAgent universal engine: a provider-agnostic agent loop on the Vercel AI
 * SDK (`ai` streamText) for providers without a native agent SDK. One model
 * request per step; Node executes every tool call itself, so the loop owns
 * tool search (active set changes between steps), helpers (a `delegate` tool
 * running a child loop), compaction, goals/skills (Node tools) and resume
 * (the message list persisted to host.stateDir after every step).
 * Model ids are "provider:model" (anthropic | openai | google | openrouter).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart,
  type ToolSet,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  Capability,
  CapabilityEntry,
  EngineAdapter,
  EngineDescriptor,
  EngineHost,
  EngineRunOutcome,
  HandoffPacket,
  ProviderEnv,
  RunSpec,
  UsageTotals,
} from "../contract.js";
import { emptyUsage, preview } from "../contract.js";
import { priceUsage } from "../pricing.js";

const ENGINE = "nodeagent-universal" as const;
const SDK_NAME = "ai";
/** Capability statuses below were observed on this version (qualification/nodeagent-universal.json). */
const QUALIFIED_SDK_VERSION = "6.0.280";
const DELEGATE = "delegate";
const LOAD_TOOL = "load_tool";
const SEARCH_TOOLS = "search_tools";
const UPDATE_GOALS = "update_goals";
const DEFAULT_MAX_TURNS = 60;
/** Used when spec.context.autoCompactTokens is unset, so a long run's message list stays bounded. */
export const DEFAULT_COMPACT_TOKENS = 120_000;
const HELPER_MAX_STEPS = 15;
const RAW_CAP = 4096;
const TRANSCRIPT_CAP = 60_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const CAPABILITIES: Record<Capability, CapabilityEntry> = {
  start: { status: "APP-IMPLEMENTED", note: "bounded Node loop, one ai streamText request per step" },
  stream: { status: "NATIVE", note: "ai streamText text-delta parts -> message.delta (main agent)" },
  interrupt: { status: "APP-IMPLEMENTED", note: "AbortSignal passed to every streamText/tool call; state persisted before resolving" },
  resume: { status: "APP-IMPLEMENTED", note: "message list + step counter persisted to stateDir/<sessionId>.json after every step" },
  subagents: { status: "APP-IMPLEMENTED", note: "delegate tool runs a child loop (own messages, helper model, scoped tools); parallel delegates run concurrently" },
  childEventIdentity: { status: "APP-IMPLEMENTED", note: "helperId = delegate tool-call id; child tool calls carry agentId = helperId" },
  compaction: { status: "APP-IMPLEMENTED", note: "chars/4 estimate over autoCompactTokens -> model summary of older messages; keeps task, goals, last messages" },
  toolSearch: { status: "APP-IMPLEMENTED", note: "only alwaysLoad tools active; Node search_tools/load_tool add tools to the next request" },
  skillLoad: { status: "APP-IMPLEMENTED", note: "Node search_skills/load_skill; skill names re-listed from disk on every request" },
  skillRefresh: { status: "UNTESTED", note: "no native skill cache to refresh; skills dir is re-read per request" },
  goals: { status: "APP-IMPLEMENTED", note: "Node update_goals tool; last goals carried through compaction" },
  permissions: { status: "APP-IMPLEMENTED", note: "no native side-effecting tools; every tool runs through the Node gateway" },
  usage: { status: "NATIVE", note: "provider usage from ai finish-step parts" },
  costUsd: { status: "APP-IMPLEMENTED", note: "priceUsage() per model; null when any model in the run has no verified price" },
};

const MODELS = [
  "google:gemini-3.5-flash",
  "google:gemini-3.5-flash-lite",
  "google:gemini-3.1-pro-preview",
  "anthropic:claude-haiku-5-5",
  "anthropic:claude-sonnet-5-5",
  "anthropic:claude-opus-5-5",
  "openai:gpt-5.4-mini",
  "openai:gpt-5.4-nano",
  "openai:gpt-5.4",
  "openai:gpt-5.5",
];

export interface UniversalDeps {
  /** Override provider model construction (tests replay recorded streams; qualification taps them). */
  resolveModel?: (id: string, env: ProviderEnv) => LanguageModel;
}

/** Persisted per native session; nativeSessionId is the id of the run that created it. */
export interface UniversalSession {
  schema: "nodeagent.universal-session/v1";
  sessionId: string;
  model: string;
  /** First user message (task, plus any handoff), kept verbatim through compaction. */
  task: string;
  messages: ModelMessage[];
  /** Main-agent model requests across all runs of this session. */
  step: number;
  /** Deferred tools loaded via load_tool. */
  loaded: string[];
  /** Last successful update_goals result, carried through compaction. */
  goals?: string;
  compactions: number;
  updatedAt: string;
}

function installedVersion(pkg: string): string | undefined {
  try {
    return (createRequire(import.meta.url)(`${pkg}/package.json`) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === "string" ? err : preview(err, 400);
}

/**
 * ponytail: the installed @ai-sdk/* 4.x providers implement LanguageModelV4, but ai@6.0.280 core accepts only
 * v2/v3 (UnsupportedModelVersionError). Text, tool-call and tool-result parts are shape-identical between v3
 * and v4, which is all this loop sends; align versions (ai@7, or @ai-sdk/*@3) and delete this bridge.
 */
function asV3(model: object): LanguageModel {
  if ((model as { specificationVersion?: string }).specificationVersion !== "v4") return model as LanguageModel;
  return new Proxy(model, {
    get(target, key) {
      if (key === "specificationVersion") return "v3";
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as LanguageModel;
}

export function splitModelId(id: string): { provider: string; name: string } {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) throw new Error(`Model "${id}" must be "provider:model" (anthropic, openai, google or openrouter)`);
  return { provider: id.slice(0, i), name: id.slice(i + 1) };
}

export function resolveModel(id: string, env: ProviderEnv): LanguageModel {
  const { provider, name } = splitModelId(id);
  const need = (key: string | undefined, envName: string): string => {
    if (!key) throw new Error(`${envName} is not set (needed for ${id})`);
    return key;
  };
  switch (provider) {
    case "anthropic":
      return asV3(
        createAnthropic({
          apiKey: need(env.anthropicApiKey, "ANTHROPIC_API_KEY"),
          baseURL: env.anthropicBaseUrl ? `${env.anthropicBaseUrl}/v1` : undefined,
        })(name),
      );
    case "openai":
      return asV3(createOpenAI({ apiKey: need(env.openaiApiKey, "OPENAI_API_KEY") })(name));
    case "google":
      return asV3(createGoogleGenerativeAI({ apiKey: need(env.googleApiKey, "GOOGLE_GENERATIVE_AI_API_KEY") })(name));
    case "openrouter":
      return asV3(
        createOpenAI({ apiKey: need(env.openrouterApiKey, "OPENROUTER_API_KEY"), baseURL: "https://openrouter.ai/api/v1" }).chat(name),
      );
    default:
      throw new Error(`Unknown provider "${provider}" in model "${id}" (anthropic, openai, google or openrouter)`);
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

interface Tokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Totals per model (a run touches at most main + helper model), priced at the end. */
class UsageMeter {
  private byModel = new Map<string, Tokens>();
  private unreported = 0;
  turns = 0;

  /** Returns total tokens of this request (for helper progress), or 0 when the provider reported none. */
  add(modelId: string, u: LanguageModelUsage | undefined): number {
    this.turns++;
    if (!u || (u.inputTokens === undefined && u.outputTokens === undefined)) {
      this.unreported++;
      return 0;
    }
    // Pricing convention: inputTokens is uncached input; ai reports cache reads/writes inside inputTokens.
    const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;
    const uncached = u.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite);
    const t = this.byModel.get(modelId) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    t.inputTokens += uncached;
    t.outputTokens += u.outputTokens ?? 0;
    t.cacheReadTokens += cacheRead;
    t.cacheWriteTokens += cacheWrite;
    this.byModel.set(modelId, t);
    return (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  }

  totals(): UsageTotals {
    const out = emptyUsage();
    out.modelTurns = this.turns;
    let cost: number | null = this.unreported === 0 ? 0 : null;
    for (const [modelId, t] of this.byModel) {
      out.inputTokens += t.inputTokens;
      out.outputTokens += t.outputTokens;
      out.cacheReadTokens += t.cacheReadTokens;
      out.cacheWriteTokens += t.cacheWriteTokens;
      const { provider, name } = splitModelId(modelId);
      // OpenRouter bills its own rates; the direct-provider price table would be a guess.
      const priced = provider === "openrouter" ? null : priceUsage(name, t).costUsd;
      cost = cost === null || priced === null ? null : cost + priced;
    }
    if (this.byModel.size === 0) cost = null;
    out.costUsd = cost === null ? null : Math.round(cost * 1e6) / 1e6;
    out.costSource = cost === null ? "unknown" : "price-table";
    return out;
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Part = Exclude<ModelMessage["content"], string>[number];

function parts(m: ModelMessage): Part[] {
  return typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Part[]);
}

function outputText(output: ToolResultPart["output"]): string {
  if (output.type === "text" || output.type === "error-text") return output.value;
  if (output.type === "execution-denied") return output.reason ?? "denied";
  return preview("value" in output ? output.value : output, 4000);
}

/** chars/4 over what the model reads (text, tool inputs, tool outputs); estimated, not tokenized. */
export function estimateTokens(system: string, messages: ModelMessage[]): number {
  let chars = system.length;
  for (const m of messages)
    for (const p of parts(m)) {
      if (p.type === "text" || p.type === "reasoning") chars += p.text.length;
      else if (p.type === "tool-call") chars += p.toolName.length + preview(p.input, 1e9).length;
      else if (p.type === "tool-result") chars += outputText(p.output).length;
    }
  return Math.ceil(chars / 4);
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text;
}

function renderTranscript(messages: ModelMessage[]): string {
  const lines: string[] = [];
  for (const m of messages)
    for (const p of parts(m)) {
      if (p.type === "text") lines.push(`${m.role}: ${cap(p.text, 2000)}`);
      else if (p.type === "tool-call") lines.push(`tool call ${p.toolName} ${cap(preview(p.input, 1e9), 1000)}`);
      else if (p.type === "tool-result") lines.push(`tool result ${p.toolName}: ${cap(outputText(p.output), 2000)}`);
    }
  const text = lines.join("\n");
  return text.length > TRANSCRIPT_CAP ? text.slice(-TRANSCRIPT_CAP) : text;
}

/** A crash between a tool call and its result leaves calls without results; providers reject that. */
function repairDangling(messages: ModelMessage[]): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return;
  const calls = parts(last).filter((p): p is ToolCallPart => p.type === "tool-call" && !p.providerExecuted);
  if (calls.length === 0) return;
  messages.push({
    role: "tool",
    content: calls.map((c) => ({
      type: "tool-result" as const,
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      output: { type: "error-text" as const, value: "No result recorded: the previous run ended before this tool finished." },
    })),
  });
}

export function renderHandoff(h: HandoffPacket): string {
  const lines = [
    `Handoff from ${h.fromEngine} run ${h.fromRunId} (${h.createdAt}). These are the previous engine's claims plus Node's records; verify before relying on them.`,
    `Original task: ${cap(h.originalPrompt, 2000)}`,
  ];
  if (h.goals.length) lines.push("Goals:", ...h.goals.slice(0, 30).map((g) => `- [${g.status}] ${g.title} (claimed by ${g.claimedBy})`));
  if (h.artifacts.length)
    lines.push("Artifacts (Node-hashed):", ...h.artifacts.slice(0, 40).map((a) => `- ${a.path} sha256=${a.sha256.slice(0, 16)} bytes=${a.bytes}`));
  if (h.checks.length)
    lines.push("Checks:", ...h.checks.slice(0, 20).map((c) => `- ${c.ok ? "PASS" : "FAIL"} ${c.checkId}: ${c.command} — ${cap(c.summary, 200)}`));
  if (h.unresolved.length) lines.push("Unresolved (Node cannot prove these completed):", ...h.unresolved.slice(0, 20).map((u) => `- ${cap(u, 300)}`));
  if (h.lastSummary) lines.push(`Previous engine's last summary: ${cap(h.lastSummary, 1500)}`);
  return lines.join("\n");
}

function listSkills(workspaceDir: string): string[] {
  const dir = join(workspaceDir, ".claude", "skills");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name)
      .sort()
      .slice(0, 50);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

const DELEGATE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "3-8 word label for the subtask, shown to the user" },
    prompt: { type: "string", description: "Complete, self-contained instructions; the helper sees nothing else" },
    tools: { type: "array", items: { type: "string" }, description: "Optional Node tool names the helper needs preloaded" },
  },
  required: ["description", "prompt"],
  additionalProperties: false,
} as const;

const SUMMARY_SYSTEM =
  "You compress an agent's working history so it can continue with less context. Write a factual summary (at most 300 words): " +
  "which tools were called and what they returned (keep exact numbers, paths and names), decisions made, and what remains to do. " +
  "Include nothing that is not in the transcript.";

interface Agent {
  agentId?: string;
  modelId: string;
  model: LanguageModel;
  system: () => string;
  messages: ModelMessage[];
  active: Set<string>;
}

interface StepResult {
  text: string;
  calls: ToolCallPart[];
  invalid: Map<string, string>;
  inputTokens?: number;
  tokens: number;
}

class Run {
  readonly usage = new UsageMeter();
  private readonly schemaCache = new Map<string, Record<string, unknown>>();
  private readonly canLoad: boolean;
  lastText = "";

  constructor(
    readonly spec: RunSpec,
    readonly host: EngineHost,
    readonly signal: AbortSignal,
    readonly session: UniversalSession,
    readonly sessionFile: string,
    readonly mainModel: LanguageModel,
    readonly helperModelId: string,
    readonly helperModel: LanguageModel,
  ) {
    this.canLoad = host.tools.get(LOAD_TOOL) !== undefined;
  }

  /** Set when `done` settles: a provider that ignored the abort must not append events after the outcome. */
  closed = false;
  emit: EngineHost["emit"] = (e) => {
    if (!this.closed) this.host.emit(e);
  };

  persist(): void {
    this.session.updatedAt = new Date().toISOString();
    const tmp = `${this.sessionFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.session));
    renameSync(tmp, this.sessionFile);
  }

  /** Base tools for any agent: alwaysLoad ones, or every tool when the catalog has no load_tool. */
  baseTools(): string[] {
    const all = this.host.tools.list();
    return all.filter((t) => !this.canLoad || t.alwaysLoad === true).map((t) => t.name);
  }

  deferredCount(active: Set<string>): number {
    return this.host.tools.list().filter((t) => !active.has(t.name)).length;
  }

  toolSet(active: Set<string>): ToolSet {
    const set: ToolSet = {};
    for (const name of active) {
      if (name === DELEGATE) {
        set[name] = tool({
          description: "Run an independent subtask in a helper agent with its own context. Several delegate calls in one step run concurrently.",
          inputSchema: jsonSchema(DELEGATE_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]),
        });
        continue;
      }
      const def = this.host.tools.get(name);
      if (!def) continue;
      let schema = this.schemaCache.get(name);
      if (!schema) {
        const { $schema: _drop, ...rest } = this.host.tools.jsonSchema(name);
        schema = rest;
        this.schemaCache.set(name, schema);
      }
      set[name] = tool({ description: def.description, inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]) });
    }
    return set;
  }

  systemFor(active: Set<string>, helper: boolean): string {
    const lines = helper
      ? [
          "You are a helper agent doing one subtask for a lead agent, in the same project workspace.",
          "Act only through the tools you are given. Finish with a short answer that states concrete results (numbers, paths, names).",
        ]
      : [
          "You are NodeAgent, a task agent working inside one project workspace. You act only through the tools you are given.",
          "Paths are workspace-relative.",
        ];
    const deferred = this.deferredCount(active);
    if (this.canLoad && deferred > 0)
      lines.push(
        `${deferred} more tools exist but are not loaded. Use ${SEARCH_TOOLS} to find a tool by what it does, then ${LOAD_TOOL} to enable it; a loaded tool becomes callable on your next step.`,
      );
    if (!helper) {
      if (this.host.tools.get("load_skill")) {
        const skills = listSkills(this.spec.workspaceDir);
        lines.push(
          `Skills are reusable instructions${skills.length ? ` (available: ${skills.join(", ")})` : ""}. Find them with search_skills, load one with load_skill, and follow its instructions.`,
        );
      }
      if (this.host.tools.get(UPDATE_GOALS)) lines.push(`For multi-step work, keep a short goal list with ${UPDATE_GOALS} and update statuses as you go.`);
      if (active.has(DELEGATE))
        lines.push(
          `Use ${DELEGATE} to hand an independent subtask to a helper agent; several ${DELEGATE} calls in the same step run concurrently. A helper sees only the prompt you write.`,
        );
    }
    lines.push("Never invent tool results, file contents or numbers. When the task is complete, reply with a concise final answer and no tool calls.");
    return lines.join("\n");
  }

  raw(nativeType: string, payload: unknown, agentId?: string): void {
    this.emit({ type: "engine.raw", nativeType, payload: preview(payload, RAW_CAP), agentId });
  }

  abortError(): Error {
    return new Error(`aborted: ${errMessage(this.signal.reason ?? "interrupt")}`);
  }

  /** ai streams only end on abort when the provider honours the signal; never wait on one that does not. */
  untilAborted<T>(p: Promise<T>): Promise<T> {
    p.catch(() => undefined);
    if (this.signal.aborted) return Promise.reject(this.abortError());
    let off = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const on = () => reject(this.abortError());
      this.signal.addEventListener("abort", on, { once: true });
      off = () => this.signal.removeEventListener("abort", on);
    });
    return Promise.race([p, aborted]).finally(off);
  }

  /** One model request. Appends the assistant message(s); returns the tool calls to execute. */
  step(a: Agent): Promise<StepResult> {
    return this.untilAborted(this.request(a));
  }

  private async request(a: Agent): Promise<StepResult> {
    const result = streamText({
      model: a.model,
      system: a.system(),
      messages: a.messages,
      tools: this.toolSet(a.active),
      abortSignal: this.signal,
      onError: () => {},
    });
    let text = "";
    let inputTokens: number | undefined;
    let tokens = 0;
    let counted = false;
    const invalid = new Map<string, string>();
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          text += part.text;
          if (a.agentId === undefined && part.text) this.emit({ type: "message.delta", text: part.text });
          break;
        case "tool-call":
          if ("invalid" in part && part.invalid) invalid.set(part.toolCallId, errMessage(part.error));
          break;
        case "tool-error":
          if (!invalid.has(part.toolCallId)) invalid.set(part.toolCallId, errMessage(part.error));
          break;
        case "start-step":
          if (part.warnings.length) this.raw("start-step.warnings", part.warnings, a.agentId);
          break;
        case "finish-step":
          tokens = this.usage.add(a.modelId, part.usage);
          counted = true;
          inputTokens = part.usage?.inputTokens;
          if (part.finishReason !== "stop" && part.finishReason !== "tool-calls")
            this.raw("finish-step", { finishReason: part.finishReason, rawFinishReason: part.rawFinishReason }, a.agentId);
          break;
        case "error":
          throw part.error instanceof Error ? part.error : new Error(errMessage(part.error));
        case "abort":
          throw this.abortError();
        case "text-start":
        case "text-end":
        case "reasoning-start":
        case "reasoning-delta": // hidden reasoning is never projected into events
        case "reasoning-end":
        case "tool-input-start":
        case "tool-input-delta":
        case "tool-input-end":
        case "start":
        case "finish":
          break;
        default:
          this.raw(part.type, part, a.agentId);
      }
    }
    if (this.signal.aborted) throw this.abortError();
    if (!counted) this.usage.add(a.modelId, undefined);
    const response = await result.response;
    const assistant = response.messages.filter((m) => m.role === "assistant");
    a.messages.push(...assistant);
    const calls = assistant.flatMap((m) => parts(m).filter((p): p is ToolCallPart => p.type === "tool-call" && !p.providerExecuted));
    return { text, calls, invalid, inputTokens, tokens };
  }

  /** Executes one step's calls: delegates concurrently, everything else serially. Never throws. */
  async execute(a: Agent, calls: ToolCallPart[], invalid: Map<string, string>): Promise<void> {
    let serial: Promise<unknown> = Promise.resolve();
    const results = await Promise.all(
      calls.map((c) => {
        if (c.toolName === DELEGATE && a.active.has(DELEGATE)) return this.call(a, c, invalid);
        const p = serial.then(() => this.call(a, c, invalid));
        serial = p;
        return p;
      }),
    );
    a.messages.push({ role: "tool", content: results });
  }

  async call(a: Agent, c: ToolCallPart, invalid: Map<string, string>): Promise<ToolResultPart> {
    const t0 = Date.now();
    const node = this.host.tools.get(c.toolName);
    const scope = { agentId: a.agentId };
    this.emit({
      type: "tool.call",
      callId: c.toolCallId,
      name: c.toolName,
      family: node?.family ?? "native",
      inputPreview: preview(c.input),
      native: !node,
      ...scope,
    });
    let ok = false;
    let content: string;
    try {
      if (!a.active.has(c.toolName)) {
        content = node
          ? `Tool "${c.toolName}" is not loaded. Call ${LOAD_TOOL} with its name first; it becomes callable on your next step.`
          : `Unknown tool "${c.toolName}".`;
      } else if (invalid.has(c.toolCallId)) {
        content = `Invalid call to ${c.toolName}: ${invalid.get(c.toolCallId)}`;
      } else if (c.toolName === DELEGATE) {
        ({ ok, content } = await this.helper(a, c));
      } else {
        const out = await this.host.tools.call(c.toolName, c.input, { agentId: a.agentId, callId: c.toolCallId });
        ok = out.ok;
        content = out.content;
        if (ok && c.toolName === LOAD_TOOL) for (const n of loadedNames(c.input, out.data, this.host)) this.markLoaded(a, n);
        if (ok && c.toolName === UPDATE_GOALS && a.agentId === undefined) this.session.goals = cap(content, 2000);
      }
    } catch (err) {
      content = `Tool ${c.toolName} failed: ${errMessage(err)}`;
    }
    this.emit({ type: "tool.result", callId: c.toolCallId, ok, preview: preview(content), ms: Date.now() - t0, ...scope });
    return {
      type: "tool-result",
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      output: ok ? { type: "text", value: content } : { type: "error-text", value: content },
    };
  }

  markLoaded(a: Agent, name: string): void {
    a.active.add(name);
    if (a.agentId === undefined && !this.session.loaded.includes(name)) this.session.loaded.push(name);
  }

  async helper(parent: Agent, c: ToolCallPart): Promise<{ ok: boolean; content: string }> {
    const input = (c.input ?? {}) as { description?: unknown; prompt?: unknown; tools?: unknown };
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return { ok: false, content: "delegate needs a non-empty prompt" };
    const helperId = c.toolCallId;
    const description = typeof input.description === "string" && input.description.trim() ? input.description : cap(input.prompt, 80);
    const requested = Array.isArray(input.tools) ? input.tools.filter((n): n is string => typeof n === "string" && !!this.host.tools.get(n)) : [];
    const active = new Set([...this.baseTools(), ...[...parent.active].filter((n) => n !== DELEGATE), ...requested]);
    active.delete(DELEGATE); // ponytail: one level of helpers; nested delegation when a task needs it
    const child: Agent = {
      agentId: helperId,
      modelId: this.helperModelId,
      model: this.helperModel,
      messages: [{ role: "user", content: input.prompt }],
      active,
      system: () => this.systemFor(child.active, true),
    };
    const t0 = Date.now();
    let toolUses = 0;
    let totalTokens = 0;
    this.emit({ type: "helper.started", helperId, description, subagentType: DELEGATE, model: this.helperModelId, background: false });
    const finish = (status: "completed" | "failed" | "stopped", summary: string) => {
      this.emit({ type: "helper.completed", helperId, status, summary: cap(summary, 2000), totalTokens, toolUses, durationMs: Date.now() - t0 });
      return { ok: status === "completed", content: cap(summary, 8000) };
    };
    try {
      for (let i = 0; i < HELPER_MAX_STEPS; i++) {
        const r = await this.step(child);
        totalTokens += r.tokens;
        if (r.text.trim()) this.emit({ type: "message", role: "assistant", text: r.text, agentId: helperId });
        if (r.calls.length === 0) return finish("completed", r.text.trim() || "(helper returned no text)");
        await this.execute(child, r.calls, r.invalid);
        toolUses += r.calls.length;
        this.emit({
          type: "helper.progress",
          helperId,
          lastTool: r.calls[r.calls.length - 1].toolName,
          toolUses,
          totalTokens,
          durationMs: Date.now() - t0,
        });
        if (this.signal.aborted) return finish("stopped", "Helper stopped: the run was interrupted.");
      }
      return finish("failed", `Helper hit its step cap (${HELPER_MAX_STEPS}) before finishing.`);
    } catch (err) {
      return this.signal.aborted ? finish("stopped", "Helper stopped: the run was interrupted.") : finish("failed", `Helper failed: ${errMessage(err)}`);
    }
  }

  async maybeCompact(main: Agent): Promise<void> {
    const threshold = this.spec.context.autoCompactTokens ?? DEFAULT_COMPACT_TOKENS;
    const msgs = this.session.messages;
    const pre = estimateTokens(main.system(), msgs);
    if (pre <= threshold) return;
    // Keep the newest messages within half the threshold (at least the last exchange), starting at an
    // assistant message so no tool result loses its call; older ones are summarized.
    let cut = Math.max(1, msgs.length - 2);
    let kept = estimateTokens("", msgs.slice(cut));
    while (cut > 1 && kept + estimateTokens("", [msgs[cut - 1]]) <= threshold / 2) kept += estimateTokens("", [msgs[--cut]]);
    while (cut < msgs.length && msgs[cut].role !== "assistant") cut++;
    // Too little new history to be worth a summary request (avoids re-compacting every step when the task alone is large).
    if (cut <= 1 || estimateTokens("", msgs.slice(1, cut)) < threshold / 4) return;
    const t0 = Date.now();
    this.emit({ type: "run.status", status: "compacting", detail: `estimated ${pre} tokens > ${threshold}` });
    const r = await this.untilAborted(
      generateText({ model: this.helperModel, system: SUMMARY_SYSTEM, prompt: renderTranscript(msgs.slice(0, cut)), abortSignal: this.signal }),
    );
    this.usage.add(this.helperModelId, r.usage);
    const summary = r.text.trim();
    if (!summary) {
      this.host.log("compaction skipped: the summary request returned no text");
      this.emit({ type: "run.status", status: "running", detail: "compaction skipped (empty summary)" });
      return;
    }
    const goals = this.session.goals ? `\n\nCurrent goals (last ${UPDATE_GOALS} result):\n${this.session.goals}` : "";
    this.session.messages = [
      { role: "user", content: `${this.session.task}\n\n[Earlier steps were compacted by NodeAgent. Summary:]\n${summary}${goals}` },
      ...msgs.slice(cut),
    ];
    main.messages = this.session.messages;
    this.session.compactions++;
    const post = estimateTokens(main.system(), this.session.messages);
    this.emit({
      type: "context.compacted",
      trigger: "auto",
      preTokens: pre,
      postTokens: post,
      durationMs: Date.now() - t0,
      nativeRef: `${this.session.sessionId}#compaction-${this.session.compactions}`,
    });
    this.emit({ type: "run.status", status: "running" });
    this.persist();
  }

  async main(): Promise<string> {
    const s = this.session;
    const main: Agent = {
      modelId: this.spec.model,
      model: this.mainModel,
      messages: s.messages,
      active: new Set([...this.baseTools(), DELEGATE, ...s.loaded.filter((n) => this.host.tools.get(n))]),
      system: () => this.systemFor(main.active, false),
    };
    const maxTurns = this.spec.budget.maxTurns ?? DEFAULT_MAX_TURNS;
    this.emit({
      type: "run.started",
      engine: ENGINE,
      model: this.spec.model,
      sdkVersion: installedVersion(SDK_NAME) ?? "unknown",
      nativeSessionId: this.session.sessionId,
      cwd: this.spec.workspaceDir,
      tools: [...main.active],
      deferredTools: this.host.tools.list().filter((t) => !main.active.has(t.name)).map((t) => t.name),
      skills: listSkills(this.spec.workspaceDir),
      helpers: [DELEGATE],
    });
    for (let turn = 0; ; turn++) {
      if (turn >= maxTurns) throw new Error(`Step cap reached (${maxTurns} model requests) before the model finished`);
      await this.maybeCompact(main);
      const r = await this.step(main);
      this.session.step++;
      if (r.text.trim()) {
        this.lastText = r.text;
        this.emit({ type: "message", role: "assistant", text: r.text });
      }
      if (r.calls.length > 0) await this.execute(main, r.calls, r.invalid);
      this.persist();
      const totals = this.usage.totals();
      this.emit({ type: "usage", totals });
      this.emit(
        r.inputTokens !== undefined
          ? { type: "context.usage", usedTokens: r.inputTokens, estimated: false }
          : { type: "context.usage", usedTokens: estimateTokens(main.system(), main.messages), estimated: true },
      );
      if (this.signal.aborted) throw this.abortError();
      const maxUsd = this.spec.budget.maxUsd;
      if (maxUsd !== undefined && totals.costUsd !== null && totals.costUsd > maxUsd)
        throw new Error(`Budget exceeded: $${totals.costUsd} > $${maxUsd}`);
      if (r.calls.length === 0) return r.text;
    }
  }
}

/** Names a successful load_tool made callable: the tool's structured data when present, else its arguments. */
export function loadedNames(args: unknown, data: Record<string, unknown> | undefined, host: Pick<EngineHost, "tools">): string[] {
  const pick = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
  const a = (args ?? {}) as Record<string, unknown>;
  const fromData = [...pick(data?.names), ...pick(data?.loaded)];
  const cand = fromData.length ? fromData : [...pick(a.names), ...pick(a.name), ...pick(a.tools)];
  return [...new Set(cand.filter((n): n is string => typeof n === "string" && host.tools.get(n) !== undefined))];
}

function openSession(spec: RunSpec, host: EngineHost): { session: UniversalSession; file: string } {
  const id = spec.resume?.nativeSessionId ?? spec.runId;
  if (!SESSION_ID.test(id) || id.includes("..")) throw new Error(`Invalid session id "${cap(id, 80)}"`);
  mkdirSync(host.stateDir, { recursive: true });
  const file = join(host.stateDir, `${id}.json`);
  if (spec.resume) {
    if (!existsSync(file)) throw new Error(`No saved universal session "${id}" in this engine's state directory`);
    const session = JSON.parse(readFileSync(file, "utf8")) as UniversalSession;
    if (session.schema !== "nodeagent.universal-session/v1" || !Array.isArray(session.messages))
      throw new Error(`Session file for "${id}" is not a nodeagent.universal-session/v1 record`);
    repairDangling(session.messages);
    session.messages.push({ role: "user", content: spec.prompt.trim() || "Continue the task." });
    session.model = spec.model;
    return { session, file };
  }
  const task = spec.handoff ? `${renderHandoff(spec.handoff)}\n\n---\n${spec.prompt}` : spec.prompt;
  return {
    file,
    session: {
      schema: "nodeagent.universal-session/v1",
      sessionId: id,
      model: spec.model,
      task,
      messages: [{ role: "user", content: task }],
      step: 0,
      loaded: [],
      compactions: 0,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function createUniversalAdapter(deps: UniversalDeps = {}): EngineAdapter {
  const resolve = deps.resolveModel ?? resolveModel;
  const descriptor = (): EngineDescriptor => {
    const version = installedVersion(SDK_NAME) ?? "unknown";
    const qualified = version === QUALIFIED_SDK_VERSION;
    const capabilities = Object.fromEntries(
      Object.entries(CAPABILITIES).map(([k, v]) => [
        k,
        qualified || v.status === "UNSUPPORTED" ? v : { status: "UNTESTED", note: `${v.note} (qualified on ${QUALIFIED_SDK_VERSION}, installed ${version})` },
      ]),
    ) as Record<Capability, CapabilityEntry>;
    return {
      id: ENGINE,
      label: "NodeAgent universal (AI SDK)",
      sdk: { name: SDK_NAME, version },
      defaultModel: "google:gemini-3.5-flash",
      defaultHelperModel: "google:gemini-3.5-flash-lite",
      models: MODELS,
      capabilities,
      defaults: { maxTurns: DEFAULT_MAX_TURNS, autoCompactTokens: DEFAULT_COMPACT_TOKENS },
    };
  };

  return {
    descriptor,
    async availability(env) {
      const missing: string[] = [];
      const sdkOk = installedVersion(SDK_NAME) !== undefined;
      if (!sdkOk) missing.push(`${SDK_NAME} is not installed`);
      const keys: Array<[string | undefined, string, string]> = [
        [env.googleApiKey, "GOOGLE_GENERATIVE_AI_API_KEY", "google"],
        [env.anthropicApiKey, "ANTHROPIC_API_KEY", "anthropic"],
        [env.openaiApiKey, "OPENAI_API_KEY", "openai"],
        [env.openrouterApiKey, "OPENROUTER_API_KEY", "openrouter"],
      ];
      const present = keys.filter(([k]) => k);
      for (const [k, name, provider] of keys) if (!k) missing.push(`${name} is not set (${provider}:* models unavailable)`);
      return { ok: sdkOk && present.length > 0, missing };
    },
    start(spec, host) {
      // Own controller (not AbortSignal.any): a derived signal held only weakly can be collected mid-run.
      const ctrl = new AbortController();
      const forward = () => ctrl.abort(host.signal.reason);
      if (host.signal.aborted) forward();
      else host.signal.addEventListener("abort", forward, { once: true });
      const signal = ctrl.signal;
      let run: Run | undefined;
      const done = (async (): Promise<EngineRunOutcome> => {
        let sessionId: string | undefined;
        try {
          const { session, file } = openSession(spec, host);
          sessionId = session.sessionId;
          const helperModelId = spec.helperModel ?? spec.model;
          const mainModel = resolve(spec.model, host.env);
          const helperModel = helperModelId === spec.model ? mainModel : resolve(helperModelId, host.env);
          run = new Run(spec, host, signal, session, file, mainModel, helperModelId, helperModel);
          const finalText = await run.main();
          return { status: "completed", finalText, nativeSessionId: sessionId, usage: run.usage.totals() };
        } catch (err) {
          try {
            run?.persist();
          } catch (e) {
            host.log(`universal: could not persist session: ${errMessage(e)}`);
          }
          const usage = run?.usage.totals() ?? emptyUsage();
          const finalText = run?.lastText ?? "";
          if (signal.aborted) {
            const reason = errMessage(signal.reason ?? "interrupted");
            return { status: "interrupted", finalText, nativeSessionId: sessionId, usage, error: reason };
          }
          return { status: "failed", finalText, nativeSessionId: sessionId, usage, error: errMessage(err) };
        } finally {
          if (run) run.closed = true;
          host.signal.removeEventListener("abort", forward);
        }
      })();
      return {
        done,
        async interrupt(reason) {
          ctrl.abort(new Error(reason || "interrupted"));
          await done.catch(() => undefined);
        },
      };
    },
  };
}
