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
 *   passive intelligence:
 *     bridge path -> checked applyCellEdit commit -> enqueueRoomActivity once
 *     native path -> markNotebookDirty -> ACL snapshot processor -> read model
 *     onSnapshot does NOT enqueue (that duplicated passive work).
 *
 * Auth note: `getNotebookDoc` is actor-proof gated before it returns the random
 * doc id capability. The component's sync functions are called by the browser
 * hook with only `(id)`, so token proof can't be injected there; those guards
 * enforce registered-doc access and, for identity-backed rooms, active Convex
 * Auth membership plus current artifact visibility so `rooms.leave` and
 * private pullback revoke retained doc ids.
 */

import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { actorProofV, productionIdentityRequired, requireActorProof, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";
import { emptyNotebookDoc, legacyDocValueToPmJson } from "../src/notebook/seed";

const NOTEBOOK_ELEMENT_ID = "doc";
type DbCtx = QueryCtx | MutationCtx;

export const prosemirrorSync = new ProsemirrorSync<string>(components.prosemirrorSync);

function actorOwnsArtifact(a: { createdBy?: ActorValue }, actor: ActorValue): boolean {
  if (!a.createdBy) return false;
  if (a.createdBy.kind === actor.kind && a.createdBy.id === actor.id) return true;
  // Only the owner's private-scoped agent acts for its owner on private docs.
  // Public personal agents carry ownerId for attribution, but stay public.
  return actor.kind === "agent" && actor.scope === "private" && !!actor.ownerId && a.createdBy.kind === "user" && a.createdBy.id === actor.ownerId;
}

function canReadArtifact(a: { visibility?: "private" | "room" | "public"; createdBy?: ActorValue }, actor: ActorValue): boolean {
  return (a.visibility ?? "room") !== "private" || actorOwnsArtifact(a, actor);
}

/** Generate a random, unguessable doc id — a capability secret. Unlike a
 *  deterministic `nb:{artifactId}`, a non-member can never derive it; the only
 *  way to learn it is the requester-gated `getNotebookDoc`/`ensureNotebookDoc`
 *  path. */
function newNotebookDocId(): string {
  return `nb:${crypto.randomUUID()}`;
}

/** Registry gate: confirm the doc id is registered. Token-only local rooms use
 *  the random id as a capability; identity-backed rooms additionally require an
 *  active Convex Auth member and re-check the current artifact ACL so revocation
 *  and private pullback close retained browser doc ids. */
async function assertDocRegistered(ctx: DbCtx, id: string): Promise<void> {
  const row = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", id))
    .unique();
  if (!row) throw new Error("notebook_doc_not_registered");
  const artifact = await ctx.db.get(row.artifactId);
  if (!artifact || String(artifact.roomId) !== String(row.roomId)) {
    throw new Error("notebook_doc_not_registered");
  }
  const identity = await ctx.auth.getUserIdentity();
  const members = await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", row.roomId)).collect();
  const roomUsesIdentity = members.some((m) => !!m.authSubject);
  if (!identity && (productionIdentityRequired() || roomUsesIdentity)) {
    throw new Error("notebook_doc_auth_required");
  }
  if (!identity) return;
  const activeMember = members.find((m) => m.authSubject === identity.subject && m.revokedAt == null);
  if (!activeMember && (productionIdentityRequired() || roomUsesIdentity)) {
    throw new Error("notebook_doc_forbidden");
  }
  if (!activeMember) return;
  const actor: ActorValue = { kind: "user", id: String(activeMember._id), name: activeMember.name };
  if (!canReadArtifact(artifact, actor)) throw new Error("notebook_doc_forbidden");
}

/** Recursively extract plain text from a ProseMirror JSON node tree. Used only
 *  for the notebookDocuments.latestSnapshotHash registry marker — NOT a routing
 *  signal. Bridge classification runs from the checked artifact commit; native
 *  classification runs from the ACL-gated read model. */
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
  // secret id learnable only via the requester-gated getNotebookDoc) are
  // readable/writable. A guessed/unregistered id is rejected here.
  checkRead: async (ctx, id) => { await assertDocRegistered(ctx, id); },
  checkWrite: async (ctx, id) => { await assertDocRegistered(ctx, id); },
  // Registry tracking only — NOT a passive-intelligence trigger. The bridge
  // path still uses the checked applyCellEdit commit; the native path uses
  // markNotebookDirty + the read-model processor. Enqueuing here too produced
  // a second roomActivityOutbox row per edit
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
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    if (!canReadArtifact(art, actor)) throw new Error("artifact_not_visible");
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
 *  this requester-gated mutation or getNotebookDoc). */
/** Shared ensure/seed core. Called by the requester-gated public mutation below
 *  and by the agent lane (convex/notebookAgent.ts) with a server-trusted actor.
 *  Seeds the synced doc from the legacy elements["doc"] HTML so flipping
 *  VITE_NOTEBOOK_SYNC on (or the first agent write) never orphans existing
 *  note content. Empty/uploaded-file docs seed the standard empty baseline. */
export async function ensureNotebookDocCore(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  artifactId: Id<"artifacts">,
  actor: ActorValue,
): Promise<{ prosemirrorDocId: string; created: boolean }> {
  const art = await requireArtifactInRoom(ctx, roomId, artifactId);
  if (art.kind !== "note") throw new Error("artifact_not_notebook");
  if (!canReadArtifact(art, actor)) throw new Error("artifact_not_visible");
  // Look up by room/artifact/element (the doc id is now a random secret, so we
  // can't derive it). If a row already exists, return its stored doc id.
  const existing = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_room_artifact_element", (q) =>
      q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
    .unique();
  if (existing) return { prosemirrorDocId: existing.prosemirrorDocId, created: false };
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
  // Seed the synced doc. Legacy elements["doc"] HTML converts through the shared
  // NOTEBOOK_EXTENSIONS schema (lossy nodes drop — recorded as a trace); empty
  // or uploaded-file docs seed the minimal empty baseline.
  const legacyValue = (await ctx.db
    .query("elements")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", NOTEBOOK_ELEMENT_ID))
    .unique())?.value;
  const seeded = legacyDocValueToPmJson(legacyValue);
  try {
    await prosemirrorSync.create(ctx, docId, seeded ?? emptyNotebookDoc());
    if (seeded) {
      await ctx.db.insert("traces", {
        roomId,
        ts: now,
        actor,
        type: "notebook_seeded_from_legacy",
        summary: `Notebook synced doc seeded from existing note content`,
        detail: `artifact=${String(artifactId)} — legacy elements["doc"] HTML converted to the collaborative baseline`,
      });
    }
  } catch (err) {
    // Race: another client created the doc concurrently. Safe to ignore —
    // both seeds derive from the same legacy content, so no conflict.
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
  return { prosemirrorDocId: docId, created: true };
}

export const ensureNotebookDoc = mutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    return await ensureNotebookDocCore(ctx, roomId, artifactId, actor);
  },
});
