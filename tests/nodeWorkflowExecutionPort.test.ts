import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  runAlgorithmArtifact,
  type AlgorithmArtifact,
  type AlgorithmArtifactResult,
} from "../src/nodeagent/skills/spreadsheet/algorithmArtifacts";
import {
  inspectRoomWorkflowCandidate,
  canonicalNodeWorkflowJson,
  createNativeNodeWorkflowExecutionPort,
  createNodeWorkflowSidecarExecutionPort,
  NODE_WORKFLOW_PROTOCOL_VERSION,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  type RoomAlgorithmWorkflowCandidate,
  type RoomWorkflowCandidate,
} from "../src/nodeagent/integrations";

const request: NodeWorkflowRequest = {
  schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
  app: "noderoom",
  workflow: "independent-cell-enrichment",
  fixtureId: "noderoom-independent-writes-v1",
  traceId: "trace-noderoom-independent-writes-1",
  inputDigest: `sha256:${"1".repeat(64)}`,
  idempotencyKey: "noderoom-independent-writes-v1:run-1",
  concurrency: 4,
  deadlineMs: 10_000,
};

describe("NodeRoom workflow execution port", () => {
  it("admits a deterministic patch candidate without exposing a write path", async () => {
    const candidate = frozenStudyCandidate();
    const result = resultFor(candidate);

    const admission = await inspectRoomWorkflowCandidate({
      request,
      result,
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      digestCandidate: digest,
      now: () => new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(admission.accepted).toBe(true);
    expect(admission.receipt).toMatchObject({
      status: "candidate_validated",
      traceId: request.traceId,
      finalWriteAuthority: "application_validation_cas_review",
    });
    expect(Object.keys(admission)).not.toContain("commit");
    expect(Object.keys(admission)).not.toContain("roomTools");
    if (!admission.accepted) throw new Error("expected candidate admission");
    expect(Object.isFrozen(admission.candidate)).toBe(true);
    if (admission.candidate.kind !== "algorithm_patch_bundle")
      throw new Error("fixture kind mismatch");
    expect(Object.isFrozen(admission.candidate.bundle.patches)).toBe(true);
  });

  it("rejects a swapped request digest before a candidate can reach RoomTools", async () => {
    const candidate = buildCandidate();
    const result = resultFor(candidate);
    result.inputDigest = `sha256:${"2".repeat(64)}`;

    const admission = await inspectRoomWorkflowCandidate({
      request,
      result,
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues).toContain(
      "Result is not bound to the request input digest.",
    );
  });

  it("rejects duplicate targets even when an executor reports success", async () => {
    const candidate = buildCandidate();
    candidate.bundle.patches.push(
      structuredClone(candidate.bundle.patches[0]!),
    );
    candidate.bundle.writeLockedCellResultsArgs.ops.push(
      structuredClone(candidate.bundle.writeLockedCellResultsArgs.ops[0]!),
    );
    candidate.bundle.proof.outputRefs.push(
      structuredClone(candidate.bundle.proof.outputRefs[0]!),
    );
    const result = resultFor(candidate);

    const admission = await inspectRoomWorkflowCandidate({
      request,
      result,
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues.join("\n")).toContain(
      "Duplicate NodeRoom patch target",
    );
  });

  it("rejects replay-key and frozen-commit provenance mismatches", async () => {
    const candidate = frozenStudyCandidate();
    const result = resultFor(candidate);
    result.idempotencyKey = "different-delivery";
    result.traceId = "different-trace";
    result.provenance.appCommit = "unfrozen-commit";

    const admission = await inspectRoomWorkflowCandidate({
      request,
      result,
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues).toContain(
      "Result is not bound to the request idempotency key.",
    );
    expect(admission.receipt.issues).toContain(
      "Result is not bound to the request trace ID.",
    );
    expect(admission.receipt.issues).toContain(
      "Runtime provenance does not match the frozen application commit.",
    );
  });

  it("calls a fixed RocketRide sidecar with only the workflow request", async () => {
    const candidate = frozenStudyCandidate();
    const sidecarResult = resultFor(candidate);
    sidecarResult.framework = "rocketride";
    let posted: unknown;
    const port = createNodeWorkflowSidecarExecutionPort<RoomWorkflowCandidate>({
      framework: "rocketride",
      endpoint: "http://127.0.0.1:5567/v1/candidates",
      fetch: (async (_input, init) => {
        posted = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(sidecarResult), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const received = await port.execute(request);

    expect(received.framework).toBe("rocketride");
    expect(posted).toEqual(request);
    expect(posted).not.toHaveProperty("roomTools");
    expect(() =>
      createNodeWorkflowSidecarExecutionPort({
        framework: "langchain",
        endpoint: "http://example.com/v1/candidates",
      }),
    ).toThrow("require HTTPS");
    expect(() =>
      createNodeWorkflowSidecarExecutionPort({
        framework: "langchain",
        endpoint: "http://[::1]:5567/v1/candidates",
      }),
    ).not.toThrow();
  });

  it("clones requests before invoking the native control", async () => {
    const candidate = frozenStudyCandidate();
    const port = createNativeNodeWorkflowExecutionPort<RoomWorkflowCandidate>(
      async (received) => {
        (received as NodeWorkflowRequest).workflow = "mutated-by-control";
        return resultFor(candidate);
      },
    );

    await port.execute(request);

    expect(request.workflow).toBe("independent-cell-enrichment");
  });

  it("rejects an invalid post-execution runtime health signal", async () => {
    const candidate = frozenStudyCandidate();
    const result = resultFor(candidate);
    result.metrics.runtimeHealthyAfter = "healthy" as unknown as boolean;

    const admission = await inspectRoomWorkflowCandidate({
      request,
      result,
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues).toContain(
      "Post-execution runtime health must be boolean when reported.",
    );
  });

  it("admits the frozen conflict proposal but rejects a sidecar policy override", async () => {
    const conflictRequest: NodeWorkflowRequest = {
      ...request,
      workflow: "compare-reason-swap-conflict",
      fixtureId: "noderoom-conflict-proposal-v1",
      traceId: "trace-noderoom-conflict-proposal-1",
      baseVersion: 3,
      idempotencyKey: "noderoom-conflict-proposal-v1:run-1",
    };
    const candidate = frozenConflictCandidate();
    const admission = await inspectRoomWorkflowCandidate({
      request: conflictRequest,
      result: resultFor(candidate, conflictRequest),
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      expectedRoomId: "room-1",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(true);
    if (candidate.kind !== "semantic_conflict_resolution")
      throw new Error("fixture kind mismatch");
    candidate.resolution.decision = "accept_proposed";
    const tampered = await inspectRoomWorkflowCandidate({
      request: conflictRequest,
      result: resultFor(candidate, conflictRequest),
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      expectedRoomId: "room-1",
      digestCandidate: digest,
    });
    expect(tampered.accepted).toBe(false);
    expect(tampered.receipt.issues).toContain(
      "NodeRoom semantic resolution does not match the application-owned policy resolver.",
    );

    const crossRoomCandidate = frozenConflictCandidate();
    const crossRoom = await inspectRoomWorkflowCandidate({
      request: conflictRequest,
      result: resultFor(crossRoomCandidate, conflictRequest),
      expectedAppCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      expectedRoomId: "room-2",
      digestCandidate: digest,
    });
    expect(crossRoom.accepted).toBe(false);
    expect(crossRoom.receipt.issues).toContain(
      "NodeRoom semantic candidate crossed the expected room boundary.",
    );
  });
});

function frozenStudyCandidate(): RoomWorkflowCandidate {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/rocketride-noderoom-independent-writes.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { candidate: RoomWorkflowCandidate };
  return fixture.candidate;
}

function frozenConflictCandidate(): RoomWorkflowCandidate {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/rocketride-noderoom-conflict-proposal.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { candidate: RoomWorkflowCandidate };
  return fixture.candidate;
}

function buildCandidate(): RoomAlgorithmWorkflowCandidate {
  const artifact: AlgorithmArtifact = {
    schema: 1,
    algorithmId: "revenue_variance_pct_v1",
    name: "Revenue variance percent",
    kind: "spreadsheet_formula",
    language: "formula_dsl",
    inputs: [
      { id: "q2", elementId: "r_rev__q2", label: "Q2 revenue" },
      { id: "q3", elementId: "r_rev__q3", label: "Q3 revenue" },
    ],
    outputs: [
      {
        id: "variancePct",
        elementId: "r_rev__variance",
        expression: "(q3 - q2) / q2",
        format: "percent",
      },
    ],
    constraints: {
      deterministic: true,
      noNetwork: true,
      noRandom: true,
      noDateNow: true,
    },
    tests: [
      {
        name: "revenue variance",
        inputs: { q2: 10_000, q3: 12_400 },
        expected: { variancePct: 0.24 },
      },
    ],
  };
  const produced = runAlgorithmArtifact(artifact, {
    r_rev__q2: { id: "r_rev__q2", value: "$10,000", version: 1 },
    r_rev__q3: { id: "r_rev__q3", value: "$12,400", version: 1 },
    r_rev__variance: { id: "r_rev__variance", value: "", version: 3 },
  });
  return { kind: "algorithm_patch_bundle", bundle: expectBundle(produced) };
}

function resultFor(
  candidate: RoomWorkflowCandidate,
  sourceRequest: NodeWorkflowRequest = request,
): NodeWorkflowResult<RoomWorkflowCandidate> {
  return {
    schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
    runId: "noderoom-native-001",
    traceId: sourceRequest.traceId,
    framework: "native",
    candidate,
    inputDigest: sourceRequest.inputDigest,
    idempotencyKey: sourceRequest.idempotencyKey,
    outputDigest: digest(candidate),
    events: [
      { sequence: 1, atMs: 0, kind: "run.started" },
      {
        sequence: 2,
        atMs: 12,
        kind: "candidate.produced",
        unitId: "r_rev__variance",
      },
    ],
    metrics: {
      coldStartMs: 1,
      warmupMs: 0,
      executionMs: 11,
      totalMs: 12,
      retryCount: 0,
      completedUnits: 1,
      failedUnits: 0,
      duplicateUnits: 0,
      leakedUnits: 0,
    },
    provenance: {
      adapter: "noderoom-native",
      adapterVersion: "1.0.0",
      runtime: "node",
      runtimeVersion: process.version,
      appCommit: "ca25e347dc467bc37f06918e1a18656f7336ee28",
      deterministic: true,
      location: "local",
    },
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalNodeWorkflowJson(value)).digest("hex")}`;
}

function expectBundle(result: AlgorithmArtifactResult) {
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.bundle;
}
