import { createHash } from "node:crypto";
import {
  NODE_GYM_CORE_PACKAGE_VERSION,
  NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
  adaptNodeGymRunnerReceipt,
  assertPairedHarnessRuns,
  buildCurriculumBoundary,
  buildNodeGymMatrix,
  diagnoseNodeGymRun,
  proposeNodeGymPromotion,
  selectNodeGymShadowRoute,
  type NodeGymHarnessProfile,
  type NodeGymRunPlan,
  type NodeGymRunReceipt,
  type NodeGymScores,
} from "@nodekit/gym-core";

const REPETITIONS = 3;
const CURRENT_HARNESS_ID = "noderoom-room-change-current";
const CHALLENGER_HARNESS_ID = "noderoom-room-change-evidence-first";

const roomChangeTask = {
  goal: "Review a source-backed diligence-room cell change without silently applying it.",
  roomId: "room:nodegym:deterministic-control",
  artifactId: "workbook:operating-model",
  target: "Revenue!D12",
  expectedVersion: 7,
  proposedValue: 42_500_000,
  approvalBoundary: "proposal-only-until-human-acceptance",
} as const;

const boundedEvidence = {
  traceId: "trace:nodegym:room-change-control",
  receipts: [
    { kind: "room-read", ref: "Revenue!C12:D12", status: "passed" },
    { kind: "source-evidence", ref: "source:synthetic-board-plan", status: "passed" },
    { kind: "version-check", expectedVersion: 7, status: "passed" },
  ],
  containsCredentials: false,
  synthetic: true,
} as const;

const roomPolicy = {
  policyId: "noderoom.human-owned-artifact/v1",
  writesRequireRoomTools: true,
  silentOverwriteAllowed: false,
  promotionRequiresHumanPreference: true,
  autoApply: false,
} as const;

const harnesses: NodeGymHarnessProfile[] = [
  {
    id: CURRENT_HARNESS_ID,
    version: "1.0.0",
    weight: "structured",
    role: "Review a NodeRoom artifact change under human ownership",
    contextStrategy: "bounded room state plus source receipt",
    toolIds: ["read_range", "propose_lock", "edit_cell", "release_lock"],
    repairPolicy: "stop on failed verification",
  },
  {
    id: CHALLENGER_HARNESS_ID,
    version: "1.0.0",
    weight: "repair",
    role: "Review a NodeRoom artifact change under human ownership",
    contextStrategy: "bounded room state, source receipt, expected version, and approval boundary",
    toolIds: ["read_range", "propose_lock", "propose_edit", "verify_proposal", "release_lock"],
    repairPolicy: "one bounded repair; never apply without human acceptance",
  },
];

const currentScores: NodeGymScores = {
  briefAdherence: 0.82,
  storyQuality: 0.75,
  visualPreference: 0.7,
  factualAccuracy: 0.92,
  toolReliability: 0.86,
  exportFidelity: 0.88,
  repairSuccess: 0.78,
  editability: 0.9,
};

const challengerScores: NodeGymScores = {
  briefAdherence: 0.9,
  storyQuality: 0.82,
  visualPreference: 0.72,
  factualAccuracy: 0.97,
  toolReliability: 0.94,
  exportFidelity: 0.9,
  repairSuccess: 0.9,
  editability: 0.92,
};

export interface NodeRoomGymConsumerProof {
  schemaVersion: "noderoom.node-gym-consumer-proof/v1";
  proofLane: "deterministic-contract-control";
  package: {
    name: "@nodekit/gym-core";
    version: string;
    dependencyFreeDomainCore: true;
  };
  task: {
    id: string;
    taskClass: string;
    taskDigest: string;
    evidenceDigest: string;
    referenceDigest: string;
    traceId: string;
    synthetic: true;
  };
  matrix: {
    runCount: number;
    harnessCount: number;
    repetitions: number;
    exactHarnessPairs: number;
    modelId: string;
    currentHarness: string;
    challengerHarness: string;
    pairingVerified: true;
    adaptedReceipts: number;
  };
  evaluation: {
    automatedHardGatesPassed: true;
    firstUnreliableCurriculumLevel: number | null;
    diagnosisCodes: Record<string, string[]>;
    notAnOfficialBenchmark: true;
    noModelCapabilityClaim: true;
  };
  promotion: ReturnType<typeof proposeNodeGymPromotion> & {
    mutationApplied: false;
    humanAcceptanceRequired: true;
  };
  shadowRoute: ReturnType<typeof selectNodeGymShadowRoute>;
  governance: {
    autoApply: false;
    userVisibleShadowRouting: false;
    humanOwnedArtifactUnchanged: true;
    credentialsPersisted: false;
  };
}

/**
 * Runs a deterministic NodeRoom-domain contract proof. It exercises matrix,
 * receipt adaptation, exact harness pairing, diagnosis, curriculum, promotion,
 * and shadow-route contracts without calling a provider or mutating a room.
 */
export function buildNodeRoomGymConsumerProof(): NodeRoomGymConsumerProof {
  const task = {
    id: "noderoom-evidence-bound-room-change",
    taskClass: "noderoom.room-change-review",
    curriculumLevel: 4,
    pool: "public-development" as const,
    taskDigest: digest(roomChangeTask),
    evidenceDigest: digest(boundedEvidence),
    referenceDigest: digest(roomPolicy),
  };
  const plans = buildNodeGymMatrix({
    tasks: [task],
    models: [
      {
        id: "noderoom-deterministic-control",
        provider: "local",
        route: "deterministic-contract",
        returnedModelRequired: false,
        cohort: "control",
      },
    ],
    harnesses,
    budget: {
      maxTokens: 2_048,
      maxLatencyMs: 20_000,
      maxCostMicroUsd: 0,
      maxRepairs: 1,
    },
    repetitions: REPETITIONS,
  });

  const currentPlans = plansForHarness(plans, CURRENT_HARNESS_ID);
  const challengerPlans = plansForHarness(plans, CHALLENGER_HARNESS_ID);
  const currentReceipts: NodeGymRunReceipt[] = [];
  const challengerReceipts: NodeGymRunReceipt[] = [];

  for (let index = 0; index < REPETITIONS; index += 1) {
    const current = currentPlans[index];
    const challenger = challengerPlans[index];
    if (!current || !challenger) throw new Error("NodeRoom NodeGym matrix is missing an exact pair.");
    assertPairedHarnessRuns(current, challenger);
    currentReceipts.push(adaptReceipt(current, currentScores, 1_100 + index * 10));
    challengerReceipts.push(adaptReceipt(challenger, challengerScores, 1_250 + index * 10));
  }

  const receipts = [...currentReceipts, ...challengerReceipts];
  const curriculum = buildCurriculumBoundary(plans, receipts, 1);
  const diagnoses = Object.fromEntries(
    plans.map((plan) => {
      const receipt = receipts.find((candidate) => candidate.runId === plan.runId);
      if (!receipt) throw new Error(`NodeRoom NodeGym receipt is missing for ${plan.runId}.`);
      return [plan.runId, diagnoseNodeGymRun(plan, receipt)];
    }),
  );
  const promotion = proposeNodeGymPromotion({
    champion: currentReceipts,
    challenger: challengerReceipts,
    comparisonMode: "harness",
    humanPreferencesComplete: false,
    challengerPreferenceWins: 0,
    policy: {
      minimumMatchedCases: REPETITIONS,
      minimumPreferenceWinRate: 0.6,
      minimumMeanUtilityDelta: 0.01,
      maximumDimensionRegression: 0.02,
      minimumStableRepetitions: REPETITIONS,
      requiresHumanReview: true,
      autoApply: false,
    },
  });
  if (promotion.decision !== "hold" || !promotion.blockers.includes("human_review_incomplete"))
    throw new Error("NodeRoom NodeGym must hold promotion until model-blind human review completes.");
  if (promotion.autoApply !== false) throw new Error("NodeRoom NodeGym promotion must be advisory.");

  const shadowRoute = selectNodeGymShadowRoute({
    taskClass: task.taskClass,
    champions: [
      {
        taskClass: task.taskClass,
        model: "noderoom-deterministic-control",
        harness: `${CHALLENGER_HARNESS_ID}@1.0.0`,
        eligible: false,
      },
    ],
    fallback: {
      model: "noderoom-deterministic-control",
      harness: `${CURRENT_HARNESS_ID}@1.0.0`,
    },
  });
  if (shadowRoute.mode !== "fallback" || shadowRoute.userVisible !== false)
    throw new Error("NodeRoom NodeGym must keep an ineligible challenger off the shadow route.");
  const automatedHardGatesPassed = receipts.every(
    (receipt) => receipt.status === "passed" && receipt.hardGatesPassed,
  );
  if (!automatedHardGatesPassed)
    throw new Error("NodeRoom NodeGym deterministic contract receipts failed an automated gate.");

  return {
    schemaVersion: "noderoom.node-gym-consumer-proof/v1",
    proofLane: "deterministic-contract-control",
    package: {
      name: "@nodekit/gym-core",
      version: NODE_GYM_CORE_PACKAGE_VERSION,
      dependencyFreeDomainCore: true,
    },
    task: {
      id: task.id,
      taskClass: task.taskClass,
      taskDigest: task.taskDigest,
      evidenceDigest: task.evidenceDigest,
      referenceDigest: task.referenceDigest,
      traceId: boundedEvidence.traceId,
      synthetic: true,
    },
    matrix: {
      runCount: plans.length,
      harnessCount: harnesses.length,
      repetitions: REPETITIONS,
      exactHarnessPairs: REPETITIONS,
      modelId: "noderoom-deterministic-control",
      currentHarness: `${CURRENT_HARNESS_ID}@1.0.0`,
      challengerHarness: `${CHALLENGER_HARNESS_ID}@1.0.0`,
      pairingVerified: true,
      adaptedReceipts: receipts.length,
    },
    evaluation: {
      automatedHardGatesPassed: true,
      firstUnreliableCurriculumLevel: curriculum.firstUnreliableLevel,
      diagnosisCodes: diagnoses,
      notAnOfficialBenchmark: true,
      noModelCapabilityClaim: true,
    },
    promotion: {
      ...promotion,
      mutationApplied: false,
      humanAcceptanceRequired: true,
    },
    shadowRoute,
    governance: {
      autoApply: false,
      userVisibleShadowRouting: false,
      humanOwnedArtifactUnchanged: true,
      credentialsPersisted: false,
    },
  };
}

function plansForHarness(plans: NodeGymRunPlan[], harnessId: string): NodeGymRunPlan[] {
  return plans
    .filter((plan) => plan.harness.id === harnessId)
    .sort((left, right) => left.repetition - right.repetition);
}

function adaptReceipt(
  plan: NodeGymRunPlan,
  scores: NodeGymScores,
  latencyMs: number,
): NodeGymRunReceipt {
  return adaptNodeGymRunnerReceipt({
    plan,
    runnerReceipt: {
      schemaVersion: NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
      runId: plan.runId,
      comparisonKey: plan.comparisonKey,
      harnessPairingKey: plan.harnessPairingKey,
      pairingKey: plan.harnessPairingKey,
      repetition: plan.repetition,
      status: "passed",
      returnedModel: "noderoom/deterministic-contract-control",
      automatedHardGatesPassed: true,
      issueCodes: [],
      usage: {
        latencyMs,
        inputTokens: 256,
        outputTokens: 96,
        costMicroUsd: 0,
        repairCount: 0,
      },
    },
    scores,
    humanInterventions: 0,
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
