/**
 * Claude Agent SDK adapter. One streaming-input query() per run, so interrupt(),
 * reloadSkills() and send() work mid-run. Node tools are an in-process MCP server
 * ("node"); tools without alwaysLoad are deferred behind native ToolSearch.
 * Native tools pass host.policy twice: PreToolUse hook and canUseTool.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, query as sdkQuery, tool } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentDefinition,
  CanUseTool,
  HookCallback,
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { emptyUsage, preview } from "../contract.js";
import type {
  Capability,
  CapabilityEntry,
  EngineAdapter,
  EngineDescriptor,
  EngineEventDraft,
  EngineHost,
  EngineRunHandle,
  EngineRunOutcome,
  GoalItem,
  HandoffPacket,
  RunSpec,
  UsageTotals,
} from "../contract.js";
import { cleanChildEnv } from "../env.js";
import { priceUsage } from "../pricing.js";

const SDK_NAME = "@anthropic-ai/claude-agent-sdk";
/** Capability statuses below were observed on this version (qualification/claude.json). */
const QUALIFIED_SDK_VERSION = "0.3.312";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_HELPER_MODEL = "claude-haiku-5-5";
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const NODE_PREFIX = "mcp__node__";
const NATIVE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "NotebookEdit", "TodoWrite", "Agent", "Skill", "ToolSearch"];
const RAW_CAP = 4000;
const MAX_TRACKED = 2000;
const DELTA_MS = 100;
const CONTEXT_POLL_MS = 15_000;
/** After the last helper finishes while idle, wait this long for the CLI to start the follow-up turn. */
const HELPER_SETTLE_MS = 4_000;
const INTERRUPT_GRACE_MS = 5_000;

const NODE_RULES = [
  "You are running inside a Node-managed workspace (the current working directory).",
  "- Stay inside the workspace; never read or write outside it.",
  "- Cite workspace sources in documents as [src:<workspace-relative path>#L<start>] or [src:<path>#L<start>-L<end>].",
  "- Delegate independent work to the `helper` agent (several in parallel when the pieces are independent); use `reviewer` for read-only verification.",
  "- Background helper results arrive automatically as task notifications; do not Read task output files (they are outside the workspace).",
  "- Keep a TodoWrite plan current for multi-step work.",
  "- Node tools (mcp__node__*) may be deferred: use ToolSearch to find and load them.",
  "- Never write under .claude/ yourself. Draft skills with mcp__node__draft_skill and activate them only with mcp__node__activate_skill.",
].join("\n");

const CAPABILITIES: Record<Capability, CapabilityEntry> = {
  start: { status: "NATIVE", note: "query() with streaming input; run.started from system/init" },
  stream: { status: "NATIVE", note: "includePartialMessages text_delta -> message.delta (main agent, ~100ms coalesced)" },
  interrupt: { status: "NATIVE", note: "Query.interrupt() then end of input; done resolves interrupted" },
  resume: { status: "NATIVE", note: "Options.resume with the native session id (sessions under CLAUDE_CONFIG_DIR in stateDir)" },
  subagents: { status: "NATIVE", note: "Agent tool with programmatic agents (helper background, reviewer read-only); task_* system messages" },
  childEventIdentity: { status: "NATIVE", note: "agent_id/parent_tool_use_id on child messages = task_id from task_started" },
  compaction: { status: "NATIVE", note: "CLAUDE_CODE_AUTO_COMPACT_WINDOW env (CLI floor 100000, threshold 67000); system/compact_boundary -> context.compacted" },
  toolSearch: { status: "NATIVE", note: "ENABLE_TOOL_SEARCH=true defers non-alwaysLoad MCP tools; ToolSearch tool_reference results" },
  skillLoad: { status: "NATIVE", note: "Skill tool over <cwd>/.claude/skills via settingSources project" },
  skillRefresh: { status: "NATIVE", note: "Query.reloadSkills() registered as the gateway skill refresher" },
  goals: { status: "NATIVE", note: "TodoWrite (CLAUDE_CODE_ENABLE_TASKS=false) input -> goals.updated (claimedBy engine)" },
  permissions: { status: "NATIVE", note: "PreToolUse hook + canUseTool run host.policy.checkNativeTool; deny returned to the model" },
  usage: { status: "NATIVE", note: "result.modelUsage (main, subagents, compaction)" },
  costUsd: { status: "NATIVE", note: "result.total_cost_usd (CLI list-price estimate); price table when costBasis is unknown; null when modelUsage is empty" },
};

type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

export interface ClaudeAdapterDeps {
  /** Replaces the SDK query(); used by deterministic tests. */
  query?: QueryFn;
  /** Sees every native message before translation (qualification fixture capture). */
  onNative?: (msg: SDKMessage) => void;
}

/** The binary packages have no entry point and the SDK does not export ./package.json, so try both. */
function installedVersion(pkg: string): string | undefined {
  for (const specifier of [`${pkg}/package.json`, pkg]) {
    try {
      let dir = dirname(fileURLToPath(import.meta.resolve(specifier)));
      for (let i = 0; i < 4; i++, dir = dirname(dir)) {
        const file = join(dir, "package.json");
        if (!existsSync(file)) continue;
        const json = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
        if (json.name === pkg) return json.version;
      }
    } catch {
      /* try the next specifier */
    }
  }
  return undefined;
}

function nativeBinaryInstalled(): boolean {
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  return [base, `${base}-musl`].some((p) => installedVersion(p) !== undefined);
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TRACKED): void {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

function strip(name: string): string {
  return name.startsWith(NODE_PREFIX) ? name.slice(NODE_PREFIX.length) : name;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return preview(content);
  return content
    .map((b: { type?: string; text?: string; tool_name?: string }) =>
      b?.type === "text" ? b.text ?? "" : b?.type === "tool_reference" ? `tool_reference:${b.tool_name}` : `[${b?.type}]`,
    )
    .join("\n");
}

function toolReferences(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: { type?: string; tool_name?: unknown }) => b?.type === "tool_reference" && typeof b.tool_name === "string")
    .map((b: { tool_name: string }) => strip(b.tool_name));
}

function todoGoals(input: unknown): GoalItem[] | undefined {
  const todos = (input as { todos?: unknown })?.todos;
  if (!Array.isArray(todos)) return undefined;
  const status = { pending: "pending", in_progress: "active", completed: "done" } as const;
  return todos.slice(0, 200).map((t: { content?: unknown; status?: string }, i) => ({
    id: `todo-${i + 1}`,
    title: String(t?.content ?? ""),
    status: status[t?.status as keyof typeof status] ?? "pending",
    claimedBy: "engine",
  }));
}

/** Portable packet only; another engine's opaque state is never claimed. */
export function renderHandoff(p: HandoffPacket): string {
  const cap = <T>(xs: T[]) => xs.slice(0, 50);
  const lines = [
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
  ];
  return lines.join("\n");
}

/**
 * Claude Code walks up from cwd loading CLAUDE.md files, so a workspace under
 * $HOME inherits ~/.claude/CLAUDE.md as "Project" memory (observed on 0.3.312).
 * Exclude every ancestor's memory files; the workspace's own still load.
 */
export function ancestorMemoryExcludes(workspaceDir: string): string[] {
  const out: string[] = [];
  for (let d = dirname(resolve(workspaceDir)); ; d = dirname(d)) {
    for (const f of ["CLAUDE.md", "CLAUDE.local.md", join(".claude", "CLAUDE.md"), join(".claude", "rules", "**")])
      out.push(join(d, f).split(sep).join("/"));
    if (dirname(d) === d) return out;
  }
}

function userMessage(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

/** Open prompt stream: stays open until the adapter decides the run is done. */
function inputQueue() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(m: SDKUserMessage) {
      items.push(m);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    get closed() {
      return closed;
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = undefined;
      }
    },
  };
}

export function createClaudeAdapter(deps: ClaudeAdapterDeps = {}): EngineAdapter {
  const version = installedVersion(SDK_NAME) ?? "unknown";
  const runQuery: QueryFn = deps.query ?? ((p) => sdkQuery(p));

  function descriptor(): EngineDescriptor {
    const qualified = version === QUALIFIED_SDK_VERSION;
    const capabilities = Object.fromEntries(
      Object.entries(CAPABILITIES).map(([k, v]) => [
        k,
        qualified || v.status === "UNSUPPORTED" ? v : { status: "UNTESTED", note: `${v.note} (qualified on ${QUALIFIED_SDK_VERSION}, installed ${version})` },
      ]),
    ) as Record<Capability, CapabilityEntry>;
    return {
      id: "claude-agent-sdk",
      label: "Claude Agent SDK",
      sdk: { name: SDK_NAME, version },
      defaultModel: DEFAULT_MODEL,
      defaultHelperModel: DEFAULT_HELPER_MODEL,
      models: MODELS,
      capabilities,
    };
  }

  return {
    descriptor,
    async availability(env) {
      const missing: string[] = [];
      if (!env.anthropicApiKey) missing.push("ANTHROPIC_API_KEY is not set");
      if (version === "unknown") missing.push(`${SDK_NAME} is not installed`);
      else if (!nativeBinaryInstalled())
        missing.push(`Claude Code native binary for ${process.platform}-${process.arch} is not installed (${SDK_NAME}-${process.platform}-${process.arch})`);
      return { ok: missing.length === 0, missing };
    },
    start(spec, host) {
      return startRun(spec, host, version, runQuery, deps.onNative);
    },
  };
}

function startRun(spec: RunSpec, host: EngineHost, version: string, runQuery: QueryFn, onNative?: (m: SDKMessage) => void): EngineRunHandle {
  const helperModel = spec.helperModel ?? DEFAULT_HELPER_MODEL;
  const emit = (e: EngineEventDraft) => {
    if (!finished) host.emit(e);
  };
  const raw = (nativeType: string, payload: unknown, agentId?: string) =>
    emit({ type: "engine.raw", nativeType, payload: preview(payload, RAW_CAP), agentId });

  let finished = false;
  let started = false;
  let sessionId = spec.resume?.nativeSessionId;
  let interrupted: string | undefined;
  let thrown: string | undefined;
  let assistantError: string | undefined;
  let lastResult: SDKResultMessage | undefined;
  let lastMainText = "";
  let usage: UsageTotals = emptyUsage();
  let modelTurns = 0;
  let idle = false;
  let stderrTail = "";
  let deltaBuf = "";
  let deltaTimer: NodeJS.Timeout | undefined;
  let settleTimer: NodeJS.Timeout | undefined;
  let hardStop: NodeJS.Timeout | undefined;
  let contextBusy = false;

  const calls = new Map<string, { name: string; t0: number; agentId?: string; input: Record<string, unknown> }>();
  const helperByToolUse = new Map<string, string>();
  const helperTasks = new Set<string>();
  const runningHelpers = new Set<string>();
  const lastMessageIdByAgent = new Map<string, string>();
  /** PreToolUse sees tool_use_id + agent_id before the MCP handler runs; the handler claims it here. */
  const pendingNode = new Map<string, Array<{ toolUseId: string; agentId?: string }>>();

  const nodeTools = host.tools.list();
  const deferred = nodeTools.filter((t) => t.alwaysLoad !== true).map((t) => t.name);
  const nodeToolNames = nodeTools.map((t) => `${NODE_PREFIX}${t.name}`);
  const readOnlyNodeTools = nodeTools.filter((t) => t.risk === "read").map((t) => `${NODE_PREFIX}${t.name}`);

  const agents: Record<string, AgentDefinition> = {
    helper: {
      description: "General worker for one independent piece of the task (reading, counting, drafting, editing workspace files). Runs in the background.",
      prompt: `You are a helper working on one piece of a larger task.\n${NODE_RULES}\nReport concrete results with file paths.`,
      model: helperModel,
      background: true,
      tools: ["Read", "Glob", "Grep", "Write", "Edit", "ToolSearch", ...nodeToolNames],
    },
    reviewer: {
      description: "Read-only verifier: checks claims and files against the workspace and reports discrepancies. Never edits.",
      prompt: `You are a read-only reviewer.\n${NODE_RULES}\nVerify; do not modify files.`,
      model: helperModel,
      tools: ["Read", "Glob", "Grep", "ToolSearch", ...readOnlyNodeTools],
    },
  };

  const sdkTools = [];
  for (const t of nodeTools) {
    if (!(t.schema instanceof z.ZodObject)) {
      host.log(`claude: Node tool ${t.name} skipped, its schema is not a z.object`);
      continue;
    }
    sdkTools.push(
      tool(
        t.name,
        t.description,
        t.schema.shape,
        async (args) => {
          const queue = pendingNode.get(t.name);
          const claim = queue?.shift();
          const out = await host.tools.call(t.name, args, { agentId: claim?.agentId, callId: claim?.toolUseId });
          return { content: [{ type: "text" as const, text: out.content }], isError: !out.ok };
        },
        { searchHint: t.searchHint, alwaysLoad: t.alwaysLoad === true },
      ),
    );
  }

  const check = (name: string, input: unknown, agentId?: string) => {
    try {
      return host.policy.checkNativeTool(name, input, { agentId });
    } catch (err) {
      return { allow: false, reason: `policy error: ${errText(err)}` };
    }
  };

  const preToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (input.tool_name.startsWith(NODE_PREFIX)) {
      const name = strip(input.tool_name);
      const queue = pendingNode.get(name) ?? [];
      queue.push({ toolUseId: input.tool_use_id, agentId: input.agent_id });
      if (queue.length > 100) queue.shift();
      pendingNode.set(name, queue);
      return {};
    }
    const d = check(input.tool_name, input.tool_input, input.agent_id);
    if (d.allow) return {};
    emit({ type: "permission.decision", tool: input.tool_name, decision: "deny", reason: d.reason, agentId: input.agent_id });
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason } };
  };

  // Always answers; a null here would park the tool forever.
  const canUseTool: CanUseTool = async (name, toolInput, opts) => {
    if (name.startsWith(NODE_PREFIX)) return { behavior: "allow", updatedInput: toolInput };
    const d = check(name, toolInput, opts.agentID);
    emit({ type: "permission.decision", tool: name, decision: d.allow ? "allow" : "deny", reason: d.reason, agentId: opts.agentID });
    return d.allow ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: d.reason };
  };

  const tmpDir = join(host.stateDir, "claude-tmp");
  mkdirSync(tmpDir, { recursive: true });

  const input = inputQueue();
  input.push(userMessage(spec.handoff ? `${renderHandoff(spec.handoff)}\n\n---\n\n${spec.prompt}` : spec.prompt));

  const options: Options = {
    cwd: spec.workspaceDir,
    model: spec.model || DEFAULT_MODEL,
    env: cleanChildEnv({
      ANTHROPIC_API_KEY: host.env.anthropicApiKey,
      ANTHROPIC_BASE_URL: host.env.anthropicBaseUrl,
      CLAUDE_CONFIG_DIR: join(host.stateDir, "claude-config"),
      // Engine scratch (background task output files) stays in Node's state dir, not the user's %TEMP%\claude.
      CLAUDE_CODE_TMPDIR: tmpDir,
      // This CLI defaults to TaskCreate/TaskUpdate and drops TodoWrite; TodoWrite carries the whole plan per call.
      CLAUDE_CODE_ENABLE_TASKS: "false",
      ENABLE_TOOL_SEARCH: "true",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: spec.context.autoCompactTokens ? String(spec.context.autoCompactTokens) : undefined,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    }),
    settingSources: ["project"],
    settings: { claudeMdExcludes: ancestorMemoryExcludes(spec.workspaceDir) },
    tools: NATIVE_TOOLS,
    skills: "all",
    mcpServers: { node: createSdkMcpServer({ name: "node", version: "0.1.0", tools: sdkTools }) },
    agents,
    systemPrompt: { type: "preset", preset: "claude_code", append: NODE_RULES },
    permissionMode: "default",
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    includePartialMessages: true,
    persistSession: true,
    resume: spec.resume?.nativeSessionId,
    maxBudgetUsd: spec.budget.maxUsd,
    maxTurns: spec.budget.maxTurns,
    stderr: (d) => {
      stderrTail = (stderrTail + d).slice(-2000);
    },
  };

  const q = runQuery({ prompt: input, options });
  host.tools.setSkillRefresher(async () => {
    await q.reloadSkills();
  });

  const flushDelta = () => {
    if (deltaTimer) clearTimeout(deltaTimer);
    deltaTimer = undefined;
    if (deltaBuf) emit({ type: "message.delta", text: deltaBuf });
    deltaBuf = "";
  };

  const pollContext = async () => {
    if (contextBusy || finished || !started) return;
    contextBusy = true;
    try {
      const c = await q.getContextUsage({ detail: "summary" });
      emit({ type: "context.usage", usedTokens: c.totalTokens, windowTokens: c.maxTokens, estimated: false });
    } catch (err) {
      host.log(`claude: getContextUsage failed: ${errText(err)}`);
    } finally {
      contextBusy = false;
    }
  };
  const contextTimer = setInterval(() => void pollContext(), CONTEXT_POLL_MS);
  contextTimer.unref?.();

  const maybeFinish = () => {
    if (!idle || input.closed || runningHelpers.size > 0) return;
    if ((lastResult?.queued_turn_count ?? 0) > 0) return;
    input.close();
  };

  const busy = () => {
    idle = false;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const agentOf = (m: { agent_id?: string; parent_tool_use_id: string | null }): string | undefined =>
    m.agent_id ?? (m.parent_tool_use_id ? helperByToolUse.get(m.parent_tool_use_id) ?? m.parent_tool_use_id : undefined);

  const skillHash = (name: string): string | undefined => {
    if (!/^[\w.-]+$/.test(name) || name.includes("..")) return undefined;
    const file = join(spec.workspaceDir, ".claude", "skills", name, "SKILL.md");
    return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : undefined;
  };

  const usageFrom = (r: SDKResultMessage): UsageTotals => {
    const models = Object.entries(r.modelUsage ?? {});
    const t = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    for (const [, u] of models) {
      t.inputTokens += u.inputTokens;
      t.outputTokens += u.outputTokens;
      t.cacheReadTokens += u.cacheReadInputTokens;
      t.cacheWriteTokens += u.cacheCreationInputTokens;
    }
    // An interrupted turn reports total_cost_usd 0 with empty modelUsage after tokens were spent (observed): unknown, not 0.
    if (!models.length) return { ...t, costUsd: null, costSource: "unknown", modelTurns };
    // costBasis "unknown" means the CLI guessed at another model's rate: not an engine-known cost.
    if (typeof r.total_cost_usd === "number" && models.every(([, u]) => u.costBasis !== "unknown"))
      return { ...t, costUsd: r.total_cost_usd, costSource: "engine", modelTurns };
    let sum = 0;
    for (const [model, u] of models) {
      const p = priceUsage(model, {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadInputTokens,
        cacheWriteTokens: u.cacheCreationInputTokens,
      });
      if (p.costUsd === null) return { ...t, costUsd: null, costSource: "unknown", modelTurns };
      sum += p.costUsd;
    }
    return { ...t, costUsd: models.length ? sum : null, costSource: models.length ? "price-table" : "unknown", modelTurns };
  };

  const onToolUse = (id: string, name: string, toolInput: Record<string, unknown>, agentId?: string) => {
    const isNode = name.startsWith(NODE_PREFIX);
    const shown = strip(name);
    remember(calls, id, { name, t0: Date.now(), agentId, input: toolInput });
    emit({
      type: "tool.call",
      callId: id,
      name: shown,
      family: isNode ? host.tools.get(shown)?.family ?? "native" : "native",
      inputPreview: preview(toolInput),
      native: !isNode,
      agentId,
    });
    if (name === "TodoWrite") {
      const goals = todoGoals(toolInput);
      if (goals) emit({ type: "goals.updated", goals, source: "claude:TodoWrite", agentId });
    }
  };

  const onToolResult = (block: { tool_use_id: string; content?: unknown; is_error?: boolean }, agentId?: string) => {
    const call = calls.get(block.tool_use_id);
    calls.delete(block.tool_use_id);
    const ok = block.is_error !== true;
    const scope = agentId ?? call?.agentId;
    emit({
      type: "tool.result",
      callId: block.tool_use_id,
      ok,
      preview: preview(blocksText(block.content)),
      ms: call ? Date.now() - call.t0 : undefined,
      agentId: scope,
    });
    if (!call) return;
    if (call.name === "ToolSearch") {
      const names = toolReferences(block.content);
      emit({ type: "tool.search", callId: block.tool_use_id, query: String(call.input.query ?? ""), results: names, via: "native", agentId: scope });
      if (names.length) emit({ type: "tool.loaded", names, via: "native-tool-search", agentId: scope });
    } else if (call.name === "Skill" && ok) {
      const name = String(call.input.skill ?? call.input.name ?? "");
      if (name) emit({ type: "skill.loaded", name, sha256: skillHash(name), via: "native", agentId: scope });
    }
  };

  const translate = (msg: SDKMessage) => {
    switch (msg.type) {
      case "system":
        switch (msg.subtype) {
          case "init":
            sessionId = msg.session_id;
            if (started) return raw("system/init", msg);
            started = true;
            emit({
              type: "run.started",
              engine: "claude-agent-sdk",
              model: msg.model,
              sdkVersion: version,
              nativeSessionId: msg.session_id,
              cwd: msg.cwd,
              tools: msg.tools.filter((n) => !deferred.includes(strip(n)) || !n.startsWith(NODE_PREFIX)).map(strip),
              deferredTools: deferred,
              skills: msg.skills,
              helpers: msg.agents,
            });
            void pollContext();
            return;
          case "status":
            if (msg.status) busy();
            return emit({
              type: "run.status",
              status: msg.status ?? "running",
              detail: msg.compact_result ? `compaction ${msg.compact_result}${msg.compact_error ? `: ${msg.compact_error}` : ""}` : undefined,
            });
          case "compact_boundary":
            return emit({
              type: "context.compacted",
              trigger: msg.compact_metadata.trigger,
              preTokens: msg.compact_metadata.pre_tokens,
              postTokens: msg.compact_metadata.post_tokens,
              durationMs: msg.compact_metadata.duration_ms,
              nativeRef: msg.uuid,
            });
          case "api_retry":
            return emit({
              type: "run.status",
              status: "requesting",
              detail: `API retry ${msg.attempt}/${msg.max_retries}: ${msg.error}${msg.error_status ? ` (HTTP ${msg.error_status})` : ""}`,
            });
          case "task_started": {
            const isHelper = msg.task_type ? msg.task_type === "local_agent" : !!msg.subagent_type;
            if (!isHelper) return raw("system/task_started", msg);
            helperTasks.add(msg.task_id);
            runningHelpers.add(msg.task_id);
            if (helperTasks.size > MAX_TRACKED) helperTasks.delete(helperTasks.values().next().value as string);
            if (msg.tool_use_id) remember(helperByToolUse, msg.tool_use_id, msg.task_id);
            const spawn = msg.tool_use_id ? calls.get(msg.tool_use_id) : undefined;
            const model = (spawn?.input.model as string | undefined) ?? agents[msg.subagent_type ?? ""]?.model;
            return emit({
              type: "helper.started",
              helperId: msg.task_id,
              parentId: msg.parent_task_id,
              description: msg.description,
              subagentType: msg.subagent_type,
              model,
              background: msg.is_backgrounded,
            });
          }
          case "task_progress":
            if (!helperTasks.has(msg.task_id)) return raw("system/task_progress", msg);
            return emit({
              type: "helper.progress",
              helperId: msg.task_id,
              summary: msg.summary,
              lastTool: msg.last_tool_name ? strip(msg.last_tool_name) : undefined,
              totalTokens: msg.usage.total_tokens,
              toolUses: msg.usage.tool_uses,
              durationMs: msg.usage.duration_ms,
            });
          case "task_notification":
            if (!helperTasks.has(msg.task_id)) return raw("system/task_notification", msg);
            runningHelpers.delete(msg.task_id);
            emit({
              type: "helper.completed",
              helperId: msg.task_id,
              status: msg.status,
              summary: msg.summary,
              totalTokens: msg.usage?.total_tokens,
              toolUses: msg.usage?.tool_uses,
              durationMs: msg.usage?.duration_ms,
            });
            if (idle && runningHelpers.size === 0) {
              if (settleTimer) clearTimeout(settleTimer);
              settleTimer = setTimeout(maybeFinish, HELPER_SETTLE_MS);
            }
            return;
          case "thinking_tokens":
            return; // spinner estimate; real usage arrives on result
          default:
            return raw(`system/${msg.subtype}`, msg);
        }
      case "assistant": {
        const agentId = agentOf(msg);
        if (!agentId) busy();
        const key = agentId ?? "main";
        if (lastMessageIdByAgent.get(key) !== msg.message.id) {
          remember(lastMessageIdByAgent, key, msg.message.id);
          modelTurns++;
        }
        if (msg.error) {
          assistantError = `${msg.error}: ${blocksText(msg.message.content).slice(0, 500)}`;
          return raw("assistant/error", msg, agentId);
        }
        for (const block of msg.message.content) {
          if (block.type === "text") {
            if (!agentId) {
              flushDelta();
              lastMainText = block.text;
            }
            if (block.text.trim()) emit({ type: "message", role: "assistant", text: block.text, agentId });
          } else if (block.type === "tool_use") {
            onToolUse(block.id, block.name, (block.input ?? {}) as Record<string, unknown>, agentId);
          } else {
            raw(`assistant/${block.type}`, block, agentId);
          }
        }
        return;
      }
      case "user": {
        const agentId = agentOf(msg);
        const content = msg.message.content;
        if (typeof content === "string") return raw("user/text", content, agentId);
        for (const block of content) {
          if (block.type === "tool_result") onToolResult(block, agentId);
          else raw(`user/${block.type}`, block, agentId);
        }
        return;
      }
      case "stream_event": {
        // Only main-agent text deltas are projected; the assembled assistant message carries the rest.
        if (msg.parent_tool_use_id) return;
        busy();
        const ev = msg.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          deltaBuf += ev.delta.text;
          if (!deltaTimer) deltaTimer = setTimeout(flushDelta, DELTA_MS);
        }
        return;
      }
      case "result":
        flushDelta();
        lastResult = msg;
        if (msg.subtype === "success") lastMainText = msg.result || lastMainText;
        usage = usageFrom(msg);
        emit({ type: "usage", totals: usage });
        void pollContext();
        idle = true;
        return maybeFinish();
      case "tool_progress":
        return; // elapsed-time heartbeat; tool.call/tool.result bracket the call
      default:
        return raw(msg.type, msg);
    }
  };

  const interrupt = async (reason: string) => {
    if (interrupted || finished) return;
    interrupted = reason;
    hardStop = setTimeout(() => q.close(), INTERRUPT_GRACE_MS * 2);
    hardStop.unref?.();
    try {
      await Promise.race([q.interrupt(), new Promise((r) => setTimeout(r, INTERRUPT_GRACE_MS).unref?.())]);
    } catch (err) {
      host.log(`claude: interrupt failed: ${errText(err)}`);
    }
    input.close();
  };

  const onAbort = () => void interrupt(host.signal.reason ? `aborted: ${errText(host.signal.reason)}` : "aborted by host");
  host.signal.addEventListener("abort", onAbort, { once: true });
  if (host.signal.aborted) onAbort();

  const done = (async (): Promise<EngineRunOutcome> => {
    try {
      for await (const msg of q) {
        onNative?.(msg);
        try {
          translate(msg);
        } catch (err) {
          host.log(`claude: could not translate ${msg.type}: ${errText(err)}`);
          raw(`untranslatable/${msg.type}`, msg);
        }
      }
    } catch (err) {
      if (!interrupted) thrown = errText(err);
    } finally {
      flushDelta();
      finished = true;
      clearInterval(contextTimer);
      if (settleTimer) clearTimeout(settleTimer);
      if (hardStop) clearTimeout(hardStop);
      host.signal.removeEventListener("abort", onAbort);
      input.close();
    }
    usage = { ...usage, modelTurns };
    const base = { finalText: lastMainText, nativeSessionId: sessionId, usage };
    if (interrupted) return { ...base, status: "interrupted", error: interrupted };
    if (thrown) return { ...base, status: "failed", error: `${thrown}${stderrTail ? ` | stderr: ${stderrTail.slice(-500)}` : ""}` };
    if (lastResult?.subtype === "success" && !lastResult.is_error) return { ...base, status: "completed" };
    const error = lastResult
      ? `${lastResult.subtype}${lastResult.subtype !== "success" && lastResult.errors.length ? `: ${lastResult.errors.join("; ")}` : ""}${assistantError ? ` (${assistantError})` : ""}`
      : `Claude Code ended without a result${assistantError ? `: ${assistantError}` : ""}${stderrTail ? ` | stderr: ${stderrTail.slice(-500)}` : ""}`;
    return { ...base, status: "failed", error };
  })();

  return {
    done,
    interrupt,
    async send(text: string) {
      if (finished || input.closed) throw new Error("run is no longer accepting input");
      input.push(userMessage(text));
    },
  };
}
