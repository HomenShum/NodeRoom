/**
 * Codex app-server -> contract event mapping, replayed from REAL native
 * messages recorded by scripts/qualify-codex.ts (test/fixtures/codex-native.jsonl,
 * pinned @openai/codex 0.165.0, paths and ids scrubbed). No network, no binary.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EngineEventDraft } from "../src/contract.js";
import { splitCommand } from "../src/engines/codex.js";
import { createTranslator } from "../src/engines/codex/translate.js";
import type { RpcMessage } from "../src/engines/codex/rpc.js";
import { createPolicy } from "../src/policy.js";

type Line = RpcMessage & { run: string };
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "codex-native.jsonl");
const lines: Line[] = readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const SKILL = "<QUAL>\\ws\\.claude\\skills\\word-stats\\SKILL.md";
const FAMILIES: Record<string, string> = { word_count: "workspace", list_files: "workspace", search_tools: "tool-meta", load_tool: "tool-meta", call_tool: "tool-meta" };

/** Replays one recorded run the way codex.ts drives the translator. */
function replay(run: string, model = "gpt-5.4-mini") {
  const tr = createTranslator({ model, familyOf: (n) => FAMILIES[n], skills: () => [{ name: "word-stats", path: SKILL }], hashFile: () => "f".repeat(64) });
  const events: EngineEventDraft[] = [];
  for (const m of lines.filter((l) => l.run === run)) {
    if (m.result?.thread?.id && !tr.mainThreadId) tr.setMainThread(m.result.thread.id);
    else if (m.result?.turn?.id && !tr.mainTurnId) tr.setMainTurn(m.result.turn.id);
    else if (m.method && m.id === undefined) events.push(...tr.handle(m));
  }
  return { tr, events, of: <T extends EngineEventDraft["type"]>(type: T) => events.filter((e): e is Extract<EngineEventDraft, { type: T }> => e.type === type) };
}

test("analyst delegates to two helpers: every child event carries the helper's stable id", () => {
  const { of, events } = replay("main");
  const started = of("helper.started");
  assert.equal(started.length, 2, "two spawn_agent children");
  const ids = started.map((h) => h.helperId);
  assert.equal(new Set(ids).size, 2);
  for (const h of started) {
    assert.equal(h.parentId, undefined, "spawned by the main agent");
    assert.equal(h.model, "gpt-5.4-mini", "children inherited the run model");
    assert.ok(h.description.length > 0);
  }
  // Concurrency: both helpers started before either completed.
  const firstDone = events.findIndex((e) => e.type === "helper.completed");
  assert.ok(events.findIndex((e) => e.type === "helper.started" && e.helperId === ids[1]) < firstDone);
  const done = of("helper.completed");
  assert.deepEqual(done.map((d) => d.helperId).sort(), [...ids].sort());
  assert.ok(done.every((d) => d.status === "completed" && typeof d.durationMs === "number"));
  // Child tool calls are attributed to the helper, never to the main agent.
  const childCalls = of("tool.call").filter((c) => c.agentId);
  assert.ok(childCalls.length >= 2);
  assert.ok(childCalls.every((c) => ids.includes(c.agentId!)));
  assert.ok(of("helper.progress").every((p) => ids.includes(p.helperId)));
  // Child usage is reported under the helper id.
  assert.deepEqual(of("usage").map((u) => u.agentId).sort(), [...ids].sort());
});

test("every observed tool call gets exactly one result with the same callId and scope", () => {
  const { of } = replay("main");
  const calls = of("tool.call");
  const results = of("tool.result");
  assert.ok(calls.length >= 10);
  assert.equal(new Set(calls.map((c) => c.callId)).size, calls.length, "callIds are unique");
  for (const r of results) {
    const c = calls.find((x) => x.callId === r.callId);
    assert.ok(c, `result ${r.callId} has a call`);
    assert.equal(r.agentId, c!.agentId);
  }
  assert.equal(results.length, calls.length);
  // Node tools are not native; shell and collab tools are.
  assert.ok(calls.filter((c) => ["search_tools", "load_tool", "word_count"].includes(c.name)).every((c) => !c.native && c.family !== "native"));
  assert.ok(calls.filter((c) => c.name === "shell" || c.name === "spawn_agent").every((c) => c.native));
  // The deferred tool was reached through the app-implemented proxy and shows its real name.
  const wc = calls.find((c) => c.name === "word_count");
  assert.ok(wc && wc.family === "workspace" && wc.inputPreview.includes("notes.txt"));
  assert.ok(results.find((r) => r.callId === wc.callId)?.preview.includes("words"));
});

test("policy-declined shell commands surface as failed results, not successes", () => {
  const { of } = replay("main");
  const declined = of("tool.result").filter((r) => r.preview.includes("declined by Node policy"));
  assert.ok(declined.length >= 1, "echo hi > out.txt was declined");
  assert.ok(declined.every((r) => r.ok === false));
});

test("auto-compaction is reported once with native ref and honest token counts", () => {
  const { of } = replay("main");
  const [c, ...rest] = of("context.compacted");
  assert.equal(rest.length, 0);
  assert.equal(c.trigger, "auto");
  assert.ok(c.nativeRef && c.preTokens > 11_000 && c.postTokens! < c.preTokens, `${c.preTokens} -> ${c.postTokens}`);
  assert.deepEqual(of("run.status").map((s) => s.status), ["compacting", "running"]);
  // After compaction Codex reports the rebuilt context with zero request tokens: flagged as estimated.
  assert.ok(of("context.usage").some((u) => u.estimated));
  assert.ok(of("context.usage").every((u) => u.windowTokens === undefined || u.windowTokens > 0));
});

test("goal ticks are deduplicated: one goals.updated per status change, not per token tick", () => {
  const { of } = replay("main");
  const raw = lines.filter((l) => l.run === "main" && l.method === "thread/goal/updated").length;
  const goals = of("goals.updated");
  assert.ok(goals.length >= 1 && goals.length < raw, `${goals.length} < ${raw}`);
  assert.ok(goals.every((g) => g.source === "codex:goal" && g.goals.every((x) => x.claimedBy === "engine")));
});

test("skill load is observed only from a successful SKILL.md read, once, with Node's hash", () => {
  const { of } = replay("main");
  const loads = of("skill.loaded");
  assert.equal(loads.length, 1);
  assert.deepEqual({ name: loads[0].name, via: loads[0].via, sha: loads[0].sha256?.length }, { name: "word-stats", via: "native", sha: 64 });
  // A policy-declined or failing read loaded nothing into the model's context.
  const tr = createTranslator({ model: "gpt-5.4-mini", familyOf: () => undefined, skills: () => [{ name: "word-stats", path: SKILL }] });
  tr.setMainThread("m");
  const read = (id: string, status: string, exitCode: number | null) =>
    tr.handle({ method: "item/completed", params: { threadId: "m", item: { type: "commandExecution", id, command: "powershell -Command 'cat .claude/skills/word-stats/SKILL.md'", status, exitCode, commandActions: [] } } });
  assert.ok(![...read("a", "declined", null), ...read("b", "failed", 1)].some((e) => e.type === "skill.loaded"));
  assert.equal(read("c", "completed", 0).filter((e) => e.type === "skill.loaded").length, 1);
});

test("usage subtracts cached and cache-write tokens from input and prices per thread", () => {
  const { tr } = replay("main");
  const raws = lines.filter((l) => l.run === "main" && l.method === "rawResponse/completed").map((l) => l.params.usage);
  const sum = (k: string) => raws.reduce((s, u) => s + u[k], 0);
  const u = tr.usage();
  assert.equal(u.modelTurns, raws.length);
  assert.equal(u.cacheReadTokens, sum("cachedInputTokens"));
  assert.equal(u.inputTokens, sum("inputTokens") - sum("cachedInputTokens") - sum("cacheWriteInputTokens"));
  assert.equal(u.outputTokens, sum("outputTokens"));
  assert.equal(u.costSource, "price-table");
  assert.ok(u.costUsd !== null && u.costUsd > 0);
  assert.ok(tr.mainTurn?.status === "completed" && tr.finalText.includes("8"));
  // Cache writes are also inside OpenAI input (real helper request from an earlier qualification run).
  const w = createTranslator({ model: "gpt-5.4-mini", familyOf: () => undefined, skills: () => [] });
  w.handle({ method: "rawResponse/completed", params: { threadId: "t", usage: { totalTokens: 9162, inputTokens: 9120, cachedInputTokens: 0, cacheWriteInputTokens: 9117, outputTokens: 42 } } });
  assert.deepEqual([w.usage().inputTokens, w.usage().cacheWriteTokens, w.usage().outputTokens], [3, 9117, 42]);
});

test("an unpriced model keeps cost unknown (null), never 0", () => {
  const { tr } = replay("main", "gpt-unlisted-model");
  // Helpers were priced from their own spawn model; the main thread's model is unknown.
  assert.equal(tr.usage().costUsd, null);
  assert.equal(tr.usage().costSource, "unknown");
  const empty = createTranslator({ model: "gpt-5.4-mini", familyOf: () => undefined, skills: () => [] });
  assert.equal(empty.usage().costUsd, null, "no usage observed is unknown, not free");
});

test("user interrupts mid-stream: turn ends interrupted and the unfinished reply is not invented", () => {
  const { tr, of } = replay("interrupt");
  assert.equal(tr.mainTurn?.status, "interrupted");
  // The agentMessage item started but never completed: no assistant message, no final text.
  assert.equal(of("message").length, 0);
  assert.equal(tr.finalText, "");
  assert.equal(tr.usage().costUsd, null, "the in-flight request never reported usage");
  // Deltas that did arrive are main-agent text only.
  const main = replay("main");
  assert.ok(main.of("message.delta").length >= 1 && main.of("message.delta").every((d) => !("agentId" in d)));
});

test("native tool_search on a catalog model maps to search + load + a non-native Node call", () => {
  const { of } = replay("native-search", "gpt-5.5");
  const searches = of("tool.search");
  assert.ok(searches.length >= 1 && searches.every((s) => s.via === "native" && s.query.length > 0));
  assert.ok(searches.some((s) => s.results.includes("word_count")));
  assert.ok(of("tool.loaded").every((l) => l.via === "native-tool-search"));
  const call = of("tool.call").find((c) => c.name === "word_count");
  assert.ok(call && !call.native);
  assert.ok(of("tool.call").some((c) => c.name === "tool_search" && c.native));
});

test("resumed thread without raw events counts only this run's token deltas", () => {
  const tr = createTranslator({ model: "gpt-5.4-mini", familyOf: () => undefined, skills: () => [] });
  tr.setMainThread("t");
  const tick = (input: number, cached: number, output: number, lastIn: number, lastOut: number) =>
    tr.handle({ method: "thread/tokenUsage/updated", params: { threadId: "t", tokenUsage: { total: { inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: 0, outputTokens: output, totalTokens: input + output }, last: { inputTokens: lastIn, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: lastOut, totalTokens: lastIn + lastOut }, modelContextWindow: 272000 } } });
  tick(500_000, 400_000, 9_000, 8_000, 20); // history of 60 earlier requests + this run's first
  tick(509_000, 408_000, 9_050, 9_000, 50);
  const u = tr.usage();
  assert.equal(u.modelTurns, 2);
  assert.equal(u.outputTokens, 70, "20 from the first `last`, 50 from the delta");
  assert.equal(u.inputTokens + u.cacheReadTokens, 17_000);
  // Replayed resume run: one request, not the thread's lifetime totals.
  const resume = replay("resume");
  assert.equal(resume.tr.usage().modelTurns, 1);
  assert.ok(resume.tr.usage().inputTokens + resume.tr.usage().cacheReadTokens < 20_000);
  assert.deepEqual(resume.of("goals.updated").map((g) => g.goals.length), [0], "goal cleared on resume");
});

test("adversarial native input: unknown, empty and oversized messages never throw or fabricate", () => {
  const tr = createTranslator({ model: "gpt-5.4-mini", familyOf: () => undefined, skills: () => [] });
  tr.setMainThread("main");
  assert.deepEqual(tr.handle({}), []);
  assert.deepEqual(tr.handle({ method: "item/started" }), []);
  assert.deepEqual(tr.handle({ method: "item/completed", params: {} }), []);
  const [raw] = tr.handle({ method: "future/notification", params: { blob: "x".repeat(50_000) } });
  assert.equal(raw.type, "engine.raw");
  assert.ok(raw.type === "engine.raw" && raw.payload.length < 4_100);
  // A child thread's events before any spawn reports it: attributed, but no helper is invented.
  const out = tr.handle({ method: "item/completed", params: { threadId: "ghost", item: { type: "commandExecution", id: "c1", command: "ls", status: "completed", exitCode: 0, aggregatedOutput: "" } } });
  assert.ok(out.every((e) => e.type !== "helper.started" && e.type !== "helper.progress"));
  assert.ok(out.some((e) => e.type === "tool.call" && e.agentId === "ghost"));
  // Helpers still running at shutdown are stopped, never completed.
  tr.handle({ method: "item/completed", params: { threadId: "main", item: { type: "collabAgentToolCall", id: "s1", tool: "spawnAgent", status: "completed", senderThreadId: "main", receiverThreadIds: ["kid"], prompt: "p", model: "gpt-5.4-mini" } } });
  const stopped = tr.stopUnfinishedHelpers("run ended");
  assert.deepEqual(stopped.map((e) => e.type === "helper.completed" && e.status), ["stopped"]);
  assert.deepEqual(tr.stopUnfinishedHelpers("again"), []);
  // Bounded: thousands of unmatched tool starts do not grow without limit or throw.
  for (let i = 0; i < 5_000; i++) tr.handle({ method: "item/started", params: { threadId: "main", item: { type: "commandExecution", id: `x${i}`, command: "ls" } } });
});

test("Codex shell strings become argv that Node policy can judge", () => {
  const ps = String.raw`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"`;
  assert.deepEqual(splitCommand(`${ps} -Command 'cat notes.txt'`).slice(1), ["-Command", "cat notes.txt"]);
  const ws = dirname(FIXTURE);
  const policy = createPolicy({ workspaceDir: ws, template: { id: "t", title: "", description: "", restrictedGlobs: ["secrets/**"], checks: {} } });
  const check = (inner: string) => policy.checkNativeTool("commandExecution", { command: splitCommand(`${ps} -Command '${inner}'`), cwd: ws }, {});
  assert.equal(check("cat codex-native.jsonl").allow, true);
  assert.equal(check("echo hi > out.txt").allow, false);
  assert.equal(check("Get-Content notes.txt | Select-Object -First 1").allow, false);
  assert.equal(check("cat secrets/key.txt").allow, false);
  assert.equal(check("cat ../../package.json").allow, false);
});
