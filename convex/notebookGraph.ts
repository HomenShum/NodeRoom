import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";
import { enqueueEmbeddingJob, sha256hex } from "./embeddings";
import { enqueueRoomActivity } from "./roomActivity";

const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const nodeKindV = v.union(
  v.literal("note"),
  v.literal("folder"),
  v.literal("wiki_ref"),
  v.literal("artifact_ref"),
  v.literal("source"),
  v.literal("claim"),
  v.literal("task"),
  v.literal("agent_summary"),
);
const contentFormatV = v.union(v.literal("plain"), v.literal("markdown"), v.literal("lexical"), v.literal("json"));
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
const listTypeV = v.union(v.literal("all"), v.literal("note_content"), v.literal("pinned"), v.literal("pointer"), v.literal("outline"));

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

function positionKey() {
  return `${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
}

function nodeText(node: { title?: string; content: string }) {
  return `${node.title ?? ""}\n${node.content}`;
}

async function requireJobInRoom(ctx: MutationCtx, roomId: Id<"rooms">, jobId?: Id<"agentJobs">) {
  if (!jobId) return null;
  const job = await ctx.db.get(jobId);
  if (!job || String(job.roomId) !== String(roomId)) throw new Error("job_room_mismatch");
  return job;
}

async function insertReceipt(ctx: MutationCtx, args: {
  jobId?: Id<"agentJobs">;
  roomId: Id<"rooms">;
  mutationName: string;
  input: unknown;
  output: unknown;
  affectedIds: string[];
  beforeVersions?: unknown;
  afterVersions?: unknown;
}) {
  const job = await requireJobInRoom(ctx, args.roomId, args.jobId);
  if (!args.jobId || !job) return undefined;
  const receiptId = await ctx.db.insert("agentMutationReceipts", clean({
    jobId: args.jobId,
    mutationName: args.mutationName,
    permission: "actor_proof",
    inputHash: await sha256hex(JSON.stringify(args.input)),
    output: args.output,
    affectedIds: args.affectedIds,
    beforeVersions: args.beforeVersions,
    afterVersions: args.afterVersions,
    createdAt: Date.now(),
  }));
  await ctx.db.patch(args.jobId, {
    mutationCount: (job.mutationCount ?? 0) + 1,
    receiptCount: (job.receiptCount ?? 0) + 1,
    updatedAt: Date.now(),
  });
  return receiptId;
}

async function enqueueNodeEmbedding(ctx: MutationCtx, roomId: Id<"rooms">, nodeId: Id<"nodes">, node: { title?: string; content: string }, jobId?: Id<"agentJobs">) {
  await enqueueEmbeddingJob(ctx, { roomId, sourceKind: "node", sourceId: String(nodeId), content: nodeText(node), jobId });
  await ctx.scheduler.runAfter(0, internal.embeddingRunner.runOne, {});
}

export const createNotebook = mutation({
  args: {
    roomId: v.id("rooms"),
    title: v.string(),
    requester: actorProofV,
    visibility: v.optional(visibilityV),
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    await requireJobInRoom(ctx, a.roomId, a.jobId);
    const now = Date.now();
    const visibility = a.visibility ?? "room";
    const notebookId = await ctx.db.insert("notebooks", {
      roomId: a.roomId,
      title: a.title,
      ownerId: actor.id,
      visibility,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const relationTypeId = await ctx.db.insert("relationTypes", {
      roomId: a.roomId,
      notebookId,
      key: "contains",
      label: "contains",
      reverseLabel: "belongs to",
      visibility,
      isSystem: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const rootNodeId = await ctx.db.insert("nodes", {
      roomId: a.roomId,
      notebookId,
      authorId: actor.id,
      kind: "folder",
      title: a.title,
      content: "",
      contentFormat: "plain",
      visibility,
      version: 1,
      isDeleted: false,
      createdByJobId: a.jobId,
      updatedByJobId: a.jobId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(notebookId, { rootNodeId, defaultRelationTypeId: relationTypeId, updatedAt: now });
    await insertReceipt(ctx, {
      jobId: a.jobId,
      roomId: a.roomId,
      mutationName: "notebookGraph.createNotebook",
      input: { title: a.title, visibility },
      output: { notebookId, rootNodeId, relationTypeId },
      affectedIds: [String(notebookId), String(rootNodeId), String(relationTypeId)],
      afterVersions: { notebook: 1, rootNode: 1 },
    });
    await enqueueNodeEmbedding(ctx, a.roomId, rootNodeId, { title: a.title, content: "" }, a.jobId);
    return { notebookId, rootNodeId, relationTypeId };
  },
});

export const readContext = query({
  args: { notebookId: v.id("notebooks"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { notebookId, requester, limit }) => {
    const notebook = await ctx.db.get(notebookId);
    if (!notebook) return null;
    await requireActorProof(ctx, notebook.roomId, requester);
    const capped = Math.max(1, Math.min(limit ?? 100, 250));
    const nodes = (await ctx.db.query("nodes").withIndex("by_notebook", (q) => q.eq("notebookId", notebookId)).take(capped)).filter((node) => !node.isDeleted);
    const relations = (await ctx.db.query("relations").withIndex("by_notebook", (q) => q.eq("notebookId", notebookId)).take(capped)).filter((rel) => !rel.isDeleted);
    const relationTypes = await ctx.db.query("relationTypes").withIndex("by_notebook_key", (q) => q.eq("notebookId", notebookId)).take(50);
    return { notebook, nodes, relations, relationTypes };
  },
});

export const createChildNode = mutation({
  args: {
    notebookId: v.id("notebooks"),
    parentId: v.id("nodes"),
    requester: actorProofV,
    title: v.optional(v.string()),
    content: v.string(),
    kind: v.optional(nodeKindV),
    contentFormat: v.optional(contentFormatV),
    visibility: v.optional(visibilityV),
    relationTypeId: v.optional(v.id("relationTypes")),
    listType: v.optional(listTypeV),
    expectedParentVersion: v.optional(v.number()),
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    const notebook = await ctx.db.get(a.notebookId);
    const parent = await ctx.db.get(a.parentId);
    if (!notebook || !parent || String(parent.notebookId) !== String(a.notebookId) || parent.isDeleted) throw new Error("notebook_parent_mismatch");
    const actor = await requireActorProof(ctx, notebook.roomId, a.requester);
    await requireJobInRoom(ctx, notebook.roomId, a.jobId);
    if (a.expectedParentVersion !== undefined && parent.version !== a.expectedParentVersion) throw new Error("parent_version_conflict");
    const relationTypeId = a.relationTypeId ?? notebook.defaultRelationTypeId;
    if (!relationTypeId) throw new Error("relation_type_missing");
    const relationType = await ctx.db.get(relationTypeId);
    if (!relationType || String(relationType.roomId) !== String(notebook.roomId)) throw new Error("relation_type_mismatch");
    const now = Date.now();
    const visibility = a.visibility ?? parent.visibility;
    const nodeId = await ctx.db.insert("nodes", {
      roomId: notebook.roomId,
      notebookId: a.notebookId,
      authorId: actor.id,
      kind: a.kind ?? "note",
      title: a.title,
      content: a.content,
      contentFormat: a.contentFormat ?? "markdown",
      visibility,
      version: 1,
      isDeleted: false,
      createdByJobId: a.jobId,
      updatedByJobId: a.jobId,
      createdAt: now,
      updatedAt: now,
    });
    const relationId = await ctx.db.insert("relations", {
      roomId: notebook.roomId,
      notebookId: a.notebookId,
      fromObjectKind: "node",
      fromId: String(parent._id),
      toObjectKind: "node",
      toId: String(nodeId),
      relationTypeId,
      authorId: actor.id,
      visibility,
      version: 1,
      isDeleted: false,
      positionKey: positionKey(),
      listType: a.listType ?? "note_content",
      createdByJobId: a.jobId,
      updatedByJobId: a.jobId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(parent._id, { version: parent.version + 1, updatedAt: now, updatedByJobId: a.jobId });
    await ctx.db.patch(a.notebookId, { version: notebook.version + 1, updatedAt: now });
    await insertReceipt(ctx, {
      jobId: a.jobId,
      roomId: notebook.roomId,
      mutationName: "notebookGraph.createChildNode",
      input: { parentId: String(a.parentId), title: a.title, kind: a.kind ?? "note" },
      output: { nodeId, relationId },
      affectedIds: [String(parent._id), String(nodeId), String(relationId)],
      beforeVersions: { parent: parent.version, notebook: notebook.version },
      afterVersions: { parent: parent.version + 1, child: 1, relation: 1, notebook: notebook.version + 1 },
    });
    await enqueueNodeEmbedding(ctx, notebook.roomId, nodeId, { title: a.title, content: a.content }, a.jobId);
    await enqueueRoomActivity(ctx, {
      roomId: notebook.roomId,
      sourceKind: "node",
      sourceId: String(nodeId),
      sourceVersion: 1,
      sourceHash: await sha256hex(nodeText({ title: a.title, content: a.content })),
      eventKind: "content_committed",
      actor,
      visibility,
      ownerId: visibility === "private" ? actor.id : undefined,
    });
    return { nodeId, relationId };
  },
});

export const updateNodeContent = mutation({
  args: {
    nodeId: v.id("nodes"),
    requester: actorProofV,
    title: v.optional(v.string()),
    content: v.string(),
    contentFormat: v.optional(contentFormatV),
    expectedVersion: v.number(),
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    const node = await ctx.db.get(a.nodeId);
    if (!node || node.isDeleted) throw new Error("node_not_found");
    const actor = await requireActorProof(ctx, node.roomId, a.requester);
    await requireJobInRoom(ctx, node.roomId, a.jobId);
    if (node.version !== a.expectedVersion) throw new Error("node_version_conflict");
    const now = Date.now();
    const nextVersion = node.version + 1;
    await ctx.db.patch(a.nodeId, clean({
      title: a.title,
      content: a.content,
      contentFormat: a.contentFormat,
      version: nextVersion,
      updatedByJobId: a.jobId,
      updatedAt: now,
    }));
    await insertReceipt(ctx, {
      jobId: a.jobId,
      roomId: node.roomId,
      mutationName: "notebookGraph.updateNodeContent",
      input: { nodeId: String(a.nodeId), expectedVersion: a.expectedVersion },
      output: { ok: true, version: nextVersion },
      affectedIds: [String(a.nodeId)],
      beforeVersions: { node: node.version },
      afterVersions: { node: nextVersion },
    });
    await enqueueNodeEmbedding(ctx, node.roomId, a.nodeId, { title: a.title ?? node.title, content: a.content }, a.jobId);
    await enqueueRoomActivity(ctx, {
      roomId: node.roomId,
      sourceKind: "node",
      sourceId: String(a.nodeId),
      sourceVersion: nextVersion,
      sourceHash: await sha256hex(nodeText({ title: a.title ?? node.title, content: a.content })),
      eventKind: "idle_after_typing",
      actor,
      visibility: node.visibility,
      ownerId: node.visibility === "private" ? actor.id : undefined,
    });
    return { ok: true as const, version: nextVersion };
  },
});

export const createRelation = mutation({
  args: {
    notebookId: v.id("notebooks"),
    requester: actorProofV,
    fromObjectKind: graphObjectKindV,
    fromId: v.string(),
    toObjectKind: graphObjectKindV,
    toId: v.string(),
    relationTypeId: v.id("relationTypes"),
    visibility: v.optional(visibilityV),
    listType: v.optional(listTypeV),
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    const notebook = await ctx.db.get(a.notebookId);
    const relationType = await ctx.db.get(a.relationTypeId);
    if (!notebook || !relationType || String(relationType.roomId) !== String(notebook.roomId)) throw new Error("relation_notebook_mismatch");
    const actor = await requireActorProof(ctx, notebook.roomId, a.requester);
    await requireJobInRoom(ctx, notebook.roomId, a.jobId);
    const now = Date.now();
    const relationId = await ctx.db.insert("relations", {
      roomId: notebook.roomId,
      notebookId: a.notebookId,
      fromObjectKind: a.fromObjectKind,
      fromId: a.fromId,
      toObjectKind: a.toObjectKind,
      toId: a.toId,
      relationTypeId: a.relationTypeId,
      authorId: actor.id,
      visibility: a.visibility ?? notebook.visibility,
      version: 1,
      isDeleted: false,
      positionKey: positionKey(),
      listType: a.listType ?? "all",
      createdByJobId: a.jobId,
      updatedByJobId: a.jobId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(a.notebookId, { version: notebook.version + 1, updatedAt: now });
    await insertReceipt(ctx, {
      jobId: a.jobId,
      roomId: notebook.roomId,
      mutationName: "notebookGraph.createRelation",
      input: { fromObjectKind: a.fromObjectKind, fromId: a.fromId, toObjectKind: a.toObjectKind, toId: a.toId },
      output: { relationId },
      affectedIds: [String(relationId), a.fromId, a.toId],
      beforeVersions: { notebook: notebook.version },
      afterVersions: { relation: 1, notebook: notebook.version + 1 },
    });
    return { relationId };
  },
});

export const reorderRelations = mutation({
  args: {
    notebookId: v.id("notebooks"),
    requester: actorProofV,
    expectedNotebookVersion: v.number(),
    relationPositions: v.array(v.object({ relationId: v.id("relations"), positionKey: v.string() })),
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    const notebook = await ctx.db.get(a.notebookId);
    if (!notebook) throw new Error("notebook_not_found");
    await requireActorProof(ctx, notebook.roomId, a.requester);
    await requireJobInRoom(ctx, notebook.roomId, a.jobId);
    if (notebook.version !== a.expectedNotebookVersion) throw new Error("notebook_version_conflict");
    const now = Date.now();
    const changed: string[] = [];
    for (const item of a.relationPositions) {
      const relation = await ctx.db.get(item.relationId);
      if (!relation || String(relation.notebookId) !== String(a.notebookId)) throw new Error("relation_notebook_mismatch");
      await ctx.db.patch(item.relationId, { positionKey: item.positionKey, version: relation.version + 1, updatedByJobId: a.jobId, updatedAt: now });
      changed.push(String(item.relationId));
    }
    await ctx.db.patch(a.notebookId, { version: notebook.version + 1, updatedAt: now });
    await insertReceipt(ctx, {
      jobId: a.jobId,
      roomId: notebook.roomId,
      mutationName: "notebookGraph.reorderRelations",
      input: { relationPositions: a.relationPositions.map((p) => ({ relationId: String(p.relationId), positionKey: p.positionKey })) },
      output: { changed: changed.length },
      affectedIds: [String(a.notebookId), ...changed],
      beforeVersions: { notebook: notebook.version },
      afterVersions: { notebook: notebook.version + 1 },
    });
    return { changed: changed.length, version: notebook.version + 1 };
  },
});
