import { v } from "convex/values";
import { cancel as cancelWorkflow, start as startWorkflow } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, requireArtifactInRoom, type ActorValue } from "./lib";
import { assertCreateArtifactLimits } from "./artifacts";
import { syncSpreadsheetIndexFromSeed } from "./spreadsheetIndexLib";
import { classifyIntakeMessage, buildPlanPreview } from "../src/nodeagent/core/intakePreflight";
import { buildRoomWorkReasoningPlan, roomWorkFacetFrameId, roomWorkPhaseFrameId, DEEP_DIVE_TOOL_ALLOWLIST, FRAME_TOOL_ALLOWLIST, type ReasoningFramePlan } from "../src/nodeagent/core/reasoningFrames";
import {
  FREE_FILE_EGRESS_BLOCK_REASON,
  freeFileEgressPromotionAllowed,
  isOpenRouterFreeRoute,
  providerEgressDecision,
  type ProviderEgressArtifact,
} from "../src/nodeagent/guardrails/egressPolicy";
import { parseBulkCompanyIngest } from "../src/nodeagent/skills/finance/bulkIngest";

// BOUND: cap a single bulk-diligence fan-out so one command can't enqueue unbounded jobs.
const MAX_BULK_COMPANIES = 50;
const DEFAULT_FILE_EGRESS_MODEL = "z-ai/glm-4.7-flash";
function companyKeyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const attemptStatusV = v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("blocked"), v.literal("failed"));
const terminalStatuses = new Set(["completed", "failed", "blocked", "cancelled"]);
const entrypointV = v.union(
  v.literal("public_ask"),
  v.literal("private_agent"),
  v.literal("free"),
  v.literal("system"),
  v.literal("automation"),
  v.literal("provider_parser"),
  v.literal("room_work"),
);
const agentScopeV = v.union(v.literal("public_room"), v.literal("private_user"), v.literal("team"));
const approvalPolicyV = v.union(v.literal("read_only"), v.literal("draft_first"), v.literal("auto_commit_safe"), v.literal("host_review"));
const evidencePolicyV = v.union(v.literal("public_only"), v.literal("private_allowed"), v.literal("mixed_requires_redaction"));
const traceLevelV = v.union(v.literal("summary"), v.literal("standard"), v.literal("full_operation_ledger"));
const routePolicyV = v.union(v.literal("fast_default"), v.literal("free_auto"), v.literal("top_paid"), v.literal("explicit"));
const runtimePolicyV = v.union(v.literal("workflow_sliced"));
const runtimeProfileV = v.union(v.literal("benchmark_completion"));
const publicAskReferenceV = v.object({
  id: v.string(),
  title: v.optional(v.string()),
  kind: v.optional(v.string()),
});
const operationEventKindV = v.union(
  v.literal("action"),
  v.literal("query"),
  v.literal("mutation"),
  v.literal("model_call"),
  v.literal("tool_call"),
  v.literal("scheduler"),
  v.literal("lease"),
  v.literal("checkpoint"),
);
const operationStatusV = v.union(v.literal("started"), v.literal("completed"), v.literal("failed"), v.literal("skipped"));
const agentStreamEventKindV = v.union(
  v.literal("message_start"),
  v.literal("step_start"),
  v.literal("text_delta"),
  v.literal("tool_call_start"),
  v.literal("tool_call_result"),
  v.literal("artifact_update"),
  v.literal("warning"),
  v.literal("error"),
  v.literal("message_done"),
  v.literal("reasoning"),
  v.literal("plan"),
);
const agentStreamEventStatusV = v.union(v.literal("started"), v.literal("streaming"), v.literal("completed"), v.literal("failed"), v.literal("skipped"));
const roomWorkModeV = v.union(
  v.literal("manual_capture"),
  v.literal("agent_fill"),
  v.literal("bulk_diligence"),
  v.literal("banker_workflow"),
  v.literal("spreadsheet_fill"),
);
const entityTypeV = v.union(
  v.literal("company"),
  v.literal("person"),
  v.literal("product"),
  v.literal("source"),
  v.literal("metric"),
  v.literal("unknown"),
);
const cacheVisibilityV = v.union(v.literal("public"), v.literal("private"), v.literal("redacted"));
const entityCacheStatusV = v.union(v.literal("fresh"), v.literal("stale"), v.literal("refreshing"), v.literal("needs_review"), v.literal("gap"));
const deltaStatusV = v.union(v.literal("none"), v.literal("minor"), v.literal("material"), v.literal("contradiction"));

type EntityType = "company" | "person" | "product" | "source" | "metric" | "unknown";
type CacheVisibility = "public" | "private" | "redacted";
type RoomWorkMode = "manual_capture" | "agent_fill" | "bulk_diligence" | "banker_workflow" | "spreadsheet_fill";
type NormalizedRoomWorkEntity = { entityType: EntityType; entityKey: string; displayName: string; website?: string };
type EntityFacetCacheHit = {
  cacheId: Id<"entityResearchCache">;
  entityType: EntityType;
  entityKey: string;
  displayName: string;
  facet: string;
  status: string;
  fresh: boolean;
  visibility: CacheVisibility;
  ownerId?: string;
  validUntil?: number;
  staleAfter?: number;
  updatedAt: number;
  result: unknown;
};
type RoomWorkStaleFacet = { entityType: EntityType; entityKey: string; displayName: string; facet: string };
type RoomWorkCacheSummary = { fresh: number; stale: number; missing: number; manual: number; queued: number; cached: number; refreshing: number; completed: number };
type RoomWorkStartResult = {
  ok: true;
  cacheOnly: boolean;
  reused: boolean;
  status: string;
  jobId?: Id<"agentJobs">;
  workflowId?: string;
  normalizedEntities: NormalizedRoomWorkEntity[];
  facets: string[];
  cacheHits: EntityFacetCacheHit[];
  staleFacets: RoomWorkStaleFacet[];
  workItems?: Array<Record<string, unknown>>;
  cacheSummary?: RoomWorkCacheSummary;
};
type RoomWorkFacetPlan = {
  entityType: EntityType;
  entityKey: string;
  displayName: string;
  facet: string;
  cacheHit?: EntityFacetCacheHit | null;
  cachePolicy: "fresh_use_cache" | "stale_use_cache_and_refresh" | "missing_research_now" | "manual_only_do_not_research";
  status: "queued" | "cached" | "refreshing" | "completed";
};

const MAX_ROOM_WORK_TEXT_CHARS = 20_000;
const MAX_ROOM_WORK_ENTITIES = 50;
const MAX_ROOM_WORK_FACETS = 16;
const DEFAULT_MANUAL_CAPTURE_FACETS = ["company_profile", "person_profile", "recent_signal"] as const;
const DEFAULT_DILIGENCE_FACETS = ["company_profile", "funding", "headcount", "recent_signal", "product_news", "runway_inputs"] as const;

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

function capStreamText(value: string | undefined, limit = 12_000): string | undefined {
  if (value === undefined) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]` : value;
}

function compactStreamPayload(value: unknown, limit = 4_000): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return capStreamText(value, limit);
  let encoded = "";
  try {
    encoded = stableJson(value);
  } catch {
    encoded = String(value);
  }
  return encoded.length > limit ? `${encoded.slice(0, limit)}...[truncated ${encoded.length - limit} chars]` : value;
}

const MAX_JOB_CONTINUATION_CHARS = 240_000;
const MAX_JOB_MESSAGE_CONTENT_CHARS = 6_000;
const MAX_JOB_TOOL_ARGS_CHARS = 4_000;
const MAX_JOB_CURSOR_MESSAGES = 24;
const MAX_JOB_REMAINING_TOOL_CALLS = 16;

function encodedSize(value: unknown): number {
  try {
    return stableJson(value).length;
  } catch {
    return String(value).length;
  }
}

function compactJobToolCall(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return compactStreamPayload(value, MAX_JOB_TOOL_ARGS_CHARS);
  const record = value as Record<string, unknown>;
  return clean({
    id: typeof record.id === "string" ? record.id : undefined,
    tool: typeof record.tool === "string" ? record.tool : undefined,
    args: compactStreamPayload(record.args, MAX_JOB_TOOL_ARGS_CHARS),
  });
}

function compactJobMessage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return compactStreamPayload(value, MAX_JOB_MESSAGE_CONTENT_CHARS);
  const record = value as Record<string, unknown>;
  return clean({
    role: record.role,
    content: typeof record.content === "string" ? capStreamText(record.content, MAX_JOB_MESSAGE_CONTENT_CHARS) : compactStreamPayload(record.content, MAX_JOB_MESSAGE_CONTENT_CHARS),
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls.slice(0, MAX_JOB_REMAINING_TOOL_CALLS).map(compactJobToolCall) : undefined,
  });
}

function compactJobContinuation(value: unknown, limit = MAX_JOB_CONTINUATION_CHARS): unknown {
  if (value === undefined || encodedSize(value) <= limit) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return compactStreamPayload(value, limit);
  const record = value as Record<string, unknown>;
  const messages = Array.isArray(record.messages) ? record.messages : undefined;
  const remainingToolCalls = Array.isArray(record.remainingToolCalls) ? record.remainingToolCalls : undefined;
  const selectedMessages = messages
    ? [
      ...messages.slice(0, 1),
      ...messages.slice(Math.max(1, messages.length - (MAX_JOB_CURSOR_MESSAGES - 1))),
    ].map(compactJobMessage)
    : undefined;
  const compacted = clean({
    ...record,
    messages: selectedMessages,
    remainingToolCalls: remainingToolCalls?.slice(0, MAX_JOB_REMAINING_TOOL_CALLS).map(compactJobToolCall),
    latestAssistantText: typeof record.latestAssistantText === "string" ? capStreamText(record.latestAssistantText, MAX_JOB_MESSAGE_CONTENT_CHARS) : undefined,
    summary: typeof record.summary === "string" ? capStreamText(record.summary, MAX_JOB_MESSAGE_CONTENT_CHARS) : undefined,
    nextGoal: typeof record.nextGoal === "string" ? capStreamText(record.nextGoal, MAX_JOB_MESSAGE_CONTENT_CHARS) : undefined,
    compacted: true,
    beforeJobRowChars: encodedSize(value),
  });
  return encodedSize(compacted) <= limit ? compacted : compactStreamPayload(compacted, limit);
}

function defaultJobIdempotencyKey(args: { roomId: unknown; artifactId: unknown; actorId: string; goal: string; entrypoint: string; runtimeProfile?: AgentRuntimeProfile }) {
  const normalizedGoal = args.goal.trim().replace(/\s+/g, " ").toLowerCase();
  const profileSuffix = args.runtimeProfile ? `:${args.runtimeProfile}` : "";
  return `${args.entrypoint}:${String(args.roomId)}:${String(args.artifactId)}:${args.actorId}:${normalizedGoal}${profileSuffix}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeFacet(facet: string): string {
  return facet.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_:-]/g, "").slice(0, 80);
}

function displayNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "");
}

function entityKeyOf(entityType: EntityType, name: string): string {
  return entityType === "company" ? companyKeyOf(name) : displayNameKey(name);
}

function cleanEntityDisplayName(value: string): string {
  return value
    .replace(/[()[\]{}"']/g, "")
    .replace(/\b(and|or|for|with|about|from|then|next|first|bulk|batch)\b.*$/i, "")
    .replace(/[.,;:|/\\]+$/g, "")
    .trim()
    .slice(0, 120);
}

function defaultRoomWorkFacets(mode: RoomWorkMode): string[] {
  return [...(mode === "manual_capture" ? DEFAULT_MANUAL_CAPTURE_FACETS : DEFAULT_DILIGENCE_FACETS)];
}

function freshnessMsForFacet(facet: string): number {
  if (facet.includes("recent") || facet.includes("news") || facet.includes("signal")) return 12 * 60 * 60 * 1000;
  if (facet.includes("funding") || facet.includes("headcount") || facet.includes("hiring")) return 24 * 60 * 60 * 1000;
  if (facet.includes("runway") || facet.includes("cash") || facet.includes("burn")) return 7 * 24 * 60 * 60 * 1000;
  if (facet.includes("profile") || facet.includes("identity")) return 30 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function normalizeRequestedFacets(inputFacets: string[] | undefined, mode: RoomWorkMode): string[] {
  const source = inputFacets?.length ? inputFacets : defaultRoomWorkFacets(mode);
  const out: string[] = [];
  for (const raw of source) {
    const facet = normalizeFacet(raw);
    if (!facet || out.includes(facet)) continue;
    out.push(facet);
    if (out.length >= MAX_ROOM_WORK_FACETS) break;
  }
  return out.length ? out : defaultRoomWorkFacets(mode);
}

function normalizeRoomWorkEntities(input: {
  kind?: string;
  text?: string;
  companies?: Array<{ name: string; website?: string }>;
  entityHints?: Array<{ entityType?: EntityType; name: string; website?: string }>;
}, mode: RoomWorkMode): NormalizedRoomWorkEntity[] {
  const entities: NormalizedRoomWorkEntity[] = [];
  const seen = new Set<string>();
  const add = (entityType: EntityType, rawName: string, website?: string) => {
    const displayName = cleanEntityDisplayName(rawName);
    if (!displayName) return;
    const entityKey = entityKeyOf(entityType, displayName);
    if (!entityKey) return;
    const key = `${entityType}:${entityKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(clean({ entityType, entityKey, displayName, website }) as NormalizedRoomWorkEntity);
  };

  for (const hint of input.entityHints ?? []) add(hint.entityType ?? "company", hint.name, hint.website);
  for (const company of input.companies ?? []) add("company", company.name, company.website);

  const text = input.text?.trim() ?? "";
  if (text && (mode === "bulk_diligence" || input.kind === "bulk_companies" || input.kind === "company_list" || /\r?\n/.test(text))) {
    for (const row of parseBulkCompanyIngest(text)) add("company", row.company, row.website);
  }

  if (text && entities.length === 0) {
    const patterns = [
      /\bat\s+([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4})/g,
      /\bcompany\s+([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4})/g,
      /\baccount\s+([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4})/g,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) add("company", match[1] ?? "");
    }
  }

  if (text && entities.length === 0) {
    add("unknown", `manual-intake-${hashString(text).slice(0, 10)}`);
  }
  return entities.slice(0, MAX_ROOM_WORK_ENTITIES);
}

function cacheOwnerForVisibility(visibility: CacheVisibility, actor: ActorValue, ownerId?: string): string | undefined {
  if (visibility !== "private") return undefined;
  if (ownerId && ownerId !== actor.id) throw new Error("private_cache_owner_mismatch");
  return actor.id;
}

function canReadEntityCache(row: { visibility: CacheVisibility; ownerId?: string }, actor: ActorValue): boolean {
  return row.visibility !== "private" || row.ownerId === actor.id;
}

function entityCacheIsFresh(row: { status: string; validUntil?: number; staleAfter?: number; deltaStatus?: string }, now: number): boolean {
  if (row.status !== "fresh") return false;
  if (row.deltaStatus === "material" || row.deltaStatus === "contradiction") return false;
  return (row.validUntil ?? row.staleAfter ?? 0) > now;
}

function cacheHitKey(entity: NormalizedRoomWorkEntity, facet: string): string {
  return `${entity.entityType}:${entity.entityKey}:${facet}`;
}

async function findEntityFacetCacheRows(ctx: any, args: {
  roomId: unknown;
  actor: ActorValue;
  entityType: EntityType;
  entityKey: string;
  facet: string;
}) {
  const rows = [];
  for (const visibility of ["public", "redacted", "private"] as const) {
    const found = await ctx.db.query("entityResearchCache")
      .withIndex("by_room_entity_facet", (q: any) => q
        .eq("roomId", args.roomId)
        .eq("visibility", visibility)
        .eq("entityType", args.entityType)
        .eq("entityKey", args.entityKey)
        .eq("facet", args.facet))
      .collect();
    rows.push(...found.filter((row: { visibility: CacheVisibility; ownerId?: string }) => canReadEntityCache(row, args.actor)));
  }
  return rows.sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt);
}

/** READ-ONLY cache lookup — shared by the public lookupEntityResearchCache
 *  QUERY and mutation flows, so it must never write. Usage-recency touches
 *  (lastUsedAt) are mutation-owned: see markEntityFacetCacheUsed. */
async function lookupEntityFacetCache(ctx: any, args: {
  roomId: unknown;
  actor: ActorValue;
  entity: NormalizedRoomWorkEntity;
  facet: string;
  now: number;
}): Promise<EntityFacetCacheHit | null> {
  const [row] = await findEntityFacetCacheRows(ctx, {
    roomId: args.roomId,
    actor: args.actor,
    entityType: args.entity.entityType,
    entityKey: args.entity.entityKey,
    facet: args.facet,
  });
  if (!row) return null;
  return {
    cacheId: row._id,
    entityType: row.entityType,
    entityKey: row.entityKey,
    displayName: row.displayName,
    facet: row.facet,
    status: row.status,
    fresh: entityCacheIsFresh(row, args.now),
    visibility: row.visibility,
    ownerId: row.ownerId,
    validUntil: row.validUntil,
    staleAfter: row.staleAfter,
    updatedAt: row.updatedAt,
    result: row.result,
  };
}

async function artifactPlanPreview(ctx: any, args: { roomId: unknown; artifactId: unknown; goal: string }) {
  const intake = classifyIntakeMessage(args.goal);
  const elementIds = (await ctx.db.query("elements").withIndex("by_artifact", (q: any) => q.eq("artifactId", args.artifactId)).collect()).map((e: { elementId: string }) => e.elementId);
  const pendingProposalRefs = (await ctx.db.query("proposals").withIndex("by_room_status", (q: any) => q.eq("roomId", args.roomId).eq("status", "pending")).collect())
    .filter((p: { artifactId: unknown }) => String(p.artifactId) === String(args.artifactId))
    .map((p: { op: { elementId?: string } | null }) => p.op?.elementId)
    .filter((id: unknown): id is string => typeof id === "string");
  return buildPlanPreview({
    decision: intake,
    targetArtifacts: [String(args.artifactId)],
    intendedWriteSet: elementIds,
    pendingProposals: pendingProposalRefs,
  });
}

function roomWorkIdempotencyKey(args: {
  roomId: unknown;
  artifactId: unknown;
  actorId: string;
  mode: RoomWorkMode;
  entities: NormalizedRoomWorkEntity[];
  facets: string[];
}) {
  const entitySignature = args.entities.map((e) => `${e.entityType}:${e.entityKey}`).sort().join(",");
  const facetSignature = args.facets.slice().sort().join(",");
  return `roomwork:${String(args.roomId)}:${String(args.artifactId)}:${args.actorId}:${args.mode}:${entitySignature}:${facetSignature}`;
}

async function insertEntityWorkItems(ctx: any, args: {
  roomId: unknown;
  artifactId: unknown;
  jobId: unknown;
  actor: ActorValue;
  mode: RoomWorkMode;
  idempotencyKey: string;
  plans: RoomWorkFacetPlan[];
  now: number;
}) {
  const out = [];
  for (const plan of args.plans) {
    const workItemId = await ctx.db.insert("entityWorkItems", clean({
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      requester: args.actor,
      visibility: plan.cacheHit?.visibility ?? "public",
      ownerId: plan.cacheHit?.ownerId,
      entityType: plan.entityType,
      entityKey: plan.entityKey,
      displayName: plan.displayName,
      facet: plan.facet,
      cacheId: plan.cacheHit?.cacheId,
      status: plan.status,
      cachePolicy: plan.cachePolicy,
      idempotencyKey: `roomworkitem:${args.idempotencyKey}:${plan.entityType}:${plan.entityKey}:${plan.facet}`,
      plan: {
        source: "room_work_intake",
        reasoningFrameId: plan.cachePolicy === "fresh_use_cache" || plan.cachePolicy === "manual_only_do_not_research"
          ? roomWorkPhaseFrameId({ framePlanId: args.idempotencyKey, phase: "execute", mode: args.mode })
          : roomWorkFacetFrameId({ framePlanId: args.idempotencyKey, entityType: plan.entityType, entityKey: plan.entityKey, facet: plan.facet }),
        cacheFresh: plan.cacheHit?.fresh ?? false,
        validUntil: plan.cacheHit?.validUntil,
        staleAfter: plan.cacheHit?.staleAfter,
      },
      resultRef: plan.cacheHit ? { cacheId: String(plan.cacheHit.cacheId), status: plan.cacheHit.status } : undefined,
      createdAt: args.now,
      updatedAt: args.now,
      completedAt: plan.status === "cached" || plan.status === "completed" ? args.now : undefined,
    }));
    out.push({
      _id: workItemId,
      entityType: plan.entityType,
      entityKey: plan.entityKey,
      displayName: plan.displayName,
      facet: plan.facet,
      cachePolicy: plan.cachePolicy,
      status: plan.status,
      cacheId: plan.cacheHit?.cacheId,
    });
  }
  return out;
}

async function materializeReasoningFrames(ctx: any, args: {
  roomId: unknown;
  artifactId: unknown;
  jobId: unknown;
  plan: ReasoningFramePlan;
  now: number;
}) {
  const rows: Array<{ _id: unknown; frameId: string; frameKind: "phase" | "child"; sequence: number }> = [];
  let sequence = 1;
  for (const frame of args.plan.frames) {
    const frameRowId = await ctx.db.insert("agentReasoningFrames", clean({
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: args.plan.framePlanId,
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      sequence,
      frameKind: "phase",
      phase: frame.phase,
      status: frame.status,
      goal: frame.goal,
      contextPack: frame.contextPack,
      toolAllowlist: frame.toolAllowlist,
      stateDelta: frame.stateDelta,
      evidenceState: frame.evidenceState,
      createdAt: args.now,
      updatedAt: args.now,
      completedAt: frame.status === "completed" || frame.status === "blocked" || frame.status === "skipped" ? args.now : undefined,
    }));
    rows.push({ _id: frameRowId, frameId: frame.frameId, frameKind: "phase", sequence });
    sequence += 1;
  }
  for (const child of args.plan.childFrames) {
    const contextPack = {
      globalGoal: args.plan.globalGoal,
      parentSummary: `Child frame of ${child.parentFrameId}`,
      currentArtifactDigest: `artifact:${String(args.artifactId)}; entity:${child.entityType}:${child.entityKey}; facet:${child.facet}`,
      relevantOkfConceptIds: [],
      relevantCacheKeys: [child.cacheKey],
      openQuestions: child.status === "completed" ? [] : [`Resolve ${child.facet} for ${child.displayName}`],
      constraints: [
        "Child frames inherit only compact parent context, never the full transcript.",
        "Use the cache key before provider calls.",
        "Return evidence-bearing results that match the expected schema.",
        "Do not write outside the granted entity/facet target.",
      ],
      expectedOutputSchema: child.expectedOutputSchema,
    };
    const frameRowId = await ctx.db.insert("agentReasoningFrames", clean({
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: args.plan.framePlanId,
      frameId: child.frameId,
      parentFrameId: child.parentFrameId,
      sequence,
      frameKind: "child",
      phase: "execute",
      status: child.status,
      goal: child.goal,
      contextPack,
      toolAllowlist: child.toolAllowlist,
      cacheKey: child.cacheKey,
      entityType: child.entityType,
      entityKey: child.entityKey,
      displayName: child.displayName,
      facet: child.facet,
      cachePolicy: child.cachePolicy,
      expectedOutputSchema: child.expectedOutputSchema,
      createdAt: args.now,
      updatedAt: args.now,
      completedAt: child.status === "completed" || child.status === "blocked" || child.status === "skipped" ? args.now : undefined,
    }));
    rows.push({ _id: frameRowId, frameId: child.frameId, frameKind: "child", sequence });
    sequence += 1;
  }
  return rows;
}

type DurableReasoningFrameStatus = "pending" | "running" | "completed" | "blocked" | "skipped" | "failed";

type DurableReasoningFrameRow = {
  _id: unknown;
  framePlanId: string;
  frameId: string;
  parentFrameId?: string;
  sequence: number;
  frameKind: "phase" | "child";
  phase: "intake" | "plan" | "execute" | "verify" | "synthesize";
  status: DurableReasoningFrameStatus;
  goal: string;
  contextPack: unknown;
  toolAllowlist: string[];
  stateDelta?: unknown;
  evidenceState?: unknown;
  cacheKey?: string;
  entityType?: EntityType;
  entityKey?: string;
  displayName?: string;
  facet?: string;
  cachePolicy?: string;
  expectedOutputSchema?: string;
  resultRef?: unknown;
  error?: string;
};

function durableFrameIsOpen(frame: { status: DurableReasoningFrameStatus }) {
  return frame.status === "pending" || frame.status === "running";
}

function framePayload(frame: DurableReasoningFrameRow) {
  return clean({
    rowId: frame._id,
    framePlanId: frame.framePlanId,
    frameId: frame.frameId,
    parentFrameId: frame.parentFrameId,
    sequence: frame.sequence,
    frameKind: frame.frameKind,
    phase: frame.phase,
    status: frame.status,
    goal: frame.goal,
    contextPack: frame.contextPack,
    toolAllowlist: frame.toolAllowlist,
    stateDelta: frame.stateDelta,
    evidenceState: frame.evidenceState,
    cacheKey: frame.cacheKey,
    entityType: frame.entityType,
    entityKey: frame.entityKey,
    displayName: frame.displayName,
    facet: frame.facet,
    cachePolicy: frame.cachePolicy,
    expectedOutputSchema: frame.expectedOutputSchema,
    resultRef: frame.resultRef,
    error: frame.error,
  });
}

function chooseRunnableReasoningFrame(frames: DurableReasoningFrameRow[]) {
  const pending = frames.filter((frame) => frame.status === "pending");
  return pending.find((frame) => frame.frameKind === "child")
    ?? pending.find((frame) => frame.phase === "execute")
    ?? pending.find((frame) => frame.phase === "verify")
    ?? pending.find((frame) => frame.phase === "synthesize")
    ?? pending[0];
}

async function claimReasoningFrameForSlice(ctx: any, args: { jobId: unknown; now: number }) {
  const frames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q: any) => q.eq("jobId", args.jobId)).collect();
  const frame = chooseRunnableReasoningFrame(frames as DurableReasoningFrameRow[]);
  if (!frame) return { affectedIds: [] as string[], frame: undefined };
  await ctx.db.patch(frame._id, { status: "running", updatedAt: args.now });
  return {
    affectedIds: [frame.frameId],
    frame: framePayload({ ...frame, status: "running" }),
  };
}

async function setReasoningFramesForSliceFinish(ctx: any, args: {
  jobId: unknown;
  status: "completed" | "handoff" | "retrying" | "blocked" | "failed" | "cancelled" | "lease_expired";
  now: number;
  frameId?: string;
  frameStatus?: DurableReasoningFrameStatus;
  frameDelta?: unknown;
  frameEvidenceState?: unknown;
  frameResultRef?: unknown;
  error?: string;
}) {
  const job = await ctx.db.get(args.jobId);
  const frames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q: any) => q.eq("jobId", args.jobId)).collect() as DurableReasoningFrameRow[];
  const affectedIds: string[] = [];
  const activeFrameId = args.frameId ?? job?.activeFrameId;

  if (activeFrameId && args.status !== "cancelled" && args.status !== "lease_expired") {
    const frame = frames.find((candidate) => candidate.frameId === activeFrameId);
    let appliedStatus: DurableReasoningFrameStatus | undefined;
    if (frame) {
      appliedStatus = args.frameStatus
        ?? (args.status === "completed" ? "completed"
          : args.status === "blocked" ? "blocked"
          : args.status === "handoff" || args.status === "retrying" ? "pending"
          : "failed");
      affectedIds.push(frame.frameId);
      await ctx.db.patch(frame._id, clean({
        status: appliedStatus,
        updatedAt: args.now,
        completedAt: appliedStatus === "completed" || appliedStatus === "blocked" || appliedStatus === "skipped" || appliedStatus === "failed" ? args.now : undefined,
        stateDelta: args.frameDelta,
        evidenceState: args.frameEvidenceState,
        resultRef: args.frameResultRef,
        error: appliedStatus === "failed" || appliedStatus === "blocked" ? args.error ?? args.status : undefined,
      }));
    }
    const openFrameIds = frames
      .map((candidate) => candidate.frameId === activeFrameId && appliedStatus ? { ...candidate, status: appliedStatus } : candidate)
      .filter(durableFrameIsOpen)
      .map((candidate) => candidate.frameId);
    return {
      affectedIds,
      activeFrameId,
      frameStatus: appliedStatus,
      openFrameIds,
      hasOpenFrames: openFrameIds.length > 0,
      allFramesTerminal: frames.length > 0 && openFrameIds.length === 0,
    };
  }

  const resultingFrames: DurableReasoningFrameRow[] = [];
  for (const frame of frames) {
    let status: DurableReasoningFrameStatus | undefined;
    if (args.status === "completed") {
      status = frame.status === "completed" ? undefined : "completed";
    } else if (args.status === "handoff" || args.status === "retrying") {
      status = frame.status === "running" ? "pending" : undefined;
    } else if (args.status === "cancelled") {
      status = frame.status === "completed" ? undefined : "skipped";
    } else {
      status = frame.status === "completed" ? undefined : "failed";
    }
    resultingFrames.push(status ? { ...frame, status } : frame);
    if (!status) continue;
    affectedIds.push(frame.frameId);
    await ctx.db.patch(frame._id, clean({
      status,
      updatedAt: args.now,
      completedAt: status === "completed" || status === "skipped" || status === "failed" ? args.now : undefined,
      error: status === "failed" ? args.error ?? args.status : undefined,
    }));
  }
  const openFrameIds = resultingFrames.filter(durableFrameIsOpen).map((frame) => frame.frameId);
  return { affectedIds, openFrameIds, hasOpenFrames: openFrameIds.length > 0, allFramesTerminal: frames.length > 0 && openFrameIds.length === 0 };
}

function summarizeEntityWorkPlans(plans: Array<{ cachePolicy: string; status: string }>) {
  const out = { fresh: 0, stale: 0, missing: 0, manual: 0, queued: 0, cached: 0, refreshing: 0, completed: 0 };
  for (const plan of plans) {
    if (plan.cachePolicy === "fresh_use_cache") out.fresh += 1;
    else if (plan.cachePolicy === "stale_use_cache_and_refresh") out.stale += 1;
    else if (plan.cachePolicy === "missing_research_now") out.missing += 1;
    else if (plan.cachePolicy === "manual_only_do_not_research") out.manual += 1;
    if (plan.status in out) out[plan.status as keyof typeof out] += 1;
  }
  return out;
}

type ArtifactAccess = { visibility?: "private" | "room" | "public"; createdBy?: ActorValue };
type JobAccess = {
  requester: ActorValue;
  scope?: "public_room" | "private_user" | "team";
  entrypoint?: "public_ask" | "private_agent" | "free" | "system" | "automation" | "provider_parser" | "room_work";
};

function actorOwnsArtifact(artifact: ArtifactAccess, actor: ActorValue): boolean {
  if (!artifact.createdBy) return false;
  if (artifact.createdBy.kind === actor.kind && artifact.createdBy.id === actor.id) return true;
  return actor.kind === "agent" && !!actor.ownerId && artifact.createdBy.kind === "user" && artifact.createdBy.id === actor.ownerId;
}

function requireJobArtifactAccess(artifact: ArtifactAccess, actor: ActorValue, opts?: { allowPrivate?: boolean }) {
  if ((artifact.visibility ?? "room") !== "private") return;
  if (!actorOwnsArtifact(artifact, actor)) throw new Error("artifact_not_visible");
  if (!opts?.allowPrivate) throw new Error("private_artifact_requires_private_job");
}

function actorOwnsJob(job: JobAccess, actor: ActorValue): boolean {
  if (job.requester.kind === actor.kind && job.requester.id === actor.id) return true;
  return actor.kind === "agent" && !!actor.ownerId && job.requester.kind === "user" && job.requester.id === actor.ownerId;
}

function canReadJob(job: JobAccess, actor: ActorValue): boolean {
  if (job.scope === "private_user" || job.entrypoint === "private_agent") return actorOwnsJob(job, actor);
  return true;
}

async function recordOperationEvent(ctx: any, args: {
  jobId: string;
  runId?: string;
  sequence: number;
  kind: "action" | "query" | "mutation" | "model_call" | "tool_call" | "scheduler" | "lease" | "checkpoint";
  name: string;
  targetKind?: "notebook" | "node" | "relation" | "artifact" | "element" | "range" | "wiki_page" | "wiki_block" | "reasoning_frame";
  targetId?: string;
  status?: "started" | "completed" | "failed" | "skipped";
  countDelta?: number;
  affectedIds?: string[];
  startedAt?: number;
  completedAt?: number;
}) {
  const now = Date.now();
  await ctx.db.insert("agentOperationEvents", clean({
    jobId: args.jobId,
    runId: args.runId,
    sequence: args.sequence,
    kind: args.kind,
    name: args.name,
    targetKind: args.targetKind,
    targetId: args.targetId,
    status: args.status ?? "completed",
    countDelta: args.countDelta,
    affectedIds: args.affectedIds,
    startedAt: args.startedAt ?? now,
    completedAt: args.completedAt ?? now,
  }));
}

async function recordStreamEventRow(ctx: any, args: {
  jobId: string;
  runId?: string;
  sequence: number;
  kind: "message_start" | "step_start" | "text_delta" | "tool_call_start" | "tool_call_result" | "artifact_update" | "warning" | "error" | "message_done" | "reasoning" | "plan";
  step?: number;
  toolCallId?: string;
  toolName?: string;
  status?: "started" | "streaming" | "completed" | "failed" | "skipped";
  text?: string;
  title?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: unknown;
  createdAt?: number;
}) {
  const job = await ctx.db.get(args.jobId);
  if (!job) return { ok: false as const, reason: "job_not_found" as const };
  const existing = await ctx.db.query("agentStreamEvents").withIndex("by_job_sequence", (q: any) => q.eq("jobId", args.jobId).eq("sequence", args.sequence)).take(1);
  if (existing.length) return { ok: true as const, reused: true as const };
  const now = Date.now();
  const eventId = await ctx.db.insert("agentStreamEvents", clean({
    jobId: args.jobId,
    roomId: job.roomId,
    runId: args.runId,
    sequence: args.sequence,
    kind: args.kind,
    step: args.step,
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    status: args.status,
    text: capStreamText(args.text),
    title: capStreamText(args.title, 500),
    input: compactStreamPayload(args.input),
    output: compactStreamPayload(args.output),
    error: capStreamText(args.error, 2_000),
    metadata: compactStreamPayload(args.metadata, 2_000),
    createdAt: args.createdAt ?? now,
  }));
  // P0: Do NOT patch agentJobs here — the append-only agentStreamEvents row is sufficient.
  // Patching the hot agentJobs document on every stream event caused 7,345+ OCC conflicts.
  // updatedAt is reconciled at slice finish (finishInteractive / recordWorkflowComplete).
  return { ok: true as const, eventId };
}

async function nextStreamSequence(ctx: any, jobId: string, floor: number): Promise<number> {
  const latest = await ctx.db.query("agentStreamEvents").withIndex("by_job_sequence", (q: any) => q.eq("jobId", jobId)).order("desc").take(1);
  return Math.max(floor, (latest[0]?.sequence ?? 0) + 1);
}

export const recordStreamEvent = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    sequence: v.number(),
    kind: agentStreamEventKindV,
    step: v.optional(v.number()),
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    status: v.optional(agentStreamEventStatusV),
    text: v.optional(v.string()),
    title: v.optional(v.string()),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => recordStreamEventRow(ctx, a),
});

export const createOrReuse = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    entrypoint: entrypointV,
    scope: agentScopeV,
    modelPolicy: v.string(),
    idempotencyKey: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    approvalPolicy: v.optional(approvalPolicyV),
    evidencePolicy: v.optional(evidencePolicyV),
    autoAllow: v.optional(v.boolean()),
    traceLevel: v.optional(traceLevelV),
    runtimeProfile: v.optional(runtimeProfileV),
    request: v.optional(v.any()),
    maxAttempts: v.optional(v.number()),
    initialStatus: v.optional(v.union(v.literal("running"), v.literal("blocked"))),
    planPreview: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const central = await startDurableAgentJob(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: a.requester,
      goal: a.goal,
      execution: "inline",
      entrypoint: a.entrypoint,
      scope: a.scope,
      routePolicy: "explicit",
      runtimePolicy: "workflow_sliced",
      modelPolicy: a.modelPolicy,
      mode: a.mode,
      maxAttempts: a.maxAttempts,
      idempotencyKey: a.idempotencyKey,
      approvalPolicy: a.approvalPolicy ?? "host_review",
      evidencePolicy: a.evidencePolicy ?? "public_only",
      autoAllow: a.autoAllow ?? false,
      traceLevel: a.traceLevel ?? "standard",
      runtimeProfile: a.runtimeProfile,
      request: a.request,
      initialStatus: a.initialStatus,
      planPreview: a.planPreview,
      error: a.error,
      operationName: "agentJobs.createOrReuse",
    });
    return { jobId: central.jobId, reused: central.reused, status: central.status, latestRunId: central.latestRunId };
  },
});

export const finishInteractive = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("blocked"), v.literal("paused")),
    finalText: v.optional(v.string()),
    error: v.optional(v.string()),
    handoff: v.optional(v.any()),
    cursor: v.optional(v.any()),
    scheduledNextAt: v.optional(v.number()),
    scheduleWorkflow: v.optional(v.boolean()),
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    modelCalls: v.number(),
    toolCalls: v.number(),
    queryCount: v.optional(v.number()),
    mutationCount: v.optional(v.number()),
    receiptCount: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (terminalStatuses.has(job.status) && job.latestRunId) return { ok: true as const, terminal: true as const };
    const now = Date.now();
    const attempt = job.attempts + 1;
    await ctx.db.insert("agentJobAttempts", clean({
      jobId: a.jobId,
      runId: a.runId,
      attempt,
      status: a.status === "completed" ? "completed" : a.status === "paused" ? "handoff" : "failed",
      resolvedModel: a.resolvedModel,
      stopReason: a.stopReason,
      ms: a.ms,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: a.costUsd,
      error: a.error,
      startedAt: now - a.ms,
      endedAt: now,
    }));
    const baseSequence = (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 2;
    const eventStatus = a.status === "failed" || a.status === "blocked" ? "failed" : "completed";
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence, kind: "action", name: "agent.runRoomAgent", countDelta: 1, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 1, kind: "model_call", name: a.resolvedModel, countDelta: a.modelCalls, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 2, kind: "tool_call", name: "NodeAgent tools", countDelta: a.toolCalls, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 3, kind: "checkpoint", name: "agentJobs.finishInteractive", countDelta: 1, status: "completed", startedAt: now, completedAt: now });
    await recordStreamEventRow(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: await nextStreamSequence(ctx, a.jobId, 9_000),
      kind: a.status === "completed" ? "message_done" : "error",
      status: eventStatus,
      text: a.finalText,
      title: a.status === "completed" ? "Agent completed" : "Agent stopped",
      error: a.error,
      metadata: { stopReason: a.stopReason, model: a.resolvedModel },
      createdAt: now,
    });
    let workflowId: string | undefined;
    if (a.status === "paused" && a.scheduleWorkflow) {
      workflowId = String(await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId: a.jobId }, {
        onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
        context: { jobId: a.jobId },
      }));
      await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 4, kind: "scheduler", name: "agentWorkflows.freeAutoWorkflow", countDelta: 1, status: "completed", startedAt: now, completedAt: now });
    }
    await ctx.db.patch(a.jobId, clean({
      status: a.status,
      attempts: attempt,
      latestRunId: a.runId,
      finalText: a.finalText,
      error: a.error,
      handoff: a.handoff,
      cursor: a.cursor,
      nextRunAt: a.scheduledNextAt,
      runtime: workflowId ? "workflow" : job.runtime,
      workflowId,
      actionSliceCount: (job.actionSliceCount ?? 0) + 1,
      queryCount: (job.queryCount ?? 0) + (a.queryCount ?? 1),
      mutationCount: (job.mutationCount ?? 0) + (a.mutationCount ?? 1),
      modelCallCount: (job.modelCallCount ?? 0) + a.modelCalls,
      toolCallCount: (job.toolCallCount ?? 0) + a.toolCalls,
      receiptCount: (job.receiptCount ?? 0) + (a.receiptCount ?? 0),
      schedulerHandoffCount: (job.schedulerHandoffCount ?? 0) + (workflowId ? 1 : 0),
      leaseId: "",
      leaseUntil: 0,
      updatedAt: now,
      completedAt: a.status === "completed" ? now : undefined,
    }) as any);
    return { ok: true as const };
  },
});

export const recordLiveOperation = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    sequence: v.number(),
    kind: operationEventKindV,
    name: v.string(),
    status: v.optional(operationStatusV),
    countDelta: v.optional(v.number()),
    affectedIds: v.optional(v.array(v.string())),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (terminalStatuses.has(job.status)) return { ok: false as const, reason: "job_terminal" as const };
    await recordOperationEvent(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: a.sequence,
      kind: a.kind,
      name: a.name,
      status: a.status ?? "completed",
      countDelta: a.countDelta,
      affectedIds: a.affectedIds,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
    });
    // P0: Do NOT patch agentJobs here — the append-only agentOperationEvents row is sufficient.
    // Patching the hot agentJobs document on every live operation caused 2,298+ OCC conflicts.
    // updatedAt is reconciled at slice finish (finishInteractive / recordWorkflowComplete).
    return { ok: true as const };
  },
});

export const upsertEntityResearchCache = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    requester: actorProofV,
    visibility: v.optional(cacheVisibilityV),
    ownerId: v.optional(v.string()),
    entityType: entityTypeV,
    entityName: v.string(),
    entityKey: v.optional(v.string()),
    facet: v.string(),
    queryHash: v.optional(v.string()),
    sourceSetHash: v.optional(v.string()),
    result: v.any(),
    evidenceRefs: v.optional(v.array(v.any())),
    status: v.optional(entityCacheStatusV),
    confidence: v.optional(v.number()),
    retrievedAt: v.optional(v.number()),
    observedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    staleAfter: v.optional(v.number()),
    deltaStatus: v.optional(deltaStatusV),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const visibility = a.visibility ?? "public";
    const ownerId = cacheOwnerForVisibility(visibility, actor, a.ownerId);
    if (a.artifactId) {
      const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
      requireJobArtifactAccess(artifact, actor, { allowPrivate: true });
      if ((artifact.visibility ?? "room") === "private" && visibility !== "private") {
        throw new Error("private_artifact_cache_must_be_private");
      }
    }
    const now = Date.now();
    const entityKey = (a.entityKey?.trim() || entityKeyOf(a.entityType, a.entityName)).slice(0, 160);
    const displayName = cleanEntityDisplayName(a.entityName);
    const facet = normalizeFacet(a.facet);
    if (!entityKey || !displayName || !facet) throw new Error("invalid_entity_cache_key");
    const status = a.status ?? "fresh";
    const retrievedAt = a.retrievedAt ?? now;
    const freshnessMs = freshnessMsForFacet(facet);
    const validUntil = a.validUntil ?? (status === "fresh" ? retrievedAt + freshnessMs : undefined);
    const staleAfter = a.staleAfter ?? validUntil;
    const queryHash = a.queryHash ?? hashString(stableJson({ entityType: a.entityType, entityKey, facet }));
    const resultHash = hashString(stableJson(a.result));
    const candidates = await ctx.db.query("entityResearchCache")
      .withIndex("by_room_entity_facet", (q) => q
        .eq("roomId", a.roomId)
        .eq("visibility", visibility)
        .eq("entityType", a.entityType)
        .eq("entityKey", entityKey)
        .eq("facet", facet))
      .collect();
    const existing = candidates.find((row) =>
      (row.ownerId ?? "") === (ownerId ?? "") &&
      String(row.artifactId ?? "") === String(a.artifactId ?? "")
    );
    const patch = clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      visibility,
      ownerId,
      entityType: a.entityType,
      entityKey,
      displayName,
      facet,
      queryHash,
      sourceSetHash: a.sourceSetHash,
      resultHash,
      result: a.result,
      evidenceRefs: a.evidenceRefs ?? [],
      status,
      confidence: a.confidence,
      retrievedAt,
      observedAt: a.observedAt,
      validUntil,
      staleAfter,
      deltaStatus: a.deltaStatus ?? "none",
      updatedAt: now,
      lastUsedAt: now,
    });
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, cacheId: existing._id, created: false as const, entityKey, facet, status, validUntil };
    }
    const cacheId = await ctx.db.insert("entityResearchCache", {
      ...patch,
      createdAt: now,
    });
    return { ok: true as const, cacheId, created: true as const, entityKey, facet, status, validUntil };
  },
});

export const lookupEntityResearchCache = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    entityType: entityTypeV,
    entityName: v.string(),
    entityKey: v.optional(v.string()),
    facets: v.optional(v.array(v.string())),
    includeStale: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const entity: NormalizedRoomWorkEntity = {
      entityType: a.entityType,
      entityKey: (a.entityKey?.trim() || entityKeyOf(a.entityType, a.entityName)).slice(0, 160),
      displayName: cleanEntityDisplayName(a.entityName),
    };
    const facets = normalizeRequestedFacets(a.facets, "agent_fill");
    const now = Date.now();
    const hits: EntityFacetCacheHit[] = [];
    for (const facet of facets) {
      const hit = await lookupEntityFacetCache(ctx, { roomId: a.roomId, actor, entity, facet, now });
      if (!hit) continue;
      if (hit.fresh || a.includeStale) hits.push(hit);
    }
    return hits;
  },
});

export const startOrReuseRoomWork = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    mode: v.optional(roomWorkModeV),
    input: v.object({
      kind: v.optional(v.union(
        v.literal("manual_capture"),
        v.literal("manual_note"),
        v.literal("agent_request"),
        v.literal("bulk_companies"),
        v.literal("company_list"),
        v.literal("company_row"),
        v.literal("spreadsheet_row"),
        v.literal("file_reference"),
      )),
      text: v.optional(v.string()),
      facets: v.optional(v.array(v.string())),
      companies: v.optional(v.array(v.object({
        name: v.string(),
        website: v.optional(v.string()),
        tier: v.optional(v.string()),
        intent: v.optional(v.string()),
        owner: v.optional(v.string()),
        crmStatus: v.optional(v.string()),
      }))),
      entityHints: v.optional(v.array(v.object({ entityType: v.optional(entityTypeV), name: v.string(), website: v.optional(v.string()) }))),
      references: v.optional(v.array(v.object({
        artifactId: v.optional(v.string()),
        elementId: v.optional(v.string()),
        fileId: v.optional(v.string()),
        label: v.optional(v.string()),
      }))),
      payload: v.optional(v.any()),
    }),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<RoomWorkStartResult> => {
    const text = a.input.text?.trim() ?? "";
    if (text.length > MAX_ROOM_WORK_TEXT_CHARS) throw new Error("room_work_text_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    requireJobArtifactAccess(artifact, actor);
    const mode = a.mode ?? (a.input.kind === "manual_capture" || a.input.kind === "manual_note" ? "manual_capture" : a.input.kind === "bulk_companies" || a.input.kind === "company_list" ? "bulk_diligence" : "agent_fill");
    const entities = normalizeRoomWorkEntities(a.input, mode);
    if (!entities.length) throw new Error("no_room_work_entities");
    const facets = normalizeRequestedFacets(a.input.facets, mode);
    const now = Date.now();
    const cacheHits: EntityFacetCacheHit[] = [];
    for (const entity of entities) {
      for (const facet of facets) {
        const hit = await lookupEntityFacetCache(ctx, { roomId: a.roomId, actor, entity, facet, now });
        if (hit) {
          // Touch usage recency here (mutation-owned write; lastUsedAt only —
          // updatedAt is preserved). The lookup helper stays pure because the
          // read-only lookupEntityResearchCache query shares it.
          await ctx.db.patch(hit.cacheId, { lastUsedAt: now, updatedAt: hit.updatedAt });
          cacheHits.push(hit);
        }
      }
    }
    const hitByKey = new Map(cacheHits.map((hit) => [`${hit.entityType}:${hit.entityKey}:${hit.facet}`, hit]));
    const manualOnly = mode === "manual_capture";
    const facetPlans: RoomWorkFacetPlan[] = entities.flatMap((entity) => facets.map((facet) => {
      const hit = hitByKey.get(cacheHitKey(entity, facet));
      const cachePolicy = manualOnly
        ? "manual_only_do_not_research"
        : hit?.fresh
          ? "fresh_use_cache"
          : hit
            ? "stale_use_cache_and_refresh"
            : "missing_research_now";
      const status = cachePolicy === "manual_only_do_not_research"
        ? "completed"
        : cachePolicy === "fresh_use_cache"
          ? "cached"
          : cachePolicy === "stale_use_cache_and_refresh"
            ? "refreshing"
            : "queued";
      return { entityType: entity.entityType, entityKey: entity.entityKey, displayName: entity.displayName, facet, cacheHit: hit, cachePolicy, status };
    }));
    const staleFacets: RoomWorkStaleFacet[] = facetPlans
      .filter((plan) => plan.cachePolicy === "stale_use_cache_and_refresh" || plan.cachePolicy === "missing_research_now")
      .map((plan) => ({ entityType: plan.entityType, entityKey: plan.entityKey, displayName: plan.displayName, facet: plan.facet }));
    const entityList = entities.map((entity) => entity.displayName).join(", ");
    const facetList = Array.from(new Set((staleFacets.length ? staleFacets : facetPlans).map((facet) => facet.facet))).join(", ");
    const baseGoal = text || (staleFacets.length ? `Fill ${facetList} for ${entityList}.` : `Reuse cached ${facetList} for ${entityList}.`);
    const goal = `Room work ${mode}: ${baseGoal}`.slice(0, 2_000);
    const idempotencyKey = roomWorkIdempotencyKey({ roomId: a.roomId, artifactId: a.artifactId, actorId: actor.id, mode, entities, facets });
    const cacheSummary = summarizeEntityWorkPlans(facetPlans);
    const buildReasoning = (blockedReason?: string) => buildRoomWorkReasoningPlan({
      framePlanId: idempotencyKey,
      globalGoal: goal,
      mode,
      artifactId: String(a.artifactId),
      inputKind: a.input.kind,
      entities,
      facets,
      facetPlans,
      cacheHitCount: cacheHits.length,
      freshHitCount: cacheHits.filter((hit) => hit.fresh).length,
      blockedReason,
    });
    const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
    const reusable = prior.find((job) => {
      if (String(job.roomId) !== String(a.roomId) || String(job.artifactId) !== String(a.artifactId)) return false;
      if (!terminalStatuses.has(job.status)) return true;
      return job.entrypoint === "room_work" && job.status === "completed" && now - (job.updatedAt ?? 0) < 2 * 60 * 1000;
    });
    if (reusable) {
      const workItems = await ctx.db.query("entityWorkItems").withIndex("by_job", (q) => q.eq("jobId", reusable._id)).collect();
      return {
        ok: true as const,
        cacheOnly: staleFacets.length === 0,
        reused: true as const,
        jobId: reusable._id,
        workflowId: reusable.workflowId,
        status: reusable.status,
        normalizedEntities: entities,
        facets,
        cacheHits,
        staleFacets,
        workItems,
        cacheSummary: summarizeEntityWorkPlans(workItems),
      };
    }

    if (!staleFacets.length) {
      const reasoning = buildReasoning();
      const jobId = await ctx.db.insert("agentJobs", clean({
        roomId: a.roomId,
        artifactId: a.artifactId,
        requester: actor,
        goal,
        entrypoint: "room_work",
        scope: "public_room",
        commandText: goal,
        request: {
          roomId: String(a.roomId),
          targetArtifactId: String(a.artifactId),
          commandText: goal,
          entrypoint: "room_work",
          scope: "public_room",
          approvalPolicy: "draft_first",
          evidencePolicy: "public_only",
          traceLevel: "full_operation_ledger",
          roomWork: {
            mode,
            entities,
            facets,
            staleFacets,
            cacheHitCount: cacheHits.length,
            freshHitCount: cacheHits.filter((hit) => hit.fresh).length,
            inputKind: a.input.kind,
            cacheSummary,
            reasoning,
          },
        },
        priority: 0,
        approvalPolicy: "draft_first",
        evidencePolicy: "public_only",
        autoAllow: false,
        traceLevel: "full_operation_ledger",
        idempotencyKey,
        mode: "research",
        status: "completed",
        finalText: `Room work completed from ${facetPlans.length} cached/manual ${facetPlans.length === 1 ? "facet" : "facets"}; no model call needed.`,
        modelPolicy: "openrouter/free-auto",
        runtime: "inline",
        attempts: 0,
        maxAttempts: 1,
        actionSliceCount: 0,
        queryCount: facetPlans.length,
        mutationCount: 1 + facetPlans.length,
        modelCallCount: 0,
        toolCallCount: 0,
        schedulerHandoffCount: 0,
        receiptCount: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      }));
      const workItems = await insertEntityWorkItems(ctx, { roomId: a.roomId, artifactId: a.artifactId, jobId, actor, mode, idempotencyKey, plans: facetPlans, now });
      const reasoningFrames = await materializeReasoningFrames(ctx, { roomId: a.roomId, artifactId: a.artifactId, jobId, plan: reasoning, now });
      await recordOperationEvent(ctx, {
        jobId,
        sequence: 1,
        kind: "mutation",
        name: "agentJobs.startOrReuseRoomWork",
        targetKind: "artifact",
        targetId: String(a.artifactId),
        countDelta: 1,
        affectedIds: [String(jobId), String(a.artifactId), ...workItems.map((item) => String(item._id))],
        startedAt: now,
        completedAt: now,
      });
      await recordOperationEvent(ctx, {
        jobId,
        sequence: 2,
        kind: "query",
        name: "entityResearchCache.lookup",
        targetKind: "artifact",
        targetId: String(a.artifactId),
        countDelta: facetPlans.length,
        affectedIds: facetPlans.map((plan) => `${plan.entityKey}:${plan.facet}`),
        startedAt: now,
        completedAt: now,
      });
      await recordOperationEvent(ctx, {
        jobId,
        sequence: 3,
        kind: "checkpoint",
        name: "reasoningFrames.plan",
        targetKind: "reasoning_frame",
        countDelta: reasoningFrames.length,
        affectedIds: reasoningFrames.map((frame) => frame.frameId),
        startedAt: now,
        completedAt: now,
      });
      return { ok: true as const, cacheOnly: true as const, reused: false as const, jobId, status: "completed" as const, normalizedEntities: entities, facets, cacheHits, staleFacets, workItems, cacheSummary: summarizeEntityWorkPlans(workItems) };
    }

    const maxAttempts = Math.max(1, Math.min(a.maxAttempts ?? 20, 100));
    const planPreview = await artifactPlanPreview(ctx, { roomId: a.roomId, artifactId: a.artifactId, goal });
    const planBlocked = planPreview.scheduling !== "run_now";
    const blockedReason = planBlocked ? `plan_${planPreview.scheduling}: ${planPreview.conflicts[0]?.detail ?? "Room work blocked by PlanPreview."}` : undefined;
    const reasoning = buildReasoning(blockedReason);
    const jobId = await ctx.db.insert("agentJobs", clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: actor,
      goal,
      entrypoint: "room_work",
      scope: "public_room",
      commandText: goal,
      request: {
        roomId: String(a.roomId),
        targetArtifactId: String(a.artifactId),
        commandText: goal,
        entrypoint: "room_work",
        scope: "public_room",
        approvalPolicy: "draft_first",
        evidencePolicy: "public_only",
        traceLevel: "full_operation_ledger",
        roomWork: {
          mode,
          entities,
          facets,
          staleFacets,
          cacheHitCount: cacheHits.length,
          freshHitCount: cacheHits.filter((hit) => hit.fresh).length,
          inputKind: a.input.kind,
          cacheSummary,
          reasoning,
        },
      },
      priority: 0,
      approvalPolicy: "draft_first",
      evidencePolicy: "public_only",
      autoAllow: false,
      traceLevel: "full_operation_ledger",
      idempotencyKey,
      mode: "research",
      planPreview,
      status: planBlocked ? ("blocked" as const) : ("queued" as const),
      error: blockedReason,
      modelPolicy: "openrouter/free-auto",
      runtime: "workflow",
      attempts: 0,
      maxAttempts,
      actionSliceCount: 0,
      queryCount: facetPlans.length,
      mutationCount: 1 + facetPlans.length,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: planBlocked ? 0 : 1,
      receiptCount: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: planBlocked ? now : undefined,
    }));
    const workItems = await insertEntityWorkItems(ctx, { roomId: a.roomId, artifactId: a.artifactId, jobId, actor, mode, idempotencyKey, plans: facetPlans, now });
    const reasoningFrames = await materializeReasoningFrames(ctx, { roomId: a.roomId, artifactId: a.artifactId, jobId, plan: reasoning, now });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 1,
      kind: "mutation",
      name: "agentJobs.startOrReuseRoomWork",
      targetKind: "artifact",
      targetId: String(a.artifactId),
      countDelta: 1,
      affectedIds: [String(jobId), String(a.artifactId), ...workItems.map((item) => String(item._id))],
      startedAt: now,
      completedAt: now,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 2,
      kind: "query",
      name: "entityResearchCache.lookup",
      targetKind: "artifact",
      targetId: String(a.artifactId),
      countDelta: facetPlans.length,
      affectedIds: facetPlans.map((plan) => `${plan.entityKey}:${plan.facet}`),
      startedAt: now,
      completedAt: now,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 3,
      kind: "checkpoint",
      name: "reasoningFrames.plan",
      targetKind: "reasoning_frame",
      countDelta: reasoningFrames.length,
      affectedIds: reasoningFrames.map((frame) => frame.frameId),
      startedAt: now,
      completedAt: now,
    });
    if (planBlocked) {
      await ctx.db.insert("traces", {
        roomId: a.roomId,
        ts: now,
        actor,
        type: "plan_blocked",
        summary: `PlanPreview blocked room work (${planPreview.scheduling}) on ${String(a.artifactId)}`,
        detail: `room_work ${mode} - stale=${staleFacets.length} - conflicts=${planPreview.conflicts.map((c) => c.kind).join(",") || "none"}`.slice(0, 480),
      });
      return { ok: true as const, cacheOnly: false as const, reused: false as const, jobId, status: "blocked" as const, normalizedEntities: entities, facets, cacheHits, staleFacets, workItems, cacheSummary: summarizeEntityWorkPlans(workItems) };
    }
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 4,
      kind: "scheduler",
      name: "agentWorkflows.freeAutoWorkflow",
      countDelta: 1,
      affectedIds: [String(jobId)],
      startedAt: now,
      completedAt: now,
    });
    const workflowId: string = String(await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    }));
    await ctx.db.patch(jobId, { workflowId, updatedAt: now });
    return { ok: true as const, cacheOnly: false as const, reused: false as const, jobId, workflowId, status: "queued" as const, normalizedEntities: entities, facets, cacheHits, staleFacets, workItems, cacheSummary: summarizeEntityWorkPlans(workItems) };
  },
});

type DurableStartEntrypoint = "public_ask" | "private_agent" | "free" | "system" | "automation" | "provider_parser" | "room_work";
type RoutePolicy = "fast_default" | "free_auto" | "top_paid" | "explicit";
type RuntimePolicy = "workflow_sliced";
type AgentRuntimeProfile = "benchmark_completion";

function inferredRuntimeProfileForGoal(goal: string): AgentRuntimeProfile | undefined {
  return /\b(benchmark|eval|scorecard|held[- ]out|spreadsheetbench|bankertoolbench|btb|official\s+benchmark)\b/i.test(goal)
    ? "benchmark_completion"
    : undefined;
}

function maxAttemptsCeilingForRuntimeProfile(runtimeProfile?: AgentRuntimeProfile): number {
  return runtimeProfile === "benchmark_completion" ? 1000 : 100;
}

function boundedMaxAttempts(requested: number | undefined, fallback: number, runtimeProfile?: AgentRuntimeProfile): number {
  return Math.max(1, Math.min(requested ?? fallback, maxAttemptsCeilingForRuntimeProfile(runtimeProfile)));
}

type DurableStartAgentJobArgs = {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  requester: unknown;
  goal: string;
  execution?: "inline" | "workflow";
  entrypoint?: DurableStartEntrypoint;
  scope?: "public_room" | "private_user" | "team";
  routePolicy?: RoutePolicy;
  runtimePolicy?: RuntimePolicy;
  runtimeProfile?: AgentRuntimeProfile;
  modelPolicy?: string;
  mode?: "variance" | "research";
  maxAttempts?: number;
  idempotencyKey?: string;
  approvalPolicy?: "read_only" | "draft_first" | "auto_commit_safe" | "host_review";
  evidencePolicy?: "public_only" | "private_allowed" | "mixed_requires_redaction";
  autoAllow?: boolean;
  traceLevel?: "summary" | "standard" | "full_operation_ledger";
  request?: unknown;
  initialStatus?: "running" | "blocked";
  planPreview?: unknown;
  error?: string;
  operationName?: string;
};
type DurableStartAgentJobResult = {
  jobId: Id<"agentJobs">;
  reused: boolean;
  status: string;
  workflowId?: string;
  latestRunId?: Id<"agentRuns">;
  modelPolicy: string;
  routePolicy: RoutePolicy;
  runtimePolicy: RuntimePolicy;
};

function defaultEntrypointForRoute(routePolicy: RoutePolicy): DurableStartEntrypoint {
  return routePolicy === "free_auto" ? "free" : "public_ask";
}

function defaultModelPolicyForRoute(args: { routePolicy: RoutePolicy; entrypoint: DurableStartEntrypoint; mode?: "variance" | "research"; modelPolicy?: string }) {
  if (args.modelPolicy) return args.modelPolicy;
  if (args.routePolicy === "explicit") throw new Error("explicit_route_requires_modelPolicy");
  if (args.routePolicy === "free_auto" || args.entrypoint === "free") return "openrouter/free-auto";
  if (args.routePolicy === "top_paid") return process.env.AGENT_TOP_PAID_MODEL ?? process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-4";
  if (args.mode === "research") return process.env.AGENT_RESEARCH_MODEL ?? process.env.AGENT_WORKER_MODEL ?? "minimax/minimax-m3";
  return process.env.AGENT_ORCHESTRATOR_MODEL ?? process.env.AGENT_MODEL ?? "gemini-3.5-flash";
}

function configuredFileEgressModel() {
  for (const candidate of [
    process.env.AGENT_FILE_EGRESS_MODEL,
    process.env.AGENT_MODEL_FILE_EGRESS,
    DEFAULT_FILE_EGRESS_MODEL,
    process.env.AGENT_MODEL,
    process.env.AGENT_TOP_PAID_MODEL,
  ]) {
    const value = candidate?.trim();
    if (value && !isOpenRouterFreeRoute(value)) return value;
  }
  return DEFAULT_FILE_EGRESS_MODEL;
}

function providerEgressArtifactFromRow(artifact: { title?: string; kind?: string; meta?: unknown; visibility?: string; source?: string }): ProviderEgressArtifact {
  return {
    title: artifact.title,
    kind: artifact.kind,
    meta: artifact.meta,
    visibility: artifact.visibility,
    source: artifact.source,
  };
}

async function providerEgressArtifactsForRoom(ctx: any, roomId: Id<"rooms">, fallbackArtifact: { title?: string; kind?: string; meta?: unknown; visibility?: string }) {
  const roomArtifacts = await ctx.db.query("artifacts").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect();
  return roomArtifacts.length
    ? roomArtifacts.map(providerEgressArtifactFromRow)
    : [providerEgressArtifactFromRow(fallbackArtifact)];
}

function defaultApprovalPolicyForEntrypoint(entrypoint: DurableStartEntrypoint) {
  return entrypoint === "free" ? "draft_first" : "auto_commit_safe";
}

function canUsePublicJobArtifact(artifact: ArtifactAccess, actor: ActorValue): boolean {
  try {
    requireJobArtifactAccess(artifact, actor, { allowPrivate: false });
    return true;
  } catch {
    return false;
  }
}

function goalPrefersCompanyResearch(goal: string): boolean {
  return /(diligence|research|enrich|profile|source-?backed|funding|hiring|hipaa|security|buyer|watchlist|compan)/i.test(goal);
}

function goalPrefersDiligenceMemoNote(goal: string): boolean {
  return /\b(?:diligence\s+memo|memo)\b/i.test(goal) && /\b(?:note|notebook|draft|write|append|paragraph|heading|section)\b/i.test(goal);
}

function goalPrefersPersonResearch(goal: string): boolean {
  return /(deep[ -]?dive|person|founder|background|career|bio(?:graphy)?|education|publication|talk|award|patent|project|code (?:review|profile)|github profile|linkedin)/i.test(goal);
}

function goalPrefersRunway(goal: string): boolean {
  return /\b(runway|milestone|milestones|burn)\b/i.test(goal);
}

function goalPrefersVariance(goal: string): boolean {
  return /\b(q3|variance|recompute)\b/i.test(goal);
}

const PUBLIC_ASK_SCRATCH_ROWS = 12;
const PUBLIC_ASK_SCRATCH_COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function publicAskScratchSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let row = 1; row <= PUBLIC_ASK_SCRATCH_ROWS; row++) {
    for (const column of PUBLIC_ASK_SCRATCH_COLUMNS) seed.push({ id: `r${row}__${column}`, value: "" });
  }
  return seed;
}

function publicAskScratchMeta() {
  return {
    dataframe: {
      columns: PUBLIC_ASK_SCRATCH_COLUMNS.map((label, order) => ({
        id: label,
        label,
        order,
        mode: "manual",
        type: "text",
        agentWritable: true,
      })),
      rowCount: PUBLIC_ASK_SCRATCH_ROWS,
      sourceFile: "blank-room-agent",
      parser: "agent_blank_seed",
      truncated: false,
      warnings: [],
    },
  };
}

async function createPublicAskScratchSheet(ctx: any, args: { roomId: Id<"rooms">; actor: ActorValue }) {
  const now = Date.now();
  const title = "Sheet 1";
  const seed = publicAskScratchSeed();
  const meta = publicAskScratchMeta();
  assertCreateArtifactLimits({ title, seed, meta });
  const artifactId = await ctx.db.insert("artifacts", {
    roomId: args.roomId,
    kind: "sheet" as const,
    title,
    version: 1,
    order: seed.map((s) => s.id),
    updatedAt: now,
    createdBy: args.actor,
    visibility: "room" as const,
    meta,
  });
  for (const s of seed) {
    await ctx.db.insert("elements", {
      artifactId,
      elementId: s.id,
      value: s.value,
      version: 1,
      updatedAt: now,
      updatedBy: args.actor,
    });
  }
  await syncSpreadsheetIndexFromSeed(ctx, { artifactId, title, kind: "sheet", meta, seed, now });
  await ctx.db.insert("traces", {
    roomId: args.roomId,
    ts: now,
    actor: args.actor,
    type: "edit_applied",
    summary: `${args.actor.name} added ${title} for the public agent request`,
    detail: `create_artifact - sheet - ${String(artifactId)} - blank_public_ask_fallback`,
  });
  return {
    _id: artifactId,
    roomId: args.roomId,
    kind: "sheet" as const,
    title,
    version: 1,
    order: seed.map((s) => s.id),
    updatedAt: now,
    createdBy: args.actor,
    visibility: "room" as const,
    meta,
  };
}

async function resolvePublicAskArtifact(ctx: any, args: {
  roomId: Id<"rooms">;
  requester: unknown;
  goal: string;
  references?: Array<{ id: string; title?: string; kind?: string }>;
  contextArtifactId?: string;
}) {
  const actor = await requireActorProof(ctx, args.roomId, args.requester as any);
  const rows = await ctx.db.query("artifacts").withIndex("by_room", (q: any) => q.eq("roomId", args.roomId)).collect();
  const visible = rows.filter((artifact: ArtifactAccess) => canUsePublicJobArtifact(artifact, actor));
  if (!visible.length) return createPublicAskScratchSheet(ctx, { roomId: args.roomId, actor });

  const byId = (id?: string) => visible.find((artifact: { _id: unknown }) => String(artifact._id) === String(id));
  for (const ref of args.references ?? []) {
    const referenced = byId(ref.id);
    if (referenced) return referenced;
  }

  const title = (name: string) => visible.find((artifact: { title?: string }) => artifact.title === name);
  const active = byId(args.contextArtifactId);
  if (goalPrefersDiligenceMemoNote(args.goal)) {
    const memo = title("Diligence memo");
    if (memo) return memo;
    if (active?.kind === "note") return active;
  }
  if (goalPrefersRunway(args.goal)) return title("Runway / milestones") ?? title("Q3 variance") ?? visible.find((artifact: { kind?: string }) => artifact.kind === "sheet") ?? visible[0];
  if (goalPrefersCompanyResearch(args.goal)) return title("Company research") ?? visible.find((artifact: { kind?: string }) => artifact.kind === "sheet") ?? visible[0];
  if (goalPrefersVariance(args.goal)) return title("Q3 variance") ?? visible.find((artifact: { kind?: string }) => artifact.kind === "sheet") ?? visible[0];

  if (active) return active;
  return title("Q3 variance") ?? visible.find((artifact: { kind?: string }) => artifact.kind === "sheet") ?? visible[0];
}

function modeForArtifact(artifact: { title?: string }): "variance" | "research" | undefined {
  if (artifact.title === "Company research") return "research";
  if (artifact.title === "Q3 variance") return "variance";
  return undefined;
}

async function derivePublicStartPolicy(ctx: any, a: DurableStartAgentJobArgs): Promise<DurableStartAgentJobArgs> {
  const requestedRoute = a.routePolicy ?? (a.modelPolicy ? "explicit" : "fast_default");
  const routePolicy: RoutePolicy = requestedRoute === "free_auto"
    ? "free_auto"
    : requestedRoute === "top_paid"
      ? "top_paid"
      : requestedRoute === "explicit"
        ? "explicit"
        : "fast_default";
  const entrypoint = defaultEntrypointForRoute(routePolicy);
  const room = await ctx.db.get(a.roomId);
  const approvalPolicy = entrypoint === "free"
    ? "draft_first"
    : room?.autoAllow === false
      ? "host_review"
      : "auto_commit_safe";
  const modelPolicy = routePolicy === "explicit" ? a.modelPolicy : undefined;
  return {
    ...a,
    entrypoint,
    scope: "public_room",
    routePolicy,
    runtimePolicy: "workflow_sliced",
    modelPolicy,
    approvalPolicy,
    evidencePolicy: "public_only",
    traceLevel: "full_operation_ledger",
    autoAllow: entrypoint !== "free" && room?.autoAllow !== false,
    request: undefined,
  };
}

async function startDurableAgentJob(ctx: any, a: DurableStartAgentJobArgs): Promise<DurableStartAgentJobResult> {
  const runtimeProfile = a.runtimeProfile ?? inferredRuntimeProfileForGoal(a.goal);
  const maxGoalChars = runtimeProfile === "benchmark_completion" ? 20_000 : 2_000;
  if (a.goal.length > maxGoalChars) throw new Error("goal_too_long");
  const execution = a.execution ?? "workflow";
  let routePolicy: RoutePolicy = a.routePolicy ?? (a.modelPolicy ? "explicit" : "fast_default");
  const runtimePolicy = a.runtimePolicy ?? "workflow_sliced";
  let entrypoint: DurableStartEntrypoint = a.entrypoint ?? defaultEntrypointForRoute(routePolicy);
  const scope = a.scope ?? "public_room";
  const actor = await requireActorProof(ctx, a.roomId, a.requester as any);
  const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
  requireJobArtifactAccess(artifact, actor, { allowPrivate: scope === "private_user" || entrypoint === "private_agent" || a.evidencePolicy === "private_allowed" });
  const room = await ctx.db.get(a.roomId);
  const now = Date.now();
  let modelPolicy = defaultModelPolicyForRoute({ routePolicy, entrypoint, mode: a.mode, modelPolicy: a.modelPolicy });
  const egressArtifacts = await providerEgressArtifactsForRoom(ctx, a.roomId, artifact);
  const freeFileEgressDecision = providerEgressDecision({
    model: modelPolicy,
    entrypoint,
    artifacts: egressArtifacts,
    env: process.env,
  });
  const freeFileEgressBlocked = !freeFileEgressDecision.ok && freeFileEgressDecision.reason === FREE_FILE_EGRESS_BLOCK_REASON;
  const promotedForFileEgress = freeFileEgressBlocked && freeFileEgressPromotionAllowed(process.env);
  if (promotedForFileEgress) {
    entrypoint = "public_ask";
    routePolicy = "explicit";
    modelPolicy = configuredFileEgressModel();
  }
  const defaultMaxAttempts = runtimeProfile === "benchmark_completion" ? 1000 : entrypoint === "free" ? 20 : 20;
  const maxAttempts = boundedMaxAttempts(a.maxAttempts, defaultMaxAttempts, runtimeProfile);
  const idempotencyKey = a.idempotencyKey ?? defaultJobIdempotencyKey({
    roomId: a.roomId,
    artifactId: a.artifactId,
    actorId: actor.id,
    goal: a.goal,
    entrypoint,
    runtimeProfile,
  });
  const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q: any) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
  const reusable = prior.find((job: any) => String(job.roomId) === String(a.roomId) && String(job.artifactId) === String(a.artifactId) && !terminalStatuses.has(job.status));
  if (reusable) {
    return { jobId: reusable._id as Id<"agentJobs">, reused: true as const, status: reusable.status as string, workflowId: reusable.workflowId as string | undefined, latestRunId: reusable.latestRunId as Id<"agentRuns"> | undefined, modelPolicy: reusable.modelPolicy as string, routePolicy, runtimePolicy };
  }

  let planPreview = a.planPreview as { scheduling?: string; conflicts?: Array<{ kind?: string; detail?: string }> } | undefined;
  let planBlocked = a.initialStatus === "blocked";
  let blockedReason = a.error;
  if (execution === "workflow") {
    // Central admission gate: every workflow-backed durable route gets the same intent classification,
    // affected-set check, blocked-job trace, and no-provider-spend fail-closed behavior.
    const intake = classifyIntakeMessage(a.goal);
    const elementIds = (await ctx.db.query("elements").withIndex("by_artifact", (q: any) => q.eq("artifactId", a.artifactId)).collect()).map((e: any) => e.elementId);
    const pendingProposalRefs = (await ctx.db.query("proposals").withIndex("by_room_status", (q: any) => q.eq("roomId", a.roomId).eq("status", "pending")).collect())
      .filter((p: any) => String(p.artifactId) === String(a.artifactId))
      .map((p: any) => (p.op as { elementId?: string } | null)?.elementId)
      .filter((id: unknown): id is string => typeof id === "string");
    planPreview = buildPlanPreview({ decision: intake, targetArtifacts: [String(a.artifactId)], intendedWriteSet: elementIds, pendingProposals: pendingProposalRefs });
    planBlocked = planPreview.scheduling !== "run_now";
    blockedReason = planBlocked ? `plan_${planPreview.scheduling}: ${planPreview.conflicts?.[0]?.detail ?? intake.reason}` : undefined;
  }
  if (freeFileEgressBlocked && !promotedForFileEgress) {
    planBlocked = true;
    blockedReason = `provider_egress_blocked:${FREE_FILE_EGRESS_BLOCK_REASON}`;
    planPreview = {
      scheduling: "blocked",
      conflicts: [{ kind: "provider_egress", detail: blockedReason }],
    };
  }
  const approvalPolicy = promotedForFileEgress
    ? room?.autoAllow === false ? "host_review" : "auto_commit_safe"
    : a.approvalPolicy ?? defaultApprovalPolicyForEntrypoint(entrypoint);
  const evidencePolicy = a.evidencePolicy ?? "public_only";
  const traceLevel = a.traceLevel ?? (execution === "inline" ? "standard" : "full_operation_ledger");
  const status = execution === "inline" ? (a.initialStatus ?? "running") : planBlocked ? "blocked" : "queued";
  const runtime = execution === "inline" ? "inline" : "workflow";
  const operationName = a.operationName ?? (execution === "inline" ? "agentJobs.createOrReuse" : "agentJobs.start");
  const requestBase = a.request && typeof a.request === "object" && !Array.isArray(a.request)
    ? a.request as Record<string, unknown>
    : {};
  const request = clean({
    ...requestBase,
    roomId: String(a.roomId),
    targetArtifactId: String(a.artifactId),
    commandText: a.goal,
    entrypoint,
    scope,
    routePolicy,
    runtimePolicy,
    runtimeProfile,
    modelPolicy,
    approvalPolicy,
    evidencePolicy,
    traceLevel,
    fileEgressPromoted: promotedForFileEgress || undefined,
    freeFileEgressPromotionBlocked: freeFileEgressBlocked && !promotedForFileEgress || undefined,
  });
  const jobId = await ctx.db.insert("agentJobs", clean({
    roomId: a.roomId,
    artifactId: a.artifactId,
    requester: actor,
    goal: a.goal,
    entrypoint,
    scope,
    commandText: a.goal,
    request,
    priority: 0,
    approvalPolicy,
    evidencePolicy,
    autoAllow: promotedForFileEgress ? room?.autoAllow !== false : a.autoAllow ?? (execution === "inline" ? false : entrypoint !== "free"),
    traceLevel,
    routePolicy,
    runtimePolicy,
    runtimeProfile,
    idempotencyKey,
    mode: a.mode,
    planPreview,
    status,
    error: blockedReason,
    modelPolicy,
    runtime,
    attempts: 0,
    maxAttempts: execution === "inline" ? Math.max(1, Math.min(a.maxAttempts ?? 1, 20)) : maxAttempts,
    actionSliceCount: 0,
    queryCount: 0,
    mutationCount: 1,
    modelCallCount: 0,
    toolCallCount: 0,
    schedulerHandoffCount: execution === "workflow" && !planBlocked ? 1 : 0,
    receiptCount: 0,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
    completedAt: status === "blocked" ? now : undefined,
  }));
  await recordOperationEvent(ctx, {
    jobId,
    sequence: 1,
    kind: "mutation",
    name: operationName,
    targetKind: "artifact",
    targetId: String(a.artifactId),
    countDelta: 1,
    affectedIds: [String(jobId), String(a.artifactId)],
    startedAt: now,
    completedAt: now,
  });
  await recordStreamEventRow(ctx, {
    jobId,
    sequence: 1,
    kind: "message_start",
    status: "started",
    title: "Room NodeAgent",
    text: a.goal,
    metadata: { entrypoint, scope, routePolicy, runtimePolicy, runtimeProfile, modelPolicy, fileEgressPromoted: promotedForFileEgress || undefined, freeFileEgressPromotionBlocked: freeFileEgressBlocked && !promotedForFileEgress || undefined },
    createdAt: now,
  });
  if (status === "blocked") {
    await recordStreamEventRow(ctx, {
      jobId,
      sequence: 2,
      kind: "error",
      status: "failed",
      title: blockedReason?.startsWith("provider_egress_blocked:") ? "Route blocked" : "Plan blocked",
      error: blockedReason,
      metadata: { scheduling: planPreview?.scheduling, conflicts: planPreview?.conflicts },
      createdAt: now,
    });
    await recordStreamEventRow(ctx, {
      jobId,
      sequence: 3,
      kind: "message_done",
      status: "failed",
      text: blockedReason,
      createdAt: now,
    });
    await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor, type: "plan_blocked", summary: `PlanPreview blocked this run (${planPreview?.scheduling ?? "blocked"}) on ${String(a.artifactId)}`, detail: `plan_preview - ${planPreview?.scheduling ?? "blocked"} - conflicts=${(planPreview?.conflicts ?? []).map((c) => c.kind).join(",") || "none"} - ${blockedReason ?? ""}`.slice(0, 480) });
    return { jobId, reused: false as const, status, modelPolicy, routePolicy, runtimePolicy };
  }
  if (execution === "inline") return { jobId, reused: false as const, status, modelPolicy, routePolicy, runtimePolicy };
  // Seed a minimal execute-phase reasoning frame for research-mode workflow jobs
  // (public_ask entrypoint) so the frame machinery — including deep-dive fan-out — works.
  // room_work jobs already get frames via materializeReasoningFrames.
  if (a.mode === "research" && entrypoint !== "room_work") {
    const framePlanId = idempotencyKey;
    const executeFrameId = roomWorkPhaseFrameId({ framePlanId, phase: "execute", mode: a.mode });
    await ctx.db.insert("agentReasoningFrames", clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      jobId,
      framePlanId,
      frameId: executeFrameId,
      sequence: 1,
      frameKind: "phase",
      phase: "execute",
      status: "pending",
      goal: a.goal,
      contextPack: {
        globalGoal: a.goal,
        currentArtifactDigest: `artifact:${String(a.artifactId)}; mode:${a.mode}`,
        relevantOkfConceptIds: [],
        relevantCacheKeys: [],
        openQuestions: [],
        constraints: [
          "Use CAS/managed writes for spreadsheet changes.",
          "Mark unsupported claims as needs_review instead of guessing.",
        ],
      },
      toolAllowlist: FRAME_TOOL_ALLOWLIST.execute,
      createdAt: now,
      updatedAt: now,
    }));
  }
  await recordOperationEvent(ctx, {
    jobId,
    sequence: 2,
    kind: "scheduler",
    name: "agentWorkflows.freeAutoWorkflow",
    countDelta: 1,
    affectedIds: [String(jobId)],
    startedAt: now,
    completedAt: now,
  });
  let workflowId: string;
  try {
    workflowId = String(await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    }));
  } catch (error) {
    const failedAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = `workflow_start_failed: ${message || "unknown"}`.slice(0, 1_000);
    await ctx.db.patch(jobId, {
      status: "failed",
      error: safeMessage,
      schedulerHandoffCount: 0,
      completedAt: failedAt,
      updatedAt: failedAt,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 3,
      kind: "scheduler",
      name: "agentWorkflows.freeAutoWorkflow start failed",
      status: "failed",
      countDelta: 0,
      affectedIds: [String(jobId)],
      startedAt: now,
      completedAt: failedAt,
    });
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: failedAt,
      actor,
      type: "agent_error",
      summary: "Workflow admission failed",
      detail: safeMessage,
    });
    return { jobId, reused: false as const, status: "failed" as const, modelPolicy, routePolicy, runtimePolicy };
  }
  await ctx.db.patch(jobId, { workflowId, updatedAt: now });
  return { jobId, reused: false as const, status: "queued" as const, workflowId, modelPolicy, routePolicy, runtimePolicy };
}

export const start = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    entrypoint: v.optional(entrypointV),
    scope: v.optional(agentScopeV),
    routePolicy: v.optional(routePolicyV),
    runtimePolicy: v.optional(runtimePolicyV),
    runtimeProfile: v.optional(runtimeProfileV),
    modelPolicy: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    approvalPolicy: v.optional(approvalPolicyV),
    evidencePolicy: v.optional(evidencePolicyV),
    autoAllow: v.optional(v.boolean()),
    traceLevel: v.optional(traceLevelV),
    request: v.optional(v.any()),
  },
  handler: async (ctx, a): Promise<DurableStartAgentJobResult> => startDurableAgentJob(ctx, await derivePublicStartPolicy(ctx, a)),
});

export const startPublicAsk = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    goal: v.string(),
    references: v.optional(v.array(publicAskReferenceV)),
    contextArtifactId: v.optional(v.string()),
    routePolicy: v.optional(routePolicyV),
    modelPolicy: v.optional(v.string()),
    runtimeProfile: v.optional(runtimeProfileV),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<DurableStartAgentJobResult> => {
    const artifact = await resolvePublicAskArtifact(ctx, a);
    const policy = await derivePublicStartPolicy(ctx, {
      roomId: a.roomId,
      artifactId: artifact._id as Id<"artifacts">,
      requester: a.requester,
      goal: a.goal,
      routePolicy: a.routePolicy,
      modelPolicy: a.modelPolicy,
      runtimeProfile: a.runtimeProfile,
      maxAttempts: a.maxAttempts,
      mode: modeForArtifact(artifact) ?? (artifact.kind === "note" ? undefined : goalPrefersPersonResearch(a.goal) || goalPrefersCompanyResearch(a.goal) ? "research" : undefined),
    });
    return startDurableAgentJob(ctx, {
      ...policy,
      request: {
        roomId: String(a.roomId),
        targetArtifactId: String(artifact._id),
        commandText: a.goal,
        references: a.references,
        contextArtifactId: a.contextArtifactId,
        source: "public_chat",
        runtimeProfile: a.runtimeProfile,
      },
    });
  },
});

export const startFreeAuto = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<Id<"agentJobs">> => {
    const central = await startDurableAgentJob(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: a.requester,
      goal: a.goal,
      entrypoint: "free",
      scope: "public_room",
      routePolicy: "free_auto",
      runtimePolicy: "workflow_sliced",
      mode: a.mode,
      maxAttempts: a.maxAttempts,
      idempotencyKey: a.idempotencyKey,
      approvalPolicy: "draft_first",
      evidencePolicy: "public_only",
      autoAllow: false,
      traceLevel: "full_operation_ledger",
    });
    return central.jobId;
  },
});

/**
 * Bulk diligence fan-out (deep-review Workflow 1, "ParselyFi-style"): one command over a pasted
 * company list enqueues ONE queued agentJobs row per company — each with a per-company-key
 * idempotency key (so a company dedupes independently, not run-level) and its own freeAutoWorkflow,
 * bounded by the workpool's maxParallelism. Each child carries the same server-side PlanPreview gate.
 * Previously bulk was a single agent iterating companies sequentially inside one job.
 */
export const startBulkDiligence = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    companies: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    if (a.companies.length > 20_000) throw new Error("companies_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    requireJobArtifactAccess(artifact, actor);
    const rows = parseBulkCompanyIngest(a.companies);
    if (!rows.length) throw new Error("no_companies_parsed");
    if (rows.length > MAX_BULK_COMPANIES) throw new Error(`too_many_companies:${rows.length}>${MAX_BULK_COMPANIES}`);
    const now = Date.now();
    const maxAttempts = Math.max(1, Math.min(a.maxAttempts ?? 20, 100));

    // Affected-set + pending-proposal conflict are artifact-wide; compute once for the whole fan-out.
    const elementIds = (await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId)).collect()).map((e) => e.elementId);
    const pendingProposalRefs = (await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", a.roomId).eq("status", "pending")).collect())
      .filter((p) => String(p.artifactId) === String(a.artifactId))
      .map((p) => (p.op as { elementId?: string } | null)?.elementId)
      .filter((id): id is string => typeof id === "string");

    const jobs: Array<{ company: string; companyKey: string; jobId: string; status: string; reused: boolean }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const companyKey = companyKeyOf(row.company);
      if (!companyKey || seen.has(companyKey)) continue; // de-dup within this submission
      seen.add(companyKey);
      const goal = `Research and enrich the diligence row for ${row.company}${row.website ? ` (${row.website})` : ""} with source-backed evidence.`;
      const idempotencyKey = `bulk:${String(a.roomId)}:${String(a.artifactId)}:${actor.id}:${companyKey}`;
      // Per-company idempotency: reuse a live (non-terminal) job for this company instead of stacking.
      const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(3);
      const reusable = prior.find((job) => String(job.roomId) === String(a.roomId) && !terminalStatuses.has(job.status));
      if (reusable) { jobs.push({ company: row.company, companyKey, jobId: String(reusable._id), status: reusable.status, reused: true }); continue; }

      const intake = classifyIntakeMessage(goal);
      const planPreview = buildPlanPreview({ decision: intake, targetArtifacts: [String(a.artifactId)], intendedWriteSet: elementIds, pendingProposals: pendingProposalRefs });
      const planBlocked = planPreview.scheduling !== "run_now";
      const jobId = await ctx.db.insert("agentJobs", clean({
        roomId: a.roomId,
        artifactId: a.artifactId,
        requester: actor,
        goal,
        entrypoint: "free",
        scope: "public_room",
        commandText: goal,
        request: { roomId: String(a.roomId), targetArtifactId: String(a.artifactId), commandText: goal, entrypoint: "free", scope: "public_room", approvalPolicy: "draft_first", evidencePolicy: "public_only", traceLevel: "full_operation_ledger", companyKey },
        priority: 0,
        approvalPolicy: "draft_first",
        evidencePolicy: "public_only",
        autoAllow: false,
        traceLevel: "full_operation_ledger",
        idempotencyKey,
        mode: a.mode,
        planPreview,
        status: planBlocked ? ("blocked" as const) : ("queued" as const),
        error: planBlocked ? `plan_${planPreview.scheduling}: ${planPreview.conflicts[0]?.detail ?? intake.reason}` : undefined,
        modelPolicy: "openrouter/free-auto",
        runtime: "workflow",
        attempts: 0,
        maxAttempts,
        actionSliceCount: 0,
        queryCount: 0,
        mutationCount: 1,
        modelCallCount: 0,
        toolCallCount: 0,
        schedulerHandoffCount: planBlocked ? 0 : 1,
        receiptCount: 0,
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      if (planBlocked) {
        await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor, type: "plan_blocked", summary: `PlanPreview blocked bulk diligence for ${row.company} (${planPreview.scheduling})`, detail: `bulk · ${companyKey} · ${planPreview.scheduling}`.slice(0, 480) });
        jobs.push({ company: row.company, companyKey, jobId: String(jobId), status: "blocked", reused: false });
        continue;
      }
      const workflowId = await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, { onComplete: internal.agentWorkflows.freeAutoWorkflowComplete, context: { jobId } });
      await ctx.db.patch(jobId, { workflowId: String(workflowId), updatedAt: now });
      jobs.push({ company: row.company, companyKey, jobId: String(jobId), status: "queued", reused: false });
    }
    return { ok: true as const, count: jobs.length, jobs };
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const jobs = await ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(40);
    return jobs.filter((job) => canReadJob(job, actor)).slice(0, 20);
  },
});

export const attempts = query({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return [];
    const actor = await requireActorProof(ctx, job.roomId, requester);
    if (!canReadJob(job, actor)) return [];
    return (await ctx.db.query("agentJobAttempts").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(25)).reverse();
  },
});

function compactDetailPayload(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  let encoded = "";
  try {
    encoded = JSON.stringify(value);
  } catch {
    return { truncated: true, reason: "unserializable" };
  }
  if (encoded.length <= 4_000) return value;
  if (Array.isArray(value)) {
    return { truncated: true, kind: "array", length: value.length, preview: value.slice(0, 3) };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return { truncated: true, kind: "object", keys: Object.keys(record).slice(0, 24) };
  }
  return { truncated: true, kind: typeof value, preview: String(value).slice(0, 1_000) };
}

function compactStreamEventForDetail<T extends Record<string, unknown>>(event: T): T {
  return {
    ...event,
    text: typeof event.text === "string" && event.text.length > 2_000 ? `${event.text.slice(0, 2_000)}...` : event.text,
    input: compactDetailPayload(event.input),
    output: compactDetailPayload(event.output),
    metadata: compactDetailPayload(event.metadata),
  } as T;
}

export const detail = query({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const actor = await requireActorProof(ctx, job.roomId, requester);
    if (!canReadJob(job, actor)) return null;
    const attempts = (await ctx.db.query("agentJobAttempts").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(25)).reverse();
    const operations = (await ctx.db.query("agentOperationEvents").withIndex("by_job_sequence", (q) => q.eq("jobId", jobId)).order("desc").take(40)).reverse();
    const streamEvents = (await ctx.db.query("agentStreamEvents").withIndex("by_job_sequence", (q) => q.eq("jobId", jobId)).order("desc").take(80)).reverse()
      .map((event) => compactStreamEventForDetail(event));
    const reasoningFrames = (await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q) => q.eq("jobId", jobId)).order("desc").take(60)).reverse();
    const receipts = await ctx.db.query("agentMutationReceipts").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(20);
    const modelJournal = await ctx.db.query("agentModelStepJournal").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(10);
    const leases = (await Promise.all((["active", "released", "expired", "stolen"] as const).map((status) =>
      ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(5)
    ))).flat();
    const draftOperations = (await Promise.all((["pending", "approved", "rejected", "needs_rebase", "applied"] as const).map((status) =>
      ctx.db.query("agentDraftOperations").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(5)
    ))).flat();
    const latestRun = job.latestRunId ? await ctx.db.get(job.latestRunId) : null;
    const latestSteps = job.latestRunId
      ? await ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", job.latestRunId!)).order("desc").take(40)
      : [];
    return { job, attempts, operations, streamEvents, reasoningFrames, receipts, modelJournal, leases, draftOperations, latestRun, latestSteps };
  },
});

export const cancel = mutation({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    const actor = await requireActorProof(ctx, job.roomId, requester);
    const room = await ctx.db.get(job.roomId);
    if (!room || (actor.id !== job.requester.id && actor.id !== room.hostId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal" as const };
    }
    const now = Date.now();
    if (job.workflowId) await cancelWorkflow(ctx, components.workflow, job.workflowId as never);
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    const frameFinish = await setReasoningFramesForSliceFinish(ctx, { jobId, status: "cancelled", now });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 3,
      kind: "checkpoint",
      name: "agentJobs.cancel",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: "completed",
      countDelta: 1,
      affectedIds: [String(jobId), String(job.artifactId), ...frameFinish.affectedIds],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(jobId, {
      status: "cancelled",
      leaseId: "",
      leaseUntil: 0,
      error: "cancelled_by_user",
      mutationCount: (job.mutationCount ?? 0) + 1,
      updatedAt: now,
      completedAt: now,
    });
    return { ok: true as const };
  },
});

export const retry = mutation({
  args: {
    jobId: v.id("agentJobs"),
    requester: actorProofV,
    additionalAttempts: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, requester, additionalAttempts }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    const actor = await requireActorProof(ctx, job.roomId, requester);
    const room = await ctx.db.get(job.roomId);
    if (!room || (actor.id !== job.requester.id && actor.id !== room.hostId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (job.status === "completed" || job.status === "running") {
      return { ok: false as const, reason: "not_retryable" as const };
    }
    if (job.status === "blocked") {
      return { ok: false as const, reason: "blocked_requires_fresh_plan" as const };
    }
    const now = Date.now();
    const extra = Math.max(1, Math.min(additionalAttempts ?? 10, 50));
    const maxAttempts = Math.max(job.maxAttempts, job.attempts + extra);
    const workflowId = await startWorkflow(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    });
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 4,
      kind: "checkpoint",
      name: "agentJobs.retry",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: "completed",
      countDelta: 1,
      affectedIds: [String(jobId), String(job.artifactId), String(workflowId)],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(jobId, {
      status: "queued",
      maxAttempts,
      leaseId: "",
      leaseUntil: 0,
      nextRunAt: now,
      runtime: "workflow",
      workflowId: String(workflowId),
      error: undefined,
      completedAt: undefined,
      mutationCount: (job.mutationCount ?? 0) + 1,
      schedulerHandoffCount: (job.schedulerHandoffCount ?? 0) + 1,
      updatedAt: now,
    });
    return { ok: true as const, maxAttempts };
  },
});

export const workflowState = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    const terminal = !job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled";
    return {
      terminal,
      status: job?.status ?? "missing",
      nextRunAt: job?.nextRunAt,
      attempts: job?.attempts ?? 0,
      maxAttempts: job?.maxAttempts ?? 0,
      now: Date.now(),
    };
  },
});

export const markWorkflowExceeded = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal_or_missing" as const };
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "failed",
      leaseId: "",
      leaseUntil: 0,
      error: "workflow_slice_limit_exceeded",
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const sweepExpiredJobLeases = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { now: nowArg, limit }) => {
    const now = nowArg ?? Date.now();
    const batchSize = Math.max(1, Math.min(limit ?? 50, 200));
    const running = await ctx.db
      .query("agentJobs")
      .withIndex("by_status_nextRunAt", (q) => q.eq("status", "running"))
      .take(batchSize);
    let expired = 0;

    for (const job of running) {
      if (!job.leaseUntil || job.leaseUntil > now) continue;
      expired += 1;
      const activeLeases = await ctx.db
        .query("agentLeases")
        .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", "active"))
        .collect();
      for (const lease of activeLeases) {
        await ctx.db.patch(lease._id, { status: "expired", releasedAt: now });
      }

      const attempt = Math.max(1, job.attempts);
      const priorAttempt = await ctx.db
        .query("agentJobAttempts")
        .withIndex("by_job", (q) => q.eq("jobId", job._id).eq("attempt", attempt))
        .first();
      if (!priorAttempt) {
        const startedAt = Math.min(job.updatedAt ?? now, now);
        await ctx.db.insert("agentJobAttempts", {
          jobId: job._id,
          attempt,
          status: "failed",
          resolvedModel: job.modelPolicy,
          stopReason: "lease_expired",
          ms: Math.max(0, now - startedAt),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          error: "job_lease_expired",
          startedAt,
          endedAt: now,
        });
      }

      const frameFinish = await setReasoningFramesForSliceFinish(ctx, {
        jobId: job._id,
        status: "lease_expired",
        now,
        error: "job_lease_expired",
      });
      await recordOperationEvent(ctx, {
        jobId: job._id,
        sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 4,
        kind: "lease",
        name: "agentJobs.sweepExpiredJobLeases",
        targetKind: "artifact",
        targetId: String(job.artifactId),
        status: "failed",
        countDelta: 1,
        affectedIds: [String(job._id), String(job.artifactId), ...activeLeases.map((lease) => String(lease._id)), ...frameFinish.affectedIds],
        startedAt: now,
        completedAt: now,
      });

      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: "",
        leaseUntil: 0,
        error: "job_lease_expired",
        mutationCount: (job.mutationCount ?? 0) + 1,
        updatedAt: now,
        completedAt: now,
      });
    }

    return { ok: true as const, scanned: running.length, expired };
  },
});

export const recordWorkflowComplete = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    workflowId: v.string(),
    resultKind: v.union(v.literal("success"), v.literal("failed"), v.literal("canceled")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, workflowId, resultKind, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "missing" as const };
    if (job.workflowId && job.workflowId !== workflowId) return { ok: false as const, reason: "stale_workflow" as const };
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: true as const, terminal: true as const };
    }
    if (resultKind !== "success" && job.status === "running" && job.attempts > 1) {
      return { ok: true as const, terminal: false as const, superseded: true as const };
    }
    // P0: Passive research jobs must not requeue on spend_budget/rate_limit failures.
    // This was the root cause of workpool saturation — passive jobs cycled indefinitely.
    const isPassiveResearch = job.mode === "research" && job.entrypoint === "room_work";
    const isBudgetOrRateFailure = resultKind !== "success" && (
      error?.includes("spend_budget") ||
      error?.includes("rate_limit") ||
      error?.includes("429") ||
      error?.includes("quota")
    );
    if (isPassiveResearch && isBudgetOrRateFailure) {
      const now = Date.now();
      await ctx.db.patch(jobId, {
        status: "failed",
        leaseId: "",
        leaseUntil: 0,
        error: `passive_job_budget_failure:${error ?? "unknown"}`,
        updatedAt: now,
        completedAt: now,
      });
      return { ok: true as const, terminal: true as const };
    }
    const shouldContinue = job.status === "paused" || job.status === "retrying" || (resultKind === "success" && job.status === "queued");
    if (shouldContinue) {
      const now = Date.now();
      // P0: Route passive research jobs to the separate passive workpool.
      const isPassive = job.mode === "research" && job.entrypoint === "room_work";
      const workflowRef = isPassive
        ? internal.agentWorkflows.passiveRoomWorkWorkflow
        : internal.agentWorkflows.freeAutoWorkflow;
      const nextWorkflowId = String(await startWorkflow(ctx, workflowRef, { jobId }, {
        onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
        context: { jobId },
      }));
      await recordOperationEvent(ctx, {
        jobId,
        sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 4,
        kind: "scheduler",
        name: isPassive ? "agentWorkflows.passiveRoomWorkWorkflow.continue" : "agentWorkflows.freeAutoWorkflow.continue",
        targetKind: "artifact",
        targetId: String(job.artifactId),
        status: "completed",
        countDelta: 1,
        affectedIds: [String(jobId), String(nextWorkflowId)],
        startedAt: now,
        completedAt: now,
      });
      await ctx.db.patch(jobId, {
        workflowId: nextWorkflowId,
        schedulerHandoffCount: (job.schedulerHandoffCount ?? 0) + 1,
        updatedAt: now,
      });
      return { ok: true as const, terminal: false as const, continued: true as const };
    }
    if (resultKind === "success") {
      return { ok: true as const, terminal: false as const };
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: resultKind === "canceled" ? "cancelled" : "failed",
      leaseId: "",
      leaseUntil: 0,
      error: resultKind === "canceled" ? "workflow_cancelled" : error ?? "workflow_failed",
      updatedAt: now,
    });
    return { ok: true as const, terminal: true as const };
  },
});

export const claimSlice = internalMutation({
  args: { jobId: v.id("agentJobs"), leaseId: v.string(), leaseMs: v.number() },
  handler: async (ctx, { jobId, leaseId, leaseMs }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") return null;
    const now = Date.now();
    if (job.status === "running" && job.leaseUntil && job.leaseUntil > now) return null;

    const art = await ctx.db.get(job.artifactId);
    if (!art || String(art.roomId) !== String(job.roomId)) {
      await ctx.db.patch(jobId, { status: "failed", error: "artifact_room_mismatch", updatedAt: now });
      return null;
    }
    let session = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", job.roomId)).collect())
      .find((s) => s.scope === "public");
    if (!session) {
      const sessionId = await ctx.db.insert("agentSessions", {
        roomId: job.roomId,
        agentId: "agent_room",
        agentName: "Room NodeAgent",
        scope: "public",
        status: "idle",
        lastAction: "started",
        updatedAt: now,
      });
      session = await ctx.db.get(sessionId) ?? undefined;
    }
    if (!session) {
      await ctx.db.patch(jobId, { status: "blocked", error: "agent_session_create_failed", updatedAt: now });
      return null;
    }

    const attempt = job.attempts + 1;
    const leaseUntil = now + Math.max(1_000, leaseMs);
    const frameClaim = await claimReasoningFrameForSlice(ctx, { jobId, now });
    await ctx.db.patch(jobId, {
      status: "running",
      attempts: attempt,
      leaseId,
      leaseUntil,
      activeFrameId: frameClaim.frame?.frameId ?? "",
      actionSliceCount: (job.actionSliceCount ?? 0) + 1,
      updatedAt: now,
    });
    await ctx.db.insert("agentLeases", {
      jobId,
      roomId: job.roomId,
      targetKind: "artifact",
      targetId: String(job.artifactId),
      mode: "write",
      status: "active",
      expiresAt: leaseUntil,
      createdAt: now,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 2,
      kind: "lease",
      name: "agentJobs.claimSlice",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      countDelta: 1,
      affectedIds: [String(jobId), String(job.artifactId), ...frameClaim.affectedIds],
      startedAt: now,
      completedAt: now,
    });

    return {
      jobId,
      roomId: job.roomId,
      artifactId: job.artifactId,
      artifactTitle: art.title,
      artifactKind: art.kind,
      artifactMeta: art.meta,
      artifactVisibility: art.visibility ?? "room",
      requester: job.requester,
      goal: job.goal,
      entrypoint: job.entrypoint,
      scope: job.scope,
      approvalPolicy: job.approvalPolicy,
      evidencePolicy: job.evidencePolicy,
      traceLevel: job.traceLevel,
      routePolicy: job.routePolicy,
      runtimePolicy: job.runtimePolicy,
      runtimeProfile: job.runtimeProfile,
      mode: job.mode,
      modelPolicy: job.modelPolicy,
      createdAt: job.createdAt,
      cursor: job.cursor,
      handoff: job.handoff,
      attempt,
      maxAttempts: job.maxAttempts,
      sessionId: session._id,
      agentId: session.agentId,
      agentName: session.agentName,
      activeReasoningFrame: frameClaim.frame,
    };
  },
});

/** Maximum number of deep-dive child frames to spawn per job (bounded fan-out). */
const MAX_DEEP_DIVE_CHILD_FRAMES = 20;

/** Extract company rows with status "complete" from the artifact's elements.
 *  Elements are stored as `{rowId}__{column}` pairs. We group by rowId and
 *  extract the company name, website, and status. */
async function extractCompletedCompaniesFromSheet(ctx: any, artifactId: unknown): Promise<Array<{ rowId: string; company: string; website: string }>> {
  const elements = await ctx.db.query("elements").withIndex("by_artifact", (q: any) => q.eq("artifactId", artifactId)).collect();
  const rowsMap = new Map<string, { company?: string; website?: string; status?: string }>();
  for (const el of elements) {
    const elementId: string = el.elementId;
    const sep = elementId.indexOf("__");
    if (sep < 0) continue;
    const rowId = elementId.slice(0, sep);
    const col = elementId.slice(sep + 2);
    if (!rowsMap.has(rowId)) rowsMap.set(rowId, {});
    const row = rowsMap.get(rowId)!;
    const rawVal = el.value;
    const val = rawVal && typeof rawVal === "object" && "value" in rawVal ? (rawVal as { value: unknown }).value : rawVal;
    if (col === "company") row.company = String(val ?? "");
    if (col === "website") row.website = String(val ?? "");
    if (col === "status") row.status = String(val ?? "");
  }
  const companies: Array<{ rowId: string; company: string; website: string }> = [];
  for (const [rowId, row] of rowsMap) {
    if (row.status === "complete" && row.company) {
      companies.push({ rowId, company: row.company, website: row.website ?? "" });
    }
  }
  return companies;
}

function normalizedCompanyMentionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function filterCompaniesByGoalMention(goal: string, companies: Array<{ rowId: string; company: string; website: string }>): Array<{ rowId: string; company: string; website: string }> {
  const normalizedGoal = normalizedCompanyMentionText(goal);
  const explicitlyMentioned = companies.filter((company) => {
    const normalizedCompany = normalizedCompanyMentionText(company.company);
    return normalizedCompany.length >= 3 && normalizedGoal.includes(normalizedCompany);
  });
  return explicitlyMentioned.length ? explicitlyMentioned : companies;
}

/** After the parent (execute) frame completes, spawn one deep-dive child frame per
 *  completed company. Returns the number of child frames spawned. */
async function spawnDeepDiveFramesIfNeeded(ctx: any, args: {
  jobId: unknown;
  roomId: unknown;
  artifactId: unknown;
  completedFrameId: string;
  now: number;
}): Promise<number> {
  // Check if deep-dive child frames already exist for this job
  const existingFrames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q: any) => q.eq("jobId", args.jobId)).collect() as DurableReasoningFrameRow[];
  const hasDeepDiveChildren = existingFrames.some((f) => f.frameKind === "child" && f.facet === "deep_dive");
  if (hasDeepDiveChildren) return 0;

  // Only spawn if the completed frame was an execute-phase frame (the parent research frame)
  const completedFrame = existingFrames.find((f) => f.frameId === args.completedFrameId);
  if (!completedFrame || completedFrame.phase !== "execute") return 0;

  // Extract completed companies from the sheet
  const completedCompanies = await extractCompletedCompaniesFromSheet(ctx, args.artifactId);
  const companies = filterCompaniesByGoalMention(completedFrame.goal, completedCompanies);
  if (companies.length === 0) return 0;

  const maxChildren = Math.min(companies.length, MAX_DEEP_DIVE_CHILD_FRAMES);
  let sequence = existingFrames.length + 1;
  let spawned = 0;

  for (const company of companies.slice(0, maxChildren)) {
    const frameId = `deep_dive:${company.rowId}:${args.completedFrameId}`;
    const goal = `Deep research on ${company.company} (row ${company.rowId}): founding team, funding history, product, GTM signals, events attended, connections to other portfolio companies, competitive landscape. Website: ${company.website || "(none)"}`;
    const contextPack = {
      globalGoal: completedFrame.goal,
      parentSummary: `Parent execute frame completed. Researching ${company.company} in depth.`,
      currentArtifactDigest: `artifact:${String(args.artifactId)}; entity:company:${company.rowId}; facet:deep_dive`,
      relevantOkfConceptIds: [],
      relevantCacheKeys: [`deep_dive:${company.rowId}`],
      openQuestions: [
        `What is ${company.company}'s founding team background?`,
        `What is ${company.company}'s funding history?`,
        `What events has ${company.company} attended?`,
        `What connections does ${company.company} have to other portfolio companies?`,
      ],
      constraints: [
        "Child frames inherit only compact parent context, never the full transcript.",
        "Write only to the target company's deep-dive cells.",
        "Use at least 2 corroborating sources for key claims.",
        "Return evidence-bearing results that match the expected schema.",
      ],
      expectedOutputSchema: "company_deep_dive_result_with_evidence_v1",
    };

    await ctx.db.insert("agentReasoningFrames", clean({
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: completedFrame.framePlanId,
      frameId,
      parentFrameId: args.completedFrameId,
      sequence,
      frameKind: "child",
      phase: "execute",
      status: "pending",
      goal,
      contextPack,
      toolAllowlist: DEEP_DIVE_TOOL_ALLOWLIST,
      cacheKey: `deep_dive:${company.rowId}`,
      entityType: "company",
      entityKey: company.rowId,
      displayName: company.company,
      facet: "deep_dive",
      cachePolicy: "missing_research_now",
      expectedOutputSchema: "company_deep_dive_result_with_evidence_v1",
      createdAt: args.now,
      updatedAt: args.now,
    }));
    sequence += 1;
    spawned += 1;
  }

  if (spawned > 0) {
    await recordOperationEvent(ctx, {
      jobId: String(args.jobId),
      sequence: 999,
      kind: "checkpoint",
      name: "agentJobs.spawnDeepDiveFramesIfNeeded",
      targetKind: "reasoning_frame",
      countDelta: spawned,
      affectedIds: companies.slice(0, maxChildren).map((c) => `deep_dive:${c.rowId}:${args.completedFrameId}`),
      startedAt: args.now,
      completedAt: args.now,
    });
  }

  return spawned;
}

export const finishSlice = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    attempt: v.number(),
    status: attemptStatusV,
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.optional(v.number()),
    costUsd: v.number(),
    runId: v.optional(v.id("agentRuns")),
    error: v.optional(v.string()),
    handoff: v.optional(v.any()),
    cursor: v.optional(v.any()),
    finalText: v.optional(v.string()),
    scheduledNextAt: v.optional(v.number()),
    frameId: v.optional(v.string()),
    frameStatus: v.optional(v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("blocked"), v.literal("skipped"), v.literal("failed"))),
    frameDelta: v.optional(v.any()),
    frameEvidenceState: v.optional(v.any()),
    frameResultRef: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (job.leaseId !== a.leaseId) return { ok: false as const, reason: "lease_mismatch" as const };
    const now = Date.now();
    await ctx.db.insert("agentJobAttempts", clean({
      jobId: a.jobId,
      runId: a.runId,
      frameId: a.frameId ?? job.activeFrameId,
      attempt: a.attempt,
      status: a.status,
      resolvedModel: a.resolvedModel,
      stopReason: a.stopReason,
      ms: a.ms,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cachedInputTokens: a.cachedInputTokens,
      costUsd: a.costUsd,
      error: a.error,
      scheduledNextAt: a.scheduledNextAt,
      startedAt: now - a.ms,
      endedAt: now,
    }));

    const nextStatus =
      a.status === "completed" ? "completed" :
      a.status === "blocked" ? "blocked" :
      a.status === "failed" ? "failed" :
      a.status === "retrying" ? "retrying" :
      "paused";

    const patch: Record<string, unknown> = {
      status: nextStatus,
      leaseId: "",
      leaseUntil: 0,
      modelCallCount: (job.modelCallCount ?? 0) + 1,
      toolCallCount: (job.toolCallCount ?? 0) + (a.inputTokens || a.outputTokens ? 1 : 0),
      mutationCount: (job.mutationCount ?? 0) + 1,
      updatedAt: now,
    };
    if (a.runId) patch.latestRunId = a.runId;
    if (a.handoff !== undefined) patch.handoff = compactJobContinuation(a.handoff);
    if (a.cursor !== undefined) patch.cursor = compactJobContinuation(a.cursor);
    if (a.finalText !== undefined) patch.finalText = capStreamText(a.finalText, 60_000);
    if (a.error !== undefined) patch.error = capStreamText(a.error, 4_000);
    else if (nextStatus === "completed" || nextStatus === "paused") patch.error = "";
    if (a.scheduledNextAt !== undefined && nextStatus !== "completed") patch.nextRunAt = a.scheduledNextAt;
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", a.jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    const frameFinish = await setReasoningFramesForSliceFinish(ctx, {
      jobId: a.jobId,
      status: a.status,
      now,
      frameId: a.frameId,
      frameStatus: a.frameStatus,
      frameDelta: a.frameDelta,
      frameEvidenceState: a.frameEvidenceState,
      frameResultRef: a.frameResultRef,
      error: a.error,
    });
    // Fan-out: when the parent execute frame completes, spawn deep-dive child frames
    // for each completed portfolio company. The existing hasOpenFrames check below
    // will see the new children and keep the job paused so the workflow continues.
    if (a.status === "completed" && frameFinish.activeFrameId && job.mode === "research") {
      const spawned = await spawnDeepDiveFramesIfNeeded(ctx, {
        jobId: a.jobId,
        roomId: job.roomId,
        artifactId: job.artifactId,
        completedFrameId: frameFinish.activeFrameId,
        now,
      });
      if (spawned > 0) {
        // Re-check open frames since we just added children
        const refreshedFrames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q: any) => q.eq("jobId", a.jobId)).collect() as DurableReasoningFrameRow[];
        frameFinish.hasOpenFrames = refreshedFrames.some((f) => durableFrameIsOpen(f));
      }
    }
    let effectiveNextStatus = nextStatus;
    if (frameFinish.activeFrameId && a.status === "completed" && frameFinish.hasOpenFrames) {
      effectiveNextStatus = "paused";
      patch.nextRunAt = a.scheduledNextAt ?? now + 5_000;
    }
    if (frameFinish.frameStatus === "blocked") effectiveNextStatus = "blocked";
    if (effectiveNextStatus === "completed" || effectiveNextStatus === "failed" || effectiveNextStatus === "blocked") patch.nextRunAt = 0;
    patch.status = effectiveNextStatus;
    patch.activeFrameId = "";
    if (effectiveNextStatus === "completed") patch.completedAt = now;
    await recordOperationEvent(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 3,
      kind: "checkpoint",
      name: "agentJobs.finishSlice",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: effectiveNextStatus === "failed" || effectiveNextStatus === "blocked" ? "failed" : "completed",
      countDelta: 1,
      affectedIds: [String(a.jobId), String(job.artifactId), ...frameFinish.affectedIds],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(a.jobId, patch as any);
    if (patch.nextRunAt !== undefined && (effectiveNextStatus === "paused" || effectiveNextStatus === "retrying")) {
      const delayMs = Math.max(0, Number(patch.nextRunAt) - now);
      if (job.runtime === "workflow") {
        await recordOperationEvent(ctx, {
          jobId: a.jobId,
          runId: a.runId,
          sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 4,
          kind: "scheduler",
          name: "agentJobs.finishSlice.workflowSchedulerFallback",
          targetKind: "artifact",
          targetId: String(job.artifactId),
          status: "completed",
          countDelta: 1,
          affectedIds: [String(a.jobId), String(job.artifactId)],
          startedAt: now,
          completedAt: now,
        });
      }
      await ctx.scheduler.runAfter(delayMs, internal.agentJobRunner.runFreeAutoJobSlice, { jobId: a.jobId });
    }
    return { ok: true as const };
  },
});

// P0: Workpool saturation dashboard — monitors queue depth by mode/entrypoint
// so we can detect saturation before user jobs are starved.
export const completeDeterministicBenchmarkSlice = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    runId: v.id("agentRuns"),
    finalText: v.string(),
    resolvedModel: v.string(),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) throw new Error("job_not_found");
    if (job.leaseId && job.leaseId !== a.leaseId) throw new Error("lease_mismatch");
    const now = Date.now();
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", a.jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    const frames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q) => q.eq("jobId", a.jobId)).collect();
    for (const frame of frames) {
      if (frame.status !== "completed") {
        await ctx.db.patch(frame._id, { status: "completed", updatedAt: now, completedAt: now, error: undefined });
      }
    }
    await recordOperationEvent(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 3,
      kind: "checkpoint",
      name: "agentJobs.completeDeterministicBenchmarkSlice",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: "completed",
      countDelta: 1,
      affectedIds: [String(a.jobId), String(job.artifactId), ...frames.map((frame) => frame.frameId)],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(a.jobId, {
      status: "completed",
      leaseId: "",
      leaseUntil: 0,
      latestRunId: a.runId,
      activeFrameId: "",
      nextRunAt: 0,
      completedAt: now,
      updatedAt: now,
      finalText: capStreamText(a.finalText, 60_000),
      error: "",
      modelCallCount: (job.modelCallCount ?? 0) + 1,
      mutationCount: (job.mutationCount ?? 0) + 1,
    });
    return { ok: true as const };
  },
});

export const benchmarkJobReceipt = query({
  args: { roomCode: v.string() },
  handler: async (ctx, a) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", a.roomCode)).first();
    if (!room) return { room: null, job: null, frames: [], operations: [] };
    const jobs = await ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", room._id)).order("desc").take(1);
    const job = jobs[0];
    if (!job) {
      return { room: { id: room._id, code: room.code }, job: null, frames: [], operations: [] };
    }
    const frames = await ctx.db.query("agentReasoningFrames").withIndex("by_job_sequence", (q) => q.eq("jobId", job._id)).collect();
    const operations = await ctx.db.query("agentOperationEvents").withIndex("by_job_sequence", (q) => q.eq("jobId", job._id)).order("desc").take(12);
    return {
      room: { id: room._id, code: room.code },
      job: {
        id: job._id,
        status: job.status,
        error: job.error,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        nextRunAt: job.nextRunAt,
        completedAt: job.completedAt,
        finalText: job.finalText?.slice(0, 1_000),
        latestRunId: job.latestRunId,
        modelCallCount: job.modelCallCount,
        mutationCount: job.mutationCount,
      },
      frames: frames.map((frame) => ({
        frameId: frame.frameId,
        phase: frame.phase,
        status: frame.status,
        error: frame.error,
        completedAt: frame.completedAt,
      })),
      operations: operations.map((operation) => ({
        sequence: operation.sequence,
        kind: operation.kind,
        name: operation.name,
        status: operation.status,
        affectedIds: operation.affectedIds,
      })),
    };
  },
});

export const workpoolStatus = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const queued = await ctx.db
      .query("agentJobs")
      .withIndex("by_status_nextRunAt", (q) => q.eq("status", "queued"))
      .take(200);
    const running = await ctx.db
      .query("agentJobs")
      .withIndex("by_status_nextRunAt", (q) => q.eq("status", "running"))
      .take(200);

    const byMode = (jobs: typeof queued) => {
      const counts: Record<string, number> = {};
      for (const j of jobs) {
        const key = `${j.mode ?? "unknown"}:${j.entrypoint ?? "unknown"}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    };

    const passiveQueued = queued.filter((j) => j.mode === "research" && j.entrypoint === "room_work").length;
    const userQueued = queued.filter((j) => !(j.mode === "research" && j.entrypoint === "room_work")).length;
    const passiveRunning = running.filter((j) => j.mode === "research" && j.entrypoint === "room_work").length;
    const userRunning = running.filter((j) => !(j.mode === "research" && j.entrypoint === "room_work")).length;

    return {
      now,
      queued: { total: queued.length, passive: passiveQueued, user: userQueued, byMode: byMode(queued) },
      running: { total: running.length, passive: passiveRunning, user: userRunning, byMode: byMode(running) },
      // Saturation warning: if passive jobs occupy more than 50% of running slots
      // or if queued passive jobs exceed 10, the system is at risk.
      saturated: passiveRunning > 4 || passiveQueued > 10,
    };
  },
});
