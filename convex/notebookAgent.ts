/**
 * Agent notebook lane — governed block-level reads/writes on the native
 * (ProseMirror-synced) notebook, the notebook analog of the cell spine.
 *
 *   block : cell :: blockId : elementId :: anchoring-in-transform : CAS
 *
 * Write engine: @convex-dev/prosemirror-sync's server-side `transform(ctx, id,
 * schema, fn)` — human typing and agent writes converge by real step rebasing,
 * fixing the legacy divergence where agent `update_wiki` writes to
 * elements["doc"] were invisible in the synced editor.
 *
 * Guard order mirrors applyCellEditCore (policy copied, function not shared):
 *   actor-in-room → artifact ACL → review mode (proposal via the doc:agent
 *   element, reusing the existing proposal machinery) → anchor resolution
 *   INSIDE the transform fn against the fresh doc (missing anchor returns
 *   no_such_block as DATA, never a throw) → apply → artifact version bump +
 *   trace + mutation receipt + dirty event (read-model refresh) + elements
 *   ["doc"] checkpoint mirror.
 *
 * Idempotency (load-bearing): transform() re-runs its fn until synced; block
 * ids are minted before the transform and the fn no-ops when the fresh doc
 * already contains them, so a retry can never duplicate content.
 *
 * All functions are internal — only server actions (ConvexRoomTools) can call
 * them; the actor arg is server-trusted, same as applyAgentCellEdit.
 *
 * Passive-intelligence invariant: this module must NEVER touch
 * roomActivityOutbox. The read-model refresh goes through the same dirty-event
 * → ACL-gated processor pipeline as human edits (single passive source).
 */

import { v } from "convex/values";
import { getSchema } from "@tiptap/core";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actorV, requireActorInRoom, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";
import { prosemirrorSync, ensureNotebookDocCore } from "./prosemirror";
import { NOTEBOOK_EXTENSIONS } from "../src/notebook/extensions";
import {
  OUTLINE_CAPS,
  buildAgentRootNode,
  buildOutlineNodes,
  collectBlockIdsFromNodes,
  countLeafBlocks,
  docContainsBlockId,
  filterBuiltOutlineNodesForExistingTitles,
  findAgentRootHeading,
  headingTitlesFrom,
  outlineToHtml,
  readNotebookBlocks,
  type OutlineSection,
  type PmNodeJson,
} from "../src/notebook/blockOps";
import { pmJsonToHtml } from "../src/notebook/seed";

const NOTEBOOK_ELEMENT_ID = "doc";
const AGENT_NOTES_ELEMENT_ID = "doc:agent";
type DbCtx = QueryCtx | MutationCtx;

let cachedSchema: Schema | null = null;
function notebookSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(NOTEBOOK_EXTENSIONS);
  return cachedSchema;
}

function actorOwnsArtifact(a: { createdBy?: ActorValue }, actor: ActorValue): boolean {
  return !!a.createdBy && a.createdBy.kind === actor.kind && a.createdBy.id === actor.id;
}

/** Agent-facing read/write visibility: shared artifacts always; private ones
 *  only for the owner or the owner's private-scoped agent. */
function agentCanAccessArtifact(
  a: { visibility?: "private" | "room" | "public"; createdBy?: ActorValue },
  actor: ActorValue,
): boolean {
  if ((a.visibility ?? "room") !== "private") return true;
  if (actorOwnsArtifact(a, actor)) return true;
  const ownerId = (actor as { ownerId?: string }).ownerId;
  return actor.kind === "agent"
    && actor.scope === "private"
    && !!ownerId
    && !!a.createdBy
    && a.createdBy.kind === "user"
    && a.createdBy.id === ownerId;
}

async function notebookDocRow(ctx: DbCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts">) {
  return await ctx.db
    .query("notebookDocuments")
    .withIndex("by_room_artifact_element", (q) =>
      q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
    .unique();
}

/** Latest doc JSON = latest snapshot + replayed steps (the component's
 *  getLatestVersion, reimplemented so a QUERY can serve reads too). */
async function readLatestDocJson(
  ctx: { runQuery: QueryCtx["runQuery"] },
  docId: string,
): Promise<{ docJson: PmNodeJson; version: number } | null> {
  const snapshot = await ctx.runQuery(components.prosemirrorSync.lib.getSnapshot, { id: docId });
  if (!snapshot.content || typeof snapshot.version !== "number") return null;
  const { steps, version } = await ctx.runQuery(components.prosemirrorSync.lib.getSteps, {
    id: docId,
    version: snapshot.version,
  });
  const content = JSON.parse(snapshot.content) as PmNodeJson;
  if (!steps.length) return { docJson: content, version };
  const schema = notebookSchema();
  const transform = new Transform(schema.nodeFromJSON(content));
  for (const step of steps) transform.step(Step.fromJSON(schema, JSON.parse(step)));
  return { docJson: transform.doc.toJSON() as PmNodeJson, version };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v2]) => v2 !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v2]) => `${JSON.stringify(k)}:${stableStringify(v2)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const bulletV = v.union(
  v.string(),
  v.object({
    text: v.string(),
    claim: v.optional(v.boolean()),
    evidence: v.optional(v.array(v.any())),
  }),
);
const sectionV = v.object({ title: v.string(), bullets: v.array(bulletV) });

/** Structured block view of a note artifact — the agent read path. Returns
 *  conflict-free CAS tokens (textHash) and stable ids so writes can anchor. */
export const readNotebookForAgent = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), actor: actorV },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (art.kind !== "note") return { ok: false as const, reason: "not_a_note" as const };
    if (!agentCanAccessArtifact(art, a.actor)) return { ok: false as const, reason: "artifact_not_visible" as const };
    const row = await notebookDocRow(ctx, a.roomId, a.artifactId);
    if (!row) return { ok: false as const, reason: "notebook_not_synced" as const };
    const latest = await readLatestDocJson(ctx, row.prosemirrorDocId);
    if (!latest) return { ok: false as const, reason: "notebook_doc_missing" as const };
    const views = await readNotebookBlocks(latest.docJson);
    const agentRoot = findAgentRootHeading(latest.docJson);
    return {
      ok: true as const,
      docSource: "synced" as const,
      docVersion: latest.version,
      artifactVersion: art.version,
      agentSection: { exists: !!agentRoot, blockId: agentRoot?.blockId ?? undefined },
      truncated: views.length > OUTLINE_CAPS.maxBlocksPerRead,
      blocks: views.slice(0, OUTLINE_CAPS.maxBlocksPerRead).map((b) => ({
        blockId: b.blockId ?? b.derivedId,
        hasStableId: b.blockId !== null,
        blockIndex: b.blockIndex,
        blockType: b.blockType,
        depth: b.depth,
        text: b.text.length > OUTLINE_CAPS.maxTextChars ? `${b.text.slice(0, OUTLINE_CAPS.maxTextChars - 1)}…` : b.text,
        textHash: b.textHash,
        authorKind: b.authorKind ?? undefined,
        status: b.status ?? undefined,
      })),
    };
  },
});

/** Agent-lane ensure: registers + seeds the synced doc (from legacy HTML when
 *  present) with a server-trusted actor, so the agent lane works before any
 *  human has opened the synced editor. Idempotent. */
export const ensureNotebookDocForAgent = internalMutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), actor: actorV },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    return await ensureNotebookDocCore(ctx, a.roomId, a.artifactId, a.actor);
  },
});

/** The /parse port: append a structured outline (sections/bullets) under the
 *  attr-matched "Agent notes" section or an explicit block anchor. */
export const applyOutlineByAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    jobId: v.optional(v.id("agentJobs")),
    runLabel: v.optional(v.string()),
    title: v.optional(v.string()),
    parentBlockId: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("append"), v.literal("merge"))),
    sections: v.array(sectionV),
  },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (art.kind !== "note") return { ok: false as const, reason: "not_a_note" as const };
    if (!agentCanAccessArtifact(art, a.actor)) return { ok: false as const, reason: "artifact_not_visible" as const };
    const room = await ctx.db.get(a.roomId);
    if (!room) return { ok: false as const, reason: "room_missing" as const };
    const now = Date.now();
    const mode = a.mode ?? "merge";
    const outline = { title: a.title, sections: a.sections as OutlineSection[], runId: a.runLabel };

    // REVIEW MODE — AGENT writes become proposals (same actor semantics as
    // applyCellEditCore: humans write directly even in review mode). The outline
    // renders to HTML and routes through the existing proposal machinery on the
    // append-only doc:agent element (rendered with the NodeRoom badge after
    // approval). pending_approval is SUCCESS-shaped for the model: filed, not failed.
    if (a.actor.kind === "agent" && !room.autoAllow) {
      const built = buildOutlineNodes({ outline, mintId: () => crypto.randomUUID(), mode: "append" });
      const html = outlineToHtml({ built, outline, includeAgentRoot: false });
      const existing = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId).eq("elementId", AGENT_NOTES_ELEMENT_ID))
        .unique();
      const currentHtml = typeof existing?.value === "string" ? existing.value : "";
      const result: AgentCellEditRouteResult = await ctx.runMutation(internal.artifacts.applyAgentCellEdit, {
        roomId: a.roomId,
        artifactId: a.artifactId,
        elementId: AGENT_NOTES_ELEMENT_ID,
        kind: existing ? ("set" as const) : ("create" as const),
        value: currentHtml ? `${currentHtml}\n${html}` : html,
        baseVersion: existing?.version ?? 0,
        actor: a.actor,
        jobId: a.jobId,
      });
      if (result.ok) {
        // autoAllow flipped on between our read and the sub-mutation — the write
        // landed directly on doc:agent, which is still a governed, badged surface.
        return { ok: true as const, lane: "agent_notes_element" as const, blockIds: built.mintedBlockIds, dedupedSections: 0, needsReviewCount: built.needsReviewCount };
      }
      if (result.reason === "pending_approval") {
        return { ok: false as const, reason: "pending_approval" as const, proposalId: result.proposalId ? String(result.proposalId) : undefined };
      }
      return { ok: false as const, reason: String(result.reason ?? "review_route_failed") };
    }

    // AUTO-ALLOW — write the synced doc through step-rebasing transform.
    const ensured = await ensureNotebookDocCore(ctx, a.roomId, a.artifactId, a.actor);
    const row = await notebookDocRow(ctx, a.roomId, a.artifactId);
    if (!row) return { ok: false as const, reason: "notebook_doc_missing" as const };
    const schema = notebookSchema();

    // Pre-pass on the current doc for merge dedupe (authoritative re-check runs
    // inside the transform fn against the fresh doc on every rebase iteration).
    const pre = await readLatestDocJson(ctx, row.prosemirrorDocId);
    if (!pre) return { ok: false as const, reason: "notebook_doc_missing" as const };
    // BOUND: every write pays O(doc) in the transform + mirror, so an agent
    // loop hits a hard ceiling (as DATA) instead of degrading the room.
    if (countLeafBlocks(pre.docJson, OUTLINE_CAPS.maxDocBlocksForAgentWrite) >= OUTLINE_CAPS.maxDocBlocksForAgentWrite) {
      return { ok: false as const, reason: "notebook_too_large" as const, maxBlocks: OUTLINE_CAPS.maxDocBlocksForAgentWrite };
    }
    const preRoot = findAgentRootHeading(pre.docJson);
    const existingTitles = a.parentBlockId
      ? new Set<string>()
      : headingTitlesFrom(pre.docJson, preRoot ? preRoot.topLevelIndex : (pre.docJson.content?.length ?? 0));
    const built = buildOutlineNodes({ outline, mintId: () => crypto.randomUUID(), mode, existingTitles });
    if (built.nodes.length === 0) {
      return { ok: true as const, noop: true as const, blockIds: [], dedupedSections: built.dedupedSections, needsReviewCount: 0 };
    }
    const agentRootJson = buildAgentRootNode(() => crypto.randomUUID());
    const mintedSet = new Set([...built.mintedBlockIds, String(agentRootJson.attrs?.blockId ?? "")]);

    let anchorMissing = false;
    let alreadyApplied = false;
    let wroteContent = false;
    let appliedBlockIds = collectBlockIdsFromNodes(built.nodes);
    let finalDedupedSections = built.dedupedSections;
    let finalNeedsReviewCount = built.needsReviewCount;
    const finalDoc = await prosemirrorSync.transform(ctx, row.prosemirrorDocId, schema, (doc: PmNode) => {
      const json = doc.toJSON() as PmNodeJson;
      // Exactly-once across transform's rebase-retry loop.
      if (docContainsBlockId(json, mintedSet)) {
        alreadyApplied = true;
        return null;
      }
      anchorMissing = false;
      let insertPos = doc.content.size;
      let nodesJson: PmNodeJson[] = built.nodes;
      if (a.parentBlockId) {
        // Anchor to the TOP-LEVEL node containing the target block, inserting
        // after it (a nested insert point would put headings inside lists).
        let found = -1;
        doc.forEach((child, offset) => {
          if (found >= 0) return;
          const childJson = child.toJSON() as PmNodeJson;
          if (docContainsBlockId({ type: "doc", content: [childJson] }, new Set([a.parentBlockId!]))
            || (childJson.attrs?.blockId === a.parentBlockId)) {
            found = offset + child.nodeSize;
          }
        });
        if (found < 0) {
          anchorMissing = true;
          return null;
        }
        insertPos = found;
      } else if (!findAgentRootHeading(json)) {
        // No agent section yet — create it (attr-matched, idempotent) at doc end.
        nodesJson = [agentRootJson, ...built.nodes];
        appliedBlockIds = collectBlockIdsFromNodes(built.nodes);
        finalDedupedSections = built.dedupedSections;
        finalNeedsReviewCount = built.needsReviewCount;
      } else if (!a.parentBlockId) {
        const freshRoot = findAgentRootHeading(json);
        const freshTitles = headingTitlesFrom(json, freshRoot ? freshRoot.topLevelIndex : (json.content?.length ?? 0));
        const filtered = filterBuiltOutlineNodesForExistingTitles({ nodes: built.nodes, existingTitles: freshTitles, mode });
        nodesJson = filtered.nodes;
        appliedBlockIds = filtered.blockIds;
        finalDedupedSections = built.dedupedSections + filtered.dedupedSections;
        finalNeedsReviewCount = filtered.needsReviewCount;
        if (nodesJson.length === 0) return null;
      }
      const nodes = nodesJson.map((n) => schema.nodeFromJSON(n));
      const tr = new Transform(doc);
      tr.insert(insertPos, nodes);
      wroteContent = true;
      return tr;
    });

    if (anchorMissing) {
      const views = await readNotebookBlocks(finalDoc.toJSON());
      return {
        ok: false as const,
        reason: "no_such_block" as const,
        parentBlockId: a.parentBlockId,
        currentBlocks: views.slice(0, 12).map((b2) => ({ blockId: b2.blockId ?? b2.derivedId, text: b2.text.slice(0, 80) })),
      };
    }

    // COMMIT EFFECTS — one artifact-version bump per call (the cross-kind
    // governance clock, same as define_columns), never per keystroke.
    if (!wroteContent) {
      return {
        ok: true as const,
        noop: true as const,
        blockIds: [],
        dedupedSections: finalDedupedSections,
        needsReviewCount: 0,
      };
    }

    const mutationReceiptId = await notebookWriteEffects(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      actor: a.actor,
      jobId: a.jobId,
      art,
      row,
      finalDocJson: finalDoc.toJSON() as PmNodeJson,
      now,
      trace: {
        type: "notebook_outline_appended",
        summary: `${a.actor.name} appended ${appliedBlockIds.length} block${appliedBlockIds.length === 1 ? "" : "s"} to the notebook`,
        detail: `append_notebook_outline · blocks=${appliedBlockIds.length} · deduped=${finalDedupedSections} · needs_review=${finalNeedsReviewCount}${a.parentBlockId ? ` · anchor=${a.parentBlockId}` : " · agent section"}${alreadyApplied ? " · idempotent-replay" : ""}`,
      },
      receipt: {
        mutationName: "notebookAgent.applyOutlineByAgent",
        input: {
          roomId: String(a.roomId),
          artifactId: String(a.artifactId),
          title: a.title,
          parentBlockId: a.parentBlockId,
          mode,
          sections: a.sections,
        },
        output: { ok: true, blockCount: appliedBlockIds.length, dedupedSections: finalDedupedSections },
        affectedBlockIds: appliedBlockIds,
      },
    });

    return {
      ok: true as const,
      lane: "synced_doc" as const,
      created: ensured.created,
      blockIds: appliedBlockIds,
      dedupedSections: finalDedupedSections,
      needsReviewCount: finalNeedsReviewCount,
      artifactVersion: art.version + 1,
      mutationReceiptId,
    };
  },
});

/** Shared post-commit effects for every agent notebook write: ONE artifact
 *  version bump (the governance clock), a human-readable trace, the
 *  elements["doc"] checkpoint mirror (best-effort plain patch — never a
 *  passive-intelligence trigger), the coalesced dirty event that refreshes the
 *  read model through the ACL-gated processor, and the mutation receipt. */
async function notebookWriteEffects(ctx: MutationCtx, e: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  actor: ActorValue;
  jobId?: Id<"agentJobs">;
  art: { version: number; visibility?: "private" | "room" | "public"; createdBy?: ActorValue };
  row: Doc<"notebookDocuments">;
  finalDocJson: PmNodeJson;
  now: number;
  trace: { type: string; summary: string; detail: string };
  receipt: { mutationName: string; input: unknown; output: unknown; affectedBlockIds: string[] };
}): Promise<Id<"agentMutationReceipts"> | undefined> {
  const { now } = e;
  await ctx.db.patch(e.artifactId, { version: e.art.version + 1, updatedAt: now });
  await ctx.db.insert("traces", { roomId: e.roomId, ts: now, actor: e.actor, type: e.trace.type, summary: e.trace.summary, detail: e.trace.detail });

  // Checkpoint mirror: legacy viewers (flag-off builds, memory exports) read
  // elements["doc"]. The synced doc stays the source of truth.
  const mirrorHtml = pmJsonToHtml(e.finalDocJson);
  if (mirrorHtml !== null) {
    const docElement = await ctx.db
      .query("elements")
      .withIndex("by_artifact", (q) => q.eq("artifactId", e.artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
      .unique();
    if (docElement) {
      await ctx.db.patch(docElement._id, { value: mirrorHtml, version: docElement.version + 1, updatedAt: now, updatedBy: e.actor });
    } else {
      await ctx.db.insert("elements", { artifactId: e.artifactId, elementId: NOTEBOOK_ELEMENT_ID, value: mirrorHtml, version: 1, updatedAt: now, updatedBy: e.actor });
    }
  }

  // Read-model refresh through the SAME dirty-event pipeline as human edits
  // (single passive source). Coalesced per doc+actor+lane — an agent loop of N
  // writes produces ONE pending event (and one processor run), not N.
  const visibility = (e.art.visibility ?? e.row.visibility ?? "room") as "private" | "room" | "public";
  const ownerId = visibility === "private"
    ? (e.art.createdBy?.kind === "user" ? e.art.createdBy.id : (e.actor as { ownerId?: string }).ownerId)
    : undefined;
  const pendingDirty = await ctx.db
    .query("notebookDirtyEvents")
    .withIndex("by_doc_actor_lane_state", (q) =>
      q.eq("prosemirrorDocId", e.row.prosemirrorDocId).eq("actorId", e.actor.id).eq("processingLane", "index").eq("state", "pending"))
    .order("desc")
    .first();
  const dirtyPatch = {
    observedSnapshotVersion: e.row.latestIndexedVersion,
    observedSnapshotHash: e.row.latestSnapshotHash,
    changedRangeHint: "doc:agent-write",
    visibility,
    ownerId,
    quietUntil: now,
    maxWaitAt: pendingDirty?.maxWaitAt ?? now,
    updatedAt: now,
  };
  const dirtyEventId = pendingDirty
    ? (await ctx.db.patch(pendingDirty._id, dirtyPatch), pendingDirty._id)
    : await ctx.db.insert("notebookDirtyEvents", {
      roomId: e.roomId,
      artifactId: e.artifactId,
      notebookDocumentId: e.row._id,
      prosemirrorDocId: e.row.prosemirrorDocId,
      actor: e.actor,
      actorId: e.actor.id,
      visibility,
      ownerId,
      observedSnapshotVersion: e.row.latestIndexedVersion,
      observedSnapshotHash: e.row.latestSnapshotHash,
      changedRangeHint: "doc:agent-write",
      processingLane: "index",
      state: "pending",
      dirtyAt: now,
      quietUntil: now,
      maxWaitAt: now,
      createdAt: now,
      updatedAt: now,
    });
  await ctx.scheduler.runAfter(0, internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId });

  // Mutation receipt — deterministic sorted-key input hash, like every agent write.
  let mutationReceiptId: Id<"agentMutationReceipts"> | undefined;
  if (e.jobId) {
    const job = await ctx.db.get(e.jobId);
    if (job) {
      mutationReceiptId = await ctx.db.insert("agentMutationReceipts", {
        jobId: e.jobId,
        mutationName: e.receipt.mutationName,
        permission: "agent_session",
        inputHash: await sha256Hex(stableStringify(e.receipt.input)),
        output: e.receipt.output,
        affectedIds: [String(e.artifactId), ...e.receipt.affectedBlockIds.map((id) => `${String(e.artifactId)}:blk:${id}`)],
        beforeVersions: { artifact: e.art.version },
        afterVersions: { artifact: e.art.version + 1 },
        createdAt: now,
      });
      await ctx.db.patch(e.jobId, {
        mutationCount: (job.mutationCount ?? 0) + 1,
        receiptCount: (job.receiptCount ?? 0) + 1,
        updatedAt: now,
      });
    }
  }
  return mutationReceiptId;
}

/** Explicit shape for internal.artifacts.applyAgentCellEdit results used by the
 *  review lanes. Annotated (not inferred) to break the self-referential type
 *  cycle the generated API creates once notebookAgent itself is in it (TS7022). */
type AgentCellEditRouteResult = { ok: boolean; reason?: string; proposalId?: unknown; version?: number };

const blockEditActionV = v.union(v.literal("replace"), v.literal("append_children"), v.literal("annotate"));

/** Governed single-block edit — hash-anchored CAS on ONE block. `replace` and
 *  `append_children` require the target to be agent-authored (human prose is
 *  protected — use `annotate`, which inserts an attributed aside AFTER the
 *  target without touching it). Conflicts, missing anchors, and protection all
 *  return as DATA the model recovers from. */
export const applyBlockEditByAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    jobId: v.optional(v.id("agentJobs")),
    runLabel: v.optional(v.string()),
    blockId: v.string(),
    baseTextHash: v.optional(v.string()),
    action: blockEditActionV,
    content: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (art.kind !== "note") return { ok: false as const, reason: "not_a_note" as const };
    if (!agentCanAccessArtifact(art, a.actor)) return { ok: false as const, reason: "artifact_not_visible" as const };
    const room = await ctx.db.get(a.roomId);
    if (!room) return { ok: false as const, reason: "room_missing" as const };
    const clean = a.content.replace(/\s+/g, " ").trim().slice(0, 1_200);
    if (!clean) return { ok: false as const, reason: "empty_content" as const };
    if (a.action !== "annotate" && !a.baseTextHash) {
      return { ok: false as const, reason: "base_text_hash_required" as const };
    }
    const now = Date.now();

    // REVIEW MODE — agent block edits become proposals on the badged doc:agent
    // element, like outline appends. pending_approval is SUCCESS-shaped.
    if (a.actor.kind === "agent" && !room.autoAllow) {
      const existing = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId).eq("elementId", AGENT_NOTES_ELEMENT_ID))
        .unique();
      const currentHtml = typeof existing?.value === "string" ? existing.value : "";
      const suggestion = `<p data-author-kind="agent">Suggested ${a.action} on block ${escapeForHtml(a.blockId)}: ${escapeForHtml(clean)}</p>`;
      const result: AgentCellEditRouteResult = await ctx.runMutation(internal.artifacts.applyAgentCellEdit, {
        roomId: a.roomId,
        artifactId: a.artifactId,
        elementId: AGENT_NOTES_ELEMENT_ID,
        kind: existing ? ("set" as const) : ("create" as const),
        value: currentHtml ? `${currentHtml}\n${suggestion}` : suggestion,
        baseVersion: existing?.version ?? 0,
        actor: a.actor,
        jobId: a.jobId,
      });
      if (result.ok) return { ok: true as const, lane: "agent_notes_element" as const, action: a.action, blockIds: [] };
      if (result.reason === "pending_approval") {
        return { ok: false as const, reason: "pending_approval" as const, proposalId: result.proposalId ? String(result.proposalId) : undefined };
      }
      return { ok: false as const, reason: String(result.reason ?? "review_route_failed") };
    }

    await ensureNotebookDocCore(ctx, a.roomId, a.artifactId, a.actor);
    const row = await notebookDocRow(ctx, a.roomId, a.artifactId);
    if (!row) return { ok: false as const, reason: "notebook_doc_missing" as const };
    const schema = notebookSchema();
    const pre = await readLatestDocJson(ctx, row.prosemirrorDocId);
    if (!pre) return { ok: false as const, reason: "notebook_doc_missing" as const };
    if (countLeafBlocks(pre.docJson, OUTLINE_CAPS.maxDocBlocksForAgentWrite) >= OUTLINE_CAPS.maxDocBlocksForAgentWrite) {
      return { ok: false as const, reason: "notebook_too_large" as const, maxBlocks: OUTLINE_CAPS.maxDocBlocksForAgentWrite };
    }

    // Minted ids for the inserted nodes (append_children/annotate) — the
    // exactly-once sentinel across transform's rebase-retry loop.
    const insertedParagraph: PmNodeJson | null = a.action === "replace" ? null : {
      type: "paragraph",
      attrs: {
        blockId: crypto.randomUUID(),
        authorKind: "agent",
        ...(a.runLabel ? { runId: a.runLabel } : {}),
      },
      content: [{ type: "text", text: clean }],
    };
    const mintedSet = new Set(insertedParagraph ? [String(insertedParagraph.attrs?.blockId)] : []);

    let notFound = false;
    let humanProtected = false;
    let conflict: { currentText: string; currentTextHash: string } | null = null;
    const finalDoc = await prosemirrorSync.transform(ctx, row.prosemirrorDocId, schema, async (doc: PmNode) => {
      notFound = false;
      humanProtected = false;
      conflict = null;
      const json = doc.toJSON() as PmNodeJson;
      if (mintedSet.size && docContainsBlockId(json, mintedSet)) return null; // retry replay — already applied
      // Locate the target node by stable id (authoritative, fresh doc).
      let targetPos = -1;
      let targetNode: PmNode | null = null;
      doc.descendants((child, pos) => {
        if (targetPos >= 0) return false;
        if ((child.attrs as { blockId?: string } | undefined)?.blockId === a.blockId) {
          targetPos = pos;
          targetNode = child;
          return false;
        }
        return true;
      });
      if (targetPos < 0 || !targetNode) {
        notFound = true;
        return null;
      }
      const node = targetNode as PmNode;
      const currentText = node.textContent.replace(/\s+/g, " ").trim();
      if (a.action !== "annotate") {
        // Human prose is protected: replace/append require agent authorship.
        if ((node.attrs as { authorKind?: string }).authorKind !== "agent") {
          humanProtected = true;
          return null;
        }
        const currentHash = await sha256Hex(currentText);
        if (currentHash !== a.baseTextHash) {
          conflict = { currentText: currentText.slice(0, 400), currentTextHash: currentHash };
          return null;
        }
      }
      const tr = new Transform(doc);
      if (a.action === "replace") {
        if (!node.isTextblock) {
          humanProtected = true; // container blocks are never text-replaced
          return null;
        }
        // Replace inline content; clear a stale needs_review flag (content changed).
        tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, status: null, ...(a.runLabel ? { runId: a.runLabel } : {}) });
        tr.replaceWith(targetPos + 1, targetPos + node.nodeSize - 1, schema.text(clean));
        return tr;
      }
      // append_children / annotate: insert an attributed paragraph AFTER the
      // top-level node containing the target (nested insert points would put
      // paragraphs inside invalid parents).
      let insertPos = doc.content.size;
      doc.forEach((child, offset) => {
        if (insertPos !== doc.content.size) return;
        const childJson = child.toJSON() as PmNodeJson;
        if (docContainsBlockId({ type: "doc", content: [childJson] }, new Set([a.blockId]))) {
          insertPos = offset + child.nodeSize;
        }
      });
      tr.insert(insertPos, schema.nodeFromJSON(insertedParagraph as PmNodeJson));
      return tr;
    });

    if (notFound) {
      const views = await readNotebookBlocks(finalDoc.toJSON());
      return {
        ok: false as const,
        reason: "no_such_block" as const,
        blockId: a.blockId,
        currentBlocks: views.slice(0, 12).map((b) => ({ blockId: b.blockId ?? b.derivedId, text: b.text.slice(0, 80) })),
      };
    }
    if (humanProtected) {
      return {
        ok: false as const,
        reason: "human_block_protected" as const,
        hint: "replace/append_children only apply to agent-authored text blocks — use action 'annotate' to add an attributed aside after human prose instead",
      };
    }
    if (conflict) {
      const c = conflict as { currentText: string; currentTextHash: string };
      return { ok: false as const, reason: "block_conflict" as const, currentText: c.currentText, currentTextHash: c.currentTextHash };
    }

    await notebookWriteEffects(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      actor: a.actor,
      jobId: a.jobId,
      art,
      row,
      finalDocJson: finalDoc.toJSON() as PmNodeJson,
      now,
      trace: {
        type: "notebook_block_edited",
        summary: `${a.actor.name} ${a.action === "replace" ? "updated" : a.action === "annotate" ? "annotated" : "extended"} a notebook block`,
        detail: `update_notebook_block · ${a.action} · block=${a.blockId}${a.reason ? ` · ${a.reason.slice(0, 120)}` : ""}`,
      },
      receipt: {
        mutationName: "notebookAgent.applyBlockEditByAgent",
        input: { roomId: String(a.roomId), artifactId: String(a.artifactId), blockId: a.blockId, action: a.action, content: clean, baseTextHash: a.baseTextHash },
        output: { ok: true, action: a.action },
        affectedBlockIds: [a.blockId, ...mintedSet],
      },
    });

    return {
      ok: true as const,
      lane: "synced_doc" as const,
      action: a.action,
      blockIds: [...mintedSet],
      artifactVersion: art.version + 1,
    };
  },
});

function escapeForHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Deterministic enrichment planner (read-only): the deduped, capped list of
 *  notebook entity mentions worth researching — read-model-backed selection so
 *  cheap models never reason about dedupe. Enrichment itself runs through the
 *  normal research tools + append_notebook_outline (inheriting every gate). */
export const planNotebookEnrichmentForAgent = internalQuery({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    maxTargets: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (art.kind !== "note") return { ok: false as const, reason: "not_a_note" as const };
    if (!agentCanAccessArtifact(art, a.actor)) return { ok: false as const, reason: "artifact_not_visible" as const };
    const row = await notebookDocRow(ctx, a.roomId, a.artifactId);
    if (!row) return { ok: false as const, reason: "notebook_not_synced" as const };
    const cap = Math.max(1, Math.min(Math.floor(a.maxTargets ?? 8), 8));
    const mentions = await ctx.db
      .query("notebookMentions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId))
      .take(200);
    // Existing enrichment sections (normalized heading titles) — a re-plan
    // reports them instead of re-queueing.
    const latest = await readLatestDocJson(ctx, row.prosemirrorDocId);
    const headings = latest ? headingTitlesFrom(latest.docJson, 0) : new Set<string>();
    const seen = new Set<string>();
    const targets: Array<{ entityKey: string; displayName: string; entityType: string; blockId: string; hasExistingEnrichment: boolean }> = [];
    let skipped = 0;
    for (const mention of mentions) {
      if (mention.visibility === "private" && mention.ownerId !== a.actor.id && mention.ownerId !== (a.actor as { ownerId?: string }).ownerId) continue;
      if (seen.has(mention.entityKey)) continue;
      seen.add(mention.entityKey);
      if (targets.length >= cap) {
        skipped += 1;
        continue;
      }
      targets.push({
        entityKey: mention.entityKey,
        displayName: mention.displayName,
        entityType: mention.entityType,
        blockId: mention.blockId,
        hasExistingEnrichment: headings.has(`enrichment — ${mention.displayName.toLowerCase()}`) || headings.has(`enrichment: ${mention.displayName.toLowerCase()}`),
      });
    }
    return { ok: true as const, targets, skipped };
  },
});
