/**
 * RoomStore — the seam between the UI and its data source.
 *
 * The presentational components (Chat, Artifact, LeftRail, RoomShell) call
 * `useStore()` and never touch the engine or Convex directly. Two providers
 * satisfy the same interface:
 *   - EngineStoreProvider — the in-memory RoomEngine (no keys; the demo).
 *   - ConvexStoreProvider — live Convex (reactive useQuery + optimistic mutations).
 * App picks the provider based on whether VITE_CONVEX_URL is set.
 */

import { createContext, useContext, useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { FeedItem } from "../../convex/roomActivity";
import type { TraceRecord } from "../ui/panels/traceData";
import { engine, demo, useEngineRev, runDemo } from "./roomStore";
// Specific imports (NOT the nodeagent barrel) so Node-only model adapters never reach the client bundle.
import { runAgent as runHarness } from "../nodeagent/core/runtime";
import type { AgentModel } from "../nodeagent/core/types";
import { buildUnifiedAgentStreamParts, type PersistedAgentStreamEvent, type UnifiedAgentStreamPart } from "../nodeagent/core/stream";
import { recomputeVariancePlan, companyResearchPlan, notebookOutlinePlan } from "../nodeagent/core/plans";
import { buildResearchContext, buildNoteContext } from "../nodeagent/core/worldModel";
import { scriptedModel } from "../nodeagent/models/scripted";
import { InMemoryRoomTools } from "../nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../nodeagent/skills/spreadsheet/cellMutator";
import { createCreditLedger, type CreditBalance, type CreditLedger, type ReserveResult, type SettleResult, type UsageEvent } from "../nodeagent/core/creditLedger";
import { type AgentCreditMode, type CostEstimate, DEFAULT_CREDIT_MODE, DEMO_CREDIT_CONFIG, estimateCostFor } from "../nodeagent/core/creditModel";

/** Demo-mode pacing: yield ~`ms` between scripted agent steps so the UI paints every CAS beat.
 *  The steps are real engine mutations — this only makes them watchable (a run that completes in
 *  one tick demos as a dishonest-looking 0->100% jump; gemini GIF-judge finding, 2026-06-11). */
function paced(model: AgentModel, ms: number): AgentModel {
  return { ...model, next: async (args) => { await new Promise((r) => setTimeout(r, ms)); return model.next(args); } };
}
import { RESEARCH_PLAN } from "../engine/demoRoom";
import { CAPTURE_NOTEBOOK_DOC } from "../engine/demoRoom";
import type { Actor, Artifact, ArtifactMeta, ArtifactVisibility, Channel, Lock, Member, Message, Room, TraceEvent, AgentSession, Draft, ChangeOp, Proposal, ResearchRowInput } from "../engine/types";
import type { UploadedArtifactInput, UploadedSourceFile } from "./uploadedArtifact";
import type { ArtifactRef } from "../ui/artifactRefs";
import { OfflineEditQueue, isNetworkError, type OfflineQueueSnapshot } from "../notifications/offlineQueue";

export type { OfflineQueueSnapshot } from "../notifications/offlineQueue";

/** The canonical Q3 variance the Room Agent computes (used by the no-keys /ask + collab). */
const VARIANCE: Record<string, string> = { r_rev: "+24%", r_cogs: "+27.5%", r_gp: "+21.7%", r_ni: "+22.4%" };

export type EditFeedback = { ok: boolean; reason?: string; version?: number };
type UndoEntry = { roomId: string; op: ChangeOp };
export type AgentRunTelemetry = { model: string; steps: number; toolCalls: number; inputTokens: number; outputTokens: number; costUsd: number; ms: number };
export type AgentJobTelemetry = {
  id: string;
  status: string;
  entrypoint?: string;
  scope?: string;
  runtime?: string;
  runtimeProfile?: AgentRuntimeProfile;
  attempts: number;
  maxAttempts: number;
  modelPolicy: string;
  approvalPolicy?: string;
  evidencePolicy?: string;
  stopReason?: string;
  nextRunAt?: number;
  finalText?: string;
  error?: string;
  latestRunId?: string;
  actionSliceCount?: number;
  queryCount?: number;
  mutationCount?: number;
  modelCallCount?: number;
  toolCallCount?: number;
  schedulerHandoffCount?: number;
  receiptCount?: number;
  createdAt?: number;
  updatedAt: number;
};

/** Shape of a free-auto agent job row from the convex jobs subscription (used by lastLongFreeJob + activeLongFreeJobs). */
type FreeJobRow = {
  _id: string; status: string; entrypoint?: string; scope?: string; runtime?: string; attempts: number; maxAttempts: number;
  runtimeProfile?: AgentRuntimeProfile; modelPolicy: string; approvalPolicy?: string; evidencePolicy?: string; handoff?: { reason?: string }; nextRunAt?: number;
  finalText?: string; error?: string; latestRunId?: string; actionSliceCount?: number; queryCount?: number; mutationCount?: number;
  modelCallCount?: number; toolCallCount?: number; schedulerHandoffCount?: number; receiptCount?: number; createdAt?: number; updatedAt: number;
};
/** A job is an active "work lane" until it succeeds or is cancelled — failed/paused stay visible so the user can retry/dismiss. */
function isActiveFreeJob(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}
function mapConvexFreeJob(j: FreeJobRow): AgentJobTelemetry {
  return {
    id: String(j._id),
    status: j.status,
    entrypoint: j.entrypoint,
    scope: j.scope,
    runtime: j.runtime,
    runtimeProfile: j.runtimeProfile,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    modelPolicy: j.modelPolicy,
    approvalPolicy: j.approvalPolicy,
    evidencePolicy: j.evidencePolicy,
    stopReason: j.handoff?.reason,
    nextRunAt: j.nextRunAt,
    finalText: j.finalText,
    error: j.error,
    latestRunId: j.latestRunId ? String(j.latestRunId) : undefined,
    actionSliceCount: j.actionSliceCount,
    queryCount: j.queryCount,
    mutationCount: j.mutationCount,
    modelCallCount: j.modelCallCount,
    toolCallCount: j.toolCallCount,
    schedulerHandoffCount: j.schedulerHandoffCount,
    receiptCount: j.receiptCount,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}
export type AgentJobAttemptTelemetry = {
  attempt: number;
  status: string;
  resolvedModel: string;
  stopReason: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  scheduledNextAt?: number;
};
export type AgentJobDetailTelemetry = {
  operations: Array<{ sequence: number; kind: string; name: string; status: string; countDelta?: number; targetKind?: string; targetId?: string; affectedIds?: string[] }>;
  streamEvents: PersistedAgentStreamEvent[];
  streamParts: UnifiedAgentStreamPart[];
  reasoningFrames: Array<{
    frameId: string;
    parentFrameId?: string;
    sequence: number;
    frameKind: "phase" | "child";
    phase: string;
    status: string;
    goal: string;
    cacheKey?: string;
    displayName?: string;
    facet?: string;
    cachePolicy?: string;
    toolAllowlist: string[];
  }>;
  receipts: Array<{ id: string; mutationName: string; affectedIds: string[]; createdAt: number }>;
  leases: Array<{ targetKind: string; targetId: string; mode: string; status: string; expiresAt: number }>;
  draftOperations: Array<{ operationName: string; status: string; affectedIds: string[]; createdAt: number }>;
  latestSteps: Array<{ idx: number; tool: string; status: string; elementId?: string; mutationReceiptIds?: string[] }>;
};
export type OkfTraceLensTelemetry = {
  concepts: Array<{ conceptId: string; path: string; type: string; title?: string; status?: string; visibility: string; updatedAt: number }>;
  edges: Array<{ fromConceptId: string; toConceptId: string; label: string; kind: string }>;
  events: Array<{ tool: string; query: string; status: string; hitConceptIds: string[]; latencyMs: number; provider?: string; model?: string; createdAt: number }>;
  outbox: { queued: number; running: number; completed: number; failed: number };
  chunkCount: number;
};
export type { UploadedArtifactInput } from "./uploadedArtifact";
export type AgentModelSelection =
  | { mode: "adaptive" }
  | { mode: "free" }
  | { mode: "top_paid" }
  | { mode: "specific"; modelPolicy: string };
export type AgentRuntimeProfile = "benchmark_completion";
export type AgentAskInput = {
  goal: string;
  references?: ArtifactRef[];
  modelSelection?: AgentModelSelection;
  contextArtifactId?: string;
  runtimeProfile?: AgentRuntimeProfile;
  maxAttempts?: number;
  /** Credit/depth mode for the run (Quick/Standard/Deep). Defaults to the store's selected mode. */
  mode?: AgentCreditMode;
};
export type ActorProof = { actor: Actor; token: string };
export type PrivateStreamAccess = { requester: ActorProof; driven: boolean };
export type PresenceTargetKind = "cell" | "notebook_block" | "deck_component" | "slide";
export type PresenceMode = "focus" | "edit" | "agent_intent" | "commit_lease";
export type PublicPresenceMode = "focus" | "edit";
export type PresenceClaim = {
  id: string;
  roomId: string;
  artifactId?: string;
  targetKind: PresenceTargetKind;
  targetId: string;
  mode: PresenceMode;
  actor: Actor;
  label?: string;
  color?: string;
  updatedAt: number;
  expiresAt: number;
};

/** One row of the passive room-intelligence feed. Mirrors the backend `FeedItem` contract
 *  exported from convex/roomActivity.ts — imported directly so backend/client drift is a
 *  compile error, not a silent runtime mismatch. */
export type PassiveActivityItem = FeedItem;
export type PassiveSheetOpenResult = { artifactId: string; rowId: string; created: boolean };

type DurableAgentRoute = {
  entrypoint: "public_ask" | "free";
  routePolicy: "fast_default" | "free_auto" | "top_paid" | "explicit";
  modelPolicy?: string;
  approvalPolicy: "draft_first" | "auto_commit_safe";
  autoAllow: boolean;
};

function durableRouteForModelSelection(selection?: AgentModelSelection, forced?: "free"): DurableAgentRoute {
  if (forced === "free" || selection?.mode === "free") {
    return { entrypoint: "free", routePolicy: "free_auto", approvalPolicy: "draft_first", autoAllow: false };
  }
  if (selection?.mode === "top_paid") {
    return { entrypoint: "public_ask", routePolicy: "top_paid", approvalPolicy: "auto_commit_safe", autoAllow: true };
  }
  if (selection?.mode === "specific") {
    const modelPolicy = selection.modelPolicy.trim();
    return {
      entrypoint: "public_ask",
      routePolicy: modelPolicy ? "explicit" : "fast_default",
      modelPolicy: modelPolicy || undefined,
      approvalPolicy: "auto_commit_safe",
      autoAllow: true,
    };
  }
  return { entrypoint: "public_ask", routePolicy: "fast_default", approvalPolicy: "auto_commit_safe", autoAllow: true };
}

function browserNodeAgentRuntimeProfile(): AgentRuntimeProfile | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const urlValue = params.get("nodeagentRuntimeProfile") ?? params.get("nodeagentProfile");
    const focusMode = params.get("focusMode");
    const storedValue = window.localStorage?.getItem("noderoom.nodeagentRuntimeProfile");
    return urlValue === "benchmark_completion" || storedValue === "benchmark_completion" || focusMode === "1" || focusMode === "true"
      ? "benchmark_completion"
      : undefined;
  } catch {
    return undefined;
  }
}

function maxAttemptsForRuntimeProfile(runtimeProfile: AgentRuntimeProfile | undefined, requested?: number): number | undefined {
  if (runtimeProfile === "benchmark_completion") return Math.max(requested ?? 1000, 1000);
  return requested;
}

export interface RoomStore {
  mode: "memory" | "convex";
  getRoom(roomId: string): Room | undefined;
  /** Distinguishes a still-loading subscription from a room that resolved to not-found, so callers
   *  can show an honest terminal state + escape hatch instead of a forever "Loading room…". */
  roomState(): "loading" | "notFound" | "ready";
  listMembers(roomId: string): Member[];
  listArtifacts(roomId: string): Artifact[];
  getArtifact(id: string): Artifact | undefined;
  listMessages(roomId: string, channel: Channel): Message[];
  actorProof(): ActorProof | null;
  privateStreamAccess(streamId: string): PrivateStreamAccess | null;
  listTraces(roomId: string): TraceEvent[];
  /** Live web/SEC source captures (screenshot + box) as Trace records — [] in memory mode. */
  listCaptureRecords(roomId: string): TraceRecord[];
  /** Signal the Trace tab is active so the store subscribes to trace-only Convex queries (captures,
   *  OKF lens) — zero reactive cost when the tab is closed (no getUrl resolutions, no DB reads). */
  setTraceActive(active: boolean): void;
  /** Tell the store which capture record is selected so it can lazy-resolve screenshot/PDF URLs
   *  for that one record only (via `captureDetail`) — pass null when a non-capture record is selected. */
  setSelectedCapture(captureId: string | null): void;
  /** Trigger a live source capture (Convex action) → persists + reactively appears in listCaptureRecords. */
  captureSource(roomId: string, url: string, goal: string): Promise<{ ok: boolean; error?: string }>;
  /** Authoritative SEC EDGAR facts (data API) → persists + appears in listCaptureRecords. */
  secFacts(roomId: string, company: string, concept: string): Promise<{ ok: boolean; error?: string }>;
  /** Write a PDF citation directly from the client (1 mutation, 0 actions, 0 storage writes).
   *  The PDF is already in storage; the citation references it by storage ID + page + normalized box. */
  recordCitation(args: { roomId: string; pdfStorageId: string; page: number; box: { x: number; y: number; w: number; h: number }; label: string; source?: string }): Promise<{ ok: boolean; error?: string }>;
  listSessions(roomId: string): AgentSession[];
  listDrafts(roomId: string): Draft[];
  listProposals(roomId: string): Proposal[];
  listPresence(roomId: string, artifactId: string): PresenceClaim[];
  updatePresence(args: { roomId: string; artifactId: string; targetKind: PresenceTargetKind; targetId: string; mode: PublicPresenceMode; actor: Actor; label?: string; color?: string; ttlMs?: number }): void;
  clearPresence(args: { roomId: string; artifactId: string; targetKind?: PresenceTargetKind; targetId?: string; mode?: PresenceMode; actor: Actor }): void;
  lockFor(artifactId: string, elementId: string): Lock | undefined;
  awareness(roomId: string, agentId?: string): { activeLocks: Lock[] };
  /** Apply a hand edit (CAS). Returns feedback so the UI can surface a conflict honestly. */
  applyEdit(args: { roomId: string; op: ChangeOp; actor: Actor }): Promise<EditFeedback>;
  /** Offline edit-hold: live-mode CAS edits that failed on a TRANSPORT error (not a server answer)
   *  are held (bounded, oldest-dropped-with-count) and replayed on reconnect through the same
   *  applyEdit path. Optional — memory mode has no transport to lose, so it omits it. */
  offlineEditQueue?(): OfflineQueueSnapshot;
  /** Clear the replay-conflict tally after the shell has surfaced it to the user. */
  acknowledgeOfflineConflicts?(): void;
  canUndo(roomId: string): boolean;
  undoLastEdit(roomId: string, actor: Actor): Promise<EditFeedback>;
  /** Send a chat message. Returns feedback so the UI can surface a failed send (and offer retry) instead of letting the optimistic bubble silently vanish. */
  postMessage(args: { roomId: string; channel: Channel; author: Actor; text: string; clientMsgId: string; kind?: Message["kind"] }): Promise<EditFeedback>;
  /** Edit your own already-sent message in place. Returns feedback so a rejected edit reverts visibly, not silently. */
  editMessage(messageId: string, text: string, author: Actor): Promise<EditFeedback>;
  toggleAutoAllow(roomId: string, actor: Actor): void;
  /** Approve/reject a proposal. Returns feedback so an approve that loses a CAS race surfaces the conflict instead of a false "applied". */
  resolveProposal(proposalId: string, approve: boolean, actor: Actor): Promise<EditFeedback>;
  addResearchRows(args: { roomId: string; artifactId: string; rows: ResearchRowInput[]; actor: Actor }): Promise<number>;
  uploadArtifact(args: { roomId: string; artifact: UploadedArtifactInput; actor: Actor; visibility?: ArtifactVisibility }): Promise<string>;
  /** Owner-gated: share your own sheet to the room, or pull it back to private (two-way). */
  setArtifactVisibility(args: { roomId: string; artifactId: string; visibility: "private" | "room"; actor: Actor }): Promise<{ ok: boolean; error?: string }>;
  /** Owner-gated topic + metadata edit (rename + agent-managed summary/tags). */
  setArtifactMeta(args: { roomId: string; artifactId: string; title?: string; summary?: string; tags?: string[]; actor: Actor }): Promise<{ ok: boolean; error?: string }>;
  canRunCollab: boolean;
  runCollab(): Promise<void>;
  /** Memory-mode product drill: creates a stale agent draft and routes it through CRS review. */
  runSemanticConflictDrill?(): Promise<void>;
  /** Drive the public Room NodeAgent on a free-form goal — the `/ask` path. */
  askAgent(input: AgentAskInput): Promise<void>;
  /** Drive the per-user PRIVATE NodeAgent. Default: reads the room, replies in the user's own private
   * channel. With `{ publish: true }`: the agent acts in the shared room (edits the sheet + posts public
   * chat) as the user's personal agent, attributed to them. */
  askPrivateAgent(input: AgentAskInput, opts?: { publish?: boolean }): Promise<void>;
  startLongFreeAgent(input: AgentAskInput): Promise<void>;
  /** Enrich every PENDING company on the research sheet (ParselyFi loop) — status-gated, sourced. */
  askResearch(): Promise<void>;
  /** The most recent agent run's telemetry (model · tokens · cost · latency), or null. */
  lastRun(): AgentRunTelemetry | null;
  lastLongFreeJob(): AgentJobTelemetry | null;
  lastLongFreeJobAttempts(): AgentJobAttemptTelemetry[];
  lastLongFreeJobDetail(): AgentJobDetailTelemetry | null;
  /** All in-flight agent jobs for the room (running/queued/paused/failed), most recent first — drives the Room Home
   *  "work lanes". Optional: memory mode returns 0–1; convex mode returns every active job. */
  activeLongFreeJobs?(): AgentJobTelemetry[];
  /** Credit ledger — memory mode runs a real demo ledger (demo:true, enforced:true); live (convex)
   *  exposes these only once the backend deploys. Optional so the convex provider can omit them
   *  until then (the UI renders an honest "not metered" state). */
  creditBalance?(): CreditBalance;
  creditMode?(): AgentCreditMode;
  setCreditMode?(mode: AgentCreditMode): void;
  estimateCredits?(mode: AgentCreditMode): CostEstimate;
  reserveCredits?(args: { mode: AgentCreditMode; note?: string }): ReserveResult;
  settleCredits?(args: { reservationId: string; actualUsd?: number }): SettleResult;
  listUsageEvents?(): UsageEvent[];
  okfTraceLens(roomId: string): OkfTraceLensTelemetry | null;
  cancelLongFreeJob(jobId: string): Promise<EditFeedback>;
  retryLongFreeJob(jobId: string): Promise<EditFeedback>;
  /** Passive room-intelligence feed: noteworthy detections, queued/running scans, and failed work.
   *  [] in memory mode (the demo has no passive backend); reactive in convex mode. */
  listPassiveActivity(roomId: string): PassiveActivityItem[];
  /** P3: Cost preview with p50/p90/hard cap bands and confidence levels.
   *  Null in memory mode; reactive in convex mode. */
  researchCostPreview(): { p50Usd: number; p90Usd: number; hardCapUsd: number; avgTokens: number; sampleSize: number; confidence: "high" | "medium" | "low"; basis: string } | null;
  /** P3: Room assistive policy — mode, watchlist, disabled signals. */
  roomAssistivePolicy(): { mode: string; allowExternalCalls: boolean; maxSuggestionsPerHour: number; disabledSignalKinds: string[]; approvedEntityWatchlist: string[]; source: string } | null;
  /** P3: Set room assistive policy. */
  setRoomAssistivePolicy(mode: string, opts?: { allowExternalCalls?: boolean; maxSuggestionsPerHour?: number; disabledSignalKinds?: string[]; approvedEntityWatchlist?: string[] }): Promise<void>;
  /** Dismiss a passive-activity item — sets it to `ignored` so it leaves the chip count.
   *  Memory mode drops it from the seeded list immediately; live mode calls the Convex mutation.
   *  P3: Optional dismissReason and scope enable signal-scoped suppression learning. */
  dismissActivity(activityId: string, actor: Actor, dismissReason?: string, scope?: string): Promise<void>;
  /** Flip a passive-activity item to `job_created` / Researching. Memory mode updates the seeded list;
   *  live mode starts a research agent job scoped to the item's entity. */
  researchActivity(item: PassiveActivityItem, actor: Actor): Promise<void>;
  /** P1: Batch approve multiple passive-activity items for research at once.
   *  Deduplicates entities across the batch so one entity mentioned in multiple sources
   *  only gets one research job. Returns counts of succeeded/failed jobs. */
  batchResearchActivity(items: PassiveActivityItem[], actor: Actor): Promise<{ ok: boolean; total?: number; succeeded?: number; failed?: number }>;
  /** Coach Mode: turn a `create_coach_cue` item into an explain-and-defend evaluation.
   *  Live mode starts a coach_eval agentJob scoped to the item's visibility and stores the
   *  user's answer + expected outline on the roomActivityOutbox row's finding. Memory mode is
   *  a no-op (the demo has no coach evaluator). */
  practiceActivity(item: PassiveActivityItem, actor: Actor, userAnswer: string, expectedOutline?: string): Promise<void>;
  /** Propose adding the item's entity as a row on the company research sheet. MUST go through
   *  draft/proposal path — never a silent clobber. Memory mode is a no-op (no sheet to target). */
  addActivityToSheet(item: PassiveActivityItem, actor: Actor): Promise<PassiveSheetOpenResult | void>;
}

const Ctx = createContext<RoomStore | null>(null);
export function useStore(): RoomStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside a RoomStore provider");
  return s;
}
export const HAS_CONVEX =
  !!import.meta.env.VITE_CONVEX_URL &&
  !(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "memory");

/** convex.site deployment URL (NOT .convex.cloud) — the persistent-text-streaming httpAction host. */
export const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? "";
const locallyCreatedPrivateStreams = new Set<string>();

function researchRowIds(art: Artifact): string[] {
  const ids: string[] = [];
  for (const eid of art.order) { const rid = eid.split("__")[0]; if (!ids.includes(rid)) ids.push(rid); }
  return ids;
}
function slugCompany(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "company";
}
function researchTargetFor(art: Artifact, rowId: string) {
  const seeded = RESEARCH_PLAN.find((p) => p.rowId === rowId);
  if (seeded) return seeded;
  const company = String(art.elements[`${rowId}__company`]?.value ?? rowId);
  const website = String(art.elements[`${rowId}__website`]?.value ?? "") || `https://www.${slugCompany(company)}.com`;
  return {
    rowId,
    summary: `${company} - sourced account profile with GTM fit and recent signal.`,
    funding: "Funding signal captured from sourced research.",
    headcount: "Headcount signal captured from sourced research.",
    recentSignal: "Recent GTM signal captured from sourced research.",
    sourceUrl: website,
    source2Url: `https://en.wikipedia.org/wiki/${encodeURIComponent(company.replace(/\s+/g, "_"))}`,
  };
}

function targetSheet(artifacts: Artifact[], refs?: ArtifactRef[]): Artifact | undefined {
  const refSheet = refs
    ?.map((ref) => artifacts.find((a) => a.id === ref.id && a.kind === "sheet"))
    .find(Boolean);
  return refSheet ?? artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet");
}

/** Kind-agnostic target: a referenced note/wall/sheet is selectable so the live agent can edit ANY
 *  artifact (not just the variance sheet). Falls back to the variance sheet, any sheet, then artifact[0]. */
function targetArtifact(artifacts: Artifact[], refs?: ArtifactRef[]): Artifact | undefined {
  const ref = refs?.map((r) => artifacts.find((a) => a.id === r.id)).find(Boolean);
  return ref ?? artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet") ?? artifacts[0];
}

function canonicalRefs(artifacts: Artifact[], refs?: ArtifactRef[]): ArtifactRef[] | undefined {
  const canonical = refs
    ?.map((ref) => artifacts.find((a) => a.id === ref.id))
    .filter((art): art is Artifact => !!art)
    .map((art) => ({ id: art.id, title: art.title, kind: art.kind }));
  return canonical?.length ? canonical : undefined;
}

function isVarianceSheet(art: Artifact): boolean {
  return ["r_rev__variance", "r_cogs__variance", "r_gp__variance", "r_ni__variance"].some((id) => !!art.elements[id]);
}

/**
 * Demo intent router. A chat `@nodeagent …` command names the real task; memory mode has no
 * API key / CSP path to a live LLM, so a recognized diligence intent runs the deterministic
 * scripted no-clobber plan (research / runway / variance) end-to-end instead of dead-ending on
 * the "ENRICH/CLASSIFY staged next" message. Order matters: runway is checked before research
 * because the runway prompt also mentions the company watchlist.
 */
function classifyDemoIntent(goal: string): "research" | "runway" | "variance" | "notes" | null {
  const g = goal.toLowerCase();
  if (/\b(runway|milestone|milestones|burn)\b/.test(g)) return "runway";
  // Notebook parse/summarize requests route to the governed outline lane —
  // checked before research so "summarize my meeting notes" never falls into
  // the sheet-research plan.
  if (/\bnotebook\b|\b(meeting|call)\s+notes\b|\b(parse|summari[sz]e|structure)\b[^.]*\bnotes?\b/.test(g)) return "notes";
  if (/(diligence|research|enrich|profile|source-?backed|funding|hiring|hipaa|security|buyer|watchlist|compan)/.test(g)) return "research";
  if (/\b(variance|recompute)\b/.test(g)) return "variance";
  return null;
}

/** Sourced cash + burn the agent "finds", then computes runway from — keyed by runway-sheet rowId. */
const RUNWAY_SOURCED: Record<string, { cash: string; burn: string; runway: string; status: string }> = {
  rw_cardionova: { cash: "$2.1M (Q2'26 board pack)", burn: "$180K/mo", runway: "~11.7 months (to ~Jun 2027)", status: "sourced" },
  rw_pulley: { cash: "$3.4M (May'26 update)", burn: "$210K/mo", runway: "~16.2 months (to ~Oct 2027)", status: "sourced" },
};

function referenceNames(refs?: ArtifactRef[]): string {
  return refs?.length ? refs.map((ref) => ref.title).join(", ") : "the referenced artifact";
}

function sheetContextLabel(sheet: Artifact): string {
  const grid = sheet.meta?.excelGrid;
  if (grid) return `Excel workbook grid (${grid.sheetName}, ${grid.rows} rows x ${grid.columns} columns)`;
  return `structured dataframe context (${sheet.meta?.dataframe?.rowCount ?? "unknown"} rows)`;
}

function withReferenceContext(goal: string, refs?: ArtifactRef[]): string {
  if (!refs?.length) return goal;
  const context = refs.map((ref) => `${ref.title} (${ref.kind}, id=${ref.id})`).join("; ");
  return `${goal}\n\nStructured references: ${context}`;
}

function makeUndoEntry(roomId: string, art: Artifact | undefined, op: ChangeOp, appliedVersion?: number): UndoEntry | null {
  const before = art?.elements[op.elementId];
  if (op.kind === "create") {
    return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "delete", value: null, baseVersion: appliedVersion ?? 1 } };
  }
  if (!before) return null;
  if (op.kind === "delete") {
    return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "create", value: before.value, baseVersion: 0 } };
  }
  return { roomId, op: { opId: crypto.randomUUID(), artifactId: op.artifactId, elementId: op.elementId, kind: "set", value: before.value, baseVersion: appliedVersion ?? before.version + 1 } };
}

function pushUndo(stack: Map<string, UndoEntry[]>, entry: UndoEntry | null) {
  if (!entry) return;
  const rows = stack.get(entry.roomId) ?? [];
  rows.push(entry);
  if (rows.length > 50) rows.splice(0, rows.length - 50);
  stack.set(entry.roomId, rows);
}

function withAppliedVersion(entry: UndoEntry | null, version?: number): UndoEntry | null {
  if (!entry || version === undefined || entry.op.kind === "create") return entry;
  return { ...entry, op: { ...entry.op, baseVersion: version } };
}

/* ── in-memory (RoomEngine) ── */
type StoredUploadRef = {
  fileId: string;
  storageId: string;
  sha256?: string;
  size: number;
  mimeType: string;
};

function withStoredSourceMeta(meta: ArtifactMeta | undefined, sourceFile: UploadedSourceFile, stored: StoredUploadRef): ArtifactMeta {
  return {
    ...meta,
    upload: {
      fileName: meta?.upload?.fileName ?? sourceFile.fileName,
      mimeType: meta?.upload?.mimeType ?? stored.mimeType ?? sourceFile.mimeType,
      size: meta?.upload?.size ?? sourceFile.size,
      parsedAt: meta?.upload?.parsedAt ?? Date.now(),
      sourceStorageId: stored.storageId,
      uploadedFileId: stored.fileId,
      sha256: stored.sha256,
    },
  };
}

/** Scripted passive-intelligence seed for the memory-demo room. Deterministic and
 *  reproducible: the same CardioNova item appears after the first saved capture note so the
 *  walkthrough clip stays honest (labeled "memory-mode demo") without relying on live LLM timing. */
const DEMO_PASSIVE_SEED: PassiveActivityItem[] = [
  {
    id: "mem-passive-cardionova-1",
    sourceKind: "node",
    sourceId: "mem-node-1",
    eventKind: "content_committed",
    status: "noteworthy",
    visibility: "room",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entityNames: ["CardioNova"],
    facets: ["funding", "runway_inputs"],
    reasons: ["organization_candidate", "finance_signal", "research_signal"],
    score: 0.82,
    action: "start_research_job",
    textPreview: "Met Maya from CardioNova. AI triage for hospitals. Possible Series B. Need to ask about burn and hospital pilots.",
  },
];

const MEMORY_FREE_JOB_DELAY_MS = 2_000;
type MemoryFreeJobTask = { goal: string; references?: ArtifactRef[]; cancelledAttempts: Set<number> };
type MemoryFreeJobDetailOptions = { affectedIds?: string[]; appliedIds?: string[] };

function memoryFreeJobDetail(goal: string, status: "running" | "completed" | "cancelled", options: MemoryFreeJobDetailOptions = {}): AgentJobDetailTelemetry {
  const affectedIds = options.affectedIds ?? ["r_gp__variance", "r_ni__variance"];
  const appliedIds = options.appliedIds ?? [];
  const patchStatus = status === "cancelled" ? "cancelled" : status === "completed" ? (appliedIds.length ? "done" : "skipped") : "running";
  const now = Date.now();
  const terminal = status === "completed" || status === "cancelled";
  const streamEvents: PersistedAgentStreamEvent[] = [
    { sequence: 1, kind: "message_start", status: "started", title: "Room NodeAgent", text: goal, createdAt: now },
    { sequence: 1_000, kind: "step_start", step: 0, status: "started", title: "Resolve affected cells", createdAt: now },
    { sequence: 1_000.5, kind: "text_delta", step: 0, status: "streaming", text: "Working through the visible sheet cells. ", createdAt: now },
    { sequence: 1_001, kind: "tool_call_start", step: 0, toolCallId: "memory-derive", toolName: "derive_affected_set", status: "started", input: { goal }, createdAt: now },
    { sequence: 1_002, kind: "tool_call_result", step: 0, toolCallId: "memory-derive", toolName: "derive_affected_set", status: "completed", output: { affectedIds }, createdAt: now },
    { sequence: 1_003, kind: "tool_call_start", step: 0, toolCallId: "memory-patch", toolName: "patch_bundle_cas", status: "started", input: { affectedIds }, createdAt: now },
    { sequence: 1_004, kind: "tool_call_result", step: 0, toolCallId: "memory-patch", toolName: "patch_bundle_cas", status: patchStatus === "running" ? "started" : patchStatus === "done" ? "completed" : "skipped", output: { affectedIds: appliedIds.length ? appliedIds : affectedIds }, createdAt: now },
    ...(terminal ? [{ sequence: 9_000, kind: "message_done" as const, status: status === "completed" ? "completed" as const : "failed" as const, text: status === "completed" ? "Memory-mode agent job completed." : "Memory-mode agent job cancelled.", createdAt: now }] : []),
  ];
  return {
    operations: [
      { sequence: 1, kind: "job", name: "derive_room_intent", status: "done", targetKind: "sheet", targetId: "Q3 variance", affectedIds },
      { sequence: 2, kind: "policy", name: "derive_free_auto_route", status: "done", countDelta: 1 },
      { sequence: 3, kind: "mutation", name: "patch_bundle_cas", status: patchStatus, countDelta: appliedIds.length, targetKind: "cell", affectedIds: appliedIds.length ? appliedIds : affectedIds },
    ],
    streamEvents,
    streamParts: buildUnifiedAgentStreamParts(streamEvents, { finalText: terminal ? streamEvents.at(-1)?.text : undefined, terminal }),
    reasoningFrames: [
      {
        frameId: "memory_intent",
        sequence: 1,
        frameKind: "phase",
        phase: "intent",
        status: "completed",
        goal,
        toolAllowlist: ["normalize_room_intent", "derive_affected_set"],
      },
      {
        frameId: "memory_patch",
        sequence: 2,
        frameKind: "phase",
        phase: "patch",
        status: status === "cancelled" ? "cancelled" : status === "completed" ? "completed" : "running",
        goal: "Apply the final affected-set through the same CAS path as a durable job.",
        toolAllowlist: ["patch_bundle_cas"],
      },
    ],
    receipts: appliedIds.length
      ? [{ id: "memory-free-receipt", mutationName: "patch_bundle_cas", affectedIds: appliedIds, createdAt: Date.now() }]
      : [],
    leases: [],
    draftOperations: [],
    latestSteps: [
      { idx: 1, tool: "derive_affected_set", status: "completed" },
      { idx: 2, tool: "patch_bundle_cas", status: patchStatus, elementId: (appliedIds[0] ?? affectedIds[0]) },
    ],
  };
}

function plainTextFromHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

const CAPTURE_NOTEBOOK_SEED_TEXT = plainTextFromHtml(CAPTURE_NOTEBOOK_DOC);

export function EngineStoreProvider({ roomId, children }: { roomId: string; me: Actor; children: ReactNode }) {
  const rev = useEngineRev();
  const undoStack = useRef(new Map<string, UndoEntry[]>());
  // Reactive passive list for the memory demo. A useRef holds the mutable snapshot;
  // a useState counter forces re-renders when actions (Dismiss/Research) mutate the list.
  const memPassiveRef = useRef<PassiveActivityItem[]>([]);
  const memPassiveHydratedRef = useRef(false);
  const [memPassiveRev, setMemPassiveRev] = useState(0);
  // Memory-mode presence (reactive). The Convex presence path is live-only (a no-op in ?mode=memory);
  // this Map + rev counter makes presence real without a backend so the Attention Overlay — and its
  // tests — can show human/agent focus boxes. Keyed by `${roomId}|${artifactId}`.
  const memPresenceRef = useRef<Map<string, PresenceClaim[]>>(new Map());
  const memScalePresenceHydratedRef = useRef(false);
  const [memPresenceRev, setMemPresenceRev] = useState(0);
  const memLongJobRunRef = useRef(0);
  const memLongJobCurrentRef = useRef<AgentJobTelemetry | null>(null);
  const memLongJobTasksRef = useRef(new Map<string, MemoryFreeJobTask>());
  const [memLongJob, setMemLongJob] = useState<AgentJobTelemetry | null>(null);
  const [memLongJobAttempts, setMemLongJobAttempts] = useState<AgentJobAttemptTelemetry[]>([]);
  const [memLongJobDetail, setMemLongJobDetail] = useState<AgentJobDetailTelemetry | null>(null);
  // Credit ledger (memory demo): a real reserve→settle ledger seeded with the pilot's
  // 20-credit ($5) grant so the demo can "feel" the credit system. creditRev forces
  // re-render of balance/usage after every reserve/settle (useRef snapshot + rev counter,
  // same pattern as memPassive/memPresence above).
  const creditLedgerRef = useRef<CreditLedger>(createCreditLedger({ startingCredits: DEMO_CREDIT_CONFIG.startingCredits, demo: true, enforced: true }));
  const [creditMode, setCreditModeState] = useState<AgentCreditMode>(DEFAULT_CREDIT_MODE);
  const [creditRev, setCreditRev] = useState(0);
  const startMemoryFreeJob = useCallback((goal: string, references?: ArtifactRef[]) => {
    const now = Date.now();
    const id = `memory-free-auto-${++memLongJobRunRef.current}`;
    const job: AgentJobTelemetry = {
      id,
      status: "running",
      entrypoint: "free",
      scope: "public_room",
      runtime: "memory",
      attempts: 1,
      maxAttempts: 2,
      modelPolicy: "openrouter/free-auto",
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      actionSliceCount: 1,
      queryCount: 1,
      mutationCount: 0,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: 0,
      receiptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    memLongJobCurrentRef.current = job;
    memLongJobTasksRef.current.set(id, { goal, references, cancelledAttempts: new Set() });
    setMemLongJob(job);
    setMemLongJobAttempts([{ attempt: 1, status: "running", resolvedModel: "scripted/free-auto", stopReason: "in_progress", ms: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }]);
    setMemLongJobDetail(memoryFreeJobDetail(goal, "running"));
    return id;
  }, []);
  const completeMemoryFreeJob = useCallback((jobId: string, attempt: number, finalText: string, appliedIds: string[] = []) => {
    const now = Date.now();
    const cur = memLongJobCurrentRef.current;
    if (!cur || cur.id !== jobId || cur.status !== "running" || cur.attempts !== attempt) return;
    const task = memLongJobTasksRef.current.get(jobId);
    const completed: AgentJobTelemetry = {
      ...cur,
      status: "completed",
      finalText,
      actionSliceCount: 2,
      mutationCount: appliedIds.length,
      toolCallCount: appliedIds.length ? 2 : 1,
      receiptCount: appliedIds.length ? 1 : 0,
      updatedAt: now,
    };
    memLongJobCurrentRef.current = completed;
    setMemLongJob(completed);
    setMemLongJobAttempts((cur) => cur.map((attempt) => (
      attempt.status === "running"
        ? { ...attempt, status: "completed", stopReason: "done", ms: Math.max(attempt.ms, 420) }
        : attempt
    )));
    setMemLongJobDetail(memoryFreeJobDetail(task?.goal ?? "Memory free-auto job", "completed", { appliedIds }));
  }, []);
  const runMemoryFreeJob = useCallback(async (jobId: string, attempt: number) => {
    await new Promise((resolve) => setTimeout(resolve, MEMORY_FREE_JOB_DELAY_MS));
    const task = memLongJobTasksRef.current.get(jobId);
    if (!task || task.cancelledAttempts.has(attempt)) return;
    const current = memLongJobCurrentRef.current;
    if (!current || current.id !== jobId || current.status !== "running" || current.attempts !== attempt) return;

    const artifacts = engine.listArtifacts(roomId);
    const references = canonicalRefs(artifacts, task.references);
    const sheet = targetSheet(artifacts, references);
    const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
    if (!sheet || !sess) {
      completeMemoryFreeJob(jobId, attempt, "No public sheet was available for the memory free-auto job.");
      return;
    }

    const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
    if (!isVarianceSheet(sheet)) {
      const finalText = `Queued memory free-auto for ${referenceNames(references)}, but variance recompute only runs on Q3 variance.`;
      engine.postMessage({ roomId, channel: "public", author: actor, text: finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
      completeMemoryFreeJob(jobId, attempt, finalText);
      return;
    }

    const latest = engine.getArtifact(sheet.id) ?? sheet;
    const targets: Record<string, string> = {};
    for (const rid of Object.keys(VARIANCE)) {
      const elementId = `${rid}__variance`;
      if (!latest.elements[elementId]?.value) targets[elementId] = VARIANCE[rid];
    }
    const affectedIds = Object.keys(targets);
    if (affectedIds.length === 0) {
      const finalText = "Every variance cell is already filled - nothing to recompute.";
      engine.postMessage({ roomId, channel: "public", author: actor, text: finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
      completeMemoryFreeJob(jobId, attempt, finalText);
      return;
    }

    if (task.cancelledAttempts.has(attempt)) return;
    const appliedIds: string[] = [];
    for (const [elementId, value] of Object.entries(targets)) {
      if (task.cancelledAttempts.has(attempt)) return;
      const currentSheet = engine.getArtifact(sheet.id) ?? sheet;
      const baseVersion = currentSheet.elements[elementId]?.version ?? 0;
      const result = engine.applyEdit({
        roomId,
        op: { opId: `memory_free_${jobId}_${attempt}_${elementId}`, artifactId: sheet.id, elementId, kind: "set", value, baseVersion },
        actor,
      });
      if (result.ok) appliedIds.push(elementId);
    }
    const finalText = appliedIds.length
      ? `Memory free-auto applied ${appliedIds.length} variance update(s) through CAS.`
      : "Memory free-auto found no variance updates it could apply.";
    engine.postMessage({ roomId, channel: "public", author: actor, text: finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    completeMemoryFreeJob(jobId, attempt, finalText, appliedIds);
  }, [completeMemoryFreeJob, roomId]);
  useEffect(() => {
    if (roomId !== demo.roomId || memPassiveHydratedRef.current) return;
    const notebook = engine.listArtifacts(roomId).find((a) => a.kind === "note" && a.title === "Capture Notebook");
    const doc = plainTextFromHtml(String(notebook?.elements["doc"]?.value ?? ""));
    if (!doc || doc === CAPTURE_NOTEBOOK_SEED_TEXT) return;
    memPassiveHydratedRef.current = true;
    memPassiveRef.current = DEMO_PASSIVE_SEED.map((item) => ({ ...item, createdAt: Date.now(), updatedAt: Date.now() }));
    setMemPassiveRev((v) => v + 1);
  }, [rev, roomId]);
  useEffect(() => {
    if (memScalePresenceHydratedRef.current) return;
    const research = engine.listArtifacts(roomId).find((a) => a.kind === "sheet" && a.title === "Company research" && (a.meta?.dataframe?.rowCount ?? 0) >= 1_000);
    if (!research) return;
    const members = engine.listMembers(roomId);
    const session = engine.listSessions(roomId).find((s) => s.scope === "public");
    const now = Date.now();
    const k = `${roomId}|${research.id}`;
    const cur = memPresenceRef.current.get(k) ?? [];
    const add = (targetId: string, mode: PresenceClaim["mode"], actor: Actor, label: string, color?: string) => {
      cur.push({
        id: `${actor.id}:${targetId}:${mode}`,
        roomId,
        artifactId: research.id,
        targetKind: "cell",
        targetId,
        mode,
        actor,
        label,
        color,
        updatedAt: now,
        expiresAt: now + 600_000,
      } as PresenceClaim);
    };
    const priya = members.find((m) => m.name === "Priya");
    const maya = members.find((m) => m.name === "Maya");
    if (priya) add("sr_0004__owner", "focus", { kind: "user", id: priya.id, name: priya.name }, "Priya reviewing", priya.color);
    if (maya) add("sr_0012__funding", "focus", { kind: "user", id: maya.id, name: maya.name }, "Maya checking", maya.color);
    if (session) {
      const agent: Actor = { kind: "agent", id: session.agentId, name: session.agentName, scope: session.scope, ownerId: session.ownerId };
      add("sr_0005__summary", "agent_intent", agent, "NodeAgent writing");
      add("sr_0005__status", "commit_lease", agent, "NodeAgent publishing");
    }
    memPresenceRef.current.set(k, cur);
    memScalePresenceHydratedRef.current = true;
    setMemPresenceRev((v) => v + 1);
  }, [rev, roomId]);
  const store = useMemo<RoomStore>(() => ({
    mode: "memory",
    // memPassiveRev is included in deps (below) to force re-compute after Dismiss/Research.
    // creditRev/creditMode are in deps so balance + selected mode re-render after reserve/settle.
    creditBalance: () => creditLedgerRef.current.balance(),
    creditMode: () => creditMode,
    setCreditMode: (m: AgentCreditMode) => { setCreditModeState(m); },
    estimateCredits: (m: AgentCreditMode) => estimateCostFor(m),
    reserveCredits: (args: { mode: AgentCreditMode; note?: string }) => {
      const r = creditLedgerRef.current.reserve(args);
      setCreditRev((v) => v + 1);
      return r;
    },
    settleCredits: (args: { reservationId: string; actualUsd?: number }) => {
      const r = creditLedgerRef.current.settle(args);
      setCreditRev((v) => v + 1);
      return r;
    },
    listUsageEvents: () => creditLedgerRef.current.events(),
    getRoom: (id) => engine.getRoom(id),
    roomState: (): "loading" | "notFound" | "ready" => "ready",
    listMembers: (id) => engine.listMembers(id),
    listArtifacts: (id) => engine.listArtifacts(id),
    getArtifact: (id) => engine.getArtifact(id),
    listMessages: (id, ch) => engine.listMessages(id, ch),
    actorProof: () => null,
    privateStreamAccess: () => null,
    listTraces: (id) => engine.listTraces(id),
    listCaptureRecords: () => [], // in-memory engine doesn't capture live sources
    setTraceActive: () => {}, // no-op — in-memory mode has no reactive queries to gate
    setSelectedCapture: () => {}, // no-op — in-memory mode has no capture records
    captureSource: async () => ({ ok: false, error: "live capture needs the Convex backend" }),
    secFacts: async () => ({ ok: false, error: "SEC lookup needs the Convex backend" }),
    recordCitation: async () => ({ ok: false, error: "PDF citation needs the Convex backend" }),

    listSessions: (id) => engine.listSessions(id),
    listDrafts: (id) => engine.listDrafts(id),
    listProposals: (id) => engine.listProposals(id),
    listPresence: (id, artifactId) => {
      const now = Date.now();
      return (memPresenceRef.current.get(`${id}|${artifactId ?? ""}`) ?? []).filter(
        (c) => ((c as { expiresAt?: number }).expiresAt ?? Infinity) > now,
      );
    },
    updatePresence: (args) => {
      const k = `${args.roomId}|${args.artifactId ?? ""}`;
      const now = Date.now();
      const cur = (memPresenceRef.current.get(k) ?? []).filter(
        (c) =>
          ((c as { expiresAt?: number }).expiresAt ?? Infinity) > now &&
          !(c.actor.id === args.actor.id && c.targetId === args.targetId && c.mode === args.mode),
      );
      cur.push({
        id: `${args.actor.id}:${args.targetId}:${args.mode}`,
        roomId: args.roomId, artifactId: args.artifactId, targetKind: args.targetKind, targetId: args.targetId,
        mode: args.mode, actor: args.actor, label: args.label, color: args.color,
        updatedAt: now, expiresAt: now + (args.ttlMs ?? 15000),
      } as unknown as PresenceClaim);
      memPresenceRef.current.set(k, cur);
      setMemPresenceRev((v) => v + 1);
    },
    clearPresence: (args) => {
      const k = `${args.roomId}|${args.artifactId ?? ""}`;
      const cur = (memPresenceRef.current.get(k) ?? []).filter(
        (c) => !(c.actor.id === args.actor.id && (args.targetId == null || c.targetId === args.targetId) && (args.mode == null || c.mode === args.mode)),
      );
      memPresenceRef.current.set(k, cur);
      setMemPresenceRev((v) => v + 1);
    },
    lockFor: (aid, eid) => engine.lockFor(aid, eid),
    awareness: (id, aid) => engine.awareness(id, aid),
    applyEdit: async (args) => {
      const undo = makeUndoEntry(args.roomId, engine.getArtifact(args.op.artifactId), args.op);
      const r = engine.applyEdit(args);
      if (r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.toVersion));
      return r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason };
    },
    canUndo: (id) => (undoStack.current.get(id)?.length ?? 0) > 0,
    undoLastEdit: async (id, actor) => {
      const stack = undoStack.current.get(id) ?? [];
      const entry = stack.pop();
      if (!entry) return { ok: false, reason: "nothing_to_undo" };
      const r = engine.applyEdit({ roomId: id, op: entry.op, actor });
      if (!r.ok) stack.push(entry);
      return r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason };
    },
    postMessage: async (args) => { engine.postMessage(args); return { ok: true }; },
    editMessage: async (id, text) => { engine.updateMessage(id, { text }); return { ok: true }; },
    toggleAutoAllow: (id, actor) => { engine.toggleAutoAllow(id, actor); },
    resolveProposal: async (id, approve, actor) => {
      const proposal = [...engine.listProposals(roomId)].find((p) => p.id === id);
      const undo = proposal ? makeUndoEntry(proposal.roomId, engine.getArtifact(proposal.artifactId), proposal.op) : null;
      const r = engine.resolveProposal(id, approve, actor);
      if (approve && r?.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.toVersion));
      return r ? (r.ok ? { ok: true, version: r.toVersion } : { ok: false, reason: r.reason }) : { ok: false, reason: "not_found" };
    },
    addResearchRows: async ({ roomId, artifactId, rows, actor }) => engine.addResearchRows({ roomId, artifactId, rows, by: actor }).length,
    uploadArtifact: async ({ roomId, artifact, actor, visibility }) => engine.createArtifact({ roomId, kind: artifact.kind, title: artifact.title, seed: artifact.seed, meta: artifact.meta, by: actor, visibility }).id,
    setArtifactVisibility: async ({ roomId, artifactId, visibility, actor }) => engine.setArtifactVisibility({ roomId, artifactId, visibility, by: actor }),
    setArtifactMeta: async ({ roomId, artifactId, title, summary, tags, actor }) => engine.setArtifactMeta({ roomId, artifactId, title, summary, tags, by: actor }),
    canRunCollab: roomId === demo.roomId,
    runCollab: () => runDemo(false),
    runSemanticConflictDrill: () => runDemo(true),
    askAgent: async (input) => {
      // Credit meter (memory demo): charge the mode estimate so the balance visibly moves and
      // the user "feels" the credit system. The demo is FORGIVING by design — even at 0 credits
      // the task still completes (Homen's rule: demos must finish, no overkill friction). The
      // balance honestly bottoms out at 0; PRODUCTION (the live convex path, Phase B) does true
      // reserve→run→settle with the ACTUAL cost and HARD-BLOCKS when the wallet is exhausted.
      {
        const mode = input.mode ?? creditMode;
        const res = creditLedgerRef.current.reserve({ mode, note: input.goal.slice(0, 80) });
        if (res.ok) {
          creditLedgerRef.current.settle({ reservationId: res.reservationId!, actualUsd: estimateCostFor(mode).estimateUsd });
        }
        setCreditRev((v) => v + 1);
      }
      const artifacts = engine.listArtifacts(roomId);
      const references = canonicalRefs(artifacts, input.references);
      const goal = withReferenceContext(input.goal, references);
      // Demo intent routing — a recognized diligence/research/runway chat command runs the real
      // scripted no-clobber plan end-to-end (deterministic; no API key / CSP dependency), instead
      // of falling through to the variance-only path and dead-ending. Variance + unrecognized
      // goals fall through to the existing behavior below, so the wedge demo is untouched.
      const demoIntent = classifyDemoIntent(input.goal);
      const pub = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (pub && demoIntent === "research") {
        const research = artifacts.find((a) => a.kind === "sheet" && a.title === "Company research");
        if (research) {
          const actor: Actor = { kind: "agent", id: pub.agentId, name: pub.agentName, scope: "public" };
          const pendingRows = researchRowIds(research)
            .filter((rowId) => String(research.elements[`${rowId}__status`]?.value ?? "pending") === "pending");
          // Scope to the company named in the goal (e.g. "diligence CardioNova") so the run finishes
          // fast and live; only fan out to the whole watchlist when the goal explicitly asks for it.
          const g = input.goal.toLowerCase();
          const wantsAll = /\b(all|every|batch|watchlist|bulk|each|companies)\b/.test(g);
          const named = wantsAll ? [] : pendingRows.filter((rowId) => {
            const name = String(research.elements[`${rowId}__company`]?.value ?? "").toLowerCase();
            return name.length > 1 && g.includes(name);
          });
          const rows = named.length ? named : pendingRows;
          const pending = rows.map((rowId) => researchTargetFor(research, rowId));
          if (pending.length === 0) {
            engine.postMessage({ roomId, channel: "public", author: actor, text: "Every company on the research sheet is already sourced and complete.", clientMsgId: crypto.randomUUID(), kind: "agent" });
            return;
          }
          const rt = new InMemoryRoomTools(engine, roomId, research.id, actor, pub.id);
          const result = await runHarness({ rt, goal, model: paced(scriptedModel(companyResearchPlan(pending)), 140), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 14 * pending.length + 4 });
          if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
          return;
        }
      }
      if (pub && demoIntent === "notes") {
        const notebook = artifacts.find((a) => a.kind === "note" && a.title === "Capture Notebook")
          ?? artifacts.find((a) => a.kind === "note" && a.title !== "Agent wiki" && a.title !== "Today's Brief");
        if (notebook) {
          const actor: Actor = { kind: "agent", id: pub.agentId, name: pub.agentName, scope: "public" };
          const rt = new InMemoryRoomTools(engine, roomId, notebook.id, actor, pub.id);
          const result = await runHarness({ rt, goal, model: paced(scriptedModel(notebookOutlinePlan(notebook.id)), 140), tools: ROOM_TOOLS, contextBuilder: buildNoteContext, maxSteps: 8 });
          if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
          return;
        }
      }
      if (pub && demoIntent === "runway") {
        const runway = artifacts.find((a) => a.kind === "sheet" && a.title === "Runway / milestones");
        if (runway) {
          const actor: Actor = { kind: "agent", id: pub.agentId, name: pub.agentName, scope: "public" };
          const targets: Record<string, string> = {};
          const filled: string[] = [];
          for (const rowId of researchRowIds(runway)) {
            const cash = String(runway.elements[`${rowId}__cash`]?.value ?? "");
            if (cash && !/unknown/i.test(cash)) continue;
            const company = String(runway.elements[`${rowId}__company`]?.value ?? rowId);
            const s = RUNWAY_SOURCED[rowId] ?? { cash: "$1.8M (sourced)", burn: "$150K/mo", runway: "~12 months (sourced)", status: "sourced" };
            targets[`${rowId}__cash`] = s.cash;
            targets[`${rowId}__burn`] = s.burn;
            targets[`${rowId}__runway`] = s.runway;
            targets[`${rowId}__status`] = s.status;
            filled.push(`${company} (${s.runway.replace(/^~\s*/, "")})`);
          }
          if (Object.keys(targets).length === 0) {
            engine.postMessage({ roomId, channel: "public", author: actor, text: "Runway is already sourced for every row — cash and burn are filled.", clientMsgId: crypto.randomUUID(), kind: "agent" });
            return;
          }
          const rt = new InMemoryRoomTools(engine, roomId, runway.id, actor, pub.id);
          await runHarness({ rt, goal, model: paced(scriptedModel(recomputeVariancePlan(targets, { lock: true, reason: "source runway gaps" })), 160), tools: ROOM_TOOLS, maxSteps: 28 });
          engine.postMessage({ roomId, channel: "public", author: actor, text: `Sourced cash + burn and computed runway for ${filled.join(" and ")}. Wrote ${Object.keys(targets).length} cells behind a lock with CAS; milestone gaps stay flagged for review.`, clientMsgId: crypto.randomUUID(), kind: "agent" });
          return;
        }
      }
      if (input.modelSelection?.mode === "free") {
        const jobId = startMemoryFreeJob(goal, references);
        void runMemoryFreeJob(jobId, 1);
        return;
      }
      const sheet = targetSheet(artifacts, references);
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!sheet || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      if (!isVarianceSheet(sheet)) {
        engine.postMessage({
          roomId,
          channel: "public",
          author: actor,
          text: `I received ${referenceNames(references)} as ${sheetContextLabel(sheet)}. Dynamic ENRICH/CLASSIFY execution is staged next; variance recompute only runs on Q3 variance.`,
          clientMsgId: crypto.randomUUID(),
          kind: "agent",
        });
        return;
      }
      const targets: Record<string, string> = {};
      for (const rid of Object.keys(VARIANCE)) if (!sheet.elements[`${rid}__variance`]?.value) targets[`${rid}__variance`] = VARIANCE[rid];
      if (Object.keys(targets).length === 0) {
        engine.postMessage({ roomId, channel: "public", author: actor, text: "Every variance cell is already filled — nothing to recompute.", clientMsgId: crypto.randomUUID(), kind: "agent" });
        return;
      }
      const rt = new InMemoryRoomTools(engine, roomId, sheet.id, actor, sess.id);
      const result = await runHarness({ rt, goal, model: paced(scriptedModel(recomputeVariancePlan(targets, { lock: true })), 140), tools: ROOM_TOOLS, maxSteps: 16 });
      // The scripted plan narrates via the model's text, not the say tool — post that summary to the room
      // (the live path narrates through the real say tool inside the action).
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    askPrivateAgent: async () => { /* memory mode replies inline in Chat.tsx */ },
    startLongFreeAgent: async (input) => {
      const artifacts = engine.listArtifacts(roomId);
      const references = canonicalRefs(artifacts, input.references);
      const sheet = targetSheet(artifacts, references);
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!sheet || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      engine.postMessage({
        roomId,
        channel: "public",
        author: actor,
        text: "Queued the long-running free-auto job path. Memory mode uses the deterministic local agent; Convex mode checkpoints and resumes across action slices.",
        clientMsgId: crypto.randomUUID(),
        kind: "agent",
      });
      const rt = new InMemoryRoomTools(engine, roomId, sheet.id, actor, sess.id);
      const result = await runHarness({
        rt,
        goal: withReferenceContext(input.goal, references),
        model: paced(scriptedModel(recomputeVariancePlan({ r_gp__variance: "+21.7%", r_ni__variance: "+22.4%" }, { lock: true })), 140),
        tools: ROOM_TOOLS,
        maxSteps: 16,
      });
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    askResearch: async () => {
      const research = engine.listArtifacts(roomId).find((a) => a.title === "Company research");
      const sess = engine.listSessions(roomId).find((s) => s.scope === "public");
      if (!research || !sess) return;
      const actor: Actor = { kind: "agent", id: sess.agentId, name: sess.agentName, scope: "public" };
      const pending = researchRowIds(research)
        .filter((rowId) => String(research.elements[`${rowId}__status`]?.value ?? "pending") === "pending")
        .map((rowId) => researchTargetFor(research, rowId));
      if (pending.length === 0) {
        engine.postMessage({ roomId, channel: "public", author: actor, text: "Every company on the research sheet is already complete.", clientMsgId: crypto.randomUUID(), kind: "agent" });
        return;
      }
      const rt = new InMemoryRoomTools(engine, roomId, research.id, actor, sess.id);
      const result = await runHarness({ rt, goal: "Research every pending company.", model: paced(scriptedModel(companyResearchPlan(pending)), 240), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 60 });
      if (result.finalText) engine.postMessage({ roomId, channel: "public", author: actor, text: result.finalText, clientMsgId: crypto.randomUUID(), kind: "agent" });
    },
    lastRun: () => null, // the in-memory scripted agent makes no API calls — no token/cost telemetry
    lastLongFreeJob: () => memLongJob,
    lastLongFreeJobAttempts: () => memLongJobAttempts,
    lastLongFreeJobDetail: () => memLongJobDetail,
    activeLongFreeJobs: () => (memLongJob && isActiveFreeJob(memLongJob.status) ? [memLongJob] : []),
    okfTraceLens: () => null,
    cancelLongFreeJob: async (jobId) => {
      const now = Date.now();
      const cur = memLongJobCurrentRef.current;
      if (cur && cur.id === jobId && !["completed", "failed", "cancelled"].includes(cur.status)) {
        memLongJobTasksRef.current.get(jobId)?.cancelledAttempts.add(cur.attempts);
        const cancelled: AgentJobTelemetry = { ...cur, status: "cancelled", updatedAt: now };
        memLongJobCurrentRef.current = cancelled;
        setMemLongJob(cancelled);
      }
      setMemLongJobAttempts((cur) => cur.map((attempt) => (
        attempt.status === "running" ? { ...attempt, status: "cancelled", stopReason: "user_cancelled" } : attempt
      )));
      setMemLongJobDetail((cur) => cur ? memoryFreeJobDetail(cur.reasoningFrames[0]?.goal ?? "Memory free-auto job", "cancelled") : cur);
      return { ok: true };
    },
    retryLongFreeJob: async (jobId) => {
      const now = Date.now();
      const cur = memLongJobCurrentRef.current;
      if (!cur || cur.id !== jobId) return { ok: false, reason: "not_found" };
      if (cur.attempts >= cur.maxAttempts) return { ok: false, reason: "max_attempts_exhausted" };
      const nextAttempt = cur.attempts + 1;
      const task = memLongJobTasksRef.current.get(jobId);
      const retried: AgentJobTelemetry = { ...cur, status: "running", attempts: nextAttempt, error: undefined, finalText: undefined, updatedAt: now };
      memLongJobCurrentRef.current = retried;
      setMemLongJob(retried);
      if (task) task.cancelledAttempts.delete(nextAttempt);
      void runMemoryFreeJob(jobId, nextAttempt);
      setMemLongJobAttempts((cur) => [...cur, { attempt: nextAttempt, status: "running", resolvedModel: "scripted/free-auto", stopReason: "retrying", ms: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }]);
      setMemLongJobDetail((cur) => cur ? memoryFreeJobDetail(cur.reasoningFrames[0]?.goal ?? "Memory free-auto job", "running") : cur);
      return { ok: true };
    },
    // Memory mode passive feed: returns the scripted seed (demo room) or [] (other rooms).
    // The ref is mutated by the action handlers below; setMemPassiveRev triggers re-render.
    listPassiveActivity: () => memPassiveRef.current,
    dismissActivity: async (activityId) => {
      memPassiveRef.current = memPassiveRef.current.filter((i) => i.id !== activityId);
      setMemPassiveRev((v) => v + 1);
    },
    researchActivity: async (item) => {
      memPassiveRef.current = memPassiveRef.current.map((i) =>
        i.id === item.id ? { ...i, status: "job_created", action: "start_research_job" } : i,
      );
      setMemPassiveRev((v) => v + 1);
    },
    practiceActivity: async (_item, _actor, _userAnswer, _expectedOutline) => {
      // No coach evaluator in the in-memory demo; coach cues are advisory only here.
    },
    addActivityToSheet: async (item, actor) => {
      const entity = item.entityNames[0];
      if (!entity) return;
      const targetArt = engine.listArtifacts(roomId).find((a) => a.kind === "sheet" && a.title === "Company research") ?? engine.listArtifacts(roomId).find((a) => a.kind === "sheet");
      if (!targetArt) return;
      const existing = findExistingResearchRowClient(targetArt, { company: entity });
      if (existing) return { artifactId: targetArt.id, rowId: existing, created: false as const };
      const [rowId] = engine.addResearchRows({ roomId, artifactId: targetArt.id, rows: [{ company: entity }], by: actor });
      return rowId ? { artifactId: targetArt.id, rowId, created: true as const } : undefined;
    },
    researchCostPreview: () => null,
    roomAssistivePolicy: () => null,
    setRoomAssistivePolicy: async () => {},
    batchResearchActivity: async (items) => {
      memPassiveRef.current = memPassiveRef.current.map((i) =>
        items.some((it) => it.id === i.id) ? { ...i, status: "job_created", action: "start_research_job" } : i,
      );
      setMemPassiveRev((v) => v + 1);
      return { ok: true, total: items.length, succeeded: items.length, failed: 0 };
    },
  }), [rev, memPassiveRev, memPresenceRev, memLongJob, memLongJobAttempts, memLongJobDetail, creditRev, creditMode, roomId, startMemoryFreeJob, runMemoryFreeJob]);

  // E2E test seam: expose runCollab/runSemanticConflictDrill via window so tests can trigger
  // collaboration and conflict drills without the removed CollabBar buttons.
  useEffect(() => {
    const w = window as unknown as {
      __runCollab?: () => Promise<void>;
      __runConflictDrill?: () => Promise<void>;
      __seedAgentNotes?: (html?: string) => string | null;
    };
    w.__runCollab = () => store.runCollab();
    w.__runConflictDrill = () => store.runSemanticConflictDrill?.() ?? Promise.resolve();
    w.__seedAgentNotes = (html) => {
      const note = engine.listArtifacts(roomId).find((a) => a.kind === "note" && a.title !== "Agent wiki" && a.title !== "Today's Brief");
      if (!note) return null;
      const existing = note.elements["doc:agent"];
      const actor: Actor = { kind: "agent", id: "e2e_nodeagent", name: "NodeAgent", scope: "public" };
      const value = html ?? [
        '<h2 data-agent-root="true" data-author-kind="agent">Agent notes</h2>',
        '<h3 data-blockid="e2e-heading" data-author-kind="agent" data-run-id="e2e">Browser proof</h3>',
        '<ul><li data-blockid="e2e-claim" data-author-kind="agent" data-run-id="e2e" data-status="needs_review">Unsupported claim needs review</li></ul>',
      ].join("\n");
      const result = engine.applyEdit({
        roomId,
        actor,
        op: {
          opId: crypto.randomUUID(),
          artifactId: note.id,
          elementId: "doc:agent",
          kind: existing ? "set" : "create",
          value,
          baseVersion: existing?.version ?? 0,
        },
      });
      return result.ok ? note.id : null;
    };
    return () => {
      delete (window as unknown as { __runCollab?: unknown }).__runCollab;
      delete (window as unknown as { __runConflictDrill?: unknown }).__runConflictDrill;
      delete (window as unknown as { __seedAgentNotes?: unknown }).__seedAgentNotes;
    };
  }, [store, roomId]);
  // Dev/demo seam (memory mode only): seed the Attention Overlay's headline scenario — a human focused on
  // C2 (blue) and an agent reading A1:C5 (amber) — so the overlay is verifiable in ?mode=memory. Writes the
  // presence Map directly (any mode) and bumps the rev. No-op in production (window is only poked here).
  useEffect(() => {
    const w = window as unknown as { __seedOverlay?: (aid?: string) => string };
    w.__seedOverlay = (aidArg) => {
      const aid = aidArg
        || document.querySelector("table.r-sheet[data-artifact-id]")?.getAttribute("data-artifact-id")
        || document.querySelector("[data-artifact-id]")?.getAttribute("data-artifact-id")
        || "";
      const rid = roomId;
      const now = Date.now();
      const k = `${rid}|${aid}`;
      const cur = memPresenceRef.current.get(k) ?? [];
      const add = (targetId: string, mode: string, actor: Actor, color?: string) =>
        cur.push({ id: `${actor.id}:${targetId}:${mode}`, roomId: rid, artifactId: aid, targetKind: "cell", targetId, mode, actor, color, updatedAt: now, expiresAt: now + 600_000 } as unknown as PresenceClaim);
      add("C2", "focus", { kind: "user", id: "u_alice", name: "Alice" }, "#5E6AD2");
      add("A1:C5", "agent_intent", { kind: "agent", id: "a_nodeagent", name: "NodeAgent" });
      // Q3 variance (the demo room's Sheet renderer uses rid__col ids).
      add("r_rev__variance", "focus", { kind: "user", id: "u_alice", name: "Alice" }, "#5E6AD2");
      add("r_cogs__variance", "agent_intent", { kind: "agent", id: "a_nodeagent", name: "NodeAgent" });
      add("r_gp__variance", "agent_intent", { kind: "agent", id: "a_nodeagent", name: "NodeAgent" });
      memPresenceRef.current.set(k, cur);
      setMemPresenceRev((v) => v + 1);
      return k;
    };
    return () => { delete (window as unknown as { __seedOverlay?: unknown }).__seedOverlay; };
  }, []);
  // Load-test seam (memory mode): drive the credit ledger directly so a backend-free
  // sustained-load run can stress balance/bound/idempotency from Playwright via page.evaluate
  // (mirrors the __runCollab/__seedOverlay seams above). Loop is bounded at 10k iterations.
  useEffect(() => {
    const w = window as unknown as {
      __creditState?: () => CreditBalance;
      __simulateLoad?: (n: number, mode?: AgentCreditMode) => { ran: number; rejected: number; balance: CreditBalance };
    };
    w.__creditState = () => creditLedgerRef.current.balance();
    w.__simulateLoad = (n, mode = "standard") => {
      let ran = 0;
      let rejected = 0;
      const iterations = Math.max(0, Math.min(10_000, Math.floor(n)));
      for (let i = 0; i < iterations; i++) {
        const r = creditLedgerRef.current.reserve({ mode });
        if (!r.ok) { rejected += 1; continue; }
        creditLedgerRef.current.settle({ reservationId: r.reservationId!, actualUsd: estimateCostFor(mode).estimateUsd });
        ran += 1;
      }
      setCreditRev((v) => v + 1);
      return { ran, rejected, balance: creditLedgerRef.current.balance() };
    };
    return () => {
      delete (window as unknown as { __creditState?: unknown }).__creditState;
      delete (window as unknown as { __simulateLoad?: unknown }).__simulateLoad;
    };
  }, []);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/* ── live Convex ── */
const chanStr = (ch: Channel): string => (ch === "public" ? "public" : ch.private);

/* ── optimistic-update helpers ─────────────────────────────────────────────
   Convex semantics (convex@1.40 optimistic_updates.d.ts): the update is rolled back
   ATOMICALLY with the authoritative query results when the mutation completes — so
   zero TEMPORAL flicker is the platform's guarantee. What's ours: (1) SHAPE PARITY —
   the optimistic value must equal what the server will compute, or the swap shows a
   content jump; (2) REPLAY IDEMPOTENCE — "optimistic updates can be called multiple
   times … replayed" on fresh server state while the mutation is in flight, so every
   update must recompute from current state and tolerate its own server echo. */

/* ── B1 client split ───────────────────────────────────────────────────────────
   The store no longer subscribes to rooms.full (which re-shipped the WHOLE room — ~90KB
   on Q3DEMO — on every cell edit because its read-set includes every element). Instead it
   pairs rooms.meta (the room shell: room/members/artifact-shells/locks/sessions/drafts, NO
   cell elements) with one artifacts.elements subscription PER artifact. A cell edit changes
   one elements row → only that artifact's query re-runs/re-ships; the other artifacts' element
   queries don't, and rooms.meta re-ships only the small shell (the artifact-row version bump
   the server does on every edit). Measured per-edit re-ship: ~64KB → 19–31KB. */
type ElementsMap = Artifact["elements"];
type MetaArtifact = Omit<Artifact, "elements"> & { elements?: ElementsMap };
type ElementEntry = ElementsMap[string];
type ElementsEntriesPayload = { __transport: "entries"; entries: Array<[string, ElementEntry]> };
const MAX_DIRECT_ELEMENT_MAP_FIELDS = 900;

function isElementsEntriesPayload(value: unknown): value is ElementsEntriesPayload {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (value as { __transport?: unknown }).__transport === "entries" &&
    Array.isArray((value as { entries?: unknown }).entries);
}

function elementsPayloadToMap(value: unknown): ElementsMap {
  if (isElementsEntriesPayload(value)) return Object.fromEntries(value.entries) as ElementsMap;
  return (value ?? {}) as ElementsMap;
}

function elementsMapToPayload(elements: ElementsMap, previous?: unknown): unknown {
  if (isElementsEntriesPayload(previous) || Object.keys(elements).length > MAX_DIRECT_ELEMENT_MAP_FIELDS) {
    return { __transport: "entries", entries: Object.entries(elements) };
  }
  return elements;
}

/** Element-scoped mirror of applyCellEditCore's apply step (convex/artifacts.ts): version bump,
 *  order handling for create/delete, updatedBy attribution — operates on ONE artifact's elements
 *  map + order (cells live in artifacts.elements now, the shell in rooms.meta). Shared by the
 *  hand-edit and proposal-approve optimistic paths so both paint the exact server outcome. */
function applyCellToElements(elements: ElementsMap, order: string[], elementId: string, kind: "set" | "create" | "delete", value: unknown, actor: Actor): { elements: ElementsMap; order: string[] } {
  const prev = (elements[elementId] ?? { version: 0 }) as { version: number };
  const next = { ...elements };
  const nextOrder = kind === "create" && !next[elementId] ? [...order, elementId] : kind === "delete" ? order.filter((id) => id !== elementId) : order;
  if (kind === "delete") delete next[elementId];
  else next[elementId] = { id: elementId, value, version: prev.version + 1, updatedAt: Date.now(), updatedBy: actor } as ElementsMap[string];
  return { elements: next, order: nextOrder };
}

/** One of these mounts per room artifact (rendered by ConvexStoreProvider). Each subscribes to
 *  its artifact's cells via api.artifacts.elements, so a cell edit re-runs ONLY the edited
 *  artifact's query, not the whole room. It lifts the elements map into the provider via
 *  useLayoutEffect (fires before paint → the optimistic-edit re-render lands flicker-free).
 *  Renders nothing. Optimistic (opt-) artifact ids are filtered out by the caller — they aren't
 *  valid Convex ids, so subscribing would throw; their cells fill in when the server confirms. */
function ArtifactElementsSubscriber({ roomId, artifactId, proof, onElements, onUnmount }: {
  roomId: string; artifactId: string; proof: ActorProof;
  onElements: (artifactId: string, elements: ElementsMap) => void;
  onUnmount: (artifactId: string) => void;
}) {
  const els = useQuery(api.artifacts.elements, { roomId: roomId as never, artifactId: artifactId as never, requester: proof });
  useLayoutEffect(() => { if (els !== undefined) onElements(artifactId, elementsPayloadToMap(els)); }, [artifactId, els, onElements]);
  useEffect(() => () => onUnmount(artifactId), [artifactId, onUnmount]);
  return null;
}

function ArtifactPresenceSubscriber({ roomId, artifactId, proof, onPresence, onUnmount }: {
  roomId: string; artifactId: string; proof: ActorProof;
  onPresence: (artifactId: string, presence: PresenceClaim[]) => void;
  onUnmount: (artifactId: string) => void;
}) {
  const rows = useQuery(api.presence.listForArtifact, { roomId: roomId as never, artifactId: artifactId as never, requester: proof });
  useLayoutEffect(() => { if (rows !== undefined) onPresence(artifactId, rows as unknown as PresenceClaim[]); }, [artifactId, rows, onPresence]);
  useEffect(() => () => onUnmount(artifactId), [artifactId, onUnmount]);
  return null;
}

/* Client mirrors of convex/artifacts.ts research-row helpers — MUST stay in lockstep
   (they make addResearchRows deterministic, which is what makes its optimistic insert
   parity-exact: same slugs, same suffix-dedup, same default column values). */
const RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
function slugResearchRowClient(company: string): string {
  const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return base ? `rc_${base}` : `rc_company`;
}
function defaultWebsiteClient(company: string): string {
  const host = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return host ? `https://www.${host}.com` : "";
}
function normalizeResearchIdentityClient(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function normalizeResearchDomainClient(value?: string): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}
function rowIdsFromOrderClient(order: string[]): string[] {
  return [...new Set(order.map((id) => id.split("__")[0]))];
}
function cellStringClient(art: Artifact, rid: string, col: string): string {
  const raw = art.elements[`${rid}__${col}`]?.value;
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : String(raw);
}
function findExistingResearchRowClient(art: Artifact, row: ResearchRowInput): string | null {
  const wantedCompany = normalizeResearchIdentityClient(row.company);
  const wantedDomain = normalizeResearchDomainClient(row.website);
  return rowIdsFromOrderClient(art.order).find((rid) => {
    const company = normalizeResearchIdentityClient(cellStringClient(art, rid, "company"));
    if (wantedCompany && company === wantedCompany) return true;
    const domain = normalizeResearchDomainClient(cellStringClient(art, rid, "website"));
    return !!wantedDomain && domain === wantedDomain;
  }) ?? null;
}

function usableConvexString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/^(undefined|null|\[object Object\])$/i.test(value.trim());
}

export function ConvexStoreProvider({ roomId, me, proof, children }: { roomId: string; me: Actor; proof: ActorProof; children: ReactNode }) {
  const undoStack = useRef(new Map<string, UndoEntry[]>());
  const fileUploadCache = useRef(new WeakMap<Blob, Promise<StoredUploadRef>>());
  const hasValidLiveSession = usableConvexString(roomId) && usableConvexString(me.id) && usableConvexString(proof.token);
  const rid = roomId as never;
  const roomQuery = hasValidLiveSession ? { roomId: rid, requester: proof } : "skip";
  const [traceActive, setTraceActive] = useState(false);
  // Gate trace-only queries (captures has per-step getUrl cost; OKF lens is heavy) on the Trace tab
  // actually being open — zero reactive cost when the user is on another surface.
  const traceQuery = hasValidLiveSession && traceActive ? { roomId: rid, requester: proof } : "skip";
  const data = useQuery(api.rooms.meta, roomQuery);
  // B1 Phase 2: bump-carriers (version/order/updatedAt) split into a sibling query so a cell edit
  // re-ships only this small tuple-list, not the rooms.meta shell. Merged back into the engine
  // Artifact shape here so every downstream consumer (LeftRail label, status-bar v-pill, agent
  // worldModel snapshots, optimistic updates) keeps reading `a.version`/`a.order`/`a.updatedAt`
  // with no call-site changes. Map by id; if `versions` hasn't streamed yet, fall back to defaults
  // so the first frame still has stable shape — the authoritative row arrives within one tick.
  const versionsList = useQuery(api.artifacts.versions, roomQuery);
  const metaArtifacts = useMemo(() => {
    const arts = (data?.artifacts ?? []) as unknown as Array<Omit<MetaArtifact, "version" | "order" | "updatedAt">>;
    const verMap = new Map<string, { version: number; order: string[]; updatedAt: number }>();
    for (const v of (versionsList ?? []) as Array<{ id: string; version: number; order: string[]; updatedAt: number }>) {
      verMap.set(String(v.id), { version: v.version, order: v.order, updatedAt: v.updatedAt });
    }
    return arts.map((a) => {
      const v = verMap.get(String(a.id));
      return { ...a, version: v?.version ?? 1, order: v?.order ?? [], updatedAt: v?.updatedAt ?? 0 } as MetaArtifact;
    });
  }, [data, versionsList]);
  // B1: per-artifact cell maps, lifted from the <ArtifactElementsSubscriber> children rendered below.
  const [elementsByArtifact, setElementsByArtifact] = useState<Record<string, ElementsMap>>({});
  const [presenceByArtifact, setPresenceByArtifact] = useState<Record<string, PresenceClaim[]>>({});
  const onArtifactElements = useCallback((artifactId: string, els: ElementsMap) => {
    setElementsByArtifact((prev) => (prev[artifactId] === els ? prev : { ...prev, [artifactId]: els }));
  }, []);
  const onArtifactUnmount = useCallback((artifactId: string) => {
    setElementsByArtifact((prev) => { if (!(artifactId in prev)) return prev; const next = { ...prev }; delete next[artifactId]; return next; });
  }, []);
  const onArtifactPresence = useCallback((artifactId: string, presence: PresenceClaim[]) => {
    setPresenceByArtifact((prev) => (prev[artifactId] === presence ? prev : { ...prev, [artifactId]: presence }));
  }, []);
  const onArtifactPresenceUnmount = useCallback((artifactId: string) => {
    setPresenceByArtifact((prev) => { if (!(artifactId in prev)) return prev; const next = { ...prev }; delete next[artifactId]; return next; });
  }, []);
  const pubQuery = hasValidLiveSession ? { roomId: rid, channel: "public", requester: proof } : "skip";
  const privQuery = hasValidLiveSession ? { roomId: rid, channel: me.id, requester: proof } : "skip";
  const pub = useQuery(api.messages.list, pubQuery) ?? [];
  const priv = useQuery(api.messages.list, privQuery) ?? [];
  const traces = useQuery(api.collab.traces, roomQuery) ?? [];
  const captures = useQuery(api.captures.byRoom, traceQuery) ?? [];
  // Lazy-resolve screenshot/PDF URLs for the SELECTED capture record only — avoids N×M `getUrl`
  // calls in the reactive `byRoom` list. `selectedCaptureId` is set by the Trace surface.
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const captureDetail = useQuery(api.captures.captureDetail, selectedCaptureId && traceActive ? { roomId: rid, captureId: selectedCaptureId as never, requester: proof } : "skip");
  const okfLens = useQuery(api.okf.traceLens, traceQuery) ?? null;
  const runs = useQuery(api.agentRuns.list, roomQuery) ?? [];
  const jobs = useQuery(api.agentJobs.list, roomQuery) ?? [];
  const passiveActivity = useQuery(api.roomActivity.feed, roomQuery) ?? [];
  const costPreview = useQuery(api.roomActivity.researchCostPreview, hasValidLiveSession ? { roomId: rid } : "skip");
  const assistivePolicy = useQuery(api.roomActivity.roomAssistivePolicy, hasValidLiveSession ? { roomId: rid } : "skip");
  const latestJobId = (jobs as Array<{ _id: string }>)[0]?._id;
  const jobAttempts = useQuery(api.agentJobs.attempts, latestJobId ? { jobId: latestJobId as never, requester: proof } : "skip") ?? [];
  const jobDetail = useQuery(api.agentJobs.detail, latestJobId ? { jobId: latestJobId as never, requester: proof } : "skip");
  const proposals = useQuery(api.artifacts.listProposals, roomQuery) ?? [];
  // Live credit wallet (Phase B). GATED on VITE_CREDITS_LIVE so the frontend never calls
  // api.credits.* until those functions are actually deployed to the Convex deployment (Convex
  // deploy ≠ git push — a build that calls an undeployed function errors at runtime). Flip
  // VITE_CREDITS_LIVE=true ONLY after `convex deploy` ships convex/credits.ts. Symmetric with the
  // backend CREDITS_ENFORCED flag. Default OFF → "skip" → no call → live /ask is unaffected.
  const creditLiveEnabled = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CREDITS_LIVE === "true";
  const creditBalanceQ = useQuery(api.credits.balance, creditLiveEnabled ? roomQuery : "skip");
  const creditUsageQ = useQuery(api.credits.usageEvents, creditLiveEnabled ? roomQuery : "skip") ?? [];
  const [creditMode, setCreditModeState] = useState<AgentCreditMode>(DEFAULT_CREDIT_MODE);

  const applyCellEdit = useMutation(api.artifacts.applyCellEdit).withOptimisticUpdate((local, args) => {
    const elementsQ = { roomId: args.roomId, artifactId: args.artifactId, requester: args.proof };
    const curEls = local.getQuery(api.artifacts.elements, elementsQ);
    if (curEls === undefined) return;
    // B1 Phase 2: bump-carriers (version/order/updatedAt) moved off rooms.meta onto artifacts.versions.
    // Read order from the versions cache; meta no longer carries it. Falls back to the elements map's
    // own row order when versions hasn't streamed yet (early-frame race) — applyCellToElements only
    // uses `order` for create/delete handling, set-edits are unaffected.
    const versionsQ = { roomId: args.roomId, requester: args.proof };
    const curVersions = local.getQuery(api.artifacts.versions, versionsQ);
    const rowVer = curVersions?.find((a) => String(a.id) === String(args.artifactId));
    const curElements = elementsPayloadToMap(curEls);
    const baseOrder = (rowVer?.order ?? Object.keys(curElements)) as string[];
    const { elements, order } = applyCellToElements(curElements, baseOrder, args.elementId, args.kind ?? "set", args.value, args.proof.actor);
    local.setQuery(api.artifacts.elements, elementsQ, elementsMapToPayload(elements, curEls) as typeof curEls);
    // Mirror the server's artifact-row bump (applyCellEditCore: version+updatedAt always, order on
    // create/delete) so the optimistic→authoritative swap is shape-identical (no version flicker).
    // Write to the versions query NOT to rooms.meta — the whole point of Phase 2 is to keep meta's
    // hash stable on cell edits so it stops re-shipping. The version-pill still ticks because
    // metaArtifacts merges versions back in.
    if (curVersions && rowVer) {
      local.setQuery(api.artifacts.versions, versionsQ, curVersions.map((a) => String(a.id) === String(args.artifactId) ? { ...a, order, version: a.version + 1, updatedAt: Date.now() } : a) as typeof curVersions);
    }
  });
  // ── Offline edit-hold (Latency: "offline edits held, visible, never lost") ──
  // TRANSPORT failures (fetch/WebSocket down) hold the CAS op in a bounded in-memory +
  // localStorage queue and replay it on reconnect through the SAME applyEdit path, so a
  // replayed op that lost its CAS race surfaces as an honest conflict. Server ANSWERS
  // (conflict/locked) return as { ok:false } results and are never queued. Note the Convex
  // client also buffers mutations across short disconnects — when it does, our promise never
  // rejects and this queue simply never engages (belt over its braces, not a second truth).
  const offlineQueue = useMemo(
    () => new OfflineEditQueue({ storageKey: `noderoom:offlineEdits:v1:${roomId}`, storage: typeof window === "undefined" ? null : window.localStorage }),
    [roomId],
  );
  const [offlineSnap, setOfflineSnap] = useState<OfflineQueueSnapshot>(() => offlineQueue.snapshot());
  useEffect(() => { setOfflineSnap(offlineQueue.snapshot()); }, [offlineQueue]);
  /** The one CAS wire path — user edits AND offline replays go through here. */
  const applyEditCore = useCallback(async (op: ChangeOp): Promise<EditFeedback> => {
    const r = await applyCellEdit({ roomId: rid, artifactId: op.artifactId as never, elementId: op.elementId, kind: op.kind, value: op.value, baseVersion: op.baseVersion, proof });
    return r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason };
  }, [applyCellEdit, rid, proof]);
  const replayBackoffRef = useRef(0);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runOfflineReplay = useCallback(async () => {
    if (offlineQueue.size() === 0 || offlineQueue.isReplaying()) return;
    setOfflineSnap({ ...offlineQueue.snapshot(), replaying: true });
    const result = await offlineQueue.replay((entry) => applyEditCore(entry.op));
    setOfflineSnap(offlineQueue.snapshot());
    if (result.stoppedByNetwork) {
      // Still offline: retry with capped exponential backoff (2s → 30s) until the transport heals
      // — the navigator "online" event is a hint, not a guarantee the socket is back.
      replayBackoffRef.current = replayBackoffRef.current ? Math.min(replayBackoffRef.current * 2, 30_000) : 2_000;
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      replayTimerRef.current = setTimeout(() => { void runOfflineReplay(); }, replayBackoffRef.current);
    } else {
      replayBackoffRef.current = 0;
    }
  }, [offlineQueue, applyEditCore]);
  const scheduleOfflineReplay = useCallback(() => {
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    if (!replayBackoffRef.current) replayBackoffRef.current = 2_000;
    replayTimerRef.current = setTimeout(() => { void runOfflineReplay(); }, replayBackoffRef.current);
  }, [runOfflineReplay]);
  useEffect(() => {
    const onOnline = () => { replayBackoffRef.current = 0; void runOfflineReplay(); };
    window.addEventListener("online", onOnline);
    // Holds hydrated from a previous session replay as soon as the room is live again.
    if (typeof navigator === "undefined" || navigator.onLine !== false) void runOfflineReplay();
    return () => {
      window.removeEventListener("online", onOnline);
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    };
  }, [runOfflineReplay]);

  const sendMsg = useMutation(api.messages.send).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, channel: args.channel, requester: args.proof };
    const cur = local.getQuery(api.messages.list, q) ?? [];
    // Replay/retry guard: if the list already holds this clientMsgId (retrySend re-sends with the
    // SAME cid, and the first attempt may have landed server-side), appending again would paint a
    // duplicate bubble for the whole in-flight window. Idempotent by clientMsgId.
    if (cur.some((m) => m.clientMsgId === args.clientMsgId)) return;
    local.setQuery(api.messages.list, q, [...cur, { _id: ("opt-" + args.clientMsgId) as never, _creationTime: Date.now(), roomId: args.roomId, channel: args.channel, author: args.proof.actor, text: args.text, clientMsgId: args.clientMsgId, kind: "chat", createdAt: Date.now() }]);
  });
  // QA P1: the auto-allow switch flips instantly (server toggle reconciles) — matches applyCellEdit's pattern.
  const toggle = useMutation(api.rooms.toggleAutoAllow).withOptimisticUpdate((local, args) => {
    const q = { roomId: args.roomId, requester: args.requester };
    const cur = local.getQuery(api.rooms.meta, q);
    if (!cur) return;
    local.setQuery(api.rooms.meta, q, { ...cur, room: { ...cur.room, autoAllow: !cur.room.autoAllow } } as typeof cur);
  });
  const ensureStarterRoomStateMutation = useMutation(api.rooms.ensureStarterRoomState);
  const starterBackfillAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasValidLiveSession || data === undefined || data === null) return;
    const room = data.room as { title?: string } | undefined;
    const members = (data.members ?? []) as Array<{ id: string; role: string }>;
    const isHost = members.some((member) => String(member.id) === String(me.id) && member.role === "host");
    if (!isHost) return;
    const research = metaArtifacts.find((artifact) => artifact.kind === "sheet" && artifact.title === "Company research");
    const rowCount = (research?.meta?.dataframe as { rowCount?: number } | undefined)?.rowCount ?? 0;
    const sparse = metaArtifacts.length === 0 || room?.title === "Blank NodeRoom" || !research || rowCount < 100 || (research.order?.length ?? 0) < 1000;
    if (!sparse) return;
    const attemptKey = `${roomId}:${metaArtifacts.length}:${research?.id ?? "none"}:${rowCount}:${research?.order?.length ?? 0}`;
    if (starterBackfillAttemptedRef.current === attemptKey) return;
    starterBackfillAttemptedRef.current = attemptKey;
    void ensureStarterRoomStateMutation({ roomId: rid, requester: proof }).catch(() => undefined);
  }, [data, ensureStarterRoomStateMutation, hasValidLiveSession, me.id, metaArtifacts, proof, rid, roomId]);
  // Optimistic edit: text is reversible + predictable (patch same _id) + author-authoritative → optimistic-safe.
  // Match by _id across every loaded messages.list ref (public + the actor's private channel); the editor only
  // has the messageId, so do NOT reconstruct query args — update whichever loaded list holds the row.
  const editMsg = useMutation(api.messages.update).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.messages.list)) {
      if (!value || !value.some((m) => m._id === args.messageId)) continue;
      local.setQuery(api.messages.list, qargs, value.map((m) => (m._id === args.messageId ? { ...m, text: args.text } : m)));
    }
  });
  // Reject is optimistic-safe: the authoritative state is just "chip gone".
  // Approve is deliberately not optimistic. The backend can keep a proposal pending when final CAS
  // or formula validation fails, so hiding the chip before the mutation result would lie about CRS.
  const resolveProposalMutation = useMutation(api.artifacts.resolveProposal).withOptimisticUpdate((local, args) => {
    if (args.approve) return;
    const q = { roomId: rid, requester: args.requester };
    const cur = local.getQuery(api.artifacts.listProposals, q);
    if (!cur) return;
    local.setQuery(api.artifacts.listProposals, q, cur.filter((p) => String(p.id) !== String(args.proposalId)));
  });
  // "Add accounts" paints instantly: an EXACT client mirror of the server's deterministic row
  // builder (same slugs, same suffix-dedup against order, same default column values), recomputed
  // from fresh state on every replay — so the authoritative swap is pixel-identical.
  const addResearchRowsMutation = useMutation(api.artifacts.addResearchRows).withOptimisticUpdate((local, args) => {
    const artifactId = args.artifactId as unknown as string;
    const elementsQ = { roomId: args.roomId, artifactId: args.artifactId, requester: args.requester };
    const curEls = local.getQuery(api.artifacts.elements, elementsQ);
    if (curEls === undefined) return;
    const metaQ = { roomId: args.roomId, requester: args.requester };
    const curMeta = local.getQuery(api.rooms.meta, metaQ);
    const rowMeta = curMeta?.artifacts.find((a) => String(a.id) === artifactId);
    if (!rowMeta) return;
    // B1 Phase 2: order lives in artifacts.versions now; the synthetic Artifact below needs it for
    // the deterministic row builder (suffix-dedup against existing rowIds).
    const versionsQ = { roomId: args.roomId, requester: args.requester };
    const curVersions = local.getQuery(api.artifacts.versions, versionsQ);
    const rowVer = curVersions?.find((a) => String(a.id) === artifactId);
    if (!rowVer) return;
    const now = Date.now();
    // Reconstruct a synthetic Artifact = {shell, cells} so the deterministic builder mirror stays
    // byte-identical to the server (same slugs, suffix-dedup, default columns).
    const curElements = elementsPayloadToMap(curEls);
    const synthetic = { ...(rowMeta as unknown as Artifact), order: rowVer.order, version: rowVer.version, updatedAt: rowVer.updatedAt, elements: curElements };
    const nextOrder = [...synthetic.order];
    const elements = { ...synthetic.elements };
    let changed = false;
    for (const row of args.rows as ResearchRowInput[]) {
      const company = row.company.trim();
      if (!company) continue;
      let rowChanged = false;
      const base = slugResearchRowClient(company);
      const existing = findExistingResearchRowClient({ ...synthetic, order: nextOrder, elements } as Artifact, row);
      let rowId = existing ?? base, suffix = 1;
      while (!existing && nextOrder.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
      const vals: Record<(typeof RESEARCH_COLS)[number], string> = {
        company,
        website: row.website?.trim() || defaultWebsiteClient(company),
        status: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "status") || "pending" : "pending",
        tier: row.tier?.trim() || "B",
        intent: row.intent?.trim() ?? "",
        owner: row.owner?.trim() || args.requester.actor.name,
        crm_status: row.crmStatus?.trim() || "Research",
        summary: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "summary") : "",
        funding: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "funding") : "",
        headcount: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "headcount") : "",
        recent_signal: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "recent_signal") : "",
        source: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "source") : "",
        source2: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "source2") : "",
        last_researched: existing ? cellStringClient({ ...synthetic, elements } as Artifact, rowId, "last_researched") : "",
      };
      const writableCols = existing ? ["company", "website", "tier", "intent", "owner", "crm_status"] as const : RESEARCH_COLS;
      for (const col of writableCols) {
        const elementId = `${rowId}__${col}`;
        const prev = elements[elementId];
        if (prev) {
          if (Object.is(prev.value, vals[col])) continue;
          elements[elementId] = { ...prev, value: vals[col], version: prev.version + 1, updatedAt: now, updatedBy: args.requester.actor } as ElementsMap[string];
        } else {
          nextOrder.push(elementId);
          elements[elementId] = { id: elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: args.requester.actor } as ElementsMap[string];
        }
        rowChanged = true;
      }
      if (!existing) {
        for (const col of RESEARCH_COLS) {
          const elementId = `${rowId}__${col}`;
          if (elements[elementId]) continue;
          nextOrder.push(elementId);
          elements[elementId] = { id: elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: args.requester.actor } as ElementsMap[string];
          rowChanged = true;
        }
      }
      changed = changed || rowChanged;
    }
    if (!changed) return;
    // Write BOTH caches in this one callback so the row count (versions.order) and the cells
    // (artifacts.elements) never momentarily disagree. B1 Phase 2: the bump-carriers go to
    // artifacts.versions, NOT rooms.meta (keeps meta's hash stable on cell-add writes too).
    local.setQuery(api.artifacts.elements, elementsQ, elementsMapToPayload(elements, curEls) as typeof curEls);
    if (curVersions) {
      local.setQuery(api.artifacts.versions, versionsQ, curVersions.map((a) => String(a.id) === artifactId ? { ...a, order: nextOrder, version: a.version + 1, updatedAt: now } : a) as typeof curVersions);
    }
  });
  const ensurePassiveResearchRowMutation = useMutation(api.artifacts.ensurePassiveResearchRow);
  // Upload/new-artifact paints instantly under a placeholder id; the authoritative id swaps in
  // atomically at completion (tab is labeled by title, selection happens post-await with the real
  // id — no visible jump). Echo guard: skip if this mutation's artifact already streamed in.
  const createArtifactMutation = useMutation(api.artifacts.createArtifact).withOptimisticUpdate((local, args) => {
    const metaQ = { roomId: args.roomId, requester: args.proof };
    const curMeta = local.getQuery(api.rooms.meta, metaQ);
    if (!curMeta) return;
    // B1 Phase 2: dedupe against the versions cache because `order` no longer lives on meta artifacts.
    const versionsQ = { roomId: args.roomId, requester: args.proof };
    const curVersions = local.getQuery(api.artifacts.versions, versionsQ);
    const arts = curMeta.artifacts;
    if (arts.some((a) => {
      if (a.title !== args.title || a.kind !== args.kind) return false;
      const v = curVersions?.find((cv) => String(cv.id) === String(a.id));
      return (v?.order?.length ?? 0) === args.seed.length;
    })) return;
    const now = Date.now();
    // Append the elements-LESS shell to rooms.meta so the tab appears instantly. The cells fill in
    // when the server confirms with the real id — opt- ids aren't valid Convex ids, so no
    // ArtifactElementsSubscriber mounts for them (filtered in the provider's render).
    // B1 Phase 2: meta carries the stable artifact fields; the version/order/updatedAt tuple goes
    // to the versions cache. Write to BOTH so the merged metaArtifacts immediately shows the new
    // artifact with the seeded order — otherwise the row would mount with empty order until the
    // server-side versions query streams in.
    const optId = `opt-art-${args.kind}-${args.title}`;
    const seedOrder = (args.seed as Array<{ id: string }>).map((s) => s.id);
    const seedElements: ElementsMap = Object.fromEntries((args.seed as Array<{ id: string; value: unknown }>).map((s) => [
      s.id,
      { id: s.id, value: s.value, version: 1, updatedAt: now, updatedBy: args.proof.actor },
    ]));
    const shell = {
      id: optId, roomId: args.roomId as unknown as string, kind: args.kind, title: args.title,
      meta: args.meta,
      elements: seedElements,
    };
    local.setQuery(api.rooms.meta, metaQ, { ...curMeta, artifacts: [...arts, shell] } as unknown as typeof curMeta);
    if (curVersions) {
      local.setQuery(api.artifacts.versions, versionsQ, [...curVersions, { id: optId as unknown as typeof curVersions[number]["id"], version: 1, order: seedOrder, updatedAt: now }]);
    }
  });
  const generateFileUploadUrlMutation = useMutation(api.artifacts.generateFileUploadUrl);
  const registerUploadedFileMutation = useMutation(api.artifacts.registerUploadedFile);
  const setArtifactVisibilityMutation = useMutation(api.artifacts.setArtifactVisibility);
  const setArtifactMetaMutation = useMutation(api.artifacts.setArtifactMeta);
  const runSemanticConflictDrillMutation = useMutation(api.artifacts.startAgentIntentConflictProof);
  const runAgent = useAction(api.agent.runRoomAgent);
  const runPrivateAgent = useAction(api.agent.runPrivateAgent);
  const runCaptureAction = useAction(api.capturesNode.capture);
  const runSecFacts = useAction(api.sec.facts);
  const recordCitationMut = useMutation(api.captures.recordCitation);
  const createPrivateReplyStream = useMutation(api.streaming.createPrivateReplyStream);
  const startAgentJob = useMutation(api.agentJobs.start);
  const startPublicAskJob = useMutation(api.agentJobs.startPublicAsk);
  const updatePresenceMutation = useMutation(api.presence.heartbeat);
  const clearPresenceMutation = useMutation(api.presence.clear);
  const dismissActivityMutation = useMutation(api.roomActivity.dismissActivity);
  const researchActivityMutation = useMutation(api.roomActivity.researchActivity);
  const practiceActivityMutation = useMutation(api.roomActivity.practiceActivity);
  const batchResearchActivityMutation = useMutation(api.roomActivity.batchResearchActivity);
  const setRoomAssistivePolicyMutation = useMutation(api.roomActivity.setRoomAssistivePolicy);
  // Job-strip controls flip instantly. Mirrors the server's transition + ITS guards (cancel: no-op
  // on terminal; retry: no-op on completed/running) so an ok:false result reconciles honestly via
  // rollback + the returned feedback. Args carry only jobId — patch whichever loaded list holds it.
  const cancelFreeAutoJob = useMutation(api.agentJobs.cancel).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.agentJobs.list)) {
      if (!value?.some((j) => String(j._id) === String(args.jobId))) continue;
      local.setQuery(api.agentJobs.list, qargs, value.map((j) =>
        String(j._id) === String(args.jobId) && !["completed", "failed", "cancelled"].includes(j.status)
          ? { ...j, status: "cancelled", error: "cancelled_by_user", updatedAt: Date.now() } : j));
    }
  });
  const retryFreeAutoJob = useMutation(api.agentJobs.retry).withOptimisticUpdate((local, args) => {
    for (const { args: qargs, value } of local.getAllQueries(api.agentJobs.list)) {
      if (!value?.some((j) => String(j._id) === String(args.jobId))) continue;
      local.setQuery(api.agentJobs.list, qargs, value.map((j) =>
        String(j._id) === String(args.jobId) && !["completed", "running"].includes(j.status)
          ? { ...j, status: "queued", error: undefined, nextRunAt: Date.now(), updatedAt: Date.now() } : j));
    }
  });
  const uploadSourceFile = useCallback((sourceFile: UploadedSourceFile, visibility: ArtifactVisibility = "room"): Promise<StoredUploadRef> => {
    const cached = fileUploadCache.current.get(sourceFile.blob);
    if (cached) return cached;
    const upload = (async () => {
      const uploadUrl = await generateFileUploadUrlMutation({ roomId: rid, requester: proof });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": sourceFile.mimeType || "application/octet-stream" },
        body: sourceFile.blob,
      });
      if (!response.ok) throw new Error(`raw_file_upload_failed:${response.status}`);
      const json = await response.json() as { storageId?: string };
      if (!json.storageId) throw new Error("raw_file_upload_missing_storage_id");
      const registered = await registerUploadedFileMutation({
        roomId: rid,
        requester: proof,
        storageId: json.storageId as never,
        fileName: sourceFile.fileName,
        mimeType: sourceFile.mimeType || "application/octet-stream",
        size: sourceFile.size,
        visibility,
      });
      return {
        fileId: String(registered.fileId),
        storageId: String(registered.storageId),
        sha256: registered.sha256,
        size: registered.size,
        mimeType: registered.mimeType,
      };
    })();
    fileUploadCache.current.set(sourceFile.blob, upload);
    return upload;
  }, [generateFileUploadUrlMutation, registerUploadedFileMutation, rid, proof]);

  // Memoized merge: replace the lightweight record with the URL-resolved detail for the selected
  // capture. Stable ref so TraceSurface's `records` useMemo doesn't bust on every render.
  const mergedCaptures = useMemo(() => {
    const list = captures as unknown as TraceRecord[];
    if (!captureDetail) return list;
    return list.map((r) => r.id === (captureDetail as { id: string }).id ? captureDetail as unknown as TraceRecord : r);
  }, [captures, captureDetail]);

  const store = useMemo<RoomStore>(() => {
    const room = (data?.room ?? undefined) as unknown as Room | undefined;
    const members = (data?.members ?? []) as unknown as Member[];
    const artifacts = metaArtifacts.map((a) => ({ ...a, elements: elementsByArtifact[String(a.id)] ?? a.elements ?? {} })) as unknown as Artifact[];
    const locks = (data?.locks ?? []) as unknown as Lock[];
    const sessions = (data?.sessions ?? []) as unknown as AgentSession[];
    const drafts = (data?.drafts ?? []) as unknown as Draft[];
    const isHost = members.some((m) => m.id === me.id && m.role === "host");
    const reshapeMsgs = (rows: typeof pub): Message[] => rows.map((m: { _id: string; roomId: string; channel: string; author: Actor; text: string; clientMsgId: string; kind: Message["kind"]; createdAt: number; streamId?: string }) => ({ id: m._id as string, roomId: m.roomId as string, channel: m.channel === "public" ? "public" : { private: m.channel }, author: m.author as Actor, text: m.text, clientMsgId: m.clientMsgId, kind: m.kind, createdAt: m.createdAt, streamId: m.streamId }));
    const allTraces = (traces as { _id: string; roomId: string; ts: number; actor: Actor; type: string; summary: string; detail?: string }[]).map((t) => ({ id: t._id, roomId: t.roomId, ts: t.ts, actor: t.actor, type: t.type as TraceEvent["type"], summary: t.summary, detail: t.detail }));
    // Hoisted sheet resolution — shared by addActivityToSheet (researchActivity resolves server-side).
    const researchSheet = metaArtifacts.find((a) => (a as { kind?: string }).kind === "sheet" && (a as { title?: string }).title === "Company research");

    return {
      mode: "convex",
      // Live credit wallet (read-only from the client). reserve/settle are server-only
      // internalMutations driven by the agent run path (enforcement), never the client.
      creditBalance: () => {
        const b = creditBalanceQ;
        if (!b) return { availableCredits: 0, reservedCredits: 0, lifetimeSpentCredits: 0, availableUsd: 0, reservedUsd: 0, lifetimeSpentUsd: 0, demo: false, enforced: false };
        return {
          availableCredits: b.availableCredits,
          reservedCredits: b.reservedCredits,
          lifetimeSpentCredits: b.lifetimeSpentCredits,
          availableUsd: b.availableUsd,
          reservedUsd: b.reservedUsd,
          lifetimeSpentUsd: b.lifetimeSpentUsd,
          demo: false,
          enforced: b.enforced,
        };
      },
      creditMode: () => creditMode,
      setCreditMode: (m: AgentCreditMode) => { setCreditModeState(m); },
      estimateCredits: (m: AgentCreditMode) => estimateCostFor(m),
      listUsageEvents: () => creditUsageQ.map((e) => ({
        id: String(e.id),
        seq: 0,
        kind: e.kind,
        mode: e.mode,
        credits: e.credits,
        usd: e.usd,
        reservationId: e.reservationKey,
        reason: e.reason ?? undefined,
      })),
      getRoom: () => room,
      roomState: (): "loading" | "notFound" | "ready" =>
        data === undefined ? "loading" : data === null ? "notFound" : "ready",
      listMembers: () => members,
      listArtifacts: () => artifacts,
      getArtifact: (id) => artifacts.find((a) => a.id === id),
      listMessages: (_id, ch) => (ch === "public" ? reshapeMsgs(pub) : reshapeMsgs(priv)),
      actorProof: () => proof,
      privateStreamAccess: (streamId) => ({ requester: proof, driven: locallyCreatedPrivateStreams.has(streamId) }),
      listTraces: () => allTraces,
      listCaptureRecords: () => mergedCaptures,
      setTraceActive,
      setSelectedCapture: (id: string | null) => setSelectedCaptureId(id?.startsWith("capture-") ? id.slice("capture-".length) : id),
      captureSource: async (_roomId, url, goal) => {
        const r = await runCaptureAction({ roomId: rid as never, requester: proof, url, goal });
        return { ok: r.ok, error: r.error };
      },
      secFacts: async (_roomId, company, concept) => {
        const r = await runSecFacts({ roomId: rid as never, requester: proof, company, concept });
        return { ok: r.ok, error: r.error };
      },
      recordCitation: async (args) => {
        try {
          await recordCitationMut({ roomId: rid as never, requester: proof, pdfStorageId: args.pdfStorageId as never, page: args.page, box: args.box, label: args.label, source: args.source });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      listSessions: () => sessions,
      listDrafts: () => drafts,
      listProposals: () => proposals as unknown as Proposal[],
      listPresence: (_id, artifactId) => presenceByArtifact[artifactId] ?? [],
      updatePresence: ({ artifactId, targetKind, targetId, mode, label, color, ttlMs }) => {
        if (!targetId) return;
        void updatePresenceMutation({ roomId: rid, artifactId: artifactId as never, targetKind, targetId, mode, label, color, ttlMs, requester: proof });
      },
      clearPresence: ({ artifactId, targetKind, targetId, mode }) => {
        void clearPresenceMutation({ roomId: rid, artifactId: artifactId as never, targetKind, targetId, mode, requester: proof });
      },
      lockFor: (aid, eid) => locks.find((l) => l.artifactId === aid && l.elementIds.includes(eid)),
      awareness: (_id, aid) => ({ activeLocks: locks.filter((l) => l.holder.id !== aid) }),
      applyEdit: async ({ op }) => {
        const undo = makeUndoEntry(roomId, artifacts.find((a) => a.id === op.artifactId), op);
        try {
          const r = await applyEditCore(op);
          if (r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, r.version));
          return r;
        } catch (e) {
          // TRANSPORT failure (or the browser says we're offline): hold the op for replay.
          // Server answers (conflict/locked) came back as { ok:false } above — never queued.
          const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
          if (browserOffline || isNetworkError(e)) {
            offlineQueue.enqueue(roomId, op);
            setOfflineSnap(offlineQueue.snapshot());
            scheduleOfflineReplay();
            return { ok: false, reason: "offline_held" };
          }
          return { ok: false, reason: e instanceof Error ? e.message : "edit_failed" };
        }
      },
      offlineEditQueue: () => offlineSnap,
      acknowledgeOfflineConflicts: () => {
        offlineQueue.resetConflicts();
        setOfflineSnap(offlineQueue.snapshot());
      },
      canUndo: (id) => (undoStack.current.get(id)?.length ?? 0) > 0,
      undoLastEdit: async (id) => {
        const stack = undoStack.current.get(id) ?? [];
        const entry = stack.pop();
        if (!entry) return { ok: false, reason: "nothing_to_undo" };
        try {
          const r = await applyCellEdit({ roomId: rid, artifactId: entry.op.artifactId as never, elementId: entry.op.elementId, kind: entry.op.kind, value: entry.op.value, baseVersion: entry.op.baseVersion, proof });
          if (!r.ok) stack.push(entry);
          return r.ok ? { ok: true, version: r.version } : { ok: false, reason: r.reason };
        } catch (e) {
          stack.push(entry);
          return { ok: false, reason: e instanceof Error ? e.message : "undo_failed" };
        }
      },
      postMessage: async ({ channel, text, clientMsgId }) => {
        try { await sendMsg({ roomId: rid, channel: chanStr(channel), proof, text, clientMsgId }); return { ok: true }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "send_failed" }; }
      },
      editMessage: async (id, text) => {
        try { const r = await editMsg({ messageId: id as never, text, requester: proof }); return r?.ok ? { ok: true } : { ok: false, reason: r?.reason ?? "edit_failed" }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "edit_failed" }; }
      },
      toggleAutoAllow: () => { void toggle({ roomId: rid, requester: proof }); },
      resolveProposal: async (proposalId, approve) => {
        const proposal = (proposals as unknown as Proposal[]).find((p) => p.id === proposalId);
        const undo = proposal ? makeUndoEntry(roomId, artifacts.find((a) => a.id === proposal.artifactId), proposal.op) : null;
        try {
          const r = await resolveProposalMutation({ proposalId: proposalId as never, approve, requester: proof });
          const version = r.ok && "version" in r ? r.version : undefined;
          if (approve && r.ok) pushUndo(undoStack.current, withAppliedVersion(undo, version));
          return r.ok ? { ok: true, version } : { ok: false, reason: r.reason };
        }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "resolve_failed" }; }
      },
      addResearchRows: async ({ artifactId, rows }) => {
        const ids = await addResearchRowsMutation({ roomId: rid, artifactId: artifactId as never, rows, requester: proof });
        return ids.length;
      },
      setArtifactVisibility: async ({ artifactId, visibility }) => {
        try {
          await setArtifactVisibilityMutation({ roomId: rid, artifactId: artifactId as never, visibility, requester: proof });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "failed" };
        }
      },
      setArtifactMeta: async ({ artifactId, title, summary, tags }) => {
        try {
          await setArtifactMetaMutation({ roomId: rid, artifactId: artifactId as never, title, summary, tags, requester: proof });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "failed" };
        }
      },
      uploadArtifact: async ({ artifact, visibility = "room" }) => {
        const stored = artifact.sourceFile ? await uploadSourceFile(artifact.sourceFile, visibility) : null;
        const meta = stored && artifact.sourceFile ? withStoredSourceMeta(artifact.meta, artifact.sourceFile, stored) : artifact.meta;
        const id = await createArtifactMutation({
          roomId: rid,
          kind: artifact.kind,
          title: artifact.title,
          seed: artifact.seed,
          meta,
          proof,
          ...(stored ? { sourceFileId: stored.fileId as never } : {}),
        });
        return String(id);
      },
      canRunCollab: isHost,
      runCollab: async () => {
        if (!isHost) return;
        const sheet = artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet");
        const sess = sessions.find((s) => s.scope === "public");
        if (!sheet || !sess) return;
        await startAgentJob({
          roomId: rid,
          artifactId: sheet.id as never,
          requester: proof,
          entrypoint: "public_ask",
          scope: "public_room",
          routePolicy: "fast_default",
          runtimePolicy: "workflow_sliced",
          approvalPolicy: "auto_commit_safe",
          evidencePolicy: "public_only",
          traceLevel: "full_operation_ledger",
          autoAllow: true,
          mode: "variance",
          goal: "Fill the remaining Q3 variance cells: Gross profit (r_gp__variance)=+21.7% and Net income (r_ni__variance)=+22.4%. Lock them, edit with CAS, then release.",
        });
      },
      runSemanticConflictDrill: async () => {
        if (!isHost) return;
        const sheet = artifacts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? artifacts.find((a) => a.kind === "sheet");
        if (!sheet) return;
        await runSemanticConflictDrillMutation({
          roomId: rid,
          artifactId: sheet.id as never,
          requester: proof,
          elementId: "r_rev__variance",
          proposedValue: "+19%",
        });
      },
      askAgent: async (input) => {
        const references = canonicalRefs(artifacts, input.references);
        const route = durableRouteForModelSelection(input.modelSelection);
        const runtimeProfile = input.runtimeProfile ?? browserNodeAgentRuntimeProfile();
        const maxAttempts = maxAttemptsForRuntimeProfile(runtimeProfile, input.maxAttempts);
        await startPublicAskJob({
          roomId: rid,
          requester: proof,
          routePolicy: route.routePolicy,
          ...(route.modelPolicy ? { modelPolicy: route.modelPolicy } : {}),
          ...(runtimeProfile ? { runtimeProfile } : {}),
          ...(maxAttempts !== undefined ? { maxAttempts } : {}),
          references,
          contextArtifactId: input.contextArtifactId,
          goal: withReferenceContext(input.goal, references),
        });
      },
      askPrivateAgent: async (input, opts) => {
        const references = canonicalRefs(artifacts, input.references);
        const goal = withReferenceContext(input.goal, references);
        if (opts?.publish) {
          const target = targetArtifact(artifacts, references);
          if (target) {
            await runAgent({ roomId: rid, artifactId: target.id as never, requester: proof, mode: target.title === "Company research" ? "research" : undefined, goal, asOwner: { id: me.id, name: me.name } });
            return;
          }
        }
        if (CONVEX_SITE_URL) {
          // Persistent-text-streaming path: the placeholder message arrives via the reactive
          // subscription; Chat's StreamedBody drives the component stream in this tab and
          // renders the HTTP token stream while the component persists sentence-flushed chunks
          // for every other tab/refresh.
          const { streamId } = await createPrivateReplyStream({ roomId: rid, requester: proof, goal });
          locallyCreatedPrivateStreams.add(streamId);
          return;
        }
        await runPrivateAgent({ roomId: rid, requester: proof, goal });
      },
      startLongFreeAgent: async (input) => {
        const references = canonicalRefs(artifacts, input.references);
        const sheet = targetSheet(artifacts, references);
        const sess = sessions.find((s) => s.scope === "public");
        if (!sheet || !sess) return;
        await sendMsg({
          roomId: rid,
          channel: "public",
          proof,
          text: `Queued long-running free-auto job for ${referenceNames(references)}. It will checkpoint and resume across Convex action slices.`,
          clientMsgId: crypto.randomUUID(),
        });
        const route = durableRouteForModelSelection(input.modelSelection, "free");
        await startAgentJob({
          roomId: rid,
          artifactId: sheet.id as never,
          requester: proof,
          entrypoint: route.entrypoint,
          scope: "public_room",
          routePolicy: route.routePolicy,
          runtimePolicy: "workflow_sliced",
          ...(route.modelPolicy ? { modelPolicy: route.modelPolicy } : {}),
          approvalPolicy: route.approvalPolicy,
          evidencePolicy: "public_only",
          traceLevel: "full_operation_ledger",
          autoAllow: route.autoAllow,
          goal: withReferenceContext(input.goal, references),
          mode: sheet.title === "Company research" ? "research" : "variance",
        });
      },
      askResearch: async () => {
        const research = artifacts.find((a) => a.title === "Company research");
        const sess = sessions.find((s) => s.scope === "public");
        if (!research || !sess) return;
        await startAgentJob({
          roomId: rid,
          artifactId: research.id as never,
          requester: proof,
          entrypoint: "public_ask",
          scope: "public_room",
          routePolicy: "fast_default",
          runtimePolicy: "workflow_sliced",
          approvalPolicy: "auto_commit_safe",
          evidencePolicy: "public_only",
          traceLevel: "full_operation_ledger",
          autoAllow: true,
          mode: "research",
          goal: "Research every pending or stale company: claim its editable research cells, set status to running, fetch the website plus a corroborating source when available, write summary/funding/headcount/recent_signal, write citations into __source and __source2, set last_researched to today's ISO date, set status to complete, then release. Cite only sources you fetched.",
        });
      },
      lastRun: () => {
        const r = (runs as unknown as AgentRunTelemetry[])[0];
        return r ? { model: r.model, steps: r.steps, toolCalls: r.toolCalls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, ms: r.ms } : null;
      },
      lastLongFreeJob: () => {
        const j = (jobs as FreeJobRow[])[0];
        return j ? mapConvexFreeJob(j) : null;
      },
      activeLongFreeJobs: () => (jobs as FreeJobRow[]).filter((j) => isActiveFreeJob(j.status)).map(mapConvexFreeJob),
      lastLongFreeJobAttempts: () => (jobAttempts as Array<{
        attempt: number;
        status: string;
        resolvedModel: string;
        stopReason: string;
        ms: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        error?: string;
        scheduledNextAt?: number;
      }>).map((a) => ({
        attempt: a.attempt,
        status: a.status,
        resolvedModel: a.resolvedModel,
        stopReason: a.stopReason,
        ms: a.ms,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        costUsd: a.costUsd,
        error: a.error,
        scheduledNextAt: a.scheduledNextAt,
      })),
      lastLongFreeJobDetail: () => {
        if (!jobDetail) return null;
        const d = jobDetail as {
          operations?: Array<{ sequence: number; kind: string; name: string; status: string; countDelta?: number; targetKind?: string; targetId?: string; affectedIds?: string[] }>;
          streamEvents?: Array<{
            _id?: string;
            jobId?: string;
            roomId?: string;
            runId?: string;
            sequence: number;
            kind: PersistedAgentStreamEvent["kind"];
            step?: number;
            toolCallId?: string;
            toolName?: string;
            status?: PersistedAgentStreamEvent["status"];
            text?: string;
            title?: string;
            input?: unknown;
            output?: unknown;
            error?: string;
            metadata?: Record<string, unknown>;
            createdAt: number;
          }>;
          reasoningFrames?: Array<{
            frameId: string;
            parentFrameId?: string;
            sequence: number;
            frameKind: "phase" | "child";
            phase: string;
            status: string;
            goal: string;
            cacheKey?: string;
            displayName?: string;
            facet?: string;
            cachePolicy?: string;
            toolAllowlist?: string[];
          }>;
          receipts?: Array<{ _id: string; mutationName: string; affectedIds: string[]; createdAt: number }>;
          leases?: Array<{ targetKind: string; targetId: string; mode: string; status: string; expiresAt: number }>;
          draftOperations?: Array<{ operationName: string; status: string; affectedIds: string[]; createdAt: number }>;
          latestSteps?: Array<{ idx: number; tool: string; status: string; elementId?: string; mutationReceiptIds?: string[] }>;
        };
        const streamEvents = (d.streamEvents ?? []).map((event) => ({
          id: event._id ? String(event._id) : undefined,
          jobId: event.jobId ? String(event.jobId) : undefined,
          roomId: event.roomId ? String(event.roomId) : undefined,
          runId: event.runId ? String(event.runId) : undefined,
          sequence: event.sequence,
          kind: event.kind,
          step: event.step,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.status,
          text: event.text,
          title: event.title,
          input: event.input,
          output: event.output,
          error: event.error,
          metadata: event.metadata,
          createdAt: event.createdAt,
        })) satisfies PersistedAgentStreamEvent[];
        const detailJob = (jobs as Array<{ status: string; finalText?: string }>)[0];
        const terminal = !!detailJob && ["completed", "failed", "blocked", "cancelled"].includes(detailJob.status);
        return {
          operations: (d.operations ?? []).map((o) => ({ sequence: o.sequence, kind: o.kind, name: o.name, status: o.status, countDelta: o.countDelta, targetKind: o.targetKind, targetId: o.targetId, affectedIds: o.affectedIds?.map(String) })),
          streamEvents,
          streamParts: buildUnifiedAgentStreamParts(streamEvents, { finalText: detailJob?.finalText, terminal }),
          reasoningFrames: (d.reasoningFrames ?? []).map((f) => ({
            frameId: String(f.frameId),
            parentFrameId: f.parentFrameId ? String(f.parentFrameId) : undefined,
            sequence: f.sequence,
            frameKind: f.frameKind,
            phase: f.phase,
            status: f.status,
            goal: f.goal,
            cacheKey: f.cacheKey,
            displayName: f.displayName,
            facet: f.facet,
            cachePolicy: f.cachePolicy,
            toolAllowlist: f.toolAllowlist ?? [],
          })),
          receipts: (d.receipts ?? []).map((r) => ({ id: String(r._id), mutationName: r.mutationName, affectedIds: r.affectedIds, createdAt: r.createdAt })),
          leases: (d.leases ?? []).map((l) => ({ targetKind: l.targetKind, targetId: l.targetId, mode: l.mode, status: l.status, expiresAt: l.expiresAt })),
          draftOperations: (d.draftOperations ?? []).map((op) => ({ operationName: op.operationName, status: op.status, affectedIds: op.affectedIds, createdAt: op.createdAt })),
          latestSteps: (d.latestSteps ?? []).map((s) => ({ idx: s.idx, tool: s.tool, status: s.status, elementId: s.elementId, mutationReceiptIds: s.mutationReceiptIds?.map(String) })),
        };
      },
      okfTraceLens: () => okfLens as OkfTraceLensTelemetry | null,
      listPassiveActivity: () => passiveActivity as PassiveActivityItem[],
      researchCostPreview: () => costPreview ?? null,
      roomAssistivePolicy: () => assistivePolicy ?? null,
      setRoomAssistivePolicy: async (mode, opts) => {
        await setRoomAssistivePolicyMutation({
          roomId: rid,
          requester: proof,
          mode: mode as never,
          allowExternalCalls: opts?.allowExternalCalls,
          maxSuggestionsPerHour: opts?.maxSuggestionsPerHour,
          disabledSignalKinds: opts?.disabledSignalKinds,
          approvedEntityWatchlist: opts?.approvedEntityWatchlist,
        });
      },
      cancelLongFreeJob: async (jobId) => {
        try { const r = await cancelFreeAutoJob({ jobId: jobId as never, requester: proof }); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "cancel_failed" }; }
      },
      retryLongFreeJob: async (jobId) => {
        try { const r = await retryFreeAutoJob({ jobId: jobId as never, requester: proof }); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; }
        catch (e) { return { ok: false, reason: e instanceof Error ? e.message : "retry_failed" }; }
      },
      dismissActivity: async (activityId, _actor, dismissReason, scope) => {
        await dismissActivityMutation({
          activityId: activityId as never,
          roomId: rid,
          requester: proof,
          dismissReason: dismissReason as never,
          scope: scope as never,
        });
      },
      researchActivity: async (item) => {
        // Scope is derived server-side from the stored outbox row's visibility —
        // never from client-supplied item.visibility (avoids scope manipulation).
        await researchActivityMutation({ activityId: item.id as never, roomId: rid, requester: proof });
      },
      batchResearchActivity: async (items) => {
        const activityIds = items.map((i) => i.id as never);
        const result = await batchResearchActivityMutation({ activityIds, roomId: rid, requester: proof });
        return { ok: result.ok, total: (result as any).total, succeeded: (result as any).succeeded, failed: (result as any).failed };
      },
      practiceActivity: async (item, actor, userAnswer, expectedOutline) => {
        await practiceActivityMutation({
          activityId: item.id as never,
          roomId: rid,
          requester: { actor: { kind: "user", id: actor.id, name: actor.name }, token: undefined },
          userAnswer,
          expectedOutline,
        });
      },
      addActivityToSheet: async (item) => {
        const entity = item.entityNames[0];
        if (!entity) return;
        const targetArt = researchSheet ?? metaArtifacts.find((a) => (a as { kind?: string }).kind === "sheet");
        if (!targetArt) return;
        const existing = findExistingResearchRowClient({ ...targetArt, elements: elementsByArtifact[targetArt.id] ?? {} } as Artifact, { company: entity });
        if (existing) return { artifactId: targetArt.id as string, rowId: existing, created: false as const };
        const result = await ensurePassiveResearchRowMutation({
          roomId: rid,
          artifactId: targetArt.id as never,
          requester: proof,
          company: entity,
        });
        return result.rowId ? { artifactId: targetArt.id as string, rowId: result.rowId as string, created: result.created } : undefined;
      },
    };
  }, [data, metaArtifacts, elementsByArtifact, presenceByArtifact, pub, priv, traces, okfLens, runs, jobs, jobAttempts, jobDetail, proposals, passiveActivity, mergedCaptures, applyCellEdit, applyEditCore, offlineQueue, offlineSnap, scheduleOfflineReplay, sendMsg, toggle, editMsg, resolveProposalMutation, addResearchRowsMutation, ensurePassiveResearchRowMutation, createArtifactMutation, uploadSourceFile, runSemanticConflictDrillMutation, runAgent, runPrivateAgent, createPrivateReplyStream, startAgentJob, startPublicAskJob, updatePresenceMutation, clearPresenceMutation, cancelFreeAutoJob, retryFreeAutoJob, dismissActivityMutation, researchActivityMutation, practiceActivityMutation, creditMode, creditBalanceQ, creditUsageQ, rid, roomId, proof, me.id, me.name]);

  // E2E test seam: expose runCollab/runSemanticConflictDrill via window so tests can trigger
  // collaboration and conflict drills without the removed CollabBar buttons.
  useEffect(() => {
    const w = window as unknown as { __runCollab?: () => Promise<void>; __runConflictDrill?: () => Promise<void> };
    w.__runCollab = () => store.runCollab();
    w.__runConflictDrill = () => store.runSemanticConflictDrill?.() ?? Promise.resolve();
    return () => {
      delete (window as unknown as { __runCollab?: unknown }).__runCollab;
      delete (window as unknown as { __runConflictDrill?: unknown }).__runConflictDrill;
    };
  }, [store]);

  return (
    <Ctx.Provider value={store}>
      {/* B1: one elements subscription per real artifact — a cell edit re-ships only the edited
          artifact's cells. opt- (optimistic) ids are skipped: they aren't valid Convex ids. */}
      {metaArtifacts.filter((a) => !String(a.id).startsWith("opt-")).map((a) => (
        <ArtifactElementsSubscriber key={a.id} roomId={roomId} artifactId={a.id} proof={proof} onElements={onArtifactElements} onUnmount={onArtifactUnmount} />
      ))}
      {metaArtifacts.filter((a) => !String(a.id).startsWith("opt-")).map((a) => (
        <ArtifactPresenceSubscriber key={`presence-${a.id}`} roomId={roomId} artifactId={a.id} proof={proof} onPresence={onArtifactPresence} onUnmount={onArtifactPresenceUnmount} />
      ))}
      {children}
    </Ctx.Provider>
  );
}
