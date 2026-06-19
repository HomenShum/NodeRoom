import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, actorV, requireActorProof, sha256Hex } from "./lib";

const MAX_AUDIT_LIST = 100;

export const record = internalMutation({
  args: {
    roomId: v.id("rooms"),
    actor: actorV,
    event: v.string(),
    subject: v.optional(v.string()),
    payload: v.optional(v.any()),
    previousHash: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ts = args.ts ?? Date.now();
    const recordPayload = {
      roomId: String(args.roomId),
      actor: args.actor,
      event: args.event,
      subject: args.subject,
      payload: args.payload,
      ts,
    };
    const recordHash = await sha256Hex(stableJson({ previousHash: args.previousHash ?? "", record: recordPayload }));
    const traceId = await ctx.db.insert("traces", {
      roomId: args.roomId,
      ts,
      actor: args.actor,
      type: `audit:${args.event}`,
      summary: args.subject ? `${args.event}: ${args.subject}` : args.event,
      detail: stableJson({ ...recordPayload, previousHash: args.previousHash ?? "", recordHash }),
    });
    return { traceId, recordHash };
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const take = Math.min(Math.max(1, Math.floor(limit ?? 50)), MAX_AUDIT_LIST);
    const rows = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(take * 3);
    return rows
      .filter((row) => row.type.startsWith("audit:"))
      .slice(0, take)
      .map((row) => ({
        id: row._id,
        ts: row.ts,
        actor: row.actor,
        type: row.type,
        summary: row.summary,
        detail: row.detail,
      }));
  },
});

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = normalizeForStableJson(input[key]);
    return output;
  }
  return String(value);
}
