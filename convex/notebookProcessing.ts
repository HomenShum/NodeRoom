import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorInRoom, requireActorProof, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";
import { activityDedupeKey, classifyNoteworthy } from "./roomActivity";

const NOTEBOOK_ELEMENT_ID = "doc";
const DEFAULT_DIRTY_QUIET_MS = 12_000;
const MAX_DIRTY_WAIT_MS = 60_000;
const PROCESSOR_VERSION = "notebook-read-model-v2";
const READ_MODEL_SCHEMA_VERSION = "notebook-read-model-schema-v1";
const LEAF_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
const CONTAINER_TYPES = new Set(["listItem", "blockquote", "bulletList", "orderedList"]);

const laneV = v.union(v.literal("passive"), v.literal("coach"), v.literal("index"));
const blockArgV = v.object({
  blockId: v.string(),
  blockIndex: v.number(),
  blockType: v.string(),
  text: v.string(),
  textHash: v.string(),
});
const claimArgV = v.object({
  claimId: v.string(),
  blockId: v.string(),
  text: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
});
const mentionArgV = v.object({
  mentionId: v.string(),
  blockId: v.string(),
  entityType: v.union(v.literal("company"), v.literal("person"), v.literal("product"), v.literal("source"), v.literal("metric"), v.literal("unknown")),
  displayName: v.string(),
  entityKey: v.string(),
});

type DbCtx = QueryCtx | MutationCtx;
type Visibility = "private" | "room" | "public";
type Lane = "passive" | "coach" | "index";
type NotebookBlockInput = {
  blockId: string;
  blockIndex: number;
  blockType: string;
  text: string;
  textHash: string;
};
type NotebookClaimInput = {
  claimId: string;
  blockId: string;
  text: string;
  confidence: "high" | "medium" | "low";
};
type NotebookMentionInput = {
  mentionId: string;
  blockId: string;
  entityType: "company" | "person" | "product" | "source" | "metric" | "unknown";
  displayName: string;
  entityKey: string;
};
type ClaimNotebookDirtyEventResult = {
  processingJobId: Id<"notebookProcessingJobs">;
  prosemirrorDocId: string;
} | null;
type CommitNotebookReadModelResult = {
  blockCount: number;
  claimCount: number;
  mentionCount: number;
  passiveOutboxId?: string;
  passiveStatus: "noteworthy" | "not_noteworthy";
};
type ProcessNotebookDirtyEventResult =
  | ({ ok: true } & CommitNotebookReadModelResult)
  | { ok: false; reason: string };

function actorOwnsArtifact(a: { createdBy?: ActorValue }, actor: ActorValue): boolean {
  if (!a.createdBy) return false;
  if (a.createdBy.kind === actor.kind && a.createdBy.id === actor.id) return true;
  return actor.kind === "agent" && actor.scope === "private" && !!actor.ownerId && a.createdBy.kind === "user" && a.createdBy.id === actor.ownerId;
}

function canReadArtifact(a: { visibility?: Visibility; createdBy?: ActorValue }, actor: ActorValue): boolean {
  return (a.visibility ?? "room") !== "private" || actorOwnsArtifact(a, actor);
}

function ownerIdForArtifact(artifact: { visibility?: Visibility; createdBy?: ActorValue }, actor: ActorValue): string | undefined {
  if ((artifact.visibility ?? "room") !== "private") return undefined;
  return artifact.createdBy?.kind === "user" ? artifact.createdBy.id : actor.id;
}

function actorOwnerId(actor: ActorValue): string {
  return actor.kind === "agent" && actor.scope === "private" && actor.ownerId ? actor.ownerId : actor.id;
}

function clampQuietMs(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_DIRTY_QUIET_MS)) return DEFAULT_DIRTY_QUIET_MS;
  return Math.max(1_000, Math.min(value ?? DEFAULT_DIRTY_QUIET_MS, MAX_DIRTY_WAIT_MS));
}

async function notebookDocumentForArtifact(ctx: DbCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts">) {
  const row = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_room_artifact_element", (q) =>
      q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
    .unique();
  if (!row) throw new Error("notebook_doc_not_registered");
  return row;
}

export const markNotebookDirty = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    observedSnapshotVersion: v.optional(v.number()),
    observedSnapshotHash: v.optional(v.string()),
    changedRangeHint: v.optional(v.string()),
    processingLane: v.optional(laneV),
    quietMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const artifact = await requireArtifactInRoom(ctx, args.roomId, args.artifactId);
    if (artifact.kind !== "note") throw new Error("artifact_not_notebook");
    if (!canReadArtifact(artifact, actor)) throw new Error("artifact_not_visible");

    const doc = await notebookDocumentForArtifact(ctx, args.roomId, args.artifactId);
    const now = Date.now();
    const lane: Lane = args.processingLane ?? "passive";
    const visibility = (artifact.visibility ?? doc.visibility ?? "room") as Visibility;
    const ownerId = visibility === "private" ? ownerIdForArtifact(artifact, actor) : undefined;
    if (visibility === "private" && ownerId !== actor.id) throw new Error("notebook_dirty_private_owner_mismatch");
    if (doc.visibility !== visibility || doc.ownerId !== ownerId) {
      await ctx.db.patch(doc._id, { visibility, ownerId, updatedAt: now });
    }

    const existing = await ctx.db
      .query("notebookDirtyEvents")
      .withIndex("by_doc_actor_lane_state", (q) =>
        q.eq("prosemirrorDocId", doc.prosemirrorDocId).eq("actorId", actor.id).eq("processingLane", lane).eq("state", "pending"))
      .order("desc")
      .first();
    const quietMs = clampQuietMs(args.quietMs);
    const maxWaitAt = existing?.maxWaitAt ?? now + MAX_DIRTY_WAIT_MS;
    const delay = Math.max(0, Math.min(quietMs, maxWaitAt - now));
    const quietUntil = now + delay;
    const patch = {
      observedSnapshotVersion: args.observedSnapshotVersion ?? doc.latestIndexedVersion,
      observedSnapshotHash: args.observedSnapshotHash ?? doc.latestSnapshotHash,
      changedRangeHint: args.changedRangeHint,
      visibility,
      ownerId,
      quietUntil,
      maxWaitAt,
      updatedAt: now,
    };
    const dirtyEventId = existing
      ? (await ctx.db.patch(existing._id, patch), existing._id)
      : await ctx.db.insert("notebookDirtyEvents", {
          roomId: args.roomId,
          artifactId: args.artifactId,
          notebookDocumentId: doc._id,
          prosemirrorDocId: doc.prosemirrorDocId,
          actor,
          actorId: actor.id,
          visibility,
          ownerId,
          observedSnapshotVersion: args.observedSnapshotVersion ?? doc.latestIndexedVersion,
          observedSnapshotHash: args.observedSnapshotHash ?? doc.latestSnapshotHash,
          changedRangeHint: args.changedRangeHint,
          processingLane: lane,
          state: "pending",
          dirtyAt: now,
          quietUntil,
          maxWaitAt,
          createdAt: now,
          updatedAt: now,
        });

    await ctx.scheduler.runAfter(delay, internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId });
    return { dirtyEventId, reused: !!existing, scheduledAfterMs: delay };
  },
});

export const processNotebookDirtyEvent = internalAction({
  args: { dirtyEventId: v.id("notebookDirtyEvents") },
  handler: async (ctx, { dirtyEventId }): Promise<ProcessNotebookDirtyEventResult> => {
    const claimed = await ctx.runMutation(
      internal.notebookProcessing.claimNotebookDirtyEvent,
      { dirtyEventId },
    ) as ClaimNotebookDirtyEventResult;
    if (!claimed) return { ok: false as const, reason: "not_claimed" as const };
    try {
      const snapshot = await ctx.runQuery(components.prosemirrorSync.lib.getSnapshot, { id: claimed.prosemirrorDocId });
      if (!snapshot.content || typeof snapshot.version !== "number") throw new Error("snapshot_not_found");
      const snapshotHash = await sha256Hex(snapshot.content);
      const extracted = await extractReadModel(snapshot.content);
      const committed = await ctx.runMutation(
        internal.notebookProcessing.commitNotebookReadModel,
        {
          dirtyEventId,
          processingJobId: claimed.processingJobId,
          sourceSnapshotVersion: snapshot.version,
          sourceSnapshotHash: snapshotHash,
          blocks: extracted.blocks,
          claims: extracted.claims,
          mentions: extracted.mentions,
        },
      ) as CommitNotebookReadModelResult;
      return { ok: true as const, ...committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.notebookProcessing.failNotebookProcessingJob, {
        dirtyEventId,
        processingJobId: claimed.processingJobId,
        error: message.slice(0, 1_000),
      });
      return { ok: false as const, reason: message.slice(0, 1_000) };
    }
  },
});

export const claimNotebookDirtyEvent = internalMutation({
  args: { dirtyEventId: v.id("notebookDirtyEvents") },
  handler: async (ctx, { dirtyEventId }) => {
    const event = await ctx.db.get(dirtyEventId);
    if (!event || event.state !== "pending") return null;
    const now = Date.now();
    if (event.quietUntil !== undefined && event.quietUntil > now && event.maxWaitAt > now) {
      return null;
    }
    const doc = await ctx.db.get(event.notebookDocumentId);
    if (!doc || doc.prosemirrorDocId !== event.prosemirrorDocId) {
      await ctx.db.patch(dirtyEventId, { state: "failed", error: "notebook_doc_missing", updatedAt: Date.now() });
      return null;
    }
    const artifact = await requireArtifactInRoom(ctx, event.roomId, event.artifactId);
    try {
      await requireActorInRoom(ctx, event.roomId, event.actor);
    } catch (error) {
      await ctx.db.patch(dirtyEventId, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
      return null;
    }
    if (!canReadArtifact(artifact, event.actor)) {
      await ctx.db.patch(dirtyEventId, { state: "failed", error: "artifact_not_visible", updatedAt: Date.now() });
      return null;
    }
    if (event.visibility === "private" && event.ownerId !== actorOwnerId(event.actor)) {
      await ctx.db.patch(dirtyEventId, { state: "failed", error: "private_owner_mismatch", updatedAt: Date.now() });
      return null;
    }
    const processingJobId = await ctx.db.insert("notebookProcessingJobs", {
      dirtyEventId,
      roomId: event.roomId,
      artifactId: event.artifactId,
      prosemirrorDocId: event.prosemirrorDocId,
      actorId: event.actorId,
      visibility: event.visibility,
      ownerId: event.ownerId,
      docVersion: event.observedSnapshotVersion,
      docHash: event.observedSnapshotHash,
      processorVersion: PROCESSOR_VERSION,
      schemaVersion: READ_MODEL_SCHEMA_VERSION,
      status: "running",
      startedAt: now,
    });
    await ctx.db.patch(dirtyEventId, {
      state: "processing",
      latestProcessingJobId: processingJobId,
      updatedAt: now,
    });
    return {
      processingJobId,
      prosemirrorDocId: event.prosemirrorDocId,
    };
  },
});

export const commitNotebookReadModel = internalMutation({
  args: {
    dirtyEventId: v.id("notebookDirtyEvents"),
    processingJobId: v.id("notebookProcessingJobs"),
    sourceSnapshotVersion: v.number(),
    sourceSnapshotHash: v.string(),
    blocks: v.array(blockArgV),
    claims: v.array(claimArgV),
    mentions: v.array(mentionArgV),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.dirtyEventId);
    const job = await ctx.db.get(args.processingJobId);
    if (!event || !job || String(job.dirtyEventId) !== String(args.dirtyEventId)) throw new Error("processing_job_mismatch");
    const now = Date.now();
    await replaceCurrentReadModelRows(ctx, event.artifactId);

    for (const block of args.blocks) {
      await ctx.db.insert("notebookBlocks", {
        roomId: event.roomId,
        artifactId: event.artifactId,
        dirtyEventId: args.dirtyEventId,
        processingJobId: args.processingJobId,
        prosemirrorDocId: event.prosemirrorDocId,
        blockId: block.blockId,
        blockIndex: block.blockIndex,
        blockType: block.blockType,
        text: block.text,
        textHash: block.textHash,
        sourceSnapshotVersion: args.sourceSnapshotVersion,
        sourceSnapshotHash: args.sourceSnapshotHash,
        visibility: event.visibility,
        ownerId: event.ownerId,
        actorId: event.actorId,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const claim of args.claims) {
      await ctx.db.insert("notebookClaims", {
        roomId: event.roomId,
        artifactId: event.artifactId,
        dirtyEventId: args.dirtyEventId,
        processingJobId: args.processingJobId,
        claimId: claim.claimId,
        blockId: claim.blockId,
        text: claim.text,
        confidence: claim.confidence,
        sourceSnapshotVersion: args.sourceSnapshotVersion,
        sourceSnapshotHash: args.sourceSnapshotHash,
        visibility: event.visibility,
        ownerId: event.ownerId,
        actorId: event.actorId,
        createdAt: now,
      });
    }
    for (const mention of args.mentions) {
      await ctx.db.insert("notebookMentions", {
        roomId: event.roomId,
        artifactId: event.artifactId,
        dirtyEventId: args.dirtyEventId,
        processingJobId: args.processingJobId,
        mentionId: mention.mentionId,
        blockId: mention.blockId,
        entityType: mention.entityType,
        displayName: mention.displayName,
        entityKey: mention.entityKey,
        sourceSnapshotVersion: args.sourceSnapshotVersion,
        sourceSnapshotHash: args.sourceSnapshotHash,
        visibility: event.visibility,
        ownerId: event.ownerId,
        actorId: event.actorId,
        createdAt: now,
      });
    }
    const passive = await upsertPassiveItemFromReadModel(ctx, event, args.blocks, args.sourceSnapshotVersion, args.sourceSnapshotHash, now);
    const resultSummary = {
      blockCount: args.blocks.length,
      claimCount: args.claims.length,
      mentionCount: args.mentions.length,
      passiveOutboxId: passive.outboxId ? String(passive.outboxId) : undefined,
      passiveStatus: passive.status,
    };
    await ctx.db.patch(args.processingJobId, {
      status: "completed",
      docVersion: args.sourceSnapshotVersion,
      docHash: args.sourceSnapshotHash,
      resultSummary,
      completedAt: now,
    });
    await ctx.db.patch(args.dirtyEventId, {
      state: "processed",
      processedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("traces", {
      roomId: event.roomId,
      ts: now,
      actor: event.actor,
      type: "notebook_read_model",
      summary: `Notebook read model updated: ${args.blocks.length} block${args.blocks.length === 1 ? "" : "s"}`,
      detail: `mark_notebook_dirty -> process_notebook_dirty_event - snapshot=${args.sourceSnapshotVersion} - claims=${args.claims.length} - mentions=${args.mentions.length} - status=${passive.status}`,
    });
    return resultSummary;
  },
});

export const failNotebookProcessingJob = internalMutation({
  args: {
    dirtyEventId: v.id("notebookDirtyEvents"),
    processingJobId: v.id("notebookProcessingJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.processingJobId, { status: "failed", error: args.error, completedAt: now });
    await ctx.db.patch(args.dirtyEventId, { state: "failed", error: args.error, updatedAt: now });
    return { ok: true };
  },
});

export const listNotebookBlocks = query({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, artifactId, requester, limit }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
    if (!canReadArtifact(artifact, actor)) return [];
    const rows = await ctx.db
      .query("notebookBlocks")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .take(Math.max(1, Math.min(limit ?? 100, 500)));
    return rows.filter((row) => row.visibility !== "private" || row.ownerId === actor.id);
  },
});

async function replaceCurrentReadModelRows(ctx: MutationCtx, artifactId: Id<"artifacts">) {
  const [blocks, claims, mentions] = await Promise.all([
    ctx.db.query("notebookBlocks").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect(),
    ctx.db.query("notebookClaims").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect(),
    ctx.db.query("notebookMentions").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect(),
  ]);
  for (const row of blocks) await ctx.db.delete(row._id);
  for (const row of claims) await ctx.db.delete(row._id);
  for (const row of mentions) await ctx.db.delete(row._id);
}

async function upsertPassiveItemFromReadModel(
  ctx: MutationCtx,
  event: {
    _id: Id<"notebookDirtyEvents">;
    roomId: Id<"rooms">;
    artifactId: Id<"artifacts">;
    actor: ActorValue;
    visibility: Visibility;
    ownerId?: string;
  },
  blocks: NotebookBlockInput[],
  sourceSnapshotVersion: number,
  sourceSnapshotHash: string,
  now: number,
) {
  const text = blocks.map((block) => block.text).join("\n\n").trim();
  const finding = classifyNoteworthy(text);
  const status = !text || finding.action === "ignore" ? "not_noteworthy" as const : "noteworthy" as const;
  const sourceId = `${String(event.artifactId)}:${NOTEBOOK_ELEMENT_ID}`;
  const dedupeKey = activityDedupeKey({
    roomId: event.roomId,
    sourceKind: "artifact_element",
    sourceId,
    eventKind: "content_committed",
    actorId: event.actor.id,
    ownerId: event.ownerId,
  });
  const decision = {
    status,
    action: status === "noteworthy" ? finding.action : "ignore",
    next: status === "noteworthy" ? "agent_artifact_or_research_inbox" : undefined,
    finding,
    text: text.slice(0, 1_000),
    source: "notebook_read_model",
    dirtyEventId: String(event._id),
  };
  const existing = await ctx.db.query("roomActivityOutbox").withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey)).order("desc").first();
  const patch = {
    roomId: event.roomId,
    sourceKind: "artifact_element" as const,
    sourceId,
    sourceVersion: sourceSnapshotVersion,
    sourceHash: sourceSnapshotHash,
    eventKind: "content_committed" as const,
    status,
    actor: event.actor,
    visibility: event.visibility,
    ownerId: event.ownerId,
    dedupeKey,
    quietUntil: now,
    maxWaitAt: now,
    attempts: existing?.attempts ?? 0,
    decision,
    finding,
    updatedAt: now,
    lastScannedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return { outboxId: existing._id, status, reused: true };
  }
  const outboxId = await ctx.db.insert("roomActivityOutbox", { ...patch, createdAt: now });
  return { outboxId, status, reused: false };
}

async function extractReadModel(snapshotContent: string): Promise<{
  blocks: NotebookBlockInput[];
  claims: NotebookClaimInput[];
  mentions: NotebookMentionInput[];
}> {
  let root: unknown;
  try {
    root = JSON.parse(snapshotContent);
  } catch {
    root = { type: "doc", content: [{ type: "paragraph", text: snapshotContent }] };
  }
  const rawBlocks: Array<{ blockType: string; text: string; stableId: string | null }> = [];
  collectBlocks(root, rawBlocks);
  const blocks: NotebookBlockInput[] = [];
  const claims: NotebookClaimInput[] = [];
  const mentions: NotebookMentionInput[] = [];
  for (const raw of rawBlocks) {
    const text = raw.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const blockIndex = blocks.length;
    const textHash = await sha256Hex(text);
    // v2: prefer the stable attrs.blockId (shared NOTEBOOK_EXTENSIONS identity)
    // so claims/mentions/work-plan anchors survive edits; position-derived ids
    // remain the fallback for docs that predate block identity.
    const blockId = raw.stableId ?? `b${blockIndex}-${textHash.slice(0, 12)}`;
    blocks.push({ blockId, blockIndex, blockType: raw.blockType, text, textHash });
    if (/\b(need|verify|confirm|ask|follow up|source|todo|runway|burn|revenue|funding|series)\b/i.test(text)) {
      claims.push({
        claimId: `c${claims.length}-${textHash.slice(0, 12)}`,
        blockId,
        text: text.slice(0, 500),
        confidence: text.includes("?") ? "medium" : "high",
      });
    }
    for (const mention of extractMentions(text)) {
      mentions.push({
        mentionId: `m${mentions.length}-${blockId}-${mention.entityKey}`,
        blockId,
        ...mention,
      });
    }
  }
  return { blocks, claims, mentions };
}

function collectBlocks(
  node: unknown,
  blocks: Array<{ blockType: string; text: string; stableId: string | null }>,
  inherited: { stableId: string | null } = { stableId: null },
) {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; text?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
  const type = n.type ?? "";
  const stableId = typeof n.attrs?.blockId === "string" && n.attrs.blockId ? n.attrs.blockId : inherited.stableId;
  if (LEAF_TYPES.has(type)) {
    blocks.push({ blockType: type, text: collectInlineText(n).trim(), stableId });
    return;
  }
  if (!Array.isArray(n.content)) return;
  const nextInherited = CONTAINER_TYPES.has(type) ? { stableId } : inherited;
  for (const child of n.content) collectBlocks(child, blocks, nextInherited);
}

function collectInlineText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  if (!Array.isArray(n.content)) return "";
  return n.content.map(collectInlineText).join(" ");
}

function extractMentions(text: string): Array<Omit<NotebookMentionInput, "mentionId" | "blockId">> {
  const seen = new Set<string>();
  const out: Array<Omit<NotebookMentionInput, "mentionId" | "blockId">> = [];
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/g)) {
    const displayName = (match[1] ?? "").trim().replace(/^(Ask|Met|Verify)\s+/, "");
    if (!displayName || ["Need", "Series", "The", "This", "NodeRoom", "Convex"].includes(displayName)) continue;
    const entityKey = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
    if (seen.has(entityKey)) continue;
    seen.add(entityKey);
    const entityType = /\b(health|labs|systems|software|capital|ventures|bank|biotech|pharma|ai|inc|corp|llc|ltd)\b/i.test(displayName)
      ? "company"
      : /\b(founder|ceo|cfo|vp|maya|priya)\b/i.test(displayName) ? "person" : "company";
    out.push({
      entityType,
      displayName,
      entityKey,
    });
  }
  return out.slice(0, 20);
}
