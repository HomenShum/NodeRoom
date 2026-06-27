import { v } from "convex/values";
import { start as startWorkflow } from "@convex-dev/workflow";
import { Debouncer } from "@ikhrustalev/convex-debouncer";
import type { DebouncerComponentApi } from "@ikhrustalev/convex-debouncer";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, type ActorValue } from "./lib";
import { nodeMemRecordingEnabled } from "./nodemem";

const DEFAULT_QUIET_MS = 12_000;
const MAX_QUIET_MS = 60_000;
/** Deploy-safety: the passive feed only surfaces activity from the last 2 days so stale
 *  historical failed/noteworthy rows don't light up the chip indefinitely after deploy. */
const FEED_STALENESS_MS = 2 * 24 * 60 * 60 * 1000;
const terminalJobStatuses = new Set(["completed", "failed", "blocked", "cancelled"]);
type ActivityStatus = "completed" | "ignored" | "not_noteworthy" | "noteworthy" | "job_created" | "failed";
type ActivityDecision = {
  status: ActivityStatus;
  action: string;
  next?: string;
  reason?: string;
  error?: string;
  finding?: NoteworthyFinding;
  text?: string;
};
type PassiveJobAdmission =
  | { ok: true; reused: boolean; jobId: Id<"agentJobs">; workflowId?: string }
  | { ok: false; jobId?: Id<"agentJobs">; error: string };

const sourceKindV = v.union(v.literal("node"), v.literal("element"), v.literal("artifact_element"), v.literal("artifact"), v.literal("upload"), v.literal("message"), v.literal("wiki_revision"));
const eventKindV = v.union(
  v.literal("idle_after_typing"),
  v.literal("cell_committed"),
  v.literal("file_uploaded"),
  v.literal("manual_enqueue"),
  v.literal("content_committed"),
  v.literal("page_hidden"),
  v.literal("manual_save"),
  v.literal("artifact_imported"),
);
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));

// The package runtime exports lib.schedule/status/cancel, but v0.1.2 publishes a stale generated
// ComponentApi type. Cast to the client API until the package republishes corrected generated types.
const roomActivityDebouncer = new Debouncer(components.debouncer as unknown as DebouncerComponentApi, {
  delay: DEFAULT_QUIET_MS,
  mode: "sliding",
});

function clampQuietMs(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_QUIET_MS)) return DEFAULT_QUIET_MS;
  return Math.max(1_000, Math.min(value ?? DEFAULT_QUIET_MS, MAX_QUIET_MS));
}

export function activityDedupeKey(args: {
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  /** Per-actor scope: each author gets their own quiet window so shared-note multi-user
   *  activity never starves one actor's debounce. Derived from actor.id when available,
   *  falls back to ownerId (private-visibility marker), then "room" for unattributed activity. */
  actorId?: string;
  ownerId?: string;
}) {
  return [
    "activity",
    String(args.roomId),
    args.sourceKind,
    args.sourceId,
    args.eventKind,
    args.actorId ?? args.ownerId ?? "room",
  ].join(":");
}

export async function enqueueRoomActivity(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  sourceVersion?: number;
  sourceHash: string;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  actor?: ActorValue;
  visibility?: "private" | "room" | "public";
  ownerId?: string;
  quietMs?: number;
}) {
  const now = Date.now();
  const quietMs = clampQuietMs(args.quietMs);
  const dedupeKey = activityDedupeKey({ ...args, actorId: args.actor?.id });
  const existing = await ctx.db.query("roomActivityOutbox").withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey)).order("desc").first();

  // maxWaitAt is set once at row creation and never bumped — it is the hard deadline
  // beyond which the debounce sliding window is capped so a single actor typing past
  // MAX_QUIET_MS still fires exactly one scan.
  const maxWaitAt = (existing && (existing.status === "queued" || existing.status === "running"))
    ? (existing.maxWaitAt ?? now + MAX_QUIET_MS)
    : now + MAX_QUIET_MS;

  // Effective delay: slide the window unless we would push past the hard deadline.
  const effectiveDelay = Math.max(1, Math.min(quietMs, maxWaitAt - now));

  const patch = {
    roomId: args.roomId,
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    sourceVersion: args.sourceVersion,
    sourceHash: args.sourceHash,
    eventKind: args.eventKind,
    status: "queued" as const,
    actor: args.actor,
    visibility: args.visibility ?? "room" as const,
    ownerId: args.ownerId,
    dedupeKey,
    quietUntil: now + effectiveDelay,
    updatedAt: now,
    // Persist maxWaitAt on patch when the existing row predates this field (pre-deploy rows
    // have undefined maxWaitAt — without this, the fallback recalculates fresh every enqueue
    // and the hard deadline never anchors).
    ...(existing && existing.maxWaitAt === undefined ? { maxWaitAt } : {}),
  };
  const rowId = existing && (existing.status === "queued" || existing.status === "running")
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("roomActivityOutbox", {
        ...patch,
        maxWaitAt,
        attempts: 0,
        createdAt: now,
      });

  await roomActivityDebouncer.schedule(
    ctx,
    "room-activity",
    dedupeKey,
    internal.roomActivity.scanDueActivity,
    { roomId: args.roomId, limit: 20 },
    { delay: effectiveDelay, mode: "sliding" },
  );
  return { outboxId: rowId, dedupeKey, quietUntil: now + effectiveDelay };
}

export const enqueueManual = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    sourceKind: sourceKindV,
    sourceId: v.string(),
    sourceVersion: v.optional(v.number()),
    sourceHash: v.string(),
    eventKind: v.optional(eventKindV),
    visibility: v.optional(visibilityV),
    ownerId: v.optional(v.string()),
    quietMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    return enqueueRoomActivity(ctx, { ...args, actor, eventKind: args.eventKind ?? "manual_enqueue" });
  },
});

export const scanDueActivity = internalMutation({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, limit }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_status_quietUntil", (q) => q.eq("roomId", roomId).eq("status", "queued").lte("quietUntil", now))
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
    let scanned = 0;
    for (const row of rows) {
      scanned++;
      await scanActivityRow(ctx, row, now);
    }
    return { scanned };
  },
});

export const listRecent = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("roomActivityOutbox")
      .withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "queued"))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
  },
});

/**
 * Passive-intelligence feed for the room's return-state UI. Returns recent outbox
 * rows across ALL statuses (newest first), shaped into a slim client contract so the
 * raw `finding`/`decision` blobs never cross the wire. The inbox filters to actionable
 * rows client-side; this query stays broad so the chip can also surface "indexing…"
 * and "failed" states reactively without a second subscription.
 *
 * Privacy: a room member only sees room/public activity plus their OWN private rows.
 * The query uses visibility-scoped indexes so other members' private rows are never
 * fetched — closing a metadata side-channel that would leak private-activity volume.
 */
export const feed = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const cutoff = Date.now() - FEED_STALENESS_MS;
    const cap = Math.max(1, Math.min(limit ?? 30, 60));

    // Shared rows (room + public) — visibility-scoped index fetches ONLY shared rows;
    // private rows are never touched, so their count/timing can't leak.
    const roomRows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_visibility_updated", (q) => q.eq("roomId", roomId).eq("visibility", "room").gte("updatedAt", cutoff))
      .order("desc")
      .take(cap);
    const publicRows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_visibility_updated", (q) => q.eq("roomId", roomId).eq("visibility", "public").gte("updatedAt", cutoff))
      .order("desc")
      .take(cap);
    // Own private rows — indexed by ownerId so only the requester's rows are fetched.
    // A private row with no ownerId is excluded from this index (Convex drops undefined
    // optional fields from index entries), which is correct: an ownerless private row
    // should never be shown.
    const ownPrivateRows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_owner_visibility_updated", (q) => q.eq("roomId", roomId).eq("ownerId", actor.id).eq("visibility", "private").gte("updatedAt", cutoff))
      .order("desc")
      .take(cap);

    const merged = [...roomRows, ...publicRows, ...ownPrivateRows]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, cap);
    return merged.map((r) => toFeedItem(r, r.visibility === "private"));
  },
});

export type FeedItem = {
  id: string;
  sourceKind: string;
  sourceId: string;
  eventKind: string;
  status: string;
  visibility: string;
  createdAt: number;
  updatedAt: number;
  lastScannedAt?: number;
  latestJobId?: string;
  error?: string;
  entityNames: string[];
  facets: string[];
  reasons: string[];
  score: number;
  action: string;
  textPreview: string;
};

function toFeedItem(row: {
  _id: Id<"roomActivityOutbox">;
  sourceKind: string;
  sourceId: string;
  eventKind: string;
  status: string;
  visibility: "private" | "room" | "public";
  latestJobId?: Id<"agentJobs">;
  error?: string;
  decision?: { action?: string; text?: string };
  finding?: { score?: number; action?: string; reasons?: string[]; facets?: string[]; entities?: Array<{ displayName?: string }> };
  createdAt: number;
  updatedAt: number;
  lastScannedAt?: number;
}, isOwner: boolean): FeedItem {
  const finding = row.finding ?? {};
  const decision = row.decision ?? {};
  const entities = Array.isArray(finding.entities) ? finding.entities : [];
  return {
    id: String(row._id),
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    eventKind: row.eventKind,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastScannedAt: row.lastScannedAt,
    latestJobId: row.latestJobId ? String(row.latestJobId) : undefined,
    error: row.error,
    entityNames: entities.map((e) => String(e.displayName ?? "")).filter(Boolean),
    facets: Array.isArray(finding.facets) ? finding.facets.map(String) : [],
    // Prefer the canonical stable `signals` enum array; fall back to legacy `reasons`
    // for rows written before the signals/reasons split.
    reasons: Array.isArray((finding as { signals?: unknown[] }).signals)
      ? (finding as { signals: unknown[] }).signals.map(String)
      : Array.isArray(finding.reasons) ? finding.reasons.map(String) : [],
    score: typeof finding.score === "number" ? finding.score : 0,
    action: String(decision.action ?? finding.action ?? ""),
    // Only the owner sees the private note's source text in the preview. Room/public rows
    // still preview (their content is already room-visible), but a non-owner never gets a
    // private row here — the filter above drops them — so this guard is defense-in-depth.
    textPreview: (isOwner || row.visibility !== "private") ? String(decision.text ?? "").slice(0, 240) : "",
  };
}

/** Dismiss a passive-activity item — sets status to `ignored` so it leaves the chip count.
 *  Validates actor proof and records who dismissed for audit. Any room member may dismiss
 *  shared (room/public) rows; only the owner may dismiss private rows. */
export const dismissActivity = mutation({
  args: {
    activityId: v.id("roomActivityOutbox"),
    roomId: v.id("rooms"),
    requester: actorProofV,
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const row = await ctx.db.get(args.activityId);
    if (!row || String(row.roomId) !== String(args.roomId)) {
      return { ok: false as const, reason: "not_found" };
    }
    // Only the row owner (private) or any room member (room/public) may dismiss.
    if (row.visibility === "private" && row.ownerId !== actor.id) {
      return { ok: false as const, reason: "not_owner" };
    }
    await ctx.db.patch(args.activityId, { status: "ignored", dismissedBy: actor.id, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Start a research agent job for a passive-activity item. Derives the job scope from the
 *  STORED outbox row's visibility — never from client-supplied data — so the approval/evidence
 *  policies can't be weakened by a tampered client request. */
export const researchActivity = mutation({
  args: {
    activityId: v.id("roomActivityOutbox"),
    roomId: v.id("rooms"),
    requester: actorProofV,
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const row = await ctx.db.get(args.activityId);
    if (!row || String(row.roomId) !== String(args.roomId)) {
      return { ok: false as const, reason: "not_found" };
    }
    if (row.visibility === "private" && row.ownerId !== actor.id) {
      return { ok: false as const, reason: "not_owner" };
    }
    const now = Date.now();
    const text = row.decision?.text ?? await readSourceText(ctx, row.roomId, row.sourceKind, row.sourceId) ?? "";
    const baseFinding = row.finding?.entities?.length ? row.finding : classifyNoteworthy(text);
    if (!baseFinding.entities.length) {
      return { ok: false as const, reason: "no_entity_detected" };
    }
    const finding = { ...baseFinding, action: "start_research_job" as const };
    const job = await createPassiveRoomWorkJob(ctx, row, finding, text, now);
    await ctx.db.patch(args.activityId, {
      status: job.ok ? "job_created" : "failed",
      latestJobId: job.jobId,
      decision: {
        ...(row.decision ?? { status: "noteworthy" as const, action: "start_research_job" as const }),
        status: job.ok ? "job_created" : "failed",
        action: "start_research_job",
        next: "agentJobs.workflow",
        text,
        job,
        error: job.ok ? undefined : job.error,
      },
      finding,
      error: job.ok ? undefined : job.error,
      updatedAt: now,
      lastScannedAt: now,
    });
    return { ok: true as const };
  },
});

/** Coach Mode: turn a `create_coach_cue` item into an explain-and-defend evaluation.
 *  Creates a coach_eval agentJob (entrypoint room_work) scoped to the item's
 *  visibility, and stores the user's answer + expected outline on the
 *  roomActivityOutbox row's finding as a pending coachEval. The NodeAgent harness
 *  runs the evaluation (grounded: every feedback item must cite a source/cell/
 *  trace/evidenceFact/OKF concept or it is dropped) and the completion path writes
 *  the scored outcome (score, masteryTags, missedEvidenceRefs, reviewReadinessDelta)
 *  back onto the row's finding. No new table. */
export const practiceActivity = mutation({
  args: {
    activityId: v.id("roomActivityOutbox"),
    roomId: v.id("rooms"),
    requester: actorProofV,
    userAnswer: v.string(),
    expectedOutline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const row = await ctx.db.get(args.activityId);
    if (!row || String(row.roomId) !== String(args.roomId)) {
      return { ok: false as const, reason: "not_found" };
    }
    if (row.visibility === "private" && row.ownerId !== actor.id) {
      return { ok: false as const, reason: "not_owner" };
    }
    const now = Date.now();
    const artifact = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", row.roomId)).first();
    if (!artifact) return { ok: false as const, reason: "room_has_no_artifact_for_eval" };
    const scope = row.visibility === "private" ? "private_user" as const : "public_room" as const;
    const requester = { kind: "agent" as const, id: "coach-eval", name: "Coach Eval", scope: "public" as const, ownerId: actor.id };
    const idempotencyKey = `coach-eval:${String(row._id)}:${String(row.sourceHash)}`;
    const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
    const reusable = prior.find((job) => String(job.roomId) === String(row.roomId) && !terminalJobStatuses.has(job.status));
    const artifactRef = row.sourceKind === "artifact_element" || row.sourceKind === "element" ? row.sourceId : `${String(artifact._id)}:doc`;
    const coachEvalPending = {
      activityId: String(row._id),
      artifactRef,
      userAnswer: args.userAnswer.slice(0, 4_000),
      expectedOutline: (args.expectedOutline ?? "").slice(0, 2_000),
      status: "pending" as const,
    };
    if (reusable) {
      await ctx.db.patch(args.activityId, {
        status: "job_created",
        latestJobId: reusable._id as Id<"agentJobs">,
        finding: { ...(row.finding ?? {}), coachEval: coachEvalPending },
        updatedAt: now,
        lastScannedAt: now,
      });
      return { ok: true as const, jobId: String(reusable._id), reused: true as const };
    }
    const goal = `Coach evaluation: can the user explain/defend ${artifactRef}? Answer: ${args.userAnswer.slice(0, 400)}`;
    const jobId = await ctx.db.insert("agentJobs", {
      roomId: row.roomId,
      artifactId: artifact._id,
      requester,
      goal: goal.slice(0, 2_000),
      entrypoint: "room_work",
      scope,
      commandText: goal.slice(0, 2_000),
      request: {
        roomId: String(row.roomId),
        targetArtifactId: String(artifact._id),
        commandText: goal.slice(0, 2_000),
        entrypoint: "room_work",
        scope,
        routePolicy: "free_auto",
        runtimePolicy: "workflow_sliced",
        modelPolicy: "openrouter/free-auto",
        approvalPolicy: row.visibility === "private" ? "draft_first" : "host_review",
        evidencePolicy: row.visibility === "private" ? "private_allowed" : "public_only",
        traceLevel: "full_operation_ledger",
        coachEval: coachEvalPending,
      },
      priority: 0,
      approvalPolicy: row.visibility === "private" ? "draft_first" : "host_review",
      evidencePolicy: row.visibility === "private" ? "private_allowed" : "public_only",
      autoAllow: false,
      traceLevel: "full_operation_ledger",
      routePolicy: "free_auto",
      runtimePolicy: "workflow_sliced",
      idempotencyKey,
      mode: "coach_eval",
      status: "queued",
      modelPolicy: "openrouter/free-auto",
      runtime: "workflow",
      attempts: 0,
      maxAttempts: 20,
      actionSliceCount: 0,
      queryCount: 0,
      mutationCount: 1,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: 1,
      receiptCount: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.activityId, {
      status: "job_created",
      latestJobId: jobId,
      finding: { ...(row.finding ?? {}), coachEval: coachEvalPending },
      updatedAt: now,
      lastScannedAt: now,
    });
    return { ok: true as const, jobId: String(jobId), reused: false as const };
  },
});

/** Coach Mode: record the scored evaluation outcome on the originating
 *  roomActivityOutbox row. Called by the coach_eval workflow completion path.
 *
 *  GROUNDING RULE (deterministic, enforced HERE — not trusted to the LLM): every
 *  `missedEvidenceRefs` entry is validated against real rows in this room
 *  (sourceCaptures / evidenceFacts / okfConcepts / cell elements) before it is
 *  persisted. Ungrounded refs proposed by the evaluator are dropped and counted,
 *  never stored as audit evidence. reviewReadinessDelta feeds
 *  buildBankerCoachPacket readiness. */
export const recordCoachEvalOutcome = internalMutation({
  args: {
    activityId: v.id("roomActivityOutbox"),
    score: v.number(),
    masteryTags: v.array(v.string()),
    missedEvidenceRefs: v.array(v.string()),
    reviewReadinessDelta: v.number(),
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.activityId);
    if (!row) return { ok: false as const, reason: "not_found" };
    const finding = (row.finding ?? {}) as Record<string, unknown>;
    const now = Date.now();
    // Cap + dedupe the LLM-supplied refs before validating, so untrusted model
    // output can't drive an unbounded N-query fan-out (each ref can issue up to
    // ~6 indexed gets). Max 25 refs is generous for any real evaluation and
    // bounds the worst case to ~150 sequential reads, well under Convex limits.
    const MAX_EVIDENCE_REFS = 25;
    const requestedRefs = [...new Set(args.missedEvidenceRefs)].slice(0, MAX_EVIDENCE_REFS);
    const cappedCount = args.missedEvidenceRefs.length - requestedRefs.length;
    // Validate each evidence ref resolves to a real row in this room before
    // persisting — the LLM proposes, the deterministic boundary disposes.
    const validatedRefs: string[] = [];
    for (const ref of requestedRefs) {
      if (await resolveEvidenceRef(ctx, row.roomId, ref)) validatedRefs.push(ref);
    }
    const droppedUngroundedCount = requestedRefs.length - validatedRefs.length;
    await ctx.db.patch(args.activityId, {
      finding: {
        ...finding,
        coachEval: {
          ...(finding.coachEval as Record<string, unknown> | undefined),
          status: "scored" as const,
          score: args.score,
          masteryTags: args.masteryTags,
          missedEvidenceRefs: validatedRefs,
          reviewReadinessDelta: args.reviewReadinessDelta,
          feedback: args.feedback,
          droppedUngroundedCount,
          groundingWarning: droppedUngroundedCount > 0 || cappedCount > 0
            ? `${droppedUngroundedCount} ungrounded ref(s) dropped${cappedCount > 0 ? `; ${cappedCount} ref(s) capped at ${MAX_EVIDENCE_REFS}` : ""}`
            : undefined,
        },
      },
      updatedAt: now,
    });
    await ctx.db.insert("traces", {
      roomId: row.roomId,
      ts: now,
      actor: { kind: "agent", id: "coach-eval", name: "Coach Eval" },
      type: "coach_eval_scored",
      summary: `Coach eval scored ${args.score.toFixed(2)} (${args.masteryTags.join(", ") || "no tags"}; readiness Δ${args.reviewReadinessDelta > 0 ? "+" : ""}${args.reviewReadinessDelta}${droppedUngroundedCount > 0 ? `; ${droppedUngroundedCount} ungrounded dropped` : ""})`,
      detail: args.feedback?.slice(0, 480) ?? "",
    });
    return { ok: true as const, droppedUngroundedCount };
  },
});

/** Deterministically resolve a coach-eval evidence ref to a real row in the room.
 *  Accepts: evidenceFacts.factId, okfConcepts.conceptId, okfConcepts.path,
 *  sourceCaptures/_id, evidenceFacts/_id, okfConcepts/_id, or a cell
 *  "artifactId:elementId". Returns true only if a matching row exists in this room.
 *  The three document-id fallbacks share one room-scoping helper (no per-table
 *  drift); the id-format guard avoids wasted `db.get` calls for string factIds. */
async function resolveEvidenceRef(ctx: MutationCtx, roomId: Id<"rooms">, ref: string): Promise<boolean> {
  if (!ref) return false;
  // String-field lookups (cheapest, most common for LLM-proposed refs).
  const fact = await ctx.db.query("evidenceFacts").withIndex("by_room_fact", (q) => q.eq("roomId", roomId).eq("factId", ref)).first();
  if (fact) return true;
  const conceptByConceptId = await ctx.db.query("okfConcepts").withIndex("by_room_concept", (q) => q.eq("roomId", roomId).eq("conceptId", ref)).first();
  if (conceptByConceptId) return true;
  const conceptByPath = await ctx.db.query("okfConcepts").withIndex("by_room_path", (q => q.eq("roomId", roomId).eq("path", ref))).first();
  if (conceptByPath) return true;
  // Cell ref "artifactId:elementId".
  if (ref.includes(":")) {
    const [artifactId, elementId] = ref.split(":");
    if (artifactId && elementId) {
      try {
        const art = await ctx.db.get(artifactId as Id<"artifacts">);
        if (art && String(art.roomId) === String(roomId)) {
          const el = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId as Id<"artifacts">).eq("elementId", elementId)).first();
          if (el) return true;
        }
      } catch { /* ref is not a valid artifact id — fall through */ }
    }
  }
  // Convex document ids for the evidence tables. Only attempt `db.get` when the
  // ref looks like a Convex id (32-char alphanumeric), and share one room-scope
  // helper across the three tables so they can't drift.
  if (looksLikeConvexId(ref)) {
    if (await refInRoom(ctx, roomId, ref, "sourceCaptures")) return true;
    if (await refInRoom(ctx, roomId, ref, "evidenceFacts")) return true;
    if (await refInRoom(ctx, roomId, ref, "okfConcepts")) return true;
  }
  return false;
}

/** Convex document ids are ~32 lowercase alphanumeric chars. Skip the expensive
 *  `db.get` (which throws on table-type mismatch) for plain string factIds. */
function looksLikeConvexId(ref: string): boolean {
  return /^[a-z0-9]{20,40}$/i.test(ref);
}

/** Resolve a ref as a document id on a specific evidence table and confirm it
 *  belongs to this room. Shared by the three evidence-table fallbacks so the
 *  room-scoping predicate can't drift between them. */
async function refInRoom(ctx: MutationCtx, roomId: Id<"rooms">, ref: string, table: "sourceCaptures" | "evidenceFacts" | "okfConcepts"): Promise<boolean> {
  try {
    const r = await ctx.db.get(ref as Id<typeof table>);
    return !!r && String(r.roomId) === String(roomId);
  } catch { /* ref is not a valid id for this table — fall through */ return false; }
}

export async function scanActivityRow(ctx: MutationCtx, row: {
  _id: Id<"roomActivityOutbox">;
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  sourceVersion?: number;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  sourceHash: string;
  attempts: number;
  actor?: ActorValue;
  visibility: "private" | "room" | "public";
  ownerId?: string;
}, now = Date.now()): Promise<ActivityDecision & { job?: PassiveJobAdmission }> {
  await ctx.db.patch(row._id, { status: "scanning", attempts: row.attempts + 1, updatedAt: now });
  const decision = await classifyActivity(ctx, row);

  // NodeMem Phase 2: record the activity as an episode for memory compilation.
  // This is append-only and fast (no compilation, no LLM). The background compiler
  // (nodememCompile.ts) processes episodes asynchronously.
  if (nodeMemRecordingEnabled() && decision.text && decision.text.trim().length >= 12) {
    try {
      const { sha256Hex } = await import("./lib");
      const contentHash = await sha256Hex(`${row.sourceKind}:${row.sourceId}:${decision.text}`);
      const existing = await ctx.db
        .query("nodeMemEpisodes")
        .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
        .first();
      if (!existing) {
        await ctx.db.insert("nodeMemEpisodes", {
          workspaceId: undefined,
          roomId: row.roomId,
          actorId: row.actor?.id,
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
          visibility: row.visibility,
          contentHash,
          rawText: decision.text,
          compiled: false,
          createdAt: now,
        });
      }
    } catch {
      // Episode recording must never block the scan pipeline — fail silently.
    }
  }

  if (decision.status !== "noteworthy" || decision.finding?.action !== "start_research_job" || !decision.finding.entities.length) {
    await ctx.db.patch(row._id, {
      status: decision.status,
      decision,
      finding: decision.finding,
      error: decision.error,
      updatedAt: Date.now(),
      lastScannedAt: Date.now(),
    });
    return decision;
  }

  const job = await createPassiveRoomWorkJob(ctx, row, decision.finding, decision.text ?? "", now);
  await ctx.db.patch(row._id, {
    status: job.ok ? "job_created" : "failed",
    latestJobId: job.jobId,
    decision: { ...decision, job },
    finding: decision.finding,
    error: job.ok ? undefined : job.error,
    updatedAt: Date.now(),
    lastScannedAt: Date.now(),
  });
  return { ...decision, job };
}

async function classifyActivity(ctx: MutationCtx, row: {
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  sourceHash: string;
}): Promise<ActivityDecision> {
  if (!row.sourceHash || row.sourceHash === "empty") {
    return { status: "ignored" as const, action: "ignore", reason: "empty_source" };
  }
  if (row.eventKind === "file_uploaded" || row.sourceKind === "upload") {
    return { status: "completed" as const, action: "index_file", next: "file_processing_job" };
  }
  const text = await readSourceText(ctx, row.roomId, row.sourceKind, row.sourceId);
  if (!text || text.trim().length < 12) {
    return { status: "not_noteworthy" as const, action: "ignore", reason: "empty_or_too_short", error: "empty_or_too_short" };
  }
  const finding = classifyNoteworthy(text);
  if (finding.score < 0.35) {
    return { status: "not_noteworthy" as const, action: "ignore", reason: "low_score", finding, text };
  }
  if (finding.action !== "start_research_job") {
    return { status: "noteworthy" as const, action: finding.action, next: "okf_backlinks_or_coach_cue", finding, text };
  }
  return { status: "noteworthy" as const, action: "start_research_job", next: "agentJobs.workflow", finding, text };
}

async function createPassiveRoomWorkJob(
  ctx: MutationCtx,
  row: {
    _id: Id<"roomActivityOutbox">;
    roomId: Id<"rooms">;
    sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
    sourceId: string;
    sourceVersion?: number;
    sourceHash: string;
    actor?: ActorValue;
    visibility: "private" | "room" | "public";
    ownerId?: string;
  },
  finding: NoteworthyFinding,
  text: string,
  now: number,
): Promise<PassiveJobAdmission> {
  const artifact = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", row.roomId)).first();
  if (!artifact) return { ok: false as const, error: "room_has_no_artifact_for_entity_work" };
  const scope = row.visibility === "private" ? "private_user" as const : "public_room" as const;
  const requester = row.actor ?? { kind: "agent" as const, id: "passive-room-intelligence", name: "Passive Room Intelligence", scope: "public" as const };
  const facets = finding.facets.length ? finding.facets : ["company_profile"];
  const entitySignature = finding.entities.map((e) => `${e.type}:${e.entityKey}`).sort().join(",");
  const facetSignature = facets.slice().sort().join(",");
  const idempotencyKey = `passive-room-work:${String(row.roomId)}:${String(artifact._id)}:${row.sourceKind}:${row.sourceId}:${row.sourceHash}:${entitySignature}:${facetSignature}`;
  const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
  const reusable = prior.find((job) => String(job.roomId) === String(row.roomId) && !terminalJobStatuses.has(job.status));
  if (reusable) return { ok: true as const, reused: true as const, jobId: reusable._id as Id<"agentJobs">, workflowId: reusable.workflowId as string | undefined };

  const goal = `Passive room intelligence: research ${finding.entities.map((e) => e.displayName).join(", ")} from ${row.sourceKind}:${row.sourceId}.`;
  const jobId = await ctx.db.insert("agentJobs", {
    roomId: row.roomId,
    artifactId: artifact._id,
    requester,
    goal: goal.slice(0, 2_000),
    entrypoint: "room_work",
    scope,
    commandText: goal.slice(0, 2_000),
    request: {
      roomId: String(row.roomId),
      targetArtifactId: String(artifact._id),
      commandText: goal.slice(0, 2_000),
      entrypoint: "room_work",
      scope,
      routePolicy: "free_auto",
      runtimePolicy: "workflow_sliced",
      modelPolicy: "openrouter/free-auto",
      approvalPolicy: row.visibility === "private" ? "draft_first" : "host_review",
      evidencePolicy: row.visibility === "private" ? "private_allowed" : "public_only",
      traceLevel: "full_operation_ledger",
      passiveActivity: {
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
        sourceVersion: row.sourceVersion,
        sourceHash: row.sourceHash,
        finding,
        textPreview: text.slice(0, 800),
      },
    },
    priority: 0,
    approvalPolicy: row.visibility === "private" ? "draft_first" : "host_review",
    evidencePolicy: row.visibility === "private" ? "private_allowed" : "public_only",
    autoAllow: false,
    traceLevel: "full_operation_ledger",
    routePolicy: "free_auto",
    runtimePolicy: "workflow_sliced",
    idempotencyKey,
    mode: "research",
    status: "queued",
    modelPolicy: "openrouter/free-auto",
    runtime: "workflow",
    attempts: 0,
    maxAttempts: 20,
    actionSliceCount: 0,
    queryCount: 0,
    mutationCount: 1,
    modelCallCount: 0,
    toolCallCount: 0,
    schedulerHandoffCount: 1,
    receiptCount: 0,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("agentOperationEvents", {
    jobId,
    sequence: 1,
    kind: "mutation",
    name: "roomActivity.scanDueActivity",
    targetKind: row.sourceKind === "node" ? "node" : row.sourceKind === "artifact_element" || row.sourceKind === "element" ? "element" : undefined,
    targetId: row.sourceId,
    countDelta: 1,
    affectedIds: [String(row._id), String(jobId), String(artifact._id)],
    status: "completed",
    startedAt: now,
    completedAt: now,
  });
  for (const entity of finding.entities) {
    for (const facet of facets) {
      const workKey = `passive-room-work-item:${idempotencyKey}:${entity.type}:${entity.entityKey}:${facet}`;
      const existing = await ctx.db.query("entityWorkItems").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", workKey)).first();
      if (existing) continue;
      await ctx.db.insert("entityWorkItems", {
        roomId: row.roomId,
        artifactId: artifact._id,
        jobId,
        requester,
        visibility: row.visibility === "private" ? "private" : "public",
        ownerId: row.visibility === "private" ? row.ownerId ?? requester.id : undefined,
        entityType: asEntityType(entity.type),
        entityKey: entity.entityKey,
        displayName: entity.displayName,
        facet,
        status: "queued",
        cachePolicy: "missing_research_now",
        idempotencyKey: workKey,
        plan: {
          source: "passive_room_activity",
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          // Back-compat `reasons`: the agent routes on `finding.signals` (passed
          // via request.passiveActivity.finding), not this plan copy. `signals`
          // was removed from the plan as write-only dead code.
          reasons: Array.isArray(finding.signals) ? finding.signals : finding.reasons,
          textPreview: text.slice(0, 500),
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  try {
    const workflowId: string = String(await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    }));
    await ctx.db.patch(jobId, { workflowId, updatedAt: Date.now() });
    await ctx.db.insert("agentOperationEvents", {
      jobId,
      sequence: 2,
      kind: "scheduler",
      name: "agentWorkflows.freeAutoWorkflow",
      countDelta: 1,
      affectedIds: [String(jobId)],
      status: "completed",
      startedAt: now,
      completedAt: Date.now(),
    });
    return { ok: true as const, reused: false as const, jobId, workflowId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = `workflow_start_failed: ${message || "unknown"}`.slice(0, 1_000);
    await ctx.db.patch(jobId, {
      status: "failed",
      error: safeMessage,
      schedulerHandoffCount: 0,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("agentOperationEvents", {
      jobId,
      sequence: 2,
      kind: "scheduler",
      name: "agentWorkflows.freeAutoWorkflow start failed",
      countDelta: 0,
      affectedIds: [String(jobId)],
      status: "failed",
      startedAt: now,
      completedAt: Date.now(),
    });
    await ctx.db.insert("traces", {
      roomId: row.roomId,
      ts: Date.now(),
      actor: requester,
      type: "agent_error",
      summary: "Passive workflow admission failed",
      detail: safeMessage,
    });
    return { ok: false as const, jobId, error: safeMessage };
  }
}

async function readSourceText(ctx: MutationCtx, roomId: Id<"rooms">, sourceKind: string, sourceId: string): Promise<string | null> {
  if (sourceKind === "node") {
    const node = await ctx.db.get(sourceId as Id<"nodes">);
    return node && String(node.roomId) === String(roomId) ? `${node.title ?? ""}\n${node.content}` : null;
  }
  if (sourceKind === "element" || sourceKind === "artifact_element") {
    const [artifactId, elementId] = sourceId.split(":");
    if (!artifactId || !elementId) return null;
    const artifact = await ctx.db.get(artifactId as Id<"artifacts">);
    if (!artifact || String(artifact.roomId) !== String(roomId)) return null;
    const element = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id).eq("elementId", elementId)).unique();
    return element ? stripHtml(stringifyValue(element.value)) : null;
  }
  if (sourceKind === "message") {
    const message = await ctx.db.get(sourceId as Id<"messages">);
    return message && String(message.roomId) === String(roomId) ? message.text : null;
  }
  if (sourceKind === "wiki_revision") {
    const revision = await ctx.db.get(sourceId as Id<"wikiRevisions">);
    return revision && String(revision.roomId) === String(roomId) ? revision.content : null;
  }
  return null;
}

/** Strip HTML tags from a note's "doc" value so the noteworthiness classifier
 *  sees plain text (the synced and legacy editors both persist HTML). Leaves
 *  block boundaries so company/finance regexes match naturally. */
function stripHtml(html: string): string {
  if (!html.includes("<")) return html;
  return html
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  if (value && typeof value === "object" && "text" in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).text);
  return JSON.stringify(value ?? "");
}

type NoteworthyFinding = ReturnType<typeof classifyNoteworthy>;

/** Classifier version — pinned so a taxonomy tweak is detectable and tests/fixtures
 *  can assert against a known version. Bump when signal enums or scoring change. */
const CLASSIFIER_VERSION = "noteworthy-v1";

/** Stable signal enums — the canonical routing surface. `reasons` (emitted as an
 *  alias of `signals`) is kept for legacy UI/tests, but routing should read
 *  `signals`. Free-form strings are never emitted by the classifier. */
const SIGNAL = {
  ORG_CANDIDATE: "organization_candidate",
  FINANCE_SIGNAL: "finance_signal",
  PERSON_INTERACTION: "person_or_interaction",
  RESEARCH_SIGNAL: "research_signal",
  OPEN_QUESTION_OR_TASK: "open_question_or_task",
  SOURCE_URL: "source_url",
} as const;
type Signal = (typeof SIGNAL)[keyof typeof SIGNAL];
/** Deterministic sort order so classifier output is stable regardless of detection order. */
const SIGNAL_ORDER: Record<Signal, number> = {
  organization_candidate: 0,
  finance_signal: 1,
  person_or_interaction: 2,
  research_signal: 3,
  open_question_or_task: 4,
  source_url: 5,
};

/** First regex match's full text, or null — used to capture evidence spans per signal. */
function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[0] : null;
}

export function classifyNoteworthy(text: string) {
  const lower = text.toLowerCase();
  const signals = new Set<Signal>();
  const evidenceSpans: Array<{ signal: Signal; text: string; confidence: number }> = [];
  const facets = new Set<string>();

  const add = (signal: Signal, span: string, confidence: number) => {
    if (!signals.has(signal)) {
      signals.add(signal);
      evidenceSpans.push({ signal, text: span.slice(0, 200), confidence });
    }
  };

  // Organization candidate — broader than the old suffix-bound `company_mention`, so
  // "CardioNova"/"Stripe"/"Ramp"/"Brex" fire without "Inc"/"Labs". A suffix match
  // raises confidence but emits the SAME stable signal; a later LLM/entity resolver
  // confirms to `company_verified`. This replaces the brittle company_mention rule.
  const suffixSpan = firstMatch(text, /\b\w+\s+(inc|corp|labs|llc|ltd|health|bio|ai|technologies|systems|capital|ventures|bank|medical|therapeutics)\b/i);
  if (suffixSpan) add(SIGNAL.ORG_CANDIDATE, suffixSpan, 0.9);
  const candidates = [...text.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/g)]
    .map((m) => m[1])
    .filter((name) => !["Series", "Next", "The", "This", "Convex", "NodeRoom", "Need", "Follow"].includes(name));
  if (candidates.length && !signals.has(SIGNAL.ORG_CANDIDATE)) add(SIGNAL.ORG_CANDIDATE, candidates[0], 0.7);

  const personSpan = firstMatch(text, /\b(met|spoke|talked|call|founder|ceo|cfo|contact|intro|emailed)\b/i);
  if (personSpan) add(SIGNAL.PERSON_INTERACTION, personSpan, 0.8);

  const financeSpan = firstMatch(text, /\b(series\s+[a-z]|seed|funding|raise|runway|burn|arr|revenue|ebitda|margin|cash)\b/i);
  if (financeSpan) { add(SIGNAL.FINANCE_SIGNAL, financeSpan, 0.85); facets.add("funding"); facets.add("runway_inputs"); }

  const researchSpan = firstMatch(text, /\b(product|launch|announced|customer|pilot|hospital|pricing|competitor|headwind|market|news)\b/i);
  if (researchSpan) { add(SIGNAL.RESEARCH_SIGNAL, researchSpan, 0.8); facets.add("product_news"); facets.add("recent_signal"); }

  const taskSpan = firstMatch(text, /\b(verify|source|follow\s*up|ask|research|find|confirm|todo|next step|backlink|reference)\b/i);
  if (taskSpan) { add(SIGNAL.OPEN_QUESTION_OR_TASK, taskSpan, 0.75); facets.add("source_validation"); }

  const urlSpan = firstMatch(text, /https:\/\/\S+/i);
  if (urlSpan) add(SIGNAL.SOURCE_URL, urlSpan, 0.9);

  const sortedSignals = [...signals].sort((a, b) => SIGNAL_ORDER[a] - SIGNAL_ORDER[b]);
  const displayName = candidates[0] ?? "unknown";
  const entityType = lower.includes("founder") || lower.includes("ceo") || lower.includes("cfo") ? "person" : "company";
  // Candidate counts ONCE: as the organization_candidate signal (always emitted
  // when a candidate exists). The old `(candidates.length ? 0.18 : 0)` bonus is
  // dropped because organization_candidate is already in sortedSignals — keeping
  // it double-counted the candidate and inflated scores across every threshold.
  const score = Math.min(1, 0.18 + sortedSignals.length * 0.18);

  // Rebaselined thresholds (lowered to match the single-count score): candidate+
  // finance = 2 signals = 0.54 -> create_coach_cue (was 0.55 with double-count,
  // which pushed it to 0.72 / start_research_job). candidate only = 0.36 ->
  // index_only. 4+ signals -> start_research_job.
  return {
    score,
    action: score >= 0.70 ? "start_research_job" as const : score >= 0.50 ? "create_coach_cue" as const : score >= 0.35 ? "index_only" as const : "ignore" as const,
    signals: sortedSignals,
    // Back-compat alias: legacy UI/tests read `reasons`. Same sorted stable-enum
    // array as `signals`; new routing should read `signals` directly.
    reasons: sortedSignals,
    evidenceSpans,
    classifierVersion: CLASSIFIER_VERSION,
    facets: [...facets],
    entities: candidates.length ? [{ type: entityType, displayName, entityKey: normalizeEntityKey(displayName), confidence: Math.min(0.95, 0.55 + sortedSignals.length * 0.1) }] : [],
  };
}

function normalizeEntityKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function asEntityType(value: string): "company" | "person" | "product" | "source" | "metric" | "unknown" {
  return value === "company" || value === "person" || value === "product" || value === "source" || value === "metric" ? value : "unknown";
}
