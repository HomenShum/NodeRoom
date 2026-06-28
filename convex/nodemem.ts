/**
 * NodeMem — Convex shadow mode integration.
 *
 * Phase 2: Append-only episode recording + background ContextPack assembly.
 *
 * Design constraints (from 2026-06-27 PRI redesign):
 * - recordEpisode is FAST: just insert, no compilation, no hot-row patches.
 * - Background compilation runs separately via nodememCompile.ts.
 * - ContextPacks are assembled but NOT injected into agent prompts in shadow mode.
 * - NODEMEM_MODE env var controls behavior:
 *   "off"     → no recording (default)
 *   "shadow"  → record + compile + assemble, but don't inject
 *   "active_ab" → record + compile + assemble + inject (Phase 3)
 */

import { v } from "convex/values";
import { mutation, query, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib";
import { pickRoomNodeMem } from "../src/nodemem/core/roomConfig";
import { compileEpisode } from "../src/nodemem/core/memoryCompiler";
import { planRetrieval, rankFacts } from "../src/nodemem/core/retrievalPlanner";
import { partitionByEvidence, classifyConfidence } from "../src/nodemem/core/evidenceMemory";
import { computeFreshnessSummary } from "../src/nodemem/core/freshness";
import { sha256HexShort } from "../src/nodemem/core/hash";

// ─── Mode helpers ────────────────────────────────────────────────────────────

export type NodeMemMode = "off" | "shadow" | "active_ab";

export function nodeMemMode(): NodeMemMode {
  const raw = process.env.NODEMEM_MODE;
  if (raw === "shadow" || raw === "active_ab") return raw;
  return "off";
}

export function nodeMemRecordingEnabled(): boolean {
  return nodeMemMode() !== "off";
}

export function nodeMemInjectionEnabled(): boolean {
  return nodeMemMode() === "active_ab";
}

/**
 * Per-room NodeMem overrides are only honored when this dev/benchmark flag is set. In production the
 * flag is unset, so every gate keeps its global fast-path (no extra read) and behaves exactly as before.
 */
export function nodeMemRoomConfigEnabled(): boolean {
  return process.env.NODEMEM_ROOM_CONFIG_ENABLED === "1";
}

/**
 * Resolve the effective NodeMem mode + token budget for a room: a per-room override row (dev-only) wins,
 * otherwise fall back to the global NODEMEM_MODE. Reads at most one indexed row, and only when the
 * per-room flag is enabled — production never hits the DB here.
 */
async function resolveRoomNodeMem(
  ctx: Pick<QueryCtx, "db">,
  roomId: Id<"rooms"> | undefined,
): Promise<{ mode: NodeMemMode; maxTokens: number }> {
  if (roomId && nodeMemRoomConfigEnabled()) {
    const cfg = await ctx.db
      .query("nodeMemRoomConfig")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .first();
    if (cfg) {
      const picked = pickRoomNodeMem({ mode: cfg.mode, maxTokens: cfg.maxTokens }, nodeMemMode());
      return { mode: picked.mode as NodeMemMode, maxTokens: picked.maxTokens };
    }
  }
  const picked = pickRoomNodeMem(null, nodeMemMode());
  return { mode: picked.mode as NodeMemMode, maxTokens: picked.maxTokens };
}

// ─── recordEpisode ───────────────────────────────────────────────────────────

export const recordEpisodeArgs = {
  roomId: v.optional(v.id("rooms")),
  workspaceId: v.optional(v.string()),
  actorId: v.optional(v.string()),
  sourceKind: v.string(),
  sourceId: v.string(),
  sourceVersion: v.optional(v.number()),
  visibility: v.string(),
  rawText: v.optional(v.string()),
  rawJson: v.optional(v.string()),
  artifactRefs: v.optional(v.array(v.string())),
};

/**
 * Append-only episode recording. Fast: just insert, no compilation.
 * Deduplicates by content hash — if an episode with the same hash exists, returns its id.
 */
export const recordEpisode = mutation({
  args: recordEpisodeArgs,
  handler: async (ctx, args): Promise<{ episodeId: Id<"nodeMemEpisodes"> | null; duplicate: boolean }> => {
    if (!nodeMemRecordingEnabled() && !nodeMemRoomConfigEnabled()) {
      return { episodeId: null, duplicate: false };
    }
    const resolved = await resolveRoomNodeMem(ctx, args.roomId);
    if (resolved.mode === "off") {
      return { episodeId: null, duplicate: false };
    }

    // Compute content hash
    const payload = JSON.stringify({
      s: args.sourceKind,
      i: args.sourceId,
      v: args.sourceVersion ?? 0,
      t: args.rawText ?? "",
      j: args.rawJson ?? "",
      a: args.artifactRefs ?? [],
    });
    const contentHash = await sha256Hex(payload);

    // Check for duplicate
    const existing = await ctx.db
      .query("nodeMemEpisodes")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
      .first();
    if (existing) {
      return { episodeId: existing._id, duplicate: true };
    }

    // Insert new episode (uncompiled)
    const now = Date.now();
    const episodeId = await ctx.db.insert("nodeMemEpisodes", {
      roomId: args.roomId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      sourceVersion: args.sourceVersion,
      visibility: args.visibility,
      contentHash,
      rawText: args.rawText,
      rawJson: args.rawJson,
      artifactRefs: args.artifactRefs,
      compiled: false,
      createdAt: now,
    });

    return { episodeId, duplicate: false };
  },
});

// ─── setNodeMemRoomConfig (per-room override; dev/benchmark only) ─────────────

/**
 * Set a per-room NodeMem mode + token budget. Gated by NODEMEM_ROOM_CONFIG_ENABLED so it THROWS in
 * production (the flag is only set on the isolated dev/benchmark deployment) — no silent success on
 * a disabled path. Rooms with no config row fall back to the global NODEMEM_MODE, so production
 * behavior is unchanged. Upsert (one row per room) keeps this bounded and idempotent.
 */
export const setNodeMemRoomConfig = mutation({
  args: {
    roomId: v.id("rooms"),
    mode: v.union(v.literal("off"), v.literal("shadow"), v.literal("active_ab")),
    maxTokens: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!nodeMemRoomConfigEnabled()) {
      throw new Error("nodemem_room_config_disabled");
    }
    // Shared-secret auth: even on the enabled (dev/benchmark) deployment, the caller must present the
    // secret set in NODEMEM_ROOM_CONFIG_SECRET. Closes the "anyone who guesses a roomId" abuse gap so
    // the endpoint isn't an open room-state writer if the deployment is ever reachable.
    const expectedSecret = process.env.NODEMEM_ROOM_CONFIG_SECRET;
    if (!expectedSecret || args.secret !== expectedSecret) {
      throw new Error("nodemem_room_config_forbidden");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("nodeMemRoomConfig")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { mode: args.mode, maxTokens: args.maxTokens, updatedAt: now });
    } else {
      await ctx.db.insert("nodeMemRoomConfig", {
        roomId: args.roomId,
        mode: args.mode,
        maxTokens: args.maxTokens,
        setBy: "benchmark",
        updatedAt: now,
      });
    }
    return { ok: true };
  },
});

// ─── compileEpisodeInternal ──────────────────────────────────────────────────

/**
 * Internal mutation: compile a single episode into entities + facts.
 * Called by the background batch compiler (nodememCompile.ts).
 */
export const compileEpisodeInternal = internalQuery({
  args: {
    episodeId: v.id("nodeMemEpisodes"),
  },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId);
    if (!episode || episode.compiled) return null;

    const text = episode.rawText ?? "";
    if (!text) {
      // Mark as compiled with no entities/facts
      return { episode, entities: [], facts: [] };
    }

    // Use the NodeMem compiler (pure function, no LLM)
    const compiled = compileEpisode({
      id: episode._id,
      workspaceId: episode.workspaceId,
      roomId: episode.roomId ? String(episode.roomId) : undefined,
      actorId: episode.actorId,
      sourceKind: episode.sourceKind as never,
      sourceId: episode.sourceId,
      sourceVersion: episode.sourceVersion,
      visibility: episode.visibility as never,
      contentHash: episode.contentHash,
      rawText: episode.rawText,
      rawJson: episode.rawJson,
      artifactRefs: episode.artifactRefs,
      createdAt: episode.createdAt,
    });

    return { episode, entities: compiled.entities, facts: compiled.facts };
  },
});

// ─── assembleContextPackForJob ───────────────────────────────────────────────

export const assembleContextPackForJobArgs = {
  roomId: v.id("rooms"),
  jobId: v.optional(v.id("agentJobs")),
  goal: v.string(),
  userId: v.string(),
  entityKeys: v.optional(v.array(v.string())),
  maxFacts: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
};

/**
 * Assemble a ContextPack for a job — reads from compiled entities + facts.
 * In shadow mode: stores the pack but does NOT inject it.
 * In active_ab mode: stores the pack AND returns it for injection.
 */
export const assembleContextPackForJob = query({
  args: assembleContextPackForJobArgs,
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled() && !nodeMemRoomConfigEnabled()) return null;
    const resolved = await resolveRoomNodeMem(ctx, args.roomId);
    // Injection happens only in active_ab; shadow records/compiles but never injects.
    if (resolved.mode !== "active_ab") return null;

    // Gather entities for this room
    const entities = await ctx.db
      .query("nodeMemEntities")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    // Gather facts for this room
    let facts = await ctx.db
      .query("nodeMemFacts")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    // Filter by entity keys if provided
    if (args.entityKeys?.length) {
      const keySet = new Set(args.entityKeys);
      facts = facts.filter((f) => keySet.has(f.subjectEntityId));
    }

    // Plan retrieval
    const plan = planRetrieval({
      goal: args.goal,
      roomId: String(args.roomId),
      userId: args.userId,
      entityKeys: args.entityKeys,
      visibility: "room",
      maxFacts: args.maxFacts ?? 30,
    });

    // Rank facts
    const now = Date.now();
    const rankedFacts = rankFacts(
      facts.map((f) => ({
        id: f._id,
        workspaceId: f.workspaceId,
        roomId: f.roomId ? String(f.roomId) : undefined,
        subjectEntityId: f.subjectEntityId,
        predicate: f.predicate,
        object: f.object,
        status: f.status as never,
        validFrom: f.validFrom,
        validTo: f.validTo,
        evidenceFactIds: f.evidenceFactIds,
        episodeIds: f.episodeIds,
        confidence: f.confidence,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      plan,
      now,
    );

    // Partition by evidence
    const rankedFactObjects = rankedFacts.map((s) => s.fact);
    const { evidence, graphOnly } = partitionByEvidence(rankedFactObjects);

    // Build evidence entries
    const evidenceEntries = evidence.map((fact) => ({
      factId: fact.id,
      label: fact.predicate,
      value: fact.object,
      sourceRefs: fact.evidenceFactIds,
      confidence: classifyConfidence(fact),
    }));

    // Build graph fact entries
    const graphFactEntries = graphOnly.map((fact) => ({
      factId: fact.id,
      statement: `${fact.predicate}: ${fact.object}`,
      status: fact.status,
      validFrom: fact.validFrom,
      validTo: fact.validTo,
      provenance: fact.episodeIds,
    }));

    // Compute freshness
    const freshness = computeFreshnessSummary(rankedFactObjects, { now });

    // Build open questions
    const openQuestions = graphOnly
      .filter((f) => f.status === "needs_review")
      .map((f) => `Verify: ${f.predicate} for ${f.subjectEntityId}`)
      .slice(0, 5);

    // Token estimate (approx 4 chars/token)
    const packJson = JSON.stringify({
      goal: args.goal,
      taskKind: plan.taskKind,
      evidence: evidenceEntries,
      graphFacts: graphFactEntries,
      freshness,
      openQuestions,
    });
    const tokenEstimate = Math.ceil(packJson.length / 4);

    // Apply token budget — caller override wins, else the per-room resolved budget (600 bounded / 1200 full).
    const maxTokens = args.maxTokens ?? resolved.maxTokens;
    const trimmedPackJson = tokenEstimate > maxTokens
      ? JSON.stringify({
          goal: args.goal,
          taskKind: plan.taskKind,
          evidence: evidenceEntries.slice(0, 5),
          graphFacts: graphFactEntries.slice(0, 5),
          freshness,
          openQuestions: openQuestions.slice(0, 3),
          _trimmed: true,
        })
      : packJson;
    const trimmedTokenEstimate = Math.ceil(trimmedPackJson.length / 4);

    const packId = await sha256HexShort(
      JSON.stringify({ goal: args.goal, taskKind: plan.taskKind, entityCount: entities.length, now }),
      32,
    );

    return {
      packId: `cp_${packId}`,
      goal: args.goal,
      taskKind: plan.taskKind,
      evidence: evidenceEntries,
      graphFacts: graphFactEntries,
      freshness,
      openQuestions,
      tokenEstimate: trimmedTokenEstimate,
      packJson: trimmedPackJson,
      maxTokensBudget: maxTokens,
      mode: resolved.mode,
    };
  },
});

// ─── listUncompiledEpisodes ──────────────────────────────────────────────────

// internalQuery (not public): only the compile batch action calls this, via internal.*.
// Was `query` — the circular-inference `any` masked that the call site used `internal.*`.
export const listUncompiledEpisodes = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled() && !nodeMemRoomConfigEnabled()) return [];
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("nodeMemEpisodes")
      .withIndex("by_uncompiled", (q) => q.eq("compiled", false))
      .order("asc")
      .take(limit);
  },
});

// ─── listEpisodesByRoom ──────────────────────────────────────────────────────

export const listEpisodesByRoom = query({
  args: {
    roomId: v.id("rooms"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled()) return [];
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("nodeMemEpisodes")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(limit);
  },
});

// ─── listEntitiesByRoom ──────────────────────────────────────────────────────

export const listEntitiesByRoom = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled()) return [];
    return await ctx.db
      .query("nodeMemEntities")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
  },
});

// ─── listFactsByRoom ─────────────────────────────────────────────────────────

export const listFactsByRoom = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled()) return [];
    return await ctx.db
      .query("nodeMemFacts")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
  },
});

// ─── listContextPacksByRoom ──────────────────────────────────────────────────

export const listContextPacksByRoom = query({
  args: {
    roomId: v.id("rooms"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled() && !nodeMemRoomConfigEnabled()) return [];
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("nodeMemContextPacks")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(limit);
  },
});

// ─── nodeMemStats ────────────────────────────────────────────────────────────

export const nodeMemStats = query({
  args: {
    roomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    if (!nodeMemRecordingEnabled() && !nodeMemRoomConfigEnabled()) {
      return { mode: "off", episodes: 0, entities: 0, facts: 0, contextPacks: 0, uncompiled: 0 };
    }
    const resolved = await resolveRoomNodeMem(ctx, args.roomId);
    if (resolved.mode === "off") {
      return { mode: "off", episodes: 0, entities: 0, facts: 0, contextPacks: 0, uncompiled: 0 };
    }

    if (args.roomId) {
      const episodes = await ctx.db
        .query("nodeMemEpisodes")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      const entities = await ctx.db
        .query("nodeMemEntities")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      const facts = await ctx.db
        .query("nodeMemFacts")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      const contextPacks = await ctx.db
        .query("nodeMemContextPacks")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      const uncompiled = episodes.filter((e) => !e.compiled).length;
      return {
        mode: resolved.mode,
        episodes: episodes.length,
        entities: entities.length,
        facts: facts.length,
        contextPacks: contextPacks.length,
        uncompiled,
      };
    }

    // Global stats
    const uncompiled = await ctx.db
      .query("nodeMemEpisodes")
      .withIndex("by_uncompiled", (q) => q.eq("compiled", false))
      .take(1000);
    return {
      mode: resolved.mode,
      episodes: -1, // would need full scan
      entities: -1,
      facts: -1,
      contextPacks: -1,
      uncompiled: uncompiled.length,
    };
  },
});
