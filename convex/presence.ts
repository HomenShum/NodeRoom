import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, actorV, requireActorProof, requireActorInRoom, requireArtifactInRoom, type ActorValue } from "./lib";

const targetKindV = v.union(
  v.literal("cell"),
  v.literal("notebook_block"),
  v.literal("deck_component"),
  v.literal("slide"),
);

const modeV = v.union(
  v.literal("focus"),
  v.literal("edit"),
  v.literal("agent_intent"),
  v.literal("commit_lease"),
);
const publicModeV = v.union(v.literal("focus"), v.literal("edit"));

const DEFAULT_TTL_MS = 12_000;
const MAX_TTL_MS = 180_000;
const PRESENCE_ROW_CAP = 200;

type ArtifactAcl = { visibility?: "private" | "room" | "public"; createdBy?: ActorValue };

function actorOwnerId(actor: ActorValue): string {
  return actor.kind === "user" ? actor.id : actor.ownerId ?? actor.id;
}

function canReadArtifact(artifact: ArtifactAcl, actor: ActorValue): boolean {
  const visibility = artifact.visibility ?? "room";
  if (visibility !== "private") return true;
  const owner = artifact.createdBy ? actorOwnerId(artifact.createdBy) : undefined;
  return owner !== undefined && owner === actorOwnerId(actor);
}

function clampTtl(ttlMs: number | undefined): number {
  if (!Number.isFinite(ttlMs ?? DEFAULT_TTL_MS)) return DEFAULT_TTL_MS;
  return Math.max(2_000, Math.min(ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS));
}

function cleanLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

function cleanColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : undefined;
}

async function assertPresenceAccess(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  artifactId: Id<"artifacts"> | undefined,
  actor: ActorValue,
) {
  await requireActorInRoom(ctx, roomId, actor);
  if (!artifactId) return;
  const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
  if (!canReadArtifact(artifact, actor)) throw new Error("artifact_not_visible");
}

async function upsertPresenceClaim(
  ctx: MutationCtx,
  a: {
    roomId: Id<"rooms">;
    artifactId?: Id<"artifacts">;
    targetKind: "cell" | "notebook_block" | "deck_component" | "slide";
    targetId: string;
    mode: "focus" | "edit" | "agent_intent" | "commit_lease";
    actor: ActorValue;
    label?: string;
    color?: string;
    ttlMs?: number;
  },
) {
  await assertPresenceAccess(ctx, a.roomId, a.artifactId, a.actor);
  const targetId = a.targetId.trim();
  if (!targetId || targetId.length > 160) throw new Error("invalid_presence_target");

  const now = Date.now();
  const expiresAt = now + clampTtl(a.ttlMs);
  const existing = await ctx.db
    .query("presenceClaims")
    .withIndex("by_actor_mode", (q) =>
      q.eq("roomId", a.roomId)
        .eq("artifactId", a.artifactId)
        .eq("actorId", a.actor.id)
        .eq("mode", a.mode))
    .take(PRESENCE_ROW_CAP);

  const same = existing.find((row) => row.targetKind === a.targetKind && row.targetId === targetId);
  const patch = {
    targetKind: a.targetKind,
    targetId,
    actorId: a.actor.id,
    actor: a.actor,
    label: cleanLabel(a.label),
    color: cleanColor(a.color),
    updatedAt: now,
    expiresAt,
  };
  if (same) {
    await ctx.db.patch(same._id, patch);
  } else {
    await ctx.db.insert("presenceClaims", {
      roomId: a.roomId,
      artifactId: a.artifactId,
      mode: a.mode,
      createdAt: now,
      ...patch,
    });
  }

  // Human focus/edit is a cursor, not a trail. Keep one row per actor/mode/artifact.
  if (a.mode === "focus" || a.mode === "edit") {
    for (const row of existing) {
      if (same && String(row._id) === String(same._id)) continue;
      if (row.targetKind === a.targetKind) await ctx.db.delete(row._id);
    }
  }
  return { ok: true as const, expiresAt };
}

export const heartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    targetKind: targetKindV,
    targetId: v.string(),
    mode: publicModeV,
    label: v.optional(v.string()),
    color: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    return upsertPresenceClaim(ctx, { ...a, actor });
  },
});

export const heartbeatForAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    targetKind: targetKindV,
    targetId: v.string(),
    mode: v.union(v.literal("agent_intent"), v.literal("commit_lease")),
    actor: actorV,
    label: v.optional(v.string()),
    color: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    if (a.actor.kind !== "agent") throw new Error("agent_actor_required");
    return upsertPresenceClaim(ctx, a);
  },
});

/**
 * Root-cause fix for presence lingering past a finished agent write: the
 * heartbeat-then-write call sites in convex/convexRoomTools.ts (editCell,
 * applyNotebookOutline, applyNotebookBlockEdit) set a presence claim BEFORE
 * the write ("planning" / "checking CAS") but never released it after — so a
 * batch write (e.g. 55 underwriting cells) left every cell "present" for the
 * claim's full TTL (up to 45s) after the agent had moved on. The claim's
 * promise ("I am doing X right now") is false the instant the write's
 * mutation call returns, success or failure alike — so this is called from a
 * try/finally around that call, unconditionally on the outcome. Internal
 * (agent-authenticated, no actorProof) mirroring heartbeatForAgent's own trust
 * boundary — this always runs from inside the same trusted RoomTools context
 * that just wrote the heartbeat.
 */
export const releaseForAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    targetKind: targetKindV,
    targetId: v.string(),
    actor: actorV,
    /** Omit to release every mode (agent_intent + commit_lease) for this target. */
    mode: v.optional(v.union(v.literal("agent_intent"), v.literal("commit_lease"))),
  },
  handler: async (ctx, a) => {
    if (a.actor.kind !== "agent") throw new Error("agent_actor_required");
    const rows = await ctx.db
      .query("presenceClaims")
      .withIndex("by_actor", (q) =>
        q.eq("roomId", a.roomId)
          .eq("artifactId", a.artifactId)
          .eq("actorId", a.actor.id))
      .take(PRESENCE_ROW_CAP);
    let released = 0;
    for (const row of rows) {
      if (row.targetKind !== a.targetKind || row.targetId !== a.targetId) continue;
      if (a.mode && row.mode !== a.mode) continue;
      await ctx.db.delete(row._id);
      released++;
    }
    return { ok: true as const, released };
  },
});

export const clear = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.optional(v.id("artifacts")),
    targetKind: v.optional(targetKindV),
    targetId: v.optional(v.string()),
    mode: v.optional(modeV),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    await assertPresenceAccess(ctx, a.roomId, a.artifactId, actor);
    const rows = await ctx.db
      .query("presenceClaims")
      .withIndex("by_actor", (q) =>
        q.eq("roomId", a.roomId)
          .eq("artifactId", a.artifactId)
          .eq("actorId", actor.id))
      .take(PRESENCE_ROW_CAP);
    let cleared = 0;
    for (const row of rows) {
      if (a.mode && row.mode !== a.mode) continue;
      if (a.targetKind && row.targetKind !== a.targetKind) continue;
      if (a.targetId && row.targetId !== a.targetId) continue;
      await ctx.db.delete(row._id);
      cleared++;
    }
    return { ok: true as const, cleared };
  },
});

export const listForArtifact = query({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    await assertPresenceAccess(ctx, a.roomId, a.artifactId, actor);
    const now = Date.now();
    const rows = await ctx.db
      .query("presenceClaims")
      .withIndex("by_room_artifact", (q) =>
        q.eq("roomId", a.roomId).eq("artifactId", a.artifactId).gte("expiresAt", now))
      .take(PRESENCE_ROW_CAP);
    return rows.map((row) => ({
      id: String(row._id),
      roomId: String(row.roomId),
      artifactId: row.artifactId ? String(row.artifactId) : undefined,
      targetKind: row.targetKind,
      targetId: row.targetId,
      mode: row.mode,
      actor: row.actor,
      label: row.label,
      color: row.color,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    }));
  },
});
