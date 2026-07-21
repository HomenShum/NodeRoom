import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, getElement, type ActorValue } from "./lib";
import { applyCellEditCore, resolveProposalCore } from "./artifacts";
import {
  SMB_LENDING_EVIDENCE_PROPOSAL,
  SMB_LENDING_EVIDENCE_SOURCE,
  SMB_LENDING_PROPOSAL,
  SMB_LENDING_EVIDENCE_PROPOSAL_NOTE,
  SMB_LENDING_VERIFIED_PACKET_NOTE,
  SMB_LENDING_VERIFIED_PROOF_NOTE,
  SMB_LENDING_VERIFIED_BUNDLE,
} from "../src/app/smbLendingRoomSeed";

type ProposalOp = { opId: string; artifactId: string; elementId: string; kind: "set" | "create" | "delete"; value: unknown; baseVersion: number };

async function artifactByTitle(ctx: Parameters<typeof applyCellEditCore>[0], roomId: Id<"rooms">, title: string) {
  const artifacts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  return artifacts.find((artifact) => artifact.title === title);
}

async function setNote(ctx: Parameters<typeof applyCellEditCore>[0], roomId: Id<"rooms">, title: string, value: string, actor: ActorValue, opId: string) {
  const artifact = await artifactByTitle(ctx, roomId, title);
  if (!artifact) throw new Error(`smb_lending_artifact_missing:${title}`);
  const element = await getElement(ctx, artifact._id, "doc");
  if (!element) throw new Error(`smb_lending_note_missing:${title}`);
  const result = await applyCellEditCore(ctx, { roomId, artifactId: artifact._id, elementId: "doc", kind: "set", value, baseVersion: element.version, actor });
  if (!result.ok) throw new Error(`smb_lending_note_update_failed:${opId}:${result.reason}`);
}

/** Domain lifecycle wrapper around the canonical proposal resolver and cell-CAS spine. */
export const resolveProposal = mutation({
  args: { proposalId: v.id("proposals"), approve: v.boolean(), requester: actorProofV },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) return { ok: false as const, reason: "not_found" as const };
    const op = proposal.op as ProposalOp;
    if (op.opId !== SMB_LENDING_PROPOSAL.id && op.opId !== SMB_LENDING_EVIDENCE_PROPOSAL.id) throw new Error("not_smb_lending_proposal");
    const artifact = await ctx.db.get(proposal.artifactId);
    const tags = (artifact?.meta as { tags?: unknown } | undefined)?.tags;
    if (!artifact || !Array.isArray(tags) || !tags.includes("smb-lending")) throw new Error("not_smb_lending_artifact");

    // Any failed follow-up aborts this transaction, rolling back the canonical approval too.
    const result = await resolveProposalCore(ctx, args);
    if (!result.ok || !args.approve) return result;
    const actor = args.requester.actor;
    const now = Date.now();

    if (op.opId === SMB_LENDING_PROPOSAL.id) {
      const current = await getElement(ctx, proposal.artifactId, op.elementId);
      if (!current || current.value !== "requested") throw new Error("smb_lending_requested_state_missing");
      const existing = await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", proposal.roomId).eq("status", "pending")).collect();
      if (!existing.some((candidate) => (candidate.op as ProposalOp).opId === SMB_LENDING_EVIDENCE_PROPOSAL.id)) {
        await ctx.db.insert("proposals", {
          roomId: proposal.roomId,
          artifactId: proposal.artifactId,
          op: { opId: SMB_LENDING_EVIDENCE_PROPOSAL.id, artifactId: String(proposal.artifactId), elementId: op.elementId, kind: "set", value: "verified", baseVersion: current.version },
          author: { kind: "agent", id: "agent_smb_lending", name: "Lending NodeAgent", scope: "public" },
          review: { kind: "agent_edit", reason: SMB_LENDING_EVIDENCE_PROPOSAL.rationale, reviewerNote: `Immutable evidence ${SMB_LENDING_EVIDENCE_SOURCE.contentHash}; domain base version ${SMB_LENDING_EVIDENCE_PROPOSAL.baseVersion}.`, status: "needs_review" },
          status: "pending",
          createdAt: now,
        });
      }
      await setNote(ctx, proposal.roomId, "Proposal review", SMB_LENDING_EVIDENCE_PROPOSAL_NOTE, actor, "show_evidence_proposal");
      await ctx.db.insert("traces", { roomId: proposal.roomId, ts: now, actor, type: "agent_status", summary: `Created evidence-verification proposal ${SMB_LENDING_EVIDENCE_PROPOSAL.id} after final CAS.`, detail: `source=${SMB_LENDING_EVIDENCE_SOURCE.id} hash=${SMB_LENDING_EVIDENCE_SOURCE.contentHash}` });
      return { ...result, nextProposal: true as const };
    }

    const sourceElement = await getElement(ctx, proposal.artifactId, `${SMB_LENDING_EVIDENCE_PROPOSAL.documentId}__source`);
    const locatorElement = await getElement(ctx, proposal.artifactId, `${SMB_LENDING_EVIDENCE_PROPOSAL.documentId}__locator`);
    if (!sourceElement || !locatorElement) throw new Error("smb_lending_lineage_cells_missing");
    for (const edit of [
      { element: sourceElement, elementId: `${SMB_LENDING_EVIDENCE_PROPOSAL.documentId}__source`, value: `${SMB_LENDING_EVIDENCE_SOURCE.id} (${SMB_LENDING_EVIDENCE_SOURCE.contentHash})` },
      { element: locatorElement, elementId: `${SMB_LENDING_EVIDENCE_PROPOSAL.documentId}__locator`, value: SMB_LENDING_EVIDENCE_SOURCE.locator },
    ]) {
      const applied = await applyCellEditCore(ctx, { roomId: proposal.roomId, artifactId: proposal.artifactId, elementId: edit.elementId, kind: "set", value: edit.value, baseVersion: edit.element.version, actor });
      if (!applied.ok) throw new Error(`smb_lending_lineage_update_failed:${edit.elementId}:${applied.reason}`);
    }
    await setNote(ctx, proposal.roomId, "Proposal review", "<h1>Evidence verification complete</h1><p>The requested operating-bank statements are verified with immutable source lineage. No lending decision was made.</p>", actor, "complete_evidence_proposal");
    await setNote(ctx, proposal.roomId, "Proof receipt", SMB_LENDING_VERIFIED_PROOF_NOTE, actor, "regenerate_proof");
    await setNote(ctx, proposal.roomId, "Human review credit packet", SMB_LENDING_VERIFIED_PACKET_NOTE, actor, "regenerate_packet");
    await setNote(ctx, proposal.roomId, "Export bundle", SMB_LENDING_VERIFIED_BUNDLE, actor, "persist_export_bundle");
    await ctx.db.insert("traces", { roomId: proposal.roomId, ts: now, actor, type: "edit_applied", summary: "Verified evidence lineage and regenerated the decision-free packet and proof receipt.", detail: `hash=${SMB_LENDING_EVIDENCE_SOURCE.contentHash}; no_credit_decision=true` });
    return { ...result, workflowComplete: true as const };
  },
});
