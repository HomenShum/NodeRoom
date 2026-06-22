/** Shared validators + element/lock helpers used across the room functions. */
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const actorV = v.object({
  kind: v.union(v.literal("user"), v.literal("agent")),
  id: v.string(),
  name: v.string(),
  scope: v.optional(v.union(v.literal("public"), v.literal("private"))),
  ownerId: v.optional(v.string()),
});

export const actorProofV = v.object({
  actor: actorV,
  token: v.optional(v.string()),
});

/**
 * Adversarial-refutation verdict — Tekton pattern, persisted alongside taskResults.
 * An independent verifier in a fresh context window tries to REFUTE each claim;
 * surviving + overturned + uncertain verdicts ALL persist (failures are evidence).
 *
 * Keep this in sync with src/ui/traceLens/types.ts RefutationVerdict.
 */
export const refutationOutcomeV = v.union(
  v.literal("stands"),
  v.literal("refuted"),
  v.literal("uncertain"),
);

export const refutationVerdictV = v.object({
  claimId: v.string(),         // opaque per-record id (idempotency key for upsert)
  claim: v.string(),           // plain-English claim under test
  verdict: refutationOutcomeV,
  confidence: v.number(),      // verifier's confidence in this verdict (0..1)
  correctedValue: v.optional(v.string()), // when verdict==="refuted"
  reasoning: v.string(),       // verifier's plain-English paper trail
  refutedBy: v.optional(v.string()), // banker-facing label of the verifier
  refutedAt: v.optional(v.number()),  // ms epoch (writer fills now())
});

/** BOUND rule cap — max verdicts per taskResult. Above this, oldest are evicted. */
export const REFUTATIONS_MAX_PER_TASK = 100;

export async function getElement(ctx: QueryCtx, artifactId: Id<"artifacts">, elementId: string) {
  return ctx.db
    .query("elements")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", elementId))
    .unique();
}

type DbCtx = QueryCtx | MutationCtx;
export type ActorValue = {
  kind: "user" | "agent";
  id: string;
  name: string;
  scope?: "public" | "private";
  ownerId?: string;
};
type ActorProofValue = {
  actor: ActorValue;
  token?: string;
};
type Env = Record<string, string | undefined>;

export function requireStrongAuthToken(token: string): void {
  if (token.length < 32 || token.length > 512 || /\s/.test(token) || new Set(token).size < 12) {
    throw new Error("weak_auth_token");
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 → lowercase hex. Shared by token hashing and content-hash dedupe so
 *  there is one canonical implementation (no drift between prosemirror.ts and lib). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return hex(new Uint8Array(bytes));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function timingSafeEqualSecret(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return timingSafeEqualHex(left, right);
}

export async function hashToken(token: string): Promise<string> {
  requireStrongAuthToken(token);
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = hex(saltBytes);
  return `v1:${salt}:${await sha256Hex(`${salt}:${token}`)}`;
}

async function verifyTokenHash(token: string, storedHash?: string): Promise<boolean> {
  requireStrongAuthToken(token);
  if (!storedHash) return false;
  if (storedHash?.startsWith("v1:")) {
    const [, salt, expected] = storedHash.split(":");
    return !!salt && !!expected && timingSafeEqualHex(await sha256Hex(`${salt}:${token}`), expected);
  }
  return timingSafeEqualHex(await sha256Hex(token), storedHash);
}

export function sameActor(a: ActorValue, b: ActorValue): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export async function requireArtifactInRoom(ctx: DbCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts">) {
  const art = await ctx.db.get(artifactId);
  if (!art) throw new Error("artifact_not_found");
  if (String(art.roomId) !== String(roomId)) throw new Error("artifact_room_mismatch");
  return art;
}

export async function requireActorInRoom(ctx: DbCtx, roomId: Id<"rooms">, actor: ActorValue) {
  if (actor.kind === "user") {
    const members = await ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const member = members.find((m) => String(m._id) === actor.id);
    if (!member || member.name !== actor.name) throw new Error("actor_not_in_room");
    if (member.revokedAt != null) throw new Error("actor_revoked");
    return;
  }

  const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const session = sessions.find((s) =>
    s.agentId === actor.id &&
    s.agentName === actor.name &&
    (!actor.scope || s.scope === actor.scope) &&
    (!actor.ownerId || s.ownerId === actor.ownerId)
  );
  if (!session) throw new Error("actor_not_in_room");
}

export async function requireActorProof(ctx: DbCtx, roomId: Id<"rooms">, proof: ActorProofValue) {
  const { actor, token } = proof;
  if (actor.kind !== "user") throw new Error("user_proof_required");
  if (actor.scope || actor.ownerId) throw new Error("invalid_user_actor");
  const member = await ctx.db.get(actor.id as Id<"members">);
  if (!member || String(member.roomId) !== String(roomId) || member.name !== actor.name) {
    throw new Error("actor_not_in_room");
  }
  if (member.revokedAt != null) throw new Error("actor_revoked");
  const identity = await ctx.auth.getUserIdentity();
  if (identity && member.authSubject && member.authSubject === identity.subject) {
    return { kind: "user" as const, id: String(member._id), name: member.name };
  }
  if (!token) throw new Error("invalid_actor_token");
  let valid = false;
  try {
    valid = await verifyTokenHash(token, member.authTokenHash);
  } catch {
    throw new Error("invalid_actor_token");
  }
  if (!valid) throw new Error("invalid_actor_token");
  return { kind: "user" as const, id: String(member._id), name: member.name };
}

export async function getRequiredProductionIdentity(ctx: DbCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (productionIdentityRequired() && !identity) throw new Error("production_identity_required");
  return identity;
}

export function productionIdentityRequired(env: Env = runtimeEnv()): boolean {
  return env.NODEROOM_REQUIRE_CONVEX_IDENTITY === "1" || env.REQUIRE_PRODUCTION_IDENTITY === "1";
}

function runtimeEnv(): Env {
  try {
    return typeof process !== "undefined" && process.env ? process.env : {};
  } catch {
    return {};
  }
}

export async function requireAgentSession(ctx: DbCtx, roomId: Id<"rooms">, sessionId: string, actor: ActorValue) {
  if (actor.kind !== "agent") return;
  const session = await ctx.db.get(sessionId as Id<"agentSessions">);
  if (!session || String(session.roomId) !== String(roomId) || session.agentId !== actor.id) {
    throw new Error("agent_session_mismatch");
  }
}

export async function requireActorCanUseChannel(ctx: DbCtx, roomId: Id<"rooms">, actor: ActorValue, channel: string) {
  await requireActorInRoom(ctx, roomId, actor);
  if (channel === "public") return;
  if (actor.kind === "user" && actor.id === channel) return;
  if (actor.kind === "agent" && actor.scope === "private" && actor.ownerId === channel) return;
  throw new Error("channel_forbidden");
}

/** Lock lease TTL — shared by acquisition (locks.ts), write-path renewal + fencing (artifacts.ts),
 *  and the janitor sweep. P0-5: the write path RENEWS this on every successful locked write, so a
 *  healthy long job (9-min slices) never outlives its own lease by accident. */
export const LOCK_TTL_MS = 5 * 60_000;

/** The active lock covering an element, if any (the affected-range read-only). */
export async function activeLockOn(ctx: QueryCtx, artifactId: Id<"artifacts">, elementId: string) {
  const now = Date.now();
  const lock = await lockCoveringElement(ctx, artifactId, elementId);
  // A lock past its lease TTL is treated as gone (the holder crashed/abandoned it) — no cell blocks forever.
  return lock && (lock.expiresAt === undefined || lock.expiresAt > now) ? lock : null;
}

/** P0-5 fencing lookup: the active-status lock covering an element INCLUDING an expired lease.
 *  The write path needs the distinction activeLockOn erases — "my lock, but the lease lapsed" must
 *  surface as lease_expired DATA, not silently degrade into an unlocked write. */
export async function lockCoveringElement(ctx: QueryCtx, artifactId: Id<"artifacts">, elementId: string) {
  const locks = await ctx.db
    .query("locks")
    .withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "active"))
    .collect();
  return locks.find((l) => l.elementIds.includes(elementId)) ?? null;
}
