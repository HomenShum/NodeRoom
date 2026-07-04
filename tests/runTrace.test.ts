/**
 * Run Trace — span assembly + the proof-gated listRunSpans query.
 *
 * Persona: Priya, the eng lead shipping an agentic finance workflow, opens the
 * Trace tab's Runs view after every agent run to answer "what did the agent
 * ACTUALLY do" — which tools, in what order, what failed, what got retried, and
 * what it cost. The span tree must never flatter the run: no invented durations,
 * no green over failed tool calls, no leaking a teammate's private-agent runs.
 *
 * Angles covered:
 *   happy      — a real enrichment run assembles into mission root → kind-grouped
 *                phase spans with measured durations and honest attrs
 *   sad        — failed fetch + later same-tool success = error + retried·ok pair,
 *                propagated to the phase span and the mission root; ok-status rows
 *                whose result payload says ok:false surface as errors (HONEST_STATUS)
 *   honesty    — steps without measured ms render durMs:null ("—" + sequence tick),
 *                never a fabricated bar; memory-mode event spans are points
 *   adversarial— forged proof rejected; a non-owner naming a private runId gets an
 *                empty result, not someone else's span tree
 *   burst      — a 250-step runaway run is bounded at 200 spans with an honest
 *                truncation flag (BOUND)
 *   sustained  — 35 runs of history keep the picker at the newest 10; 600-event
 *                memory sessions stay bounded at 200 events
 *
 * convex-test setup mirrors tests/watches.test.ts (the documented pattern:
 * module glob minus "use node" modules, workflow/workpool components registered,
 * hashToken-seeded members, makeFunctionReference for not-yet-codegen'd refs —
 * codegen must NOT be run casually; against a configured cloud deployment it
 * DEPLOYS schema+functions).
 */
import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib";
import {
  assembleRunSpans,
  deriveSpanKind,
  deriveStepStatus,
  propagateStatus,
  RUN_TRACE_MAX_RUNS,
  RUN_TRACE_MAX_STEPS,
  type RunSpan,
  type RunSpansResult,
  type RunStepInput,
} from "../convex/runTrace";
import {
  buildMemoryRunsFromTraces,
  flattenRunSpans,
  fmtSpanMs,
  runTreeTotalMs,
  spanBarGeometry,
  MEMORY_RUN_MAX_EVENTS,
  MEMORY_RUN_MAX_RUNS,
} from "../src/ui/panels/TraceSurface";
import type { TraceEvent } from "../src/engine/types";
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";

vi.setConfig({ testTimeout: 120_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/dist/component/**/*.js");
// "use node" modules can't load under convex-test (mirrors tests/watches.test.ts).
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

/* ── pure span assembly ────────────────────────────────────────────────────── */

describe("deriveSpanKind — the REAL tool registry maps onto the design's kinds", () => {
  it("classifies reads as context, external evidence as retrieval, writes by surface", () => {
    // context gathering (reads/discovery)
    expect(deriveSpanKind("read_range")).toBe("context");
    expect(deriveSpanKind("read_notebook")).toBe("context");
    expect(deriveSpanKind("list_artifacts")).toBe("context");
    expect(deriveSpanKind("search_sheet_context")).toBe("context");
    // external evidence
    expect(deriveSpanKind("fetch_source")).toBe("retrieval");
    expect(deriveSpanKind("capture_source")).toBe("retrieval");
    expect(deriveSpanKind("sec_facts")).toBe("retrieval");
    expect(deriveSpanKind("tavily_search")).toBe("retrieval");
    expect(deriveSpanKind("you_research")).toBe("retrieval");
    expect(deriveSpanKind("github_profile")).toBe("retrieval");
    expect(deriveSpanKind("cite_in_file")).toBe("retrieval");
    // sheet writes + the lock/draft machinery
    expect(deriveSpanKind("edit_cell")).toBe("spreadsheet");
    expect(deriveSpanKind("write_locked_cells")).toBe("spreadsheet");
    expect(deriveSpanKind("define_columns")).toBe("spreadsheet");
    expect(deriveSpanKind("propose_lock")).toBe("spreadsheet");
    expect(deriveSpanKind("release_lock")).toBe("spreadsheet");
    expect(deriveSpanKind("reconcile_cell")).toBe("spreadsheet");
    // notebook writes
    expect(deriveSpanKind("update_notebook_block")).toBe("notebook");
    expect(deriveSpanKind("append_notebook_outline")).toBe("notebook");
    expect(deriveSpanKind("update_wiki")).toBe("notebook");
    // model-authored work defaults to synthesis
    expect(deriveSpanKind("say")).toBe("synthesis");
    expect(deriveSpanKind("plan_and_dispatch")).toBe("synthesis");
    expect(deriveSpanKind("compute_runway_milestones")).toBe("synthesis");
    // boundaries
    expect(deriveSpanKind("mcp.boundary")).toBe("mcp");
    expect(deriveSpanKind("mcp_fetch")).toBe("mcp");
    expect(deriveSpanKind("privacy_filter")).toBe("privacy");
  });
});

describe("deriveStepStatus — honest, never green over a failure", () => {
  it("maps stored status and the result payload's own ok flag", () => {
    expect(deriveStepStatus("error", undefined)).toBe("error");
    expect(deriveStepStatus("conflict", undefined)).toBe("retry");
    expect(deriveStepStatus("locked", undefined)).toBe("retry");
    expect(deriveStepStatus("ok", JSON.stringify({ ok: true, value: 3 }))).toBe("ok");
    // HONEST_STATUS: a stored "ok" whose payload admits failure is an error
    expect(deriveStepStatus("ok", JSON.stringify({ ok: false, error: "429" }))).toBe("error");
    // malformed / non-JSON results never crash the assembler (adversarial input)
    expect(deriveStepStatus("ok", "not json {{{")).toBe("ok");
    expect(deriveStepStatus("ok", undefined)).toBe("ok");
  });

  it("propagateStatus: unresolved error > retry activity > ok", () => {
    expect(propagateStatus([{ status: "ok" }, { status: "ok" }])).toBe("ok");
    expect(propagateStatus([{ status: "ok" }, { status: "retryok" }])).toBe("retry");
    expect(propagateStatus([{ status: "retry" }, { status: "ok" }])).toBe("retry");
    expect(propagateStatus([{ status: "error" }, { status: "retryok" }])).toBe("error");
    expect(propagateStatus([])).toBe("ok");
  });
});

/** Priya's canonical enrichment run: gather → fetch (one failure + retry) → write. */
const ENRICH_RUN = {
  goal: "Enrich rows 81–120",
  agentId: "room_na",
  model: "deepseek/deepseek-v4-flash",
  steps: 7,
  toolCalls: 7,
  costUsd: 0.14,
  ms: 12_400,
  stopReason: "done",
  exhausted: false,
  idempotencyKey: "run-16-81-120",
};
const ENRICH_STEPS: RunStepInput[] = [
  { idx: 0, tool: "read_range", args: '{"range":"A81:D120"}', result: '{"ok":true}', status: "ok", ms: 400 },
  { idx: 1, tool: "search_sheet_context", args: '{"q":"cardionova"}', result: '{"ok":true}', status: "ok", ms: 500 },
  { idx: 2, tool: "fetch_source", args: '{"url":"https://pitchbook.com"}', result: '{"ok":false,"error":"429 rate-limited"}', status: "error", ms: 540 },
  { idx: 3, tool: "fetch_source", args: '{"url":"https://pitchbook.com"}', result: '{"ok":true,"http":200}', status: "ok", ms: 470 },
  { idx: 4, tool: "fetch_source", args: '{"url":"https://crunchbase.com"}', result: '{"ok":true,"http":200}', status: "ok", ms: 610 },
  { idx: 5, tool: "say", args: '{"text":"drafting"}', result: '{"ok":true}', status: "ok", ms: 3100 },
  { idx: 6, tool: "write_locked_cells", args: '{"cells":40}', result: '{"ok":true,"version":247}', status: "ok", ms: 1600, elementId: "sr_0081__funding" },
];

describe("assembleRunSpans — mission root → kind-grouped phase spans", () => {
  it("happy path: groups consecutive same-kind steps, keeps singles on the root, carries run attrs", () => {
    const { spans, truncated } = assembleRunSpans(ENRICH_RUN, ENRICH_STEPS);
    expect(truncated).toBe(false);

    const root = spans.find((s) => s.parentId === null)!;
    expect(root.kind).toBe("mission");
    expect(root.name).toBe("Enrich rows 81–120");
    expect(root.durMs).toBe(12_400);
    const attrKeys = root.attrs.map(([k]) => k);
    expect(attrKeys).toContain("actor");
    expect(attrKeys).toContain("reason");
    expect(attrKeys).toContain("idempotencyKey");
    expect(attrKeys).toContain("stopReason");
    expect(root.attrs.find(([k]) => k === "actor")?.[1]).toBe("agent:room_na");
    expect(root.attrs.find(([k]) => k === "cost")?.[1]).toBe("$0.14");

    // context ×2 and retrieval ×3 grouped; say + write stay as direct children
    const groups = spans.filter((s) => s.rollup != null);
    expect(groups.map((g) => [g.kind, g.rollup])).toEqual([["context", 2], ["retrieval", 3]]);
    const ctxGroup = groups[0];
    expect(ctxGroup.name).toBe("context.gather");
    const retGroup = groups[1];
    expect(retGroup.name).toBe("retrieval.search");
    // grouped children hang off their phase span; singles hang off the root
    expect(spans.find((s) => s.id === "s0")?.parentId).toBe(ctxGroup.id);
    expect(spans.find((s) => s.id === "s2")?.parentId).toBe(retGroup.id);
    expect(spans.find((s) => s.id === "s5")?.parentId).toBe("run");
    expect(spans.find((s) => s.id === "s6")?.parentId).toBe("run");
    // non-consecutive kinds never merged: say (synthesis) sits between retrieval and spreadsheet
    expect(spans.find((s) => s.id === "s6")?.kind).toBe("spreadsheet");
  });

  it("sad path: failed fetch + later same-tool success = error + retried·ok, propagated up", () => {
    const { spans } = assembleRunSpans(ENRICH_RUN, ENRICH_STEPS);
    const failed = spans.find((s) => s.id === "s2")!;
    const retried = spans.find((s) => s.id === "s3")!;
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("429");
    expect(retried.status).toBe("retryok");
    expect(retried.attrs.find(([k]) => k === "attempt")?.[1]).toBe("2");
    // the phase span shows retry (recovered), the mission root shows retry — not error, not ok
    const retGroup = spans.find((s) => s.rollup != null && s.kind === "retrieval")!;
    expect(retGroup.status).toBe("retry");
    expect(spans.find((s) => s.parentId === null)!.status).toBe("retry");
  });

  it("an unresolved failure (no later same-tool success) keeps the root in error", () => {
    const { spans } = assembleRunSpans(
      { ...ENRICH_RUN, stopReason: "error" },
      ENRICH_STEPS.filter((s) => s.idx !== 3 && s.idx !== 4), // the retry never happened
    );
    expect(spans.find((s) => s.id === "s2")?.status).toBe("error");
    expect(spans.find((s) => s.parentId === null)?.status).toBe("error");
  });

  it("an exhausted run is an error at the root even when every step succeeded", () => {
    const { spans } = assembleRunSpans(
      { ...ENRICH_RUN, exhausted: true, stopReason: "budget_exhausted" },
      ENRICH_STEPS.filter((s) => s.idx <= 1),
    );
    const root = spans.find((s) => s.parentId === null)!;
    expect(root.status).toBe("error");
    expect(root.error).toContain("exhausted");
  });

  it("HONESTY: a step without measured ms gets durMs null — never a fabricated duration", () => {
    const { spans } = assembleRunSpans(
      { ...ENRICH_RUN, ms: 0 },
      [
        { idx: 0, tool: "read_range", status: "ok", ms: 0 },
        { idx: 1, tool: "say", status: "ok" }, // ms absent entirely
        { idx: 2, tool: "edit_cell", status: "ok", ms: 250 },
      ],
    );
    const root = spans.find((s) => s.parentId === null)!;
    expect(root.durMs).toBeNull(); // run.ms 0 = unknown wall-clock, not a 0ms run
    const s0 = spans.find((s) => s.id === "s0")!;
    const s1 = spans.find((s) => s.id === "s1")!;
    const s2 = spans.find((s) => s.id === "s2")!;
    expect(s0.durMs).toBeNull();
    expect(s1.durMs).toBeNull();
    expect(s0.attrs.find(([k]) => k === "duration")?.[1]).toBe("not recorded");
    expect(s2.durMs).toBe(250);
    // unknown durations contribute 0 to the sequence offsets — no invented gaps
    expect(s1.startMs).toBe(0);
    expect(s2.startMs).toBe(0);
    // and the UI helpers keep the honesty visible
    expect(fmtSpanMs(null)).toBe("—");
    expect(spanBarGeometry(s1, runTreeTotalMs(spans)).width).toBeNull();
  });

  it("duration bars scale against the run wall-clock (starts = cumulative tool time)", () => {
    const { spans } = assembleRunSpans(
      { ...ENRICH_RUN, ms: 10_000 },
      [
        { idx: 0, tool: "read_range", status: "ok", ms: 1000 },
        { idx: 1, tool: "say", status: "ok", ms: 3000 },
      ],
    );
    const total = runTreeTotalMs(spans);
    expect(total).toBe(10_000);
    const s1 = spans.find((s) => s.id === "s1")!;
    expect(s1.startMs).toBe(1000);
    const geo = spanBarGeometry(s1, total);
    expect(geo.left).toBeCloseTo(10);
    expect(geo.width).toBeCloseTo(30);
  });

  it("BOUND: a 250-step runaway run truncates at 200 spans with an honest flag", () => {
    const burst: RunStepInput[] = Array.from({ length: 250 }, (_, i) => ({
      idx: i, tool: i % 2 === 0 ? "read_range" : "edit_cell", status: "ok", ms: 10,
    }));
    const { spans, truncated } = assembleRunSpans(ENRICH_RUN, burst);
    expect(truncated).toBe(true);
    const stepSpans = spans.filter((s) => s.id.startsWith("s"));
    expect(stepSpans.length).toBe(RUN_TRACE_MAX_STEPS);
    const root = spans.find((s) => s.parentId === null)!;
    expect(root.attrs.find(([k]) => k === "steps.truncated")?.[1]).toContain("250");
  });

  it("flattenRunSpans: collapse hides a branch; the issues filter keeps only troubled branches", () => {
    const { spans } = assembleRunSpans(ENRICH_RUN, ENRICH_STEPS);
    const all = flattenRunSpans(spans, new Set(), false);
    expect(all.length).toBe(spans.length); // nothing collapsed → every span is a row
    const retGroup = spans.find((s) => s.rollup != null && s.kind === "retrieval")!;
    const collapsed = flattenRunSpans(spans, new Set([retGroup.id]), false);
    expect(collapsed.length).toBe(spans.length - retGroup.rollup!);
    const issues = flattenRunSpans(spans, new Set(), true);
    expect(issues.some((r) => r.span.id === "s2")).toBe(true); // the failed fetch stays
    expect(issues.some((r) => r.span.id === "s5")).toBe(false); // the clean say row filtered
    expect(issues.some((r) => r.span.parentId === null)).toBe(true); // root always shown
  });
});

/* ── memory mode: spans from the engine's scripted trace list ──────────────── */

const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent" };
const MAYA = { kind: "user" as const, id: "u_maya", name: "Maya" };

function evt(id: string, type: TraceEvent["type"], ts: number, summary: string, actor: TraceEvent["actor"] = AGENT): TraceEvent {
  return { id, roomId: "r1", ts, actor, type, summary };
}

describe("buildMemoryRunsFromTraces — scripted runs, honest sequence timing", () => {
  it("splits runs on agent_session_started, keeps real ts offsets, durations honestly unknown", () => {
    const t0 = 1_000_000;
    const traces: TraceEvent[] = [
      evt("t1", "room_created", t0, "Room created", MAYA),
      evt("t2", "member_joined", t0 + 100, "Maya joined", MAYA),
      evt("t3", "agent_session_started", t0 + 5_000, "Enrich the diligence sheet"),
      evt("t4", "lock_denied", t0 + 5_200, "Lock denied on rows 81–120"),
      evt("t5", "lock_acquired", t0 + 5_600, "Lock acquired on rows 81–120"),
      evt("t6", "edit_applied", t0 + 6_400, "40 cells written"),
      evt("t7", "message", t0 + 7_000, "Draft posted"),
    ];
    const runs = buildMemoryRunsFromTraces(traces);
    expect(runs.length).toBe(2);
    // newest first: the agent run leads, room plumbing trails
    expect(runs[0].summary.goal).toBe("Enrich the diligence sheet");
    expect(runs[1].summary.goal).toBe("Room activity");

    const spans = runs[0].spans;
    const root = spans.find((s) => s.parentId === null)!;
    expect(root.kind).toBe("mission");
    expect(root.durMs).toBe(2_000); // real event window (t7 − t3)
    // real timestamp offsets, no invented per-event durations
    const denied = spans.find((s) => s.name === "lock_denied")!;
    const acquired = spans.find((s) => s.name === "lock_acquired")!;
    expect(denied.startMs).toBe(200);
    expect(acquired.startMs).toBe(600);
    expect(denied.durMs).toBeNull();
    expect(acquired.durMs).toBeNull();
    // conflict → later same-family success = retry + retried·ok, root shows retry
    expect(denied.status).toBe("retry");
    expect(acquired.status).toBe("retryok");
    expect(root.status).toBe("retry");
    // kinds derive from the trace type
    expect(denied.kind).toBe("spreadsheet");
    expect(spans.find((s) => s.name === "message")?.kind).toBe("synthesis");
  });

  it("sustained scale: 600-event sessions bound at 200; a 15-session history keeps the newest 10", () => {
    const t0 = 2_000_000;
    const flood: TraceEvent[] = [evt("s0", "agent_session_started", t0, "Long run")];
    for (let i = 1; i <= 600; i++) flood.push(evt(`f${i}`, "edit_applied", t0 + i * 10, `write ${i}`));
    const [run] = buildMemoryRunsFromTraces(flood);
    expect(run.spans.length).toBe(1 + MEMORY_RUN_MAX_EVENTS);
    expect(run.spans[0].attrs.some(([k]) => k === "events.truncated")).toBe(true);

    const many: TraceEvent[] = [];
    for (let s = 0; s < 15; s++) {
      many.push(evt(`ss${s}`, "agent_session_started", t0 + s * 1000, `Run ${s}`));
      many.push(evt(`se${s}`, "edit_applied", t0 + s * 1000 + 500, "write"));
    }
    const runs = buildMemoryRunsFromTraces(many);
    expect(runs.length).toBe(MEMORY_RUN_MAX_RUNS);
    expect(runs[0].summary.goal).toBe("Run 14"); // newest first
  });
});

/* ── the proof-gated query (convex-test) ───────────────────────────────────── */

const MAYA_TOKEN = "runtrace-test-maya-token-0123456789abcd";
const RILEY_TOKEN = "runtrace-test-riley-token-fedcba98765432";

type ActorProof = { actor: { kind: "user" | "agent"; id: string; name: string }; token?: string };
const listRunSpansRef = makeFunctionReference<
  "query",
  { roomId: Id<"rooms">; requester: ActorProof; runId?: Id<"agentRuns"> },
  RunSpansResult
>("runTrace:listRunSpans");

async function setupRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const [mayaHash, rileyHash] = await Promise.all([hashToken(MAYA_TOKEN), hashToken(RILEY_TOKEN)]);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: `R${Math.random().toString(36).slice(2, 7).toUpperCase()}`, title: "run trace proof room", hostId: "", autoAllow: true, status: "live" as const, createdAt: now }),
  );
  const mayaId = await t.run((ctx) =>
    ctx.db.insert("members", { roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111", authTokenHash: mayaHash, lastSeenAt: now }),
  );
  const rileyId = await t.run((ctx) =>
    ctx.db.insert("members", { roomId, name: "Riley", role: "member" as const, anon: false, color: "#222222", authTokenHash: rileyHash, lastSeenAt: now }),
  );
  const maya: ActorProof = { actor: { kind: "user", id: String(mayaId), name: "Maya" }, token: MAYA_TOKEN };
  const riley: ActorProof = { actor: { kind: "user", id: String(rileyId), name: "Riley" }, token: RILEY_TOKEN };
  return { t, roomId, maya, riley, mayaId: String(mayaId), rileyId: String(rileyId), now };
}
type T = Awaited<ReturnType<typeof setupRoom>>["t"];

async function insertRun(t: T, roomId: Id<"rooms">, agentId: string, goal: string, createdAt: number, overrides: Record<string, unknown> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("agentRuns", {
      roomId, agentId, model: "deepseek/deepseek-v4-flash", goal,
      steps: 2, toolCalls: 2, conflictsSurvived: 0, inputTokens: 1000, outputTokens: 200,
      costUsd: 0.01, ms: 4200, exhausted: false, stopReason: "done", createdAt,
      ...overrides,
    } as never),
  );
}

async function insertSteps(t: T, roomId: Id<"rooms">, runId: Id<"agentRuns">, agentId: string, steps: Array<Partial<RunStepInput> & { idx: number; tool: string }>) {
  await t.run(async (ctx) => {
    for (const s of steps) {
      await ctx.db.insert("agentSteps", {
        runId, roomId, agentId,
        idx: s.idx, tool: s.tool,
        args: s.args ?? "{}", result: s.result ?? '{"ok":true}',
        status: (s.status ?? "ok") as never, ms: s.ms ?? 100, ts: Date.now(),
        ...(s.elementId ? { elementId: s.elementId } : {}),
        recordHash: `test-hash-${s.idx}`, prevStepHash: s.idx === 0 ? `genesis:${runId}` : `test-hash-${s.idx - 1}`,
      } as never);
    }
  });
}

describe("runTrace.listRunSpans (proof-gated · bounded · private-run visibility)", () => {
  it("happy path: Priya sees the newest run's span tree — root attrs + tool spans + honest statuses", async () => {
    const { t, roomId, maya, now } = await setupRoom();
    const runId = await insertRun(t, roomId, "agent_room", "Enrich rows 81–120", now, { idempotencyKey: "run-16-81-120" });
    await insertSteps(t, roomId, runId, "agent_room", [
      { idx: 0, tool: "read_range", ms: 400 },
      { idx: 1, tool: "fetch_source", result: '{"ok":false,"error":"429"}', status: "error", ms: 540 },
      { idx: 2, tool: "fetch_source", result: '{"ok":true}', ms: 470 },
      { idx: 3, tool: "write_locked_cells", ms: 1600, elementId: "sr_0081__funding" },
    ]);
    const res = await t.query(listRunSpansRef, { roomId, requester: maya });
    expect(res.runs.length).toBe(1);
    expect(res.selectedRunId).toBe(String(runId));
    const root = res.spans.find((s) => s.parentId === null)!;
    expect(root.kind).toBe("mission");
    expect(root.attrs.find(([k]) => k === "idempotencyKey")?.[1]).toBe("run-16-81-120");
    expect(root.status).toBe("retry"); // failed fetch recovered by the retry
    const failed = res.spans.find((s: RunSpan) => s.status === "error");
    const retried = res.spans.find((s: RunSpan) => s.status === "retryok");
    expect(failed?.name).toBe("fetch_source");
    expect(retried?.name).toBe("fetch_source");
    expect(res.spans.find((s) => s.name === "write_locked_cells")?.attrs.some(([k, v]) => k === "elementId" && v === "sr_0081__funding")).toBe(true);
  });

  it("privacy: a private agent's runs are invisible to non-owners — in the picker AND by direct runId", async () => {
    const { t, roomId, maya, riley, rileyId, now } = await setupRoom();
    await t.run((ctx) =>
      ctx.db.insert("agentSessions", { roomId, agentId: "agent_riley_private", agentName: "Riley's NodeAgent", scope: "private" as const, ownerId: rileyId, status: "idle" as const, lastAction: "started", updatedAt: now }),
    );
    const publicRun = await insertRun(t, roomId, "agent_room", "Public enrichment", now - 1000);
    const privateRun = await insertRun(t, roomId, "agent_riley_private", "Riley's private research", now);
    await insertSteps(t, roomId, privateRun, "agent_riley_private", [{ idx: 0, tool: "fetch_source" }]);

    // Riley (owner) sees both, newest first = the private run
    const rileyView = await t.query(listRunSpansRef, { roomId, requester: riley });
    expect(rileyView.runs.map((r) => r.id)).toEqual([String(privateRun), String(publicRun)]);

    // Maya (host, but NOT the owner) never sees the private run in the picker…
    const mayaView = await t.query(listRunSpansRef, { roomId, requester: maya });
    expect(mayaView.runs.map((r) => r.id)).toEqual([String(publicRun)]);
    expect(mayaView.selectedRunId).toBe(String(publicRun));

    // …and naming the private runId directly yields an honest empty, not a leak
    const probe = await t.query(listRunSpansRef, { roomId, requester: maya, runId: privateRun });
    expect(probe.selectedRunId).toBeNull();
    expect(probe.spans).toEqual([]);
  });

  it("adversarial: a forged proof cannot read any run trace", async () => {
    const { t, roomId, riley } = await setupRoom();
    await expect(
      t.query(listRunSpansRef, { roomId, requester: { actor: riley.actor, token: "wrong-token-wrong-token-wrong-token-1" } }),
    ).rejects.toThrow(/invalid_actor_token/);
  });

  it("burst: a 250-step run comes back bounded at 200 spans with truncated:true", async () => {
    const { t, roomId, maya, now } = await setupRoom();
    const runId = await insertRun(t, roomId, "agent_room", "Runaway loop", now, { steps: 250, toolCalls: 250 });
    await insertSteps(t, roomId, runId, "agent_room",
      Array.from({ length: 250 }, (_, i) => ({ idx: i, tool: i % 2 === 0 ? "read_range" : "edit_cell", ms: 5 })));
    const res = await t.query(listRunSpansRef, { roomId, requester: maya });
    expect(res.truncated).toBe(true);
    expect(res.spans.filter((s) => s.id.startsWith("s")).length).toBe(RUN_TRACE_MAX_STEPS);
    const root = res.spans.find((s) => s.parentId === null)!;
    expect(root.attrs.some(([k]) => k === "steps.truncated")).toBe(true);
  });

  it("sustained: 35 runs of history keep the picker at the newest 10", async () => {
    const { t, roomId, maya, now } = await setupRoom();
    for (let i = 0; i < 35; i++) {
      await insertRun(t, roomId, "agent_room", `Run ${i}`, now + i);
    }
    const res = await t.query(listRunSpansRef, { roomId, requester: maya });
    expect(res.runs.length).toBe(RUN_TRACE_MAX_RUNS);
    expect(res.runs[0].goal).toBe("Run 34"); // newest first
    expect(res.runs[9].goal).toBe("Run 25");
    // the newest run has no steps — the spans hold just the honest mission root
    expect(res.spans.filter((s) => s.parentId === null).length).toBe(1);
  });
});
