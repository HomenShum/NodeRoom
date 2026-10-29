/**
 * OpenAI Agents SDK adapter. One streamed Runner.run() per run over the
 * Responses API. Node tools are SDK function tools that execute only through
 * host.tools.call; tools without alwaysLoad are deferLoading behind the hosted
 * tool_search. Helpers are a native agent-as-tool (spawn_helper): the child
 * stream arrives through onStream and child tool executions see the helper id
 * through AsyncLocalStorage. Server-side compaction via
 * modelSettings.contextManagement. Resume = a file-backed SDK Session under
 * host.stateDir whose id is the nativeSessionId. No native side-effecting
 * tools are exposed (no shell / apply_patch), so every write passes Node policy.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, OpenAIProvider, Runner, tool, toolSearchTool } from "@openai/agents";
import type { AgentInputItem, FunctionTool, ModelSettings, RunStreamEvent, Session, Tool } from "@openai/agents";
import { emptyUsage, preview } from "../contract.js";
import type {
  Capability,
  CapabilityEntry,
  EngineAdapter,
  EngineDescriptor,
  EngineHost,
  EngineRunHandle,
  EngineRunOutcome,
  HandoffPacket,
  NodeToolDefinition,
  RunSpec,
  UsageTotals,
} from "../contract.js";
import { priceUsage } from "../pricing.js";

const SDK_NAME = "@openai/agents";
/** Capability statuses below were observed on this version (qualification/openai-agents.json). */
const QUALIFIED_SDK_VERSION = "0.21.0";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_HELPER_MODEL = "gpt-5.4-mini";
/** Hosted tool_search needs gpt-5.4 or newer. */
const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-6-sol"];
const HELPER_TOOL = "spawn_helper";
const TOOL_SEARCH = "tool_search";
const RAW_CAP = 4000;
const MAX_TRACKED = 2000;
const DELTA_FLUSH_CHARS = 400;
const DEFAULT_MAX_TURNS = 40;
const SESSION_ID = /^oas_[0-9a-f-]{36}$/;

const MAIN_RULES = [
  "You run inside a Node-managed workspace. You have no shell and no direct filesystem: use only the provided tools.",
  "- Some tools are deferred: call tool_search to find and load them, then call them.",
  `- Delegate independent subtasks with ${HELPER_TOOL}. When subtasks are independent, issue several ${HELPER_TOOL} calls in the SAME turn so they run concurrently.`,
  "- If an update_goals tool is available, keep a short plan current with it (mark items done as you finish them).",
  "- If search_skills / load_skill are available, use them to find and follow workspace skills.",
  "- Cite workspace sources in documents as [src:<workspace-relative path>#L<start>] or [src:<path>#L<start>-L<end>].",
  "- Never write under .claude/ yourself.",
].join("\n");

const HELPER_RULES = [
  "You are a helper agent working on one self-contained subtask inside a Node-managed workspace.",
  "Use only the provided tools; some are deferred, so call tool_search to find and load them first.",
  "Finish with a concise plain-text result for the agent that delegated to you.",
].join("\n");

const CAPABILITIES: Record<Capability, CapabilityEntry> = {
  start: { status: "NATIVE", note: "Runner.run(agent, input, { stream: true }) over the Responses API" },
  stream: { status: "NATIVE", note: "raw_model_stream_event output_text_delta -> message.delta (main agent, coalesced)" },
  interrupt: { status: "NATIVE", note: "run signal abort (handle.interrupt / host.signal); done resolves interrupted" },
  resume: { status: "NATIVE", note: "SDK Session interface, file-backed under stateDir; nativeSessionId = session id" },
  subagents: { status: "NATIVE", note: "Agent.asTool (spawn_helper); parallel function calls run concurrently" },
  childEventIdentity: { status: "NATIVE", note: "asTool onStream toolCall.callId = helperId on every child event" },
  compaction: { status: "NATIVE", note: "modelSettings.contextManagement compactThreshold = spec.context.autoCompactTokens; compaction_item_created" },
  toolSearch: { status: "NATIVE", note: "toolSearchTool() + deferLoading for non-alwaysLoad Node tools; tool_search_called/_output_created" },
  skillLoad: { status: "APP-IMPLEMENTED", note: "Node search_skills/load_skill tools; SDK local shell skills need the UnixLocal sandbox (throws on win32)" },
  skillRefresh: { status: "UNTESTED", note: "no native skill cache; Node skill tools read disk per call" },
  goals: { status: "APP-IMPLEMENTED", note: "Node update_goals tool (no native planning in the SDK)" },
  permissions: { status: "APP-IMPLEMENTED", note: "no native side-effecting tools exposed; Node tools pass the gateway policy" },
  usage: { status: "NATIVE", note: "response_done usage per model call (main and helpers)" },
  costUsd: { status: "APP-IMPLEMENTED", note: "SDK reports tokens only; priceUsage() per model, null when a model is unpriced" },
};

export interface OpenAIAgentsAdapterDeps {
  /** Sees every native stream record before translation (qualification fixture capture). */
  onNative?: (rec: NativeRecord) => void;
}

/** Plain, serializable form of one SDK stream event. Fixtures and live runs share it. */
export interface NativeRecord {
  /** undefined = main agent, else the helper id (spawn_helper call id). */
  agentId?: string;
  type: string;
  name?: string;
  item?: { type: string; rawItem: any; output?: unknown };
  data?: any;
  agent?: string;
}

function installedVersion(pkg: string): string | undefined {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(pkg)));
    for (let i = 0; i < 5; i++, dir = dirname(dir)) {
      const file = join(dir, "package.json");
      if (!existsSync(file)) continue;
      const json = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (json.name === pkg) return json.version;
    }
  } catch {
    /* not installed */
  }
  return undefined;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K);
}

function rememberSet<K>(set: Set<K>, key: K): void {
  set.add(key);
  if (set.size > MAX_TRACKED) set.delete(set.values().next().value as K);
}

/** Provider errors can echo a masked key; strip anything key-shaped. */
function errText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/sk-[A-Za-z0-9_*-]{6,}/g, "sk-[redacted]");
}

function parseArgs(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "text" in output && typeof (output as { text: unknown }).text === "string") {
    return (output as { text: string }).text;
  }
  return preview(output, RAW_CAP);
}

function messageText(raw: any): string {
  const content = Array.isArray(raw?.content) ? raw.content : [];
  return content
    .map((c: any) => (c?.type === "output_text" ? c.text : c?.type === "refusal" ? `[refusal] ${c.refusal}` : ""))
    .join("");
}

function tokenDetail(details: unknown, ...keys: string[]): number {
  const list = Array.isArray(details) ? details : details ? [details] : [];
  let n = 0;
  for (const d of list) for (const k of keys) if (typeof (d as Record<string, unknown>)?.[k] === "number") n += (d as Record<string, number>)[k];
  return n;
}

function skillNames(workspaceDir: string): string[] {
  const dir = join(workspaceDir, ".claude", "skills");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Portable packet only; never claims another engine's opaque state. */
export function renderHandoff(p: HandoffPacket): string {
  const lines = [
    `Handoff from a previous ${p.fromEngine} run (${p.fromRunId}). This is everything you inherit; verify before relying on it.`,
    `Original task: ${preview(p.originalPrompt, 800)}`,
  ];
  if (p.goals.length) lines.push("Goals:", ...p.goals.map((g) => `- [${g.status}] ${g.title} (claimed by ${g.claimedBy})`));
  if (p.artifacts.length) lines.push("Artifacts:", ...p.artifacts.map((a) => `- ${a.path} sha256=${a.sha256} bytes=${a.bytes}`));
  if (p.checks.length) lines.push("Checks:", ...p.checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"} ${c.checkId}: ${preview(c.summary, 200)}`));
  if (p.unresolved.length) lines.push("Unresolved (not proven complete):", ...p.unresolved.map((u) => `- ${u}`));
  if (p.lastSummary) lines.push(`Last summary from the previous engine: ${preview(p.lastSummary, 1200)}`);
  return lines.join("\n");
}

/** SDK Session persisted as one JSON file per session under stateDir. */
export class FileSession implements Session {
  constructor(private readonly file: string, private readonly id: string) {}

  static path(stateDir: string, id: string): string {
    return join(stateDir, "openai-sessions", `${id}.json`);
  }

  static create(stateDir: string): FileSession {
    const id = `oas_${randomUUID()}`;
    const s = new FileSession(FileSession.path(stateDir, id), id);
    s.write([]);
    return s;
  }

  /** Returns undefined when the id is malformed or the session does not exist. */
  static open(stateDir: string, id: string): FileSession | undefined {
    if (!SESSION_ID.test(id)) return undefined;
    const file = FileSession.path(stateDir, id);
    return existsSync(file) ? new FileSession(file, id) : undefined;
  }

  private read(): AgentInputItem[] {
    return JSON.parse(readFileSync(this.file, "utf8")) as AgentInputItem[];
  }

  private write(items: AgentInputItem[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(items));
    renameSync(tmp, this.file);
  }

  async getSessionId(): Promise<string> {
    return this.id;
  }
  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = this.read();
    return limit === undefined ? items : items.slice(-limit);
  }
  async addItems(items: AgentInputItem[]): Promise<void> {
    this.write([...this.read(), ...items]);
  }
  async popItem(): Promise<AgentInputItem | undefined> {
    const items = this.read();
    const last = items.pop();
    this.write(items);
    return last;
  }
  async clearSession(): Promise<void> {
    this.write([]);
  }
}

interface ModelTokens {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Native record -> contract events. Idempotent per call id, so a Node tool
 * that announces itself at execution time is not announced again by the stream.
 */
export function createTranslator(host: Pick<EngineHost, "emit" | "tools">, models: { main: string; helper: string }) {
  const emittedCalls = new Set<string>();
  const emittedResults = new Set<string>();
  const callStart = new Map<string, number>();
  const callOk = new Map<string, boolean>();
  const searchQuery = new Map<string, string>();
  const pendingSearch = new Map<string, string[]>();
  const byModel = new Map<string, ModelTokens>();
  const lastInput = new Map<string, number>();
  const helperTokens = new Map<string, number>();
  const helperTools = new Map<string, number>();
  const lastText = new Map<string, string>();
  let turns = 0;
  let delta = "";

  const scope = (agentId?: string) => (agentId ? { agentId } : {});

  const flush = () => {
    if (!delta) return;
    host.emit({ type: "message.delta", text: delta });
    delta = "";
  };

  const emitCall = (c: { callId: string; name: string; input: unknown; agentId?: string }) => {
    if (emittedCalls.has(c.callId)) return;
    rememberSet(emittedCalls, c.callId);
    remember(callStart, c.callId, Date.now());
    const def = host.tools.get(c.name);
    host.emit({
      type: "tool.call",
      callId: c.callId,
      name: c.name,
      family: def?.family ?? "native",
      inputPreview: preview(parseArgs(c.input)),
      native: !def,
      ...scope(c.agentId),
    });
    if (c.agentId) {
      const n = (helperTools.get(c.agentId) ?? 0) + 1;
      remember(helperTools, c.agentId, n);
      host.emit({ type: "helper.progress", helperId: c.agentId, lastTool: c.name, toolUses: n });
    }
  };

  const emitResult = (r: { callId: string; ok: boolean; output: unknown; agentId?: string; ms?: number }) => {
    if (emittedResults.has(r.callId)) return;
    rememberSet(emittedResults, r.callId);
    const t0 = callStart.get(r.callId);
    callStart.delete(r.callId);
    host.emit({
      type: "tool.result",
      callId: r.callId,
      ok: r.ok,
      preview: preview(outputText(r.output)),
      ms: r.ms ?? (t0 === undefined ? undefined : Date.now() - t0),
      ...scope(r.agentId),
    });
  };

  const totals = (): UsageTotals => {
    const u = emptyUsage();
    let cost: number | null = 0;
    for (const [model, t] of byModel) {
      u.inputTokens += t.input;
      u.outputTokens += t.output;
      u.cacheReadTokens += t.cacheRead;
      const priced = priceUsage(model, { inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.cacheRead });
      cost = cost === null || priced.costUsd === null ? null : cost + priced.costUsd;
    }
    u.modelTurns = turns;
    if (byModel.size && cost !== null) {
      u.costUsd = Math.round(cost * 1e6) / 1e6;
      u.costSource = "price-table";
    }
    return u;
  };

  const onUsage = (agentId: string | undefined, usage: any) => {
    if (!usage) return;
    const model = agentId ? models.helper : models.main;
    const input = Number(usage.inputTokens ?? 0);
    const output = Number(usage.outputTokens ?? 0);
    // OpenAI reports cached tokens as a subset of input; pricing wants them apart.
    const cached = Math.min(input, tokenDetail(usage.inputTokensDetails, "cached_tokens", "cachedTokens"));
    const t = byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0 };
    t.input += input - cached;
    t.output += output;
    t.cacheRead += cached;
    byModel.set(model, t);
    turns++;
    remember(lastInput, agentId ?? "", input);
    if (agentId) remember(helperTokens, agentId, (helperTokens.get(agentId) ?? 0) + input + output);
    host.emit({ type: "context.usage", usedTokens: input + output, estimated: false, ...scope(agentId) });
    host.emit({ type: "usage", totals: totals() });
  };

  const raw = (rec: NativeRecord, nativeType: string, payload: unknown) =>
    host.emit({ type: "engine.raw", nativeType, payload: preview(payload, RAW_CAP), ...scope(rec.agentId) });

  const onRecord = (rec: NativeRecord) => {
    const { agentId } = rec;
    if (rec.type === "raw_model_stream_event") {
      const d = rec.data ?? {};
      if (d.type === "output_text_delta") {
        if (agentId) return; // helper text arrives whole as message_output_created
        delta += String(d.delta ?? "");
        if (delta.length >= DELTA_FLUSH_CHARS) flush();
      } else if (d.type === "response_done") {
        onUsage(agentId, d.response?.usage);
      }
      // Other raw model events (response_started, argument deltas) are covered by the items below.
      return;
    }
    flush();
    if (rec.type === "agent_updated_stream_event") return raw(rec, "agent_updated", { agent: rec.agent });
    if (rec.type !== "run_item_stream_event" || !rec.item) return raw(rec, rec.type, rec);
    const r = rec.item.rawItem ?? {};
    switch (rec.name) {
      case "tool_called": {
        const callId = String(r.callId ?? r.call_id ?? r.id ?? randomUUID());
        return emitCall({ callId, name: String(r.name ?? r.type), input: r.arguments ?? r.action ?? r, agentId });
      }
      case "tool_output": {
        const callId = String(r.callId ?? r.call_id ?? r.id ?? "");
        const text = outputText(rec.item.output ?? r.output);
        const ok = callOk.get(callId) ?? !/^An error occurred while (running|parsing)/.test(text);
        return emitResult({ callId, ok, output: text, agentId });
      }
      case "tool_search_called": {
        const callId = String(r.callId ?? r.call_id ?? r.id ?? randomUUID());
        const a = (parseArgs(r.arguments) ?? {}) as { query?: unknown; paths?: unknown };
        const query = typeof a.query === "string" ? a.query : Array.isArray(a.paths) ? a.paths.join(", ") : preview(a, 200);
        remember(searchQuery, callId, query);
        // Server-executed search links call (tsc_*) and output (tso_*) only by order.
        const queue = pendingSearch.get(agentId ?? "") ?? [];
        queue.push(callId);
        remember(pendingSearch, agentId ?? "", queue.slice(-16));
        return emitCall({ callId, name: TOOL_SEARCH, input: r.arguments, agentId });
      }
      case "tool_search_output_created": {
        const callId = String(r.callId ?? r.call_id ?? pendingSearch.get(agentId ?? "")?.shift() ?? r.id ?? "");
        const names: string[] = (Array.isArray(r.tools) ? r.tools : [])
          .map((t: any) => t?.name ?? t?.functionName ?? t?.function_name)
          .filter((n: unknown): n is string => typeof n === "string");
        host.emit({ type: "tool.search", callId, query: searchQuery.get(callId) ?? "", results: names, via: "native", ...scope(agentId) });
        if (names.length) host.emit({ type: "tool.loaded", names, via: "native-tool-search", ...scope(agentId) });
        return emitResult({ callId, ok: true, output: names.length ? `loaded: ${names.join(", ")}` : "no tools matched", agentId });
      }
      case "message_output_created": {
        const text = messageText(r);
        if (!text) return;
        remember(lastText, agentId ?? "", text);
        host.emit({ type: "message", role: "assistant", text, ...scope(agentId) });
        if (agentId) host.emit({ type: "helper.progress", helperId: agentId, summary: preview(text, 300) });
        return;
      }
      case "compaction_item_created":
        return host.emit({
          type: "context.compacted",
          trigger: "auto",
          // The compacting response's input size, i.e. the context before compaction.
          preTokens: lastInput.get(agentId ?? "") ?? 0,
          nativeRef: typeof r.id === "string" ? r.id : undefined,
          ...scope(agentId),
        });
      case "reasoning_item_created": {
        const summary = (Array.isArray(r.content) ? r.content : []).map((c: any) => c?.text ?? "").join(" ");
        return raw(rec, "reasoning_item_created", summary || "(reasoning, no summary)");
      }
      default:
        return raw(rec, rec.name ?? rec.type, rec.item);
    }
  };

  return {
    onRecord,
    emitCall,
    emitResult,
    flush,
    totals,
    markOk: (callId: string, ok: boolean) => remember(callOk, callId, ok),
    helperTokens: (id: string) => helperTokens.get(id),
    helperToolUses: (id: string) => helperTools.get(id),
    lastText: (agentId?: string) => lastText.get(agentId ?? "") ?? "",
  };
}

/** Trim a live SDK event to its serializable essentials. */
export function toRecord(ev: RunStreamEvent, agentId?: string): NativeRecord {
  const base = agentId ? { agentId } : {};
  if (ev.type === "raw_model_stream_event") {
    const d = ev.data as any;
    if (d?.type === "response_done") return { ...base, type: ev.type, data: { type: d.type, response: { id: d.response?.id, usage: d.response?.usage } } };
    if (d?.type === "output_text_delta") return { ...base, type: ev.type, data: { type: d.type, delta: d.delta } };
    return { ...base, type: ev.type, data: { type: d?.type } };
  }
  if (ev.type === "agent_updated_stream_event") return { ...base, type: ev.type, agent: ev.agent?.name };
  const item = ev.item as any;
  return { ...base, type: ev.type, name: ev.name, item: { type: item?.type, rawItem: item?.rawItem, output: item?.output } };
}

function jsonParams(schema: Record<string, unknown>): any {
  const { $schema: _drop, ...rest } = schema;
  return { type: "object", properties: {}, ...rest };
}

export function createOpenAIAgentsAdapter(deps: OpenAIAgentsAdapterDeps = {}): EngineAdapter {
  const version = installedVersion(SDK_NAME);
  const descriptor: EngineDescriptor = {
    id: "openai-agents",
    label: "OpenAI Agents SDK",
    sdk: { name: SDK_NAME, version: version ?? "not installed" },
    defaultModel: DEFAULT_MODEL,
    defaultHelperModel: DEFAULT_HELPER_MODEL,
    models: MODELS,
    capabilities:
      version === QUALIFIED_SDK_VERSION
        ? CAPABILITIES
        : (Object.fromEntries(
            Object.entries(CAPABILITIES).map(([k, v]) => [k, { status: "UNTESTED", note: `qualified on ${QUALIFIED_SDK_VERSION}, installed ${version ?? "none"}: ${v.note}` }]),
          ) as Record<Capability, CapabilityEntry>),
  };

  return {
    descriptor: () => descriptor,
    async availability(env) {
      const missing: string[] = [];
      if (!version) missing.push(`${SDK_NAME} is not installed`);
      if (!env.openaiApiKey) missing.push("OPENAI_API_KEY is not set");
      return { ok: missing.length === 0, missing };
    },
    start(spec, host) {
      const ac = new AbortController();
      let interruptReason: string | undefined;
      const onHostAbort = () => {
        interruptReason ??= String(host.signal.reason ?? "host signal aborted");
        ac.abort(interruptReason);
      };
      if (host.signal.aborted) onHostAbort();
      else host.signal.addEventListener("abort", onHostAbort, { once: true });
      // done never rejects: setup errors (e.g. an unwritable stateDir) become a failed outcome.
      const done = runOnce(spec, host, ac, () => interruptReason, deps)
        .catch((err): EngineRunOutcome => ({ status: "failed", finalText: "", usage: emptyUsage(), error: errText(err) }))
        .finally(() => host.signal.removeEventListener("abort", onHostAbort));
      return {
        done,
        async interrupt(reason) {
          interruptReason ??= reason;
          ac.abort(reason);
          await done.catch(() => undefined);
        },
      } satisfies EngineRunHandle;
    },
  };
}

async function runOnce(
  spec: RunSpec,
  host: EngineHost,
  ac: AbortController,
  interruptReason: () => string | undefined,
  deps: OpenAIAgentsAdapterDeps,
): Promise<EngineRunOutcome> {
  const model = spec.model || DEFAULT_MODEL;
  const helperModel = spec.helperModel || DEFAULT_HELPER_MODEL;
  const t = createTranslator(host, { main: model, helper: helperModel });
  const fail = (error: string, nativeSessionId?: string): EngineRunOutcome => ({
    status: "failed",
    finalText: "",
    nativeSessionId,
    usage: t.totals(),
    error,
  });
  if (!host.env.openaiApiKey) return fail("Setup required: OPENAI_API_KEY is not set");

  let session: FileSession;
  if (spec.resume) {
    const s = FileSession.open(host.stateDir, spec.resume.nativeSessionId);
    if (!s) return fail(`native session ${preview(spec.resume.nativeSessionId, 80)} not found in this engine's state directory`);
    session = s;
  } else {
    session = FileSession.create(host.stateDir);
  }
  const nativeSessionId = await session.getSessionId();

  const provider = new OpenAIProvider({ apiKey: host.env.openaiApiKey, useResponses: true });
  const als = new AsyncLocalStorage<string>();
  // Deferred tools become callable only through the hosted tool_search. Node's own
  // search_tools/load_tool return schemas but cannot install them into this SDK's request,
  // so exposing both left the model loading tools that never became callable (observed:
  // 22 search_tools + 12 load_tool calls, zero writes). One discovery mechanism per engine.
  const defs = host.tools.list().filter((d) => d.name !== "search_tools" && d.name !== "load_tool");
  const deferred = defs.filter((d) => d.alwaysLoad !== true).map((d) => d.name);
  const immediate = defs.filter((d) => d.alwaysLoad === true).map((d) => d.name);

  const nodeTool = (def: NodeToolDefinition): FunctionTool<any, any, string> =>
    tool({
      name: def.name,
      description: def.description,
      parameters: jsonParams(host.tools.jsonSchema(def.name)),
      strict: false,
      deferLoading: def.alwaysLoad !== true,
      execute: async (input: unknown, _ctx: unknown, details?: { toolCall?: { callId?: string; arguments?: string } }) => {
        const agentId = als.getStore();
        const callId = details?.toolCall?.callId ?? `node-${randomUUID()}`;
        t.emitCall({ callId, name: def.name, input: details?.toolCall?.arguments ?? input, agentId });
        const out = await host.tools.call(def.name, parseArgs(input), { agentId, callId });
        t.markOk(callId, out.ok);
        t.emitResult({ callId, ok: out.ok, output: out.content, agentId, ms: out.ms });
        return out.ok ? out.content : `[tool failed] ${out.content}`;
      },
    }) as FunctionTool<any, any, string>;
  const toolSet = (): Tool[] => [...defs.map(nodeTool), ...(deferred.length ? [toolSearchTool()] : [])];

  const helperAgent = new Agent({
    name: "helper",
    instructions: HELPER_RULES,
    model: helperModel,
    tools: toolSet(),
    modelSettings: { parallelToolCalls: true },
  });
  const helper = helperAgent.asTool({
    toolName: HELPER_TOOL,
    toolDescription:
      "Delegate one self-contained subtask to a helper agent with the same tools. Input: the full subtask description. Call several times in one turn for independent subtasks; they run concurrently.",
    runConfig: { modelProvider: provider, tracingDisabled: true },
    onStream: ({ event, toolCall }) => {
      const rec = toRecord(event, toolCall?.callId ?? "helper");
      deps.onNative?.(rec);
      t.onRecord(rec);
    },
  });
  const invoke = helper.invoke.bind(helper);
  helper.invoke = async (runContext, input, details) => {
    const helperId = details?.toolCall?.callId ?? `helper-${randomUUID()}`;
    const task = parseArgs(input) as { input?: unknown };
    t.emitCall({ callId: helperId, name: HELPER_TOOL, input, agentId: als.getStore() });
    host.emit({
      type: "helper.started",
      helperId,
      description: preview(typeof task?.input === "string" ? task.input : input, 300),
      subagentType: "helper",
      model: helperModel,
    });
    const t0 = Date.now();
    const stats = () => ({ totalTokens: t.helperTokens(helperId), toolUses: t.helperToolUses(helperId) ?? 0, durationMs: Date.now() - t0 });
    try {
      const out = await als.run(helperId, () => invoke(runContext, input, details));
      host.emit({ type: "helper.completed", helperId, status: "completed", summary: preview(outputText(out), 600), ...stats() });
      t.markOk(helperId, true);
      return out;
    } catch (err) {
      host.emit({ type: "helper.completed", helperId, status: ac.signal.aborted ? "stopped" : "failed", summary: errText(err), ...stats() });
      t.markOk(helperId, false);
      throw err;
    }
  };

  const modelSettings: ModelSettings = { parallelToolCalls: true };
  if (spec.context.autoCompactTokens) {
    modelSettings.contextManagement = [{ type: "compaction", compactThreshold: spec.context.autoCompactTokens }];
  }
  const main = new Agent({ name: "main", instructions: MAIN_RULES, model, tools: [...toolSet(), helper], modelSettings });
  const runner = new Runner({ modelProvider: provider, tracingDisabled: true, workflowName: "nodeagent" });

  host.emit({
    type: "run.started",
    engine: "openai-agents",
    model,
    sdkVersion: installedVersion(SDK_NAME) ?? "unknown",
    nativeSessionId,
    cwd: spec.workspaceDir,
    tools: [...immediate, HELPER_TOOL, ...(deferred.length ? [TOOL_SEARCH] : [])],
    deferredTools: deferred,
    skills: skillNames(spec.workspaceDir),
    helpers: ["helper"],
  });

  const input = spec.handoff ? `${renderHandoff(spec.handoff)}\n\n---\n\n${spec.prompt}` : spec.prompt;
  let error: unknown;
  let finalOutput: unknown;
  try {
    const result = await runner.run(main, input, {
      stream: true,
      signal: ac.signal,
      maxTurns: spec.budget.maxTurns ?? DEFAULT_MAX_TURNS,
      session,
    });
    for await (const ev of result) {
      const rec = toRecord(ev);
      deps.onNative?.(rec);
      t.onRecord(rec);
    }
    await result.completed.catch((e: unknown) => (error ??= e));
    error ??= result.error ?? undefined;
    if (!error && !ac.signal.aborted) finalOutput = result.finalOutput;
  } catch (e) {
    error = e;
  }
  t.flush();
  const usage = t.totals();
  const finalText = typeof finalOutput === "string" ? finalOutput : finalOutput === undefined ? t.lastText() : preview(finalOutput, 20_000);
  if (ac.signal.aborted) {
    return { status: "interrupted", finalText: t.lastText(), nativeSessionId, usage, error: interruptReason() ?? "interrupted" };
  }
  if (error) return { status: "failed", finalText: t.lastText(), nativeSessionId, usage, error: errText(error) };
  return { status: "completed", finalText, nativeSessionId, usage };
}

