/**
 * Claude adapter: native message -> contract event mapping, replayed from a
 * fixture recorded during real qualification (scripts/qualify-claude.ts).
 * No network: query() is replaced by a scripted fake.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { HookCallback, Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ancestorMemoryExcludes, createClaudeAdapter, renderHandoff } from "../src/engines/claude.js";
import type { EngineEventDraft, HandoffPacket, NodeToolDefinition, PolicyGate, RunSpec } from "../src/contract.js";
import { createFakeHost } from "../src/testing/fakeHost.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: SDKMessage[] = readFileSync(join(here, "fixtures", "claude-native.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));

type Ev<T extends EngineEventDraft["type"]> = Extract<EngineEventDraft, { type: T }>;
const of = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], type: T) => events.filter((e): e is Ev<T> => e.type === type);

interface Script {
  /** Messages to yield; a function receives the controls so it can wait for interrupt(). */
  messages: SDKMessage[] | ((ctl: Controls) => AsyncGenerator<SDKMessage>);
}
interface Controls {
  interrupted: Promise<void>;
  closed: Promise<void>;
}
interface Captured {
  options?: Options;
  prompts: SDKUserMessage[];
  interruptCalls: number;
  reloadCalls: number;
  closeCalls: number;
}

function fakeQuery(script: Script, cap: Captured) {
  return ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query => {
    cap.options = options;
    let onInterrupt!: () => void;
    let onClose!: () => void;
    const ctl: Controls = { interrupted: new Promise((r) => (onInterrupt = r)), closed: new Promise((r) => (onClose = r)) };
    void (async () => {
      for await (const m of prompt) cap.prompts.push(m);
      onClose();
    })();
    const gen = typeof script.messages === "function" ? script.messages(ctl) : (async function* (ms: SDKMessage[]) { yield* ms; })(script.messages);
    return Object.assign(gen, {
      async interrupt() {
        cap.interruptCalls++;
        onInterrupt();
      },
      async reloadSkills() {
        cap.reloadCalls++;
        return {};
      },
      async getContextUsage() {
        return { totalTokens: 1234, maxTokens: 100000 };
      },
      close() {
        cap.closeCalls++;
        onClose();
      },
    }) as unknown as Query;
  };
}

function setup(script: Script, opts: { policy?: PolicyGate; tools?: NodeToolDefinition[]; spec?: Partial<RunSpec>; workspace?: (ws: string) => void } = {}) {
  const root = mkdtempSync(join(os.tmpdir(), "claude-adapter-test-"));
  const ws = join(root, "ws");
  mkdirSync(ws, { recursive: true });
  opts.workspace?.(ws);
  const cap: Captured = { prompts: [], interruptCalls: 0, reloadCalls: 0, closeCalls: 0 };
  const host = createFakeHost({ env: { anthropicApiKey: "test-key", anthropicBaseUrl: "https://api.anthropic.com" }, stateDir: join(root, "state"), workspaceDir: ws, tools: opts.tools, policy: opts.policy });
  const adapter = createClaudeAdapter({ query: fakeQuery(script, cap) });
  const spec: RunSpec = { runId: "r1", projectId: "p1", workspaceDir: ws, prompt: "count the words", model: "claude-haiku-5-5", budget: { maxUsd: 0.5, maxTurns: 10 }, context: { autoCompactTokens: 100000 }, ...opts.spec };
  const handle = adapter.start(spec, host);
  return { host, handle, cap, ws, root };
}

const wordCount: NodeToolDefinition = {
  name: "word_count",
  family: "workspace",
  risk: "read",
  description: "Count words",
  schema: z.object({ path: z.string() }),
  async execute() {
    return { ok: true, content: "3 words" };
  },
};

const init = (session = "sess-1"): SDKMessage =>
  ({ type: "system", subtype: "init", session_id: session, model: "claude-haiku-5-5", cwd: "<ws>", tools: ["Read", "mcp__node__word_count"], skills: [], agents: ["helper"], uuid: "u0" }) as unknown as SDKMessage;
const success = (cost: number, modelUsage: Record<string, unknown>): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: cost, modelUsage, session_id: "sess-1", uuid: "u9" }) as unknown as SDKMessage;

// ---------------------------------------------------------------------------

test("analyst replay: a recorded real run projects helpers, tool search, skill, plan, compaction and cost", async () => {
  const { host, handle } = setup(
    { messages: fixture },
    {
      tools: [wordCount],
      workspace: (ws) => {
        mkdirSync(join(ws, ".claude", "skills", "word-stats"), { recursive: true });
        writeFileSync(join(ws, ".claude", "skills", "word-stats", "SKILL.md"), "---\nname: word-stats\ndescription: x\n---\n");
      },
    },
  );
  const out = await handle.done;
  const ev = host.events;
  const initMsg = fixture.find((m) => m.type === "system" && m.subtype === "init") as { session_id: string };

  assert.equal(out.status, "completed", out.error);
  assert.equal(out.nativeSessionId, initMsg.session_id);
  assert.ok(out.finalText.length > 0);

  const started = of(ev, "run.started");
  assert.equal(started.length, 1, "run.started exactly once");
  assert.equal(started[0].nativeSessionId, initMsg.session_id);
  assert.equal(ev[0].type, "run.started", "run.started is the first event");
  assert.ok(started[0].deferredTools?.includes("word_count"), "non-alwaysLoad Node tool is reported deferred");

  // Helpers: ids are the native task ids; two of them overlapped in time.
  const taskIds = fixture.filter((m) => m.type === "system" && m.subtype === "task_started" && (m as { task_type?: string }).task_type === "local_agent").map((m) => (m as { task_id: string }).task_id);
  const hs = of(ev, "helper.started");
  assert.deepEqual(hs.map((h) => h.helperId), taskIds);
  assert.ok(hs.length >= 2, "two helpers");
  const doneIds = of(ev, "helper.completed").map((h) => h.helperId);
  for (const id of taskIds) assert.ok(doneIds.includes(id), `helper ${id} completed`);
  assert.ok(ev.indexOf(hs[1]) < ev.indexOf(of(ev, "helper.completed")[0]), "second helper started before the first completed");

  // Child events carry agentId = helperId; nothing claims a helper that was never started.
  const scoped = ev.filter((e) => (e.type === "tool.call" || e.type === "tool.result" || e.type === "message") && e.agentId);
  for (const e of scoped) assert.ok(taskIds.includes((e as { agentId: string }).agentId), `unknown agentId on ${e.type}`);

  // Every tool.call gets exactly one tool.result with the same callId.
  const calls = of(ev, "tool.call");
  const results = new Map(of(ev, "tool.result").map((r) => [r.callId, r]));
  for (const c of calls) assert.ok(results.has(c.callId), `tool.result for ${c.name} ${c.callId}`);
  const nodeNames = new Set(["word_count", "list_workspace", "activate_skill"]);
  for (const c of calls) assert.equal(c.native, !nodeNames.has(c.name), `${c.name} native flag`);

  // Deferred Node tool: searched, loaded, then called.
  const search = of(ev, "tool.search")[0];
  assert.ok(search, "tool.search");
  assert.equal(search.via, "native");
  assert.ok(of(ev, "tool.loaded").some((l) => l.names.includes("word_count") && l.via === "native-tool-search"));
  const firstWordCall = calls.find((c) => c.name === "word_count");
  assert.ok(firstWordCall && ev.indexOf(firstWordCall) > ev.indexOf(search), "word_count called after the search");
  assert.equal(firstWordCall.family, "workspace");
  assert.equal(firstWordCall.native, false);

  const skill = of(ev, "skill.loaded").find((s) => s.name === "word-stats");
  assert.ok(skill, "skill.loaded word-stats");
  assert.match(skill.sha256 ?? "", /^[0-9a-f]{64}$/);

  const goals = of(ev, "goals.updated");
  assert.ok(goals.length > 0);
  assert.ok(goals.every((g) => g.source === "claude:TodoWrite" && g.goals.every((x) => x.claimedBy === "engine")));

  const compaction = of(ev, "context.compacted");
  assert.ok(compaction.length > 0, "compaction observed");
  assert.ok(compaction[0].preTokens > 0 && compaction[0].nativeRef);

  // Denials come from the PreToolUse hook (not replayed here); the model still sees the denied result.
  assert.ok(of(ev, "tool.result").some((r) => !r.ok), "a failed/denied tool result is projected as ok:false");
  assert.ok(of(ev, "message.delta").length > 0, "main-agent deltas");
  assert.ok(of(ev, "message.delta").every((d) => !("agentId" in d) || d.agentId === undefined), "deltas are main-agent only");

  const usage = of(ev, "usage").at(-1)!;
  assert.equal(usage.totals.costSource, "engine");
  assert.ok((usage.totals.costUsd ?? 0) > 0);
  assert.ok(out.usage.modelTurns > 0);
  for (const r of of(ev, "engine.raw")) assert.ok(r.payload.length <= 4100, "raw payload capped");
});

test("policy: a native write into .claude/ is denied by the PreToolUse hook and canUseTool, and always answered", async () => {
  const policy: PolicyGate = {
    checkNativeTool: (name, input) =>
      String((input as { file_path?: string }).file_path ?? "").includes(".claude") ? { allow: false, reason: "Only Node writes under .claude/" } : { allow: true, reason: `${name} ok` },
  };
  // Hooks fire while the run is live; events after `done` are dropped by design.
  const live: Script = { messages: async function* (ctl) { yield init(); await ctl.closed; } };
  const { host, handle, cap } = setup(live, { policy, tools: [wordCount] });
  const pre = cap.options!.hooks!.PreToolUse![0].hooks[0] as HookCallback;
  const ac = new AbortController();
  const denied = await pre({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".claude/x.md" }, tool_use_id: "t1", agent_id: "task-9", session_id: "s", transcript_path: "", cwd: "" } as never, "t1", { signal: ac.signal });
  assert.deepEqual((denied as { hookSpecificOutput: unknown }).hookSpecificOutput, { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Only Node writes under .claude/" });
  const allowed = await pre({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "notes.md" }, tool_use_id: "t2", session_id: "s", transcript_path: "", cwd: "" } as never, "t2", { signal: ac.signal });
  assert.deepEqual(allowed, {});

  const canUse = cap.options!.canUseTool!;
  const d = await canUse("Edit", { file_path: ".claude/skills/a/SKILL.md" }, { signal: ac.signal, agentID: "task-9", toolUseID: "t3" } as never);
  assert.ok(d, "always answered"); assert.equal(d.behavior, "deny");
  const a = await canUse("mcp__node__word_count", { path: "a.txt" }, { signal: ac.signal, toolUseID: "t4" } as never);
  assert.ok(a); assert.equal(a.behavior, "allow", "Node tools are validated by the gateway, not re-denied here");

  // A throwing policy denies instead of leaving the request unanswered.
  const boom: PolicyGate = { checkNativeTool: () => { throw new Error("db down"); } };
  const s2 = setup(live, { policy: boom });
  const d2 = await s2.cap.options!.canUseTool!("Bash", { command: "ls" }, { signal: ac.signal, toolUseID: "t5" } as never);
  assert.ok(d2, "always answered"); assert.equal(d2.behavior, "deny");
  assert.match((d2 as { message: string }).message, /policy error: db down/);

  const decisions = of(host.events, "permission.decision");
  assert.ok(decisions.some((x) => x.decision === "deny" && x.tool === "Write" && x.agentId === "task-9"), "hook deny carries the helper agentId");
  assert.ok(decisions.some((x) => x.decision === "deny" && x.tool === "Edit" && x.agentId === "task-9"), "canUseTool deny recorded");
  assert.ok(!decisions.some((x) => x.tool.startsWith("mcp__node__")), "Node tools are not double-gated");
  await handle.interrupt("test over");
  await s2.handle.interrupt("test over");
  assert.equal((await handle.done).status, "interrupted");
});

test("operator interrupts: handle.interrupt() ends the run as interrupted with the native session id", async () => {
  const { handle, cap } = setup({
    messages: async function* (ctl) {
      yield init("sess-int");
      await ctl.interrupted;
      yield ({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["interrupted"], modelUsage: {}, session_id: "sess-int", uuid: "u" }) as unknown as SDKMessage;
      await ctl.closed;
    },
  });
  setTimeout(() => void handle.interrupt("user pressed stop"), 20);
  const out = await handle.done;
  assert.equal(out.status, "interrupted");
  assert.equal(out.nativeSessionId, "sess-int");
  assert.equal(out.error, "user pressed stop");
  assert.equal(cap.interruptCalls, 1);
  await assert.rejects(handle.send!("more"), /no longer accepting input/);
});

test("worker shutdown: host.signal abort ends a hung run as interrupted, never completed", async () => {
  const { host, handle } = setup({
    messages: async function* (ctl) {
      yield init("sess-abort");
      await ctl.closed;
    },
  });
  setTimeout(() => host.controller.abort(new Error("wall-clock cap")), 20);
  const out = await handle.done;
  assert.equal(out.status, "interrupted");
  assert.match(out.error ?? "", /wall-clock cap/);
});

test("provider failure: a thrown SDK error and an error result are honest failures with null cost", async () => {
  const thrown = setup({
    messages: async function* () {
      yield init();
      throw new Error("Claude Code process exited with code 1");
    },
  });
  const a = await thrown.handle.done;
  assert.equal(a.status, "failed");
  assert.match(a.error ?? "", /exited with code 1/);
  assert.equal(a.usage.costUsd, null);
  assert.equal(a.usage.costSource, "unknown");

  const budget = setup({ messages: [init(), ({ type: "result", subtype: "error_max_budget_usd", is_error: true, errors: ["Reached maximum budget ($0.5)"], modelUsage: {}, session_id: "sess-1", uuid: "u" }) as unknown as SDKMessage] });
  const b = await budget.handle.done;
  assert.equal(b.status, "failed");
  assert.match(b.error ?? "", /error_max_budget_usd: Reached maximum budget/);

  // Observed in qualification attempt 1: an interrupted turn reported total_cost_usd 0 with empty modelUsage.
  const zeroed = setup({ messages: [init(), ({ ...success(0, {}), subtype: "error_during_execution", is_error: true, errors: [] }) as unknown as SDKMessage] });
  const z0 = await zeroed.handle.done;
  assert.deepEqual([z0.usage.costUsd, z0.usage.costSource], [null, "unknown"], "a reported 0 with no model usage is unknown, not free");

  const silent = setup({ messages: [init()] });
  const c = await silent.handle.done;
  assert.equal(c.status, "failed", "no result is not success");
});

test("cost honesty: CLI guessed price (costBasis unknown) falls back to the price table, unknown model stays null", async () => {
  const usage = { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5, costBasis: "unknown" };
  const known = setup({ messages: [init(), success(0.5, { "claude-haiku-5-5": usage })] });
  const k = await known.handle.done;
  assert.equal(k.usage.costSource, "price-table");
  assert.ok(k.usage.costUsd !== null && k.usage.costUsd > 0 && k.usage.costUsd < 0.5);

  const unknown = setup({ messages: [init(), success(0.5, { "mystery-model-9": usage })] });
  const u = await unknown.handle.done;
  assert.equal(u.usage.costUsd, null);
  assert.equal(u.usage.costSource, "unknown");
  assert.equal(u.usage.inputTokens, 1000, "tokens are still reported");

  const listed = setup({ messages: [init(), success(0.0123, { "claude-haiku-5-5": { ...usage, costBasis: "list" } })] });
  const l = await listed.handle.done;
  assert.deepEqual([l.usage.costUsd, l.usage.costSource], [0.0123, "engine"]);
});

test("handoff and resume: portable packet is prepended, native session restored, child env isolated", async () => {
  const packet: HandoffPacket = {
    schema: "nodeagent.handoff/v1",
    fromRunId: "run-codex-1",
    fromEngine: "codex-app-server",
    originalPrompt: "Build the table",
    goals: [{ id: "g1", title: "Write table.md", status: "done", claimedBy: "engine" }],
    artifacts: [{ path: "table.md", sha256: "a".repeat(64), bytes: 120 }],
    checks: [{ checkId: "c1", command: "node --test", ok: false, summary: "1 failing" }],
    lastSummary: "Table drafted.",
    unresolved: ["citations not verified"],
    createdAt: "2026-10-29T00:00:00.000Z",
  };
  const { handle, cap, ws } = setup({ messages: [init("sess-old"), success(0, {})] }, { spec: { handoff: packet, resume: { nativeSessionId: "sess-old" }, prompt: "continue" } });
  const out = await handle.done;
  assert.equal(out.status, "completed");
  const first = cap.prompts[0].message.content as string;
  assert.ok(first.startsWith(renderHandoff(packet)));
  assert.ok(first.endsWith("continue"));
  assert.match(first, /table\.md sha256:aaaaaaaaaaaa 120B/);
  assert.match(first, /c1 FAILED/);
  assert.match(first, /claims, not verified/);

  const o = cap.options!;
  assert.equal(o.resume, "sess-old");
  assert.equal(o.cwd, ws);
  assert.equal(o.permissionMode, "default");
  assert.deepEqual(o.settingSources, ["project"]);
  const env = o.env as Record<string, string>;
  assert.equal(env.ANTHROPIC_API_KEY, "test-key");
  assert.equal(env.ENABLE_TOOL_SEARCH, "true");
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "100000");
  assert.ok(env.CLAUDE_CONFIG_DIR.endsWith(join("state", "claude-config")), "never the user's ~/.claude");
  assert.ok(!Object.keys(env).some((k) => k === "CLAUDECODE" || k.startsWith("OPENAI_")));
  const excludes = (o.settings as { claudeMdExcludes: string[] }).claudeMdExcludes;
  assert.ok(excludes.includes(join(dirname(ws), ".claude", "CLAUDE.md").split("\\").join("/")), "ancestor ~/.claude/CLAUDE.md style files are excluded");
  assert.ok(!excludes.some((e) => e.startsWith(`${ws.split("\\").join("/")}/`)), "the workspace's own CLAUDE.md still loads");
  assert.equal(o.agents?.helper.background, true);
  assert.equal(o.agents?.helper.model, "claude-haiku-5-5");
  assert.ok(!o.agents?.reviewer.tools?.includes("Write"), "reviewer is read-only");
});

test("skill refresh: activate_skill's refresher reaches Query.reloadSkills() on the live session", async () => {
  let refresh: (() => Promise<void>) | undefined;
  const activate: NodeToolDefinition = {
    name: "activate_skill",
    family: "skills",
    risk: "write",
    alwaysLoad: true,
    description: "activate",
    schema: z.object({ name: z.string() }),
    async execute(_a, ctx) {
      refresh = ctx.refreshSkills;
      await ctx.refreshSkills?.();
      return { ok: true, content: "active" };
    },
  };
  const s = setup({ messages: async function* (ctl) { yield init(); await ctl.closed; } }, { tools: [activate] });
  const r = await s.host.tools.call("activate_skill", { name: "x" }, {});
  assert.equal(r.ok, true);
  assert.ok(refresh);
  assert.equal(s.cap.reloadCalls, 1);
  await s.handle.interrupt("done");
  assert.equal((await s.handle.done).status, "interrupted");
});

test("adversarial native input: malformed messages become engine.raw and the run still resolves", async () => {
  const bad = { type: "assistant", message: { id: "m1", content: null }, parent_tool_use_id: null, uuid: "x" } as unknown as SDKMessage;
  const huge = { type: "mystery_future_type", blob: "x".repeat(50_000) } as unknown as SDKMessage;
  const { host, handle } = setup({ messages: [init(), bad, huge, success(0, {})] });
  const out = await handle.done;
  assert.equal(out.status, "completed");
  const raws = of(host.events, "engine.raw");
  assert.ok(raws.some((r) => r.nativeType.startsWith("untranslatable/assistant")));
  const big = raws.find((r) => r.nativeType === "mystery_future_type");
  assert.ok(big && big.payload.length < 4100, "raw payload capped near 4KB");
});

test("ancestorMemoryExcludes covers every ancestor up to the root and nothing inside the workspace", () => {
  const ws = join(os.tmpdir(), "a", "b", "ws");
  const ex = ancestorMemoryExcludes(ws);
  const norm = (p: string) => p.split("\\").join("/");
  assert.ok(ex.includes(norm(join(os.tmpdir(), "a", "b", "CLAUDE.md"))));
  assert.ok(ex.includes(norm(join(os.tmpdir(), "a", ".claude", "rules", "**"))));
  assert.ok(ex.some((e) => /^([A-Za-z]:)?\/[^/]*CLAUDE\.md$/.test(e) || /^[A-Za-z]:\/CLAUDE\.md$/.test(e)), "filesystem root included");
  assert.ok(!ex.some((e) => e.startsWith(`${norm(ws)}/`)));
});
