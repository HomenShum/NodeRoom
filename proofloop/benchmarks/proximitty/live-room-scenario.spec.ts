import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createFreshLiveRoom,
  installRuntimeProfile,
  invokePublicNodeAgent,
  modelReceipt,
  openBlankSheet,
  outputDir,
  problemCounts,
  recordBrowserProblems,
  renderInternalScorecard,
  routeIntegrityFailedGates,
  selectAgentRoute,
  uploadFiles,
  writeJson,
  writeText,
  type InternalLiveRoomOptions,
  type InternalNodeAgentProof,
} from "../internal/liveRoomUtils";

type ProximittyTask = {
  id: string;
  title: string;
  prompt: string;
  userMessageNeedle: string;
  passPatterns: RegExp[];
};

const SUITE = "proximitty-underwriting-pr0";
const BASE = process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `proximitty-live-${Date.now()}`;
const TASK_ID_FILTER = parseTaskIds(process.env.PROOFLOOP_TASK_IDS ?? process.env.PROOFLOOP_PROXIMITTY_SCENARIO);
const LIVE_BROWSER_ENABLED = process.env.PROOFLOOP_LIVE_BROWSER === "1";
const OPTIONS: InternalLiveRoomOptions = {
  baseUrl: BASE,
  agentModelMode: process.env.BENCH_AGENT_MODEL_MODE ?? process.env.PROOFLOOP_AGENT_MODEL_MODE ?? "specific",
  agentModelPolicy: process.env.BENCH_AGENT_MODEL_POLICY ?? process.env.PROOFLOOP_AGENT_MODEL_POLICY ?? "openrouter/free-auto",
  runtimeProfile: process.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE ?? (process.env.PROOFLOOP_REAL_USER_MODE === "1" ? "" : "benchmark_completion"),
  agentTimeoutMs: Number(process.env.PROOFLOOP_PROXIMITTY_AGENT_TIMEOUT_MS ?? process.env.PROOFLOOP_AGENT_TIMEOUT_MS ?? 10 * 60_000),
  streamTimeoutMs: Number(process.env.PROOFLOOP_STREAM_WAIT_MS ?? 120_000),
  requireCompletionPhrase: false,
};

const INPUT_REFS = [
  "proofloop/datasets/proximitty-demo-underwriting/company-profile.json",
  "proofloop/datasets/proximitty-demo-underwriting/underwriting-policy.md",
  "proofloop/datasets/proximitty-demo-underwriting/synthetic-financials.csv",
  "proofloop/datasets/proximitty-demo-underwriting/risk-notes.md",
  "proofloop/datasets/proximitty-demo-underwriting/source-pack.md",
];

const TASKS: ProximittyTask[] = [
  {
    id: "proximitty-intake",
    title: "Underwriting intake evidence checklist",
    userMessageNeedle: "evidence checklist",
    prompt: [
      "Use the uploaded synthetic Proximitty underwriting files.",
      "Begin the answer with the phrase 'Synthetic evaluation only'.",
      "Create an evidence checklist for HarborPoint Robotics.",
      "Separate supported facts from needs_review items.",
      "Do not approve, decline, price, bind, lend, insure, or make a real decision.",
    ].join(" "),
    passPatterns: [/HarborPoint/i, /evidence/i, /needs_review|needs review/i, /synthetic|demo/i],
  },
  {
    id: "proximitty-risk-research",
    title: "Source-backed risk research",
    userMessageNeedle: "risk research",
    prompt: [
      "Perform risk research from the uploaded synthetic underwriting packet.",
      "Begin the answer with the phrase 'Synthetic evaluation only'.",
      "Name the revenue growth, debt-service coverage, customer concentration, UCC/lien status, and insurance renewal items.",
      "Every unsupported point must be marked needs_review.",
    ].join(" "),
    passPatterns: [/revenue/i, /debt[- ]service|DSCR/i, /customer concentration/i, /UCC|lien/i, /insurance/i],
  },
  {
    id: "proximitty-underwriting-packet",
    title: "Decision-memo output format",
    userMessageNeedle: "decision memo",
    prompt: [
      "Draft a synthetic underwriting decision memo from the uploaded files.",
      "Begin the answer with the phrase 'Synthetic evaluation only'.",
      "Include sections for Summary, Key Risks, Mitigants, Financial/Risk Signals, Evidence Links, Needs_Review Items, and Next Action Recommendation.",
      "The recommendation must be human review only and must not be an approval, decline, bind, lend, insurance, legal, or pricing decision.",
    ].join(" "),
    passPatterns: [/Summary/i, /Key Risks/i, /Mitigants/i, /Financial\/Risk Signals|Financial.*Risk/i, /Needs_Review|Needs Review/i],
  },
  {
    id: "proximitty-model-comparison",
    title: "Policy and model comparison scaffold",
    userMessageNeedle: "policy comparison",
    prompt: [
      "Create a ProofLoop policy comparison scaffold for this synthetic underwriting workflow.",
      "Begin the answer with the phrase 'Synthetic evaluation only'.",
      "Compare a higher-assurance route with a cheaper route.",
      "Record likely failure layers, cost/latency tradeoffs, and scaffold changes needed before promotion.",
      "Do not claim a real credit, lending, legal, insurance, or underwriting decision.",
    ].join(" "),
    passPatterns: [/higher[- ]assurance|strong/i, /cheaper|cost/i, /failure layer|failure/i, /scaffold/i, /not.*decision|synthetic/i],
  },
];

test.skip(!LIVE_BROWSER_ENABLED, "Set PROOFLOOP_LIVE_BROWSER=1 to run Proximitty prod browser adapter.");

test("Proximitty prod browser adapter: fresh room -> uploaded docs -> public NodeAgent -> verifier receipt", async ({ page }, testInfo) => {
  const tasks = selectedTasks();
  test.setTimeout(Math.max(15 * 60_000, tasks.length * OPTIONS.agentTimeoutMs + 3 * 60_000));
  const recorder = recordBrowserProblems(page);
  await installRuntimeProfile(page, OPTIONS.runtimeProfile);

  const roomStartedAt = new Date().toISOString();
  await createFreshLiveRoom(page, { baseUrl: BASE, displayName: "Proof Loop" });
  await openBlankSheet(page);
  await selectAgentRoute(page, OPTIONS);
  const roomUrl = page.url();
  const uploadedFiles = await uploadFiles(page, INPUT_REFS);

  const taskProofs: Array<{
    taskId: string;
    title: string;
    prompt: string;
    passed: boolean;
    matchedPatterns: string[];
    unmatchedPatterns: string[];
    failedGates: string[];
    agent: InternalNodeAgentProof;
  }> = [];

  for (const task of tasks) {
    const proof = await invokePublicNodeAgent(page, task.prompt, { userMessageNeedle: task.userMessageNeedle }, OPTIONS);
    const matchedPatterns = task.passPatterns
      .filter((pattern) => pattern.test(proof.finalTextSample))
      .map((pattern) => pattern.source);
    const unmatchedPatterns = task.passPatterns
      .filter((pattern) => !pattern.test(proof.finalTextSample))
      .map((pattern) => pattern.source);
    const failedGates = [
      ...Object.entries(proof.gatesNotProven).map(([gate, reason]) => `${gate}: ${reason}`),
      ...unmatchedPatterns.map((pattern) => `pass_pattern_missing: ${pattern}`),
    ];
    taskProofs.push({
      taskId: task.id,
      title: task.title,
      prompt: task.prompt,
      passed: failedGates.length === 0,
      matchedPatterns,
      unmatchedPatterns,
      failedGates,
      agent: proof,
    });
  }

  const dir = outputDir("proximitty-prod-browser", RUN_ID);
  const screenshotPath = join(dir, "visual-proof.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach("proximitty-prod-browser-visual-proof", { path: screenshotPath, contentType: "image/png" });

  const counts = problemCounts(recorder);
  const browserProblems = [
    ...Object.entries(counts).filter(([, count]) => count > 0).map(([gate, count]) => `${gate}: ${count}`),
  ];
  const model = modelReceipt(OPTIONS, taskProofs.map((task) => task.agent));
  const failedGates = [
    ...taskProofs.flatMap((task) => task.failedGates.map((gate) => `${task.taskId}: ${gate}`)),
    ...browserProblems,
    ...routeIntegrityFailedGates(model),
  ];
  const status = failedGates.length === 0 ? "passed" : "failed";
  const common = {
    schema: "proofloop-proximitty-prod-browser-v1",
    suite: SUITE,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    roomStartedAt,
    roomUrl,
    uploadedFiles,
    model,
    tasks,
    taskProofs,
    problemCounts: counts,
    pageErrors: recorder.pageErrors,
    consoleProblems: recorder.consoleProblems,
    requestFailures: recorder.requestFailures,
    badResponses: recorder.badResponses,
    screenshotPaths: [screenshotPath],
    officialScoreClaim: false,
    demoSafety: "Synthetic evaluation only. Not a lending, insurance, legal, pricing, or underwriting decision.",
  };

  const browserProofPath = process.env.PROOFLOOP_SUITE_PROOF_PATH ?? join(dir, "browser-proof.json");
  const nodeEvalPath = join(dir, "node-eval.json");
  const liveUserContractPath = join(dir, "live-user-contract.json");
  const nodeTracePath = join(dir, "node-trace-v2.json");
  const costLedgerPath = join(dir, "cost-ledger.json");
  const verifierReceiptPath = join(dir, "verifier-receipt.json");
  const scorecardPath = join(dir, "scorecard.md");

  writeJson(liveUserContractPath, {
    schema: "proofloop-proximitty-live-user-contract-v1",
    suite: SUITE,
    contract: [
      "fresh production browser room",
      "normal user runtime: memory mode off and no benchmark_completion when PROOFLOOP_REAL_USER_MODE=1",
      "synthetic underwriting source files uploaded through the UI",
      "public @nodeagent selected model route",
      "visible agent stream, job detail, and room trace",
      "deterministic output-pattern verifier; no official or real underwriting score claimed",
    ],
  });
  writeJson(nodeTracePath, {
    schema: "node-trace-v2",
    source: "browser-visible-public-nodeagent-stream",
    suite: SUITE,
    runId: RUN_ID,
    roomUrl,
    taskProofs: taskProofs.map((task) => ({
      taskId: task.taskId,
      gatesProven: task.agent.gatesProven,
      finalTextSample: task.agent.finalTextSample,
      durationMs: task.agent.durationMs,
    })),
  });
  writeJson(nodeEvalPath, { schema: "proofloop-proximitty-node-eval-v1", status, failedGates, taskProofs, problemCounts: counts });
  writeJson(costLedgerPath, { schema: "proofloop-cost-ledger-v1", suite: SUITE, model });
  writeJson(verifierReceiptPath, {
    schema: "proofloop-proximitty-prod-browser-verifier-v1",
    suite: SUITE,
    status,
    deterministicChecks: {
      browserProblemFree: Object.values(counts).every((count) => count === 0),
      allUploadedFilesVisible: uploadedFiles.length === INPUT_REFS.length,
      allTasksPassed: taskProofs.every((task) => task.passed),
      allTaskTracesVisible: taskProofs.every((task) => task.agent.roomTraceVisible),
      memoryModeDisabled: OPTIONS.runtimeProfile === "",
    },
    failedGates,
  });
  writeText(scorecardPath, renderInternalScorecard({
    title: "Proximitty Prod Browser Adapter",
    status,
    roomUrl,
    taskRows: taskProofs.map((task) => ({ taskId: task.taskId, title: task.title, passed: task.passed, failedGates: task.failedGates })),
    problemCounts: counts,
  }));
  writeJson(browserProofPath, {
    ...common,
    status,
    evidence: { browserProofPath, liveUserContractPath, nodeTracePath, nodeEvalPath, costLedgerPath, verifierReceiptPath, scorecardPath },
  });

  expect(status, failedGates.join("\n")).toBe("passed");
});

function selectedTasks(): ProximittyTask[] {
  if (!TASK_ID_FILTER.length) return TASKS;
  const selected = TASKS.filter((task) => TASK_ID_FILTER.includes(task.id));
  expect(selected.map((task) => task.id).sort(), `Unknown Proximitty task id(s): ${TASK_ID_FILTER.join(", ")}`).toEqual([...TASK_ID_FILTER].sort());
  return selected;
}

function parseTaskIds(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
