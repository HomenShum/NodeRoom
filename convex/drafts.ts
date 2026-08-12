/**
 * The backend for the create_draft tool + the smart-merge.
 *
 * A draft is what a blocked actor produces: it read a locked range as context and
 * queued ops to apply once the lock lifts. `mergeBlockedDrafts` is the
 * deterministic resolver (the LLM-resolver seam): for each op, clean-apply if the
 * element is still at the drafted baseline, no-op if it already holds the value,
 * and FLAG-don't-apply if it diverged — so committed work is never clobbered.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, actorV, activeLockOn, getElement, LOCK_TTL_MS, requireActiveAgentJobLease, requireActorInRoom, requireActorProof, requireArtifactInRoom, sameActor } from "./lib";

const opV = v.object({
  opId: v.string(),
  artifactId: v.string(),
  elementId: v.string(),
  kind: v.union(v.literal("set"), v.literal("create"), v.literal("delete")),
  value: v.optional(v.any()),
  baseVersion: v.number(),
});

export const createDraft = internalMutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), jobId: v.optional(v.id("agentJobs")), leaseId: v.optional(v.string()), author: actorV, ops: v.array(opV), note: v.string(), blockedByLockId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.author);
    await requireActiveAgentJobLease(ctx, a);
    const now = Date.now();
    const draftId = await ctx.db.insert("drafts", { roomId: a.roomId, artifactId: a.artifactId, jobId: a.jobId, author: a.author, ops: a.ops, note: a.note, blockedByLockId: a.blockedByLockId, status: "pending", createdAt: now });
    const note = a.author.scope === "private" ? "[private draft]" : a.note;
    await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor: a.author, type: "draft_created", summary: `${a.author.name} drafted ${a.ops.length} change(s): ${note}`, detail: `create_draft · ${a.ops.length} ops · blockedBy ${a.blockedByLockId ?? "—"}`, refs: { artifactId: String(a.artifactId) } });
    return { draftId };
  },
});

export const runSemanticConflictDrill = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    elementId: v.optional(v.string()),
    currentValue: v.optional(v.any()),
    proposedValue: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (member?.role !== "host") throw new Error("host_required");
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    const elementId = a.elementId ?? "r_rev__variance";
    const existingLock = await activeLockOn(ctx, a.artifactId, elementId);
    if (existingLock) return { ok: false as const, reason: "locked" as const };

    const now = Date.now();
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).collect();
    if (!sessions.some((s) => s.agentId === agent.id && s.agentName === agent.name && s.scope === "public")) {
      await ctx.db.insert("agentSessions", {
        roomId: a.roomId,
        agentId: agent.id,
        agentName: agent.name,
        scope: "public",
        status: "drafting",
        lastAction: "semantic rebase drill",
        updatedAt: now,
      });
    }

    const currentValue = a.currentValue ?? "+24%";
    const proposedValue = a.proposedValue ?? "+19%";
    const current = await getElement(ctx, a.artifactId, elementId);
    const baseVersion = current?.version ?? 0;
    const lockId = await ctx.db.insert("locks", {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementIds: [elementId],
      holder: actor,
      sessionId: `host-crs-drill-${now}`,
      reason: "host reviewing semantic rebase drill",
      status: "active",
      createdAt: now,
      expiresAt: now + LOCK_TTL_MS,
    });

    await ctx.db.insert("drafts", {
      roomId: a.roomId,
      artifactId: a.artifactId,
      author: agent,
      ops: [{
        opId: `semantic-drill-${now}`,
        artifactId: String(a.artifactId),
        elementId,
        kind: "set" as const,
        value: proposedValue,
        baseVersion,
      }],
      note: "semantic rebase drill",
      blockedByLockId: String(lockId),
      status: "pending",
      createdAt: now,
    });

    const nextOrder = artifact.order.includes(elementId) ? artifact.order : [...artifact.order, elementId];
    if (current) {
      await ctx.db.patch(current._id, { value: currentValue, version: current.version + 1, updatedAt: now, updatedBy: actor });
    } else {
      await ctx.db.insert("elements", { artifactId: a.artifactId, elementId, value: currentValue, version: 1, updatedAt: now, updatedBy: actor });
    }
    await ctx.db.patch(a.artifactId, {
      version: artifact.version + 1,
      updatedAt: now,
      ...(nextOrder === artifact.order ? {} : { order: nextOrder }),
    });
    await ctx.db.patch(lockId, { status: "released", releasedAt: now });

    const merged = await mergeBlockedDrafts(ctx, a.roomId, String(lockId));
    const proposalIds = merged.flatMap((result) => result.proposalIds ?? []);
    if (proposalIds.length) {
      await ctx.db.insert("traces", {
        roomId: a.roomId,
        ts: now,
        actor: agent,
        type: "semantic_conflict",
        summary: `Semantic rebase opened for ${elementId}`,
        detail: `semantic_rebase - current ${JSON.stringify(currentValue)} - proposed ${JSON.stringify(proposedValue)}`,
      });
    }
    return { ok: true as const, merged, proposalIds };
  },
});

export async function mergeBlockedDrafts(ctx: MutationCtx, roomId: Id<"rooms">, lockId: string) {
  const drafts = await ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect();
  const now = Date.now();
  const results: { draftId: Id<"drafts">; verdict: string; applied: number; conflicts: number; proposalIds?: Id<"proposals">[] }[] = [];

  for (const d of drafts) {
    if (d.blockedByLockId !== lockId) continue;
    const applied: string[] = [];
    const conflicts: { opId: string; elementId: string }[] = [];
    let pendingOrder: string[] | undefined;
    let orderChanged = false;

    for (const op of d.ops) {
      const lock = await activeLockOn(ctx, d.artifactId, op.elementId);
      if (lock && !sameActor(lock.holder, d.author)) {
        conflicts.push({ opId: op.opId, elementId: op.elementId });
        continue;
      }
      const el = await getElement(ctx, d.artifactId, op.elementId);
      const cur = el?.version ?? 0;
      if (cur === op.baseVersion) {
        if (op.kind === "create" || op.kind === "delete") {
          const art = await ctx.db.get(d.artifactId);
          const currentOrder = pendingOrder ?? art?.order ?? [];
          if (op.kind === "create" && !el && !currentOrder.includes(op.elementId)) {
            pendingOrder = [...currentOrder, op.elementId];
            orderChanged = true;
          } else if (op.kind === "delete") {
            pendingOrder = currentOrder.filter((id) => id !== op.elementId);
            orderChanged = true;
          }
        }
        if (op.kind === "delete") {
          if (el) await ctx.db.delete(el._id);
        } else if (el) {
          await ctx.db.patch(el._id, { value: op.value, version: cur + 1, updatedAt: now, updatedBy: d.author });
        } else {
          await ctx.db.insert("elements", { artifactId: d.artifactId, elementId: op.elementId, value: op.value, version: 1, updatedAt: now, updatedBy: d.author });
        }
        applied.push(op.opId);
      } else if (el && JSON.stringify(el.value) === JSON.stringify(op.value)) {
        applied.push(op.opId); // already there — no-op
      } else {
        conflicts.push({ opId: op.opId, elementId: op.elementId }); // diverged — flag, never clobber
      }
    }

    const verdict = conflicts.length ? "needs_review" : "clean";
    const proposalIds: Id<"proposals">[] = [];
    const art = conflicts.length ? await ctx.db.get(d.artifactId) : null;
    if (conflicts.length && d.author.scope !== "private") {
      for (const conflict of conflicts) {
        const op = d.ops.find((candidate) => candidate.opId === conflict.opId);
        if (!op) continue;
        const current = await getElement(ctx, d.artifactId, op.elementId);
        const proposalId = await ctx.db.insert("proposals", {
          roomId,
          artifactId: d.artifactId,
          jobId: d.jobId,
          op: { ...op, artifactId: String(d.artifactId), baseVersion: current?.version ?? 0 },
          author: d.author,
          review: {
            kind: "semantic_rebase",
            conflictId: `draft_${String(d._id)}_${op.elementId}`,
            status: art?.kind === "note" ? "draft" : "needs_review",
            reason: "Draft conflict routed to review after committed work changed.",
            currentVersion: current?.version ?? 0,
          },
          status: "pending",
          createdAt: now,
        });
        proposalIds.push(proposalId);
      }
    }
    await ctx.db.patch(d._id, { status: conflicts.length ? "conflict" : "merged", resolvedAt: now });
    if (applied.length) {
      const artifact = art ?? await ctx.db.get(d.artifactId);
      if (artifact) {
        const patch: { version: number; updatedAt: number; order?: string[] } = { version: artifact.version + 1, updatedAt: now };
        if (orderChanged && pendingOrder) patch.order = pendingOrder;
        await ctx.db.patch(d.artifactId, patch);
      }
    }
    const note = d.author.scope === "private" ? "[private draft]" : d.note;
    await ctx.db.insert("traces", { roomId, ts: now, actor: d.author, type: conflicts.length ? "draft_conflict" : "draft_merged", summary: `Smart-merge (${verdict}): ${applied.length} applied, ${conflicts.length} flagged — ${note}`, detail: `smart_merge · ${applied.length} applied, ${conflicts.length} flagged → ${verdict}` });
    results.push({ draftId: d._id, verdict, applied: applied.length, conflicts: conflicts.length, proposalIds });
  }
  return results;
}
