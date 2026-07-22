import { describe, expect, it } from "vitest";
import { buildNodeRoomGymConsumerProof } from "../src/integrations/nodegym/nodeRoomGymConsumer";

describe("NodeRoom NodeGym consumer", () => {
  it("adapts and pairs bounded room-change receipts but never self-promotes", () => {
    const proof = buildNodeRoomGymConsumerProof();

    expect(proof).toMatchObject({
      schemaVersion: "noderoom.node-gym-consumer-proof/v1",
      proofLane: "deterministic-contract-control",
      matrix: {
        runCount: 6,
        harnessCount: 2,
        repetitions: 3,
        exactHarnessPairs: 3,
        modelId: "noderoom-deterministic-control",
        currentHarness: "noderoom-room-change-current@1.0.0",
        challengerHarness: "noderoom-room-change-evidence-first@1.0.0",
        pairingVerified: true,
        adaptedReceipts: 6,
      },
      evaluation: {
        automatedHardGatesPassed: true,
        firstUnreliableCurriculumLevel: null,
        notAnOfficialBenchmark: true,
        noModelCapabilityClaim: true,
      },
      promotion: {
        decision: "hold",
        matchedCases: 3,
        comparisonMode: "harness",
        matchedIdentityCohorts: 1,
        stableRepetitions: 3,
        autoApply: false,
        mutationApplied: false,
        humanAcceptanceRequired: true,
      },
      shadowRoute: {
        mode: "fallback",
        userVisible: false,
      },
      governance: {
        autoApply: false,
        userVisibleShadowRouting: false,
        humanOwnedArtifactUnchanged: true,
        credentialsPersisted: false,
      },
    });
    expect(proof.promotion.blockers).toContain("human_review_incomplete");
    expect(proof.promotion.blockers).toContain("preference_win_rate_below_gate");
    expect(Object.values(proof.evaluation.diagnosisCodes).flat()).toEqual([]);
    expect(proof.task.taskDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(proof.task.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(proof.task.referenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("is byte-for-byte deterministic", () => {
    expect(JSON.stringify(buildNodeRoomGymConsumerProof())).toBe(
      JSON.stringify(buildNodeRoomGymConsumerProof()),
    );
  });
});
