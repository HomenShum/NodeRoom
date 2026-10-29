/**
 * Google ADK (@google/adk) engine. ADK owns the turn loop (LlmAgent + Runner),
 * SSE streaming, abort sealing, token-based compaction and SKILL.md loading;
 * Node owns everything else. Measured facts for ADK JS 2.4.0 that shape this file:
 * - agents/functions.js runs a model turn's function calls one at a time, and
 *   AgentTool consumes its child Runner's events without surfacing them. Helpers
 *   therefore go through `run_helpers`, which runs native ADK child Runners
 *   concurrently and translates each child's native events under its helperId.
 * - There is no native tool search: deferred Node tools become callable when the
 *   Node `load_tool` succeeds (dynamic BaseToolset, re-read on every model request).
 * - DatabaseSessionService needs @mikro-orm/sqlite (not installed), so sessions are
 *   InMemorySessionService + a JSON snapshot per session under host.stateDir.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  BasePlugin,
  BaseTool,
  BaseToolset,
  Gemini,
  InMemorySessionService,
  LlmAgent,
  LlmSummarizer,
  Runner,
  SkillToolset,
  StreamingMode,
  TokenBasedContextCompactor,
  getFunctionCalls,
  getFunctionResponses,
  isCompactedEvent,
  loadAllSkillsInDir,
} from "@google/adk";
import type { Event, LlmRequest, LlmResponse, RunAsyncToolRequest, Skill } from "@google/adk";
import type { FunctionDeclaration, GenerateContentResponseUsageMetadata } from "@google/genai";
import type {
  Capability,
  CapabilityEntry,
  EngineAdapter,
  EngineDescriptor,
  EngineEventDraft,
  EngineHost,
  EngineRunHandle,
  EngineRunOutcome,
  HandoffPacket,
  NodeToolDefinition,
  RunSpec,
  UsageTotals,
} from "../contract.js";
import { emptyUsage, preview } from "../contract.js";
import { priceUsage } from "../pricing.js";

const SDK_NAME = "@google/adk";
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_HELPER_MODEL = "gemini-3.5-flash-lite";
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"];
const APP_NAME = "nodeagent";
const MAIN_AGENT = "nodeagent_main";
/** Compaction threshold when the run manifest does not set context.autoCompactTokens. */
const DEFAULT_COMPACT_TOKENS = 200_000;
const RETAINED_EVENTS = 6;
const MAX_HELPERS = 4;
const HELPER_MAX_LLM_CALLS = 25;
const RAW_CAP = 4096;
const MAX_TRACKED = 512;
/** Only these SkillToolset tools are exposed; script runners are dropped (no Node policy over them). */
const NATIVE_SKILL_TOOLS = new Set(["list_skills", "load_skill", "load_skill_resource"]);
const HELPER_TOOL = "run_helpers";

const CAPABILITIES: Record<Capability, CapabilityEntry> = {
  start: { status: "NATIVE", note: "Runner.runAsync over an LlmAgent; run.started once the ADK session id exists" },
  stream: { status: "NATIVE", note: "RunConfig.streamingMode SSE partial events -> message.delta (main agent)" },
  interrupt: { status: "NATIVE", note: "runAsync abortSignal; Runner seals the aborted invocation (synthesizeAbortEvents)" },
  resume: {
    status: "APP-IMPLEMENTED",
    note: "ADK session id restored from a JSON snapshot of InMemorySessionService events (DatabaseSessionService needs @mikro-orm/sqlite)",
  },
  subagents: {
    status: "APP-IMPLEMENTED",
    note: "run_helpers runs native ADK child Runners (helper LlmAgents) concurrently; AgentTool is sequential and opaque in ADK JS 2.4",
  },
  childEventIdentity: {
    status: "APP-IMPLEMENTED",
    note: "each child Runner's native events are translated with agentId = <run_helpers call id>.h<n>",
  },
  compaction: {
    status: "NATIVE",
    note: "TokenBasedContextCompactor(tokenThreshold = context.autoCompactTokens) + LlmSummarizer -> CompactedEvent -> context.compacted",
  },
  toolSearch: {
    status: "APP-IMPLEMENTED",
    note: "no ADK tool search; Node search_tools/load_tool, loaded tools join a dynamic BaseToolset on the next model request",
  },
  skillLoad: { status: "NATIVE", note: "SkillToolset(loadAllSkillsInDir(<workspace>/.claude/skills)) list_skills/load_skill" },
  skillRefresh: {
    status: "APP-IMPLEMENTED",
    note: "setSkillRefresher reloads loadAllSkillsInDir into SkillToolset.skills; read on the next model request",
  },
  goals: { status: "APP-IMPLEMENTED", note: "ADK has no goal list; Node update_goals tool emits goals.updated" },
  permissions: {
    status: "UNTESTED",
    note: "no native side-effecting tools are exposed (skill script runners dropped), so no native permission path exists to observe; workspace effects are Node tools via host.tools.call",
  },
  usage: { status: "NATIVE", note: "Gemini usageMetadata per model call (main, helpers, summarizer) summed by a metered Gemini" },
  costUsd: { status: "APP-IMPLEMENTED", note: "ADK reports no USD; priceUsage() per model, null when any model used has no verified price" },
};

export interface GoogleAdkAdapterDeps {
  /** Sees every native ADK event before translation (qualification fixture capture). */
  onNative?: (event: Event, agentId?: string) => void;
}

function installedVersion(): string {
  try {
    return (createRequire(import.meta.url)(`${SDK_NAME}/package.json`) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key); // re-insert so recency, not first insertion, decides eviction
  map.set(key, value);
  if (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** Sums Gemini usageMetadata per model. Google counts cached tokens inside promptTokenCount. */
export class UsageMeter {
  private byModel = new Map<string, { input: number; output: number; cacheRead: number; turns: number }>();

  record(model: string, u: GenerateContentResponseUsageMetadata | undefined): void {
    const m = this.byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, turns: 0 };
    const cached = u?.cachedContentTokenCount ?? 0;
    m.input += Math.max(0, (u?.promptTokenCount ?? 0) - cached) + (u?.toolUsePromptTokenCount ?? 0);
    m.output += (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
    m.cacheRead += cached;
    m.turns += 1;
    this.byModel.set(model, m);
  }

  totals(): UsageTotals {
    const t = emptyUsage();
    let cost: number | null = 0;
    for (const [model, m] of this.byModel) {
      t.inputTokens += m.input;
      t.outputTokens += m.output;
      t.cacheReadTokens += m.cacheRead;
      t.modelTurns += m.turns;
      const p = priceUsage(model, { inputTokens: m.input, outputTokens: m.output, cacheReadTokens: m.cacheRead });
      cost = cost === null || p.costUsd === null ? null : cost + p.costUsd;
    }
    if (this.byModel.size > 0 && cost !== null) {
      t.costUsd = Math.round(cost * 1e6) / 1e6;
      t.costSource = "price-table";
    }
    return t;
  }
}

class MeteredGemini extends Gemini {
  constructor(model: string, apiKey: string, private readonly onUsage: (model: string, u: GenerateContentResponseUsageMetadata | undefined) => void) {
    super({ model, apiKey });
  }

  override async *generateContentAsync(req: LlmRequest, stream?: boolean, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    // Streamed chunks carry cumulative usage; the last one seen is the call's total.
    let last: GenerateContentResponseUsageMetadata | undefined;
    try {
      for await (const r of super.generateContentAsync(req, stream, abortSignal)) {
        if (r.usageMetadata) last = r.usageMetadata;
        yield r;
      }
    } finally {
      this.onUsage(req.model ?? this.model, last);
    }
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolState {
  host: EngineHost;
  /** Deferred Node tools made callable by a successful load_tool. */
  loaded: Set<string>;
}

function loadedNames(args: unknown, data: Record<string, unknown> | undefined): string[] {
  const fromData = data?.loaded;
  if (Array.isArray(fromData)) return fromData.filter((n): n is string => typeof n === "string");
  const names = (args as { names?: unknown } | null)?.names;
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
}

/** A Node catalog tool in ADK's native tool shape; executes only through host.tools.call. */
class NodeAdkTool extends BaseTool {
  constructor(private readonly def: NodeToolDefinition, private readonly st: ToolState, private readonly agentId?: string) {
    super({ name: def.name, description: def.description });
  }

  override _getDeclaration(): FunctionDeclaration {
    const { $schema: _drop, ...schema } = this.st.host.tools.jsonSchema(this.def.name);
    return { name: this.name, description: this.description, parametersJsonSchema: schema };
  }

  async runAsync({ args, toolContext }: RunAsyncToolRequest): Promise<unknown> {
    const out = await this.st.host.tools.call(this.def.name, args, { agentId: this.agentId, callId: toolContext.functionCallId });
    if (out.ok && this.def.name === "load_tool") {
      for (const n of loadedNames(args, out.data)) if (this.st.host.tools.get(n)) this.st.loaded.add(n);
    }
    return out.ok ? { result: out.content } : { error: out.content };
  }
}

/** Always-load Node tools plus whatever load_tool has loaded so far; ADK re-reads it per model request. */
export class NodeToolset extends BaseToolset {
  private readonly tools: Array<{ def: NodeToolDefinition; tool: NodeAdkTool }>;

  constructor(defs: NodeToolDefinition[], private readonly st: ToolState, agentId?: string) {
    super([]);
    this.tools = defs.map((def) => ({ def, tool: new NodeAdkTool(def, st, agentId) }));
  }

  async getTools(): Promise<BaseTool[]> {
    return this.tools.filter(({ def }) => def.alwaysLoad === true || this.st.loaded.has(def.name)).map(({ tool }) => tool);
  }

  async close(): Promise<void> {}
}

class NodeSkillToolset extends SkillToolset {
  override async getTools(): Promise<BaseTool[]> {
    return (await super.getTools()).filter((t) => NATIVE_SKILL_TOOLS.has(t.name));
  }
}

class CompactionWatch extends BasePlugin {
  constructor(private readonly onBefore: () => void, private readonly onAfter: () => void) {
    super("nodeagent-compaction-watch");
  }
  override async beforeContextCompaction(): Promise<void> {
    this.onBefore();
  }
  override async afterContextCompaction(): Promise<void> {
    this.onAfter();
  }
}

// ---------------------------------------------------------------------------
// Translation: native ADK Event -> contract events
// ---------------------------------------------------------------------------

export interface AdkTranslatorOptions {
  emit(event: EngineEventDraft): void;
  /** Node catalog family for a tool name, undefined for native tools. */
  familyOf(name: string): string | undefined;
  /** sha256 of an active skill's SKILL.md. */
  skillSha?(name: string): string | undefined;
  now?: () => number;
}

export interface AdkTranslator {
  onEvent(event: Event, agentId?: string): void;
  /** Last non-partial assistant text per agent (undefined = main). */
  lastText(agentId?: string): string;
  /** Last prompt size Gemini reported for the main agent. */
  lastPromptTokens(): number | undefined;
  lastError(): string | undefined;
  /** Duration of the compaction the next CompactedEvent reports. */
  setCompactionMs(ms: number | undefined): void;
}

const SKILL_NAME_RE = /<name>([^<]+)<\/name>/g;

export function createAdkTranslator(opts: AdkTranslatorOptions): AdkTranslator {
  const now = opts.now ?? Date.now;
  const calls = new Map<string, number>();
  const texts = new Map<string, string>();
  let promptTokens: number | undefined;
  let error: string | undefined;
  let compactionMs: number | undefined;
  const raw = (nativeType: string, payload: unknown, agentId?: string) =>
    opts.emit({ type: "engine.raw", nativeType, payload: preview(payload, RAW_CAP), agentId });

  return {
    lastText: (agentId) => texts.get(agentId ?? "") ?? "",
    lastPromptTokens: () => promptTokens,
    lastError: () => error,
    setCompactionMs(ms) {
      compactionMs = ms;
    },
    onEvent(ev, agentId) {
      if (isCompactedEvent(ev)) {
        opts.emit({
          type: "context.compacted",
          trigger: "auto",
          preTokens: promptTokens ?? 0,
          durationMs: compactionMs,
          nativeRef: ev.id,
          agentId,
        });
        compactionMs = undefined;
        return;
      }
      if (ev.errorCode || ev.errorMessage) {
        error = `${ev.errorCode ?? "error"}: ${ev.errorMessage ?? ""}`.trim();
        raw("model-error", { errorCode: ev.errorCode, errorMessage: ev.errorMessage, finishReason: ev.finishReason }, agentId);
      }
      const parts = ev.content?.parts ?? [];
      if (ev.partial) {
        const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
        if (text && agentId === undefined) opts.emit({ type: "message.delta", text });
        return;
      }
      let translated = false;
      for (const fc of getFunctionCalls(ev)) {
        const callId = fc.id ?? `${ev.id}:${fc.name}`;
        const name = fc.name ?? "unknown";
        remember(calls, callId, now());
        const family = opts.familyOf(name);
        opts.emit({ type: "tool.call", callId, name, family: family ?? "native", inputPreview: preview(fc.args ?? {}), native: family === undefined, agentId });
        translated = true;
      }
      for (const fr of getFunctionResponses(ev)) {
        const callId = fr.id ?? `${ev.id}:${fr.name}`;
        const res = (fr.response ?? {}) as Record<string, unknown>;
        const ok = !("error" in res);
        const t0 = calls.get(callId);
        calls.delete(callId);
        opts.emit({ type: "tool.result", callId, ok, preview: preview(res.result ?? res.error ?? res), ms: t0 === undefined ? undefined : now() - t0, agentId });
        if (ok && fr.name === "load_skill" && typeof res.skill_name === "string") {
          opts.emit({ type: "skill.loaded", name: res.skill_name, sha256: opts.skillSha?.(res.skill_name), via: "native", agentId });
        } else if (ok && fr.name === "list_skills" && typeof res.result === "string") {
          const results = [...res.result.matchAll(SKILL_NAME_RE)].map((m) => m[1]);
          opts.emit({ type: "skill.search", query: "*", results, via: "native", agentId });
        }
        translated = true;
      }
      if (ev.content?.role === "model") {
        const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
        if (text) {
          remember(texts, agentId ?? "", text);
          opts.emit({ type: "message", role: "assistant", text, agentId });
          translated = true;
        }
      }
      // SSE repeats early-chunk usage on the function-call event; the finishReason event carries the call's final count.
      const u = ev.usageMetadata;
      if (ev.finishReason && u?.promptTokenCount !== undefined) {
        if (agentId === undefined) promptTokens = u.promptTokenCount;
        opts.emit({ type: "context.usage", usedTokens: u.promptTokenCount + (u.candidatesTokenCount ?? 0), estimated: false, agentId });
        translated = true;
      }
      const other = parts.filter((p) => !p.text && !p.functionCall && !p.functionResponse);
      if (other.length) raw("part", other, agentId);
      const a = ev.actions;
      if (a?.transferToAgent || a?.escalate || Object.keys(a?.requestedToolConfirmations ?? {}).length) raw("actions", a, agentId);
      else if (!translated && !other.length && !ev.errorCode) raw(ev.content ? "event" : "event/no-content", ev, agentId);
    },
  };
}

// ---------------------------------------------------------------------------
// Handoff, sessions
// ---------------------------------------------------------------------------

export function renderHandoff(p: HandoffPacket): string {
  const lines = [
    `Handoff from ${p.fromEngine} run ${p.fromRunId} (${p.createdAt}). These are Node's records; verify before relying on them.`,
    `Original task: ${preview(p.originalPrompt, 500)}`,
  ];
  if (p.goals.length) lines.push("Goals:", ...p.goals.map((g) => `- [${g.status}${g.claimedBy === "engine" ? ", engine-claimed" : ""}] ${g.title}`));
  if (p.artifacts.length) lines.push("Artifacts:", ...p.artifacts.map((a) => `- ${a.path} sha256:${a.sha256.slice(0, 12)} (${a.bytes} bytes)`));
  if (p.checks.length) lines.push("Checks:", ...p.checks.map((c) => `- ${c.checkId} ${c.ok ? "passed" : "FAILED"}: ${preview(c.summary, 200)}`));
  if (p.unresolved.length) lines.push("Unresolved (Node cannot prove these completed):", ...p.unresolved.map((u) => `- ${u}`));
  if (p.lastSummary) lines.push(`Previous engine's last summary: ${preview(p.lastSummary, 800)}`);
  return lines.join("\n");
}

interface SessionSnapshot {
  id: string;
  appName: string;
  userId: string;
  events: Event[];
}

function sessionFile(stateDir: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error(`Invalid ADK session id "${id}"`);
  return join(stateDir, "adk-sessions", `${id}.json`);
}

function sha256File(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createGoogleAdkAdapter(deps: GoogleAdkAdapterDeps = {}): EngineAdapter {
  const version = installedVersion();
  const descriptor = (): EngineDescriptor => ({
    id: "google-adk",
    label: "Google ADK",
    sdk: { name: SDK_NAME, version },
    defaultModel: DEFAULT_MODEL,
    defaultHelperModel: DEFAULT_HELPER_MODEL,
    models: MODELS,
    capabilities: CAPABILITIES,
  });
  return {
    descriptor,
    async availability(env) {
      const missing: string[] = [];
      if (!env.googleApiKey) missing.push("GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) is not set");
      if (version === "unknown") missing.push(`${SDK_NAME} is not installed`);
      return { ok: missing.length === 0, missing };
    },
    start: (spec, host) => startRun(spec, host, version, deps),
  };
}

function mainInstruction(defs: NodeToolDefinition[]): string {
  const has = (n: string) => defs.some((d) => d.name === n);
  return [
    "You are the main agent of a Node-run workspace. Act only through the provided tools; the workspace is reachable only through Node tools.",
    has("update_goals") ? "Record a short goal list with update_goals before working and keep the statuses current." : "",
    has("search_tools") && has("load_tool")
      ? "More Node tools exist than you can see. To use one, call search_tools with keywords, then load_tool with the exact names; loaded tools become callable on your next step."
      : "",
    `Use ${HELPER_TOOL} for independent subtasks: every task in one ${HELPER_TOOL} call runs concurrently in its own helper, which sees only its task text and the Node tools.`,
    "Skill scripts cannot be executed in this workspace; follow skill instructions with the available tools.",
    "Finish with a concise summary of what you did and what remains.",
  ]
    .filter(Boolean)
    .join("\n");
}

const HELPER_INSTRUCTION =
  "You are a helper agent. Complete only the task you were given, using the provided tools, then reply with a concise result. Do not ask questions.";

function startRun(spec: RunSpec, host: EngineHost, version: string, deps: GoogleAdkAdapterDeps): EngineRunHandle {
  const local = new AbortController();
  const signal = AbortSignal.any([host.signal, local.signal]);
  let interruptReason: string | undefined;
  const onHostAbort = () => {
    interruptReason ??= host.signal.reason ? `aborted: ${errText(host.signal.reason)}` : "aborted by host";
  };
  host.signal.addEventListener("abort", onHostAbort, { once: true });
  if (host.signal.aborted) onHostAbort();

  let finished = false;
  const emit = (e: EngineEventDraft) => {
    if (!finished) host.emit(e);
  };

  const done = (async (): Promise<EngineRunOutcome> => {
    const meter = new UsageMeter();
    let sessionId = spec.resume?.nativeSessionId;
    const fail = (error: string): EngineRunOutcome => ({ status: "failed", finalText: "", nativeSessionId: sessionId, usage: meter.totals(), error });
    const apiKey = host.env.googleApiKey;
    if (!apiKey) return fail("GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) is not set");

    const onUsage = (model: string, u: GenerateContentResponseUsageMetadata | undefined) => {
      meter.record(model, u);
      emit({ type: "usage", totals: meter.totals() });
    };
    const model = spec.model || DEFAULT_MODEL;
    const helperModel = spec.helperModel ?? DEFAULT_HELPER_MODEL;
    const mainLlm = new MeteredGemini(model, apiKey, onUsage);
    const helperLlm = new MeteredGemini(helperModel, apiKey, onUsage);

    // Skills: ADK's own SKILL.md loader over the workspace's active skills.
    const skillsDir = join(spec.workspaceDir, ".claude", "skills");
    const skillShas = new Map<string, string>();
    const loadSkills = async (): Promise<Record<string, Skill>> => {
      if (!existsSync(skillsDir)) return {};
      const skills = await loadAllSkillsInDir(skillsDir);
      skillShas.clear();
      for (const name of Object.keys(skills)) {
        const sha = sha256File(join(skillsDir, name, "SKILL.md"));
        if (sha) skillShas.set(name, sha);
      }
      return skills;
    };
    let skills: Record<string, Skill>;
    try {
      skills = await loadSkills();
    } catch (err) {
      host.log(`google-adk: loadAllSkillsInDir failed: ${errText(err)}`);
      skills = {};
    }
    const skillToolset = new NodeSkillToolset(skills);
    host.tools.setSkillRefresher(async () => {
      skillToolset.skills = await loadSkills();
    });

    // Node tools, minus names the native skill tools own (ADK rejects duplicate declarations).
    const defs = host.tools.list().filter((d) => !NATIVE_SKILL_TOOLS.has(d.name) && d.name !== HELPER_TOOL);
    const st: ToolState = { host, loaded: new Set() };
    const translator = createAdkTranslator({
      emit,
      familyOf: (n) => host.tools.get(n)?.family,
      skillSha: (n) => skillShas.get(n),
    });
    const observe = (ev: Event, agentId?: string) => {
      deps.onNative?.(ev, agentId);
      try {
        translator.onEvent(ev, agentId);
      } catch (err) {
        host.log(`google-adk: could not translate event ${ev.id}: ${errText(err)}`);
        emit({ type: "engine.raw", nativeType: "untranslatable", payload: preview(ev, RAW_CAP), agentId });
      }
    };

    const runHelper = async (helperId: string, task: string, n: number): Promise<Record<string, unknown>> => {
      const t0 = Date.now();
      let toolUses = 0;
      let tokens = 0;
      emit({ type: "helper.started", helperId, description: preview(task, 300), subagentType: "adk-llm-agent", model: helperModel, background: false });
      const agent = new LlmAgent({
        name: `helper_${n}`,
        model: helperLlm,
        instruction: HELPER_INSTRUCTION,
        tools: [new NodeToolset(defs, st, helperId)],
      });
      const runner = new Runner({ appName: `${APP_NAME}-helper`, agent, sessionService: new InMemorySessionService() });
      try {
        const session = await runner.sessionService.createSession({ appName: `${APP_NAME}-helper`, userId: spec.projectId });
        for await (const ev of runner.runAsync({
          userId: spec.projectId,
          sessionId: session.id,
          newMessage: { role: "user", parts: [{ text: task }] },
          runConfig: { streamingMode: StreamingMode.NONE, maxLlmCalls: HELPER_MAX_LLM_CALLS },
          abortSignal: signal,
        })) {
          observe(ev, helperId);
          tokens += ev.usageMetadata?.totalTokenCount ?? 0;
          const called = getFunctionCalls(ev);
          if (called.length && !ev.partial) {
            toolUses += called.length;
            emit({ type: "helper.progress", helperId, lastTool: called[called.length - 1].name, toolUses, totalTokens: tokens, durationMs: Date.now() - t0 });
          }
        }
      } catch (err) {
        const summary = errText(err);
        emit({ type: "helper.completed", helperId, status: signal.aborted ? "stopped" : "failed", summary, toolUses, totalTokens: tokens, durationMs: Date.now() - t0 });
        return { helperId, status: "failed", error: summary };
      }
      const text = translator.lastText(helperId);
      const status = signal.aborted ? "stopped" : text ? "completed" : "failed";
      emit({ type: "helper.completed", helperId, status, summary: preview(text || "helper produced no final text", 400), toolUses, totalTokens: tokens, durationMs: Date.now() - t0 });
      return status === "completed" ? { helperId, status, result: text } : { helperId, status, error: "helper produced no final text" };
    };

    class HelperTool extends BaseTool {
      constructor() {
        super({
          name: HELPER_TOOL,
          description: `Run 1-${MAX_HELPERS} helper agents concurrently, one per task. Each helper sees only its task text and the Node tools, and returns its final answer.`,
        });
      }
      override _getDeclaration(): FunctionDeclaration {
        return {
          name: this.name,
          description: this.description,
          parametersJsonSchema: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                minItems: 1,
                maxItems: MAX_HELPERS,
                items: { type: "string", description: "A self-contained task for one helper." },
              },
            },
            required: ["tasks"],
          },
        };
      }
      async runAsync({ args, toolContext }: RunAsyncToolRequest): Promise<unknown> {
        const tasks = Array.isArray(args.tasks) ? args.tasks.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
        if (tasks.length === 0 || tasks.length > MAX_HELPERS) return { error: `tasks must be 1-${MAX_HELPERS} non-empty strings` };
        const parent = toolContext.functionCallId ?? `call-${Date.now()}`;
        return { helpers: await Promise.all(tasks.map((t, i) => runHelper(`${parent}.h${i + 1}`, t, i + 1))) };
      }
    }

    let compactT0: number | undefined;
    const agent = new LlmAgent({
      name: MAIN_AGENT,
      model: mainLlm,
      instruction: mainInstruction(defs),
      tools: [new NodeToolset(defs, st), skillToolset, new HelperTool()],
      contextCompactors: [
        new TokenBasedContextCompactor({
          tokenThreshold: spec.context.autoCompactTokens ?? DEFAULT_COMPACT_TOKENS,
          eventRetentionSize: RETAINED_EVENTS,
          summarizer: new LlmSummarizer({ llm: helperLlm }),
        }),
      ],
    });
    const sessionService = new InMemorySessionService();
    const runner = new Runner({
      appName: APP_NAME,
      agent,
      sessionService,
      plugins: [
        new CompactionWatch(
          () => {
            compactT0 = Date.now();
            emit({ type: "run.status", status: "compacting" });
          },
          () => {
            translator.setCompactionMs(compactT0 === undefined ? undefined : Date.now() - compactT0);
            emit({ type: "run.status", status: "running" });
          },
        ),
      ],
    });

    const userId = spec.projectId;
    try {
      if (sessionId) {
        const file = sessionFile(host.stateDir, sessionId);
        if (!existsSync(file)) return fail(`ADK session ${sessionId} has no snapshot in this engine's state directory`);
        const snap = JSON.parse(readFileSync(file, "utf8")) as SessionSnapshot;
        const session = await sessionService.createSession({ appName: APP_NAME, userId, sessionId });
        for (const event of snap.events) await sessionService.appendEvent({ session, event });
      } else {
        sessionId = (await sessionService.createSession({ appName: APP_NAME, userId })).id;
      }
    } catch (err) {
      return fail(`could not prepare ADK session: ${errText(err)}`);
    }

    emit({
      type: "run.started",
      engine: "google-adk",
      model,
      sdkVersion: version,
      nativeSessionId: sessionId,
      cwd: spec.workspaceDir,
      tools: [...defs.filter((d) => d.alwaysLoad === true).map((d) => d.name), ...NATIVE_SKILL_TOOLS, HELPER_TOOL],
      deferredTools: defs.filter((d) => d.alwaysLoad !== true).map((d) => d.name),
      skills: Object.keys(skills),
      helpers: [`helper (${helperModel})`],
    });

    const text = spec.handoff && !spec.resume ? `${renderHandoff(spec.handoff)}\n\n---\n\n${spec.prompt}` : spec.prompt;
    let thrown: string | undefined;
    try {
      for await (const ev of runner.runAsync({
        userId,
        sessionId,
        newMessage: { role: "user", parts: [{ text }] },
        runConfig: { streamingMode: StreamingMode.SSE, maxLlmCalls: spec.budget.maxTurns ?? 500 },
        abortSignal: signal,
      })) {
        observe(ev);
      }
    } catch (err) {
      if (!signal.aborted) thrown = errText(err);
    } finally {
      host.signal.removeEventListener("abort", onHostAbort);
      try {
        const s = await sessionService.getSession({ appName: APP_NAME, userId, sessionId });
        if (s) {
          mkdirSync(join(host.stateDir, "adk-sessions"), { recursive: true });
          const snap: SessionSnapshot = { id: s.id, appName: APP_NAME, userId, events: s.events };
          writeFileSync(sessionFile(host.stateDir, sessionId), JSON.stringify(snap));
        }
      } catch (err) {
        host.log(`google-adk: session snapshot failed: ${errText(err)}`);
      }
    }

    const usage = meter.totals();
    emit({ type: "usage", totals: usage });
    finished = true;
    const base = { finalText: translator.lastText(), nativeSessionId: sessionId, usage };
    if (signal.aborted) return { ...base, status: "interrupted", error: interruptReason ?? "interrupted" };
    if (thrown) return { ...base, status: "failed", error: thrown };
    if (!base.finalText) return { ...base, status: "failed", error: translator.lastError() ?? "ADK run ended without assistant text" };
    return { ...base, status: "completed" };
  })();

  return {
    done,
    async interrupt(reason: string) {
      interruptReason ??= reason;
      local.abort(reason);
    },
  };
}
