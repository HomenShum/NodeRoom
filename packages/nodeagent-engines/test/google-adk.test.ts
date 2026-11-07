/**
 * Google ADK adapter: native event -> contract event mapping, replayed from REAL
 * ADK 2.4.0 events recorded by scripts/qualify-adk.ts (gemini-3.5-flash main,
 * gemini-3.5-flash-lite helpers). No network: start() paths exercised here fail
 * before any model request.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import type { Event } from "@google/adk";
import type { EngineEventDraft, HandoffPacket, NodeToolDefinition, RunSpec } from "../src/contract.js";
import { createFakeHost } from "../src/testing/fakeHost.js";
import { NodeToolset, UsageMeter, createAdkTranslator, createGoogleAdkAdapter, renderHandoff } from "../src/engines/googleAdk.js";

interface Recorded {
  run: "main" | "interrupt" | "resume";
  agentId?: string;
  event: Event;
}
const fixture: Recorded[] = readFileSync(new URL("./fixtures/google-adk-native.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Recorded);

const FAMILIES: Record<string, string> = {
  update_goals: "goals",
  search_tools: "tool-meta",
  load_tool: "tool-meta",
  word_count: "workspace",
  activate_line_stats_skill: "skills",
};

function replay(run: Recorded["run"] | Recorded[], skillSha = (n: string) => (n === "word-stats" ? "a".repeat(64) : undefined)) {
  const events: EngineEventDraft[] = [];
  let clock = 1_000;
  const t = createAdkTranslator({ emit: (e) => events.push(e), familyOf: (n) => FAMILIES[n], skillSha, now: () => (clock += 5) });
  const rows = Array.isArray(run) ? run : fixture.filter((r) => r.run === run);
  for (const r of rows) t.onEvent(r.event, r.agentId);
  return { events, t, rows };
}
const ofType = <T extends EngineEventDraft["type"]>(events: EngineEventDraft[], type: T) =>
  events.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === type);

describe("analyst asks ADK to count words in two notes with concurrent helpers (recorded run)", () => {
  const { events, t, rows } = replay("main");

  it("pairs a tool.call and a tool.result for every native function call, main and helper", () => {
    const nativeCalls = rows.flatMap((r) => (r.event.content?.parts ?? []).filter((p) => p.functionCall && !r.event.partial).map((p) => p.functionCall!.id));
    const calls = ofType(events, "tool.call");
    const results = ofType(events, "tool.result");
    assert.equal(calls.length, nativeCalls.length);
    assert.deepEqual(calls.map((c) => c.callId).sort(), [...nativeCalls].sort());
    assert.deepEqual(results.map((r) => r.callId).sort(), [...nativeCalls].sort());
    assert.ok(results.every((r) => r.ok && typeof r.ms === "number"), "recorded run had no failed tools");
  });

  it("attributes helper tool calls and messages to stable helper ids, never to the main agent", () => {
    const helperCalls = ofType(events, "tool.call").filter((c) => c.agentId);
    assert.deepEqual(helperCalls.map((c) => [c.agentId, c.name]).sort(), [
      ["call_447930.h1", "word_count"],
      ["call_447930.h2", "word_count"],
    ]);
    assert.equal(helperCalls[0].family, "workspace");
    assert.equal(helperCalls[0].native, false);
    const helperMessages = ofType(events, "message").filter((m) => m.agentId);
    assert.equal(helperMessages.length, 2);
    assert.match(t.lastText("call_447930.h1"), /137/);
    assert.match(t.lastText("call_447930.h2"), /89/);
  });

  it("marks ADK-owned tools native and Node tools by family", () => {
    const byName = new Map(ofType(events, "tool.call").map((c) => [c.name, c]));
    assert.equal(byName.get("run_helpers")?.native, true);
    assert.equal(byName.get("run_helpers")?.family, "native");
    assert.equal(byName.get("load_skill")?.native, true);
    assert.equal(byName.get("search_tools")?.family, "tool-meta");
    assert.equal(byName.get("update_goals")?.native, false);
  });

  it("reports the native skill load with the Node-computed SKILL.md hash", () => {
    assert.deepEqual(ofType(events, "skill.loaded"), [{ type: "skill.loaded", name: "word-stats", sha256: "a".repeat(64), via: "native", agentId: undefined }]);
  });

  it("turns each CompactedEvent into context.compacted with the prompt size that triggered it", () => {
    const compacted = ofType(events, "context.compacted");
    assert.deepEqual(
      compacted.map((c) => [c.trigger, c.preTokens]),
      [
        ["auto", 1806],
        ["auto", 1977],
      ],
    );
    const nativeIds = rows.filter((r) => (r.event as { isCompacted?: boolean }).isCompacted).map((r) => r.event.id);
    assert.deepEqual(compacted.map((c) => c.nativeRef), nativeIds);
  });

  it("streams main-agent deltas only, and reports context usage once per finished model call", () => {
    const deltas = ofType(events, "message.delta");
    assert.equal(deltas.length, rows.filter((r) => r.event.partial).length);
    assert.ok(deltas.every((d) => d.text.length > 0));
    const finished = rows.filter((r) => r.event.finishReason && r.event.usageMetadata?.promptTokenCount !== undefined).length;
    assert.equal(ofType(events, "context.usage").length, finished);
    assert.ok(ofType(events, "context.usage").every((u) => !u.estimated && u.usedTokens > 0));
    assert.match(t.lastText(), /226/, "main final text carries the total");
    assert.equal(t.lastError(), undefined);
    assert.equal(ofType(events, "engine.raw").length, 0, "every recorded main-run event was translated");
  });
});

describe("user interrupts a streaming answer, then resumes the same ADK session (recorded runs)", () => {
  it("records the native INVOCATION_ABORTED seal as an error and keeps no final text", () => {
    const { events, t } = replay("interrupt");
    assert.equal(ofType(events, "message").length, 0);
    assert.ok(ofType(events, "message.delta").length > 0);
    assert.match(t.lastError() ?? "", /^INVOCATION_ABORTED/);
    assert.equal(ofType(events, "engine.raw")[0]?.nativeType, "model-error");
    assert.equal(t.lastText(), "");
  });

  it("projects list_skills after a mid-run activation as a native skill search with both skills", () => {
    const { events } = replay("resume");
    assert.deepEqual(ofType(events, "skill.search").map((s) => [s.via, s.results]), [["native", ["line-stats", "word-stats"]]]);
    assert.ok(ofType(events, "tool.call").some((c) => c.name === "activate_line_stats_skill" && c.family === "skills"));
  });
});

describe("adversarial and degraded native events", () => {
  const ev = (over: Partial<Event>): Event =>
    ({ id: "e1", invocationId: "i1", author: "nodeagent_main", timestamp: 1, actions: { stateDelta: {}, artifactDelta: {}, requestedAuthConfigs: {}, requestedToolConfirmations: {} }, ...over }) as Event;

  it("marks a tool error response failed and never throws on empty or odd events", () => {
    const { events } = replay([
      { run: "main", event: ev({ content: { role: "model", parts: [{ functionCall: { name: "word_count", args: { path: "../etc" } } }] } }) },
      { run: "main", event: ev({ id: "e2", content: { role: "user", parts: [{ functionResponse: { name: "word_count", response: { error: "outside the workspace" } } }] } }) },
      { run: "main", event: ev({ id: "e3" }) },
      { run: "main", event: ev({ id: "e4", content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: "x".repeat(20_000) } }] } }) },
      { run: "main", event: ev({ id: "e5", actions: { stateDelta: {}, artifactDelta: {}, requestedAuthConfigs: {}, requestedToolConfirmations: {}, transferToAgent: "other" } }) },
    ]);
    const call = ofType(events, "tool.call")[0];
    const result = ofType(events, "tool.result")[0];
    assert.equal(call.callId, "e1:word_count", "id-less call gets a deterministic synthetic id");
    assert.equal(result.callId, "e2:word_count");
    assert.equal(result.ok, false);
    assert.equal(result.preview, "outside the workspace");
    const raws = ofType(events, "engine.raw");
    assert.deepEqual(raws.map((r) => r.nativeType), ["event/no-content", "part", "actions"]);
    assert.ok(raws.every((r) => r.payload.length < 4200), "raw payloads are capped near 4KB");
  });

  it("stays bounded under a long agent loop of calls that never get responses", () => {
    const rows: Recorded[] = [];
    for (let i = 0; i < 5_000; i++) rows.push({ run: "main", event: ev({ id: `c${i}`, content: { role: "model", parts: [{ functionCall: { id: `id${i}`, name: "word_count", args: {} } }] } }) });
    rows.push({ run: "main", event: ev({ id: "r0", content: { role: "user", parts: [{ functionResponse: { id: "id0", name: "word_count", response: { result: "late" } } }] } }) });
    rows.push({ run: "main", event: ev({ id: "r1", content: { role: "user", parts: [{ functionResponse: { id: "id4999", name: "word_count", response: { result: "fresh" } } }] } }) });
    const results = ofType(replay(rows).events, "tool.result");
    assert.equal(results[0].ms, undefined, "the oldest call was evicted, so its duration is unknown rather than invented");
    assert.equal(typeof results[1].ms, "number");
  });
});

describe("usage and cost stay honest", () => {
  it("subtracts Google's cached tokens from input and prices a fully priced run", () => {
    const m = new UsageMeter();
    m.record("gemini-3.5-flash-lite", { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 100, thoughtsTokenCount: 50 });
    m.record("gemini-3.5-flash-lite", undefined);
    const u = m.totals();
    assert.deepEqual([u.inputTokens, u.cacheReadTokens, u.outputTokens, u.modelTurns], [600, 400, 150, 2]);
    assert.equal(u.costSource, "price-table");
    assert.ok(u.costUsd !== null && u.costUsd > 0);
  });

  it("reports null cost, never 0, when any model used has no verified price", () => {
    const m = new UsageMeter();
    m.record("gemini-3.5-flash-lite", { promptTokenCount: 10, candidatesTokenCount: 1 });
    m.record("gemini-3.5-flash", { promptTokenCount: 10, candidatesTokenCount: 1 });
    assert.equal(m.totals().costUsd, null);
    assert.equal(m.totals().costSource, "unknown");
    assert.equal(new UsageMeter().totals().costUsd, null, "no model calls is unknown cost, not free");
  });
});

describe("deferred Node tools become callable only through load_tool", () => {
  const ws = mkdtempSync(join(tmpdir(), "adk-tools-"));
  const seen: Array<string | undefined> = [];
  const tools: NodeToolDefinition[] = [
    {
      name: "load_tool",
      family: "tool-meta",
      risk: "read",
      alwaysLoad: true,
      description: "load",
      schema: z.object({ names: z.array(z.string()) }),
      async execute({ names }, ctx) {
        seen.push(ctx.agentId);
        const known = (names as string[]).filter((n) => n === "word_count");
        return known.length ? { ok: true, content: "loaded", data: { loaded: [...known, "not_in_catalog"] } } : { ok: false, content: "unknown" };
      },
    },
    { name: "word_count", family: "workspace", risk: "read", description: "count", schema: z.object({ path: z.string() }), execute: async () => ({ ok: false, content: "no file" }) },
  ];
  const host = createFakeHost({ env: {}, stateDir: join(ws, "state"), workspaceDir: ws, tools });
  const st = { host, loaded: new Set<string>() };
  const ctx = (id: string) => ({ toolContext: { functionCallId: id } }) as never;
  const names = async (ts: NodeToolset) => (await ts.getTools()).map((t) => t.name);

  it("hides deferred tools, ignores failed loads and unknown names, then exposes the loaded tool to helpers too", async () => {
    const main = new NodeToolset(tools, st);
    const helper = new NodeToolset(tools, st, "call_1.h1");
    assert.deepEqual(await names(main), ["load_tool"]);
    const [load] = await main.getTools();
    assert.deepEqual(await load.runAsync({ args: { names: ["nope"] }, ...ctx("c1") }), { error: "unknown" });
    assert.deepEqual(await names(main), ["load_tool"]);
    await load.runAsync({ args: { names: ["word_count"] }, ...ctx("c2") });
    assert.deepEqual(await names(main), ["load_tool", "word_count"]);
    assert.deepEqual([...st.loaded], ["word_count"], "names Node does not know are never activated");
    assert.deepEqual(await names(helper), ["load_tool", "word_count"]);
    const helperLoad = (await helper.getTools())[0];
    await helperLoad.runAsync({ args: { names: ["word_count"] }, ...ctx("c3") });
    assert.deepEqual(seen, [undefined, undefined, "call_1.h1"], "helper calls reach the gateway under the helper id");
    const decl = (await main.getTools())[1]._getDeclaration() as { parametersJsonSchema: Record<string, unknown> };
    assert.equal("$schema" in decl.parametersJsonSchema, false);
    assert.deepEqual(decl.parametersJsonSchema.required, ["path"]);
  });
});

describe("handoff and setup are honest", () => {
  const packet: HandoffPacket = {
    schema: "nodeagent.handoff/v1",
    fromRunId: "run-7",
    fromEngine: "claude-agent-sdk",
    originalPrompt: "Build the table",
    goals: [{ id: "g1", title: "draft table", status: "done", claimedBy: "engine" }],
    artifacts: [{ path: "out/table.csv", sha256: "0123456789abcdef".repeat(4), bytes: 42 }],
    checks: [{ checkId: "chk-1", command: "npm test", ok: false, summary: "1 failed" }],
    lastSummary: "Drafted the table.",
    unresolved: ["write of out/notes.md not confirmed"],
    createdAt: "2026-10-29T00:00:00Z",
  };

  it("renders goals, artifact hashes, checks and unresolved work, flagging engine claims", () => {
    const text = renderHandoff(packet);
    assert.match(text, /claude-agent-sdk run run-7/);
    assert.match(text, /\[done, engine-claimed\] draft table/);
    assert.match(text, /out\/table\.csv sha256:0123456789ab \(42 bytes\)/);
    assert.match(text, /chk-1 FAILED: 1 failed/);
    assert.match(text, /write of out\/notes\.md not confirmed/);
  });

  const spec = (over: Partial<RunSpec>): RunSpec => ({
    runId: "r1",
    projectId: "p1",
    workspaceDir: mkdtempSync(join(tmpdir(), "adk-ws-")),
    prompt: "hi",
    model: "gemini-3.5-flash",
    budget: {},
    context: {},
    ...over,
  });
  const start = (env: { googleApiKey?: string }, over: Partial<RunSpec> = {}) => {
    const s = spec(over);
    const host = createFakeHost({ env, stateDir: join(s.workspaceDir, "..", `state-${Math.random()}`), workspaceDir: s.workspaceDir });
    return { done: createGoogleAdkAdapter().start(s, host).done, host };
  };

  it("reports the installed SDK version and a missing key as setup gaps, without a paid call", async () => {
    const a = createGoogleAdkAdapter();
    assert.equal(a.descriptor().sdk.version, "2.4.0");
    assert.equal(a.descriptor().capabilities.permissions.status, "UNTESTED");
    const av = await a.availability({});
    assert.equal(av.ok, false);
    assert.match(av.missing.join(" "), /GOOGLE_GENERATIVE_AI_API_KEY/);
    const { done } = start({});
    const out = await done;
    assert.equal(out.status, "failed");
    assert.equal(out.usage.costUsd, null);
  });

  it("fails a resume of an unknown or path-traversing session id instead of starting fresh", async () => {
    const missing = await start({ googleApiKey: "not-a-real-key" }, { resume: { nativeSessionId: "0f0f0f0f-0000-4000-8000-000000000000" } }).done;
    assert.equal(missing.status, "failed");
    assert.match(missing.error ?? "", /no snapshot/);
    const hostile = start({ googleApiKey: "not-a-real-key" }, { resume: { nativeSessionId: "../../etc/passwd" } });
    const out = await hostile.done;
    assert.equal(out.status, "failed");
    assert.match(out.error ?? "", /Invalid ADK session id/);
    assert.equal(ofType(hostile.host.events, "run.started").length, 0, "no run.started for a run that never began");
  });
});
