/**
 * Harness-native recursive reasoning frames.
 *
 * This is intentionally pure TypeScript: the durable envelope remains Convex
 * agentJobs/entityWorkItems, while this module defines the compact frame plan
 * those jobs can persist and expose to Trace Lens/UI without depending on a
 * model-specific "long reasoning" feature.
 */

export const REASONING_FRAME_PLAN_SCHEMA = "noderoom.reasoning_frame_plan.v1" as const;

export type ReasoningFramePhase = "intake" | "plan" | "execute" | "verify" | "synthesize";
export type ReasoningFrameStatus = "pending" | "running" | "completed" | "blocked" | "skipped" | "failed";
export type FrameDecisionNext = "continue" | "spawn_children" | "finish" | "block";

export interface ContextPack {
  globalGoal: string;
  parentSummary?: string;
  currentArtifactDigest: string;
  relevantOkfConceptIds: string[];
  relevantCacheKeys: string[];
  openQuestions: string[];
  constraints: string[];
  expectedOutputSchema?: string;
}

export interface EvidenceState {
  required: string[];
  availableRefs: string[];
  missingRefs: string[];
  staleRefs: string[];
  confidence?: number;
}

export interface FrameDelta {
  summary: string;
  changedArtifacts: string[];
  cacheKeysTouched: string[];
  okfConceptIdsTouched: string[];
  openQuestions: string[];
  nextActions: string[];
}

export interface ReasoningFrame {
  frameId: string;
  parentFrameId?: string;
  jobId?: string;
  goal: string;
  phase: ReasoningFramePhase;
  status: ReasoningFrameStatus;
  contextPack: ContextPack;
  toolAllowlist: string[];
  stateDelta?: FrameDelta;
  evidenceState?: EvidenceState;
}

export interface ChildFrameRequest {
  frameId: string;
  parentFrameId: string;
  goal: string;
  entityType: string;
  entityKey: string;
  displayName: string;
  facet: string;
  cacheKey: string;
  cachePolicy: string;
  status: ReasoningFrameStatus;
  toolAllowlist: string[];
  expectedOutputSchema: string;
}

export interface FrameDecision {
  next: FrameDecisionNext;
  reason: string;
  childFrameCount: number;
  blockedReason?: string;
}

export interface ReasoningFramePlan {
  schema: typeof REASONING_FRAME_PLAN_SCHEMA;
  capability: "harness_recursive_reasoning";
  framePlanId: string;
  globalGoal: string;
  frames: ReasoningFrame[];
  childFrames: ChildFrameRequest[];
  childFrameSampleLimit: number;
  childFrameCount: number;
  decision: FrameDecision;
  summary: {
    phases: ReasoningFramePhase[];
    entityCount: number;
    facetCount: number;
    facetPlanCount: number;
    cachePolicyCounts: Record<string, number>;
    cacheKeyCount: number;
    openQuestionCount: number;
  };
}

export interface RoomWorkReasoningEntity {
  entityType: string;
  entityKey: string;
  displayName: string;
  website?: string;
}

export interface RoomWorkReasoningFacetPlan {
  entityType: string;
  entityKey: string;
  displayName: string;
  facet: string;
  cachePolicy: string;
  status: string;
  cacheHit?: {
    cacheId?: unknown;
    fresh?: boolean;
    visibility?: string;
    ownerId?: string;
    validUntil?: number;
    staleAfter?: number;
  } | null;
}

export interface BuildRoomWorkReasoningPlanArgs {
  framePlanId: string;
  globalGoal: string;
  mode: string;
  artifactId: string;
  inputKind?: string;
  entities: RoomWorkReasoningEntity[];
  facets: string[];
  facetPlans: RoomWorkReasoningFacetPlan[];
  cacheHitCount: number;
  freshHitCount: number;
  blockedReason?: string;
  childFrameSampleLimit?: number;
}

const DEFAULT_CHILD_FRAME_SAMPLE_LIMIT = 50;

export const FRAME_TOOL_ALLOWLIST: Record<ReasoningFramePhase, string[]> = {
  intake: ["normalize_room_intake", "compute_idempotency_key"],
  plan: ["entityResearchCache.lookup", "okf_full_text_search", "okf_semantic_search", "search_sheet_context", "skill_search", "okf_search_skills"],
  execute: ["fetch_source", "capture_source", "linkup_search", "you_search", "you_research", "you_finance_research", "github_profile", "source_compare_claim", "read_notebook", "append_notebook_outline", "write_locked_cell_results", "update_wiki", "skill_search", "load_skill"],
  verify: ["source_compare_claim", "okf_read_concept", "read_range", "reconcile_cell"],
  synthesize: ["say", "export_downstream_draft", "generate_banker_coach_cues"],
};

/** Tool allowlist for deep-dive child frames: per-company research with expanded dimensions. */
export const DEEP_DIVE_TOOL_ALLOWLIST: string[] = [
  "fetch_source", "capture_source", "read_range", "search_sheet_context",
  "write_locked_cell_results", "define_columns", "say", "read_notebook", "append_notebook_outline", "update_wiki",
  "founder_profile", "github_profile", "you_search", "you_research",
];

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slug(value: string, fallback = "frame"): string {
  const clean = value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_:-]/g, "").replace(/^_+|_+$/g, "");
  return (clean || fallback).slice(0, 80);
}

function frameId(planId: string, phase: string, suffix = ""): string {
  const key = `${planId}:${phase}:${suffix}`;
  const label = suffix ? `${slug(phase)}_${slug(suffix)}` : slug(phase);
  return `rf_${stableHash(key)}_${label}`.slice(0, 120);
}

export function roomWorkCacheKey(args: { entityType: string; entityKey: string; facet: string }): string {
  return `entityResearchCache:${slug(args.entityType, "entity")}:${slug(args.entityKey, "unknown")}:${slug(args.facet, "facet")}`;
}

export function roomWorkFacetFrameId(args: { framePlanId: string; entityType: string; entityKey: string; facet: string }): string {
  return frameId(args.framePlanId, "execute", `${args.entityType}:${args.entityKey}:${args.facet}`);
}

export function roomWorkPhaseFrameId(args: { framePlanId: string; phase: ReasoningFramePhase; mode: string }): string {
  return frameId(args.framePlanId, args.phase, args.mode);
}

function cachePolicyCounts(facetPlans: RoomWorkReasoningFacetPlan[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plan of facetPlans) out[plan.cachePolicy] = (out[plan.cachePolicy] ?? 0) + 1;
  return out;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function statusFromPolicy(policy: string, blocked: boolean): ReasoningFrameStatus {
  if (blocked) return "blocked";
  if (policy === "fresh_use_cache" || policy === "manual_only_do_not_research") return "completed";
  return "pending";
}

function buildChildFrame(planId: string, parentFrameId: string, plan: RoomWorkReasoningFacetPlan, blocked: boolean): ChildFrameRequest {
  const cacheKey = roomWorkCacheKey(plan);
  return {
    frameId: roomWorkFacetFrameId({ framePlanId: planId, entityType: plan.entityType, entityKey: plan.entityKey, facet: plan.facet }),
    parentFrameId,
    goal: `Resolve ${plan.facet} for ${plan.displayName}.`,
    entityType: plan.entityType,
    entityKey: plan.entityKey,
    displayName: plan.displayName,
    facet: plan.facet,
    cacheKey,
    cachePolicy: plan.cachePolicy,
    status: statusFromPolicy(plan.cachePolicy, blocked),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.execute,
    expectedOutputSchema: "entity_facet_result_with_evidence_v1",
  };
}

function baseContext(args: BuildRoomWorkReasoningPlanArgs, extra?: Partial<ContextPack>): ContextPack {
  const cacheKeys = unique(args.facetPlans.map(roomWorkCacheKey));
  const missing = args.facetPlans.filter((plan) => plan.cachePolicy === "missing_research_now");
  const stale = args.facetPlans.filter((plan) => plan.cachePolicy === "stale_use_cache_and_refresh");
  const openQuestions = [
    ...missing.map((plan) => `Missing ${plan.facet} for ${plan.displayName}`),
    ...stale.map((plan) => `Refresh stale ${plan.facet} for ${plan.displayName}`),
  ].slice(0, 50);
  return {
    globalGoal: args.globalGoal,
    currentArtifactDigest: `artifact:${args.artifactId}; mode:${args.mode}; entities:${args.entities.length}; facets:${args.facets.length}`,
    relevantOkfConceptIds: [],
    relevantCacheKeys: cacheKeys,
    openQuestions,
    constraints: [
      "Do not inherit the full room transcript into child frames.",
      "Use cache/OKF before provider calls.",
      "Use CAS/managed writes for spreadsheet changes.",
      "Mark unsupported claims as needs_review instead of guessing.",
      "Keep public/private visibility boundaries intact.",
    ],
    ...extra,
  };
}

export function buildRoomWorkReasoningPlan(args: BuildRoomWorkReasoningPlanArgs): ReasoningFramePlan {
  const sampleLimit = Math.max(0, Math.min(args.childFrameSampleLimit ?? DEFAULT_CHILD_FRAME_SAMPLE_LIMIT, 200));
  const blocked = Boolean(args.blockedReason);
  const rootId = roomWorkPhaseFrameId({ framePlanId: args.framePlanId, phase: "intake", mode: args.mode });
  const planId = roomWorkPhaseFrameId({ framePlanId: args.framePlanId, phase: "plan", mode: args.mode });
  const executeId = roomWorkPhaseFrameId({ framePlanId: args.framePlanId, phase: "execute", mode: args.mode });
  const verifyId = roomWorkPhaseFrameId({ framePlanId: args.framePlanId, phase: "verify", mode: args.mode });
  const synthesizeId = roomWorkPhaseFrameId({ framePlanId: args.framePlanId, phase: "synthesize", mode: args.mode });
  const children = args.facetPlans
    .filter((plan) => plan.cachePolicy !== "fresh_use_cache" && plan.cachePolicy !== "manual_only_do_not_research")
    .map((plan) => buildChildFrame(args.framePlanId, executeId, plan, blocked));
  const childSample = children.slice(0, sampleLimit);
  const cacheKeys = unique(args.facetPlans.map(roomWorkCacheKey));
  const missingEvidence = args.facetPlans
    .filter((plan) => plan.cachePolicy === "missing_research_now")
    .map((plan) => roomWorkCacheKey(plan));
  const staleEvidence = args.facetPlans
    .filter((plan) => plan.cachePolicy === "stale_use_cache_and_refresh")
    .map((plan) => roomWorkCacheKey(plan));

  const intakeFrame: ReasoningFrame = {
    frameId: rootId,
    goal: "Parse room work request, classify mode/input kind, normalize entity and facet signatures.",
    phase: "intake",
    status: "completed",
    contextPack: baseContext(args, {
      parentSummary: `inputKind:${args.inputKind ?? "unknown"}; cacheHits:${args.cacheHitCount}; freshHits:${args.freshHitCount}`,
      expectedOutputSchema: "normalized_room_work_request_v1",
    }),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.intake,
    stateDelta: {
      summary: `Normalized ${args.entities.length} entities and ${args.facets.length} facets for ${args.mode}.`,
      changedArtifacts: [],
      cacheKeysTouched: cacheKeys,
      okfConceptIdsTouched: [],
      openQuestions: baseContext(args).openQuestions,
      nextActions: ["Build cache-first task plan."],
    },
  };

  const planFrame: ReasoningFrame = {
    frameId: planId,
    parentFrameId: rootId,
    goal: "Build cache-first task DAG and decide which entity/facet work can reuse memory.",
    phase: "plan",
    status: blocked ? "blocked" : "completed",
    contextPack: baseContext(args, { parentSummary: intakeFrame.stateDelta?.summary, expectedOutputSchema: "cache_first_task_dag_v1" }),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.plan,
    stateDelta: {
      summary: `${children.length} child frame candidates; ${args.freshHitCount} fresh cache hits; ${args.cacheHitCount - args.freshHitCount} stale cache hits.`,
      changedArtifacts: [],
      cacheKeysTouched: cacheKeys,
      okfConceptIdsTouched: [],
      openQuestions: baseContext(args).openQuestions,
      nextActions: blocked ? ["Wait for blocking proposal/plan conflict resolution."] : ["Execute stale/missing child frames."],
    },
  };

  const executeFrame: ReasoningFrame = {
    frameId: executeId,
    parentFrameId: planId,
    goal: "Execute bounded entity/facet work, using cache first and spawning narrow child frames only for stale or missing work.",
    phase: "execute",
    status: blocked ? "blocked" : children.length ? "pending" : "completed",
    contextPack: baseContext(args, { parentSummary: planFrame.stateDelta?.summary, expectedOutputSchema: "entity_facet_result_with_evidence_v1" }),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.execute,
    evidenceState: {
      required: ["source or upload evidence for every completed research claim", "freshness timestamp", "confidence or needs_review status"],
      availableRefs: args.facetPlans.filter((plan) => plan.cacheHit?.cacheId).map((plan) => String(plan.cacheHit?.cacheId)),
      missingRefs: missingEvidence,
      staleRefs: staleEvidence,
    },
  };

  const verifyFrame: ReasoningFrame = {
    frameId: verifyId,
    parentFrameId: executeId,
    goal: "Verify evidence sufficiency, stale facts, no-op writes, and unsupported claims before synthesis.",
    phase: "verify",
    status: blocked ? "blocked" : children.length ? "pending" : "completed",
    contextPack: baseContext(args, { parentSummary: executeFrame.goal, expectedOutputSchema: "verified_evidence_state_v1" }),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.verify,
    evidenceState: executeFrame.evidenceState,
  };

  const synthesizeFrame: ReasoningFrame = {
    frameId: synthesizeId,
    parentFrameId: verifyId,
    goal: "Summarize job outcome for the room, Trace Lens, and downstream handoff drafts.",
    phase: "synthesize",
    status: blocked ? "blocked" : children.length ? "pending" : "completed",
    contextPack: baseContext(args, { parentSummary: verifyFrame.goal, expectedOutputSchema: "room_work_final_summary_v1" }),
    toolAllowlist: FRAME_TOOL_ALLOWLIST.synthesize,
  };

  const decision: FrameDecision = blocked
    ? { next: "block", reason: args.blockedReason ?? "Room work is blocked.", childFrameCount: children.length, blockedReason: args.blockedReason }
    : children.length
      ? { next: "spawn_children", reason: "Stale or missing entity/facet work requires bounded child frames.", childFrameCount: children.length }
      : { next: "finish", reason: "Fresh cache/manual capture satisfied every facet without model/provider work.", childFrameCount: 0 };

  const frames = [intakeFrame, planFrame, executeFrame, verifyFrame, synthesizeFrame];
  return {
    schema: REASONING_FRAME_PLAN_SCHEMA,
    capability: "harness_recursive_reasoning",
    framePlanId: args.framePlanId,
    globalGoal: args.globalGoal,
    frames,
    childFrames: childSample,
    childFrameSampleLimit: sampleLimit,
    childFrameCount: children.length,
    decision,
    summary: {
      phases: frames.map((frame) => frame.phase),
      entityCount: args.entities.length,
      facetCount: args.facets.length,
      facetPlanCount: args.facetPlans.length,
      cachePolicyCounts: cachePolicyCounts(args.facetPlans),
      cacheKeyCount: cacheKeys.length,
      openQuestionCount: baseContext(args).openQuestions.length,
    },
  };
}
