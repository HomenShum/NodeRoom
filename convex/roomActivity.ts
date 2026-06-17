import { v } from "convex/values";
import { start as startWorkflow } from "@convex-dev/workflow";
import { Debouncer } from "@ikhrustalev/convex-debouncer";
import type { DebouncerComponentApi } from "@ikhrustalev/convex-debouncer";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, type ActorValue } from "./lib";

const DEFAULT_QUIET_MS = 12_000;
const MAX_QUIET_MS = 60_000;
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
  ownerId?: string;
}) {
  return [
    "activity",
    String(args.roomId),
    args.sourceKind,
    args.sourceId,
    args.eventKind,
    args.ownerId ?? "room",
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
  const dedupeKey = activityDedupeKey(args);
  const existing = await ctx.db.query("roomActivityOutbox").withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey)).order("desc").first();
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
    quietUntil: now + quietMs,
    updatedAt: now,
  };
  const rowId = existing && (existing.status === "queued" || existing.status === "running")
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("roomActivityOutbox", {
        ...patch,
        attempts: 0,
        createdAt: now,
      });

  await roomActivityDebouncer.schedule(
    ctx,
    "room-activity",
    dedupeKey,
    internal.roomActivity.scanDueActivity,
    { roomId: args.roomId, limit: 20 },
    { delay: quietMs, mode: "sliding" },
  );
  return { outboxId: rowId, dedupeKey, quietUntil: now + quietMs };
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
      .withIndex("by_status_quietUntil", (q) => q.eq("status", "queued").lte("quietUntil", now))
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
    let scanned = 0;
    for (const row of rows.filter((r) => String(r.roomId) === String(roomId))) {
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
          reasons: finding.reasons,
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
    return element ? stringifyValue(element.value) : null;
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

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  if (value && typeof value === "object" && "text" in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).text);
  return JSON.stringify(value ?? "");
}

type NoteworthyFinding = ReturnType<typeof classifyNoteworthy>;

function classifyNoteworthy(text: string) {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  const facets = new Set<string>();

  if (/\b(inc|corp|labs|health|bio|ai|technologies|systems|capital|ventures|bank|medical|therapeutics)\b/i.test(text)) reasons.push("company_mention");
  if (/\b(met|spoke|talked|call|founder|ceo|cfo|contact|intro|emailed)\b/i.test(text)) reasons.push("person_or_interaction");
  if (/\b(series\s+[a-z]|seed|funding|raise|runway|burn|arr|revenue|ebitda|margin|cash)\b/i.test(text)) { reasons.push("finance_signal"); facets.add("funding"); facets.add("runway_inputs"); }
  if (/\b(product|launch|announced|customer|pilot|hospital|pricing|competitor|headwind|market|news)\b/i.test(text)) { reasons.push("research_signal"); facets.add("product_news"); facets.add("recent_signal"); }
  if (/\b(verify|source|follow\s*up|ask|research|find|confirm|todo|next step|backlink|reference)\b/i.test(text)) { reasons.push("open_question_or_task"); facets.add("source_validation"); }
  if (/https:\/\//.test(text)) reasons.push("source_url");

  const candidates = [...text.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/g)]
    .map((m) => m[1])
    .filter((name) => !["Series", "Next", "The", "This", "Convex", "NodeRoom", "Need", "Follow"].includes(name));
  const displayName = candidates[0] ?? "unknown";
  const entityType = lower.includes("founder") || lower.includes("ceo") || lower.includes("cfo") ? "person" : "company";
  const score = Math.min(1, 0.18 + reasons.length * 0.18 + (candidates.length ? 0.18 : 0));

  return {
    score,
    action: score >= 0.75 ? "start_research_job" as const : score >= 0.55 ? "create_coach_cue" as const : score >= 0.35 ? "index_only" as const : "ignore" as const,
    reasons,
    facets: [...facets],
    entities: candidates.length ? [{ type: entityType, displayName, entityKey: normalizeEntityKey(displayName), confidence: Math.min(0.95, 0.55 + reasons.length * 0.1) }] : [],
  };
}

function normalizeEntityKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function asEntityType(value: string): "company" | "person" | "product" | "source" | "metric" | "unknown" {
  return value === "company" || value === "person" || value === "product" || value === "source" || value === "metric" ? value : "unknown";
}
