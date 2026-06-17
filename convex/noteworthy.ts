import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { actorProofV, requireActorProof } from "./lib";

const sourceKindV = v.union(
  v.literal("node"),
  v.literal("artifact_element"),
  v.literal("message"),
  v.literal("wiki_revision"),
);

const eventKindV = v.union(
  v.literal("content_committed"),
  v.literal("idle_after_typing"),
  v.literal("page_hidden"),
  v.literal("manual_save"),
  v.literal("artifact_imported"),
);

/**
 * Keyed server-side debounce for passive room intelligence.
 *
 * Client/editor code should call this after a durable node/cell/wiki/message write, not on every
 * keystroke. We persist the latest content hash and schedule one scan. Subsequent calls for the
 * same source cancel the prior scheduled scan and move the scan forward.
 */
export const debounceActivityScan = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    sourceKind: sourceKindV,
    sourceId: v.string(),
    sourceVersion: v.number(),
    sourceHash: v.string(),
    visibility: v.union(v.literal("private"), v.literal("room"), v.literal("public")),
    ownerId: v.optional(v.string()),
    eventKind: eventKindV,
    debounceMs: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const now = Date.now();
    const waitMs = Math.max(1_000, Math.min(a.debounceMs ?? 12_000, 120_000));
    const existing = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_source", (q) => q.eq("roomId", a.roomId).eq("sourceKind", a.sourceKind).eq("sourceId", a.sourceId))
      .unique();

    if (existing?.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledFunctionId);
      } catch {
        // Best-effort: if it already started, the scanner will re-check sourceVersion/sourceHash.
      }
    }

    const runAt = now + waitMs;
    const scheduledFunctionId = await ctx.scheduler.runAt(runAt, internal.noteworthy.scanActivity, {
      roomId: a.roomId,
      sourceKind: a.sourceKind,
      sourceId: a.sourceId,
      expectedVersion: a.sourceVersion,
      expectedHash: a.sourceHash,
    });

    const patch = {
      sourceVersion: a.sourceVersion,
      sourceHash: a.sourceHash,
      actor,
      visibility: a.visibility,
      ownerId: a.ownerId,
      eventKind: a.eventKind,
      status: "queued" as const,
      attempts: existing ? existing.attempts : 0,
      nextRunAt: runAt,
      scheduledFunctionId,
      error: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { outboxId: existing._id, scheduledFunctionId };
    }

    const outboxId = await ctx.db.insert("roomActivityOutbox", {
      roomId: a.roomId,
      sourceKind: a.sourceKind,
      sourceId: a.sourceId,
      createdAt: now,
      ...patch,
    });
    return { outboxId, scheduledFunctionId };
  },
});

export const scanActivity = internalMutation({
  args: {
    roomId: v.id("rooms"),
    sourceKind: sourceKindV,
    sourceId: v.string(),
    expectedVersion: v.number(),
    expectedHash: v.string(),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_source", (q) => q.eq("roomId", a.roomId).eq("sourceKind", a.sourceKind).eq("sourceId", a.sourceId))
      .unique();
    if (!row) return { ok: false, reason: "missing_outbox" };
    if (row.sourceVersion !== a.expectedVersion || row.sourceHash !== a.expectedHash) {
      return { ok: false, reason: "superseded" };
    }

    const now = Date.now();
    await ctx.db.patch(row._id, { status: "scanning", attempts: row.attempts + 1, updatedAt: now });

    const text = await readSourceText(ctx, a.roomId, a.sourceKind, a.sourceId);
    if (!text || text.trim().length < 12) {
      await ctx.db.patch(row._id, { status: "not_noteworthy", updatedAt: Date.now(), error: "empty_or_too_short" });
      return { ok: true, noteworthy: false };
    }

    const finding = classifyNoteworthy(text);
    if (finding.score < 0.35) {
      await ctx.db.patch(row._id, { status: "not_noteworthy", finding, updatedAt: Date.now() });
      return { ok: true, noteworthy: false, finding };
    }

    await ctx.db.patch(row._id, { status: "noteworthy", finding, updatedAt: Date.now() });

    // P0: create durable entity work items only; higher-cost research jobs can attach to these.
    // This keeps passive intelligence cheap and lets a workflow/workpool process stale/missing facets later.
    for (const entity of finding.entities) {
      for (const facet of finding.facets.length ? finding.facets : ["profile"]) {
        const idempotencyKey = `passive:${a.roomId}:${a.sourceKind}:${a.sourceId}:${entity.entityKey}:${facet}:${a.expectedHash}`;
        const existing = await ctx.db
          .query("entityWorkItems")
          .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
          .unique();
        if (existing) continue;

        await ctx.db.insert("entityWorkItems", {
          roomId: a.roomId,
          artifactId: await firstArtifactId(ctx, a.roomId),
          jobId: undefined as any,
          requester: row.actor,
          visibility: row.visibility === "private" ? "private" : "public",
          ownerId: row.ownerId,
          entityType: entity.type,
          entityKey: entity.entityKey,
          displayName: entity.displayName,
          facet,
          status: "queued",
          cachePolicy: finding.action === "index_only" ? "manual_only_do_not_research" : "missing_research_now",
          idempotencyKey,
          plan: { sourceKind: a.sourceKind, sourceId: a.sourceId, reasons: finding.reasons, textPreview: text.slice(0, 500) },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(row._id, { status: "job_created", updatedAt: Date.now() });
    return { ok: true, noteworthy: true, finding };
  },
});

export const listRoomActivity = internalQuery({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    return await ctx.db.query("roomActivityOutbox").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(Math.max(1, Math.min(a.limit ?? 50, 200)));
  },
});

async function firstArtifactId(ctx: any, roomId: any) {
  const artifact = await ctx.db.query("artifacts").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first();
  if (!artifact) throw new Error("room_has_no_artifact_for_entity_work");
  return artifact._id;
}

async function readSourceText(ctx: any, roomId: any, sourceKind: string, sourceId: string): Promise<string | null> {
  if (sourceKind === "node") {
    const node = await ctx.db.get(sourceId as any);
    return node && String(node.roomId) === String(roomId) ? node.content : null;
  }
  if (sourceKind === "artifact_element") {
    const [artifactId, elementId] = sourceId.split(":");
    if (!artifactId || !elementId) return null;
    const artifact = await ctx.db.get(artifactId as any);
    if (!artifact || String(artifact.roomId) !== String(roomId)) return null;
    const element = await ctx.db.query("elements").withIndex("by_artifact", (q: any) => q.eq("artifactId", artifact._id).eq("elementId", elementId)).unique();
    return element ? stringifyValue(element.value) : null;
  }
  if (sourceKind === "message") {
    const message = await ctx.db.get(sourceId as any);
    return message && String(message.roomId) === String(roomId) ? message.text : null;
  }
  if (sourceKind === "wiki_revision") {
    const revision = await ctx.db.get(sourceId as any);
    return revision && String(revision.roomId) === String(roomId) ? revision.content : null;
  }
  return null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) return stringifyValue((value as Record<string, unknown>).value);
  return JSON.stringify(value ?? "");
}

function classifyNoteworthy(text: string) {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  const facets = new Set<string>();

  if (/\b(inc|corp|labs|health|bio|ai|technologies|systems|capital|ventures)\b/i.test(text)) reasons.push("company_mention");
  if (/\b(met|spoke|talked|call|founder|ceo|cfo|maya|contact)\b/i.test(text)) reasons.push("person_or_interaction");
  if (/\b(series\s+[a-z]|seed|funding|raise|runway|burn|arr|revenue|ebitda|margin)\b/i.test(text)) { reasons.push("finance_signal"); facets.add("funding"); facets.add("runway"); }
  if (/\b(product|launch|announced|customer|pilot|hospital|pricing|competitor|headwind|market)\b/i.test(text)) { reasons.push("research_signal"); facets.add("product"); facets.add("competitors"); }
  if (/\b(verify|source|follow\s*up|ask|research|find|confirm|todo|next step)\b/i.test(text)) { reasons.push("open_question_or_task"); facets.add("source_validation"); }
  if (/https:\/\//.test(text)) reasons.push("source_url");

  const candidates = [...text.matchAll(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/g)]
    .map((m) => m[1])
    .filter((name) => !["Series", "Next", "The", "This", "Convex", "NodeRoom"].includes(name));
  const displayName = candidates[0] ?? "unknown";
  const entityType = lower.includes("founder") || lower.includes("ceo") || lower.includes("cfo") ? "person" : "company";
  const score = Math.min(1, 0.18 + reasons.length * 0.18 + (candidates.length ? 0.18 : 0));

  return {
    score,
    action: score >= 0.75 ? "start_research_job" : score >= 0.55 ? "create_coach_cue" : score >= 0.35 ? "index_only" : "ignore",
    reasons,
    facets: [...facets],
    entities: candidates.length ? [{ type: entityType, displayName, entityKey: normalizeEntityKey(displayName), confidence: Math.min(0.95, 0.55 + reasons.length * 0.1) }] : [],
  };
}

function normalizeEntityKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
