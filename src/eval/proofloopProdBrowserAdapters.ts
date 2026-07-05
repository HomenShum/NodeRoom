import {
  buildProofloopProdProxyBenchmarkMatrix,
  type ProdProxyFamily,
} from "./proofloopProdProxyBenchmarkMatrix";

export type ProofloopProdBrowserAdapterStatus =
  | "contract_scaffolded"
  | "browser_scenario_ready";

export type ProofloopProdBrowserScenarioStatus = "missing" | "ready";

export type ProofloopProdBrowserAdapterSpec = {
  id: string;
  familyId: string;
  version: string;
  status: ProofloopProdBrowserAdapterStatus;
  browserScenarioStatus: ProofloopProdBrowserScenarioStatus;
  taskCount: number;
  attemptCountAtCurrentMatrix: number;
  sourceBenchmark: string;
  taskLoader: string;
  browserScenario: string;
  commandShape: string;
  existingSmoke?: string;
  requiredArtifacts: string[];
  scorerBoundary: string;
  blockers: string[];
  changelog: string[];
};

export type ProofloopProdBrowserAdapterLedger = {
  schema: "proofloop-prod-browser-adapter-ledger-v1";
  generatedAt?: string;
  harnessVersion: string;
  matrixModelCount: number;
  summary: {
    adaptersTracked: number;
    contractScaffolded: number;
    browserScenarioMissing: number;
    taskTargetsCoveredByContracts: number;
    modelTaskAttemptsCoveredByContracts: number;
  };
  adapters: ProofloopProdBrowserAdapterSpec[];
};

const HARNESS_VERSION = "prod-browser-adapters-2026-07-05.4";

export function buildProofloopProdBrowserAdapterLedger(args: {
  root?: string;
  generatedAt?: string;
  models?: string[];
} = {}): ProofloopProdBrowserAdapterLedger {
  const matrix = buildProofloopProdProxyBenchmarkMatrix({
    root: args.root,
    generatedAt: args.generatedAt,
    models: args.models,
  });
  const families = new Map(matrix.families.map((family) => [family.id, family]));
  const specs = [
    spreadsheetV1Adapter(families.get("spreadsheetbench-v1-full-912"), matrix.summary.modelCount),
    spreadsheetV2Adapter(families.get("spreadsheetbench-v2-full-321"), matrix.summary.modelCount),
    configBackedBrowserAdapter(families.get("accounting-live-proofloop"), matrix.summary.modelCount, {
      id: "accounting-live-config-to-prod-browser-room",
      sourceBenchmark: "Accounting ProofLoop product suite",
      taskLoader: "proofloop/accounting/live.accounting.config.json",
      browserScenario: "proofloop/live-browser-proof.spec.ts",
      commandShape: "npm run proofloop:live:accounting:browser -- --prod --task-id <taskId> --model <modelId> --real-user",
      scorerBoundary: "Product proof-loop suite; no official accounting benchmark score is claimed unless an upstream scorer is imported.",
      ready: true,
      blocker: "No passing prod receipts are recorded for every accounting task/model yet; run the long-run queue to replace this with score evidence.",
    }),
    configBackedBrowserAdapter(families.get("notion-live-proofloop"), matrix.summary.modelCount, {
      id: "notion-live-config-to-prod-browser-room",
      sourceBenchmark: "Notion SDR/BDR ProofLoop product suite",
      taskLoader: "proofloop/notion/live.notion.config.json",
      browserScenario: "proofloop/live-browser-proof.spec.ts",
      commandShape: "npm run proofloop:live:notion:browser -- --prod --task-id <taskId> --model <modelId> --real-user",
      scorerBoundary: "Product workflow suite; no official public benchmark score is claimed.",
      ready: true,
      blocker: "No passing prod receipts are recorded for every Notion task/model yet; run the long-run queue to replace this with score evidence.",
    }),
    configBackedBrowserAdapter(families.get("proximitty-underwriting-pr0"), matrix.summary.modelCount, {
      id: "proximitty-underwriting-prod-browser-room",
      sourceBenchmark: "Synthetic Proximitty underwriting ProofLoop suite",
      taskLoader: "proofloop/scenarios/proximitty-*.spec.ts",
      browserScenario: "proofloop/benchmarks/proximitty/live-room-scenario.spec.ts",
      commandShape: "npm run proofloop:proximitty:browser -- --prod --scenario <taskId> --model <modelId> --real-user",
      scorerBoundary: "Synthetic underwriting evaluation only; not a real lending, insurance, legal, or financial decision score.",
      ready: true,
      blocker: "No passing prod receipts are recorded for every Proximitty task/model yet; run the long-run queue to replace this with score evidence.",
    }),
    configBackedBrowserAdapter(families.get("noderoom-multi-user-conflict"), matrix.summary.modelCount, {
      id: "noderoom-multi-user-conflict-prod-browser-room",
      sourceBenchmark: "NodeRoom internal multi-user coordination suite",
      taskLoader: "tests/multiUserCoordinationProof.test.ts",
      browserScenario: "proofloop/benchmarks/noderoom-multi-user/live-room-scenario.spec.ts",
      commandShape: "npm run proofloop:live:multi-user-conflict -- --prod --task-id <taskId> --model <modelId> --real-user",
      scorerBoundary: "Internal product coordination benchmark; no external official score is claimed.",
      ready: true,
      blocker: "No passing prod receipts are recorded for every multi-user conflict task/model yet; run the long-run queue to replace this with score evidence.",
    }),
  ];

  return {
    schema: "proofloop-prod-browser-adapter-ledger-v1",
    generatedAt: args.generatedAt,
    harnessVersion: HARNESS_VERSION,
    matrixModelCount: matrix.summary.modelCount,
    summary: {
      adaptersTracked: specs.length,
      contractScaffolded: specs.filter((spec) => spec.status === "contract_scaffolded").length,
    browserScenarioMissing: specs.filter((spec) => spec.browserScenarioStatus === "missing").length,
      taskTargetsCoveredByContracts: specs.reduce((sum, spec) => sum + spec.taskCount, 0),
      modelTaskAttemptsCoveredByContracts: specs.reduce((sum, spec) => sum + spec.attemptCountAtCurrentMatrix, 0),
    },
    adapters: specs,
  };
}

export function renderProofloopProdBrowserAdapterLedgerMarkdown(ledger: ProofloopProdBrowserAdapterLedger): string {
  const lines = [
    "# ProofLoop Prod Browser Adapter Ledger",
    "",
    `Generated: ${ledger.generatedAt ?? "unknown"}`,
    `Harness version: \`${ledger.harnessVersion}\``,
    "",
    "This ledger tracks prod-browser adapter contracts and readiness. A contract is not a pass: every task/model remains unverified until the named browser scenario produces receipts.",
    "",
    "## Summary",
    "",
    `- Adapters tracked: ${ledger.summary.adaptersTracked}`,
    `- Contracts scaffolded: ${ledger.summary.contractScaffolded}`,
    `- Browser scenarios still missing: ${ledger.summary.browserScenarioMissing}`,
    `- Task targets covered by contracts: ${ledger.summary.taskTargetsCoveredByContracts}`,
    `- Model-task attempts covered by contracts: ${ledger.summary.modelTaskAttemptsCoveredByContracts}`,
    "",
    "## Adapters",
    "",
    "| Adapter | Family | Version | Tasks | Attempts | Contract | Browser scenario | Command shape |",
    "|---|---|---:|---:|---:|---|---|---|",
    ...ledger.adapters.map((adapter) =>
      `| \`${adapter.id}\` | \`${adapter.familyId}\` | ${adapter.version} | ${adapter.taskCount} | ${adapter.attemptCountAtCurrentMatrix} | ${adapter.status} | ${adapter.browserScenarioStatus} | \`${adapter.commandShape}\` |`,
    ),
    "",
    "## Blockers",
    "",
    ...ledger.adapters.map((adapter) =>
      `- \`${adapter.id}\`: ${adapter.blockers[0] ?? "none"}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function adapterSpecForFamily(
  ledger: ProofloopProdBrowserAdapterLedger,
  familyId: string,
): ProofloopProdBrowserAdapterSpec | undefined {
  return ledger.adapters.find((adapter) => adapter.familyId === familyId);
}

function spreadsheetV1Adapter(family: ProdProxyFamily | undefined, modelCount: number): ProofloopProdBrowserAdapterSpec {
  return {
    id: "spreadsheetbench-v1-official-workbook-prod-browser",
    familyId: "spreadsheetbench-v1-full-912",
    version: "0.2.0",
    status: "browser_scenario_ready",
    browserScenarioStatus: "ready",
    taskCount: family?.taskCount ?? 912,
    attemptCountAtCurrentMatrix: (family?.taskCount ?? 912) * modelCount,
    sourceBenchmark: "SpreadsheetBench V1 full 912",
    taskLoader: ".tmp/official-benchmarks/staged-v1-912/tasks/<taskId>/agent/task.json",
    browserScenario: "e2e/benchmark-ui-spreadsheetbench-generic.spec.ts",
    commandShape: "SPREADSHEETBENCH_TASK_ID=<taskId> BENCH_AGENT_MODEL_POLICY=<modelId> npm run proofloop:live:spreadsheetbench-v1",
    existingSmoke: "e2e/benchmark-ui-spreadsheetbench.spec.ts proves one fixed nb-01 style browser path; e2e/benchmark-ui-spreadsheetbench-generic.spec.ts is the generic staged-task adapter.",
    requiredArtifacts: commonArtifacts("spreadsheetbench-v1-official-score.json", "exported-workbook.xlsx"),
    scorerBoundary: "Official workbook scorer/golden metadata must remain evaluator-only until after NodeRoom exports candidate output.",
    blockers: [
      "No passing prod receipts are recorded for every staged V1 task/model yet; run the long-run queue to replace this with score evidence.",
    ],
    changelog: [
      "2026-07-05.1: contract created; existing one-task smoke is explicitly not promoted to the full 912-task adapter.",
      "2026-07-05.2: generic staged-task browser scenario added; tasks are runnable but not scored until receipts exist.",
    ],
  };
}

function spreadsheetV2Adapter(family: ProdProxyFamily | undefined, modelCount: number): ProofloopProdBrowserAdapterSpec {
  return {
    id: "spreadsheetbench-v2-workflow-chart-prod-browser",
    familyId: "spreadsheetbench-v2-full-321",
    version: "0.2.0",
    status: "browser_scenario_ready",
    browserScenarioStatus: "ready",
    taskCount: family?.taskCount ?? 321,
    attemptCountAtCurrentMatrix: (family?.taskCount ?? 321) * modelCount,
    sourceBenchmark: "SpreadsheetBench V2 full 321",
    taskLoader: ".tmp/official-benchmarks/staged-v2-full/tasks/<taskId>/agent/task.json",
    browserScenario: "e2e/benchmark-ui-spreadsheetbench-generic.spec.ts",
    commandShape: "SPREADSHEETBENCH_TASK_ID=<taskId> BENCH_AGENT_MODEL_POLICY=<modelId> npm run proofloop:live:spreadsheetbench-v2",
    existingSmoke: "e2e/benchmark-ui-spreadsheetbench-v2.spec.ts proves one synthetic debugging path; e2e/benchmark-ui-spreadsheetbench-generic.spec.ts is the generic staged-task adapter.",
    requiredArtifacts: commonArtifacts("spreadsheetbench-v2-official-score.json", "exported-workbook.xlsx", "chart-visual-grade.json"),
    scorerBoundary: "Workbook/static scorer and rendered/VLM chart grading must run after candidate export; chart rubrics stay evaluator-only.",
    blockers: [
      "No passing prod receipts are recorded for every staged V2 task/model yet; run the long-run queue to replace this with score evidence.",
    ],
    changelog: [
      "2026-07-05.1: contract created; existing synthetic V2 smoke remains only an adapter seed.",
      "2026-07-05.2: generic staged-task browser scenario added; tasks are runnable but not scored until receipts exist.",
    ],
  };
}

function configBackedBrowserAdapter(
  family: ProdProxyFamily | undefined,
  modelCount: number,
  args: {
    id: string;
    sourceBenchmark: string;
    taskLoader: string;
    browserScenario: string;
    commandShape: string;
    scorerBoundary: string;
    blocker: string;
    ready?: boolean;
  },
): ProofloopProdBrowserAdapterSpec {
  const ready = args.ready === true;
  return {
    id: args.id,
    familyId: family?.id ?? args.id,
    version: ready ? "0.2.0" : "0.1.0",
    status: ready ? "browser_scenario_ready" : "contract_scaffolded",
    browserScenarioStatus: ready ? "ready" : "missing",
    taskCount: family?.taskCount ?? 0,
    attemptCountAtCurrentMatrix: (family?.taskCount ?? 0) * modelCount,
    sourceBenchmark: args.sourceBenchmark,
    taskLoader: args.taskLoader,
    browserScenario: args.browserScenario,
    commandShape: args.commandShape,
    requiredArtifacts: commonArtifacts(`${args.id}-scorecard.json`),
    scorerBoundary: args.scorerBoundary,
    blockers: [args.blocker],
    changelog: ready
      ? [
        "2026-07-05.1: contract created; current non-browser runner remains evidence but not prod real-user proof.",
        `2026-07-05.4: ${args.browserScenario} promoted as the real-user browser scenario with benchmark runtime profile disabled.`,
      ]
      : [
        "2026-07-05.1: contract created; current non-browser runner remains evidence but not prod real-user proof.",
      ],
  };
}

function commonArtifacts(...extra: string[]): string[] {
  return [
    "live-user-contract.json",
    "node-trace-v2.json",
    "node-eval.json",
    "scorecard.md",
    "cost-ledger.json",
    "verifier-receipt.json",
    "visual-proof.png",
    ...extra,
  ];
}
