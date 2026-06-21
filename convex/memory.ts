import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

// ---- SoloMemory on Convex (L1-L3) ----
// Audit-safe: held-out task CONTENTS are quarantined at the write. The local SQLite template in the
// skill repo is for portable founder apps; NodeRoom's backend adapter is Convex (FTS via searchIndex,
// vector recall is a follow-up reusing the okf embedding provider). Remember decisions, constraints,
// proofs, and preferences — not benchmark answers.

const evidenceRefV = v.object({
  type: v.string(),
  ref: v.string(),
  note: v.optional(v.string()),
});

export const remember = internalMutation({
  args: {
    roomId: v.id("rooms"),
    projectId: v.string(),
    userId: v.optional(v.string()),
    phase: v.string(),
    kind: v.string(),
    summary: v.string(),
    content: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
    visibility: v.optional(v.string()),
    benchmarkSafety: v.optional(v.string()),
    evidenceRefs: v.optional(v.array(evidenceRefV)),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const safety = a.benchmarkSafety ?? "safe";
    // QUARANTINE — the memory-side mirror of NO-ANSWER-KEYS.
    if (safety === "heldout_forbidden") {
      throw new Error(
        "SoloMemory: refused to persist held-out content. Store only a split hash, aggregate score, or failure class.",
      );
    }
    if (safety === "aggregate_only" && !(a.metadata && a.metadata.aggregateOnly === true)) {
      throw new Error("SoloMemory: aggregate_only memory must set metadata.aggregateOnly=true.");
    }
    // BOUND the write surface — agent loops can call remember() in a tight cycle; cap before a single
    // oversized doc nears Convex's per-document limit and fails the write mid-run.
    if (a.metadata !== undefined && JSON.stringify(a.metadata).length > 16_000) {
      throw new Error("SoloMemory: metadata too large (>16KB). Store a ref/locator, not a blob.");
    }
    const summary = a.summary.slice(0, 2_000);
    const content = (a.content ?? "").slice(0, 20_000);
    const tags = (a.tags ?? []).slice(0, 32).map((t) => t.slice(0, 64));
    const searchText = [summary, content, tags.join(" "), a.phase, a.kind]
      .filter(Boolean)
      .join(" \n ")
      .slice(0, 24_000);
    return ctx.db.insert("memoryEvents", {
      roomId: a.roomId,
      projectId: a.projectId,
      userId: a.userId,
      phase: a.phase,
      kind: a.kind,
      summary,
      content,
      searchText,
      tags,
      importance: a.importance ?? 0.5,
      visibility: a.visibility ?? "project",
      benchmarkSafety: safety,
      evidenceRefs: a.evidenceRefs ?? [],
      metadata: a.metadata,
      createdAt: Date.now(),
    });
  },
});

// Keyword recall via the full-text index (the default path; vector + RRF rerank is a follow-up).
export const search = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    query: v.string(),
    phase: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, requester, query, phase, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const n = Math.min(limit ?? 8, 25);
    return ctx.db
      .query("memoryEvents")
      .withSearchIndex("by_memory_text", (s) => {
        const base = s.search("searchText", query).eq("roomId", roomId);
        return phase ? base.eq("phase", phase) : base;
      })
      .take(n);
  },
});

// Load recent project memory for a phase (the phase-start "re-hydrate" read).
export const recentForPhase = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    phase: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, requester, phase, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const n = Math.min(limit ?? 12, 50);
    return ctx.db
      .query("memoryEvents")
      .withIndex("by_room_phase", (q) => q.eq("roomId", roomId).eq("phase", phase))
      .order("desc")
      .take(n);
  },
});

// Delete a single memory event by id (admin/agent only) — the SoloMemory `forget` tool.
export const forget = internalMutation({
  args: { memoryId: v.id("memoryEvents") },
  handler: async (ctx, { memoryId }) => {
    const m = await ctx.db.get(memoryId);
    if (!m) return { deleted: false };
    await ctx.db.delete(memoryId);
    return { deleted: true };
  },
});
