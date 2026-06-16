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
);
const agentScopeV = v.union(v.literal("public_room"), v.literal("private_user"), v.literal("team"));
const approvalPolicyV = v.union(v.literal("read_only"), v.literal("draft_first"), v.literal("auto_commit_safe"), v.literal("host_review"));
const evidencePolicyV = v.union(v.literal("public_only"), v.literal("private_allowed"), v.literal("mixed_requires_redaction"));
const traceLevelV = v.union(v.literal("summary"), v.literal("standard"), v.literal("full_operation_ledger"));
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
const graphObjectKindV = v.union(
  v.literal("notebook"),
  v.literal("node"),
  v.literal("relation"),
  v.literal("artifact"),
  v.literal("element"),
  v.literal("range"),
  v.literal("wiki_page"),
  v.literal("wiki_block"),
);
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const okfVisibilityV = v.union(v.literal("public"), v.literal("private"), v.literal("redacted"));

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

  /** Server-side metadata for a private NodeAgent reply stream. The prompt + room context are
   *  captured AT CREATE TIME inside the authenticated mutation, so the public streaming
   *  httpAction needs nothing but the unguessable streamId. Never returned to clients. */
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

  /** Per-agent-run telemetry — model, steps, tool calls, tokens, cost, latency. */
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
    idempotencyKey: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
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
    attempt: v.number(),
    status: v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("failed")),
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
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
});
