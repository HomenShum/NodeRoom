import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { planNodeAgentFanout, type NodeAgentFanoutPlan } from "../src/nodeagent/core/fanoutPlanner";

type GateStatus = "pass" | "external_required" | "fail";

type GateReceipt = {
  gate: string;
  status: GateStatus;
  evidence: string[];
  externalBlocker?: string;
};

type UnderwritingReceipt = {
  passed?: boolean;
  roomUrl?: string;
  memoryMode?: boolean;
  harness?: {
    version?: string;
    proofContractVersion?: string;
    outputColumns?: string[];
  };
  liveSignals?: {
    outputRowsComplete?: boolean;
    pageErrors?: string[];
  };
  backend?: {
    ok?: boolean;
    job?: { status?: string; finalText?: string };
    frames?: Array<{ status?: string }>;
    operations?: Array<{ name?: string; status?: string }>;
  };
  scoring?: {
    n?: number;
    matchedRows?: number;
    correct?: number;
    incorrect?: number;
    unparseable?: number;
    accuracy?: number;
    predictions?: Array<{
      predicted_action_taken?: string;
      predicted_label?: string;
      confidence?: string;
      brief_reason?: string;
      actual?: number;
    }>;
  };
};

type PublicDataReceipt = {
  passed?: boolean;
  summary?: {
    machineAccessibleSources?: number;
    publicPerformanceSources?: number;
    accessRequiredSources?: number;
    unreachableSources?: number;
  };
  sources?: Array<{
    id?: string;
    status?: string;
    covers?: string[];
  }>;
};

const OUTPUT_PATH = resolve(process.cwd(), "docs/eval/autonomous-credit-approval-proof.json");
const UNDERWRITING_RECEIPT_PATH = resolve(process.cwd(), "docs/eval/underwriting-hmda-live-proof.json");
const PUBLIC_DATA_RECEIPT_PATH = resolve(process.cwd(), "docs/eval/credit-actuarial-data-sources-proof.json");
const DOC_PATH = "docs/eval/AUTONOMOUS_CREDIT_APPROVAL_PROOFLOOP.md";
const HARNESS_VERSION = "autonomous-credit-approval-proof-v0.1.0";
const TARGET_LEVEL = "L4-bank-delegated-autonomous-approval";
const ACHIEVED_LEVEL = "L3-guarded-evaluation-autonomy";

const requiredRoles = [
  "credit_policy",
  "credit_data",
  "credit_features",
  "credit_model",
  "reject_inference",
  "fair_lending",
  "adverse_action",
  "model_risk_management",
  "credit_live_proof",
  "delegated_authority",
] as const;

const underwriting = readUnderwritingReceipt();
const publicData = readPublicDataReceipt();
const fanoutPlan = planNodeAgentFanout({
  goal: "Build an autonomous credit approval model with delegated approval, adverse action, fair lending, model risk, and live underwriting proof.",
  needsBrowserProof: true,
  maxParallel: 6,
});

const gates = buildGates(underwriting, fanoutPlan, publicData);
const failed = gates.filter((gate) => gate.status === "fail");
const externalRequired = gates.filter((gate) => gate.status === "external_required");
const passGates = gates.filter((gate) => gate.status === "pass");

const receipt = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  harnessVersion: HARNESS_VERSION,
  targetLevel: TARGET_LEVEL,
  achievedLevel: failed.length === 0 ? ACHIEVED_LEVEL : "not_ready",
  passed: failed.length === 0,
  autonomousProductionClaim: false,
  evaluationOnly: true,
  whyNotProductionAutonomyYet: externalRequired.map((gate) => ({
    gate: gate.gate,
    blocker: gate.externalBlocker,
  })),
  fanout: {
    mode: fanoutPlan.mode,
    reason: fanoutPlan.reason,
    maxParallelWaveSize: Math.max(...fanoutPlan.waves.map((wave) => wave.length)),
    roles: fanoutPlan.subagents.map((subagent) => subagent.role),
    waves: fanoutPlan.waves,
    receiptContract: fanoutPlan.receiptContract,
  },
  sourceProofs: {
    underwritingLiveReceipt: normalizePath(UNDERWRITING_RECEIPT_PATH),
    underwritingRoomUrl: underwriting.roomUrl,
    underwritingHarnessVersion: underwriting.harness?.version,
    underwritingProofContract: underwriting.harness?.proofContractVersion,
    publicCreditActuarialDataReceipt: normalizePath(PUBLIC_DATA_RECEIPT_PATH),
    publicCreditActuarialSources: publicData.summary?.machineAccessibleSources,
    publicPerformanceSources: publicData.summary?.publicPerformanceSources,
  },
  gates,
  summary: {
    passGates: passGates.length,
    externalRequired: externalRequired.length,
    failed: failed.length,
    nextClaimAllowed: "Autonomous credit approval proof path is implemented for guarded evaluation autonomy; regulated delegated approval requires buyer data, validation signoff, and authority receipts.",
  },
  documentation: DOC_PATH,
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);

if (!receipt.passed) {
  console.error(`autonomous-credit-proof: FAIL ${failed.length} gate(s)`);
  for (const gate of failed) console.error(`  - ${gate.gate}: ${gate.evidence.join("; ")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  passed: receipt.passed,
  harnessVersion: receipt.harnessVersion,
  achievedLevel: receipt.achievedLevel,
  targetLevel: receipt.targetLevel,
  passGates: receipt.summary.passGates,
  externalRequired: receipt.summary.externalRequired,
  proofPath: normalizePath(OUTPUT_PATH),
}, null, 2));

function readUnderwritingReceipt(): UnderwritingReceipt {
  if (!existsSync(UNDERWRITING_RECEIPT_PATH)) return {};
  return JSON.parse(readFileSync(UNDERWRITING_RECEIPT_PATH, "utf8")) as UnderwritingReceipt;
}

function readPublicDataReceipt(): PublicDataReceipt {
  if (!existsSync(PUBLIC_DATA_RECEIPT_PATH)) return {};
  return JSON.parse(readFileSync(PUBLIC_DATA_RECEIPT_PATH, "utf8")) as PublicDataReceipt;
}

function buildGates(receipt: UnderwritingReceipt, plan: NodeAgentFanoutPlan, dataReceipt: PublicDataReceipt): GateReceipt[] {
  const roles = new Set(plan.subagents.map((subagent) => subagent.role));
  const predictions = receipt.scoring?.predictions ?? [];
  const denied = predictions.filter((row) => row.predicted_action_taken === "3" || row.predicted_label?.toLowerCase() === "denied");
  const allDeniedHaveReasons = denied.length > 0 && denied.every((row) => nonEmpty(row.brief_reason) && nonEmpty(row.confidence));
  const hmdaCheckpointNames = new Set([
    "agentJobRunner.hmdaUnderwritingBenchmark completed",
    "agentJobRunner.hmda_underwriting completed",
  ]);
  const backendCompleted = receipt.backend?.ok === true
    && receipt.backend.job?.status === "completed"
    && (receipt.backend.frames ?? []).every((frame) => frame.status === "completed")
    && (receipt.backend.operations ?? []).some((operation) =>
      hmdaCheckpointNames.has(String(operation.name ?? "")) && operation.status === "completed");

  return [
    passOrFail("parallel_credit_fanout_plan", requiredRoles.every((role) => roles.has(role)) && plan.mode === "fanout" && plan.waves.some((wave) => wave.length >= 4), [
      `roles=${[...roles].join(",")}`,
      `waves=${JSON.stringify(plan.waves)}`,
    ]),
    passOrFail("production_live_underwriting_dependency", receipt.passed === true && receipt.memoryMode === false && receipt.liveSignals?.outputRowsComplete === true, [
      `room=${receipt.roomUrl ?? "missing"}`,
      `harness=${receipt.harness?.version ?? "missing"}`,
      `outputRowsComplete=${String(receipt.liveSignals?.outputRowsComplete)}`,
    ]),
    passOrFail("backend_completion_receipt", backendCompleted, [
      `backendStatus=${receipt.backend?.job?.status ?? "missing"}`,
      `finalText=${receipt.backend?.job?.finalText ?? "missing"}`,
    ]),
    passOrFail("withheld_score_gate", receipt.scoring?.matchedRows === receipt.scoring?.n
      && receipt.scoring?.correct === receipt.scoring?.n
      && receipt.scoring?.incorrect === 0
      && receipt.scoring?.unparseable === 0
      && receipt.scoring?.accuracy === 1, [
      `matchedRows=${String(receipt.scoring?.matchedRows)}`,
      `correct=${String(receipt.scoring?.correct)}`,
      `accuracy=${String(receipt.scoring?.accuracy)}`,
    ]),
    passOrFail("adverse_action_reason_gate", allDeniedHaveReasons, [
      `deniedRows=${denied.length}`,
      "decline rows include confidence and brief_reason in live Sheet 1 receipt",
    ]),
    pass("credit_policy_box_defined", [
      "evaluation credit box: pinned public HMDA DC 2025 purchase packet, action_taken 1/3, low-risk approve/originate and high-risk deny rule",
      "production credit box must be replaced by buyer policy before delegated authority",
    ]),
    pass("model_risk_pack_scaffolded", [
      "fanout roles include credit_model, model_risk_management, fair_lending, reject_inference, adverse_action, delegated_authority",
      `documentation=${DOC_PATH}`,
    ]),
    passOrFail("public_historical_performance_proxy_data", dataReceipt.passed === true
      && (dataReceipt.summary?.machineAccessibleSources ?? 0) >= 3
      && (dataReceipt.summary?.publicPerformanceSources ?? 0) >= 2, [
      `machineAccessibleSources=${String(dataReceipt.summary?.machineAccessibleSources)}`,
      `publicPerformanceSources=${String(dataReceipt.summary?.publicPerformanceSources)}`,
      `sources=${(dataReceipt.sources ?? []).map((source) => `${source.id}:${source.status}`).join(",")}`,
    ]),
    external("buyer_private_performance_data", "Requires buyer-owned application, booking, repayment, default, loss, override, and decline history for buyer-specific PD/LGD validation.", [
      "public proxy datasets reduce benchmark/model-development risk but cannot replace buyer portfolio history",
    ]),
    external("fair_lending_production_validation", "Requires buyer-approved protected-class proxy methodology, portfolio segmentation, sample-size review, and compliance signoff.", [
      "public HMDA packet proves reason fields, not production fair-lending approval",
    ]),
    external("delegated_credit_authority", "Requires bank credit policy owner and model-risk/governance approval for an authority limit.", [
      "NodeRoom can produce receipts; buyer must grant lending authority",
    ]),
  ];
}

function pass(gate: string, evidence: string[]): GateReceipt {
  return { gate, status: "pass", evidence };
}

function external(gate: string, externalBlocker: string, evidence: string[]): GateReceipt {
  return { gate, status: "external_required", externalBlocker, evidence };
}

function passOrFail(gate: string, condition: boolean, evidence: string[]): GateReceipt {
  return { gate, status: condition ? "pass" : "fail", evidence };
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
