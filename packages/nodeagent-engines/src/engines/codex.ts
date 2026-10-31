/**
 * Codex engine: the pinned `@openai/codex` binary's `app-server` (JSON-RPC over
 * stdio JSONL), one process per run, CODEX_HOME inside host.stateDir.
 *
 * Node tools are Codex dynamic tools in the `node` namespace and execute only
 * through host.tools.call. Shell commands and patches reach Node policy through
 * Codex's own approval requests (read-only sandbox + approvalPolicy "untrusted").
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Capability,
  CapabilityEntry,
  EngineAdapter,
  EngineEventDraft,
  EngineHost,
  EngineRunHandle,
  EngineRunOutcome,
  HandoffPacket,
  NodeToolDefinition,
  RunSpec,
} from "../contract.js";
import { preview } from "../contract.js";
import { cleanChildEnv } from "../env.js";
import { CodexRpc, resolveCodexBinary, type RpcMessage } from "./codex/rpc.js";
import { createTranslator } from "./codex/translate.js";

const SDK_NAME = "@openai/codex";
const DEFAULT_MODEL = "gpt-5.5";
// Only models the pinned codex 0.165.0 binary ships metadata for. Others (gpt-5.4-mini,
// gpt-5.3-codex) run on "fallback metadata" without apply_patch — observed in real runs.
const DEFAULT_HELPER_MODEL = "gpt-6-luna";
const MODELS = ["gpt-5.5", "gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-6-luna"];
const NAMESPACE = "node";
const DELTA_MS = 100;
const RPC_TIMEOUT_MS = 30_000;
const INTERRUPT_GRACE_MS = 8_000;
const MAX_TRACKED = 2000;
/** Kept in CODEX_HOME/config.toml: the API key lives in memory only, never auth.json. */
const EPHEMERAL_AUTH = 'cli_auth_credentials_store = "ephemeral"';

// Statuses are what qualification/codex.json observed on 0.165.0 (fake host, gpt-5.4-mini, since dropped
// from MODELS), except goals: worker runs on listed models only ever showed Node's update_goals.
const CAPABILITIES: Record<Capability, CapabilityEntry> = {
  start: { status: "NATIVE", note: "app-server thread/start + turn/start; run.started once the thread id is known" },
  stream: { status: "NATIVE", note: "item/agentMessage/delta -> message.delta (main agent, ~100ms coalesced)" },
  interrupt: { status: "NATIVE", note: "turn/interrupt -> turn/completed status interrupted" },
  resume: { status: "NATIVE", note: "thread/resume by thread id; rollouts persist under CODEX_HOME in stateDir" },
  subagents: { status: "NATIVE", note: "multi_agent collab tools (spawn_agent/wait_agent) -> collabAgentToolCall items + child threads" },
  childEventIdentity: { status: "NATIVE", note: "child threadId from receiverThreadIds = helperId = agentId on all child items" },
  compaction: { status: "NATIVE", note: "config model_auto_compact_token_limit = context.autoCompactTokens; contextCompaction item" },
  toolSearch: {
    status: "NATIVE",
    note: "dynamicTools deferLoading + Codex tool_search (raw tool_search_call/output) for models in Codex's catalog; others get APP-IMPLEMENTED search_tools/load_tool/call_tool",
  },
  skillLoad: {
    status: "NATIVE",
    note: "discovery is native (skills/extraRoots/set over <workspace>/.claude/skills); skill.loaded is Node's inference from a completed command that read a SKILL.md, not a native load event",
  },
  skillRefresh: { status: "NATIVE", note: "skills/list forceReload registered as the gateway skill refresher" },
  goals: {
    status: "APP-IMPLEMENTED",
    note: "Node update_goals (every worker-run goals.updated so far: source node-goals). Native thread goals -> codex:goal seen only in fake-host qualification on gpt-5.4-mini",
  },
  permissions: { status: "NATIVE", note: "read-only sandbox + approvalPolicy untrusted; command/fileChange approval requests run host.policy" },
  usage: { status: "NATIVE", note: "rawResponse/completed per-response usage (includes compaction and helper threads)" },
  costUsd: { status: "APP-IMPLEMENTED", note: "Codex reports tokens, not USD; priced with the Node price table per thread model" },
};

function rules(spec: RunSpec, nativeSearch: boolean, hasDeferred: boolean): string {
  // spawn_agent's model argument only offers Codex catalog models; a child spawned without one inherits
  // the parent's model, while a guessed one runs whatever the model picked (observed: gpt-6.1-sol, unpriced).
  const helper =
    spec.helperModel && spec.helperModel !== spec.model
      ? ` Pass model "${spec.helperModel}" to spawn_agent.`
      : " Do not pass a model to spawn_agent; helpers inherit yours.";
  const search = !hasDeferred
    ? ""
    : nativeSearch
      ? "- Some Node tools are deferred: use tool_search to find and load them before calling."
      : "- More Node tools exist than are listed: find them with node.search_tools, load them with node.load_tool, then call them with node.call_tool {name, arguments}.";
  return [
    "You are working in a NodeAgent project workspace (the current working directory).",
    "- Use workspace-relative paths and stay inside the workspace.",
    "- Node checks every shell command: run one simple command at a time (cat, ls, head, tail, wc, grep, find, node --test, npm test) without pipes, chaining or redirects. A rejected command was denied by Node policy; do not retry it unchanged.",
    "- Never write under .claude/ yourself; skills are created and activated only through Node skill tools.",
    "- Cite workspace sources in documents as [src:<path>#L<start>] or [src:<path>#L<start>-L<end>].",
    `- Delegate independent work to sub-agents with spawn_agent (several in parallel when independent) and collect results with wait_agent.${helper}`,
    "- Track multi-step work with your goal or plan tools.",
    `- Node tools are in the \`${NAMESPACE}\` namespace.`,
    search,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Portable packet only; another engine's opaque state is never claimed. */
export function renderHandoff(p: HandoffPacket): string {
  const cap = <T>(xs: T[]) => xs.slice(0, 50);
  return [
    `[Handoff from ${p.fromEngine} run ${p.fromRunId} at ${p.createdAt}]`,
    `Original task: ${p.originalPrompt.slice(0, 2000)}`,
    "Goals (claims, not verified):",
    ...cap(p.goals).map((g) => `- [${g.status}] ${g.title} (claimed by ${g.claimedBy})`),
    "Artifacts Node hashed at handoff:",
    ...cap(p.artifacts).map((a) => `- ${a.path} sha256:${a.sha256.slice(0, 12)} ${a.bytes}B`),
    "Checks Node ran:",
    ...cap(p.checks).map((c) => `- ${c.checkId} ${c.ok ? "passed" : "FAILED"}: ${c.summary.slice(0, 200)}`),
    `Prior engine's last summary: ${p.lastSummary.slice(0, 2000)}`,
    "Unresolved (Node cannot prove these completed):",
    ...cap(p.unresolved).map((u) => `- ${u}`),
    "Re-read files before relying on them; only the hashes and checks above are verified.",
  ].join("\n");
}

/** Codex reports shell commands as one shell-quoted string; Node policy wants argv. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function sha256File(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

function inputSchema(host: EngineHost, name: string): Record<string, unknown> {
  const { $schema: _drop, ...schema } = host.tools.jsonSchema(name);
  void _drop;
  return schema;
}

const LOCAL_META = {
  search_tools: {
    description: "Search the Node tool catalog by keywords. Returns names and descriptions of deferred tools; load them with load_tool.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false },
  },
  load_tool: {
    description: "Load Node tools by name so they can be invoked with call_tool. Returns their input schemas.",
    inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } }, required: ["names"], additionalProperties: false },
  },
} as const;

const CALL_TOOL = {
  description: "Invoke a Node tool that load_tool has loaded: {name, arguments}.",
  inputSchema: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object" } }, required: ["name", "arguments"], additionalProperties: false },
};

export interface CodexAdapterDeps {
  /** Sees every JSON-RPC message in both directions (qualification fixture capture). */
  onNative?: (msg: RpcMessage, dir: "in" | "out") => void;
}

export function createCodexAdapter(deps: CodexAdapterDeps = {}): EngineAdapter {
  const bin = resolveCodexBinary();
  const version = "version" in bin ? bin.version : "unknown";
  return {
    descriptor: () => ({
      id: "codex-app-server",
      label: "Codex (app-server)",
      sdk: { name: SDK_NAME, version },
      defaultModel: DEFAULT_MODEL,
      defaultHelperModel: DEFAULT_HELPER_MODEL,
      models: MODELS,
      capabilities: CAPABILITIES,
    }),
    async availability(env) {
      const missing: string[] = [];
      if ("error" in bin) missing.push(bin.error);
      if (!env.openaiApiKey) missing.push("OPENAI_API_KEY is not set");
      return { ok: missing.length === 0, missing };
    },
    start: (spec, host) => startRun(spec, host, deps),
  };
}

function startRun(spec: RunSpec, host: EngineHost, deps: CodexAdapterDeps): EngineRunHandle {
  const ws = resolve(spec.workspaceDir);
  const skillsRoot = join(ws, ".claude", "skills");
  const nodeTools = host.tools.list();
  let skills: Array<{ name: string; path: string }> = [];
  const tr = createTranslator({
    model: spec.model,
    familyOf: (name) => (name === "call_tool" ? "tool-meta" : host.tools.get(name)?.family ?? (Object.hasOwn(LOCAL_META, name) ? "tool-meta" : undefined)),
    skills: () => skills,
    hashFile: sha256File,
  });
  const fileChanges = new Map<string, Array<{ path: string }>>();
  const loaded = new Set<string>();
  let rpc: CodexRpc | undefined;
  let stopReason: string | undefined;
  let finished = false;
  let wake: () => void = () => {};
  const wakeup = new Promise<void>((r) => (wake = r));

  let delta = "";
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (delta) host.emit({ type: "message.delta", text: delta });
    delta = "";
  };
  const emit = (e: EngineEventDraft) => {
    if (finished) return;
    if (e.type === "message.delta") {
      delta += e.text;
      timer ??= setTimeout(flush, DELTA_MS);
      return;
    }
    flush();
    host.emit(e);
  };

  const interruptTurn = async () => {
    const threadId = tr.mainThreadId;
    const turnId = tr.mainTurnId;
    if (!rpc || !threadId || !turnId || tr.mainTurn) return wake();
    try {
      await withTimeout(rpc.request("turn/interrupt", { threadId, turnId }), RPC_TIMEOUT_MS, "turn/interrupt");
    } catch (err) {
      host.log(`codex turn/interrupt failed: ${errText(err)}`);
    }
    setTimeout(wake, INTERRUPT_GRACE_MS).unref(); // turn/completed(interrupted) normally wakes first
  };
  const stop = async (reason: string) => {
    if (stopReason || finished) return;
    stopReason = reason;
    await interruptTurn();
  };
  const onAbort = () => void stop(String(host.signal.reason ?? "aborted"));
  host.signal.addEventListener("abort", onAbort, { once: true });
  if (host.signal.aborted) onAbort();

  const checkBudget = () => {
    const u = tr.usage();
    if (spec.budget.maxUsd !== undefined && u.costUsd !== null && u.costUsd > spec.budget.maxUsd) void stop(`budget: cost $${u.costUsd} exceeded maxUsd $${spec.budget.maxUsd}`);
    if (spec.budget.maxTurns !== undefined && u.modelTurns > spec.budget.maxTurns) void stop(`budget: ${u.modelTurns} model requests exceeded maxTurns ${spec.budget.maxTurns}`);
  };

  async function refreshSkills(): Promise<void> {
    if (!rpc || finished) return;
    const r = await withTimeout(rpc.request("skills/list", { cwds: [ws], forceReload: true }), RPC_TIMEOUT_MS, "skills/list");
    const listed: Array<{ name: string; path: string; enabled: boolean }> = (r?.data ?? []).flatMap((d: { skills?: unknown[] }) => d.skills ?? []);
    const root = skillsRoot.toLowerCase();
    const inside = (p: string) => resolve(p).toLowerCase().startsWith(root);
    // Codex also discovers the OS user's ~/.agents skills and bundled system skills; only workspace skills may run.
    for (const s of listed) if (s.enabled && !inside(s.path)) await rpc.request("skills/config/write", { path: s.path, enabled: false });
    skills = listed.filter((s) => inside(s.path)).map((s) => ({ name: s.name, path: s.path }));
  }

  async function callNode(p: Record<string, any>, agentId: string | undefined): Promise<{ contentItems: Array<{ type: "inputText"; text: string }>; success: boolean }> {
    const reply = (text: string, success: boolean) => ({ contentItems: [{ type: "inputText" as const, text }], success });
    const name = String(p.tool);
    const args = (p.arguments ?? {}) as Record<string, any>;
    const callId = String(p.callId);
    if (name === "call_tool") {
      const target = String(args.name ?? "");
      const def = host.tools.get(target);
      if (!def) return reply(`Unknown Node tool "${target}". Use search_tools.`, false);
      if (def.alwaysLoad !== true && !loaded.has(target)) return reply(`Node tool "${target}" is not loaded. Call load_tool with ["${target}"] first.`, false);
      const out = await host.tools.call(target, args.arguments ?? {}, { agentId, callId });
      return reply(out.content, out.ok);
    }
    if (Object.hasOwn(LOCAL_META, name) && !host.tools.get(name)) {
      if (name === "search_tools") {
        const query = String(args.query ?? "");
        const found = host.tools.search(query, typeof args.limit === "number" ? args.limit : 8);
        emit({ type: "tool.search", callId, query, results: found.map((f) => f.name), via: "node", agentId });
        return reply(found.length ? found.map((f) => `${f.name} [${f.family}] — ${f.description}`).join("\n") : `No Node tools match "${query}".`, true);
      }
      const names = (Array.isArray(args.names) ? args.names : []).map(String).filter((n: string) => host.tools.get(n));
      if (!names.length) return reply("No such Node tools. Use search_tools.", false);
      for (const n of names) loaded.add(n);
      emit({ type: "tool.loaded", names, via: "node-load-tool", agentId });
      const schemas = names.map((n: string) => ({ name: n, description: host.tools.get(n)?.description, inputSchema: inputSchema(host, n) }));
      return reply(`${JSON.stringify(schemas)}\nCall these with call_tool {name, arguments}.`, true);
    }
    const out = await host.tools.call(name, args, { agentId, callId });
    if (name === "load_tool" && out.ok) for (const n of (out.data?.loaded as string[] | undefined) ?? []) loaded.add(n);
    return reply(out.content, out.ok);
  }

  async function onRequest(m: RpcMessage): Promise<unknown> {
    const p = (m.params ?? {}) as Record<string, any>;
    const agentId = tr.agentOf(p.threadId);
    const decide = (tool: string, nativeName: string, input: unknown) => {
      const d = host.policy.checkNativeTool(nativeName, input, { agentId });
      emit({ type: "permission.decision", tool, decision: d.allow ? "allow" : "deny", reason: d.reason, agentId });
      return d.allow;
    };
    switch (m.method) {
      case "item/commandExecution/requestApproval": {
        const command = typeof p.command === "string" ? splitCommand(p.command) : p.command;
        return { decision: decide("shell", "commandExecution", { command, cwd: p.cwd ?? ws }) ? "accept" : "decline" };
      }
      case "item/fileChange/requestApproval":
        return { decision: decide("apply_patch", "fileChange", { changes: fileChanges.get(String(p.itemId)) ?? [], grantRoot: p.grantRoot ?? undefined }) ? "accept" : "decline" };
      case "item/permissions/requestApproval":
        emit({ type: "permission.decision", tool: "request_permissions", decision: "deny", reason: "Node does not grant extra sandbox permissions", agentId });
        return { permissions: {}, scope: "turn" };
      case "item/tool/call":
        return callNode(p, agentId);
      case "item/tool/requestUserInput":
        return { answers: {} };
      case "mcpServer/elicitation/request":
        return { action: "decline", content: null, _meta: null };
      default:
        throw new Error(`NodeAgent does not handle ${m.method}`);
    }
  }

  function buildTools(nativeSearch: boolean): { specs: unknown[]; immediate: string[]; deferred: string[] } {
    const fn = (name: string, description: string, schema: unknown, deferLoading = false) => ({ type: "function", name, description, inputSchema: schema, ...(deferLoading ? { deferLoading } : {}) });
    const isDeferred = (t: NodeToolDefinition) => t.alwaysLoad !== true;
    const tools: unknown[] = [];
    const immediate: string[] = [];
    const deferred: string[] = [];
    for (const t of nodeTools) {
      // Native tool_search replaces the catalog's app-implemented search tools.
      if (nativeSearch && (t.name === "search_tools" || t.name === "load_tool")) continue;
      if (isDeferred(t)) {
        deferred.push(t.name);
        if (!nativeSearch) continue;
      } else immediate.push(t.name);
      tools.push(fn(t.name, t.description, inputSchema(host, t.name), nativeSearch && isDeferred(t)));
    }
    if (!nativeSearch && deferred.length) {
      for (const [name, m] of Object.entries(LOCAL_META)) {
        if (host.tools.get(name)) continue;
        tools.push(fn(name, m.description, m.inputSchema));
        immediate.push(name);
      }
      tools.push(fn("call_tool", CALL_TOOL.description, CALL_TOOL.inputSchema));
      immediate.push("call_tool");
    }
    const specs = tools.length ? [{ type: "namespace", name: NAMESPACE, description: "NodeAgent workspace tools (executed by Node).", tools }] : [];
    return { specs, immediate: immediate.map((n) => `${NAMESPACE}.${n}`), deferred: deferred.map((n) => `${NAMESPACE}.${n}`) };
  }

  async function run(): Promise<EngineRunOutcome> {
    const bin = resolveCodexBinary();
    if ("error" in bin) throw new Error(bin.error);
    if (!host.env.openaiApiKey) throw new Error("OPENAI_API_KEY is not set");
    const home = join(host.stateDir, "codex-home");
    mkdirSync(home, { recursive: true });
    const configPath = join(home, "config.toml");
    const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    if (!config.includes(EPHEMERAL_AUTH)) writeFileSync(configPath, `${EPHEMERAL_AUTH}\n${config}`);

    rpc = new CodexRpc(bin.path, ["app-server"], cleanChildEnv({ CODEX_HOME: home }), ws);
    rpc.onMessage = deps.onNative;
    rpc.onNotification = (m) => {
      const item = m.params?.item;
      if (m.method === "item/started" && item?.type === "fileChange")
        remember(fileChanges, String(item.id), (Array.isArray(item.changes) ? item.changes : []).map((c: { path?: string }) => ({ path: String(c?.path ?? "") })));
      for (const e of tr.handle(m)) emit(e);
      if (m.method === "rawResponse/completed") checkBudget();
      if (tr.mainTurn) wake();
    };
    rpc.onRequest = onRequest;
    void rpc.exited.then(() => wake()); // wake reasons: main turn completed, stop, or process exit

    const req = <T = any>(method: string, params: unknown) => withTimeout(rpc!.request<T>(method, params), RPC_TIMEOUT_MS, method);
    await req("initialize", { clientInfo: { name: "nodeagent", title: "NodeAgent", version: bin.version }, capabilities: { experimentalApi: true } });
    rpc.notify("initialized");
    await req("account/login/start", { type: "apiKey", apiKey: host.env.openaiApiKey });
    await req("skills/extraRoots/set", { extraRoots: [skillsRoot] });
    await refreshSkills();
    host.tools.setSkillRefresher(refreshSkills);

    // Codex only offers tool_search to models whose catalog metadata it has; others get fallback metadata.
    let nativeSearch = false;
    try {
      const models = await req<{ data?: Array<{ model?: string; id?: string }> }>("model/list", { includeHidden: true });
      nativeSearch = (models.data ?? []).some((x) => x.model === spec.model || x.id === spec.model);
    } catch (err) {
      host.log(`codex model/list failed, using app-implemented tool search: ${errText(err)}`);
    }
    const tools = buildTools(nativeSearch);
    const common = {
      cwd: ws,
      model: spec.model,
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      developerInstructions: rules(spec, nativeSearch, tools.deferred.length > 0),
      config: {
        web_search: "disabled",
        ...(spec.context.autoCompactTokens ? { model_auto_compact_token_limit: spec.context.autoCompactTokens } : {}),
      },
    };
    if (stopReason) throw new Error(stopReason);
    const started = spec.resume
      ? await req("thread/resume", { threadId: spec.resume.nativeSessionId, ...common, excludeTurns: true })
      : await req("thread/start", { ...common, dynamicTools: tools.specs, experimentalRawEvents: true });
    const threadId = String(started.thread.id);
    tr.setMainThread(threadId);
    emit({
      type: "run.started",
      engine: "codex-app-server",
      model: String(started.model ?? spec.model),
      sdkVersion: bin.version,
      nativeSessionId: threadId,
      cwd: ws,
      tools: tools.immediate,
      deferredTools: tools.deferred,
      skills: skills.map((s) => s.name),
    });
    if (stopReason) throw new Error(stopReason);

    const text = spec.handoff ? `${renderHandoff(spec.handoff)}\n\n---\n\n${spec.prompt}` : spec.prompt;
    const turn = await req("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }] });
    tr.setMainTurn(String(turn.turn.id));
    if (stopReason) await interruptTurn(); // interrupt raced turn/start

    await wakeup;
    const outcome = tr.mainTurn;
    const base = { finalText: tr.finalText, nativeSessionId: threadId, usage: tr.usage() };
    if (stopReason) return { ...base, status: "interrupted", error: stopReason };
    if (!outcome) return { ...base, status: "failed", error: tr.lastError ?? `codex app-server ended before the turn completed. ${rpc.stderrTail()}` };
    if (outcome.status === "completed") return { ...base, status: "completed" };
    if (outcome.status === "interrupted") return { ...base, status: "interrupted", error: "codex turn interrupted" };
    return { ...base, status: "failed", error: outcome.error ?? "codex turn failed" };
  }

  const done = run()
    .catch((err): EngineRunOutcome => ({
      status: stopReason ? "interrupted" : "failed",
      finalText: tr.finalText,
      nativeSessionId: tr.mainThreadId,
      usage: tr.usage(),
      error: stopReason ?? preview(errText(err), 2000),
    }))
    .then((outcome) => {
      flush();
      for (const e of tr.stopUnfinishedHelpers(outcome.status === "interrupted" ? "stopped with the run" : "run ended before the helper finished")) emit(e);
      emit({ type: "usage", totals: outcome.usage });
      finished = true;
      host.signal.removeEventListener("abort", onAbort);
      rpc?.close();
      return outcome;
    });

  return {
    done,
    interrupt: (reason) => stop(reason),
    async send(text) {
      const threadId = tr.mainThreadId;
      const turnId = tr.mainTurnId;
      if (!rpc || !threadId || !turnId || tr.mainTurn) throw new Error("codex run has no active turn to steer");
      await withTimeout(rpc.request("turn/steer", { threadId, expectedTurnId: turnId, input: [{ type: "text", text, text_elements: [] }] }), RPC_TIMEOUT_MS, "turn/steer");
    },
  };
}
