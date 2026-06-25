import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { freshRoomProofPath } from "../eval/freshRoomProofReceipts";

export type SfnProofCaseId = "FR-010" | "FR-020";

export type SfnProofRunOptions = {
  headed?: boolean;
  baseUrl?: string;
  taskId?: string;
  bundleRoot?: string;
  verifierCommand?: string;
  agentModelMode?: string;
  agentModelPolicy?: string;
  timeoutMs?: number;
};

export type SfnProofCase = {
  id: SfnProofCaseId;
  title: string;
  benchmark: "spreadsheetbench-v1" | "bankertoolbench";
  trackClaim: string;
  fullBenchmarkClaim: "single_case_only" | "full_track";
  playwrightSpec: string;
  receiptPath: string;
  legacyReceiptPaths: string[];
  expectedFiles: string[];
  requiredEnv: string[];
  defaultEnv: Record<string, string>;
  defaultTimeoutMs: number;
};

export type SfnProofRunCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
  expectedFiles: string[];
  receiptPath: string;
};

const DEFAULT_BTB_BUNDLE_ROOT = [
  "D:\\VSCode Projects\\cafecorner_nodebench\\nodebench_ai4\\noderoom\\.tmp\\official-benchmarks\\bankertoolbench-repo\\btb-data",
  ".tmp/official-benchmarks/btb-fixture",
].find((path) => existsSync(resolve(process.cwd(), path))) ?? ".tmp/official-benchmarks/btb-fixture";

export const SFN_PROOF_CASES: Record<SfnProofCaseId, SfnProofCase> = {
  "FR-010": {
    id: "FR-010",
    title: "SpreadsheetBench V1 fresh-room workbook proof",
    benchmark: "spreadsheetbench-v1",
    trackClaim: "One fresh-room SpreadsheetBench V1 UI task with exported/reopened workbook proof.",
    fullBenchmarkClaim: "single_case_only",
    playwrightSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    receiptPath: freshRoomProofPath("FR-010"),
    legacyReceiptPaths: ["docs/eval/spreadsheetbench-live-room-proof.json"],
    expectedFiles: [
      freshRoomProofPath("FR-010"),
      "docs/eval/spreadsheetbench-live-room-proof.json",
      "test-results/spreadsheetbench-export.xlsx",
    ],
    requiredEnv: ["BENCH_BASE_URL"],
    defaultEnv: {
      BENCH_BASE_URL: "http://127.0.0.1:5273",
      BENCH_AGENT_MODEL_MODE: "adaptive",
    },
    defaultTimeoutMs: 25 * 60_000,
  },
  "FR-020": {
    id: "FR-020",
    title: "BankerToolBench fresh-room deliverable package proof",
    benchmark: "bankertoolbench",
    trackClaim: "One fresh-room BTB task through public @nodeagent chat with xlsx/xlsm/pptx/docx/pdf package proof.",
    fullBenchmarkClaim: "single_case_only",
    playwrightSpec: "e2e/benchmark-ui-bankertoolbench.spec.ts",
    receiptPath: freshRoomProofPath("FR-020"),
    legacyReceiptPaths: ["docs/eval/bankertoolbench-live-room-proof.json"],
    expectedFiles: [
      freshRoomProofPath("FR-020"),
      "docs/eval/bankertoolbench-live-room-proof.json",
      "test-results/bankertoolbench/package-manifest.json",
    ],
    requiredEnv: ["BTB_LIVE_ROOM_E2E", "BTB_UI_BUNDLE_ROOT", "BTB_UI_VERIFIER_COMMAND", "BENCH_BASE_URL"],
    defaultEnv: {
      BTB_LIVE_ROOM_E2E: "1",
      BTB_UI_BUNDLE_ROOT: DEFAULT_BTB_BUNDLE_ROOT,
      BTB_UI_VERIFIER_COMMAND: "npm run benchmark:bankertoolbench:proof",
      BENCH_BASE_URL: "http://127.0.0.1:5273",
      BENCH_AGENT_MODEL_MODE: "specific",
      BENCH_AGENT_MODEL_POLICY: "z-ai/glm-5.2",
      BTB_AGENT_COMPLETION_TIMEOUT_MS: String(150 * 60_000),
      BTB_AGENT_TERMINAL_TIMEOUT_MS: String(150 * 60_000),
      BTB_TEST_TIMEOUT_MS: String(310 * 60_000),
      PLAYWRIGHT_TRACE: "on",
      PLAYWRIGHT_RECORD_VIDEO: "1",
    },
    defaultTimeoutMs: 315 * 60_000,
  },
};

export function getSfnProofCase(caseId: string): SfnProofCase {
  const proofCase = SFN_PROOF_CASES[caseId as SfnProofCaseId];
  if (!proofCase) {
    throw new Error(`Unknown proof case ${caseId}; expected one of ${Object.keys(SFN_PROOF_CASES).join(", ")}`);
  }
  return proofCase;
}

export function buildSfnProofRunCommand(caseId: string, options: SfnProofRunOptions = {}): SfnProofRunCommand {
  const proofCase = getSfnProofCase(caseId);
  const env = {
    ...proofCase.defaultEnv,
    ...(options.baseUrl ? { BENCH_BASE_URL: options.baseUrl } : {}),
    ...(options.bundleRoot ? { BTB_UI_BUNDLE_ROOT: options.bundleRoot } : {}),
    ...(options.verifierCommand ? { BTB_UI_VERIFIER_COMMAND: options.verifierCommand } : {}),
    ...(options.taskId ? { BTB_UI_TASK_ID: options.taskId } : {}),
    ...(options.agentModelMode ? { BENCH_AGENT_MODEL_MODE: options.agentModelMode } : {}),
    ...(options.agentModelPolicy ? { BENCH_AGENT_MODEL_POLICY: options.agentModelPolicy } : {}),
  };
  const args = [
    "playwright",
    "test",
    "--config",
    "playwright.real-flow.config.ts",
    proofCase.playwrightSpec,
  ];
  if (options.headed) args.push("--headed");
  return {
    command: "npx",
    args,
    env,
    expectedFiles: proofCase.expectedFiles,
    receiptPath: proofCase.receiptPath,
  };
}

export function missingExpectedProofFiles(caseId: string): string[] {
  const proofCase = getSfnProofCase(caseId);
  return proofCase.expectedFiles.filter((path) => !existsSync(resolve(process.cwd(), path)));
}
