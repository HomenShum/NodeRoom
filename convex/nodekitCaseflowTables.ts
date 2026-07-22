import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Host-owned relationships only. The installed NodeKit component owns cases,
 * runs, stages, versions, proposals, approvals, exceptions, events, and
 * receipts in its isolated component database.
 */
export const nodekitCaseflowBindingTables = {
  nodekitCaseflowBindings: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: v.id("members"),
    scopeKey: v.string(),
    caseId: v.string(),
    currentRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"]),

  nodekitCaseflowRunBindings: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: v.id("members"),
    scopeKey: v.string(),
    caseId: v.string(),
    runId: v.string(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_case", ["caseId", "createdAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"]),

  nodekitCaseflowArtifactBindings: defineTable({
    roomId: v.id("rooms"),
    ownerMemberId: v.id("members"),
    scopeKey: v.string(),
    caseId: v.string(),
    runId: v.string(),
    componentArtifactId: v.string(),
    nodeRoomArtifactId: v.id("artifacts"),
    canonicalElementId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_component_artifact", ["componentArtifactId"])
    .index("by_case", ["caseId", "createdAt"])
    .index("by_run", ["runId", "createdAt"])
    .index("by_room_owner", ["roomId", "ownerMemberId", "createdAt"])
    .index("by_node_room_artifact", ["nodeRoomArtifactId"]),
};
