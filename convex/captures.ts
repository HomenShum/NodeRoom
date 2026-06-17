/**
 * Live-capture persistence + read (V8 runtime). The Node action (capturesNode.ts) runs the browser
 * pipeline, stores screenshots in Convex storage, then calls `record` here. `byRoom` returns the
 * captures already shaped as Trace records (screenshot ids resolved to URLs) so the Trace tab renders
 * them with no extra mapping. Reads/writes are gated to room members (requireActorProof).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

const MAX_CAPTURE_RECORDS = 20;

const captureStepV = v.object({
  phase: v.string(),
  label: v.string(),
  status: v.string(),
  detail: v.optional(v.string()),
  box: v.optional(v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() })),
  screenshotId: v.optional(v.id("_storage")),
});

/** Membership gate the action calls BEFORE spending on a capture (admission control — no spend for non-members). */
export const assertMember = internalQuery({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return true;
  },
});

/** Persist a finished capture. Internal — only the action calls it. */
export const record = internalMutation({
  args: {
    roomId: v.id("rooms"),
    url: v.string(),
    goal: v.string(),
    title: v.optional(v.string()),
    ok: v.boolean(),
    error: v.optional(v.string()),
    ts: v.number(),
    steps: v.array(captureStepV),
    data: v.optional(v.any()),
  },
  handler: async (ctx, a) => ctx.db.insert("captureRecords", a),
});

/** Room captures as Trace records, newest first. Screenshot ids resolved to URLs. Members only. */
export const byRoom = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const rows = await ctx.db.query("captureRecords").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(MAX_CAPTURE_RECORDS);
    return Promise.all(rows.map(async (r) => ({
      id: `capture-${r._id}`,
      kind: "agent" as const,
      title: r.title ?? `Live capture · ${safeHost(r.url)}`,
      subtitle: r.goal,
      ts: new Date(r.ts).toISOString(),
      source: { tool: "capture_source" },
      verdict: r.ok ? undefined : { label: "capture failed", tone: "risk" as const },
      steps: await Promise.all(r.steps.map(async (s, i) => {
        const url = s.screenshotId ? await ctx.storage.getUrl(s.screenshotId) : null;
        return {
          idx: i + 1,
          group: s.phase,
          label: s.label,
          status: s.status,
          detail: s.detail,
          attachments: url ? [{ kind: "screenshot" as const, url, ...(s.box ? { box: s.box } : {}) }] : undefined,
        };
      })),
      raw: { url: r.url, data: r.data, error: r.error },
    })));
  },
});

function safeHost(u: string): string { try { return new URL(u).hostname; } catch { return u; } }
