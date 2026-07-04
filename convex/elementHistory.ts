/**
 * Per-cell version history — the read/restore surface over the `elementVersions`
 * VERSION LOG that `applyCellEditCore` appends (convex/artifacts.ts). Powers the
 * history popover, Restore, and diff (Receipts layer; human-conflict recovery).
 *
 * - `listElementVersions`: proof-gated, newest-first, BOUNDED take; private
 *   artifacts stay invisible to non-owners (mirrors listNotebookBlocks in
 *   convex/notebookProcessing.ts).
 * - `restoreElementVersion`: NOT a history rewrite. It re-applies the logged
 *   before-image as a NORMAL CAS write through `applyCellEditCore` — the same
 *   path a human hand-edit takes via artifacts.applyCellEdit — so a restore
 *   produces a NEW version, appends its own log row, and returns the standard
 *   EditOutcome shape (including an HONEST `locked`/`conflict` when the cell
 *   moved underneath the restorer).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { actorProofV, getElement, requireActorProof, requireArtifactInRoom, type ActorValue } from "./lib";
import { applyCellEditCore } from "./artifacts";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

type Visibility = "private" | "room" | "public";

// Visibility policy copied (not shared) from artifacts.ts/notebookProcessing.ts —
// the same module-local rule its sibling read surfaces use.
function actorOwnsArtifact(a: { createdBy?: ActorValue }, actor: ActorValue): boolean {
  if (!a.createdBy) return false;
  if (a.createdBy.kind === actor.kind && a.createdBy.id === actor.id) return true;
  return actor.kind === "agent" && actor.scope === "private" && !!actor.ownerId && a.createdBy.kind === "user" && a.createdBy.id === actor.ownerId;
}

function canReadArtifact(a: { visibility?: Visibility; createdBy?: ActorValue }, actor: ActorValue): boolean {
  return (a.visibility ?? "room") !== "private" || actorOwnsArtifact(a, actor);
}

/** Newest-first history rows for one cell — the history popover / diff feed. */
export const listElementVersions = query({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    requester: actorProofV,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, artifactId, elementId, requester, limit }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
    if (!canReadArtifact(artifact, actor)) return [];
    return ctx.db
      .query("elementVersions")
      .withIndex("by_artifact_element", (q) => q.eq("artifactId", artifactId).eq("elementId", elementId))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)));
  },
});

/** Restore version N of a cell = re-apply its logged before-image as a NEW CAS write. */
export const restoreElementVersion = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    requester: actorProofV,
    version: v.number(),
  },
  handler: async (ctx, { roomId, artifactId, elementId, requester, version }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
    if (!canReadArtifact(artifact, actor)) throw new Error("artifact_not_visible");
    // Version numbers restart after a delete→create cycle, so the same (element,
    // version) key can hold several incarnations — restore the newest one.
    const row = await ctx.db
      .query("elementVersions")
      .withIndex("by_artifact_element", (q) => q.eq("artifactId", artifactId).eq("elementId", elementId).eq("version", version))
      .order("desc")
      .first();
    if (!row) return { ok: false as const, reason: "version_not_found" as const };
    // HONEST_STATUS: a truncated snapshot is a display artifact, not the real value —
    // restoring it would commit corrupt data behind an ok:true. Refuse as DATA.
    if (row.truncated) return { ok: false as const, reason: "snapshot_truncated" as const, truncated: true as const };
    // Restore = a NORMAL CAS write through the human path (never a history rewrite):
    // read the CURRENT baseline inside this mutation and let applyCellEditCore run its
    // full lock/CAS/policy spine. A concurrent commit or held lock surfaces as the
    // standard honest EditOutcome, and the applied restore logs its own before-image.
    const current = await getElement(ctx, artifactId, elementId);
    return applyCellEditCore(ctx, {
      roomId,
      artifactId,
      elementId,
      // A since-deleted element restores via "create" so it rejoins the artifact order.
      kind: current ? "set" : "create",
      value: row.value,
      baseVersion: current?.version ?? 0,
      actor,
    });
  },
});
