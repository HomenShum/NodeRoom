/**
 * NodeRoom engine — domain types.
 *
 * The whole collaboration model rests on ONE uniform idea: every artifact
 * (spreadsheet, note, post-it wall) is a bag of **elements**, and an element is
 * just `{ id, version, value }`. A spreadsheet cell, a note block, and a sticky
 * are all elements. That uniformity is what lets locks, optimistic-concurrency
 * (CAS), drafts, and smart-merge be ONE generic mechanism instead of three.
 *
 * Mirrors the Convex contract in `convex/schema.ts` (this engine is the
 * deterministic, no-keys, in-memory implementation of that contract).
 */

export type ActorKind = "user" | "agent";
export type AgentScope = "public" | "private";

export interface Actor {
  kind: ActorKind;
  id: string;
  name: string;
  /** For agents: which NodeAgent — the public room agent or a user's private one. */
  scope?: AgentScope;
  /** For a private agent: the user it belongs to. */
  ownerId?: string;
}

/* ───────────────────────── room + people ───────────────────────── */

export type RoomStatus = "live" | "ended";

export interface Room {
  id: string;
  /** Short join code (anonymous join uses this). */
  code: string;
  title: string;
  hostId: string;
  /** When true, agent edits auto-apply; when false they land as proposals. */
  autoAllow: boolean;
  status: RoomStatus;
  createdAt: number;
}

export interface Member {
  id: string;
  roomId: string;
  name: string;
  role: "host" | "member";
  anon: boolean;
  color: string;
  lastSeenAt: number;
}

/* ───────────────────────── artifacts + elements ───────────────────────── */

export type ArtifactKind = "sheet" | "note" | "wall";
export type ArtifactVisibility = "private" | "room" | "public";

export type DataframeColumnMode = "manual" | "enrich" | "resolve" | "classify" | "compute";
export type CellStatus = "empty" | "running" | "complete" | "needs_review" | "failed" | "gap";

export interface CellEvidence {
  id: string;
  kind: "upload" | "source" | "computed" | "manual";
  label: string;
  source?: string;
  sourceStorageId?: string;
  sourceArtifactId?: string;
  providerFileId?: string;
  sheetName?: string;
  row?: number;
  column?: string;
  page?: number;
  bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
  url?: string;
  snippet?: string;
  confidence?: number;
}

export interface CellPayload {
  value: unknown;
  status?: CellStatus;
  evidence?: CellEvidence[];
  confidence?: number;
  formula?: string;
  error?: string;
  normalizedValue?: unknown;
  attempts?: number;
  updatedByRunId?: string;
  review?: {
    evidenceMemo?: import("../nodeagent/retrieval/types").EvidenceMemo;
    caveat?: string;
    source?: "okf_evidence_memo";
  };
}

export interface DataframeColumn {
  id: string;
  label: string;
  order: number;
  mode?: DataframeColumnMode;
  description?: string;
  type?: "text" | "number" | "date" | "currency" | "boolean" | "json";
  agentWritable?: boolean;
}

export interface DataframeMeta {
  columns: DataframeColumn[];
  rowCount: number;
  sourceFile?: string;
  sheetName?: string;
  sheetNames?: string[];
  parser?: string;
  truncated?: boolean;
  warnings?: string[];
  semanticIndex?: {
    cellCount: number;
    chunkCount: number;
    dependencyCount: number;
    indexedAt: number;
  };
}

/** Compact per-cell visual style captured at upload — only NON-DEFAULT cells get an entry, the
 *  whole layer is size-capped (BOUND), and it is render-only: the CAS write path never reads it. */
export interface ExcelCellStyle {
  /** index into ExcelGridMeta.numFmts */
  f?: number;
  b?: 1;          // bold
  i?: 1;          // italic
  u?: 1;          // underline
  a?: "r" | "c";  // horizontal alignment override (numbers right-align by default)
  bg?: string;    // fill color "#RRGGBB"
  fc?: string;    // font color "#RRGGBB" — overrides the dark-fill light-ink heuristic
  ind?: number;   // indent level
  bt?: 1;         // top border (totals rule)
  bb?: 1;         // bottom border
}

export interface ExcelGridMeta {
  sourceFile: string;
  sheetName: string;
  sheetNames: string[];
  parser: "exceljs:xlsx-grid";
  rows: number;
  columns: number;
  truncated?: boolean;
  warnings?: string[];
  /** style layer (render-only) — see ExcelCellStyle */
  styles?: Record<string, ExcelCellStyle>;
  /** numFmt string dictionary referenced by ExcelCellStyle.f */
  numFmts?: string[];
  /** pixel widths per visible column index (0 = use default) */
  colWidths?: number[];
  /** merged ranges as "B2:D2" strings, capped (render-only) */
  merges?: string[];
}

export type DocumentParseOutput = "text" | "pages" | "bounding_boxes" | "screenshots" | "ocr";
export type DocumentParseRuntime = "node" | "libreoffice" | "imagemagick" | "ocr";

export interface DocumentParseMeta {
  parser: "provider" | "liteparse";
  fallbackParser?: "liteparse";
  lane: "document_layout";
  status: "server_parser_required" | "parsed" | "failed";
  outputs: DocumentParseOutput[];
  requiredRuntime: DocumentParseRuntime[];
  note?: string;
}

export type ProviderParser = "gemini" | "openai" | "anthropic" | "openrouter";

export interface ProviderFileCacheMeta {
  provider: ProviderParser;
  providerFileId: string;
  sourceStorageId: string;
  sourceArtifactId?: string;
  fileName: string;
  mimeType: string;
  size: number;
  cachedAt: number;
  expiresAt?: number;
}

export interface ProviderParseMeta {
  parser: "provider";
  provider: ProviderParser;
  model: string;
  sourceStorageId: string;
  sourceArtifactId?: string;
  providerFileId?: string;
  extractedAt: number;
  warnings?: string[];
  providerRoute?: unknown;
}

export interface ArtifactMeta {
  dataframe?: DataframeMeta;
  excelGrid?: ExcelGridMeta;
  document?: DocumentParseMeta;
  providerParse?: ProviderParseMeta;
  /** Agent-managed metadata derived from content; feeds the OKF/RAG embedding (concept frontmatter). */
  summary?: string;
  tags?: string[];
  upload?: {
    fileName: string;
    mimeType: string;
    size: number;
    parsedAt: number;
    sourceStorageId?: string;
    uploadedFileId?: string;
    sha256?: string;
  };
}

export interface Element {
  id: string; // cell addr "B2" | block id "b1" | sticky id "s1"
  /** Monotonic per-element version — the CAS baseline. */
  version: number;
  value: unknown; // number|string (sheet/note) | {text,x,y,color} (wall)
  updatedAt: number;
  updatedBy: Actor;
}

export interface Artifact {
  id: string;
  roomId: string;
  kind: ArtifactKind;
  title: string;
  /** Artifact-level version bumps on every applied op (a coarse change clock). */
  version: number;
  elements: Record<string, Element>;
  /** Stable element order for rendering (sheet uses addresses, note/wall use this). */
  order: string[];
  updatedAt: number;
  createdBy?: Actor;
  /** Private artifacts are visible only to their owner; room/public are shared surfaces. */
  visibility?: ArtifactVisibility;
  meta?: ArtifactMeta;
}

export interface ResearchRowInput {
  company: string;
  website?: string;
  tier?: string;
  intent?: string;
  owner?: string;
  crmStatus?: string;
}

/* ───────────────────────── change ops + CAS ───────────────────────── */

export type OpKind = "set" | "create" | "delete";

export interface ChangeOp {
  /** Idempotency key — applying the same opId twice is a no-op. */
  opId: string;
  artifactId: string;
  elementId: string;
  kind: OpKind;
  value?: unknown;
  /** The element version this op expects to apply onto (CAS). */
  baseVersion: number;
}

export type EditResult =
  | { ok: true; element: Element; fromVersion: number; toVersion: number }
  | { ok: false; reason: "locked"; by: Actor; lockId: string }
  | { ok: false; reason: "conflict"; expected: number; actual: number }
  | { ok: false; reason: "pending_approval"; proposalId: string }
  | { ok: false; reason: "not_found" | "invalid" | "duplicate" | "formula_protected" | "no_such_column" };

/* ───────────────────────── locks (affected range) ───────────────────────── */

export type LockStatus = "active" | "released";

export interface Lock {
  id: string;
  roomId: string;
  artifactId: string;
  /** The affected range: the element ids this lock makes read-only for others. */
  elementIds: string[];
  holder: Actor;
  /** The work session this lock belongs to (agent or user session). */
  sessionId: string;
  reason: string;
  status: LockStatus;
  createdAt: number;
  /** Lease TTL — a crashed/abandoned holder's lock auto-expires so it can't block a cell forever. */
  expiresAt?: number;
  releasedAt?: number;
}

export type LockResult =
  | { ok: true; lock: Lock }
  | { ok: false; reason: "conflict"; conflicting: Array<{ elementId: string; by: Actor; lockId: string }> };

/* ───────────────────────── drafts + smart merge ───────────────────────── */

export type DraftStatus = "pending" | "merged" | "discarded" | "conflict";

/**
 * A draft is what a BLOCKED actor produces: it read the locked range as context,
 * reasoned about changes around it, and proposed ops to apply once the lock lifts.
 */
export interface Draft {
  id: string;
  roomId: string;
  artifactId: string;
  author: Actor;
  ops: ChangeOp[];
  /** Base values captured when the draft was authored; used for semantic rebase packets. */
  base?: Record<string, { value: unknown; version: number; updatedBy?: Actor }>;
  note: string;
  /** The lock that blocked this draft (so we know when to try merging it). */
  blockedByLockId?: string;
  status: DraftStatus;
  createdAt: number;
  resolvedAt?: number;
  resolution?: MergeResolution;
}

export interface MergeResolution {
  applied: string[]; // opIds applied cleanly
  reauthored: string[]; // opIds the resolver rewrote against the new base
  conflicts: Array<{ opId: string; elementId: string; reason: string; current: unknown }>;
  verdict: "clean" | "resolved" | "needs_review";
  resolver: "deterministic" | "llm";
  note: string;
}

/**
 * The smart-merge seam. The deterministic resolver ships in the spike; a real
 * LLM resolver implements the SAME signature (read both versions, return ops +
 * a note). This is the "smart resolved by the LLM agent itself" pluggable point.
 */
export type SmartResolver = (input: {
  draft: Draft;
  /** Current artifact element state at unlock time. */
  current: Record<string, Element>;
  /** The edits the lock-holder actually committed while locked (for diffing). */
  committed: ChangeOp[];
  now: number;
}) => { ops: ChangeOp[]; resolution: MergeResolution };

/* ───────────────────────── agent sessions (awareness) ───────────────────────── */

export type AgentStatus = "idle" | "working" | "blocked" | "drafting" | "done";

export interface AgentSession {
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  scope: AgentScope;
  ownerId?: string;
  status: AgentStatus;
  /** The lock this agent currently holds (its claimed work range). */
  heldLockId?: string;
  lastAction: string;
  updatedAt: number;
}

/* ───────────────────────── traces + messages ───────────────────────── */

export type TraceType =
  | "room_created" | "member_joined" | "auto_allow_toggled"
  | "lock_acquired" | "lock_released" | "lock_denied"
  | "edit_applied" | "edit_blocked" | "edit_proposed" | "proposal_resolved" | "proposal_resolve_failed"
  | "draft_created" | "draft_merged" | "draft_conflict" | "semantic_conflict"
  | "agent_session_started" | "agent_status" | "message"
  | "notebook_read_model" | "agent_work_plan_proposed" | "agent_work_plan_approved"
  | "schema_changed";

export interface TraceEvent {
  id: string;
  roomId: string;
  ts: number;
  actor: Actor;
  type: TraceType;
  summary: string;
  refs?: Record<string, string>;
  /** Compact "tool · args → result" line for the expandable trace row (assistant-ui ToolFallback style). */
  detail?: string;
}

export type Channel = "public" | { private: string }; // private: ownerId

export interface ToolPart {
  tool: string;
  status: "running" | "done" | "error";
  detail: string;
}

export interface Message {
  id: string;
  roomId: string;
  channel: Channel;
  author: Actor;
  text: string;
  clientMsgId: string; // idempotency + optimistic-reconcile key
  kind: "chat" | "agent" | "system";
  toolParts?: ToolPart[];
  createdAt: number;
  /** persistent-text-streaming id (live mode): body streams from the component while text is
   *  empty; text is patched in at completion so history never depends on the component. */
  streamId?: string;
}

/* ───────────────────────── proposals (auto-allow off) ───────────────────────── */

export type ProposalStatus = "pending" | "approved" | "rejected";

export interface Proposal {
  id: string;
  roomId: string;
  artifactId: string;
  op: ChangeOp;
  author: Actor;
  status: ProposalStatus;
  createdAt: number;
  resolvedAt?: number;
  review?: {
    kind: "agent_edit" | "semantic_rebase";
    conflictId?: string;
    reviewerNote?: string;
    reason?: string;
    status?: "verified" | "needs_review" | "manual_claim" | "draft" | "rejected";
  };
}
