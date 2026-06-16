import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";

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
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
const DIMENSION = 64;

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function embeddingVector(text: string, dimension = DIMENSION): number[] {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9_.$%-]+/g) ?? [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
    const idx = Math.abs(hash) % dimension;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) || 1;
  return vector.map((n) => Number((n / norm).toFixed(6)));
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export async function enqueueEmbeddingJob(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  sourceKind: "notebook" | "node" | "relation" | "artifact" | "element" | "range" | "wiki_page" | "wiki_block";
  sourceId: string;
  content: string;
  jobId?: Id<"agentJobs">;
}) {
  const contentHash = await sha256hex(args.content);
  const prior = await ctx.db.query("embeddingJobs").withIndex("by_source_hash", (q) =>
    q.eq("roomId", args.roomId).eq("sourceKind", args.sourceKind).eq("sourceId", args.sourceId).eq("contentHash", contentHash)
  ).unique();
  if (prior && (prior.status === "queued" || prior.status === "running" || prior.status === "completed")) return prior._id;
  const now = Date.now();
  return ctx.db.insert("embeddingJobs", clean({
    roomId: args.roomId,
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    contentHash,
    status: "queued",
    attempts: 0,
    nextRunAt: now,
    createdByJobId: args.jobId,
    createdAt: now,
    updatedAt: now,
  }));
}

async function readSource(ctx: QueryCtx | MutationCtx, job: {
  roomId: Id<"rooms">;
  sourceKind: string;
  sourceId: string;
  contentHash: string;
}) {
  if (job.sourceKind === "node") {
    const node = await ctx.db.get(job.sourceId as Id<"nodes">);
    if (!node || String(node.roomId) !== String(job.roomId) || node.isDeleted) return null;
    const content = `${node.title ?? ""}\n${node.content}`;
    if (await sha256hex(content) !== job.contentHash) return null;
    return { content, sourceVersion: node.version, visibility: node.visibility };
  }
  if (job.sourceKind === "artifact") {
    const artifact = await ctx.db.get(job.sourceId as Id<"artifacts">);
    if (!artifact || String(artifact.roomId) !== String(job.roomId)) return null;
    const content = `${artifact.title}\n${JSON.stringify(artifact.meta ?? {})}`;
    if (await sha256hex(content) !== job.contentHash) return null;
    return { content, sourceVersion: artifact.version, visibility: "room" as const };
  }
  if (job.sourceKind === "wiki_page") {
    const page = await ctx.db.get(job.sourceId as Id<"wikiPages">);
    if (!page || String(page.roomId) !== String(job.roomId)) return null;
    const revision = page.latestRevisionId
      ? (await ctx.db.query("wikiRevisions").withIndex("by_page", (q) => q.eq("wikiPageId", page._id)).collect()).find((r) => r.revisionId === page.latestRevisionId)
      : null;
    const content = `${page.title}\n${revision?.content ?? ""}`;
    if (await sha256hex(content) !== job.contentHash) return null;
    return { content, sourceVersion: page.version, visibility: page.visibility };
  }
  return null;
}

export const enqueueForSource = mutation({
  args: {
    roomId: v.id("rooms"),
    sourceKind: graphObjectKindV,
    sourceId: v.string(),
    content: v.string(),
    requester: actorProofV,
    jobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, a) => {
    await requireActorProof(ctx, a.roomId, a.requester);
    return enqueueEmbeddingJob(ctx, a);
  },
});

export const claimNext = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("embeddingJobs").withIndex("by_status_nextRunAt", (q) => q.eq("status", "queued")).order("asc").take(20);
    const job = due.find((j) => (j.nextRunAt ?? 0) <= now);
    if (!job) return null;
    const source = await readSource(ctx, job);
    if (!source) {
      await ctx.db.patch(job._id, { status: "failed", attempts: job.attempts + 1, error: "source_changed_or_missing", updatedAt: now });
      return null;
    }
    await ctx.db.patch(job._id, { status: "running", attempts: job.attempts + 1, updatedAt: now });
    return { jobId: job._id, roomId: job.roomId, sourceKind: job.sourceKind, sourceId: job.sourceId, contentHash: job.contentHash, ...source };
  },
});

export const upsertForSource = internalMutation({
  args: {
    jobId: v.id("embeddingJobs"),
    roomId: v.id("rooms"),
    sourceKind: graphObjectKindV,
    sourceId: v.string(),
    sourceVersion: v.number(),
    contentHash: v.string(),
    provider: v.string(),
    model: v.string(),
    dimension: v.number(),
    vector: v.array(v.number()),
    visibility: visibilityV,
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || String(job.roomId) !== String(a.roomId) || job.contentHash !== a.contentHash) return { ok: false as const, reason: "job_mismatch" as const };
    const existing = await ctx.db.query("embeddings").withIndex("by_source", (q) =>
      q.eq("roomId", a.roomId).eq("sourceKind", a.sourceKind).eq("sourceId", a.sourceId)
    ).collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await ctx.db.insert("embeddings", {
      roomId: a.roomId,
      sourceKind: a.sourceKind,
      sourceId: a.sourceId,
      sourceVersion: a.sourceVersion,
      contentHash: a.contentHash,
      provider: a.provider,
      model: a.model,
      dimension: a.dimension,
      vector: a.vector,
      visibility: a.visibility,
      createdAt: Date.now(),
    });
    await ctx.db.patch(a.jobId, { status: "completed", updatedAt: Date.now(), error: undefined });
    return { ok: true as const };
  },
});

export const markFailed = internalMutation({
  args: { jobId: v.id("embeddingJobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const };
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "queued",
      error,
      nextRunAt: now + Math.min(5 * 60_000, 2 ** Math.min(job.attempts, 8) * 1_000),
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const tombstoneForSource = internalMutation({
  args: { roomId: v.id("rooms"), sourceKind: graphObjectKindV, sourceId: v.string() },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("embeddings").withIndex("by_source", (q) =>
      q.eq("roomId", a.roomId).eq("sourceKind", a.sourceKind).eq("sourceId", a.sourceId)
    ).collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});

export const searchVisible = query({
  args: { roomId: v.id("rooms"), query: v.string(), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, query, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const qv = embeddingVector(query);
    const capped = Math.max(1, Math.min(limit ?? 8, 25));
    const rows = await ctx.db.query("embeddings").withIndex("by_content_hash", (q) => q.eq("roomId", roomId)).take(500);
    return rows
      .map((row) => ({ sourceKind: row.sourceKind, sourceId: row.sourceId, sourceVersion: row.sourceVersion, score: Number(cosine(qv, row.vector).toFixed(4)), provider: row.provider, model: row.model }))
      .sort((a, b) => b.score - a.score)
      .slice(0, capped);
  },
});
