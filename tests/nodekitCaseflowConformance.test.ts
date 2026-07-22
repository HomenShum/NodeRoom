// @vitest-environment edge-runtime
import { contentHash } from "@homenshum/nodekit/caseflow";
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import packageManifest from "../package.json";
import {
  createNodeRoomCaseflowRuntime,
  NODEKIT_CASEFLOW_SOURCE_COMMIT,
  runNodeRoomCaseflowConformance,
  type NodeRoomCaseflowActorProof,
  type NodeRoomCaseflowMutation,
  type NodeRoomCaseflowTransport,
} from "../src/integrations/nodekit/caseflowAdapter";

const modules = import.meta.glob("../convex/**/*.ts");
for (const modulePath of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

type T = ReturnType<typeof convexTest>;
type TClient = Pick<T, "mutation" | "query">;
type PortableCase = { caseId: string; status: string };
type PortableRun = { runId: string; status: string; nextActionOwner: string };
type PortableArtifact = {
  artifactId: string;
  canonicalVersion: number;
  nodeRoomArtifactId: string;
  versions: Array<{ version: number; content: unknown; contentHash: string; proposalId?: string }>;
};
type PortableProposal = { proposalId: string; status: string };
type PortableDecision = {
  approval: { approvalId: string; proposalId: string };
  artifact: PortableArtifact;
  proposal: PortableProposal;
  reused: boolean;
};
type PortableException = { exceptionId: string; preservedState: unknown };
type PortableResolution = { run: PortableRun; reused: boolean };
type PortableReceipt = {
  receiptId: string;
  receiptHash: string;
  runId: string;
  schemaVersion: string;
  [key: string]: unknown;
};
type PortableCompletion = { receipt: PortableReceipt; run: PortableRun; reused: boolean };
type PortableSnapshot = {
  approvals: Array<{ approvalId: string; proposalId: string }>;
  artifacts: PortableArtifact[];
  cases: PortableCase[];
  events: unknown[];
  exceptions: unknown[];
  proposals: PortableProposal[];
  receipts: PortableReceipt[];
  runs: PortableRun[];
};

const mutationRefs = Object.fromEntries(([
  "createCase",
  "startRun",
  "enterStage",
  "createArtifact",
  "createProposal",
  "decideProposal",
  "raiseException",
  "resolveException",
  "completeRun",
] satisfies NodeRoomCaseflowMutation[]).map((operation) => [
  operation,
  makeFunctionReference<"mutation">(`nodekitCaseflow:${operation}`),
])) as Record<NodeRoomCaseflowMutation, FunctionReference<"mutation">>;
const snapshotRef = makeFunctionReference<"query">("nodekitCaseflow:snapshot");

function transport(t: TClient): NodeRoomCaseflowTransport {
  return {
    mutation: async (operation, args) => await t.mutation(mutationRefs[operation], args),
    query: async (_operation, args) => await t.query(snapshotRef, args),
  };
}

async function seedTwoMembers(t: T) {
  const now = Date.now();
  const hostToken = "nodekit-caseflow-host-token-0123456789-ABCDE";
  const memberToken = "nodekit-caseflow-member-token-9876543210-ZYXWV";
  const roomId = await t.run((ctx) => ctx.db.insert("rooms", {
    code: "NKCF01",
    title: "NodeKit Caseflow room",
    hostId: "pending",
    autoAllow: false,
    status: "live" as const,
    createdAt: now,
  }));
  const hostId = await t.run(async (ctx) => ctx.db.insert("members", {
    roomId,
    name: "Maya",
    role: "host" as const,
    anon: false,
    color: "#111111",
    authTokenHash: await hashToken(hostToken),
    authSubject: "nodekit-caseflow-host",
    lastSeenAt: now,
  }));
  const memberId = await t.run(async (ctx) => ctx.db.insert("members", {
    roomId,
    name: "Riley",
    role: "member" as const,
    anon: false,
    color: "#222222",
    authTokenHash: await hashToken(memberToken),
    authSubject: "nodekit-caseflow-member",
    lastSeenAt: now,
  }));
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(hostId) }));
  const hostProof: NodeRoomCaseflowActorProof = {
    actor: { kind: "user", id: String(hostId), name: "Maya" },
    token: hostToken,
  };
  const memberProof: NodeRoomCaseflowActorProof = {
    actor: { kind: "user", id: String(memberId), name: "Riley" },
    token: memberToken,
  };
  return {
    hostClient: t.withIdentity({ subject: "nodekit-caseflow-host" }),
    hostId,
    hostProof,
    hostToken,
    memberClient: t.withIdentity({ subject: "nodekit-caseflow-member" }),
    memberId,
    memberProof,
    memberToken,
    roomId,
  };
}

function asRecord<T>(value: unknown): T {
  return value as T;
}

async function startMinimalCase(
  runtime: ReturnType<typeof createNodeRoomCaseflowRuntime>,
  title = "Owner-scoped case",
) {
  const work = asRecord<PortableCase>(await runtime.createCase({ title, primaryJob: "Preserve reviewed NodeSheet work" }));
  const run = asRecord<PortableRun>(await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "work", label: "Prepare", owner: "agent" },
      { id: "review", label: "Review", owner: "user" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  }));
  return { run, work };
}

function receiptBody(receipt: PortableReceipt): Record<string, unknown> {
  const { receiptHash: _receiptHash, receiptId: _receiptId, ...body } = receipt;
  return body;
}

describe("NodeRoom packaged NodeKit Caseflow consumer", () => {
  const previousIdentityRequired = process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;

  beforeEach(() => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
  });

  afterEach(() => {
    if (previousIdentityRequired === undefined) delete process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;
    else process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = previousIdentityRequired;
  });

  it("runs the pinned package conformance against real Convex lifecycle and CAS mutations", async () => {
    const t = convexTest(schema, modules);
    const { hostClient, hostProof, roomId } = await seedTwoMembers(t);
    const result = await runNodeRoomCaseflowConformance(transport(hostClient), {
      roomId: String(roomId),
      requester: hostProof,
    });

    expect(NODEKIT_CASEFLOW_SOURCE_COMMIT).toBe("5cc61578b3c1bd5b5c8195b83347b91f8b83242b");
    expect(packageManifest.dependencies["@homenshum/nodekit"]).toBe(
      "https://codeload.github.com/HomenShum/node-platform/tar.gz/5cc61578b3c1bd5b5c8195b83347b91f8b83242b",
    );
    expect(result.passed).toBe(true);
    expect(result.capabilities.provider).toBe("convex");
    expect(result.capabilityNegotiation.passed).toBe(true);
    expect(result.assertions).toEqual({
      activeRunStartIsIdempotent: true,
      canonicalVersionAdvancedOnce: true,
      contentAddressedReceipt: true,
      exceptionStatePreserved: true,
      nextActionOwnerExplicit: true,
      oneAuthoritativeCase: true,
      repeatedCompletionIsIdempotent: true,
      repeatedDecisionIsIdempotent: true,
      staleProposalFailedClosed: true,
    });

    const rows = await t.run(async (ctx) => ({
      lifecycleArtifacts: await ctx.db.query("nodekitCaseflowArtifacts").collect(),
      nodeRoomArtifacts: await ctx.db.query("artifacts").collect(),
      versions: await ctx.db.query("nodekitCaseflowArtifactVersions").collect(),
    }));
    expect(rows.lifecycleArtifacts).toHaveLength(1);
    expect(rows.nodeRoomArtifacts.some((artifact) =>
      String(artifact._id) === String(rows.lifecycleArtifacts[0].nodeRoomArtifactId)
      && artifact.kind === "sheet"
      && artifact.meta?.integration === "nodekit-caseflow"
    )).toBe(true);
    expect(rows.versions.map((version) => version.version)).toEqual([1, 2]);
  });

  it("authenticates two members while isolating each member-owned lifecycle", async () => {
    const t = convexTest(schema, modules);
    const { hostClient, hostProof, hostToken, memberClient, memberProof, roomId } = await seedTwoMembers(t);
    const hostRuntime = createNodeRoomCaseflowRuntime(transport(hostClient), { roomId: String(roomId), requester: hostProof });
    const memberRuntime = createNodeRoomCaseflowRuntime(transport(memberClient), { roomId: String(roomId), requester: memberProof });
    const hostCase = await startMinimalCase(hostRuntime, "Host case");
    const memberCase = await startMinimalCase(memberRuntime, "Member case");

    const hostSnapshot = asRecord<PortableSnapshot>(await hostRuntime.snapshot());
    const memberSnapshot = asRecord<PortableSnapshot>(await memberRuntime.snapshot());
    expect(hostSnapshot.cases.map((record) => record.caseId)).toEqual([hostCase.work.caseId]);
    expect(memberSnapshot.cases.map((record) => record.caseId)).toEqual([memberCase.work.caseId]);

    await expect(memberRuntime.enterStage({
      runId: hostCase.run.runId,
      stageId: "review",
    })).rejects.toThrow("caseflow_owner_scope_mismatch");
    await expect(hostRuntime.enterStage({
      runId: memberCase.run.runId,
      stageId: "review",
    })).rejects.toThrow("caseflow_owner_scope_mismatch");

    const forgedMemberRuntime = createNodeRoomCaseflowRuntime(transport(t.withIdentity({ subject: "nodekit-caseflow-attacker" })), {
      roomId: String(roomId),
      requester: { ...memberProof, token: hostToken },
    });
    await expect(forgedMemberRuntime.snapshot()).rejects.toThrow("identity_mismatch");
  });

  it("fails stale proposals closed, reuses decisions and completion after reload, and verifies the receipt hash", async () => {
    const t = convexTest(schema, modules);
    const { hostClient, hostProof, roomId } = await seedTwoMembers(t);
    const scope = { roomId: String(roomId), requester: hostProof };
    const firstRuntime = createNodeRoomCaseflowRuntime(transport(hostClient), scope);
    const { run, work } = await startMinimalCase(firstRuntime);
    const artifact = asRecord<PortableArtifact>(await firstRuntime.createArtifact({
      caseId: work.caseId,
      runId: run.runId,
      title: "NodeSheet result",
      content: { value: 1 },
    }));
    const accepted = asRecord<PortableProposal>(await firstRuntime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: 2 },
    }));
    const stale = asRecord<PortableProposal>(await firstRuntime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: 99 },
    }));
    const firstDecision = asRecord<PortableDecision>(await firstRuntime.decideProposal({
      proposalId: accepted.proposalId,
      decision: "accepted",
    }));
    const retriedDecision = asRecord<PortableDecision>(await firstRuntime.decideProposal({
      proposalId: accepted.proposalId,
      decision: "accepted",
    }));
    const staleDecision = asRecord<PortableDecision>(await firstRuntime.decideProposal({
      proposalId: stale.proposalId,
      decision: "accepted",
    }));
    expect(retriedDecision.reused).toBe(true);
    expect(retriedDecision.approval.approvalId).toBe(firstDecision.approval.approvalId);
    expect(retriedDecision.artifact.versions).toHaveLength(2);
    expect(staleDecision.proposal.status).toBe("conflicted");
    expect(staleDecision.artifact.canonicalVersion).toBe(2);
    expect(staleDecision.artifact.versions.at(-1)?.content).toEqual({ value: 2 });

    const raised = asRecord<PortableException>(await firstRuntime.raiseException({
      runId: run.runId,
      code: "source_paused",
      message: "Wait for a source",
      preservedState: { canonicalVersion: 2, reviewed: true },
    }));
    const recovered = asRecord<PortableResolution>(await firstRuntime.resolveException({
      exceptionId: raised.exceptionId,
      resolution: "Use cached source",
      nextAction: "Verify result",
      nextActionOwner: "system",
    }));
    expect(raised.preservedState).toEqual({ canonicalVersion: 2, reviewed: true });
    expect(recovered.run.status).toBe("active");
    expect(recovered.run.nextActionOwner).toBe("system");
    await firstRuntime.enterStage({ runId: run.runId, stageId: "complete" });
    const completed = asRecord<PortableCompletion>(await firstRuntime.completeRun({ runId: run.runId }));
    expect(contentHash(receiptBody(completed.receipt))).toBe(completed.receipt.receiptHash);

    // A new adapter instance simulates a client reload; durable state and exact
    // idempotent results must survive the in-memory client object.
    const reloadedRuntime = createNodeRoomCaseflowRuntime(transport(hostClient), scope);
    const reloaded = asRecord<PortableSnapshot>(await reloadedRuntime.snapshot());
    const repeatedCompletion = asRecord<PortableCompletion>(await reloadedRuntime.completeRun({ runId: run.runId }));
    expect(reloaded.artifacts[0].versions).toHaveLength(2);
    expect(reloaded.receipts).toHaveLength(1);
    expect(repeatedCompletion.reused).toBe(true);
    expect(repeatedCompletion.receipt).toEqual(completed.receipt);

    const persisted = await t.run(async (ctx) => ({
      approvals: await ctx.db.query("nodekitCaseflowApprovals").collect(),
      receipts: await ctx.db.query("nodekitCaseflowReceipts").collect(),
      versions: await ctx.db.query("nodekitCaseflowArtifactVersions").collect(),
      nodeRoomArtifact: await ctx.db.get(artifact.nodeRoomArtifactId as Id<"artifacts">),
    }));
    expect(persisted.approvals.filter((approval) => String(approval.proposalId) === accepted.proposalId)).toHaveLength(1);
    expect(persisted.receipts).toHaveLength(1);
    expect(persisted.versions).toHaveLength(2);
    expect(persisted.nodeRoomArtifact?.version).toBe(2);
  });
});
