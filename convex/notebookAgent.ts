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
import type { Id } from "./_generated/dataModel";
import { actorV, requireActorInRoom, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";
import { prosemirrorSync, ensureNotebookDocCore } from "./prosemirror";
import { NOTEBOOK_EXTENSIONS } from "../src/notebook/extensions";
import {
  OUTLINE_CAPS,
  buildAgentRootNode,
  buildOutlineNodes,
  countLeafBlocks,
  docContainsBlockId,
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
  return !!ownerId && !!a.createdBy && a.createdBy.kind === "user" && a.createdBy.id === ownerId;
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
      const result = await ctx.runMutation(internal.artifacts.applyAgentCellEdit, {
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
      }
      const nodes = nodesJson.map((n) => schema.nodeFromJSON(n));
      const tr = new Transform(doc);
      tr.insert(insertPos, nodes);
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
    await ctx.db.patch(a.artifactId, { version: art.version + 1, updatedAt: now });
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: a.actor,
      type: "notebook_outline_appended",
      summary: `${a.actor.name} appended ${built.sectionTitles.length} section${built.sectionTitles.length === 1 ? "" : "s"} to the notebook`,
      detail: `append_notebook_outline · blocks=${built.mintedBlockIds.length} · deduped=${built.dedupedSections} · needs_review=${built.needsReviewCount}${a.parentBlockId ? ` · anchor=${a.parentBlockId}` : " · agent section"}${alreadyApplied ? " · idempotent-replay" : ""}`,
    });

    // Checkpoint mirror: legacy viewers (flag-off builds, memory exports) read
    // elements["doc"]. Best-effort plain patch — no roomActivityOutbox, no
    // per-step version churn; the synced doc stays the source of truth.
    const mirrorHtml = pmJsonToHtml(finalDoc.toJSON());
    if (mirrorHtml !== null) {
      const docElement = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
        .unique();
      if (docElement) {
        await ctx.db.patch(docElement._id, { value: mirrorHtml, version: docElement.version + 1, updatedAt: now, updatedBy: a.actor });
      } else {
        await ctx.db.insert("elements", { artifactId: a.artifactId, elementId: NOTEBOOK_ELEMENT_ID, value: mirrorHtml, version: 1, updatedAt: now, updatedBy: a.actor });
      }
    }

    // Read-model refresh through the SAME dirty-event pipeline as human edits
    // (single passive source — never a direct roomActivityOutbox write here).
    const visibility = (art.visibility ?? row.visibility ?? "room") as "private" | "room" | "public";
    const ownerId = visibility === "private"
      ? (art.createdBy?.kind === "user" ? art.createdBy.id : (a.actor as { ownerId?: string }).ownerId)
      : undefined;
    // Coalesce per doc+actor+lane like markNotebookDirty — an agent loop of N
    // appends produces ONE pending event (and one processor run), not N.
    const pendingDirty = await ctx.db
      .query("notebookDirtyEvents")
      .withIndex("by_doc_actor_lane_state", (q) =>
        q.eq("prosemirrorDocId", row.prosemirrorDocId).eq("actorId", a.actor.id).eq("processingLane", "index").eq("state", "pending"))
      .order("desc")
      .first();
    const dirtyPatch = {
      observedSnapshotVersion: row.latestIndexedVersion,
      observedSnapshotHash: row.latestSnapshotHash,
      changedRangeHint: "doc:agent-outline",
      visibility,
      ownerId,
      quietUntil: now,
      maxWaitAt: pendingDirty?.maxWaitAt ?? now,
      updatedAt: now,
    };
    const dirtyEventId = pendingDirty
      ? (await ctx.db.patch(pendingDirty._id, dirtyPatch), pendingDirty._id)
      : await ctx.db.insert("notebookDirtyEvents", {
        roomId: a.roomId,
        artifactId: a.artifactId,
        notebookDocumentId: row._id,
        prosemirrorDocId: row.prosemirrorDocId,
        actor: a.actor,
        actorId: a.actor.id,
        visibility,
        ownerId,
        observedSnapshotVersion: row.latestIndexedVersion,
        observedSnapshotHash: row.latestSnapshotHash,
        changedRangeHint: "doc:agent-outline",
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
    if (a.jobId) {
      const job = await ctx.db.get(a.jobId);
      if (job) {
        await ctx.db.insert("agentMutationReceipts", {
          jobId: a.jobId,
          mutationName: "notebookAgent.applyOutlineByAgent",
          permission: "agent_session",
          inputHash: await sha256Hex(stableStringify({
            roomId: String(a.roomId),
            artifactId: String(a.artifactId),
            title: a.title,
            parentBlockId: a.parentBlockId,
            mode,
            sections: a.sections,
          })),
          output: { ok: true, blockCount: built.mintedBlockIds.length, dedupedSections: built.dedupedSections },
          affectedIds: [String(a.artifactId), ...built.mintedBlockIds.map((id) => `${String(a.artifactId)}:blk:${id}`)],
          beforeVersions: { artifact: art.version },
          afterVersions: { artifact: art.version + 1 },
          createdAt: now,
        });
        await ctx.db.patch(a.jobId, {
          mutationCount: (job.mutationCount ?? 0) + 1,
          receiptCount: (job.receiptCount ?? 0) + 1,
          updatedAt: now,
        });
      }
    }

    return {
      ok: true as const,
      lane: "synced_doc" as const,
      created: ensured.created,
      blockIds: built.mintedBlockIds,
      dedupedSections: built.dedupedSections,
      needsReviewCount: built.needsReviewCount,
      artifactVersion: art.version + 1,
    };
  },
});
