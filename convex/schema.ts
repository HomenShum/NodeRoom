/**
 * NodeRoom Convex schema — the production contract behind the in-memory engine.
 *
 * The spike runs on RoomEngine (deterministic, no keys); production persists the
 * SAME shapes here and streams them via reactive queries. Every collaborative
 * field is keyed so the lock/CAS/draft/idempotency logic ports directly:
 *   - elements carry a `version` (per-element CAS baseline)
 *   - changeOps carry an `opId` (idempotency) + `baseVersion` (CAS)
 *   - messages carry a `clientMsgId` (idempotent send + optimistic reconcile)
 *   - locks carry an element-id list (the affected range)
 *
 * Convex's internal OCC alone does NOT prevent stale-baseline clobber — the
 * per-element `version` + the application-level CAS check is what does (see the
 * `applySpreadsheetDelta`/`applyCellEdit` pattern). New fields ship `v.optional`.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { refutationVerdictV } from "./lib";
import { notificationEventsTable, watchesTable } from "./watchesTables";

const actor = v.object({
  kind: v.union(v.literal("user"), v.literal("agent")),
  id: v.string(),
  name: v.string(),
  scope: v.optional(v.union(v.literal("public"), v.literal("private"))),
  ownerId: v.optional(v.string()),
});

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
const creditModeV = v.union(v.literal("quick"), v.literal("standard"), v.literal("deep"));
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
const agentStreamEventStatusV = v.union(
  v.literal("started"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped"),
);
const graphObjectKindV = v.union(
  v.literal("notebook"),
  v.literal("node"),
  v.literal("relation"),
  v.literal("artifact"),
  v.literal("element"),
  v.literal("range"),
  v.literal("wiki_page"),
  v.literal("wiki_block"),
  v.literal("reasoning_frame"),
);
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const okfVisibilityV = v.union(v.literal("public"), v.literal("private"), v.literal("redacted"));
const reasoningFramePhaseV = v.union(v.literal("intake"), v.literal("plan"), v.literal("execute"), v.literal("verify"), v.literal("synthesize"));
const reasoningFrameStatusV = v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("blocked"), v.literal("skipped"), v.literal("failed"));
const entityTypeV = v.union(
  v.literal("company"),
  v.literal("person"),
  v.literal("product"),
  v.literal("source"),
  v.literal("metric"),
  v.literal("unknown"),
);
const entityWorkStatusV = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("cached"),
  v.literal("refreshing"),
  v.literal("completed"),
  v.literal("needs_review"),
  v.literal("gap"),
  v.literal("failed"),
  v.literal("cancelled"),
);
const notebookDirtyStateV = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("processed"),
  v.literal("superseded"),
  v.literal("failed"),
);
const notebookProcessingLaneV = v.union(
  v.literal("passive"),
  v.literal("coach"),
  v.literal("index"),
);
const notebookProcessingStatusV = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);
const agentArtifactKindV = v.union(
  v.literal("agent_work_plan"),
  v.literal("spreadsheet_diff_preview"),
  v.literal("evidence_card"),
  v.literal("coach_feedback"),
  v.literal("planned_vs_actual"),
);
const agentArtifactStatusV = v.union(
  v.literal("draft"),
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("executed"),
  v.literal("rejected"),
  v.literal("superseded"),
);

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    title: v.string(),
    hostId: v.string(),
    autoAllow: v.boolean(),
    status: v.union(v.literal("live"), v.literal("ended")),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  members: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    role: v.union(v.literal("host"), v.literal("member")),
    anon: v.boolean(),
    color: v.string(),
    authToken: v.optional(v.string()),
    authTokenHash: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_room", ["roomId"]),

  artifacts: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("sheet"), v.literal("note"), v.literal("wall")),
    title: v.string(),
    version: v.number(),
    order: v.array(v.string()),
    updatedAt: v.number(),
    createdBy: v.optional(actor),
    visibility: v.optional(visibilityV),
    meta: v.optional(v.any()),
  }).index("by_room", ["roomId"]),

  /** One row per element (cell / block / sticky) — the CAS unit. */
  uploadedFiles: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    storageId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.optional(v.string()),
    createdBy: actor,
    visibility: visibilityV,
    status: v.union(v.literal("uploaded"), v.literal("linked"), v.literal("deleted")),
    createdAt: v.number(),
    linkedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId", "createdAt"])
    .index("by_artifact", ["artifactId"])
    .index("by_storage", ["storageId"]),

  elements: defineTable({
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    version: v.number(),
    value: v.any(),
    updatedAt: v.number(),
    updatedBy: actor,
  }).index("by_artifact", ["artifactId", "elementId"]),

  /** Per-element VERSION LOG — the append-only history behind per-cell history,
   *  Restore, and diff (Receipts layer). One row per APPLIED write through
   *  `applyCellEditCore`: the BEFORE-image of the value that write superseded,
   *  keyed by the version that held it (restoring version N = read the row at
   *  version N, re-apply as a normal CAS write). Conflict/locked/pending paths
   *  never log. BOUND: `value` is a truncated snapshot (non-scalars stringified,
   *  capped at 4,000 chars, `truncated` flagged — restore refuses truncated
   *  rows) and the table is in retention's PRUNABLE set (30d), so history stays
   *  bounded instead of becoming a second unbounded copy of every sheet. */
  elementVersions: defineTable({
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    /** The element version whose value this row preserves (the before-image). */
    version: v.number(),
    value: v.any(),
    /** True when the snapshot was cut at the cap — display-only, never restorable. */
    truncated: v.boolean(),
    /** The actor whose applied write superseded this version (who changed it away). */
    updatedBy: actor,
    kind: v.union(v.literal("set"), v.literal("create"), v.literal("delete")),
    ts: v.number(),
  }).index("by_artifact_element", ["artifactId", "elementId", "version"]),

  /** The lock tool — an affected range made read-only for non-holders. */
  locks: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementIds: v.array(v.string()),
    holder: actor,
    sessionId: v.string(),
    reason: v.string(),
    status: v.union(v.literal("active"), v.literal("released")),
    createdAt: v.number(),
    /** Lease TTL — a crashed/abandoned holder's lock auto-expires so it can't block a cell forever. */
    expiresAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
  })
    .index("by_room_status", ["roomId", "status"])
    .index("by_artifact_status", ["artifactId", "status"]),

  /** Advisory presence and intent. This is never a write gate; it paints who is
   *  focused/editing/planning so humans and agents can work beside each other
   *  without long visible locks. Rows are TTL-bounded and safe to ignore. */
  presenceClaims: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    targetKind: v.union(
      v.literal("cell"),
      v.literal("notebook_block"),
      v.literal("deck_component"),
      v.literal("slide"),
    ),
    targetId: v.string(),
    mode: v.union(
      v.literal("focus"),
      v.literal("edit"),
      v.literal("agent_intent"),
      v.literal("commit_lease"),
    ),
    actorId: v.string(),
    actor,
    label: v.optional(v.string()),
    color: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_room_artifact", ["roomId", "artifactId", "expiresAt"])
    .index("by_room_target", ["roomId", "targetKind", "targetId", "expiresAt"])
    .index("by_actor", ["roomId", "artifactId", "actorId"])
    .index("by_actor_mode", ["roomId", "artifactId", "actorId", "mode"]),

  drafts: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    author: actor,
    ops: v.array(v.object({
      opId: v.string(),
      artifactId: v.string(),
      elementId: v.string(),
      kind: v.union(v.literal("set"), v.literal("create"), v.literal("delete")),
      value: v.optional(v.any()),
      baseVersion: v.number(),
    })),
    note: v.string(),
    blockedByLockId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("merged"), v.literal("discarded"), v.literal("conflict")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_room_status", ["roomId", "status"]),

  proposals: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    op: v.any(),
    author: actor,
    review: v.optional(v.any()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_room_status", ["roomId", "status"]),

  // Durable semantic-rebase ledger: a stale agent write the CAS spine couldn't apply is built into a
  // SemanticConflictPacket, classified (auto-merge / review / forbidden), and recorded here — the
  // live-Convex completion of the no-clobber wedge.
  semanticConflicts: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    trigger: v.string(),
    conflictKind: v.string(),
    overlap: v.string(),
    elementIds: v.array(v.string()),
    tier: v.string(),
    action: v.string(),
    decision: v.string(),
    canAutoCommit: v.boolean(),
    outcome: v.union(v.literal("auto_merged"), v.literal("needs_review"), v.literal("recorded"), v.literal("rejected")),
    reasons: v.array(v.string()),
    proposalIds: v.optional(v.array(v.string())),
    packet: v.any(),
    actor,
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_room", ["roomId", "createdAt"]),

  agentSessions: defineTable({
    roomId: v.id("rooms"),
    agentId: v.string(),
    agentName: v.string(),
    scope: v.union(v.literal("public"), v.literal("private")),
    ownerId: v.optional(v.string()),
    status: v.union(v.literal("idle"), v.literal("working"), v.literal("blocked"), v.literal("drafting"), v.literal("done")),
    heldLockId: v.optional(v.string()),
    lastAction: v.string(),
    updatedAt: v.number(),
  }).index("by_room", ["roomId"]),

  messages: defineTable({
    roomId: v.id("rooms"),
    /** "public" or a private owner id. */
    channel: v.string(),
    author: actor,
    text: v.string(),
    clientMsgId: v.string(),
    kind: v.union(v.literal("chat"), v.literal("agent"), v.literal("system")),
    createdAt: v.number(),
    /** persistent-text-streaming stream id: while set and text is empty, the body lives in the
     *  streaming component (token-level for the driving tab, sentence-flushed for viewers); on
     *  completion text is patched in so history/refs/export never depend on the component. */
    streamId: v.optional(v.string()),
  })
    .index("by_room_channel", ["roomId", "channel", "createdAt"])
    .index("by_clientMsgId", ["roomId", "clientMsgId"]),

  /** Server-side metadata for NodeAgent reply streams. Private replies use ownerId=<member id>;
   *  durable public job streams use ownerId="public" and the same auth/read path. The prompt +
   *  room context are captured AT CREATE TIME for private HTTP-driven streams; this table is
   *  never returned to clients. */
  privateReplyStreams: defineTable({
    roomId: v.id("rooms"),
    ownerId: v.string(),
    requesterName: v.string(),
    goal: v.string(),
    roomContext: v.string(),
    clientMsgId: v.string(),
    streamId: v.string(),
    createdAt: v.number(),
  }).index("by_stream", ["streamId"]),

  traces: defineTable({
    roomId: v.id("rooms"),
    ts: v.number(),
    actor,
    type: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
  }).index("by_room", ["roomId", "ts"]),

  /** Live web/SEC source captures — a screenshot + extracted values WITH the on-screen box each came
   *  from (visual provenance). Written by the capture action; rendered as a Trace record. */
  captureRecords: defineTable({
    roomId: v.id("rooms"),
    url: v.string(),
    goal: v.string(),
    title: v.optional(v.string()),
    ok: v.boolean(),
    error: v.optional(v.string()),
    ts: v.number(),
    steps: v.array(v.object({
      phase: v.string(),
      label: v.string(),
      status: v.string(),
      detail: v.optional(v.string()),
      box: v.optional(v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number(), page: v.optional(v.number()) })),
      screenshotId: v.optional(v.id("_storage")),
      pdfStorageId: v.optional(v.id("_storage")),
    })),
    data: v.optional(v.any()),
  }).index("by_room", ["roomId", "ts"]),

  /** Per-agent-run telemetry — model, steps, tool calls, tokens, cost, latency. */
  /** Passive room activity queue. Mutations enqueue cheap facts here; a quiet-window scanner
   * decides whether to ignore, index, backlink, or start a durable room-work job. */
  roomActivityOutbox: defineTable({
    roomId: v.id("rooms"),
    sourceKind: v.union(
      v.literal("node"),
      v.literal("element"),
      v.literal("artifact_element"),
      v.literal("artifact"),
      v.literal("upload"),
      v.literal("message"),
      v.literal("wiki_revision"),
    ),
    sourceId: v.string(),
    sourceVersion: v.optional(v.number()),
    sourceHash: v.string(),
    eventKind: v.union(
      v.literal("idle_after_typing"),
      v.literal("cell_committed"),
      v.literal("file_uploaded"),
      v.literal("manual_enqueue"),
      v.literal("content_committed"),
      v.literal("page_hidden"),
      v.literal("manual_save"),
      v.literal("artifact_imported"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("scanning"),
      v.literal("completed"),
      v.literal("ignored"),
      v.literal("not_noteworthy"),
      v.literal("noteworthy"),
      v.literal("job_created"),
      v.literal("failed"),
    ),
    actor: v.optional(actor),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    dedupeKey: v.string(),
    quietUntil: v.number(),
    maxWaitAt: v.optional(v.number()),
    dismissedBy: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    attempts: v.number(),
    latestJobId: v.optional(v.id("agentJobs")),
    decision: v.optional(v.any()),
    finding: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastScannedAt: v.optional(v.number()),
  })
    .index("by_status_quietUntil", ["status", "quietUntil"])
    .index("by_room", ["roomId", "updatedAt"])
    .index("by_room_status", ["roomId", "status", "updatedAt"])
    .index("by_room_status_quietUntil", ["roomId", "status", "quietUntil"])
    .index("by_room_source", ["roomId", "sourceKind", "sourceId"])
    .index("by_dedupe", ["dedupeKey", "updatedAt"])
    .index("by_source", ["sourceKind", "sourceId", "updatedAt"])
    // Visibility-scoped indexes for the passive feed: shared rows (room/public) never fetch
    // private rows; own-private rows are fetched by ownerId so other members' private rows
    // never occupy take slots (closes a metadata side-channel about private activity volume).
    .index("by_room_visibility_updated", ["roomId", "visibility", "updatedAt"])
    .index("by_room_owner_visibility_updated", ["roomId", "ownerId", "visibility", "updatedAt"]),

  /** P2: Tracks entity names dismissed by room members so future passive suggestions
   *  for the same entity are automatically suppressed. One row per (roomId, entityName) pair.
   *  dismissedBy tracks who dismissed it; dismissedAt tracks when for staleness. */
  roomDismissedEntities: defineTable({
    roomId: v.id("rooms"),
    entityName: v.string(),
    dismissedBy: v.string(),
    dismissedAt: v.number(),
    dismissCount: v.number(),
  })
    .index("by_room_entity", ["roomId", "entityName"])
    .index("by_room", ["roomId", "dismissedAt"]),

  /** P3: Per-room assistive intelligence policy. Most restrictive setting wins
   *  across system → workspace → room → user hierarchy. */
  roomAssistivePolicies: defineTable({
    roomId: v.id("rooms"),
    mode: v.union(
      v.literal("off"),
      v.literal("suggestions_only"),
      v.literal("ask_before_research"),
      v.literal("approved_watchlist_only"),
    ),
    allowExternalCalls: v.boolean(),
    maxSuggestionsPerHour: v.number(),
    maxApprovedBackgroundJobsPerDay: v.number(),
    disabledSignalKinds: v.array(v.string()),
    approvedEntityWatchlist: v.array(v.string()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId"]),

  /** P3: Structured dismissal feedback with signal fingerprinting.
   *  Replaces simple entity dismissal with scoped suppression (item/entity/signal/room). */
  suggestionFeedback: defineTable({
    roomId: v.id("rooms"),
    userId: v.string(),
    suggestionId: v.id("roomActivityOutbox"),
    entity: v.optional(v.string()),
    signalFingerprintHash: v.string(),
    dismissReason: v.union(
      v.literal("wrong_entity"),
      v.literal("not_relevant"),
      v.literal("too_noisy"),
      v.literal("already_handled"),
      v.literal("sensitive"),
      v.literal("other"),
    ),
    scope: v.union(
      v.literal("item"),
      v.literal("entity"),
      v.literal("signal"),
      v.literal("room"),
    ),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_room_signal", ["roomId", "signalFingerprintHash"])
    .index("by_room_entity", ["roomId", "entity"])
    .index("by_suggestion", ["suggestionId"]),

  /** P3: Cost estimates with p50/p90/hard cap bands for research jobs.
   *  Records both forecast and actual cost for calibration. */
  passiveCostEstimates: defineTable({
    roomId: v.id("rooms"),
    suggestionId: v.id("roomActivityOutbox"),
    taskClass: v.string(),
    modelRoute: v.string(),
    p50Usd: v.number(),
    p90Usd: v.number(),
    hardCapUsd: v.number(),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    basis: v.string(),
    actualUsd: v.optional(v.number()),
    forecastErrorRatio: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_suggestion", ["suggestionId"]),

  /** P3: Server-side suggestion digests. Groups raw suggestions by entity/signal/source
   *  so the inbox shows compact groups instead of walls of cards. */
  roomSuggestionDigests: defineTable({
    roomId: v.id("rooms"),
    groupKey: v.string(),
    groupKind: v.union(
      v.literal("entity"),
      v.literal("signal"),
      v.literal("source"),
      v.literal("day"),
      v.literal("artifact"),
    ),
    title: v.string(),
    summary: v.string(),
    count: v.number(),
    sampleSuggestionIds: v.array(v.id("roomActivityOutbox")),
    highestPriority: v.number(),
    status: v.union(
      v.literal("open"),
      v.literal("expanded"),
      v.literal("dismissed"),
      v.literal("archived"),
    ),
    updatedAt: v.number(),
  })
    .index("by_room_status", ["roomId", "status"]),

  /** P3: Non-guarantee ledger. Every place where the system cannot provide a hard
   *  structural guarantee gets an explicit entry with bounds, fallback, and alerting. */
  systemNonGuarantees: defineTable({
    area: v.string(),
    statement: v.string(),
    failureMode: v.string(),
    boundedBy: v.array(v.string()),
    userVisibleFallback: v.string(),
    metric: v.string(),
    alertThreshold: v.string(),
    owner: v.string(),
  })
    .index("by_area", ["area"]),

  /** Native notebook wrapper registry. Maps a `note` artifact's "doc" element to the
   *  ProseMirror Sync component document id, so NodeRoom business semantics (room/artifact/
   *  visibility/owner) stay outside the collaborative-text component. `onSnapshot(id, ...)`
   *  uses this row for registry hash/version tracking only; passive intelligence is enqueued
   *  by the canonical `applyCellEdit` commit path. Only created behind
   *  VITE_NOTEBOOK_SYNC=prosemirror; legacy notes never get a row. */
  notebookDocuments: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    prosemirrorDocId: v.string(),
    visibility: v.optional(visibilityV),
    ownerId: v.optional(v.string()),
    latestSnapshotHash: v.optional(v.string()),
    latestIndexedVersion: v.optional(v.number()),
    latestProcessedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_artifact_element", ["roomId", "artifactId", "elementId"])
    .index("by_prosemirror_doc", ["prosemirrorDocId"]),

  /** Target native-notebook processing trigger. A dirty event contains actor,
   * policy, version/hash, range, and lane metadata only. It never stores the
   * notebook body; the processor reads the latest ProseMirror snapshot through
   * notebookDocuments ACL before writing the read model. */
  notebookDirtyEvents: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    notebookDocumentId: v.id("notebookDocuments"),
    prosemirrorDocId: v.string(),
    actor,
    actorId: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    observedSnapshotVersion: v.optional(v.number()),
    observedSnapshotHash: v.optional(v.string()),
    changedRangeHint: v.optional(v.string()),
    processingLane: notebookProcessingLaneV,
    state: notebookDirtyStateV,
    dirtyAt: v.number(),
    quietUntil: v.optional(v.number()),
    maxWaitAt: v.number(),
    latestProcessingJobId: v.optional(v.id("notebookProcessingJobs")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_doc_actor_lane_state", ["prosemirrorDocId", "actorId", "processingLane", "state"])
    .index("by_room_state", ["roomId", "state", "updatedAt"])
    .index("by_state_maxWaitAt", ["state", "maxWaitAt"]),

  /** One processor receipt per claimed dirty event. The action owns external or
   * component reads; this mutation-owned row records what snapshot version/hash
   * was processed and what read-model rows were produced. */
  notebookProcessingJobs: defineTable({
    dirtyEventId: v.id("notebookDirtyEvents"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    prosemirrorDocId: v.string(),
    actorId: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    docVersion: v.optional(v.number()),
    docHash: v.optional(v.string()),
    processorVersion: v.string(),
    schemaVersion: v.string(),
    status: notebookProcessingStatusV,
    resultSummary: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_dirty_event", ["dirtyEventId"])
    .index("by_room", ["roomId", "startedAt"]),

  notebookBlocks: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    dirtyEventId: v.id("notebookDirtyEvents"),
    processingJobId: v.id("notebookProcessingJobs"),
    prosemirrorDocId: v.string(),
    blockId: v.string(),
    blockIndex: v.number(),
    blockType: v.string(),
    text: v.string(),
    textHash: v.string(),
    sourceSnapshotVersion: v.number(),
    sourceSnapshotHash: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    actorId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_artifact", ["artifactId", "blockIndex"])
    .index("by_dirty_event", ["dirtyEventId", "blockIndex"])
    .index("by_room_visibility_owner", ["roomId", "visibility", "ownerId", "updatedAt"]),

  notebookClaims: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    dirtyEventId: v.id("notebookDirtyEvents"),
    processingJobId: v.id("notebookProcessingJobs"),
    claimId: v.string(),
    blockId: v.string(),
    text: v.string(),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    sourceSnapshotVersion: v.number(),
    sourceSnapshotHash: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    actorId: v.string(),
    createdAt: v.number(),
  })
    .index("by_artifact", ["artifactId", "createdAt"])
    .index("by_dirty_event", ["dirtyEventId", "createdAt"]),

  notebookMentions: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    dirtyEventId: v.id("notebookDirtyEvents"),
    processingJobId: v.id("notebookProcessingJobs"),
    mentionId: v.string(),
    blockId: v.string(),
    entityType: entityTypeV,
    displayName: v.string(),
    entityKey: v.string(),
    sourceSnapshotVersion: v.number(),
    sourceSnapshotHash: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    actorId: v.string(),
    createdAt: v.number(),
  })
    .index("by_artifact", ["artifactId", "createdAt"])
    .index("by_dirty_event", ["dirtyEventId", "createdAt"])
    .index("by_room_entity", ["roomId", "entityType", "entityKey"]),

  agentArtifacts: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    jobId: v.optional(v.id("agentJobs")),
    kind: agentArtifactKindV,
    status: agentArtifactStatusV,
    title: v.string(),
    createdBy: actor,
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    payload: v.any(),
    payloadHash: v.string(),
    planHash: v.optional(v.string()),
    approvedBy: v.optional(actor),
    approvedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
    executedJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_kind_status", ["roomId", "kind", "status", "updatedAt"])
    .index("by_plan_hash", ["planHash", "updatedAt"])
    .index("by_room_visibility_updated", ["roomId", "visibility", "updatedAt"])
    .index("by_room_visibility_owner", ["roomId", "visibility", "ownerId", "updatedAt"]),

  /** Evidence Accountant capture row. This is distinct from older captureRecords: one capture can
   * fan out to many extracted facts and CellPayload evidence refs. */
  sourceCaptures: defineTable({
    roomId: v.id("rooms"),
    sourceUrl: v.string(),
    sourceTitle: v.optional(v.string()),
    sourceKind: v.union(
      v.literal("web"),
      v.literal("pdf"),
      v.literal("spreadsheet"),
      v.literal("sec"),
      v.literal("market_data"),
      v.literal("dataroom"),
      v.literal("app"),
    ),
    contentHash: v.string(),
    markdownStorageId: v.optional(v.id("_storage")),
    htmlStorageId: v.optional(v.id("_storage")),
    screenshotStorageId: v.optional(v.id("_storage")),
    viewport: v.optional(v.any()),
    provider: v.optional(v.string()),
    capturedByJobId: v.optional(v.id("agentJobs")),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_room_hash", ["roomId", "contentHash"])
    .index("by_url", ["sourceUrl"])
    .index("by_job", ["capturedByJobId", "createdAt"]),

  evidenceFacts: defineTable({
    roomId: v.id("rooms"),
    captureId: v.optional(v.id("sourceCaptures")),
    factId: v.string(),
    label: v.string(),
    value: v.any(),
    unit: v.optional(v.string()),
    period: v.optional(v.string()),
    quote: v.optional(v.string()),
    selector: v.optional(v.string()),
    bboxNorm: v.optional(v.any()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    checks: v.any(),
    usedBy: v.array(v.any()),
    createdByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
  })
    .index("by_room_fact", ["roomId", "factId"])
    .index("by_capture", ["captureId"])
    .index("by_job", ["createdByJobId", "createdAt"]),

  /** Optional processing adapter ledger. Convex storage ids remain canonical; external ids
   * (Transloadit assemblies, ConvexFS paths/CDN ids, provider file ids) are cache/runtime metadata. */
  fileProcessingJobs: defineTable({
    roomId: v.id("rooms"),
    uploadedFileId: v.optional(v.id("uploadedFiles")),
    storageId: v.optional(v.string()),
    provider: v.union(v.literal("convex_storage"), v.literal("convex_fs"), v.literal("transloadit")),
    externalId: v.optional(v.string()),
    purpose: v.union(v.literal("upload"), v.literal("parse"), v.literal("transcode"), v.literal("thumbnail"), v.literal("ocr"), v.literal("normalize")),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("waiting"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    inputMeta: v.optional(v.any()),
    outputMeta: v.optional(v.any()),
    resultUrls: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    createdBy: actor,
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId", "updatedAt"])
    .index("by_uploaded", ["uploadedFileId", "updatedAt"])
    .index("by_provider_external", ["provider", "externalId"])
    .index("by_status", ["status", "updatedAt"]),

  agentRuns: defineTable({
    jobId: v.optional(v.id("agentJobs")),
    roomId: v.id("rooms"),
    agentId: v.string(),
    model: v.string(),
    goal: v.string(),
    steps: v.number(),
    toolCalls: v.number(),
    conflictsSurvived: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.optional(v.number()),
    costUsd: v.number(),
    ms: v.number(),
    exhausted: v.boolean(),
    stopReason: v.optional(v.string()),
    remainingMs: v.optional(v.number()),
    deadlineAt: v.optional(v.number()),
    handoff: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]).index("by_idempotency", ["idempotencyKey", "createdAt"]),

  // ── Credit ledger (pilot wallet). The credit math + caps live in
  // src/nodeagent/core/creditModel.ts (the single source of truth, imported here).
  // roomCredits = materialized balance (fast reads + transactional reserve/settle);
  // creditLedger = append-only audit trail; creditGrants = append-only top-ups.
  // A room with NO roomCredits row is "not enrolled" → unenforced (live stays clean
  // until grants are seeded). NOT pruned by retention.
  roomCredits: defineTable({
    roomId: v.id("rooms"),
    availableCredits: v.number(),
    reservedCredits: v.number(),
    lifetimeSpentCredits: v.number(),
    /** Kill switch — when true, reserve() rejects new holds without a redeploy. */
    paused: v.boolean(),
    updatedAt: v.number(),
  }).index("by_room", ["roomId"]),

  creditGrants: defineTable({
    roomId: v.id("rooms"),
    credits: v.number(),
    source: v.union(v.literal("pilot"), v.literal("promo"), v.literal("manual"), v.literal("paid")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]),

  creditLedger: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("reserve"), v.literal("settle"), v.literal("refund"), v.literal("reject")),
    mode: v.optional(creditModeV),
    /** Idempotency key (usually the jobId) tying reserve↔settle↔refund together. */
    reservationKey: v.string(),
    /** Signed credit delta to `available` (reserve: −hold, settle: −actual, refund: +x). */
    credits: v.number(),
    usd: v.number(),
    jobId: v.optional(v.id("agentJobs")),
    runId: v.optional(v.id("agentRuns")),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    /** Reserve rows past this with no settle are swept + refunded (crashed-run holds). */
    expiresAt: v.optional(v.number()),
  }).index("by_room", ["roomId", "createdAt"]).index("by_reservation", ["reservationKey"]).index("by_expiry", ["expiresAt"]),

  /** APPEND-ONLY step-level trace — the agent's full (tool · args → result) decision
   * sequence per run. The audit + trajectory-eval record: never updated, linked to a
   * run, attributed (agentId/model via the run), with the elementId a write touched
   * for per-cell provenance. `args`/`result` are JSON, size-capped (BOUND_READ). */
  agentJobs: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actor,
    goal: v.string(),
    entrypoint: v.optional(entrypointV),
    scope: v.optional(agentScopeV),
    commandText: v.optional(v.string()),
    request: v.optional(v.any()),
    priority: v.optional(v.number()),
    approvalPolicy: v.optional(approvalPolicyV),
    evidencePolicy: v.optional(evidencePolicyV),
    autoAllow: v.optional(v.boolean()),
    traceLevel: v.optional(traceLevelV),
    routePolicy: v.optional(routePolicyV),
    runtimePolicy: v.optional(runtimePolicyV),
    runtimeProfile: v.optional(runtimeProfileV),
    idempotencyKey: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"), v.literal("coach_eval"))),
    planPreview: v.optional(v.any()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("retrying"),
      v.literal("completed"),
      v.literal("blocked"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    modelPolicy: v.string(),
    runtime: v.optional(v.union(v.literal("inline"), v.literal("scheduler"), v.literal("workflow"))),
    workflowId: v.optional(v.string()),
    workId: v.optional(v.string()),
    activeFrameId: v.optional(v.string()),
    cursor: v.optional(v.any()),
    handoff: v.optional(v.any()),
    attempts: v.number(),
    maxAttempts: v.number(),
    actionSliceCount: v.optional(v.number()),
    queryCount: v.optional(v.number()),
    mutationCount: v.optional(v.number()),
    modelCallCount: v.optional(v.number()),
    toolCallCount: v.optional(v.number()),
    schedulerHandoffCount: v.optional(v.number()),
    receiptCount: v.optional(v.number()),
    latestRunId: v.optional(v.id("agentRuns")),
    leaseId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    finalText: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId", "updatedAt"])
    .index("by_status_nextRunAt", ["status", "nextRunAt"])
    .index("by_idempotency", ["idempotencyKey", "createdAt"]),

  agentJobAttempts: defineTable({
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    frameId: v.optional(v.string()),
    attempt: v.number(),
    status: v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("blocked"), v.literal("failed")),
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.optional(v.number()),
    costUsd: v.number(),
    error: v.optional(v.string()),
    scheduledNextAt: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.number(),
  }).index("by_job", ["jobId", "attempt"]),

  agentModelStepJournal: defineTable({
    jobId: v.id("agentJobs"),
    sliceKey: v.string(),
    step: v.number(),
    model: v.string(),
    inputHash: v.string(),
    outputHash: v.string(),
    result: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_slice_step", ["jobId", "sliceKey", "step"])
    .index("by_job", ["jobId", "createdAt"]),

  agentOperationEvents: defineTable({
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    stepId: v.optional(v.id("agentSteps")),
    sequence: v.number(),
    kind: operationEventKindV,
    name: v.string(),
    targetKind: v.optional(graphObjectKindV),
    targetId: v.optional(v.string()),
    inputHash: v.optional(v.string()),
    outputHash: v.optional(v.string()),
    status: operationStatusV,
    countDelta: v.optional(v.number()),
    affectedIds: v.optional(v.array(v.string())),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_job_sequence", ["jobId", "sequence"])
    .index("by_run", ["runId", "sequence"]),

  /** UIMessage-shaped, append-only public/private agent stream timeline. This is the canonical
   * ordered stream for visible agent UX: model text chunks, tool lifecycle parts, warnings,
   * artifact updates, and finalization. The legacy persistent-text-streaming body is retained as
   * a compatibility/materialized text path, but this table owns the part order. */
  agentStreamEvents: defineTable({
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
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
    createdAt: v.number(),
  })
    .index("by_job_sequence", ["jobId", "sequence"])
    .index("by_room", ["roomId", "createdAt"])
    .index("by_run", ["runId", "sequence"]),

  /** Durable reasoning-frame rows for harness-native recursive reasoning.
   * The model is not trusted to "remember everything"; frames are explicit,
   * queryable units with compact context packs, parent links, evidence state,
   * and child-work metadata for Trace Lens and future workflow execution. */
  agentReasoningFrames: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    jobId: v.id("agentJobs"),
    framePlanId: v.string(),
    frameId: v.string(),
    parentFrameId: v.optional(v.string()),
    sequence: v.number(),
    frameKind: v.union(v.literal("phase"), v.literal("child")),
    phase: reasoningFramePhaseV,
    status: reasoningFrameStatusV,
    goal: v.string(),
    contextPack: v.any(),
    toolAllowlist: v.array(v.string()),
    stateDelta: v.optional(v.any()),
    evidenceState: v.optional(v.any()),
    cacheKey: v.optional(v.string()),
    entityType: v.optional(entityTypeV),
    entityKey: v.optional(v.string()),
    displayName: v.optional(v.string()),
    facet: v.optional(v.string()),
    cachePolicy: v.optional(v.string()),
    expectedOutputSchema: v.optional(v.string()),
    resultRef: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_job_sequence", ["jobId", "sequence"])
    .index("by_job_frame", ["jobId", "frameId"])
    .index("by_room_status", ["roomId", "status", "updatedAt"]),

  /** Per entity/facet work items under an agentJobs parent. This is the durable child-work shape for
   * one harnessed Room Agent plus selective subwork, not a permanent-agent-per-company design. */
  entityWorkItems: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    jobId: v.id("agentJobs"),
    parentJobId: v.optional(v.id("agentJobs")),
    requester: actor,
    visibility: okfVisibilityV,
    ownerId: v.optional(v.string()),
    entityType: entityTypeV,
    entityKey: v.string(),
    displayName: v.string(),
    facet: v.string(),
    cacheId: v.optional(v.id("entityResearchCache")),
    status: entityWorkStatusV,
    cachePolicy: v.union(
      v.literal("fresh_use_cache"),
      v.literal("stale_use_cache_and_refresh"),
      v.literal("missing_research_now"),
      v.literal("manual_only_do_not_research"),
      v.literal("contradiction_needs_review"),
    ),
    idempotencyKey: v.string(),
    plan: v.optional(v.any()),
    resultRef: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_job", ["jobId", "createdAt"])
    .index("by_room_entity_status", ["roomId", "entityType", "entityKey", "status"])
    .index("by_idempotency", ["idempotencyKey", "createdAt"]),

  agentMutationReceipts: defineTable({
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    stepId: v.optional(v.id("agentSteps")),
    mutationName: v.string(),
    permission: v.string(),
    inputHash: v.string(),
    output: v.any(),
    affectedIds: v.array(v.string()),
    beforeVersions: v.optional(v.any()),
    afterVersions: v.optional(v.any()),
    traceId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId", "createdAt"])
    .index("by_trace", ["traceId"]),

  agentDraftOperations: defineTable({
    jobId: v.id("agentJobs"),
    proposedBy: actor,
    operationName: v.string(),
    input: v.any(),
    affectedIds: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"), v.literal("needs_rebase"), v.literal("applied")),
    approvalRequiredBy: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_job_status", ["jobId", "status"]),

  agentLeases: defineTable({
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    roomId: v.id("rooms"),
    targetKind: graphObjectKindV,
    targetId: v.string(),
    mode: v.union(v.literal("read"), v.literal("write"), v.literal("structural")),
    status: v.union(v.literal("active"), v.literal("released"), v.literal("expired"), v.literal("stolen")),
    expiresAt: v.number(),
    createdAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_job_status", ["jobId", "status"])
    .index("by_target_status", ["targetKind", "targetId", "status"]),

  wikiPages: defineTable({
    roomId: v.id("rooms"),
    title: v.string(),
    slug: v.string(),
    visibility: visibilityV,
    version: v.number(),
    latestRevisionId: v.optional(v.string()),
    createdByJobId: v.optional(v.id("agentJobs")),
    updatedByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_slug", ["roomId", "slug"])
    .index("by_room", ["roomId", "updatedAt"]),

  wikiRevisions: defineTable({
    roomId: v.id("rooms"),
    wikiPageId: v.id("wikiPages"),
    revisionId: v.string(),
    content: v.string(),
    contentFormat: v.union(v.literal("markdown"), v.literal("json")),
    evidencePolicy: evidencePolicyV,
    createdByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
  }).index("by_page", ["wikiPageId", "createdAt"]),

  notebooks: defineTable({
    roomId: v.id("rooms"),
    title: v.string(),
    ownerId: v.optional(v.string()),
    visibility: visibilityV,
    rootNodeId: v.optional(v.id("nodes")),
    defaultRelationTypeId: v.optional(v.id("relationTypes")),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_room", ["roomId", "updatedAt"]),

  nodes: defineTable({
    roomId: v.id("rooms"),
    notebookId: v.id("notebooks"),
    authorId: v.string(),
    kind: v.union(
      v.literal("note"),
      v.literal("folder"),
      v.literal("wiki_ref"),
      v.literal("artifact_ref"),
      v.literal("source"),
      v.literal("claim"),
      v.literal("task"),
      v.literal("agent_summary"),
    ),
    title: v.optional(v.string()),
    content: v.string(),
    contentFormat: v.union(v.literal("plain"), v.literal("markdown"), v.literal("lexical"), v.literal("json")),
    visibility: visibilityV,
    accessMode: v.optional(v.union(v.literal("read"), v.literal("write"), v.literal("owner"))),
    version: v.number(),
    isDeleted: v.boolean(),
    canonicalRelationId: v.optional(v.id("relations")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourceElementId: v.optional(v.string()),
    createdByJobId: v.optional(v.id("agentJobs")),
    updatedByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebook", ["notebookId", "updatedAt"])
    .index("by_room", ["roomId", "updatedAt"]),

  relationTypes: defineTable({
    roomId: v.id("rooms"),
    notebookId: v.optional(v.id("notebooks")),
    key: v.string(),
    label: v.string(),
    reverseLabel: v.string(),
    description: v.optional(v.string()),
    visibility: visibilityV,
    isSystem: v.boolean(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_key", ["roomId", "key"])
    .index("by_notebook_key", ["notebookId", "key"]),

  relations: defineTable({
    roomId: v.id("rooms"),
    notebookId: v.id("notebooks"),
    fromObjectKind: graphObjectKindV,
    fromId: v.string(),
    toObjectKind: graphObjectKindV,
    toId: v.string(),
    relationTypeId: v.id("relationTypes"),
    authorId: v.string(),
    visibility: visibilityV,
    version: v.number(),
    isDeleted: v.boolean(),
    positionKey: v.string(),
    listType: v.union(v.literal("all"), v.literal("note_content"), v.literal("pinned"), v.literal("pointer"), v.literal("outline")),
    createdByJobId: v.optional(v.id("agentJobs")),
    updatedByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebook", ["notebookId", "positionKey"])
    .index("by_from", ["fromObjectKind", "fromId"])
    .index("by_to", ["toObjectKind", "toId"])
    .index("by_relation_type", ["relationTypeId"]),

  okfConcepts: defineTable({
    roomId: v.id("rooms"),
    conceptId: v.string(),
    path: v.string(),
    type: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    body: v.string(),
    searchText: v.string(),
    resource: v.optional(v.string()),
    tags: v.array(v.string()),
    status: v.optional(v.string()),
    confidence: v.optional(v.number()),
    visibility: v.optional(okfVisibilityV),
    ownerId: v.optional(v.string()),
    frontmatter: v.any(),
    links: v.array(v.object({ label: v.string(), target: v.string(), conceptId: v.optional(v.string()) })),
    citations: v.array(v.object({ id: v.string(), label: v.string(), target: v.string(), conceptId: v.optional(v.string()) })),
    sourceKind: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceVersion: v.optional(v.number()),
    contentHash: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    createdByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId", "updatedAt"])
    .index("by_room_concept", ["roomId", "conceptId"])
    .index("by_room_path", ["roomId", "path"])
    .index("by_room_type", ["roomId", "type"])
    .index("by_room_status", ["roomId", "status"])
    .index("by_room_visibility_owner", ["roomId", "visibility", "ownerId"])
    .searchIndex("by_search_text", { searchField: "searchText", filterFields: ["roomId"] }),

  okfChunks: defineTable({
    roomId: v.id("rooms"),
    conceptId: v.string(),
    chunkId: v.string(),
    chunkIndex: v.number(),
    text: v.string(),
    searchText: v.string(),
    embedding: v.array(v.float64()),
    embeddingProvider: v.string(),
    embeddingModel: v.string(),
    embeddingDimension: v.number(),
    contentHash: v.string(),
    visibility: v.optional(okfVisibilityV),
    ownerId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_concept", ["roomId", "conceptId"])
    .index("by_room_chunk", ["roomId", "chunkId"])
    .searchIndex("by_chunk_text", { searchField: "searchText", filterFields: ["roomId"] })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 64, filterFields: ["roomId"] }),

  okfEdges: defineTable({
    roomId: v.id("rooms"),
    fromConceptId: v.string(),
    toConceptId: v.string(),
    label: v.string(),
    kind: v.string(),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_from", ["roomId", "fromConceptId"])
    .index("by_to", ["roomId", "toConceptId"]),

  okfOutbox: defineTable({
    roomId: v.id("rooms"),
    conceptId: v.string(),
    contentHash: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    attempts: v.number(),
    nextRunAt: v.optional(v.number()),
    leaseId: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_nextRunAt", ["status", "nextRunAt"])
    .index("by_room_concept", ["roomId", "conceptId"]),

  retrievalEvents: defineTable({
    roomId: v.id("rooms"),
    jobId: v.optional(v.id("agentJobs")),
    runId: v.optional(v.id("agentRuns")),
    query: v.string(),
    tool: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    candidateIds: v.array(v.string()),
    hitConceptIds: v.array(v.string()),
    visibility: v.optional(okfVisibilityV),
    ownerId: v.optional(v.string()),
    latencyMs: v.number(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId", "createdAt"])
    .index("by_job", ["jobId", "createdAt"]),

  /** Operational entity/facet cache for fast diligence fills. OKF remains the portable evidence
   * layer; this table is the room-local lookup index that lets a repeated company/person/facet
   * request return immediately or schedule only stale/missing work. */
  entityResearchCache: defineTable({
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    visibility: okfVisibilityV,
    ownerId: v.optional(v.string()),
    entityType: v.union(
      v.literal("company"),
      v.literal("person"),
      v.literal("product"),
      v.literal("source"),
      v.literal("metric"),
      v.literal("unknown"),
    ),
    entityKey: v.string(),
    displayName: v.string(),
    facet: v.string(),
    queryHash: v.string(),
    sourceSetHash: v.optional(v.string()),
    resultHash: v.string(),
    result: v.any(),
    evidenceRefs: v.array(v.any()),
    status: v.union(
      v.literal("fresh"),
      v.literal("stale"),
      v.literal("refreshing"),
      v.literal("needs_review"),
      v.literal("gap"),
    ),
    confidence: v.optional(v.number()),
    retrievedAt: v.number(),
    observedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    staleAfter: v.optional(v.number()),
    deltaStatus: v.optional(v.union(v.literal("none"), v.literal("minor"), v.literal("material"), v.literal("contradiction"))),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.number(),
  })
    .index("by_room_entity_facet", ["roomId", "visibility", "entityType", "entityKey", "facet"])
    .index("by_room_owner", ["roomId", "ownerId", "updatedAt"])
    .index("by_room_updated", ["roomId", "updatedAt"]),

  embeddingJobs: defineTable({
    roomId: v.id("rooms"),
    sourceKind: graphObjectKindV,
    sourceId: v.string(),
    contentHash: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    attempts: v.number(),
    nextRunAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdByJobId: v.optional(v.id("agentJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_nextRunAt", ["status", "nextRunAt"])
    .index("by_source_hash", ["roomId", "sourceKind", "sourceId", "contentHash"]),

  embeddings: defineTable({
    roomId: v.id("rooms"),
    sourceKind: graphObjectKindV,
    sourceId: v.string(),
    sourceVersion: v.number(),
    contentHash: v.string(),
    provider: v.string(),
    model: v.string(),
    dimension: v.number(),
    vector: v.array(v.number()),
    visibility: visibilityV,
    createdAt: v.number(),
  })
    .index("by_source", ["roomId", "sourceKind", "sourceId"])
    .index("by_content_hash", ["roomId", "contentHash"]),

  spreadsheetCells: defineTable({
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    coordinate: v.string(),
    rowId: v.string(),
    columnId: v.string(),
    rowIndex: v.number(),
    colIndex: v.number(),
    rowHeader: v.string(),
    columnHeader: v.string(),
    rawValue: v.string(),
    formula: v.optional(v.string()),
    semanticSummary: v.string(),
    updatedAt: v.number(),
  })
    .index("by_artifact_element", ["artifactId", "elementId"])
    .index("by_artifact_row_col", ["artifactId", "rowIndex", "colIndex"]),

  spreadsheetChunks: defineTable({
    artifactId: v.id("artifacts"),
    chunkId: v.string(),
    rowStart: v.number(),
    rowEnd: v.number(),
    colStart: v.number(),
    colEnd: v.number(),
    elementIds: v.array(v.string()),
    text: v.string(),
    updatedAt: v.number(),
  }).index("by_artifact_chunk", ["artifactId", "chunkId"]),

  spreadsheetDependencies: defineTable({
    artifactId: v.id("artifacts"),
    parentElementId: v.string(),
    childElementId: v.string(),
    parentCoordinate: v.string(),
    childCoordinate: v.string(),
    formula: v.string(),
    updatedAt: v.number(),
  })
    .index("by_parent", ["artifactId", "parentElementId"])
    .index("by_child", ["artifactId", "childElementId"]),

  spreadsheetIndexRefreshes: defineTable({
    artifactId: v.id("artifacts"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    dueAt: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_artifact_status", ["artifactId", "status", "updatedAt"])
    .index("by_status_due", ["status", "dueAt"]),

  agentSteps: defineTable({
    jobId: v.optional(v.id("agentJobs")),
    runId: v.id("agentRuns"),
    roomId: v.id("rooms"),
    agentId: v.string(),
    idx: v.number(),
    phase: v.optional(v.string()),
    operationEventIds: v.optional(v.array(v.id("agentOperationEvents"))),
    tool: v.string(),
    args: v.string(),
    result: v.string(),
    /** Honest outcome derived from the result — never "ok" on a failed CAS (HONEST_STATUS). */
    status: v.union(v.literal("ok"), v.literal("conflict"), v.literal("locked"), v.literal("error")),
    ms: v.number(),
    ts: v.number(),
    /** Set for edit_cell steps — enables "why is this cell this value" provenance. */
    elementId: v.optional(v.string()),
    affectedObjectIds: v.optional(v.array(v.string())),
    mutationReceiptIds: v.optional(v.array(v.id("agentMutationReceipts"))),
    toolRegistryVersion: v.optional(v.number()),
    /** Tamper-evidence: SHA-256 over this record's sorted-key serialization, chained to the previous. */
    recordHash: v.string(),
    prevStepHash: v.string(),
  })
    .index("by_run", ["runId", "idx"])
    .index("by_room_element", ["roomId", "elementId"]),

  // ---- Solo Founder Agent Builder: honest-lane eval ledger + memory substrate ----
  // Each row = one immutable ITERATION (e.g. a 100-task BankerToolBench sweep). Flip them like pages.
  evalRuns: defineTable({
    roomId: v.id("rooms"),
    iterationLabel: v.string(),
    benchmark: v.string(),
    model: v.optional(v.string()),
    materializerMode: v.string(), // "replay" | "general-only" | "generic-only"
    // Discriminator for run shape. Optional for backwards-compat with pre-existing rows
    // (which were all bankertoolbench sweeps before this field was added). New writers
    // should set this explicitly: "sweep" = full BTB sweep, "model-frontier" = dev/replay
    // frontier probe (e.g. 8-task observation), "baseline" = control/no-agent baseline.
    kind: v.optional(v.union(v.literal("sweep"), v.literal("model-frontier"), v.literal("baseline"))),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    taskCount: v.number(),
    // honest headline: mean reward over rows where cleanGeneralProbe && modelCalls > 0
    headlineCleanProbeMean: v.optional(v.number()),
    headlineN: v.optional(v.number()),
    notes: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId"])
    .index("by_room_started", ["roomId", "startedAt"]),

  // ~100 rows per run; paginate via usePaginatedQuery. Carries the honest-lane classification.
  taskResults: defineTable({
    roomId: v.id("rooms"),
    evalRunId: v.id("evalRuns"),
    taskId: v.string(),
    family: v.optional(v.string()),
    reward: v.number(),
    raw: v.optional(v.string()),
    exceptions: v.number(),
    firedWriter: v.string(), // "generic-quartet" | "general_teaser" | "replay:<family>" | ...
    cleanGeneralProbe: v.boolean(), // generic-only writer AND model genuinely in the loop
    modelCalls: v.number(),
    tokensUsed: v.optional(v.number()),
    plannerTransport: v.optional(v.string()), // "tool-call" | "source-skill" | "json-text" | "none"
    countsTowardHeadline: v.boolean(), // cleanGeneralProbe && modelCalls > 0 — the only rows in the headline
    trialId: v.optional(v.string()),
    verdict: v.optional(v.string()),
    refutations: v.optional(v.array(refutationVerdictV)),
    createdAt: v.number(),
  })
    .index("by_run", ["evalRunId"])
    .index("by_room_run", ["roomId", "evalRunId"])
    .index("by_run_task", ["evalRunId", "taskId"]),

  // SoloMemory L1-L3 on Convex. heldout_forbidden writes are REJECTED at the mutation (quarantine).
  memoryEvents: defineTable({
    roomId: v.id("rooms"),
    projectId: v.string(),
    userId: v.optional(v.string()),
    phase: v.string(),
    kind: v.string(),
    summary: v.string(),
    content: v.string(),
    searchText: v.string(), // summary + content + tags joined, feeds the full-text index
    tags: v.array(v.string()),
    importance: v.number(),
    visibility: v.string(), // "local" | "project" | "private_user" | "public_safe"
    benchmarkSafety: v.string(), // "safe" | "tuned_only" | "aggregate_only" | "redacted"
    evidenceRefs: v.array(v.object({ type: v.string(), ref: v.string(), note: v.optional(v.string()) })),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_phase", ["roomId", "phase"])
    .searchIndex("by_memory_text", { searchField: "searchText", filterFields: ["roomId", "phase", "benchmarkSafety"] })
    .vectorIndex("by_memory_embedding", { vectorField: "embedding", dimensions: 64, filterFields: ["roomId"] }),

  // ─── NodeMem — Phase 2 shadow mode tables ──────────────────────────────────
  // Append-only episode log. No hot-row patches. Background compiled.
  nodeMemEpisodes: defineTable({
    roomId: v.optional(v.id("rooms")),
    workspaceId: v.optional(v.string()),
    actorId: v.optional(v.string()),
    sourceKind: v.string(), // "chat" | "notebook" | "spreadsheet" | "file" | "source_capture" | "agent_trace" | ...
    sourceId: v.string(),
    sourceVersion: v.optional(v.number()),
    visibility: v.string(), // "public" | "room" | "private" | "system"
    contentHash: v.string(),
    rawText: v.optional(v.string()),
    rawJson: v.optional(v.string()),
    artifactRefs: v.optional(v.array(v.string())),
    compiled: v.boolean(), // false on insert, true after background compilation
    compiledAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_source", ["sourceKind", "sourceId"])
    .index("by_content_hash", ["contentHash"])
    .index("by_uncompiled", ["compiled", "createdAt"]),

  // Per-room NodeMem mode/budget override — benchmark + dev only, gated by NODEMEM_ROOM_CONFIG_ENABLED.
  // Absent row → fall back to the global NODEMEM_MODE env, so production rooms are unaffected.
  nodeMemRoomConfig: defineTable({
    roomId: v.id("rooms"),
    mode: v.union(v.literal("off"), v.literal("shadow"), v.literal("active_ab")),
    maxTokens: v.optional(v.number()),
    setBy: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Compiled entities extracted from episodes.
  nodeMemEntities: defineTable({
    roomId: v.optional(v.id("rooms")),
    workspaceId: v.optional(v.string()),
    kind: v.string(), // "company" | "person" | "concept" | ...
    canonicalName: v.string(),
    aliases: v.array(v.string()),
    summary: v.string(),
    confidence: v.number(),
    lastSeenAt: v.number(),
    sourceRefs: v.array(v.string()), // episode ids
  })
    .index("by_room", ["roomId"])
    .index("by_room_name", ["roomId", "canonicalName"]),

  // Compiled facts extracted from episodes.
  nodeMemFacts: defineTable({
    roomId: v.optional(v.id("rooms")),
    workspaceId: v.optional(v.string()),
    subjectEntityId: v.string(),
    predicate: v.string(),
    object: v.string(),
    status: v.string(), // "manual" | "source_backed" | "graph_inferred" | "needs_review" | "superseded" | "rejected"
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    evidenceFactIds: v.array(v.string()),
    episodeIds: v.array(v.string()),
    confidence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_entity", ["roomId", "subjectEntityId"])
    .index("by_status", ["status"]),

  // Assembled ContextPacks — stored for shadow mode analysis.
  nodeMemContextPacks: defineTable({
    roomId: v.optional(v.id("rooms")),
    jobId: v.optional(v.id("agentJobs")),
    packId: v.string(),
    goal: v.string(),
    taskKind: v.string(),
    packJson: v.string(), // serialized NodeMemContextPack
    tokenEstimate: v.number(),
    mode: v.string(), // "shadow" | "active_ab" | "full"
    injected: v.boolean(), // false in shadow mode, true in active_ab
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_job", ["jobId"])
    .index("by_pack_id", ["packId"])
    .index("by_mode", ["mode", "createdAt"]),

  // ─── Always-On Rooms — public, read-only, agent-maintained rooms ─────────
  // Flagship: "Expositio Pulse" (expositio.org/papers). v1 scan is DETERMINISTIC
  // (zero model calls); LLM enrichment is a later approval-gated mode. PII rule:
  // subscriber emails + token hashes live ONLY in publicRoomSubscriptions /
  // publicRoomOutbox and are never returned by public functions.
  publicRooms: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("paused")),
    mode: v.union(v.literal("monitor"), v.literal("digest")),
    timezone: v.string(),
    scanCadence: v.union(v.literal("daily"), v.literal("weekly")),
    monthlyCreditCap: v.number(),
    perRunCreditCap: v.number(),
    lastRunAt: v.optional(v.number()),
    lastRunStatus: v.optional(
      v.union(v.literal("ok"), v.literal("failed"), v.literal("capped"), v.literal("skipped")),
    ),
    lastMetric: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  publicRoomSources: defineTable({
    publicRoomId: v.id("publicRooms"),
    url: v.string(),
    allowedHost: v.string(), // must be in alwaysOnCore.ALLOWED_SOURCE_HOSTS; validated again before every fetch
    label: v.optional(v.string()),
    lastContentHash: v.optional(v.string()), // internal change detection — never exposed by public queries
    lastCheckedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("failed")),
  }).index("by_room", ["publicRoomId"]),

  // One row per room: the rendered public state. papers BOUNDED to 500 and
  // runlog BOUNDED to 60 newest on every write (alwaysOnShape bounds).
  publicRoomStates: defineTable({
    publicRoomId: v.id("publicRooms"),
    papers: v.array(
      v.object({
        title: v.string(),
        discipline: v.string(),
        topic: v.string(),
        difficulty: v.string(),
        status: v.union(v.literal("new"), v.literal("updated"), v.literal("tracked")),
        firstSeen: v.string(),
        evidenceRef: v.string(),
        href: v.optional(v.string()),
      }),
    ),
    briefMarkdown: v.string(),
    briefMeta: v.object({ title: v.string(), dateLine: v.string(), runNumber: v.number() }),
    runlog: v.array(
      v.object({
        at: v.string(),
        event: v.string(),
        meta: v.string(),
        status: v.union(v.literal("changed"), v.literal("ok"), v.literal("skipped"), v.literal("failed")),
        cost: v.string(),
      }),
    ),
    updatedAt: v.number(),
  }).index("by_room", ["publicRoomId"]),

  // Append-only run receipts — the proof footer's ground truth. HONEST_STATUS:
  // capped/failed/skipped are recorded as such, never dressed up as completed.
  publicRoomRuns: defineTable({
    publicRoomId: v.id("publicRooms"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("capped"),
      v.literal("skipped"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    sourcesChecked: v.number(),
    changedSources: v.number(),
    itemsCreated: v.number(),
    itemsUpdated: v.number(),
    creditsUsed: v.number(),
    error: v.optional(v.string()),
  }).index("by_room_started", ["publicRoomId", "startedAt"]),

  // Double opt-in subscriptions. Raw tokens are NEVER stored — only sha256
  // hashes; the raw confirm token travels in the confirmation email (draft-first
  // Gmail outbox). Caps enforced in mutations: 5000/room, 3 pending per (room,email).
  publicRoomSubscriptions: defineTable({
    publicRoomId: v.id("publicRooms"),
    email: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("act_now")),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("unsubscribed")),
    confirmTokenHash: v.string(),
    unsubTokenHash: v.string(),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_room", ["publicRoomId"])
    .index("by_room_email", ["publicRoomId", "email"])
    .index("by_confirm_token_hash", ["confirmTokenHash"])
    .index("by_unsub_token_hash", ["unsubTokenHash"]),

  // Draft-first email outbox. state machine = alwaysOnCore.OUTBOX_STATES via
  // canTransition; idempotencyKey (roomSlug:briefKey:subscriptionId:cadence)
  // dedupes enqueues so a re-run never double-sends.
  publicRoomOutbox: defineTable({
    publicRoomId: v.id("publicRooms"),
    subscriptionId: v.id("publicRoomSubscriptions"),
    briefKey: v.string(),
    subject: v.string(),
    markdownBody: v.string(),
    idempotencyKey: v.string(),
    state: v.union(
      v.literal("pending_draft"),
      v.literal("draft_created"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_room_state", ["publicRoomId", "state"]),

  // Watches + notifications (design: instant = mentions/watched rows; hourly = run digests; daily = rest).
  watches: watchesTable,
  notificationEvents: notificationEventsTable,
});
