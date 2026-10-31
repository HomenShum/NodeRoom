/**
 * Scenario tests for the workspace view reducer. Persona: an analyst watching a
 * long diligence run in the browser while the SSE stream drops and replays.
 * Every assertion is about what the UI is allowed to claim from real events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NODE_AGENT_EVENT_SCHEMA, type EngineEventBody, type NodeAgentEvent } from "../src/contract.js";
import {
  VIEW_LIMITS,
  buildHelperTree,
  emptyRunView,
  groupSummaryText,
  independentChecks,
  reduceRunEvents,
  skillStages,
  summarizeGroup,
  type GroupEntry,
  type ToolItem,
} from "../src/react/eventReducer.js";

const RUN = "run_test";
function log(bodies: EngineEventBody[], start = 1): NodeAgentEvent[] {
  return bodies.map((b, i) => ({ ...b, schema: NODE_AGENT_EVENT_SCHEMA, runId: RUN, seq: start + i, ts: new Date(Date.UTC(2026, 9, 29, 0, 0, start + i)).toISOString() }) as NodeAgentEvent);
}
const started: EngineEventBody = { type: "run.started", engine: "claude-agent-sdk", model: "claude-sonnet-5-5", sdkVersion: "0.3.312", cwd: "/ws", tools: ["Read"], skills: [], nativeSessionId: "sess-1" };
const groups = (v: ReturnType<typeof emptyRunView>) => v.timeline.filter((t): t is GroupEntry => t.kind === "group");
const tools = (v: ReturnType<typeof emptyRunView>) => groups(v).flatMap((g) => g.items.filter((i): i is ToolItem => i.kind === "tool"));

const diligence = log([
  started,
  { type: "tool.call", callId: "c1", name: "Read", family: "native", native: true, inputPreview: '{"file_path":"sources/acme-10k.md"}' },
  { type: "tool.result", callId: "c1", ok: true, preview: "ACME revenue...", ms: 12 },
  { type: "tool.call", callId: "c2", name: "mcp__node__read_source", family: "sources", native: false, inputPreview: '{"path":"sources/beta-10k.md"}' },
  { type: "tool.result", callId: "c2", ok: true, preview: "BETA revenue...", ms: 9 },
  { type: "artifact.written", path: "analysis/comparison.md", kind: "table", bytes: 2048, sha256: "a".repeat(64), change: "created" },
  { type: "message", role: "assistant", text: "Drafted the comparison table." },
  { type: "usage", totals: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, costSource: "unknown", modelTurns: 2 } },
  { type: "run.completed", finalText: "Drafted the comparison table.", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, costSource: "unknown", modelTurns: 2 } },
]);

test("reconnect replay: events re-sent after Last-Event-ID resume are applied once", () => {
  // The first connection delivered 1..6, dropped; the reconnect replays 4..9.
  const first = reduceRunEvents(diligence.slice(0, 6));
  const resumed = reduceRunEvents(diligence.slice(3), first);
  const once = reduceRunEvents(diligence);
  assert.equal(resumed.duplicates, 3);
  assert.equal(resumed.eventCount, diligence.length);
  assert.equal(tools(resumed).length, 2, "two tool calls, not four");
  assert.equal(resumed.artifacts.length, 1);
  assert.equal(resumed.artifacts[0].writes, 1);
  assert.deepEqual({ ...resumed, duplicates: 0 }, { ...once, duplicates: 0 });
});

test("duplicate events by seq inside one batch do not double count", () => {
  const doubled = diligence.flatMap((e) => [e, e]);
  const v = reduceRunEvents(doubled);
  assert.equal(v.eventCount, diligence.length);
  assert.equal(v.duplicates, diligence.length);
  const s = summarizeGroup(groups(v)[0]);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.filesRead, 2);
  assert.equal(s.written, 1);
  assert.equal(groupSummaryText(s), "2 tool calls · 2 files read · 1 written");
});

test("incremental folding is pure: the previous view is never mutated", () => {
  const first = reduceRunEvents(diligence.slice(0, 3));
  const snapshot = JSON.stringify(first);
  const next = reduceRunEvents(diligence.slice(3), first);
  assert.equal(JSON.stringify(first), snapshot);
  assert.notEqual(next.timeline, first.timeline);
  assert.equal(tools(first)[0].status, "ok");
});

test("unknown cost stays null; completed run closes its groups", () => {
  const v = reduceRunEvents(diligence);
  assert.equal(v.usage?.costUsd, null);
  assert.equal(v.terminal?.status, "completed");
  assert.ok(groups(v).every((g) => g.closed));
  assert.equal(v.currentAction, "Finished");
  assert.equal(v.nativeSessionId, "sess-1");
});

test("helper nesting: grandchildren nest under their parent, tool calls attribute by agentId", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "helper.started", helperId: "h-a", description: "Research ACME", subagentType: "researcher", model: "claude-haiku-5-5" },
      { type: "helper.started", helperId: "h-b", description: "Research BETA" },
      { type: "helper.started", helperId: "h-a1", parentId: "h-a", description: "Check ACME filings" },
      { type: "tool.call", callId: "x1", name: "Read", family: "native", native: true, inputPreview: '{"file_path":"sources/acme.md"}', agentId: "h-a1" },
      { type: "helper.progress", helperId: "h-a", summary: "Reading filings", toolUses: 3, totalTokens: 4200 },
      { type: "tool.result", callId: "x1", ok: true, preview: "...", agentId: "h-a1" },
      { type: "helper.completed", helperId: "h-a1", status: "completed", summary: "Filings checked", toolUses: 1 },
      { type: "helper.completed", helperId: "h-b", status: "failed", summary: "Source missing" },
      // Adversarial: progress for a helper that never started is ignored, not invented.
      { type: "helper.progress", helperId: "ghost", summary: "?" },
    ]),
  );
  const tree = buildHelperTree(v.helpers);
  assert.deepEqual(tree.map((n) => n.helper.helperId), ["h-a", "h-b"]);
  assert.deepEqual(tree[0].children.map((n) => n.helper.helperId), ["h-a1"]);
  const a = v.helpers.find((h) => h.helperId === "h-a")!;
  assert.equal(a.status, "running");
  assert.equal(a.toolUses, 3);
  assert.equal(a.totalTokens, 4200);
  const a1 = v.helpers.find((h) => h.helperId === "h-a1")!;
  assert.equal(a1.observedToolCalls, 1);
  assert.equal(a1.status, "completed");
  assert.equal(v.helpers.find((h) => h.helperId === "h-b")!.status, "failed");
  assert.equal(v.helpers.length, 3);
  // The helper's tool call lives in the helper's own group, closed when it completed.
  const helperGroup = groups(v).find((g) => g.agentId === "h-a1")!;
  assert.equal(helperGroup.closed, true);
  assert.equal((helperGroup.items[0] as ToolItem).status, "ok");
});

test("helper parent cycle does not hide helpers", () => {
  const v = reduceRunEvents(log([
    { type: "helper.started", helperId: "p", parentId: "q", description: "P" },
    { type: "helper.started", helperId: "q", parentId: "p", description: "Q" },
  ]));
  const tree = buildHelperTree(v.helpers);
  const count = (ns: ReturnType<typeof buildHelperTree>): number => ns.reduce((n, x) => n + 1 + count(x.children), 0);
  assert.equal(count(tree), 2);
});

test("compaction marker records pre/post tokens and trigger; unknown post stays undefined", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "context.usage", usedTokens: 182_000, windowTokens: 200_000, estimated: false },
      { type: "tool.call", callId: "c1", name: "Grep", family: "native", native: true, inputPreview: "{}" },
      { type: "run.status", status: "compacting" },
      { type: "context.compacted", trigger: "auto", preTokens: 182_000, postTokens: 31_000, nativeRef: "b-1" },
      { type: "context.compacted", trigger: "manual", preTokens: 90_000 },
    ]),
  );
  const marks = v.timeline.filter((t) => t.kind === "compaction");
  assert.equal(marks.length, 2);
  assert.deepEqual(marks.map((m) => m.kind === "compaction" && [m.trigger, m.preTokens, m.postTokens]), [["auto", 182_000, 31_000], ["manual", 90_000, undefined]]);
  assert.equal(v.compactions, 2);
  assert.equal(v.context?.usedTokens, 31_000, "meter follows the post-compaction size when reported");
  assert.equal(groups(v)[0].closed, true, "the pre-compaction turn is closed");
  assert.equal(v.liveStatus, "running");
  assert.match(v.currentAction ?? "", /90k → unknown/);
});

test("claimed vs verified: engine goal claims stay claims; only independent checks verify", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "goals.updated", source: "update_goals", goals: [
        { id: "g1", title: "Build comparison table", status: "done", claimedBy: "engine" },
        { id: "g2", title: "Write memo", status: "active", claimedBy: "engine", dependsOn: ["g1"] },
      ] },
      { type: "check.result", checkId: "citations", command: "check_citations", ok: true, passed: 12, failed: 0, durationMs: 40, outputTail: "", independent: false },
      { type: "check.result", checkId: "verifier", command: "node diligence-pack.verify.mjs", ok: false, passed: 5, failed: 2, durationMs: 900, outputTail: "2 uncited claims", independent: true },
    ]),
  );
  assert.equal(v.goalsClaimedBy, "engine");
  assert.ok(v.goals.every((g) => g.claimedBy === "engine"));
  const verified = independentChecks(v);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].ok, false, "the independent verifier's failure is not masked by the agent's own passing check");
  assert.equal(v.checks.length, 2);
});

test("tool search → load → call is linked on the search card", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "tool.search", query: "notebook", results: ["notebook_add_cell", "read_file"], via: "native" },
      { type: "tool.loaded", names: ["notebook_add_cell"], via: "native-tool-search" },
      { type: "tool.call", callId: "n1", name: "notebook_add_cell", family: "notebook", native: false, inputPreview: '{"path":"analysis/model.ipynb"}' },
      { type: "skill.lifecycle", name: "citation-validation", stage: "drafted", detail: "draft", path: "skill-drafts/citation-validation" },
      { type: "skill.lifecycle", name: "citation-validation", stage: "validated", detail: "ok", path: "skill-drafts/citation-validation" },
      { type: "permission.decision", tool: "Bash", decision: "deny", reason: "exec outside allowlist" },
      { type: "permission.decision", tool: "Read", decision: "allow", reason: "inside workspace" },
    ]),
  );
  const items = groups(v)[0].items;
  const search = items.find((i) => i.kind === "tool-search");
  assert.ok(search && search.kind === "tool-search");
  assert.deepEqual(search.loaded, ["notebook_add_cell"]);
  assert.deepEqual(search.called, ["notebook_add_cell"]);
  assert.deepEqual(skillStages(v).get("citation-validation"), ["drafted", "validated"]);
  assert.equal(items.filter((i) => i.kind === "permission").length, 1, "only denials are timeline items");
  assert.equal(v.permissions.length, 2, "all decisions reach the developer drawer");
});

test("sad paths: orphan results, unfinished tools on failure, seq gaps", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "tool.result", callId: "nope", ok: false, preview: "?" },
      { type: "tool.call", callId: "c9", name: "Bash", family: "native", native: true, inputPreview: '{"command":"npm test"}' },
      { type: "message.delta", text: "Working" },
    ]).concat(log([{ type: "run.failed", error: "provider 529 overloaded" }], 10)),
  );
  assert.equal(v.gaps, 1);
  assert.equal(v.terminal?.status, "failed");
  assert.equal(tools(v)[0].status, "no-result", "a call without a result is not shown as succeeded");
  assert.ok(groups(v)[0].items.some((i) => i.kind === "orphan-result"));
  assert.ok(v.timeline.every((t) => t.kind !== "message" || !t.streaming));
  assert.equal(v.currentAction, "Failed: provider 529 overloaded");
});

test("long run: collections stay bounded under sustained load", () => {
  const bodies: EngineEventBody[] = [started];
  for (let i = 0; i < 3000; i++) {
    bodies.push({ type: "tool.call", callId: `c${i}`, name: "Read", family: "native", native: true, inputPreview: `{"file_path":"f${i}.md"}` });
    bodies.push({ type: "tool.result", callId: `c${i}`, ok: true, preview: "x" });
    if (i % 2 === 0) bodies.push({ type: "message", role: "assistant", text: "step" });
  }
  const all = log(bodies);
  // Apply in SSE-sized batches the way the hook does.
  let v = emptyRunView();
  for (let i = 0; i < all.length; i += 64) v = reduceRunEvents(all.slice(i, i + 64), v);
  assert.equal(v.eventCount, all.length);
  assert.ok(v.timeline.length <= VIEW_LIMITS.timelineEntries);
  assert.ok(v.droppedEntries > 0);
  assert.equal(v.raw.length, VIEW_LIMITS.raw);
  assert.equal(v.raw[v.raw.length - 1].seq, all.length);
  assert.ok(groups(v).every((g) => g.items.length <= VIEW_LIMITS.itemsPerGroup));
});

test("streamed deltas are finalized by the full message, not duplicated", () => {
  const v = reduceRunEvents(
    log([
      started,
      { type: "message.delta", text: "Hel" },
      { type: "message.delta", text: "lo" },
      { type: "message", role: "assistant", text: "Hello." },
      { type: "message", role: "user", text: "Also check BETA." },
    ]),
  );
  const msgs = v.timeline.filter((t) => t.kind === "message");
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map((m) => m.kind === "message" && [m.role, m.text, m.streaming]), [["assistant", "Hello.", false], ["user", "Also check BETA.", false]]);
});
