/**
 * Universal engine: native (AI SDK provider stream) -> contract event mapping.
 * Deterministic, no network: provider streams come from MockLanguageModelV3, either replayed from
 * test/fixtures/universal-native.jsonl (recorded during real qualification) or scripted per scenario.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { EngineEventDraft, HandoffPacket, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { createFakeHost } from "../src/testing/fakeHost.js";
import { createUniversalAdapter, estimateTokens, loadedNames, type UniversalSession } from "../src/engines/universal.js";
import { priceUsage } from "../src/pricing.js";
import { COMPACT_TOKENS, HELPER_MODEL, MAIN_MODEL, QUAL_TASK, promptKey, qualTools, seedWorkspace, type RecordedCall } from "../scripts/qualify-universal.js";

type Parts = unknown[];
const KEYS = { googleApiKey: "test-google-key" };

function usage(input: number, output: number) {
  return { inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: 0 } };
}
function turn(opts: { text?: string; calls?: Array<{ id: string; name: string; input: unknown }>; usage?: [number, number] }): Parts {
  const out: Parts = [{ type: "stream-start", warnings: [] }];
  if (opts.text) out.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: opts.text }, { type: "text-end", id: "t" });
  for (const c of opts.calls ?? []) out.push({ type: "tool-call", toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.input) });
  const [i, o] = opts.usage ?? [100, 10];
  out.push({ type: "finish", finishReason: { unified: opts.calls?.length ? "tool-calls" : "stop", raw: undefined }, usage: usage(i, o) });
  return out;
}

/**
 * Serves streams per agent: the key is the first user message prefix (main task or helper prompt),
 * so concurrent helpers get their own queue regardless of interleaving.
 */
function scriptedModel(streams: Array<{ key: string; parts: Parts }>, generates: unknown[] = [], gate?: (key: string) => Promise<void>): LanguageModel {
  const queues = new Map<string, Parts[]>();
  for (const s of streams) queues.set(s.key, [...(queues.get(s.key) ?? []), s.parts]);
  const gens = [...generates];
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doStream: async (opts) => {
      const key = promptKey(opts.prompt);
      const match = [...queues.keys()].find((k) => key.startsWith(k) || k.startsWith(key));
      const parts = match ? queues.get(match)!.shift() : undefined;
      if (!parts) throw new Error(`no scripted stream left for key ${JSON.stringify(key.slice(0, 60))}`);
      if (gate) await gate(key);
      const revived = parts.map((p) => {
        const q = p as { type: string; timestamp?: string };
        return q.type === "response-metadata" && q.timestamp ? { ...q, timestamp: new Date(q.timestamp) } : p;
      });
      return { stream: convertArrayToReadableStream(revived as never[]) };
    },
    doGenerate: async () => {
      const g = gens.shift();
      if (!g) throw new Error("no scripted generate left");
      return g as never;
    },
  }) as unknown as LanguageModel;
}

function summaryResult(text: string) {
  return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "STOP" }, usage: usage(300, 40), warnings: [] };
}

function setup(tools: NodeToolDefinition[] = qualTools()) {
  const root = mkdtempSync(join(tmpdir(), "universal-test-"));
  const ws = join(root, "ws");
  seedWorkspace(ws);
  const host = createFakeHost({ env: KEYS, stateDir: join(root, "state"), workspaceDir: ws, tools });
  return { root, ws, host };
}

function spec(ws: string, over: Partial<RunSpec> = {}): RunSpec {
  return { runId: "run-1", projectId: "p", workspaceDir: ws, prompt: "Count words in docs/alpha.txt.", model: "google:gemini-3.5-flash", budget: {}, context: {}, ...over };
}

const of = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], t: T) =>
  events.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === t);

function assertPaired(events: EngineEventDraft[]): void {
  const calls = of(events, "tool.call");
  const results = of(events, "tool.result");
  assert.equal(calls.length, results.length, "every tool.call has one tool.result");
  for (const c of calls) {
    const r = results.find((x) => x.callId === c.callId);
    assert.ok(r, `result for ${c.name}`);
    assert.equal(r.agentId, c.agentId, "result scope matches call scope");
  }
}

// ---------------------------------------------------------------------------
// Replay of the real qualification run
// ---------------------------------------------------------------------------

const FIXTURE = join(import.meta.dirname, "fixtures", "universal-native.jsonl");

test("analyst word-count task replayed from real Gemini streams maps to the full event set", { skip: !existsSync(FIXTURE) && "fixture not recorded yet" }, async () => {
  const recorded = readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l) as RecordedCall);
  const streams = recorded.filter((r) => r.kind === "stream").map((r) => ({ key: r.key, parts: r.parts! }));
  const generates = recorded.filter((r) => r.kind === "generate").map((r) => r.result);
  const model = scriptedModel(streams, generates);
  const { ws, host } = setup();
  const adapter = createUniversalAdapter({ resolveModel: () => model });
  const outcome = await adapter.start(
    spec(ws, { runId: "replay-1", prompt: QUAL_TASK, model: MAIN_MODEL, helperModel: HELPER_MODEL, budget: { maxTurns: 20 }, context: { autoCompactTokens: COMPACT_TOKENS } }),
    host,
  ).done;
  const ev = host.events;
  assert.equal(outcome.status, "completed", outcome.error);
  assert.equal(ev[0].type, "run.started");
  assert.equal(outcome.nativeSessionId, "replay-1");
  assertPaired(ev);
  const helpers = of(ev, "helper.started");
  assert.ok(helpers.length >= 2, "two helpers");
  const ids = new Set(helpers.map((h) => h.helperId));
  assert.equal(ids.size, helpers.length, "stable distinct helper ids");
  for (const h of of(ev, "helper.completed")) assert.ok(ids.has(h.helperId));
  const child = of(ev, "tool.call").filter((c) => c.agentId && ids.has(c.agentId));
  assert.ok(child.length > 0, "child tool calls carry agentId = helperId");
  assert.ok(child.every((c) => c.name !== "delegate"), "helpers cannot nest delegates");
  assert.ok(of(ev, "tool.search").length > 0 && of(ev, "tool.loaded").length > 0, "deferred tool discovered and loaded");
  assert.ok(of(ev, "tool.call").some((c) => c.name === "word_count"), "loaded tool was called");
  assert.ok(of(ev, "skill.loaded").some((s) => s.name === "word-stats"));
  assert.ok(of(ev, "goals.updated").length > 0);
  assert.ok(of(ev, "context.compacted").length > 0, "auto compaction under the lowered threshold");
  assert.ok(of(ev, "message.delta").length > 0);
  // Usage equals what the recorded provider streams reported (no invented tokens).
  let recordedOut = 0;
  for (const r of recorded) {
    const fin = (r.parts ?? []).find((p) => (p as { type: string }).type === "finish") as { usage?: { outputTokens?: { total?: number } } } | undefined;
    recordedOut += fin?.usage?.outputTokens?.total ?? (r.result as { usage?: { outputTokens?: { total?: number } } } | undefined)?.usage?.outputTokens?.total ?? 0;
  }
  assert.equal(outcome.usage.outputTokens, recordedOut);
  assert.equal(outcome.usage.costUsd, null, "gemini-3.5-flash has no verified price: null, not 0");
  assert.match(outcome.finalText, /\d/);
});

// ---------------------------------------------------------------------------
// Scripted scenarios
// ---------------------------------------------------------------------------

const TASK_KEY = "Count words in docs/alpha.txt.";

test("deferred tool: calling before load is refused, after load_tool it is callable on the next step", async () => {
  const { ws, host } = setup();
  const model = scriptedModel([
    { key: TASK_KEY, parts: turn({ calls: [{ id: "c1", name: "word_count", input: { path: "docs/alpha.txt" } }] }) },
    { key: TASK_KEY, parts: turn({ calls: [{ id: "c2", name: "search_tools", input: { query: "count words" } }] }) },
    { key: TASK_KEY, parts: turn({ calls: [{ id: "c3", name: "load_tool", input: { names: ["word_count"] } }] }) },
    { key: TASK_KEY, parts: turn({ calls: [{ id: "c4", name: "word_count", input: { path: "docs/alpha.txt" } }] }) },
    { key: TASK_KEY, parts: turn({ text: "docs/alpha.txt: 35" }) },
  ]);
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws), host).done;
  assert.equal(out.status, "completed", out.error);
  const results = of(host.events, "tool.result");
  assert.equal(results.find((r) => r.callId === "c1")?.ok, false);
  assert.equal(results.find((r) => r.callId === "c4")?.ok, true);
  assert.match(results.find((r) => r.callId === "c4")!.preview, /"words":35/);
  const started = of(host.events, "run.started")[0];
  assert.ok(started.deferredTools?.includes("word_count") && !started.tools.includes("word_count"));
  const session = JSON.parse(readFileSync(join(host.stateDir, "run-1.json"), "utf8")) as UniversalSession;
  assert.deepEqual(session.loaded, ["word_count"], "loaded set persisted for resume");
});

test("two delegates in one step run concurrently (a barrier both helpers must reach would deadlock if serial)", async () => {
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const tools = [
    ...qualTools(),
    {
      name: "rendezvous",
      family: "workspace",
      risk: "read",
      alwaysLoad: true,
      description: "wait for the other helper",
      schema: z.object({}),
      async execute() {
        if (++arrived === 2) release();
        await Promise.race([barrier, new Promise((_, rej) => setTimeout(() => rej(new Error("helpers ran serially")), 2000))]);
        return { ok: true, content: "met" };
      },
    } as NodeToolDefinition,
  ];
  const { ws, host } = setup(tools);
  const model = scriptedModel([
    {
      key: TASK_KEY,
      parts: turn({
        calls: [
          { id: "h1", name: "delegate", input: { description: "helper A", prompt: "Helper A: meet then report" } },
          { id: "h2", name: "delegate", input: { description: "helper B", prompt: "Helper B: meet then report" } },
        ],
      }),
    },
    { key: "Helper A", parts: turn({ calls: [{ id: "a1", name: "rendezvous", input: {} }] }) },
    { key: "Helper A", parts: turn({ text: "A done" }) },
    { key: "Helper B", parts: turn({ calls: [{ id: "b1", name: "rendezvous", input: {} }] }) },
    { key: "Helper B", parts: turn({ text: "B done" }) },
    { key: TASK_KEY, parts: turn({ text: "both done" }) },
  ]);
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws), host).done;
  assert.equal(out.status, "completed", out.error);
  const ev = host.events;
  assertPaired(ev);
  assert.deepEqual(of(ev, "helper.started").map((h) => h.helperId).sort(), ["h1", "h2"]);
  assert.deepEqual(of(ev, "helper.completed").map((h) => h.status), ["completed", "completed"]);
  assert.equal(of(ev, "tool.call").find((c) => c.callId === "a1")?.agentId, "h1");
  assert.equal(of(ev, "tool.call").find((c) => c.callId === "b1")?.agentId, "h2");
  assert.equal(of(ev, "tool.call").find((c) => c.callId === "h1")?.native, true);
  assert.ok(of(ev, "tool.result").filter((r) => r.agentId).every((r) => r.ok));
  assert.equal(out.usage.modelTurns, 6);
});

test("compaction keeps task + goals + tail, never orphans a tool result, and emits estimated pre/post tokens", async () => {
  const { ws, host } = setup();
  const big = "x".repeat(4000);
  const streams = [
    { key: TASK_KEY, parts: turn({ calls: [{ id: "g1", name: "update_goals", input: { goals: [{ id: "g", title: big.slice(0, 50), status: "active" }] } }] }) },
    ...[1, 2, 3, 4].map((i) => ({ key: TASK_KEY, parts: turn({ text: big, calls: [{ id: `s${i}`, name: "search_tools", input: { query: "count" } }] }) })),
    { key: TASK_KEY, parts: turn({ text: "done" }) },
  ];
  const model = scriptedModel(streams, [summaryResult("Searched tools four times; found word_count.")]);
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws, { context: { autoCompactTokens: 2500 } }), host).done;
  assert.equal(out.status, "completed", out.error);
  const c = of(host.events, "context.compacted");
  assert.equal(c.length, 1);
  assert.equal(c[0].trigger, "auto");
  assert.ok(c[0].preTokens > 2500 && c[0].postTokens! < c[0].preTokens);
  const s = JSON.parse(readFileSync(join(host.stateDir, "run-1.json"), "utf8")) as UniversalSession;
  const first = s.messages[0];
  assert.equal(first.role, "user");
  assert.ok(String(first.content).startsWith(TASK_KEY) && /found word_count/.test(String(first.content)) && /g=active/.test(String(first.content)));
  assert.equal(s.messages[1].role, "assistant", "tail starts at an assistant message");
  assert.equal(out.usage.modelTurns, 7, "summary request is counted");
});

test("interrupt mid-tool resolves interrupted, persists a consistent session, and resume continues it", async () => {
  const tools = [
    ...qualTools(),
    {
      name: "slow",
      family: "workspace",
      risk: "read",
      alwaysLoad: true,
      description: "blocks until aborted",
      schema: z.object({}),
      execute: (_a, ctx) => new Promise((resolve) => ctx.signal.addEventListener("abort", () => resolve({ ok: false, content: "aborted" }))),
    } as NodeToolDefinition,
  ];
  const { ws, host } = setup(tools);
  const model = scriptedModel([
    { key: TASK_KEY, parts: turn({ calls: [{ id: "w1", name: "slow", input: {} }] }) },
    { key: TASK_KEY, parts: turn({ text: "resumed and finished" }) },
  ]);
  const adapter = createUniversalAdapter({ resolveModel: () => model });
  const handle = adapter.start(spec(ws), host);
  while (!host.events.some((e) => e.type === "tool.call")) await new Promise((r) => setTimeout(r, 5));
  host.controller.abort(new Error("wall clock cap"));
  const out = await handle.done;
  assert.equal(out.status, "interrupted");
  assert.match(out.error ?? "", /wall clock cap/);
  assert.equal(out.nativeSessionId, "run-1");
  const s = JSON.parse(readFileSync(join(host.stateDir, "run-1.json"), "utf8")) as UniversalSession;
  assert.equal(s.messages.at(-1)?.role, "tool", "the interrupted call has a recorded result");

  const host2 = createFakeHost({ env: KEYS, stateDir: host.stateDir, workspaceDir: ws, tools });
  const out2 = await adapter.start(spec(ws, { runId: "run-2", prompt: "Continue.", resume: { nativeSessionId: "run-1" } }), host2).done;
  assert.equal(out2.status, "completed", out2.error);
  assert.equal(out2.finalText, "resumed and finished");
  assert.equal(of(host2.events, "run.started")[0].nativeSessionId, "run-1");
  assert.equal(out2.usage.modelTurns, 1, "resume run reports only its own usage");
  const s2 = JSON.parse(readFileSync(join(host.stateDir, "run-1.json"), "utf8")) as UniversalSession;
  assert.equal(s2.step, 2);
  assert.ok(!existsSync(join(host.stateDir, "run-2.json")), "resume writes to the native session, not a new one");
});

test("handle.interrupt during a model request ends interrupted without a fake completion", async () => {
  const { ws, host } = setup();
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => {
      await new Promise((_, rej) => abortSignal?.addEventListener("abort", () => rej(abortSignal.reason)));
      throw new Error("unreachable");
    },
  }) as unknown as LanguageModel;
  const handle = createUniversalAdapter({ resolveModel: () => model }).start(spec(ws), host);
  while (!host.events.some((e) => e.type === "run.started")) await new Promise((r) => setTimeout(r, 5));
  await handle.interrupt("user pressed stop");
  const out = await handle.done;
  assert.equal(out.status, "interrupted");
  assert.equal(out.finalText, "");
  assert.ok(!host.events.some((e) => e.type === "message"));
});

test("crash recovery: a saved session with a dangling tool call is repaired before resuming", async () => {
  const { ws, host } = setup();
  const session: UniversalSession = {
    schema: "nodeagent.universal-session/v1",
    sessionId: "old",
    model: "google:gemini-3.5-flash",
    task: TASK_KEY,
    messages: [
      { role: "user", content: TASK_KEY },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "d1", toolName: "word_count", input: { path: "docs/alpha.txt" } }] },
    ],
    step: 1,
    loaded: [],
    compactions: 0,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(host.stateDir, "old.json"), JSON.stringify(session));
  let seen: unknown;
  const model = new MockLanguageModelV3({
    doStream: async (opts) => {
      seen = opts.prompt;
      return { stream: convertArrayToReadableStream(turn({ text: "ok" }) as never[]) };
    },
  }) as unknown as LanguageModel;
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws, { runId: "r2", prompt: "go on", resume: { nativeSessionId: "old" } }), host).done;
  assert.equal(out.status, "completed", out.error);
  const toolMsg = (seen as Array<{ role: string; content: Array<{ type: string; toolCallId?: string }> }>).find((m) => m.role === "tool");
  assert.equal(toolMsg?.content[0].toolCallId, "d1");
});

test("setup and input failures are honest failures, never a completed run", async (t) => {
  const { ws, host } = setup();
  const adapter = createUniversalAdapter();
  const cases: Array<[string, Partial<RunSpec>, RegExp, Partial<{ env: object }>?]> = [
    ["model without provider prefix", { model: "gemini-3.5-flash" }, /provider:model/],
    ["unknown provider", { model: "mistral:large" }, /Unknown provider/],
    ["missing credential", { model: "anthropic:claude-haiku-5-5" }, /ANTHROPIC_API_KEY is not set/],
    ["resume of an unknown session", { resume: { nativeSessionId: "nope" } }, /No saved universal session "nope"/],
    ["path traversal in session id", { resume: { nativeSessionId: "../../etc/passwd" } }, /Invalid session id/],
  ];
  for (const [name, over, re] of cases)
    await t.test(name, async () => {
      const out = await adapter.start(spec(ws, over), host).done;
      assert.equal(out.status, "failed");
      assert.match(out.error ?? "", re);
      assert.equal(out.usage.costUsd, null);
      assert.ok(!(out.error ?? "").includes(KEYS.googleApiKey), "no secret in errors");
    });
});

test("provider error mid-stream fails the run with the provider's message", async () => {
  const { ws, host } = setup();
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream([{ type: "stream-start", warnings: [] }, { type: "error", error: new Error("429 quota exhausted") }] as never[]) }),
  }) as unknown as LanguageModel;
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws), host).done;
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /429 quota exhausted/);
});

test("runaway model hits the step cap and fails instead of looping forever", async () => {
  const { ws, host } = setup();
  const loopTurns = Array.from({ length: 5 }, (_, i) => ({ key: TASK_KEY, parts: turn({ calls: [{ id: `l${i}`, name: "search_tools", input: { query: "x" } }] }) }));
  const out = await createUniversalAdapter({ resolveModel: () => scriptedModel(loopTurns) }).start(spec(ws, { budget: { maxTurns: 3 } }), host).done;
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /Step cap reached \(3/);
  assert.equal(out.usage.modelTurns, 3);
});

test("cost: priced model uses the price table; any unpriced model in the run makes cost null; maxUsd stops the run", async () => {
  const { ws, host } = setup();
  const priced = await createUniversalAdapter({ resolveModel: () => scriptedModel([{ key: TASK_KEY, parts: turn({ text: "hi", usage: [1000, 500] }) }]) })
    .start(spec(ws, { model: "anthropic:claude-haiku-5-5" }), host).done;
  assert.equal(priced.usage.costUsd, priceUsage("claude-haiku-5-5", { inputTokens: 1000, outputTokens: 500 }).costUsd);
  assert.equal(priced.usage.costSource, "price-table");

  const host2 = setup().host;
  const mixed = await createUniversalAdapter({
    resolveModel: () => scriptedModel([
      { key: TASK_KEY, parts: turn({ calls: [{ id: "h", name: "delegate", input: { description: "d", prompt: "Sub: say hi" } }] }) },
      { key: "Sub", parts: turn({ text: "hi" }) },
      { key: TASK_KEY, parts: turn({ text: "done" }) },
    ]),
  }).start(spec(ws, { model: "anthropic:claude-haiku-5-5", helperModel: "google:gemini-3.5-flash" }), host2).done;
  assert.equal(mixed.status, "completed", mixed.error);
  assert.equal(mixed.usage.costUsd, null);
  assert.equal(mixed.usage.costSource, "unknown");

  const viaRouter = await createUniversalAdapter({ resolveModel: () => scriptedModel([{ key: TASK_KEY, parts: turn({ text: "hi", usage: [1000, 500] }) }]) })
    .start(spec(ws, { model: "openrouter:anthropic/claude-haiku-5-5" }), setup().host).done;
  assert.equal(viaRouter.usage.costUsd, null, "OpenRouter rates are not the direct price table");

  const host3 = setup().host;
  const capped = await createUniversalAdapter({
    resolveModel: () => scriptedModel([{ key: TASK_KEY, parts: turn({ calls: [{ id: "s", name: "search_tools", input: { query: "x" } }], usage: [2_000_000, 0] }) }]),
  }).start(spec(ws, { model: "anthropic:claude-haiku-5-5", budget: { maxUsd: 0.1 } }), host3).done;
  assert.equal(capped.status, "failed");
  assert.match(capped.error ?? "", /Budget exceeded/);
});

test("handoff packet is rendered into the first prompt as claims, not opaque state", async () => {
  const { ws, host } = setup();
  let seen = "";
  const model = new MockLanguageModelV3({
    doStream: async (opts) => {
      seen = promptKey(opts.prompt) + JSON.stringify(opts.prompt);
      return { stream: convertArrayToReadableStream(turn({ text: "ok" }) as never[]) };
    },
  }) as unknown as LanguageModel;
  const handoff: HandoffPacket = {
    schema: "nodeagent.handoff/v1",
    fromRunId: "prev",
    fromEngine: "claude-agent-sdk",
    originalPrompt: "Write report.md",
    goals: [{ id: "g1", title: "Draft report", status: "done", claimedBy: "engine" }],
    artifacts: [{ path: "report.md", sha256: "a".repeat(64), bytes: 120 }],
    checks: [{ checkId: "lint", command: "npm run lint", ok: false, summary: "2 errors" }],
    lastSummary: "Drafted the report.",
    unresolved: ["citations not verified"],
    createdAt: "2026-10-29T00:00:00.000Z",
  };
  const out = await createUniversalAdapter({ resolveModel: () => model }).start(spec(ws, { handoff, prompt: "Finish the report." }), host).done;
  assert.equal(out.status, "completed");
  for (const s of ["Handoff from claude-agent-sdk run prev", "[done] Draft report (claimed by engine)", "report.md sha256=aaaaaaaaaaaaaaaa", "FAIL lint", "citations not verified", "Finish the report."])
    assert.ok(seen.includes(s), `prompt contains ${s}`);
});

test("availability reports per-provider gaps without secrets and never calls a provider", async () => {
  const a = createUniversalAdapter();
  const none = await a.availability({});
  assert.equal(none.ok, false);
  assert.equal(none.missing.length, 4);
  const some = await a.availability({ googleApiKey: "secret-value" });
  assert.equal(some.ok, true);
  assert.ok(some.missing.every((m) => !m.includes("secret-value")));
  const d = a.descriptor();
  assert.equal(d.id, "nodeagent-universal");
  assert.equal(d.sdk.name, "ai");
  assert.match(d.sdk.version, /^\d+\.\d+\.\d+/);
  assert.ok(d.models.every((m) => m.includes(":")));
});

test("helpers: estimateTokens is chars/4 over model-visible content; loadedNames prefers tool data over args", () => {
  assert.equal(estimateTokens("abcd", [{ role: "user", content: "efgh" }]), 2);
  const host = { tools: { get: (n: string) => (n === "word_count" || n === "read" ? ({} as NodeToolDefinition) : undefined) } } as never;
  assert.deepEqual(loadedNames({ names: ["word_count", "read"] }, { names: ["word_count"] }, host), ["word_count"]);
  assert.deepEqual(loadedNames({ names: ["word_count", "ghost"] }, undefined, host), ["word_count"]);
});
