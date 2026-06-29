/**
 * NodeMem — Core memory object model.
 *
 * The primitive is not "vector search." It is:
 *   memory = policy(source history) + compression + retrieval + provenance + freshness + task assembly
 *
 * Every memory object carries provenance. No memory without a source episode.
 */

// ─── Episodes ───────────────────────────────────────────────────────────────

export type EpisodeSourceKind =
  | "chat"
  | "notebook"
  | "spreadsheet"
  | "file"
  | "source_capture"
  | "agent_trace"
  | "proposal"
  | "benchmark_run"
  | "architecture_change"
  | "qa_failure";

export type Visibility = "public" | "room" | "private" | "system";

export interface NodeMemEpisode {
  id: string;
  workspaceId?: string;
  roomId?: string;
  actorId?: string;
  sourceKind: EpisodeSourceKind;
  sourceId: string;
  sourceVersion?: number;
  visibility: Visibility;
  contentHash: string;
  rawText?: string;
  rawJson?: string;
  artifactRefs?: string[];
  createdAt: number;
}

// ─── Entities ───────────────────────────────────────────────────────────────

export type EntityKind =
  | "company"
  | "person"
  | "event"
  | "artifact"
  | "source"
  | "concept"
  | "tool"
  | "agent"
  | "database"
  | "workflow";

export interface NodeMemEntity {
  id: string;
  workspaceId?: string;
  roomId?: string;
  kind: EntityKind;
  canonicalName: string;
  aliases: string[];
  summary: string;
  confidence: number;
  lastSeenAt: number;
  sourceRefs: string[];
}

// ─── Facts ──────────────────────────────────────────────────────────────────

export type FactStatus =
  | "manual"
  | "source_backed"
  | "graph_inferred"
  | "needs_review"
  | "superseded"
  | "rejected";

export interface NodeMemFact {
  id: string;
  workspaceId?: string;
  roomId?: string;
  subjectEntityId: string;
  predicate: string;
  object: string;
  status: FactStatus;
  validFrom?: number;
  validTo?: number;
  evidenceFactIds: string[];
  episodeIds: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export interface NodeMemDecision {
  id: string;
  workspaceId?: string;
  roomId?: string;
  decision: string;
  acceptedOption: string;
  rejectedOptions: string[];
  affectedNodes: string[];
  rationale: string;
  receiptRefs: string[];
  createdAt: number;
}

// ─── Preferences ────────────────────────────────────────────────────────────

export type PreferenceScope = "user" | "team" | "workspace" | "room";

export interface NodeMemPreference {
  id: string;
  userId?: string;
  teamId?: string;
  scope: PreferenceScope;
  preference: string;
  evidenceEpisodes: string[];
  confidence: number;
  expiresAt?: number;
  createdAt: number;
}

// ─── Procedures ─────────────────────────────────────────────────────────────

export interface NodeMemProcedure {
  id: string;
  name: string;
  trigger: string;
  steps: string[];
  requiredReceipts: string[];
  lastVerifiedAt?: number;
}

// ─── Failure Patterns ───────────────────────────────────────────────────────

export interface NodeMemFailurePattern {
  id: string;
  symptom: string;
  rootCause: string;
  regressionTest: string;
  fixSummary: string;
  affectedSystems: string[];
  receiptRefs: string[];
  createdAt: number;
}

// ─── Feedback ───────────────────────────────────────────────────────────────

export type FeedbackKind =
  | "useful"
  | "wrong"
  | "stale"
  | "too_noisy"
  | "private"
  | "already_handled";

export type FeedbackTargetKind =
  | "fact"
  | "entity"
  | "context_pack"
  | "suggestion";

export type FeedbackScope =
  | "item"
  | "entity"
  | "signal"
  | "room"
  | "workspace";

export interface NodeMemFeedback {
  id: string;
  workspaceId?: string;
  roomId?: string;
  userId: string;
  targetKind: FeedbackTargetKind;
  targetId: string;
  feedbackKind: FeedbackKind;
  scope: FeedbackScope;
  createdAt: number;
}

// ─── ContextPack ────────────────────────────────────────────────────────────

export type TaskKind =
  | "company_research"
  | "spreadsheet_edit"
  | "evidence_capture"
  | "architecture_change"
  | "qa_debug"
  | "product_design"
  | "coding_agent_handoff"
  | "general";

export type RetrieverKind =
  | "bm25"
  | "semantic"
  | "graph"
  | "filter"
  | "exact"
  | "recent";

export interface RetrievalTraceEntry {
  retriever: RetrieverKind;
  query: string;
  resultIds: string[];
  reason: string;
}

export interface ContextPackEvidence {
  factId: string;
  label: string;
  value: string;
  sourceRefs: string[];
  confidence: "high" | "medium" | "low";
}

export interface ContextPackGraphFact {
  factId: string;
  statement: string;
  status: FactStatus;
  validFrom?: number;
  validTo?: number;
  provenance: string[];
}

export interface ContextPackPermissions {
  userId: string;
  roomId?: string;
  includedVisibility: Visibility[];
  excludedReasons: string[];
}

export interface ContextPackFreshness {
  maxAgeMs: number;
  staleItems: string[];
  needsRefresh: boolean;
}

export interface ContextPackLiveState {
  roomId?: string;
  selectedArtifactId?: string;
  visibleCells?: string[];
  activeEdits?: string[];
  activeJobs?: string[];
}

export interface NodeMemContextPack {
  packId: string;
  goal: string;
  taskKind: TaskKind;
  generatedAt: number;
  freshness: ContextPackFreshness;
  permissions: ContextPackPermissions;
  liveState: ContextPackLiveState;
  evidence: ContextPackEvidence[];
  graphFacts: ContextPackGraphFact[];
  decisions: NodeMemDecision[];
  preferences: NodeMemPreference[];
  procedures: NodeMemProcedure[];
  failuresToAvoid: NodeMemFailurePattern[];
  openQuestions: string[];
  allowedActions: string[];
  prohibitedActions: string[];
  retrievalTrace: RetrievalTraceEntry[];
}

// ─── Memory Shelves ─────────────────────────────────────────────────────────

export type MemoryShelf =
  | "working"
  | "recent"
  | "structural"
  | "evidence"
  | "temporal_graph"
  | "preference"
  | "procedural"
  | "historical"
  | "persona";

export const SHELF_DESCRIPTIONS: Record<MemoryShelf, string> = {
  working: "Current task/session: active room, visible cells, current agent job",
  recent: "Last runs, errors, handoffs, current branch, recent instructions",
  structural: "Architecture graph, schema, tool registry, queues, MCP servers, hooks",
  evidence: "Source captures, evidence facts, screenshots, bbox overlays, verifier receipts",
  temporal_graph: "People, companies, events, portfolio links, source validity windows",
  preference: "User/team style, review strictness, output format, notification policy",
  procedural: "RALPH loops, benchmark runbooks, evidence capture workflow",
  historical: "Pivots, rejected options, old failures, why decisions were made",
  persona: "Investor lens, banker lens, designer lens, security lens",
};

// ─── Promotion Levels ───────────────────────────────────────────────────────

export type PromotionLevel =
  | 0  // Raw episode
  | 1  // Extracted candidate
  | 2  // Manual memory (user-supplied, unverified)
  | 3  // Source-backed memory (has source capture / quote / ref)
  | 4  // Operational memory (used successfully in output/workflow)
  | 5  // Institutional memory (reused across sessions, protected)
  | -1; // Rejected / dismissed

export const PROMOTION_LEVEL_NAMES: Record<PromotionLevel, string> = {
  0: "raw_episode",
  1: "extracted_candidate",
  2: "manual",
  3: "source_backed",
  4: "operational",
  5: "institutional",
  [-1]: "rejected",
};
