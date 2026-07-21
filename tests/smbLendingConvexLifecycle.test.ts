// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { createSmbLendingConvexSeed, SMB_LENDING_EVIDENCE_PROPOSAL, SMB_LENDING_EVIDENCE_SOURCE, SMB_LENDING_PROPOSAL, SMB_LENDING_VERIFIED_RECEIPT } from "../src/app/smbLendingRoomSeed";

const modules = import.meta.glob("../convex/**/*.ts");
for (const modulePath of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) delete (modules as Record<string, unknown>)[modulePath];

const TOKEN = "smb-lending-convex-host-token-0123456789";

async function setup() {
  const t = convexTest(schema, modules);
  const seed = createSmbLendingConvexSeed();
  const created = await t.mutation(api.rooms.create, {
    code: "SMBLIV", title: "SMB Lending Deployment Room", hostName: "FDE Host", authToken: TOKEN,
    seedArtifacts: seed.artifacts,
    seedProposals: seed.proposals,
  });
  const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "FDE Host" }, token: TOKEN };
  return { t, created, proof };
}

describe("SMB lending canonical Convex lifecycle", () => {
  it("applies both human-reviewed transitions and persists lineage, packet, proof, and traces", async () => {
    const { t, created, proof } = await setup();
    const first = (await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof }))[0];
    expect(first.op.opId).toBe(SMB_LENDING_PROPOSAL.id);

    expect(await t.mutation(api.smbLending.resolveProposal, { proposalId: first.id as never, approve: true, requester: proof })).toMatchObject({ ok: true, nextProposal: true });
    const second = (await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof }))[0];
    expect(second.op).toMatchObject({ opId: SMB_LENDING_EVIDENCE_PROPOSAL.id, value: "verified", baseVersion: 2 });

    expect(await t.mutation(api.smbLending.resolveProposal, { proposalId: second.id as never, approve: true, requester: proof })).toMatchObject({ ok: true, workflowComplete: true });
    expect(await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof })).toHaveLength(0);

    const artifacts = await t.run(async (ctx) => await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", created.roomId)).collect());
    const evidence = artifacts.find((artifact) => artifact.title === "Evidence checklist");
    if (!evidence) throw new Error("evidence artifact missing");
    const elements = await t.run(async (ctx) => await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", evidence._id)).collect());
    const value = (elementId: string) => elements.find((element) => element.elementId === elementId)?.value;
    expect(value(`${SMB_LENDING_PROPOSAL.documentId}__status`)).toBe("verified");
    expect(String(value(`${SMB_LENDING_PROPOSAL.documentId}__source`))).toContain(SMB_LENDING_EVIDENCE_SOURCE.contentHash);
    expect(value(`${SMB_LENDING_PROPOSAL.documentId}__locator`)).toBe(SMB_LENDING_EVIDENCE_SOURCE.locator);

    const noteText = async (title: string) => {
      const artifact = artifacts.find((candidate) => candidate.title === title);
      if (!artifact) throw new Error(`artifact missing: ${title}`);
      return String((await t.run(async (ctx) => await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id)).collect())).find((element) => element.elementId === "doc")?.value ?? "");
    };
    expect(await noteText("Proof receipt")).toContain(SMB_LENDING_VERIFIED_RECEIPT.applicationHash);
    expect(await noteText("Human review credit packet")).toContain("Required-document blockers:</b> 0");
    expect(await noteText("Human review credit packet")).toContain("Decision:</b> not_made");
    expect(await noteText("Export bundle")).toContain(SMB_LENDING_VERIFIED_RECEIPT.packetHash);
    const traces = await t.run(async (ctx) => await ctx.db.query("traces").collect());
    expect(traces.some((trace) => trace.summary.includes("Created evidence-verification proposal"))).toBe(true);
    expect(traces.some((trace) => trace.summary.includes("regenerated the decision-free packet"))).toBe(true);
  });

  it("rejects a stale evidence approval and rolls back all follow-up mutations", async () => {
    const { t, created, proof } = await setup();
    const first = (await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof }))[0];
    await t.mutation(api.smbLending.resolveProposal, { proposalId: first.id as never, approve: true, requester: proof });
    const second = (await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof }))[0];
    await t.mutation(api.artifacts.applyCellEdit, { roomId: created.roomId, artifactId: second.artifactId as never, elementId: second.op.elementId, value: "human_review", baseVersion: 2, proof });

    expect(await t.mutation(api.smbLending.resolveProposal, { proposalId: second.id as never, approve: true, requester: proof })).toMatchObject({ ok: false, reason: "conflict" });
    const pending = await t.query(api.artifacts.listProposals, { roomId: created.roomId, requester: proof });
    expect(pending).toHaveLength(1);
    const elements = await t.run(async (ctx) => await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", second.artifactId as never)).collect());
    expect(elements.find((element) => element.elementId === second.op.elementId)?.value).toBe("human_review");
    expect(String(elements.find((element) => element.elementId === `${SMB_LENDING_PROPOSAL.documentId}__source`)?.value)).not.toContain(SMB_LENDING_EVIDENCE_SOURCE.contentHash);
  });
});
