/**
 * Agent harness — types.
 *
 * The harness has three seams so it's explainable and testable:
 *   1. AgentModel — the LLM. Two impls: `anthropicModel` (real, AI SDK) and
 *      `scriptedModel` (deterministic, no network — for demos/tests).
 *   2. RoomTools — the backend the tools call. Two impls: `InMemoryRoomTools`
 *      (over RoomEngine) and the Convex action's impl. SAME interface, so the
 *      agent code never changes between the spike and production.
 *   3. AgentTool[] — the tools the model may call, each backed by RoomTools.
 *
 * The runtime loop owns: context assembly, the call→execute→feed-back cycle, a
 * step budget, and the rule that a CAS conflict comes back as a tool RESULT
 * (data), not a thrown error — so the model can re-read and retry.
 */

import type { ZodTypeAny } from "zod";
import type { ProviderRouteReceipt } from "../guardrails/egressPolicy";
import type { OkfRetrievalPort } from "../retrieval/types";

/* ── conversation ── */
export type Role = "user" | "assistant" | "tool";
export interface AgentMessage {
  role: Role;
  content: string;
  /** On an assistant turn: the tool calls it made (kept so the real-model path can rebuild a well-formed history). */
  toolCalls?: ToolCall[];
  /** On a tool-result turn: which call it answers. */
  toolCallId?: string;
  toolName?: string;
}
export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Provider-specific metadata to round-trip (e.g. Gemini 3.x thought_signature, required for multi-turn tools). */
  providerMetadata?: Record<string, unknown>;
}
export interface TokenUsage { inputTokens: number; outputTokens: number; /** Cached (prefix-cache HIT) input tokens, provider-reported. The #1 cache-health metric (Manus). */ cachedInputTokens?: number; }
/** One turn of the model: optional prose + zero or more tool calls + token usage. */
export interface AgentStep {
  text?: string;
  toolCalls: ToolCall[];
  done: boolean;
  usage?: TokenUsage;
  /** Auditable model route decision recorded by provider-backed model adapters. */
  providerRoute?: ProviderRouteReceipt;
}

/* ── seam 1: the injectable model ── */
export type AgentToolChoice = "auto" | "required";

export interface AgentModel {
  readonly name: string;
  next(input: {
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
    signal?: AbortSignal;
    onTextDelta?: (text: string) => void | Promise<void>;
    /** Hint for providers that support OpenAI-style tool_choice. Runtime still validates writes. */
    toolChoice?: AgentToolChoice;
  }): Promise<AgentStep>;
}

/* ── seam 3: tools ── */
export interface AgentTool {
  name: string;
  description: string;
  schema: ZodTypeAny;
  execute(args: any, rt: RoomTools): Promise<unknown>;
}

export type ToolFailureKind =
  | "missing_required_arg"
  | "invalid_arg_type"
  | "permission_denied"
  | "private_context_blocked"
  | "cas_conflict"
  | "lock_blocked"
  | "evidence_required"
  | "formula_protected"
  | "provider_timeout"
  | "budget_cap"
  | "unknown_tool"
  | "tool_exception";

export type ToolArgumentErrorResult = {
  ok: false;
  error: "tool_argument_error";
  failureKind: Extract<ToolFailureKind, "missing_required_arg" | "invalid_arg_type">;
  missingRequiredArgs: string[];
  issues: Array<{ path: string; code: string; message: string }>;
  recovery: {
    action: "retry_tool_call";
    instruction: string;
  };
};

export interface AgentTraceEvent { step: number; tool: string; args: unknown; result: unknown; ms: number; }
export type AgentStopReason = "done" | "step_budget" | "time_budget" | "spend_budget" | "error";
export interface AgentBudgetSnapshot {
  startedAt: number;
  now: number;
  deadlineAt?: number;
  reserveMs: number;
  elapsedMs: number;
  remainingMs?: number;
  usableMs?: number;
  maxSteps: number;
  attemptedSteps: number;
}
export interface AgentHandoff {
  reason: Exclude<AgentStopReason, "done">;
  summary: string;
  nextGoal: string;
  remainingToolCalls: ToolCall[];
  messageCount: number;
  traceCount: number;
  latestAssistantText?: string;
}
export interface AgentResult {
  finalText: string;
  steps: number;
  exhausted: boolean;
  stopReason: AgentStopReason;
  handoff?: AgentHandoff;
  budget: AgentBudgetSnapshot;
  trace: AgentTraceEvent[];
  messages: AgentMessage[];
  usage: TokenUsage & { modelCalls: number };
}

/* ── seam 2: the room-tools port (in-memory now, Convex later — SAME shape) ── */
export interface CellView {
  id: string;
  value: unknown;
  version: number;
  locked: { by: string; reason: string } | null;
  /** Non-fatal steering for ambiguous cross-artifact reads, shown to the model as tool data. */
  hint?: string;
  candidateArtifacts?: Array<{ id: string; title: string; kind: string }>;
}
export interface CellMeta { value: string; version: number; locked: boolean; }
/** Variance fields are kept for the financial demo; `cells` is the generic per-column map
 *  any tabular artifact (e.g. the company-research sheet) renders + edits through. */
export interface RoomSnapshotRow { rowId: string; label: string; q2: string; q3: string; variance: string; note: string; varianceVersion: number; locked: boolean; cells: Record<string, CellMeta>; }
export interface SnapshotElement { id: string; value: unknown; version: number; locked: boolean; }
/** `rows` is the sheet-shaped projection; `elements` is the kind-agnostic raw element list
 *  (present in live mode) that note/wall context builders read. */
export interface RoomSnapshot { artifactId: string; version: number; kind: string; rows: RoomSnapshotRow[]; elements?: SnapshotElement[]; }
export type SourceResult = { ok: true; title: string; snippet: string; url: string } | { ok: false; error: string };
export type SpreadsheetContextHit =
  | { kind: "cell"; elementId: string; coordinate: string; rowHeader: string; columnHeader: string; rawValue: string; semanticSummary: string; score: number }
  | { kind: "chunk"; chunkId: string; elementIds: string[]; text: string; score: number };
export interface AwarenessView {
  activeLocks: { lockId: string; elementIds: string[]; holder: string; reason: string }[];
  agents: { name: string; scope: string; status: string }[];
  recentTrace: string[];
  /** Room write policy. false = REVIEW MODE: agent edits file proposals (pendingApproval results).
   *  Surfaced to the model via the context builders — without it, the model reads pendingApproval
   *  as failure and retries/wanders (the live 0/3 review-mode incident, see FRICTION_LOG). */
  autoAllow?: boolean;
}
export type EditOutcome =
  | { ok: true; version: number; mutationReceiptId?: string }
  | { ok: false; conflict: true; expected: number; actual: number }
  | { ok: false; locked: true; holder: string }
  | { ok: false; pendingApproval: true; proposalId?: string }
  | { ok: false; error: string };
export interface MergeView { draftId: string; verdict: string; note: string; applied: number; conflicts: number; }
/** Result of an agent-governed schema edit (define_columns). CAS conflict is returned as DATA, like EditOutcome. */
export type SetColumnsOutcome =
  | { ok: true; version: number; columns: Array<{ id: string; label: string; order: number; type?: string; mode?: string; agentWritable?: boolean }> }
  | { ok: false; conflict: true; expected: number; actual: number }
  | { ok: false; error: string };

/** A file the agent can reach within the room (the polymorphic node: sheet/note/wiki/wall). */
export type ArtifactRef = { id: string; title: string; kind: string; readHint?: string; exampleElementIds?: string[] };

export interface RoomTools {
  /** Optional portable knowledge layer. Present for OKF-aware rooms/evals; absent rooms keep working. */
  okf?: OkfRetrievalPort;
  /** Whole-sheet snapshot for the agent's context. Defaults to the primary artifact; pass artifactId for another file. */
  snapshot(artifactId?: string): Promise<RoomSnapshot>;
  /** Who else holds locks, which agents are active, recent activity. */
  awareness(): Promise<AwarenessView>;
  /** Discover the room's other files (sheet/note/wiki/wall) — so one run can read one file and write another. */
  listArtifacts(): Promise<ArtifactRef[]>;
  /** Agent-author a file's topic + metadata from its content (title/summary/tags). Re-indexes into OKF. */
  setArtifactMeta?(args: { artifactId: string; title?: string; summary?: string; tags?: string[] }): Promise<{ ok: boolean; error?: string }>;
  /** Create downloadable file-viewer artifacts authored by the agent. */
  createFileArtifacts?(args: {
    files: Array<{ fileName: string; mimeType: string; size: number; dataUrl?: string; text?: string }>;
    summary?: string;
    sourceArtifactIds?: string[];
    sourceUrls?: string[];
  }): Promise<{ ok: true; artifacts: ArtifactRef[] } | { ok: false; error: string }>;
  /** Agent-governed SCHEMA edit: declare/replace a sheet's COLUMNS before filling rows. CAS-guarded on the
   *  artifact version — a stale baseVersion returns { conflict } as DATA so the runtime re-reads and retries. */
  setColumns?(args: { artifactId?: string; baseVersion: number; mode: "replace" | "merge"; columns: Array<{ label: string; type?: string; agentWritable?: boolean }> }): Promise<SetColumnsOutcome>;
  /** Read specific cells — WORKS on locked cells (locked != invisible). Defaults to the primary artifact; pass artifactId for another file. */
  readRange(elementIds: string[], artifactId?: string): Promise<CellView[]>;
  /** Search header-prepended cell summaries and structural sub-grid chunks for large sheets. */
  searchSheetContext(query: string, artifactId?: string, limit?: number): Promise<SpreadsheetContextHit[]>;
  /** Claim an affected range read-only for others. On denial, returns the blocking lockId. Defaults to the primary artifact. */
  proposeLock(elementIds: string[], reason: string, artifactId?: string): Promise<{ ok: true; lockId: string } | { ok: false; reason: string; lockId?: string }>;
  /** Release a held lock; any waiting drafts smart-merge now. */
  releaseLock(lockId: string): Promise<{ ok?: boolean; reason?: string; merged: MergeView[] }>;
  /** CAS write — conflict returns as DATA, never throws. Defaults to the primary artifact; pass artifactId for another file.
   *  `kind` defaults to "set"; pass "create" to add a new element (e.g. a post-it) or "delete" to remove one. */
  editCell(elementId: string, value: unknown, baseVersion: number, artifactId?: string, kind?: "set" | "create" | "delete"): Promise<EditOutcome>;
  /** Queue ops to merge when a blocking lock releases (no clobber). Defaults to the primary artifact. */
  createDraft(ops: { elementId: string; value: unknown; baseVersion: number }[], blockedByLockId: string, note: string, artifactId?: string): Promise<{ draftId: string }>;
  /** Post a status line to the agent's chat channel. */
  say(text: string): Promise<void>;
  /** Fetch a source URL for sourced enrichment — bounded (SSRF-guarded, timeout, size cap). */
  fetchSource(url: string): Promise<SourceResult>;
  /** Persist a finished live capture (screenshots + boxes) so it renders in the Trace tab.
   *  Optional: only the server (Convex) port implements it; in-memory/browser ports omit it. */
  citeInFile?(input: { target: string; label?: string; fileName?: string }): Promise<unknown>;
  recordCapture?(input: {
    url: string;
    goal: string;
    ok: boolean;
    title?: string;
    error?: string;
    data?: Record<string, unknown>;
    steps: Array<{ phase: string; label: string; status: string; detail?: string; box?: { x: number; y: number; w: number; h: number }; screenshotPng?: Uint8Array }>;
  }): Promise<void>;
}
