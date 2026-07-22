import { defineTable } from "convex/server";
import { v } from "convex/values";

const ownerIdV = v.id("members");
const stageOwnerV = v.string();
const stageStatusV = v.union(v.literal("pending"), v.literal("active"), v.literal("completed"));
const runStatusV = v.union(
  v.literal("active"),
  v.literal("blocked"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("failed_safely"),
);

/**
 * Isolated lifecycle rows used by the NodeKit Caseflow adapter. NodeRoom keeps
 * ownership of authentication, rooms, jobs, artifacts, elements, traces, and
 * domain receipts; these rows only normalize the portable lifecycle around
 * those application records.
 */
export const nodekitCaseflowTables = {
  nodekitCaseflowCases: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    schemaVersion: v.string(),
    title: v.string(),
    primaryJob: v.string(),
    status: v.union(
      v.literal("ready"),
      v.literal("in_progress"),
      v.literal("cancelled"),
      v.literal("completed"),
      v.literal("failed_safely"),
    ),
    currentRunId: v.optional(v.id("nodekitCaseflowRuns")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"])
    .index("by_owner", ["ownerMemberId", "createdAt"]),

  nodekitCaseflowRuns: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    caseId: v.id("nodekitCaseflowCases"),
    schemaVersion: v.string(),
    status: runStatusV,
    stages: v.array(v.object({
      id: v.string(),
      label: v.string(),
      owner: stageOwnerV,
      status: stageStatusV,
    })),
    currentStageId: v.string(),
    nextAction: v.string(),
    nextActionOwner: stageOwnerV,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId", "createdAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"]),

  nodekitCaseflowArtifacts: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    caseId: v.id("nodekitCaseflowCases"),
    runId: v.id("nodekitCaseflowRuns"),
    /** The real NodeRoom/NodeSheet artifact remains the canonical app record. */
    nodeRoomArtifactId: v.id("artifacts"),
    canonicalElementId: v.string(),
    schemaVersion: v.string(),
    kind: v.string(),
    title: v.string(),
    canonicalVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId", "createdAt"])
    .index("by_run", ["runId", "createdAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"])
    .index("by_node_room_artifact", ["nodeRoomArtifactId"]),

  nodekitCaseflowArtifactVersions: defineTable({
    artifactId: v.id("nodekitCaseflowArtifacts"),
    version: v.number(),
    content: v.any(),
    contentHash: v.string(),
    proposalId: v.optional(v.id("nodekitCaseflowProposals")),
    createdAt: v.number(),
  }).index("by_artifact_version", ["artifactId", "version"]),

  nodekitCaseflowProposals: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    artifactId: v.id("nodekitCaseflowArtifacts"),
    schemaVersion: v.string(),
    baseVersion: v.number(),
    patch: v.any(),
    patchHash: v.string(),
    rationale: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("conflicted"),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_artifact", ["artifactId", "createdAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"]),

  nodekitCaseflowApprovals: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    proposalId: v.id("nodekitCaseflowProposals"),
    schemaVersion: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    comment: v.string(),
    decidedAt: v.number(),
  }).index("by_proposal", ["proposalId"]),

  nodekitCaseflowExceptions: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    runId: v.id("nodekitCaseflowRuns"),
    schemaVersion: v.string(),
    code: v.string(),
    message: v.string(),
    preservedState: v.any(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    resolution: v.optional(v.string()),
    raisedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_run_status", ["runId", "status", "raisedAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "raisedAt"]),

  nodekitCaseflowEvents: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    runId: v.optional(v.id("nodekitCaseflowRuns")),
    schemaVersion: v.string(),
    aggregateType: v.string(),
    aggregateId: v.string(),
    eventType: v.string(),
    sequence: v.number(),
    payload: v.any(),
    occurredAt: v.number(),
  })
    .index("by_aggregate_sequence", ["aggregateId", "sequence"])
    .index("by_run", ["runId", "occurredAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "occurredAt"]),

  nodekitCaseflowReceipts: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: ownerIdV,
    runId: v.id("nodekitCaseflowRuns"),
    schemaVersion: v.string(),
    /** Exact canonical body hashed into receiptHash. */
    body: v.any(),
    receiptHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"]),
};
