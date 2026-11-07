/**
 * OpenAI Agents adapter: native stream -> contract events, replayed from REAL
 * records captured by scripts/qualify-openai.ts (gpt-5.4-mini, 2026-10-29).
 * Persona: a NodeRoom analyst asks for word stats on two notes; the main agent
 * loads a skill, plans, fans out two helpers that discover a deferred tool, and
 * the server compacts context. A second run is interrupted mid-helper.
 * Deterministic, no network.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EngineEventDraft, HandoffPacket, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { createOpenAIAgentsAdapter, createTranslator, FileSession, renderHandoff, type NativeRecord } from "../src/engines/openaiAgents.js";
import { priceUsage } from "../src/pricing.js";
import { createFakeHost } from "../src/testing/fakeHost.js";

type Rec = NativeRecord & { run: "main" | "interrupt" };
const FIXTURE = fileURLToPath(new URL("./fixtures/openai-agents-native.jsonl", import.meta.url));
const records: Rec[] = readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Rec);

const noop = async () => ({ ok: true, content: "" });
const nodeTools: NodeToolDefinition[] = [
  { name: "word_count", family: "workspace", risk: "read", description: "count words", schema: z.object({ path: z.string() }), execute: noop },
  { name: "search_skills", family: "skills", risk: "read", alwaysLoad: true, description: "s", schema: z.object({ query: z.string() }), execute: noop },
  { name: "load_skill", family: "skills", risk: "read", alwaysLoad: true, description: "l", schema: z.object({ name: z.string() }), execute: noop },
  { name: "update_goals", family: "goals", risk: "propose", alwaysLoad: true, description: "g", schema: z.object({ goals: z.array(z.unknown()) }), execute: noop },
];

function replay(recs: NativeRecord[], models = { main: "gpt-5.4-mini", helper: "gpt-5.4-mini" }) {
  const host = createFakeHost({ env: {}, stateDir: mkdtempSync(join(tmpdir(), "oa-test-")), workspaceDir: tmpdir(), tools: nodeTools });
  const t = createTranslator(host, models);
  for (const r of recs) t.onRecord(r);
  t.flush();
  return { events: host.events, t };
}

const of = <T extends EngineEventDraft["type"]>(evs: EngineEventDraft[], type: T) =>
  evs.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === type);

const mainRun = records.filter((r) => r.run === "main");
const interruptedRun = records.filter((r) => r.run === "interrupt");

test("fixture is real, trimmed and secret-free", () => {
  const text = readFileSync(FIXTURE, "utf8");
  assert.ok(records.length > 20);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9]/);
  assert.doesNotMatch(text, /providerData/);
  for (const r of records) if (r.item?.rawItem?.encrypted_content) assert.equal(r.item.rawItem.encrypted_content, "[stripped]");
});

test("analyst run: every tool call pairs with exactly one result, Node families resolved", () => {
  const { events } = replay(mainRun);
  const calls = of(events, "tool.call");
  const results = of(events, "tool.result");
  assert.equal(new Set(calls.map((c) => c.callId)).size, calls.length, "no duplicate tool.call");
  assert.deepEqual(new Set(results.map((r) => r.callId)), new Set(calls.map((c) => c.callId)));
  for (const c of calls) {
    const res = results.find((r) => r.callId === c.callId)!;
    assert.equal(res.agentId, c.agentId, `result scope matches call scope for ${c.name}`);
  }
  const wc = calls.find((c) => c.name === "word_count")!;
  assert.equal(wc.family, "workspace");
  assert.equal(wc.native, false);
  const spawn = calls.filter((c) => c.name === "spawn_helper");
  assert.equal(spawn.length, 2);
  assert.ok(spawn.every((s) => s.native && s.family === "native" && s.agentId === undefined));
});

test("helpers: child tool calls carry agentId = spawn_helper call id; helper text never streams as main deltas", () => {
  const { events } = replay(mainRun);
  const helperIds = new Set(of(events, "tool.call").filter((c) => c.name === "spawn_helper").map((c) => c.callId));
  const child = of(events, "tool.call").filter((c) => c.agentId);
  assert.ok(child.length >= 4, "two helpers x (tool_search + word_count)");
  assert.ok(child.every((c) => helperIds.has(c.agentId!)));
  assert.deepEqual(new Set(child.map((c) => c.agentId)), helperIds, "both helpers observed");
  // Both spawn_helper calls precede any child event: the model issued them in one turn.
  const firstChild = events.findIndex((e) => e.type === "tool.call" && e.agentId);
  const spawns = events.map((e, i) => (e.type === "tool.call" && e.name === "spawn_helper" ? i : -1)).filter((i) => i >= 0);
  assert.ok(spawns.every((i) => i < firstChild));
  const progress = of(events, "helper.progress");
  assert.ok(progress.length > 0 && progress.every((p) => helperIds.has(p.helperId)));
  assert.ok(of(events, "message.delta").every((d) => !("agentId" in d)));
  // The fixture keeps only main deltas; a helper-scoped delta must not leak into the main stream.
  const mainDelta = mainRun.find((r) => r.data?.type === "output_text_delta")!;
  const leaked = replay([{ ...mainDelta, agentId: [...helperIds][0] }]).events;
  assert.equal(of(leaked, "message.delta").length, 0);
  const helperMsgs = of(events, "message").filter((m) => m.agentId);
  assert.equal(helperMsgs.length, 2);
  assert.ok(helperMsgs.every((m) => helperIds.has(m.agentId!)));
});

test("native tool search: server call/output paired by order, query and loaded names surfaced", () => {
  const { events } = replay(mainRun);
  const searches = of(events, "tool.search");
  assert.equal(searches.length, 2);
  const searchCalls = of(events, "tool.call").filter((c) => c.name === "tool_search");
  assert.deepEqual(searches.map((s) => s.callId).sort(), searchCalls.map((c) => c.callId).sort());
  for (const s of searches) {
    assert.equal(s.via, "native");
    assert.match(s.query, /word_count/);
    assert.deepEqual(s.results, ["word_count"]);
  }
  const loaded = of(events, "tool.loaded");
  assert.equal(loaded.length, 2);
  assert.ok(loaded.every((l) => l.via === "native-tool-search" && l.names[0] === "word_count" && l.agentId));
  // Each helper calls word_count only after its own search loaded it.
  for (const s of searches) {
    const si = events.indexOf(s);
    assert.ok(events.slice(si).some((e) => e.type === "tool.call" && e.name === "word_count" && e.agentId === s.agentId));
  }
});

test("compaction: exactly one context.compacted from the real compaction item, preTokens = compacting turn input", () => {
  const { events } = replay(mainRun);
  const c = of(events, "context.compacted");
  assert.equal(c.length, 1);
  const item = mainRun.find((r) => r.name === "compaction_item_created")!;
  assert.equal(c[0].nativeRef, item.item!.rawItem.id);
  const lastMainDone = mainRun.filter((r) => r.data?.type === "response_done" && !r.agentId).at(-1)!;
  assert.equal(c[0].preTokens, lastMainDone.data.response.usage.inputTokens);
  assert.equal(c[0].trigger, "auto");
  assert.equal(of(replay(interruptedRun).events, "context.compacted").length, 0, "no compaction item, no event");
});

test("streaming: main deltas coalesce into a prefix of the final assistant message", () => {
  const { events } = replay(mainRun);
  const streamed = of(events, "message.delta").map((d) => d.text).join("");
  const final = of(events, "message").filter((m) => !m.agentId).at(-1)!;
  assert.ok(streamed.length > 0);
  assert.ok(final.text.startsWith(streamed));
  assert.ok(of(events, "message.delta").length < mainRun.filter((r) => r.data?.type === "output_text_delta").length, "coalesced");
});

test("usage: per-model token totals and price-table cost recomputed independently", () => {
  const { events, t } = replay(mainRun);
  let input = 0, output = 0, cached = 0, turns = 0;
  for (const r of mainRun) {
    if (r.data?.type !== "response_done") continue;
    const u = r.data.response.usage;
    const c = u.inputTokensDetails?.cached_tokens ?? 0;
    input += u.inputTokens - c;
    cached += c;
    output += u.outputTokens;
    turns++;
  }
  const totals = t.totals();
  assert.deepEqual(
    { input: totals.inputTokens, output: totals.outputTokens, cached: totals.cacheReadTokens, turns: totals.modelTurns },
    { input, output, cached, turns },
  );
  assert.equal(totals.costUsd, priceUsage("gpt-5.4-mini", { inputTokens: input, outputTokens: output, cacheReadTokens: cached }).costUsd);
  assert.equal(totals.costSource, "price-table");
  assert.equal(of(events, "usage").length, turns);
  assert.equal(of(events, "context.usage").length, turns);
});

test("sad path: unknown model keeps cost null (never 0); SDK tool error text marks the result failed", () => {
  const { t } = replay(mainRun, { main: "gpt-unknown", helper: "gpt-5.4-mini" });
  assert.equal(t.totals().costUsd, null);
  assert.equal(t.totals().costSource, "unknown");
  const call = mainRun.find((r) => r.name === "tool_called")!;
  const out = structuredClone(mainRun.find((r) => r.name === "tool_output" && r.item!.rawItem.callId === call.item!.rawItem.callId)!);
  out.item!.output = "An error occurred while running the tool. Please try again.";
  const { events } = replay([call, out]);
  assert.equal(of(events, "tool.result")[0].ok, false);
});

test("adversarial: execution-time announce + stream replay of the same call id emits one call and one result", () => {
  const host = createFakeHost({ env: {}, stateDir: mkdtempSync(join(tmpdir(), "oa-test-")), workspaceDir: tmpdir(), tools: nodeTools });
  const t = createTranslator(host, { main: "gpt-5.4-mini", helper: "gpt-5.4-mini" });
  const call = mainRun.find((r) => r.name === "tool_called")!;
  const out = mainRun.find((r) => r.name === "tool_output" && r.item!.rawItem.callId === call.item!.rawItem.callId)!;
  const callId = call.item!.rawItem.callId as string;
  t.emitCall({ callId, name: call.item!.rawItem.name, input: call.item!.rawItem.arguments });
  t.markOk(callId, false);
  t.emitResult({ callId, ok: false, output: "[tool failed] denied", ms: 3 });
  t.onRecord(call);
  t.onRecord(out);
  assert.equal(of(host.events, "tool.call").length, 1);
  const results = of(host.events, "tool.result");
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false, "the gateway outcome wins over the stream heuristic");
});

test("interrupted run: the in-flight helper call has no fabricated result", () => {
  const { events } = replay(interruptedRun);
  const spawn = of(events, "tool.call").find((c) => c.name === "spawn_helper")!;
  assert.ok(spawn);
  assert.equal(of(events, "tool.result").filter((r) => r.callId === spawn.callId).length, 0);
});

test("untranslated native messages become capped engine.raw", () => {
  const big: NativeRecord = { type: "run_item_stream_event", name: "handoff_requested", item: { type: "handoff_call_item", rawItem: { blob: "x".repeat(20_000) } } };
  const { events } = replay([big, { type: "agent_updated_stream_event", agent: "main" }]);
  const raw = of(events, "engine.raw");
  assert.equal(raw.length, 2);
  assert.ok(raw[0].payload.length < 4200);
  assert.equal(raw[1].nativeType, "agent_updated");
});

// ---- adapter surface (no network) ---------------------------------------------

const baseSpec = (extra: Partial<RunSpec> = {}): RunSpec => ({
  runId: "r1",
  projectId: "p1",
  workspaceDir: tmpdir(),
  prompt: "hi",
  model: "gpt-5.4-mini",
  budget: {},
  context: {},
  ...extra,
});

test("descriptor reads the installed SDK and declares all 14 capabilities", () => {
  const d = createOpenAIAgentsAdapter().descriptor();
  assert.equal(d.id, "openai-agents");
  assert.equal(d.sdk.name, "@openai/agents");
  assert.match(d.sdk.version, /^\d+\.\d+\.\d+/);
  assert.equal(Object.keys(d.capabilities).length, 14);
  assert.equal(d.capabilities.skillRefresh.status, "UNTESTED");
  assert.equal(d.defaultModel, "gpt-5.5");
});

test("setup required: missing key is reported by availability and fails start honestly", async () => {
  const adapter = createOpenAIAgentsAdapter();
  const av = await adapter.availability({});
  assert.equal(av.ok, false);
  assert.deepEqual(av.missing, ["OPENAI_API_KEY is not set"]);
  const host = createFakeHost({ env: {}, stateDir: mkdtempSync(join(tmpdir(), "oa-test-")), workspaceDir: tmpdir() });
  const out = await adapter.start(baseSpec(), host).done;
  assert.equal(out.status, "failed");
  assert.match(out.error!, /Setup required: OPENAI_API_KEY/);
  assert.equal(out.usage.costUsd, null);
  assert.equal(host.events.length, 0, "no run.started for a run that never started");
});

test("resume: unknown or path-traversal session ids fail instead of silently starting fresh", async () => {
  const adapter = createOpenAIAgentsAdapter();
  for (const id of ["oas_00000000-0000-0000-0000-000000000000", "../../outside", "oas_../x"]) {
    const host = createFakeHost({ env: { openaiApiKey: "not-a-real-key" }, stateDir: mkdtempSync(join(tmpdir(), "oa-test-")), workspaceDir: tmpdir() });
    const out = await adapter.start(baseSpec({ resume: { nativeSessionId: id } }), host).done;
    assert.equal(out.status, "failed");
    assert.match(out.error!, /not found/);
    assert.equal(host.events.length, 0);
  }
});

test("FileSession persists across reopen and rejects malformed ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-sess-"));
  const s = FileSession.create(dir);
  const id = await s.getSessionId();
  await s.addItems([{ role: "user", content: "count words" } as never, { role: "user", content: "second" } as never]);
  const again = FileSession.open(dir, id)!;
  assert.equal((await again.getItems()).length, 2);
  assert.equal((await again.getItems(1)).length, 1);
  await again.popItem();
  assert.equal((await FileSession.open(dir, id)!.getItems()).length, 1);
  assert.equal(FileSession.open(dir, "../" + id), undefined);
  writeFileSync(join(dir, "openai-sessions", "evil.json"), "[]");
  assert.equal(FileSession.open(dir, "evil"), undefined);
});

test("handoff rendering carries goals, artifact hashes, checks and unresolved work, nothing opaque", () => {
  const packet: HandoffPacket = {
    schema: "nodeagent.handoff/v1",
    fromRunId: "run-claude-1",
    fromEngine: "claude-agent-sdk",
    originalPrompt: "Build the word stats report",
    goals: [{ id: "g1", title: "Count both files", status: "done", claimedBy: "engine" }],
    artifacts: [{ path: "report.md", sha256: "ab".repeat(32), bytes: 120 }],
    checks: [{ checkId: "unit", command: "npm test", ok: false, summary: "1 failed" }],
    lastSummary: "Counted alpha, beta pending",
    unresolved: ["beta.txt count not verified"],
    createdAt: "2026-10-29T00:00:00Z",
  };
  const text = renderHandoff(packet);
  for (const s of ["claude-agent-sdk", "Count both files", "report.md", "ab".repeat(32), "FAIL unit", "beta.txt count not verified", "verify before relying"]) {
    assert.ok(text.includes(s), s);
  }
  assert.doesNotMatch(text, /session|resume id/i);
});
