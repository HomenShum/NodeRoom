// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import {
  contentHash,
  runCaseflowConformance,
} from "@homenshum/nodekit/caseflow";
import { register as registerNodeKitCaseflow } from "@homenshum/nodekit/test";
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import {
  createNodeRoomCaseflowRuntime,
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
type AuthenticatedClient = ReturnType<T["withIdentity"]>;
type PortableArtifact = {
  artifactId: string;
  canonicalElementId?: string;
  canonicalVersion: number;
  nodeRoomArtifactId?: string;
  versions: Array<{
    content: unknown;
    contentHash: string;
    proposalId?: string;
    version: number;
  }>;
};
type PortableProposal = {
  artifactId: string;
  patch: unknown;
  proposalId: string;
  status: "accepted" | "conflicted" | "pending" | "rejected";
};
type PortableDecision = {
  approval: { approvalId: string; proposalId: string };
  artifact: PortableArtifact;
  proposal: PortableProposal;
  reused: boolean;
};
type PortableException = {
  exceptionId: string;
  preservedState: unknown;
};
type PortableCompletion = {
  receipt: {
    approvalBindings: Array<{ approvalId: string; commentHash: string }>;
    artifactBindings: Array<{
      artifactId: string;
      canonicalVersion: number;
      contentHash: string;
    }>;
    eventBindings: Array<{ actorHash: string; payloadHash: string }>;
    proposalBindings: Array<{ proposalId: string; status: string }>;
    receiptHash: string;
    receiptId: string;
    schemaVersion: string;
    status: string;
  };
  reused: boolean;
  run: { runId: string; status: string };
};

const operations = [
  "createCase",
  "updateCaseInput",
  "startRun",
  "enterStage",
  "createArtifact",
  "createProposal",
  "decideProposal",
  "raiseException",
  "resolveException",
  "completeRun",
  "cancelRun",
  "failRunSafely",
] as const satisfies readonly NodeRoomCaseflowMutation[];

const mutationRefs = Object.fromEntries(
  operations.map((operation) => [
    operation,
    makeFunctionReference<"mutation">(`nodekitCaseflow:${operation}`),
  ]),
) as Record<NodeRoomCaseflowMutation, FunctionReference<"mutation">>;
const snapshotRef = makeFunctionReference<"query">("nodekitCaseflow:snapshot");
const applyCellEditRef = makeFunctionReference<"mutation">("artifacts:applyCellEdit");

function testRuntime(): T {
  const t = convexTest(schema, modules);
  registerNodeKitCaseflow(t, "nodekitCaseflow");
  return t;
}

function transport(client: AuthenticatedClient): NodeRoomCaseflowTransport {
  return {
    mutation: async (operation, args) =>
      client.mutation(mutationRefs[operation], args),
    query: async (_operation, args) => client.query(snapshotRef, args),
  };
}

async function seedTwoMembers(t: T) {
  const now = Date.now();
  const hostToken = "nodekit-caseflow-host-token-0123456789-ABCDE";
  const memberToken = "nodekit-caseflow-member-token-9876543210-ZYXWV";
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      autoAllow: false,
      code: "NKCF01",
      createdAt: now,
      hostId: "pending",
      status: "live" as const,
      title: "NodeKit component room",
    }),
  );
  const hostId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      anon: false,
      authSubject: "nodekit-caseflow-host",
      authTokenHash: await hashToken(hostToken),
      color: "#111111",
      lastSeenAt: now,
      name: "Maya",
      role: "host" as const,
      roomId,
    }),
  );
  const memberId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      anon: false,
      authSubject: "nodekit-caseflow-member",
      authTokenHash: await hashToken(memberToken),
      color: "#222222",
      lastSeenAt: now,
      name: "Riley",
      role: "member" as const,
      roomId,
    }),
  );
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(hostId) }));
  const hostProof: NodeRoomCaseflowActorProof = {
    actor: { id: String(hostId), kind: "user", name: "Maya" },
    token: hostToken,
  };
  const memberProof: NodeRoomCaseflowActorProof = {
    actor: { id: String(memberId), kind: "user", name: "Riley" },
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
    roomId,
  };
}

async function startCase(
  runtime: ReturnType<typeof createNodeRoomCaseflowRuntime>,
  suffix: string,
) {
  const work = await runtime.createCase({
    primaryJob: `Preserve reviewed NodeRoom work ${suffix}`,
    title: `NodeRoom case ${suffix}`,
  });
  const run = await runtime.startRun({
    caseId: work.caseId,
    stages: [
      { id: "work", label: "Prepare", owner: "agent" },
      { id: "review", label: "Review", owner: "user" },
      { id: "complete", label: "Complete", owner: "system" },
    ],
  });
  return { run, work };
}

function receiptBody(receipt: PortableCompletion["receipt"]) {
  const { receiptHash: _receiptHash, receiptId: _receiptId, ...body } = receipt;
  return body;
}

describe("NodeRoom consumes the packed NodeKit Convex component", () => {
  const previousIdentityRequired = process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;

  beforeEach(() => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
  });

  afterEach(() => {
    if (previousIdentityRequired === undefined) {
      delete process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;
    } else {
      process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = previousIdentityRequired;
    }
  });

  it("passes the packaged portable Caseflow conformance suite through the authenticated Convex wrapper", async () => {
    const t = testRuntime();
    const {
      hostClient,
      hostProof,
      memberClient,
      memberProof,
      roomId,
    } = await seedTwoMembers(t);
    const runtime = createNodeRoomCaseflowRuntime(transport(hostClient), {
      requester: hostProof,
      roomId: String(roomId),
    });

    const verdict = await runCaseflowConformance(() => runtime, {
      actorMode: "host-bound",
      verifyHostAuthorization: async ({ caseId }) => {
        const otherMemberRuntime = createNodeRoomCaseflowRuntime(
          transport(memberClient),
          { requester: memberProof, roomId: String(roomId) },
        );
        const otherSnapshot = await otherMemberRuntime.snapshot();
        const forgedRuntime = createNodeRoomCaseflowRuntime(
          transport(memberClient),
          { requester: hostProof, roomId: String(roomId) },
        );
        let forgedIdentityDenied = false;
        try {
          await forgedRuntime.snapshot();
        } catch (error) {
          forgedIdentityDenied = /identity_mismatch/.test(String(error));
        }
        return (
          !otherSnapshot.cases.some((entry) => entry.caseId === caseId) &&
          forgedIdentityDenied
        );
      },
    });

    expect(
      Object.entries(verdict.assertions).filter(([, passed]) => !passed),
    ).toEqual([]);
    expect(verdict.passed).toBe(true);
    expect(verdict.capabilityNegotiation.passed).toBe(true);
    expect(verdict.capabilities.provider).toBe("convex");
  }, 60_000);

  it("keeps auth and room ownership in NodeRoom while component state stays isolated", async () => {
    const t = testRuntime();
    const {
      hostClient,
      hostProof,
      hostToken,
      memberClient,
      memberProof,
      roomId,
    } = await seedTwoMembers(t);
    const hostRuntime = createNodeRoomCaseflowRuntime(transport(hostClient), {
      requester: hostProof,
      roomId: String(roomId),
    });
    const memberRuntime = createNodeRoomCaseflowRuntime(transport(memberClient), {
      requester: memberProof,
      roomId: String(roomId),
    });
    const host = await startCase(hostRuntime, "host");
    const member = await startCase(memberRuntime, "member");
    expect((await hostRuntime.snapshot()).cases.map((entry) => entry.caseId)).toEqual([
      host.work.caseId,
    ]);
    expect((await memberRuntime.snapshot()).cases.map((entry) => entry.caseId)).toEqual([
      member.work.caseId,
    ]);
    await expect(
      memberRuntime.enterStage({ runId: host.run.runId, stageId: "review" }),
    ).rejects.toThrow("caseflow_owner_scope_mismatch");
    await expect(
      hostRuntime.enterStage({ runId: member.run.runId, stageId: "review" }),
    ).rejects.toThrow("caseflow_owner_scope_mismatch");

    const anonymousRuntime = createNodeRoomCaseflowRuntime(transport(t), {
      requester: hostProof,
      roomId: String(roomId),
    });
    await expect(anonymousRuntime.snapshot()).rejects.toThrow(
      "production_identity_required",
    );
    const forged = createNodeRoomCaseflowRuntime(
      transport(t.withIdentity({ subject: "nodekit-caseflow-attacker" })),
      {
        requester: { ...memberProof, token: hostToken },
        roomId: String(roomId),
      },
    );
    await expect(forged.snapshot()).rejects.toThrow("identity_mismatch");

    const bindings = await t.run(async (ctx) => ({
      artifacts: await ctx.db.query("nodekitCaseflowArtifactBindings").collect(),
      cases: await ctx.db.query("nodekitCaseflowBindings").collect(),
      runs: await ctx.db.query("nodekitCaseflowRunBindings").collect(),
    }));
    expect(bindings.cases).toHaveLength(2);
    expect(bindings.runs).toHaveLength(2);
    expect(bindings.artifacts).toHaveLength(0);
    expect(bindings.cases.every((entry) => !("requester" in entry))).toBe(true);
    expect(bindings.cases.every((entry) => !("token" in entry))).toBe(true);
  });

  it("binds a real private NodeRoom artifact to proposal, conflict, recovery, reload, and receipt-v2 semantics", async () => {
    const t = testRuntime();
    const { hostClient, hostProof, roomId } = await seedTwoMembers(t);
    const scope = { requester: hostProof, roomId: String(roomId) };
    const runtime = createNodeRoomCaseflowRuntime(transport(hostClient), scope);
    const { run, work } = await startCase(runtime, "material-lifecycle");
    const entered = await runtime.enterStage({
      idempotencyKey: " review-stage ",
      nextAction: "Review the proposed spreadsheet result",
      nextActionOwner: "user",
      runId: run.runId,
      stageId: "review",
    });
    const enteredRetry = await runtime.enterStage({
      idempotencyKey: "review-stage",
      nextAction: "Review the proposed spreadsheet result",
      nextActionOwner: "user",
      runId: run.runId,
      stageId: "review",
    });
    expect(enteredRetry).toEqual(entered);

    const artifactInput = {
      caseId: work.caseId,
      content: { formula: "=SUM(B2:B4)", reviewed: false, value: 1 },
      idempotencyKey: " workbook-artifact ",
      kind: "spreadsheet",
      runId: run.runId,
      title: "Reviewed workbook result",
    };
    const artifact = (await runtime.createArtifact(
      artifactInput,
    )) as PortableArtifact;
    const artifactRetry = (await runtime.createArtifact({
      ...artifactInput,
      idempotencyKey: "workbook-artifact",
    })) as PortableArtifact;
    expect(artifactRetry.artifactId).toBe(artifact.artifactId);
    expect(artifact.versions[0]?.contentHash).toBe(
      contentHash(artifactInput.content),
    );

    const acceptedInput = {
      artifactId: artifact.artifactId,
      baseVersion: 1,
      idempotencyKey: "accepted-workbook-patch",
      patch: { formula: "=SUM(B2:B4)", reviewed: true, value: 2 },
      rationale: "The reviewer accepted the exact source-backed values.",
    };
    const accepted = (await runtime.createProposal(
      acceptedInput,
    )) as PortableProposal;
    const acceptedRetry = (await runtime.createProposal({
      ...acceptedInput,
      idempotencyKey: " accepted-workbook-patch ",
    })) as PortableProposal;
    expect(acceptedRetry.proposalId).toBe(accepted.proposalId);
    const stale = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { formula: "=SUM(B2:B4)", reviewed: true, value: 99 },
      rationale: "A racing alternative must not overwrite the approved result.",
    })) as PortableProposal;

    const firstDecision = (await runtime.decideProposal({
      comment: "Reviewed exactly",
      decision: "accepted",
      proposalId: accepted.proposalId,
    })) as PortableDecision;
    const repeatedDecision = (await runtime.decideProposal({
      comment: "Reviewed exactly",
      decision: "accepted",
      proposalId: accepted.proposalId,
    })) as PortableDecision;
    expect(repeatedDecision.reused).toBe(true);
    expect(repeatedDecision.approval.approvalId).toBe(
      firstDecision.approval.approvalId,
    );
    await expect(
      runtime.decideProposal({
        comment: "A changed retry",
        decision: "accepted",
        proposalId: accepted.proposalId,
      }),
    ).rejects.toThrow("retry does not match");
    const staleDecision = (await runtime.decideProposal({
      decision: "accepted",
      proposalId: stale.proposalId,
    })) as PortableDecision;
    expect(staleDecision.proposal.status).toBe("conflicted");
    expect(staleDecision.artifact.canonicalVersion).toBe(2);

    const firstException = (await runtime.raiseException({
      code: "source_paused",
      idempotencyKey: "source-pause-checkpoint",
      message: "Wait for a source while preserving the reviewed workbook.",
      preservedState: { artifactVersion: 2, reviewed: true },
      runId: run.runId,
    })) as PortableException;
    const exceptionRetry = (await runtime.raiseException({
      code: "source_paused",
      idempotencyKey: " source-pause-checkpoint ",
      message: "Wait for a source while preserving the reviewed workbook.",
      preservedState: { artifactVersion: 2, reviewed: true },
      runId: run.runId,
    })) as PortableException;
    expect(exceptionRetry.exceptionId).toBe(firstException.exceptionId);
    const secondException = (await runtime.raiseException({
      code: "review_paused",
      message: "A second independent review issue remains open.",
      preservedState: { artifactVersion: 2 },
      runId: run.runId,
    })) as PortableException;
    await expect(
      runtime.createProposal({
        artifactId: artifact.artifactId,
        baseVersion: 2,
        patch: { value: 3 },
      }),
    ).rejects.toThrow("run is not active: blocked");
    const partiallyRecovered = await runtime.resolveException({
      exceptionId: firstException.exceptionId,
      nextAction: "Resolve the remaining review issue",
      nextActionOwner: "user",
      resolution: "Source arrived",
    });
    expect(partiallyRecovered.run.status).toBe("blocked");
    const recovered = await runtime.resolveException({
      exceptionId: secondException.exceptionId,
      nextAction: "Verify the final artifact",
      nextActionOwner: "system",
      resolution: "Independent review completed",
    });
    expect(recovered.run).toMatchObject({
      nextActionOwner: "system",
      status: "active",
    });

    await runtime.enterStage({ runId: run.runId, stageId: "complete" });
    const completed = (await runtime.completeRun({
      runId: run.runId,
    })) as PortableCompletion;
    const completedRetry = (await runtime.completeRun({
      runId: run.runId,
    })) as PortableCompletion;
    expect(completedRetry.reused).toBe(true);
    expect(completedRetry.receipt).toEqual(completed.receipt);
    expect(completed.receipt.schemaVersion).toBe("nodekit.receipt/v2");
    expect(completed.receipt.receiptHash).toBe(
      contentHash(receiptBody(completed.receipt)),
    );
    expect(completed.receipt.artifactBindings).toContainEqual(
      expect.objectContaining({
        artifactId: artifact.artifactId,
        canonicalVersion: 2,
        contentHash: firstDecision.artifact.versions.at(-1)?.contentHash,
      }),
    );
    expect(completed.receipt.approvalBindings).toContainEqual(
      expect.objectContaining({ approvalId: firstDecision.approval.approvalId }),
    );
    expect(completed.receipt.proposalBindings).toContainEqual(
      expect.objectContaining({
        proposalId: stale.proposalId,
        status: "conflicted",
      }),
    );
    expect(
      completed.receipt.eventBindings.every(
        (entry) =>
          /^[a-f0-9]{64}$/u.test(entry.actorHash) &&
          /^[a-f0-9]{64}$/u.test(entry.payloadHash),
      ),
    ).toBe(true);

    const reloaded = createNodeRoomCaseflowRuntime(transport(hostClient), scope);
    const snapshot = await reloaded.snapshot();
    expect(snapshot.cases).toHaveLength(1);
    expect(snapshot.runs[0]?.status).toBe("completed");
    expect(snapshot.artifacts[0]?.versions).toHaveLength(2);
    expect(snapshot.receipts[0]).toEqual(completed.receipt);
    const persisted = await t.run(async (ctx) => {
      const elements = await ctx.db.query("elements").collect();
      return {
        artifactBindings: await ctx.db
          .query("nodekitCaseflowArtifactBindings")
          .collect(),
        caseBindings: await ctx.db.query("nodekitCaseflowBindings").collect(),
        runBindings: await ctx.db
          .query("nodekitCaseflowRunBindings")
          .collect(),
        element: elements.find(
          (entry) =>
            String(entry.artifactId) === artifact.nodeRoomArtifactId &&
            entry.elementId === artifact.canonicalElementId,
        ),
        nodeRoomArtifact: await ctx.db.get(
          artifact.nodeRoomArtifactId as Id<"artifacts">,
        ),
      };
    });
    expect(persisted.caseBindings).toHaveLength(1);
    expect(persisted.runBindings).toHaveLength(1);
    expect(persisted.artifactBindings).toHaveLength(1);
    expect(persisted.nodeRoomArtifact?.version).toBe(2);
    expect(persisted.element).toMatchObject({
      value: acceptedInput.patch,
      version: 2,
    });

    const nextRun = await reloaded.startRun({
      caseId: work.caseId,
      stages: [{ id: "revise", label: "Revise", owner: "user" }],
    });
    expect(nextRun.runId).not.toBe(run.runId);
    const afterRestart = await reloaded.snapshot();
    expect(afterRestart.runs.map((entry) => entry.runId)).toEqual(
      expect.arrayContaining([run.runId, nextRun.runId]),
    );
    expect(afterRestart.receipts).toContainEqual(completed.receipt);
    const allRunBindings = await t.run((ctx) =>
      ctx.db.query("nodekitCaseflowRunBindings").collect(),
    );
    expect(allRunBindings).toHaveLength(2);
    expect(allRunBindings.every((entry) => !("requester" in entry))).toBe(true);
    expect(allRunBindings.every((entry) => !("token" in entry))).toBe(true);
  });

  it("fails closed when a real human NodeRoom edit advances the domain artifact first", async () => {
    const t = testRuntime();
    const { hostClient, hostProof, roomId } = await seedTwoMembers(t);
    const runtime = createNodeRoomCaseflowRuntime(transport(hostClient), {
      requester: hostProof,
      roomId: String(roomId),
    });
    const { run, work } = await startCase(runtime, "domain-conflict");
    const artifact = (await runtime.createArtifact({
      caseId: work.caseId,
      content: { value: "component baseline" },
      runId: run.runId,
    })) as PortableArtifact;
    const proposal = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: "agent proposal" },
    })) as PortableProposal;

    const humanWrite = await hostClient.mutation(applyCellEditRef, {
      artifactId: artifact.nodeRoomArtifactId,
      baseVersion: 1,
      elementId: artifact.canonicalElementId,
      kind: "set",
      proof: hostProof,
      roomId,
      value: { value: "newer human edit" },
    });
    expect(humanWrite).toMatchObject({ ok: true, version: 2 });
    await expect(
      runtime.decideProposal({
        decision: "accepted",
        proposalId: proposal.proposalId,
      }),
    ).rejects.toThrow("caseflow_domain_artifact_drift");
    const snapshot = await runtime.snapshot();
    expect(snapshot.proposals).toContainEqual(
      expect.objectContaining({
        proposalId: proposal.proposalId,
        status: "pending",
      }),
    );
    const element = await t.run(async (ctx) =>
      (await ctx.db.query("elements").collect()).find(
        (entry) =>
          String(entry.artifactId) === artifact.nodeRoomArtifactId &&
          entry.elementId === artifact.canonicalElementId,
      ),
    );
    expect(element).toMatchObject({ value: { value: "newer human edit" }, version: 2 });
  });

  it("rolls back the component decision when NodeRoom CAS cannot apply, then retries once", async () => {
    const t = testRuntime();
    const { hostClient, hostProof, memberId, roomId } = await seedTwoMembers(t);
    const runtime = createNodeRoomCaseflowRuntime(transport(hostClient), {
      requester: hostProof,
      roomId: String(roomId),
    });
    const { run, work } = await startCase(runtime, "cross-component-rollback");
    const artifact = (await runtime.createArtifact({
      caseId: work.caseId,
      content: { value: "baseline" },
      runId: run.runId,
    })) as PortableArtifact;
    const proposal = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: { value: "accepted after retry" },
    })) as PortableProposal;
    const now = Date.now();
    const lockId = await t.run((ctx) =>
      ctx.db.insert("locks", {
        createdAt: now,
        elementIds: [artifact.canonicalElementId!],
        expiresAt: now + 60_000,
        holder: {
          id: String(memberId),
          kind: "user" as const,
          name: "Riley",
        },
        artifactId: artifact.nodeRoomArtifactId as Id<"artifacts">,
        reason: "Reviewing the canonical cell",
        roomId,
        sessionId: "nodekit-component-cas-rollback",
        status: "active" as const,
      }),
    );
    await expect(
      runtime.decideProposal({
        comment: "Accept when the lock clears",
        decision: "accepted",
        proposalId: proposal.proposalId,
      }),
    ).rejects.toThrow("caseflow_domain_apply_failed:locked");
    expect((await runtime.snapshot()).proposals).toContainEqual(
      expect.objectContaining({
        proposalId: proposal.proposalId,
        status: "pending",
      }),
    );

    await t.run((ctx) =>
      ctx.db.patch(lockId, { releasedAt: Date.now(), status: "released" }),
    );
    const accepted = (await runtime.decideProposal({
      comment: "Accept when the lock clears",
      decision: "accepted",
      proposalId: proposal.proposalId,
    })) as PortableDecision;
    expect(accepted).toMatchObject({
      reused: false,
      proposal: { status: "accepted" },
    });
    const state = await t.run(async (ctx) => {
      const elements = await ctx.db.query("elements").collect();
      return {
        artifact: await ctx.db.get(
          artifact.nodeRoomArtifactId as Id<"artifacts">,
        ),
        element: elements.find(
          (entry) =>
            String(entry.artifactId) === artifact.nodeRoomArtifactId &&
            entry.elementId === artifact.canonicalElementId,
        ),
      };
    });
    expect(state.artifact?.version).toBe(2);
    expect(state.element).toMatchObject({
      value: { value: "accepted after retry" },
      version: 2,
    });
  });

  it("receipts explicit cancellation and safe failure without discarding valid artifacts", async () => {
    const t = testRuntime();
    const { hostClient, hostProof, roomId } = await seedTwoMembers(t);
    const runtime = createNodeRoomCaseflowRuntime(transport(hostClient), {
      requester: hostProof,
      roomId: String(roomId),
    });

    const cancelled = await startCase(runtime, "cancelled");
    const firstCancel = (await runtime.cancelRun({
      reason: "The user withdrew the request.",
      runId: cancelled.run.runId,
    })) as PortableCompletion;
    const cancelRetry = (await runtime.cancelRun({
      reason: "The user withdrew the request.",
      runId: cancelled.run.runId,
    })) as PortableCompletion;
    expect(firstCancel.receipt.status).toBe("cancelled");
    expect(cancelRetry.reused).toBe(true);
    expect(cancelRetry.receipt).toEqual(firstCancel.receipt);
    await expect(
      runtime.cancelRun({
        reason: "A different retry reason.",
        runId: cancelled.run.runId,
      }),
    ).rejects.toThrow("terminal retry does not match");

    const failed = await startCase(runtime, "failed-safely");
    const partial = (await runtime.createArtifact({
      caseId: failed.work.caseId,
      content: { checkpoint: "verified", completedRows: 91 },
      idempotencyKey: "partial-workbook-checkpoint",
      runId: failed.run.runId,
    })) as PortableArtifact;
    await runtime.raiseException({
      code: "provider_unavailable",
      message: "The provider stayed unavailable after bounded retries.",
      preservedState: { artifactId: partial.artifactId },
      runId: failed.run.runId,
    });
    const firstFailure = (await runtime.failRunSafely({
      reason: "Provider remained unavailable.",
      runId: failed.run.runId,
    })) as PortableCompletion;
    const failureRetry = (await runtime.failRunSafely({
      reason: "Provider remained unavailable.",
      runId: failed.run.runId,
    })) as PortableCompletion;
    expect(firstFailure.receipt.status).toBe("failed_safely");
    expect(firstFailure.receipt.artifactBindings).toContainEqual(
      expect.objectContaining({ artifactId: partial.artifactId }),
    );
    expect(failureRetry.reused).toBe(true);
    expect(failureRetry.receipt).toEqual(firstFailure.receipt);
  });
});
