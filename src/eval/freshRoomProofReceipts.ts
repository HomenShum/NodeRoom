import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FreshRoomProofCaseId = "FR-020" | "FR-020A" | "FR-020B";
export type FreshRoomProofStatus = "passed" | "partial" | "blocked";
export type FreshRoomProofGateStatus = "pass" | "partial" | "blocked";

export type FreshRoomProofGate = {
  id: string;
  label: string;
  status: FreshRoomProofGateStatus;
  evidence?: string[];
  blocker?: string;
};

export type FreshRoomProofCase = {
  id: FreshRoomProofCaseId;
  title: string;
  lane:
    | "finance_domain_gate"
    | "bankertoolbench_selective_task"
    | "bankertoolbench_full_suite";
  status: FreshRoomProofStatus;
  sourceReceipt?: string;
  claimBoundary: string;
  proves: string[];
  doesNotProve: string[];
  gates: FreshRoomProofGate[];
};

export type FreshRoomProofRegistry = {
  schema: 1;
  generatedAt?: string;
  policy: string[];
  summary: {
    cases: number;
    passedCases: number;
    partialCases: number;
    blockedCases: number;
    financeDomainGatePassed: boolean;
    selectiveBankerToolBenchReady: boolean;
    bankerToolBenchFullSuiteReady: boolean;
    liveBrowserBenchmarkReady: boolean;
  };
  cases: FreshRoomProofCase[];
};

export type FinanceDomainReceipt = {
  schema: 1;
  caseId: "FR-020";
  generatedAt?: string;
  sourceReceipt: string;
  status: FreshRoomProofStatus;
  runtimeProfile?: string;
  model?: string;
  costUsd?: number;
  latencyMs?: number;
  mutationCount?: number;
  claimBoundary: string;
  proves: string[];
  doesNotProve: string[];
  gates: FreshRoomProofGate[];
};

type RuntimeReceipt = {
  status?: string;
  runtimeProfile?: string;
  tracePath?: string;
  videoPath?: string | null;
  screenshotPaths?: string[];
  exportedFiles?: string[];
  reopenedFiles?: string[];
  scorer?: { official?: boolean; name?: string; passed?: boolean; outputPath?: string };
  proofSignals?: Record<string, boolean | undefined>;
  pass?: boolean;
  costUsd?: number;
  latencyMs?: number;
  mutationCount?: number;
  evidence?: {
    model?: string;
    totalCases?: number;
    passedCases?: number;
    requiredSignalsFulfilled?: string[];
  };
};

const FR020_RECEIPT = "docs/eval/fresh-room/FR-020/latest.json";
const FINANCE_RECEIPT = "docs/eval/fresh-room/FR-020/finance-domain-receipt.json";
const BTB_SELECTIVE_EVIDENCE = [
  "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
  "docs/eval/loop-ledger/btb-ledger-import-full100-write.json",
  "docs/eval/loop-ledger/btb-ledger-import-full100-preview.json",
  "docs/eval/bankertoolbench-official-contract.json",
  "src/eval/bankerToolBenchRunner.ts",
];

function readJsonIfExists<T>(root: string, relPath: string): T | undefined {
  const abs = join(root, relPath);
  if (!existsSync(abs)) return undefined;
  return JSON.parse(readFileSync(abs, "utf8")) as T;
}

function present(root: string, relPath: string): boolean {
  return existsSync(join(root, relPath));
}

function gate(
  id: string,
  label: string,
  status: FreshRoomProofGateStatus,
  evidence?: string[],
  blocker?: string,
): FreshRoomProofGate {
  return {
    id,
    label,
    status,
    ...(evidence?.length ? { evidence } : {}),
    ...(blocker ? { blocker } : {}),
  };
}

export function buildFinanceDomainReceipt(args: {
  root?: string;
  generatedAt?: string;
} = {}): FinanceDomainReceipt {
  const root = args.root ?? process.cwd();
  const receipt = readJsonIfExists<RuntimeReceipt>(root, FR020_RECEIPT);
  const professionalCasesPassed =
    receipt?.pass === true
    && receipt.runtimeProfile === "finance_domain_gate"
    && receipt.scorer?.passed === true
    && receipt.evidence?.totalCases === receipt.evidence?.passedCases;
  const managedSignals = new Set(receipt?.evidence?.requiredSignalsFulfilled ?? []);
  const traceEvidence = receipt?.tracePath ? [FR020_RECEIPT, receipt.tracePath] : [FR020_RECEIPT];

  return {
    schema: 1,
    caseId: "FR-020",
    generatedAt: args.generatedAt,
    sourceReceipt: FR020_RECEIPT,
    status: professionalCasesPassed ? "passed" : "blocked",
    runtimeProfile: receipt?.runtimeProfile,
    model: receipt?.evidence?.model,
    costUsd: receipt?.costUsd,
    latencyMs: receipt?.latencyMs,
    mutationCount: receipt?.mutationCount,
    claimBoundary:
      "FR-020 is a finance-domain runtime gate. It proves professional workflow execution through the runtime harness, not a live-browser official BankerToolBench score.",
    proves: [
      "21/21 professional finance/GTM workflow cases pass when the FR-020 runtime receipt is present and passing.",
      "Managed write coordination, evidence-bearing cell payloads, privacy boundaries, source traceability, and human-review signals are exercised by the runtime receipt.",
    ],
    doesNotProve: [
      "fresh live-browser benchmark completion",
      "official BankerToolBench score",
      "export/download and reopen proof",
      "Gandalf verifier handoff",
      "full 100-task BankerToolBench suite completion",
    ],
    gates: [
      gate(
        "professional_runtime_cases",
        "All professional finance runtime cases passed",
        professionalCasesPassed ? "pass" : "blocked",
        traceEvidence,
        professionalCasesPassed ? undefined : "FR-020 runtime receipt is missing or not fully passing.",
      ),
      gate(
        "managed_write_coordination",
        "Managed write coordination and no-clobber substrate exercised",
        receipt?.mutationCount && receipt.mutationCount > 0 ? "pass" : "blocked",
        traceEvidence,
        receipt?.mutationCount && receipt.mutationCount > 0 ? undefined : "No mutation evidence found in the FR-020 receipt.",
      ),
      gate(
        "domain_receipts",
        "Finance-domain evidence signals are present",
        ["cell_payload_evidence", "privacy_redaction", "human_review", "artifact_refs"].every((id) => managedSignals.has(id)) ? "pass" : "partial",
        traceEvidence,
        ["cell_payload_evidence", "privacy_redaction", "human_review", "artifact_refs"].every((id) => managedSignals.has(id))
          ? undefined
          : "One or more domain evidence signals are missing from the FR-020 receipt.",
      ),
      gate(
        "live_browser",
        "Fresh live-browser room proof",
        receipt?.proofSignals?.liveBrowser === true ? "pass" : "blocked",
        receipt?.videoPath ? [receipt.videoPath] : undefined,
        receipt?.proofSignals?.liveBrowser === true
          ? undefined
          : "FR-020 explicitly records liveBrowser=false; it cannot satisfy benchmark UI claims.",
      ),
      gate(
        "export_reopen",
        "Export/download and reopen proof",
        receipt?.proofSignals?.exportDownloaded === true && receipt.proofSignals.artifactReopened === true ? "pass" : "blocked",
        [...(receipt?.exportedFiles ?? []), ...(receipt?.reopenedFiles ?? [])],
        receipt?.proofSignals?.exportDownloaded === true && receipt.proofSignals.artifactReopened === true
          ? undefined
          : "FR-020 has no downloaded/reopened artifact evidence.",
      ),
      gate(
        "official_scorer",
        "Official benchmark scorer or verifier handoff",
        receipt?.scorer?.official === true ? "pass" : "blocked",
        receipt?.scorer?.outputPath ? [receipt.scorer.outputPath] : undefined,
        receipt?.scorer?.official === true
          ? undefined
          : "FR-020 uses the professional runtime harness, not an official benchmark scorer.",
      ),
    ],
  };
}

export function buildFreshRoomProofRegistry(args: {
  root?: string;
  generatedAt?: string;
} = {}): FreshRoomProofRegistry {
  const root = args.root ?? process.cwd();
  const finance = buildFinanceDomainReceipt({ root, generatedAt: args.generatedAt });
  const btbEvidencePresent = BTB_SELECTIVE_EVIDENCE.filter((item) => present(root, item));
  const fr020AStatus: FreshRoomProofStatus = btbEvidencePresent.length >= 4 ? "partial" : "blocked";
  const cases: FreshRoomProofCase[] = [
    {
      id: "FR-020",
      title: "Finance-domain runtime proof",
      lane: "finance_domain_gate",
      status: finance.status,
      sourceReceipt: FINANCE_RECEIPT,
      claimBoundary: finance.claimBoundary,
      proves: finance.proves,
      doesNotProve: finance.doesNotProve,
      gates: finance.gates,
    },
    {
      id: "FR-020A",
      title: "Selective BankerToolBench task plumbing proof",
      lane: "bankertoolbench_selective_task",
      status: fr020AStatus,
      claimBoundary:
        "FR-020A can only be cited as selective BankerToolBench plumbing and task-runner evidence until it has a fresh-room UI receipt, downloaded/reopened deliverables, and verifier handoff.",
      proves: [
        "local BankerToolBench staging/runner/scorer plumbing exists",
        "selective task artifacts can be audited without treating them as a full suite",
      ],
      doesNotProve: [
        "official BankerToolBench score",
        "full 100-task BankerToolBench completion",
        "fresh live-browser user flow",
        "Gandalf verifier handoff",
      ],
      gates: [
        gate(
          "runner_plumbing",
          "Selective BankerToolBench runner evidence exists",
          btbEvidencePresent.length >= 4 ? "partial" : "blocked",
          btbEvidencePresent,
          btbEvidencePresent.length >= 4 ? "Runner evidence exists, but it is not a full live-browser proof." : "Selective BTB evidence artifacts are missing.",
        ),
        gate(
          "fresh_room_ui",
          "Fresh live-browser room, official prompt, and public NodeAgent lane",
          "blocked",
          ["docs/eval/official-benchmark-ui-coverage.json"],
          "No FR-020A fresh-room receipt proves this path yet.",
        ),
        gate(
          "export_reopen",
          "Browser-run deliverable export and reopen",
          "blocked",
          ["docs/eval/official-benchmark-ui-coverage.json"],
          "Runner-only deliverables do not satisfy browser export/reopen proof.",
        ),
        gate(
          "official_verifier",
          "Official Gandalf verifier handoff",
          "blocked",
          ["docs/eval/bankertoolbench-official-contract.json"],
          "The official contract is documented, but verifier execution and import are not wired end to end.",
        ),
      ],
    },
    {
      id: "FR-020B",
      title: "Full BankerToolBench suite completion",
      lane: "bankertoolbench_full_suite",
      status: "blocked",
      claimBoundary:
        "FR-020B remains a target until the full official BankerToolBench suite runs through isolated execution, live UI evidence, all deliverable types, and official verifier scoring.",
      proves: [],
      doesNotProve: [
        "100/100 task official completion",
        "benchmark-faithful live-browser task execution",
        "production-quality BTB score",
      ],
      gates: [
        gate(
          "full_suite_execution",
          "All 100 official BankerToolBench tasks execute",
          "blocked",
          ["docs/eval/official-benchmark-readiness.json"],
          "The full suite is not complete through the official harness.",
        ),
        gate(
          "live_browser_package",
          "Fresh-room UI exports Excel/PPTX/DOCX/PDF packages",
          "blocked",
          ["docs/eval/official-benchmark-ui-coverage.json"],
          "No live-browser benchmark package proof exists.",
        ),
        gate(
          "official_score_import",
          "Official verifier score is imported and trace-linked",
          "blocked",
          ["docs/eval/bankertoolbench-official-contract.json"],
          "Gandalf/Harbor verifier execution is not wired end to end.",
        ),
      ],
    },
  ];

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    policy: [
      "FR-020, FR-020A, and FR-020B are separate claims and may not be collapsed into one pass.",
      "A runtime or runner pass may not imply live-browser fresh-room completion.",
      "A selective benchmark task proof may not imply a full-suite official benchmark score.",
      "A benchmark claim must name the exact lane, scorer, UI proof status, export/reopen status, and verifier handoff status.",
    ],
    summary: {
      cases: cases.length,
      passedCases: cases.filter((item) => item.status === "passed").length,
      partialCases: cases.filter((item) => item.status === "partial").length,
      blockedCases: cases.filter((item) => item.status === "blocked").length,
      financeDomainGatePassed: cases.find((item) => item.id === "FR-020")?.status === "passed",
      selectiveBankerToolBenchReady: cases.find((item) => item.id === "FR-020A")?.status === "passed",
      bankerToolBenchFullSuiteReady: cases.find((item) => item.id === "FR-020B")?.status === "passed",
      liveBrowserBenchmarkReady: cases.every((item) =>
        item.gates.some((gate) => gate.id === "live_browser" || gate.id === "fresh_room_ui" || gate.id === "live_browser_package")
          && item.gates.every((gate) =>
            !(gate.id === "live_browser" || gate.id === "fresh_room_ui" || gate.id === "live_browser_package")
            || gate.status === "pass",
          ),
      ),
    },
    cases,
  };
}
