/**
 * Native notebook collaborative-text backend.
 *
 * Mounts the Convex ProseMirror Sync component (`@convex-dev/prosemirror-sync`)
 * and exposes its sync API for the `useTiptapSync` client hook. NodeRoom business
 * semantics (room/artifact/visibility/owner) live in the `notebookDocuments`
 * registry, never inside the collaborative-text component.
 *
 * Flow:
 *   client useTiptapSync(api.prosemirror, docId)
 *     -> getSnapshot/submitSteps/etc. (component-owned, registry-gated)
 *     -> on quiet window, component calls onSnapshot(ctx, docId, json, version)
 *        -> update notebookDocuments hash/version (registry tracking only)
 *   passive intelligence: the client SyncedNote blur commit is the single
 *     activity source (-> applyCellEdit -> enqueueRoomActivity), identical to
 *     the legacy Note path. onSnapshot does NOT enqueue (that duplicated it).
 *
 * Auth note: the component's sync functions are called by the browser hook with
 * only `(id)`, so NodeRoom's actor-proof model can't be injected here. Guards
 * confirm the doc is registered in `notebookDocuments` (rejecting unregistered
 * ids). Per-user enforcement for the live editor requires wiring Convex Auth
 * (documented follow-up); the artifact id underlying the doc id is only known to
 * room members via listArtifacts, and the `onSnapshot` server callback re-derives
 * visibility/owner from the registry row.
 */

import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { actorProofV, requireActorProof, requireArtifactInRoom, sha256Hex } from "./lib";

const NOTEBOOK_ELEMENT_ID = "doc";
const EMPTY_DOC: object = { type: "doc", content: [{ type: "paragraph" }] };

export const prosemirrorSync = new ProsemirrorSync<string>(components.prosemirrorSync);

/** Generate a random, unguessable doc id — a CAPABILITY secret. Unlike a
 *  deterministic `nb:{artifactId}`, a non-member can never derive it; the only
 *  way to learn it is the membership-gated `getNotebookDoc` query. This closes
 *  the IDOR on the live read/write surface without requiring Convex Auth. */
function newNotebookDocId(): string {
  return `nb:${crypto.randomUUID()}`;
}

/** Registry gate: confirm the doc id is registered. The id is a random secret
 *  only learnable via the membership-gated getNotebookDoc, so registry-existence
 *  here is sufficient (a guessed id won't be registered). Shared by read+write. */
async function assertDocRegistered(ctx: QueryCtx, id: string): Promise<void> {
  const row = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", id))
    .unique();
  if (!row) throw new Error("notebook_doc_not_registered");
}

/** Recursively extract plain text from a ProseMirror JSON node tree. Used only
 *  for the notebookDocuments.latestSnapshotHash registry marker — NOT a routing
 *  signal (the classifier runs on stripHtml of the HTML committed via the blur
 *  path), so it intentionally does not need to match stripHtml's representation. */
function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractText).join("\n");
  return "";
}

export const {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
} = prosemirrorSync.syncApi<DataModel>({
  // Capability gate: only documents mapped in notebookDocuments (with a random
  // secret id learnable only via the membership-gated getNotebookDoc) are
  // readable/writable. A guessed/unregistered id is rejected here.
  checkRead: async (ctx, id) => { await assertDocRegistered(ctx, id); },
  checkWrite: async (ctx, id) => { await assertDocRegistered(ctx, id); },
  // Registry tracking only — NOT a passive-intelligence trigger. The client
  // SyncedNote's blur commit (-> applyCellEdit -> enqueueRoomActivity) is the
  // single activity source for a synced notebook, identical to the legacy Note
  // path. Enqueuing here too produced a second roomActivityOutbox row per edit
  // (different sourceKind/eventKind/actor in the dedupe key) and duplicated
  // coach cues / research jobs. We keep the registry hash/version current so
  // the notebookDocuments index reflects the latest collaborative state.
  onSnapshot: async (ctx, id, snapshot, version) => {
    if (version <= 1) return;
    const row = await ctx.db
      .query("notebookDocuments")
      .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", id))
      .unique();
    if (!row) return;
    let text = "";
    try { text = extractText(JSON.parse(snapshot)); }
    catch { text = ""; }
    const sourceHash = await sha256Hex(text || snapshot);
    if (row.latestSnapshotHash === sourceHash) {
      await ctx.db.patch(row._id, { latestIndexedVersion: version, updatedAt: Date.now() });
      return;
    }
    await ctx.db.patch(row._id, {
      latestSnapshotHash: sourceHash,
      latestIndexedVersion: version,
      latestProcessedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Get the prosemirrorDocId for a note artifact's "doc" element, or null if not
 *  yet migrated to the synced editor. Reactive — the SyncedNote component uses
 *  this to decide whether to render the synced editor or seed it. */
export const getNotebookDoc = query({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts") },
  handler: async (ctx, { roomId, artifactId }) => {
    await requireArtifactInRoom(ctx, roomId, artifactId);
    const row = await ctx.db
      .query("notebookDocuments")
      .withIndex("by_room_artifact_element", (q) =>
        q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
      .unique();
    return row ? { prosemirrorDocId: row.prosemirrorDocId, visibility: row.visibility, ownerId: row.ownerId } : null;
  },
});

/** Idempotent lazy migration: register a notebookDocuments row for a note
 *  artifact's "doc" element and create the synced doc, if no row exists yet.
 *  Returns the random capability `prosemirrorDocId` (a secret only learnable via
 *  this membership-gated mutation or getNotebookDoc). */
export const ensureNotebookDoc = mutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    if (art.kind !== "note") throw new Error("artifact_not_notebook");
    // Look up by room/artifact/element (the doc id is now a random secret, so we
    // can't derive it). If a row already exists, return its stored doc id.
    const existing = await ctx.db
      .query("notebookDocuments")
      .withIndex("by_room_artifact_element", (q) =>
        q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
      .unique();
    if (existing) return { prosemirrorDocId: existing.prosemirrorDocId, created: false as const };
    const docId = newNotebookDocId();
    const visibility = (art.visibility ?? "room") as "private" | "room" | "public";
    const ownerId = art.createdBy && art.createdBy.kind === "user" ? art.createdBy.id : undefined;
    const now = Date.now();
    await ctx.db.insert("notebookDocuments", {
      roomId,
      artifactId,
      elementId: NOTEBOOK_ELEMENT_ID,
      prosemirrorDocId: docId,
      visibility,
      ownerId,
      createdAt: now,
      updatedAt: now,
    });
    // Seed the synced doc. The ProseMirror Sync component stores JSON; we use a
    // minimal empty doc as the collaborative baseline — legacy HTML content stays
    // in elements["doc"] and the SyncedNote client seeds initialContent from it.
    try {
      await prosemirrorSync.create(ctx, docId, EMPTY_DOC);
    } catch (err) {
      // Race: another client created the doc concurrently. Safe to ignore —
      // both used the same EMPTY_DOC baseline, so no conflict.
      if (!String(err).includes("already")) {
        await ctx.db.insert("traces", {
          roomId,
          ts: now,
          actor,
          type: "notebook_seed_failed",
          summary: `Notebook seed failed for ${docId}`,
          detail: String(err).slice(0, 480),
        });
      }
    }
    return { prosemirrorDocId: docId, created: true as const };
  },
});
