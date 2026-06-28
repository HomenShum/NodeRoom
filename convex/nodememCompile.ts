/**
 * NodeMem — Background batch compilation.
 *
 * Compiles uncompiled episodes into entities + facts.
 * Runs as a scheduled action, NOT inside a hot mutation.
 *
 * Design constraints:
 * - Batch size is bounded (default 20 episodes per run).
 * - Each episode is compiled in its own mutation to avoid OCC conflicts.
 * - No LLM calls — pure deterministic compilation.
 * - Idempotent: if an episode is already compiled, skip it.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, action } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { nodeMemMode, nodeMemRoomConfigEnabled } from "./nodemem";
import { compileEpisode } from "../src/nodemem/core/memoryCompiler";

const DEFAULT_BATCH_SIZE = 20;

// ─── compileOneEpisode (internal mutation) ───────────────────────────────────

/**
 * Compile a single episode: extract entities + facts, insert them,
 * and mark the episode as compiled.
 *
 * This is a separate mutation so each episode compiles independently —
 * no OCC conflicts from concurrent compilation.
 */
export const compileOneEpisode = internalMutation({
  args: {
    episodeId: v.id("nodeMemEpisodes"),
  },
  handler: async (ctx, args) => {
    if (nodeMemMode() === "off" && !nodeMemRoomConfigEnabled()) return { compiled: false, reason: "mode_off" };

    const episode = await ctx.db.get(args.episodeId);
    if (!episode) return { compiled: false, reason: "not_found" };
    if (episode.compiled) return { compiled: false, reason: "already_compiled" };

    const text = episode.rawText ?? "";
    if (!text) {
      await ctx.db.patch(args.episodeId, { compiled: true, compiledAt: Date.now() });
      return { compiled: true, reason: "empty_text", entities: 0, facts: 0 };
    }

    // Compile using NodeMem core (pure function, no LLM)
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

    // Insert entities (upsert by id)
    for (const entity of compiled.entities) {
      const existing = await ctx.db
        .query("nodeMemEntities")
        .withIndex("by_room_name", (q) =>
          q.eq("roomId", episode.roomId!).eq("canonicalName", entity.canonicalName),
        )
        .first();

      if (existing) {
        // Merge: update aliases, sourceRefs, confidence, lastSeenAt
        await ctx.db.patch(existing._id, {
          aliases: [...new Set([...existing.aliases, ...entity.aliases])],
          sourceRefs: [...new Set([...existing.sourceRefs, ...entity.sourceRefs])],
          confidence: Math.max(existing.confidence, entity.confidence),
          lastSeenAt: Date.now(),
        });
      } else {
        await ctx.db.insert("nodeMemEntities", {
          roomId: episode.roomId,
          workspaceId: episode.workspaceId,
          kind: entity.kind,
          canonicalName: entity.canonicalName,
          aliases: entity.aliases,
          summary: entity.summary,
          confidence: entity.confidence,
          lastSeenAt: entity.lastSeenAt,
          sourceRefs: entity.sourceRefs,
        });
      }
    }

    // Insert facts
    for (const fact of compiled.facts) {
      await ctx.db.insert("nodeMemFacts", {
        roomId: episode.roomId,
        workspaceId: episode.workspaceId,
        subjectEntityId: fact.subjectEntityId,
        predicate: fact.predicate,
        object: fact.object,
        status: fact.status,
        validFrom: fact.validFrom,
        validTo: fact.validTo,
        evidenceFactIds: fact.evidenceFactIds,
        episodeIds: fact.episodeIds,
        confidence: fact.confidence,
        createdAt: fact.createdAt,
        updatedAt: fact.updatedAt,
      });
    }

    // Mark episode as compiled
    await ctx.db.patch(args.episodeId, { compiled: true, compiledAt: Date.now() });

    return {
      compiled: true,
      reason: "ok",
      entities: compiled.entities.length,
      facts: compiled.facts.length,
    };
  },
});

// ─── compileBatch (internal action) ──────────────────────────────────────────

/**
 * Background batch compilation action.
 * Fetches uncompiled episodes and compiles them one by one.
 *
 * Intended to be called by a cron job or manual trigger.
 * NOT called from hot mutations.
 */
export const compileBatch = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  // Explicit return type breaks the api self-reference cycle (TS7022/7023) that otherwise
  // makes this handler — and compileBatchManual below — infer to `any`.
  handler: async (ctx, args): Promise<{ compiled: number; skipped: number; errors: number; total?: number }> => {
    if (nodeMemMode() === "off" && !nodeMemRoomConfigEnabled()) {
      return { compiled: 0, skipped: 0, errors: 0 };
    }

    const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;

    // Fetch uncompiled episodes
    const uncompiled: Doc<"nodeMemEpisodes">[] = await ctx.runQuery(internal.nodemem.listUncompiledEpisodes, {
      limit: batchSize,
    });

    if (!uncompiled.length) {
      return { compiled: 0, skipped: 0, errors: 0 };
    }

    let compiled = 0;
    let skipped = 0;
    let errors = 0;

    for (const episode of uncompiled) {
      try {
        const result = await ctx.runMutation(internal.nodememCompile.compileOneEpisode, {
          episodeId: episode._id as Id<"nodeMemEpisodes">,
        });
        if (result.compiled) {
          compiled++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error("[nodememCompile] Failed to compile episode:", episode._id, err);
        errors++;
      }
    }

    return { compiled, skipped, errors, total: uncompiled.length };
  },
});

// ─── compileBatchManual (public action for manual trigger) ───────────────────

export const compileBatchManual = action({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ compiled: number; skipped: number; errors: number; total?: number }> => {
    return await ctx.runAction(internal.nodememCompile.compileBatch, {
      batchSize: args.batchSize,
    });
  },
});
