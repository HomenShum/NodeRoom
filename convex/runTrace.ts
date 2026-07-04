/**
 * Run Trace — one agent run as an OpenTelemetry-style span tree (Trace tab "Runs" view).
 *
 * Substrate: agentRuns (telemetry row per run: model · steps · costUsd · stopReason) +
 * agentSteps (append-only per-run tool trace: idx · tool · args → result · status · ms).
 * The pure helpers below shape those rows into the span tree the design specifies
 * (design-reference/trace/trace-data.js): mission root span → kind-grouped child spans
 * with status chips (ok / retry / retried·ok / error) and duration bars.
 *
 * HONESTY CONTRACT (never fabricate timing):
 *   - agentSteps carries a MEASURED per-tool duration (`ms`) but no per-step start
 *     timestamp (agentSteps.record stamps one `ts` for the whole batch). Span starts are
 *     therefore SEQUENCE-DERIVED offsets (cumulative sum of measured tool durations) —
 *     the root span says so via its `timing` attr. Model-thinking time between tools is
 *     NOT shown as tool time.
 *   - a step without a positive measured `ms` gets `durMs: null` (renders "—" + a
 *     sequence tick, never an invented bar width).
 *   - a stored "ok" whose result payload says `ok:false` is surfaced as an error
 *     (HONEST_STATUS — the UI must not paint green over a failed tool call).
 *
 * Keep the RunSpan shape in sync with the type-only import in
 * src/ui/panels/TraceSurface.tsx (the client renders these spans verbatim).
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

/* ── span model (shared with the UI via type-only import) ─────────────────── */

export type RunSpanKind =
  | "mission" | "context" | "privacy" | "retrieval"
  | "synthesis" | "notebook" | "spreadsheet" | "mcp";
export type RunSpanStatus = "ok" | "retry" | "retryok" | "error";
export type RunSpanAttr = [string, string];

export type RunSpan = {
  id: string;
  parentId: string | null;
  name: string;
  kind: RunSpanKind;
  /** Sequence-derived offset from run start (cumulative measured tool time). */
  startMs: number;
  /** Measured duration, or null when the record carries no timing (HONEST — never fabricated). */
  durMs: number | null;
  status: RunSpanStatus;
  attrs: RunSpanAttr[];
  /** Group spans: how many steps roll up under this phase (design ×N chip). */
  rollup?: number;
  /** Error detail line for the expandable row (design .trc-derr). */
  error?: string;
};

export type RunSummary = {
  id: string;
  goal: string;
  agentId: string;
  model: string;
  steps: number;
  toolCalls: number;
  costUsd: number;
  ms: number;
  stopReason?: string;
  exhausted: boolean;
  createdAt: number;
};

export type RunSpansResult = {
  runs: RunSummary[];
  selectedRunId: string | null;
  spans: RunSpan[];
  truncated: boolean;
};

/* ── bounds (BOUND rule — every read is capped) ────────────────────────────── */

/** Run picker depth — the newest N runs for the room. */
export const RUN_TRACE_MAX_RUNS = 10;
/** Step-span bound per run; beyond this the root carries a steps.truncated attr. */
export const RUN_TRACE_MAX_STEPS = 200;
/** Each attr value is clipped so a giant args/result blob can't bloat the payload (BOUND_READ). */
export const RUN_TRACE_MAX_ATTR_CHARS = 240;
/** Room agent-session privacy rows scanned for private-run filtering. */
const MAX_SESSION_ROWS = 200;

/* ── pure helpers (ctx-free; unit-tested in tests/runTrace.test.ts) ────────── */

/** Ordered prefix rules over the REAL tool registry names (src/nodeagent/skills). */
const KIND_RULES: Array<[RegExp, RunSpanKind]> = [
  [/^(mcp|external)[._-]/, "mcp"],
  [/^(privacy|acl|visibility)/, "privacy"],
  // reads/discovery = context gathering (read_range, read_notebook, list_artifacts, search_sheet_context, skill RAG)
  [/^(read_|list_|search_sheet|skill_search|search_skills|load_skill)/, "context"],
  // external evidence (fetch_source, capture_source, sec_facts, tavily/you.* search, founder/github profiles, cite_in_file)
  [/^(fetch|capture|crawl|web_|sec_|tavily|you_|founder_profile|github_profile|cite_in_file|retriev)/, "retrieval"],
  // notebook/wiki writes
  [/^(append_notebook|update_notebook|plan_notebook|notebook|update_wiki|wiki)/, "notebook"],
  // sheet writes + the lock/draft collaboration machinery around them
  [/^(edit_cell|write_|define_columns|reconcile_cell|set_artifact_meta|propose_lock|release_lock|create_draft|sheet|cell|lock|versioned)/, "spreadsheet"],
];

export function deriveSpanKind(tool: string): RunSpanKind {
  const t = tool.trim().toLowerCase();
  for (const [re, kind] of KIND_RULES) if (re.test(t)) return kind;
  return "synthesis"; // say / plan_and_dispatch / compute_* / render_chart_* / everything model-authored
}

/**
 * Honest per-step status: stored status first, then the result payload's own ok flag.
 * "ok" + result `{ok:false}` = error (HONEST_STATUS — no green over a failed call);
 * conflict/locked = retry-class (the CAS/lock machinery retries them).
 */
export function deriveStepStatus(status: string | undefined, result: string | undefined): RunSpanStatus {
  if (status === "error") return "error";
  if (status === "conflict" || status === "locked") return "retry";
  if (result) {
    try {
      const parsed: unknown = JSON.parse(result);
      if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) return "error";
    } catch {
      /* non-JSON result — trust the stored status */
    }
  }
  return "ok";
}

/** Propagated status for a parent: unresolved error > retry activity > ok.
 *  Callers that know a failure was recovered (a later same-tool retryok) must map
 *  that child to retry-class BEFORE calling — the failed span itself keeps "error"
 *  (failures are evidence), but a recovered branch reads "retry", not "error"
 *  (design: retrieval.search = retry over an error + retried·ok pair). */
export function propagateStatus(children: ReadonlyArray<Pick<RunSpan, "status">>): RunSpanStatus {
  let sawRetry = false;
  let sawError = false;
  for (const c of children) {
    if (c.status === "error") sawError = true;
    if (c.status === "retry" || c.status === "retryok") sawRetry = true;
  }
  if (sawError) return "error";
  if (sawRetry) return "retry";
  return "ok";
}

const clip = (value: string, max = RUN_TRACE_MAX_ATTR_CHARS): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const PHASE_NAME: Record<RunSpanKind, string> = {
  mission: "run",
  context: "context.gather",
  privacy: "privacy.filter",
  retrieval: "retrieval.search",
  synthesis: "synthesis.answer",
  notebook: "notebook.write",
  spreadsheet: "spreadsheet.write",
  mcp: "mcp.boundary",
};

export type RunStepInput = {
  idx: number;
  tool: string;
  args?: string;
  result?: string;
  status?: string;
  ms?: number;
  elementId?: string;
};

export type RunRowInput = {
  goal: string;
  agentId: string;
  model: string;
  steps?: number;
  toolCalls?: number;
  costUsd?: number;
  ms?: number;
  stopReason?: string;
  exhausted?: boolean;
  idempotencyKey?: string;
};

const fmtUsd = (usd: number): string => (usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/**
 * Assemble one run's span tree: mission root → consecutive same-kind steps grouped
 * under a phase span (≥2 steps), singles hang straight off the root. Bounded to
 * RUN_TRACE_MAX_STEPS steps; retry pass rewrites "error → later same-tool ok" into
 * error + retried·ok pairs (the design's pitchbook fetch → retry pattern).
 */
export function assembleRunSpans(run: RunRowInput, steps: ReadonlyArray<RunStepInput>): { spans: RunSpan[]; truncated: boolean } {
  const truncated = steps.length > RUN_TRACE_MAX_STEPS;
  const ordered = [...steps].sort((a, b) => a.idx - b.idx).slice(0, RUN_TRACE_MAX_STEPS);

  // Per-step derived status, then the retry pass: a failure followed by a LATER ok of
  // the SAME tool marks that later step "retryok" (attempt n) and leaves the failure row
  // standing (failures are evidence, not blemishes).
  const statuses: RunSpanStatus[] = ordered.map((s) => deriveStepStatus(s.status, s.result));
  const pendingFailures = new Map<string, number[]>();
  const attempts = new Map<number, number>();
  const resolvedFailures = new Set<number>(); // failure indices later recovered by a same-tool success
  ordered.forEach((s, i) => {
    const st = statuses[i];
    if (st === "error" || st === "retry") {
      pendingFailures.set(s.tool, [...(pendingFailures.get(s.tool) ?? []), i]);
      return;
    }
    const pending = pendingFailures.get(s.tool) ?? [];
    if (st === "ok" && pending.length > 0) {
      statuses[i] = "retryok";
      attempts.set(i, pending.length + 1);
      for (const idx of pending) resolvedFailures.add(idx);
      pendingFailures.set(s.tool, []);
    }
  });
  /** Parent-status view of a child: a RECOVERED failure reads as retry-class (the failed
   *  span itself keeps "error" — failures are evidence, but the branch is not broken). */
  const parentView = (span: RunSpan, orderedIdx: number | null): Pick<RunSpan, "status"> =>
    span.status === "error" && orderedIdx != null && resolvedFailures.has(orderedIdx) ? { status: "retry" } : span;

  // Sequence-derived starts: cumulative measured tool time (see honesty contract above).
  let offset = 0;
  const stepSpans: RunSpan[] = ordered.map((s, i) => {
    const durMs = typeof s.ms === "number" && s.ms > 0 ? s.ms : null;
    const attrs: RunSpanAttr[] = [["tool", s.tool]];
    if (s.args) attrs.push(["args", clip(s.args)]);
    if (s.result) attrs.push(["result", clip(s.result)]);
    if (s.elementId) attrs.push(["elementId", s.elementId]);
    if (s.status) attrs.push(["recorded status", s.status]);
    const attempt = attempts.get(i);
    if (attempt) attrs.push(["attempt", String(attempt)]);
    if (durMs == null) attrs.push(["duration", "not recorded"]);
    const span: RunSpan = {
      id: `s${s.idx}`,
      parentId: "run",
      name: s.tool,
      kind: deriveSpanKind(s.tool),
      startMs: offset,
      durMs,
      status: statuses[i],
      attrs,
    };
    if (statuses[i] === "error") span.error = clip(s.result ?? "tool reported an error", 160);
    offset += durMs ?? 0;
    return span;
  });

  // Group consecutive same-kind steps (≥2) under a phase span; singles stay root children.
  const out: RunSpan[] = [];
  let groupSeq = 0;
  let i = 0;
  while (i < stepSpans.length) {
    let j = i;
    while (j + 1 < stepSpans.length && stepSpans[j + 1].kind === stepSpans[i].kind) j++;
    const slice = stepSpans.slice(i, j + 1);
    if (slice.length >= 2) {
      const kind = slice[0].kind;
      const measured = slice.filter((s) => s.durMs != null);
      const groupId = `g${groupSeq++}`;
      out.push({
        id: groupId,
        parentId: "run",
        name: PHASE_NAME[kind],
        kind,
        startMs: slice[0].startMs,
        durMs: measured.length ? measured.reduce((sum, s) => sum + (s.durMs ?? 0), 0) : null,
        status: propagateStatus(slice.map((s, k) => parentView(s, i + k))),
        attrs: [["steps", String(slice.length)]],
        rollup: slice.length,
      });
      for (const s of slice) out.push({ ...s, parentId: groupId });
    } else {
      out.push(...slice);
    }
    i = j + 1;
  }

  const rootAttrs: RunSpanAttr[] = [
    ["actor", `agent:${run.agentId}`],
    ["model", run.model],
    ["reason", clip(run.goal)],
  ];
  if (run.idempotencyKey) rootAttrs.push(["idempotencyKey", run.idempotencyKey]);
  if (run.stopReason) rootAttrs.push(["stopReason", run.stopReason]);
  if (typeof run.steps === "number") rootAttrs.push(["steps", String(run.steps)]);
  if (typeof run.toolCalls === "number") rootAttrs.push(["toolCalls", String(run.toolCalls)]);
  if (typeof run.costUsd === "number" && run.costUsd > 0) rootAttrs.push(["cost", fmtUsd(run.costUsd)]);
  rootAttrs.push(["timing", "bar starts are cumulative tool time — model time between tools is not shown"]);
  if (truncated) rootAttrs.push(["steps.truncated", `showing first ${RUN_TRACE_MAX_STEPS} of ${steps.length}`]);

  const orderedIdxBySpanId = new Map(stepSpans.map((s, k) => [s.id, k]));
  const childStatus = propagateStatus(
    out.filter((s) => s.parentId === "run").map((s) => parentView(s, orderedIdxBySpanId.get(s.id) ?? null)),
  );
  const root: RunSpan = {
    id: "run",
    parentId: null,
    name: clip(run.goal, 96) || "agent run",
    kind: "mission",
    startMs: 0,
    durMs: typeof run.ms === "number" && run.ms > 0 ? run.ms : null,
    status: run.exhausted ? "error" : childStatus,
    attrs: rootAttrs,
  };
  if (run.exhausted) root.error = "run exhausted its budget before finishing";

  return { spans: [root, ...out], truncated };
}

/* ── the query (proof-gated · bounded · private-run visibility respected) ──── */

export const listRunSpans = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    runId: v.optional(v.id("agentRuns")),
  },
  handler: async (ctx, { roomId, requester, runId }): Promise<RunSpansResult> => {
    const viewer = await requireActorProof(ctx, roomId, requester);

    // Newest runs for the room (by_room = [roomId, createdAt]). Over-fetch a bounded
    // multiple so private-run filtering can't starve the picker for non-owners.
    const rows = await ctx.db
      .query("agentRuns")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(RUN_TRACE_MAX_RUNS * 3);

    // Private-run visibility: an agentSessions row marks an agent private + owned.
    // A private agent's runs are visible ONLY to its owner (same axis as private chat
    // channels: ownerId is the member id). Missing session row = public room agent.
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .take(MAX_SESSION_ROWS);
    const sessionByAgent = new Map(sessions.map((s) => [s.agentId, s]));
    const visible = rows
      .filter((r) => {
        const session = sessionByAgent.get(r.agentId);
        return !session || session.scope !== "private" || session.ownerId === viewer.id;
      })
      .slice(0, RUN_TRACE_MAX_RUNS);

    // Selection stays inside the visible, room-scoped list — an out-of-room or
    // private-to-someone-else runId yields an honest empty result, never a leak.
    const selected = runId
      ? visible.find((r) => String(r._id) === String(runId)) ?? null
      : visible[0] ?? null;

    let spans: RunSpan[] = [];
    let truncated = false;
    if (selected) {
      const steps = await ctx.db
        .query("agentSteps")
        .withIndex("by_run", (q) => q.eq("runId", selected._id))
        .take(RUN_TRACE_MAX_STEPS + 1); // +1 so the truncation flag is honest
      const assembled = assembleRunSpans(
        {
          goal: selected.goal,
          agentId: selected.agentId,
          model: selected.model,
          steps: selected.steps,
          toolCalls: selected.toolCalls,
          costUsd: selected.costUsd,
          ms: selected.ms,
          stopReason: selected.stopReason,
          exhausted: selected.exhausted,
          idempotencyKey: selected.idempotencyKey,
        },
        steps.map((s) => ({
          idx: s.idx, tool: s.tool, args: s.args, result: s.result,
          status: s.status, ms: s.ms, elementId: s.elementId,
        })),
      );
      spans = assembled.spans;
      truncated = assembled.truncated;
    }

    return {
      runs: visible.map((r) => ({
        id: String(r._id),
        goal: r.goal,
        agentId: r.agentId,
        model: r.model,
        steps: r.steps,
        toolCalls: r.toolCalls,
        costUsd: r.costUsd,
        ms: r.ms,
        stopReason: r.stopReason,
        exhausted: r.exhausted,
        createdAt: r.createdAt,
      })),
      selectedRunId: selected ? String(selected._id) : null,
      spans,
      truncated,
    };
  },
});
