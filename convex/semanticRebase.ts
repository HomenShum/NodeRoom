/**
 * Durable semantic rebase — the live-Convex completion of the no-clobber wedge.
 *
 * Per-element CAS already stops a stale write from silently clobbering committed work (it returns
 * the conflict as DATA). This module is the next beat: when an AGENT's managed write loses the CAS
 * race (its baseline went stale because a human or another agent committed first), we don't just
 * reject it. We build a durable SemanticConflictPacket, classify it with the SAME deterministic
 * policy the engine uses (src/nodeagent/skills/spreadsheet/semanticRebase.ts — the single source of
 * truth), persist it to the `semanticConflicts` ledger, and route it:
 *
 *   - canAutoCommit (safe, e.g. formatting / non-overlapping, never over a human)  -> caller re-applies
 *     the rebased op through the CAS spine at the CURRENT version (the "final CAS").
 *   - human-authored current / business value / formula / privacy  -> a host-approvable review
 *     proposal rebased onto the CURRENT version (review mode), or a durable record (auto-allow).
 *   - forbidden  -> rejected, recorded, never applied.
 *
 * Human edits are NEVER auto-overwritten: humanWinsByDefault is set whenever the current value was
 * not written by an agent, which classify maps to human_review_required. Reuses the pure functions
 * so the durable path and the in-memory engine share one classification truth.
 */
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { ActorValue } from "./lib";
import {
  resolveSemanticConflictPacket,
  type SemanticConflictPacket,
} from "../src/nodeagent/skills/spreadsheet/semanticRebase";
import type { ChangeOp } from "../src/engine/types";

function isFormula(value: unknown): boolean {
  return !!value && typeof value === "object" && typeof (value as { formula?: unknown }).formula === "string";
}

export type RebaseOutcome = "auto_merged" | "needs_review" | "recorded" | "rejected";

export interface RebasePlan {
  semanticConflictId: Id<"semanticConflicts">;
  outcome: RebaseOutcome;
  proposalIds: string[];
  tier: string;
  decision: string;
  /** When non-null, the caller MUST re-apply this through the CAS spine at `baseVersion` (final CAS). */
  autoMergeOp: { elementId: string; kind: "set" | "create" | "delete"; value: unknown; baseVersion: number } | null;
}

function sameValue(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return Object.is(a, b);
  }
}

/**
 * Build + classify + resolve + persist a semantic conflict for a single stale agent write, and
 * decide its routing. Does NOT itself commit an auto-merge (mutations cannot import the CAS spine
 * without a cycle); it returns `autoMergeOp` for `applyCellEditCore` to apply via guarded recursion.
 */
export async function planAndRecordRebase(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    artifactId: Id<"artifacts">;
    artifactKind: string; // sheet / note / wall / chart / ...
    elementId: string;
    kind: "set" | "create" | "delete";
    proposedValue: unknown;
    baseVersion: number; // the stale baseline the agent wrote against
    currentValue: unknown;
    currentVersion: number;
    currentUpdatedBy: ActorValue | undefined;
    actor: ActorValue; // the agent
    autoAllow: boolean;
  },
): Promise<RebasePlan> {
  const now = Date.now();
  const { elementId } = args;
  // Unknown author is treated as human-owned (fail safe: never auto-overwrite something we can't attribute to an agent).
  const currentIsHuman = args.currentUpdatedBy?.kind !== "agent";
  const conflictKind = args.artifactKind === "note"
    ? "memo_text"
    : (isFormula(args.currentValue) || isFormula(args.proposedValue) ? "formula" : "cell_value");

  const op: ChangeOp = {
    opId: `rebase_${elementId}_${now}`,
    artifactId: String(args.artifactId),
    elementId,
    kind: args.kind,
    value: args.proposedValue,
    baseVersion: args.baseVersion,
  };

  const packet: SemanticConflictPacket = {
    conflictId: `rebase_${String(args.artifactId)}_${elementId}_${now}`,
    roomId: String(args.roomId),
    artifactId: String(args.artifactId),
    artifactKind: args.artifactKind as SemanticConflictPacket["artifactKind"],
    trigger: "proposal_cas_conflict",
    conflictKind,
    overlap: "same_element",
    targetRefs: [{ kind: args.artifactKind === "note" ? "memo_block" : "cell", ref: elementId }],
    base: { values: { [elementId]: undefined }, versions: { [elementId]: args.baseVersion } },
    current: { values: { [elementId]: args.currentValue }, versions: { [elementId]: args.currentVersion }, changedBy: {} },
    proposed: { values: { [elementId]: args.proposedValue }, ops: [op] },
    context: {
      userIntent: "agent managed write rebased after a CAS conflict",
      mergeNote: "",
      deterministicConflicts: [],
      openQuestions: [],
    },
    policy: {
      humanWinsByDefault: currentIsHuman,
      formulaOverwriteAllowed: false,
      publicPrivateBoundary: "public_only",
      autoCommitAllowed: !currentIsHuman, // only an agent-vs-agent conflict may ever auto-merge; never over a human
    },
    status: "open",
    createdAt: now,
  };

  const resolution = resolveSemanticConflictPacket(packet);
  const cls = resolution.classification;
  const resolved = resolution.resolvedOps[0];

  let outcome: RebaseOutcome;
  let autoMergeOp: RebasePlan["autoMergeOp"] = null;
  const proposalIds: string[] = [];

  if (!resolved || resolved.kind === "reject") {
    outcome = "rejected";
  } else if (resolved.status === "verified" && cls.canAutoCommit) {
    // Safe deterministic merge — caller re-applies through the CAS spine at the current version.
    outcome = "auto_merged";
    autoMergeOp = { elementId, kind: args.kind, value: args.proposedValue, baseVersion: args.currentVersion };
  } else if (!args.autoAllow) {
    // Review mode: rebase the stale patch into a host-approvable proposal on the CURRENT version.
    const pending = await ctx.db
      .query("proposals")
      .withIndex("by_room_status", (q) => q.eq("roomId", args.roomId).eq("status", "pending"))
      .collect();
    const existing = pending.find((proposal) => {
      const proposalOp = proposal.op as ChangeOp | undefined;
      return String(proposal.artifactId) === String(args.artifactId) &&
        proposal.review?.kind === "semantic_rebase" &&
        proposalOp?.elementId === elementId &&
        proposalOp?.kind === args.kind &&
        proposalOp?.baseVersion === args.currentVersion &&
        sameValue(proposalOp?.value, args.proposedValue);
    });
    const proposalId = existing?._id ?? await ctx.db.insert("proposals", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      op: { opId: op.opId, artifactId: String(args.artifactId), elementId, kind: args.kind, value: args.proposedValue, baseVersion: args.currentVersion },
      author: args.actor,
      review: {
        kind: "semantic_rebase",
        conflictId: packet.conflictId,
        status: cls.tier === "llm_assisted_validator_approved" ? "draft" : "needs_review",
        reason: resolution.reason || "Stale agent patch rebased to review after committed work changed.",
        currentVersion: args.currentVersion,
        tier: cls.tier,
      },
      status: "pending",
      createdAt: now,
    });
    proposalIds.push(String(proposalId));
    outcome = "needs_review";
  } else {
    // Auto-allow + not safe to auto-merge: record the conflict durably; the agent re-reads & retries.
    outcome = "recorded";
  }

  const semanticConflictId = await ctx.db.insert("semanticConflicts", {
    roomId: args.roomId,
    artifactId: args.artifactId,
    trigger: packet.trigger,
    conflictKind: packet.conflictKind,
    overlap: packet.overlap,
    elementIds: [elementId],
    tier: cls.tier,
    action: cls.action,
    decision: resolution.decision,
    canAutoCommit: cls.canAutoCommit,
    outcome,
    reasons: cls.reasons,
    proposalIds: proposalIds.length ? proposalIds : undefined,
    packet,
    actor: args.actor,
    createdAt: now,
    resolvedAt: outcome === "auto_merged" || outcome === "rejected" ? now : undefined,
  });

  await ctx.db.insert("traces", {
    roomId: args.roomId,
    ts: now,
    actor: args.actor,
    type: "semantic_conflict",
    summary: `Semantic rebase (${outcome}) on ${elementId} — ${cls.tier}`,
    detail: `semantic_rebase · trigger=${packet.trigger} · decision=${resolution.decision} · ${cls.reasons[0] ?? ""}`.slice(0, 480),
  });

  return { semanticConflictId, outcome, proposalIds, tier: cls.tier, decision: resolution.decision, autoMergeOp };
}
