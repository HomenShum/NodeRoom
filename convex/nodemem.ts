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

// ─── benchRoomAnswer (benchmark-only: authoritative agent answer for the recall grader) ──────────

/**
 * Read the room's recent agent finalText so the recall benchmark can grade the AUTHORITATIVE answer
 * instead of scraping virtualized sheet rows / chat DOM (which silently miss the agent's output).
 * Env-gated + secret like setNodeMemRoomConfig, so it is inert in production.
 */
export const benchRoomAnswer = query({
  args: { roomId: v.id("rooms"), secret: v.string() },
  handler: async (ctx, args): Promise<{ text: string; done: boolean; jobs: number }> => {
    if (!nodeMemRoomConfigEnabled() || !process.env.NODEMEM_ROOM_CONFIG_SECRET || args.secret !== process.env.NODEMEM_ROOM_CONFIG_SECRET) {
      throw new Error("nodemem_room_config_forbidden");
    }
    const jobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(8);
    const finalTexts = jobs
      .map((j) => (j as { finalText?: string }).finalText ?? "")
      .filter(Boolean)
      .join(" ║ ");
    // The agent often writes the ANSWER to sheet CELLS, not finalText (it just summarizes "written to
    // rows r1-r5"). Collect the room's cell values too so the recall grader sees the real answer.
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(10);
    let cellText = "";
    for (const art of artifacts) {
      const els = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", art._id))
        .take(300);
      cellText += ` ║ ${els.map((e) => (typeof e.value === "string" ? e.value : JSON.stringify(e.value ?? ""))).filter(Boolean).join(" ║ ")}`;
    }
    const text = `${finalTexts} ║ ${cellText}`;
    const done = jobs.some((j) => {
      const job = j as { status?: string; completedAt?: number };
      return job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.completedAt != null;
    });
    return { text, done, jobs: jobs.length };
  },
});

// ─── benchSeedTrace (fair-test only: seed the room's bounded awareness channel) ──────────────────

/**
 * Seed a room `traces` row — the channel awareness() reads (last 6, collab.ts) and the agent's
 * existing context already surfaces. The FAIR value test seeds the SAME facts into BOTH this bounded
 * channel (so the bare agent can see RECENT ones) AND NodeMem episodes, then scales past 6 to show
 * NodeMem recalls what awareness has dropped. Env-gated + secret, inert in production.
 */
export const benchSeedTrace = mutation({
  args: { roomId: v.id("rooms"), type: v.string(), summary: v.string(), ts: v.number(), secret: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (!nodeMemRoomConfigEnabled() || !process.env.NODEMEM_ROOM_CONFIG_SECRET || args.secret !== process.env.NODEMEM_ROOM_CONFIG_SECRET) {
      throw new Error("nodemem_room_config_forbidden");
    }
    await ctx.db.insert("traces", {
      roomId: args.roomId,
      ts: args.ts,
      actor: { kind: "user", id: "bench-member", name: "Mark Liu" },
      type: args.type,
      summary: args.summary,
    });
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

    // Raw episode text by id — the pack MUST carry the actual note (e.g. the "$310 CAC" detail), not
    // only the coarse compiled triple ((entity) mentioned_in (sourceKind)), or nuanced recall is
    // impossible. Bounded read (take 400). Verified by the recall benchmark: compiled facts alone → 0 recall.
    const episodeRows = await ctx.db
      .query("nodeMemEpisodes")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(400);
    const rawById = new Map<string, string>();
    for (const ep of episodeRows) if (ep.rawText) rawById.set(String(ep._id), ep.rawText);
    const snippetFor = (episodeIds: ReadonlyArray<unknown> | undefined, fallback: string): string => {
      for (const eid of episodeIds ?? []) {
        const t = rawById.get(String(eid));
        if (t) return t.length > 240 ? `${t.slice(0, 240)}…` : t;
      }
      return fallback;
    };

    // Content-aware recall: rank RAW episodes by keyword overlap with the goal so the RELEVANT notes
    // reach the pack. The compiled-fact ranking is blind to nuance (every note compiles to the same
    // "(X) mentioned_in (meeting)" triple), so detail-recall needs raw-text matching. These are
    // prepended to the evidence below, ahead of the coarse-fact-derived entries.
    const goalTokens = new Set(args.goal.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? []);
    const STOP = new Set(["the", "and", "for", "what", "which", "did", "does", "this", "that", "with", "from", "note", "company", "mark", "alan"]);
    const scoreText = (text: string): number => {
      let s = 0;
      for (const t of new Set(text.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? [])) {
        if (goalTokens.has(t) && !STOP.has(t)) s++;
      }
      return s;
    };
    const topNoteEntries = episodeRows
      .filter((ep) => ep.rawText)
      .map((ep) => ({ ep, score: scoreText(ep.rawText as string) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((x) => {
        const t = x.ep.rawText as string;
        return {
          factId: `ep_${String(x.ep._id)}`,
          label: "note",
          value: t.length > 240 ? `${t.slice(0, 240)}…` : t,
          sourceRefs: [] as string[],
          confidence: "source_backed",
        };
      });

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
    const evidenceEntries = [
      ...topNoteEntries,
      ...evidence.map((fact) => ({
        factId: String(fact.id),
        label: fact.predicate,
        value: snippetFor(fact.episodeIds, `${fact.predicate}: ${fact.object}`),
        sourceRefs: [] as string[],
        confidence: String(classifyConfidence(fact)),
      })),
    ];

    // Build graph fact entries
    const graphFactEntries = graphOnly.map((fact) => ({
      factId: fact.id,
      statement: snippetFor(fact.episodeIds, `${fact.predicate}: ${fact.object}`),
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
    // Budget-PROPORTIONAL trim. The old fixed top-5+5 made bounded ≡ full regardless of budget; this
    // keeps ~maxTokens/60 entries so a 1200 budget carries ~2× the raw-note evidence a 600 budget does.
    const keep = Math.max(3, Math.floor(maxTokens / 60));
    const trimmedPackJson = tokenEstimate > maxTokens
      ? JSON.stringify({
          goal: args.goal,
          taskKind: plan.taskKind,
          evidence: evidenceEntries.slice(0, keep),
          graphFacts: graphFactEntries.slice(0, keep),
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
