import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";

const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const terminalJobStatuses = new Set(["completed", "failed", "blocked", "cancelled"]);

type DbCtx = QueryCtx | MutationCtx;
type Visibility = "private" | "room" | "public";

function actorOwnsArtifact(a: { createdBy?: ActorValue }, actor: ActorValue): boolean {
  return !!a.createdBy && a.createdBy.kind === actor.kind && a.createdBy.id === actor.id;
}

function canReadArtifact(a: { visibility?: Visibility; createdBy?: ActorValue }, actor: ActorValue): boolean {
  return (a.visibility ?? "room") !== "private" || actorOwnsArtifact(a, actor);
}

function canReadAgentArtifact(row: { visibility: Visibility; ownerId?: string }, actor: ActorValue): boolean {
  return row.visibility !== "private" || row.ownerId === actor.id;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function stringFromPayload(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

async function requireReadableTargetArtifact(ctx: DbCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts"> | undefined, actor: ActorValue) {
  if (!artifactId) return null;
  const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
  if (!canReadArtifact(artifact, actor)) throw new Error("artifact_not_visible");
  return artifact;
}

async function defaultArtifactIdForRoom(ctx: QueryCtx | MutationCtx, roomId: Id<"rooms">): Promise<Id<"artifacts"> | null> {
  const artifact = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).first();
  return artifact?._id ?? null;
}

export const createAgentWorkPlan = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    requester: actorProofV,
    title: v.optional(v.string()),
    payload: v.any(),
    visibility: v.optional(visibilityV),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const target = await requireReadableTargetArtifact(ctx, args.roomId, args.artifactId, actor);
    const targetVisibility = (target?.visibility ?? "room") as Visibility;
    const visibility = args.visibility ?? targetVisibility;
    if (targetVisibility === "private" && visibility !== "private") throw new Error("private_plan_requires_private_visibility");
    const ownerId = visibility === "private" ? actor.id : undefined;
    const payloadHash = await sha256Hex(stableJson(args.payload));
    const title = (args.title ?? stringFromPayload(args.payload, "title") ?? stringFromPayload(args.payload, "goal") ?? "Agent work plan").slice(0, 200);
    const now = Date.now();
    const agentArtifactId = await ctx.db.insert("agentArtifacts", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      kind: "agent_work_plan",
      status: "proposed",
      title,
      createdBy: actor,
      visibility,
      ownerId,
      payload: args.payload,
      payloadHash,
      planHash: payloadHash,
      createdAt: now,
      updatedAt: now,
    });
    return { agentArtifactId, planHash: payloadHash, status: "proposed" as const };
  },
});

export const approveAgentWorkPlan = mutation({
  args: {
    agentArtifactId: v.id("agentArtifacts"),
    requester: actorProofV,
    planHash: v.string(),
    startJob: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.agentArtifactId);
    if (!artifact) throw new Error("agent_artifact_not_found");
    if (artifact.kind !== "agent_work_plan") throw new Error("agent_artifact_not_work_plan");
    const actor = await requireActorProof(ctx, artifact.roomId, args.requester);
    if (!canReadAgentArtifact(artifact, actor)) throw new Error("agent_artifact_not_visible");
    const actualHash = await sha256Hex(stableJson(artifact.payload));
    if (actualHash !== args.planHash || artifact.planHash !== args.planHash) throw new Error("plan_hash_mismatch");
    const now = Date.now();
    let jobId = artifact.executedJobId as Id<"agentJobs"> | undefined;
    if (args.startJob ?? true) {
      jobId = await createApprovedPlanJob(ctx, {
        agentArtifactId: args.agentArtifactId,
        roomId: artifact.roomId,
        targetArtifactId: artifact.artifactId,
        requester: actor,
        payload: artifact.payload,
        planHash: args.planHash,
        visibility: artifact.visibility,
      });
    }
    await ctx.db.patch(args.agentArtifactId, {
      status: "approved",
      approvedBy: actor,
      approvedAt: now,
      executedJobId: jobId,
      updatedAt: now,
    });
    return { ok: true as const, status: "approved" as const, jobId, planHash: args.planHash };
  },
});

export const listAgentArtifacts = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    kind: v.optional(v.union(
      v.literal("agent_work_plan"),
      v.literal("spreadsheet_diff_preview"),
      v.literal("evidence_card"),
      v.literal("coach_feedback"),
      v.literal("planned_vs_actual"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const cap = Math.max(1, Math.min(args.limit ?? 50, 100));
    const rows = args.kind
      ? await Promise.all((["draft", "proposed", "approved", "executed", "rejected", "superseded"] as const).map((status) =>
          ctx.db.query("agentArtifacts").withIndex("by_room_kind_status", (q) => q.eq("roomId", args.roomId).eq("kind", args.kind!).eq("status", status)).order("desc").take(cap)
        ))
      : [
          await ctx.db.query("agentArtifacts").withIndex("by_room_visibility_updated", (q) => q.eq("roomId", args.roomId).eq("visibility", "room")).order("desc").take(cap),
          await ctx.db.query("agentArtifacts").withIndex("by_room_visibility_updated", (q) => q.eq("roomId", args.roomId).eq("visibility", "public")).order("desc").take(cap),
          await ctx.db.query("agentArtifacts").withIndex("by_room_visibility_owner", (q) => q.eq("roomId", args.roomId).eq("visibility", "private").eq("ownerId", actor.id)).order("desc").take(cap),
        ];
    return rows.flat().filter((row) => canReadAgentArtifact(row, actor)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, cap);
  },
});

async function createApprovedPlanJob(ctx: MutationCtx, args: {
  agentArtifactId: Id<"agentArtifacts">;
  roomId: Id<"rooms">;
  targetArtifactId?: Id<"artifacts">;
  requester: ActorValue;
  payload: unknown;
  planHash: string;
  visibility: Visibility;
}): Promise<Id<"agentJobs">> {
  const artifactId = args.targetArtifactId ?? await defaultArtifactIdForRoom(ctx, args.roomId);
  if (!artifactId) throw new Error("room_has_no_artifact_for_plan");
  const idempotencyKey = `agent-work-plan:${String(args.roomId)}:${args.planHash}`;
  const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
  const reusable = prior.find((job) => String(job.roomId) === String(args.roomId) && !terminalJobStatuses.has(job.status));
  if (reusable) return reusable._id;
  const now = Date.now();
  const goal = (stringFromPayload(args.payload, "goal") ?? stringFromPayload(args.payload, "title") ?? "Run approved agent work plan").slice(0, 2_000);
  const scope = args.visibility === "private" ? "private_user" as const : "public_room" as const;
  const jobId = await ctx.db.insert("agentJobs", {
    roomId: args.roomId,
    artifactId,
    requester: args.requester,
    goal,
    entrypoint: "public_ask",
    scope,
    commandText: goal,
    request: {
      source: "agent_artifact",
      agentArtifactId: String(args.agentArtifactId),
      approvedPlanHash: args.planHash,
      planHash: args.planHash,
      payload: args.payload,
    },
    priority: 0,
    approvalPolicy: args.visibility === "private" ? "draft_first" : "host_review",
    evidencePolicy: args.visibility === "private" ? "private_allowed" : "public_only",
    autoAllow: false,
    traceLevel: "full_operation_ledger",
    routePolicy: "explicit",
    runtimePolicy: "workflow_sliced",
    idempotencyKey,
    mode: "research",
    status: "queued",
    modelPolicy: "approved-plan",
    runtime: "workflow",
    attempts: 0,
    maxAttempts: 20,
    actionSliceCount: 0,
    queryCount: 0,
    mutationCount: 1,
    modelCallCount: 0,
    toolCallCount: 0,
    schedulerHandoffCount: 0,
    receiptCount: 0,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("agentOperationEvents", {
    jobId,
    sequence: 1,
    kind: "mutation",
    name: "agentArtifacts.approveAgentWorkPlan",
    targetKind: "artifact",
    targetId: String(args.agentArtifactId),
    inputHash: args.planHash,
    status: "completed",
    countDelta: 1,
    affectedIds: [String(args.agentArtifactId), String(jobId), String(artifactId)],
    startedAt: now,
    completedAt: now,
  });
  return jobId;
}
