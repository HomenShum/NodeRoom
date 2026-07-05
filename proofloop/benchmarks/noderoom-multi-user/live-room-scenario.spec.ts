import { expect, test, type Browser, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  writeJson,
  writeText,
  type InternalLiveRoomOptions,
  type InternalNodeAgentProof,
} from "../internal/liveRoomUtils";

type MultiUserTask = {
  id: string;
  scenarioId: string;
  title: string;
  prompt: string;
  userMessageNeedle: string;
  passPatterns: RegExp[];
};

type DeterministicConflictProof = {
  generatedAt: string;
  target: string;
  summary: {
    passed: boolean;
    scenarios: number;
    passedScenarios: number;
    failedScenarios: string[];
  };
  invariants: string[];
  scenarios: Array<{
    id: string;
    passed: boolean;
    checks: Record<string, boolean>;
    evidence: Record<string, unknown>;
  }>;
};

const SUITE = "noderoom-multi-user-conflict";
const BASE = process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `multi-user-live-${Date.now()}`;
const TASK_ID_FILTER = parseTaskIds(process.env.PROOFLOOP_TASK_IDS ?? process.env.PROOFLOOP_MULTI_USER_TASK_ID);
const LIVE_BROWSER_ENABLED = process.env.PROOFLOOP_LIVE_BROWSER === "1";
const OPTIONS: InternalLiveRoomOptions = {
  baseUrl: BASE,
  agentModelMode: process.env.BENCH_AGENT_MODEL_MODE ?? process.env.PROOFLOOP_AGENT_MODEL_MODE ?? "specific",
  agentModelPolicy: process.env.BENCH_AGENT_MODEL_POLICY ?? process.env.PROOFLOOP_AGENT_MODEL_POLICY ?? "openrouter/free-auto",
  runtimeProfile: process.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE ?? (process.env.PROOFLOOP_REAL_USER_MODE === "1" ? "" : "benchmark_completion"),
  agentTimeoutMs: Number(process.env.PROOFLOOP_MULTI_USER_AGENT_TIMEOUT_MS ?? process.env.PROOFLOOP_AGENT_TIMEOUT_MS ?? 10 * 60_000),
  streamTimeoutMs: Number(process.env.PROOFLOOP_STREAM_WAIT_MS ?? 120_000),
  requireCompletionPhrase: false,
};

const TASKS: MultiUserTask[] = [
  {
    id: "multi-user-conflict-1",
    scenarioId: "managed_batch_blocks_target_not_room",
    title: "Managed range lock blocks target cells only",
    userMessageNeedle: "managed range lock",
    prompt: [
      "In this shared Q3 variance room, explain how a managed range lock should block target cells while allowing non-target user edits.",
      "Ground the answer in the visible room and say what evidence would prove no lock leak.",
    ].join(" "),
    passPatterns: [/managed/i, /lock/i, /target/i, /non[- ]target|outside/i, /no lock leak|lock leak/i],
  },
  {
    id: "multi-user-conflict-2",
    scenarioId: "stale_base_returns_conflict_data",
    title: "Stale base returns conflict data",
    userMessageNeedle: "stale base",
    prompt: [
      "In this shared Q3 variance room, describe the expected no-clobber behavior when a user writes with a stale base version.",
      "The answer must say conflict data is returned and the canonical value is preserved.",
    ].join(" "),
    passPatterns: [/stale/i, /base|version/i, /conflict/i, /canonical|preserved/i],
  },
  {
    id: "multi-user-conflict-3",
    scenarioId: "human_vs_human_same_cell_no_clobber",
    title: "Human versus human same-cell convergence",
    userMessageNeedle: "same cell",
    prompt: [
      "In this shared Q3 variance room, explain the same-cell human versus human no-clobber rule.",
      "Name the one-winner behavior, loser conflict data, and convergence across users.",
    ].join(" "),
    passPatterns: [/same[- ]cell|same cell/i, /one winner|winner/i, /conflict/i, /converge|convergence/i],
  },
  {
    id: "multi-user-conflict-4",
    scenarioId: "blocked_agent_drafts_and_smart_merges",
    title: "Blocked second agent drafts then merges",
    userMessageNeedle: "blocked agent",
    prompt: [
      "In this shared Q3 variance room, explain what a second agent should do when another agent holds a lock.",
      "The answer must mention drafting, blocking lock evidence, release, and clean merge.",
    ].join(" "),
    passPatterns: [/blocked|blocking/i, /draft/i, /release/i, /merge/i],
  },
  {
    id: "multi-user-conflict-5",
    scenarioId: "managed_write_releases_after_conflict",
    title: "Managed write releases after conflict",
    userMessageNeedle: "release after conflict",
    prompt: [
      "In this shared Q3 variance room, explain why a managed write must release its lock even when the CAS write conflicts.",
      "Name the final evidence that proves the canonical value is preserved and no lock leaks.",
    ].join(" "),
    passPatterns: [/managed/i, /release/i, /conflict/i, /canonical|preserved/i, /no lock leak|lock leak/i],
  },
  {
    id: "multi-user-conflict-6",
    scenarioId: "human_c2_vs_agent_a1_c5_stale_range_no_clobber",
    title: "Human C2 beats stale agent A1:C5 range",
    userMessageNeedle: "A1:C5",
    prompt: [
      "In this shared Q3 variance room, explain the no-clobber contract where a human C2 edit beats a stale agent A1:C5 range write.",
      "Name the overlap cell, rejected range, preserved human value, and release receipt.",
    ].join(" "),
    passPatterns: [/C2/i, /A1:C5/i, /stale/i, /rejected|conflict/i, /preserved/i],
  },
];

test.skip(!LIVE_BROWSER_ENABLED, "Set PROOFLOOP_LIVE_BROWSER=1 to run multi-user prod browser adapter.");

test("NodeRoom multi-user conflict adapter: two browser users -> public NodeAgent -> deterministic verifier receipt", async ({ browser }, testInfo) => {
  const tasks = selectedTasks();
  test.setTimeout(Math.max(15 * 60_000, tasks.length * OPTIONS.agentTimeoutMs + 3 * 60_000));
  const host = await newUserPage(browser, "Host");
  const peer = await newUserPage(browser, "Peer");
  const hostRecorder = recordBrowserProblems(host);
  const peerRecorder = recordBrowserProblems(peer);

  const roomCode = `PLMU${Date.now().toString(36).toUpperCase()}`;
  const roomStartedAt = new Date().toISOString();
  await createFreshLiveRoom(host, { baseUrl: BASE, displayName: "Host", roomCode, demoSeed: true });
  await openBlankSheet(host);
  await createFreshLiveRoom(peer, { baseUrl: BASE, displayName: "Peer", roomCode });
  await openBlankSheet(peer);
  await expect(host.getByTestId("left-rail").getByText(/Peer/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(peer.getByTestId("left-rail").getByText(/Host/i).first()).toBeVisible({ timeout: 30_000 });
  await say(peer, `Peer joined multi-user conflict proof ${roomCode}`);
  await expect(host.getByTestId("public-chat-panel").getByText(`Peer joined multi-user conflict proof ${roomCode}`, { exact: false }))
    .toBeVisible({ timeout: 30_000 });
  await selectAgentRoute(host, OPTIONS);

  const dir = outputDir("noderoom-multi-user-prod-browser", RUN_ID);
  const deterministicReceiptPath = join(dir, "deterministic-conflict-proof.json");
  const deterministicProof = runDeterministicConflictProof(deterministicReceiptPath);
  const taskProofs: Array<{
    taskId: string;
    scenarioId: string;
    title: string;
    prompt: string;
    passed: boolean;
    matchedPatterns: string[];
    unmatchedPatterns: string[];
    failedGates: string[];
    deterministicScenarioPassed: boolean;
    agent: InternalNodeAgentProof;
  }> = [];

  for (const task of tasks) {
    const agent = await invokePublicNodeAgent(host, task.prompt, { userMessageNeedle: task.userMessageNeedle }, OPTIONS);
    const matchedPatterns = task.passPatterns.filter((pattern) => pattern.test(agent.finalTextSample)).map((pattern) => pattern.source);
    const unmatchedPatterns = task.passPatterns.filter((pattern) => !pattern.test(agent.finalTextSample)).map((pattern) => pattern.source);
    const deterministicScenario = deterministicProof.scenarios.find((scenario) => scenario.id === task.scenarioId);
    const failedGates = [
      ...Object.entries(agent.gatesNotProven).map(([gate, reason]) => `${gate}: ${reason}`),
      ...unmatchedPatterns.map((pattern) => `pass_pattern_missing: ${pattern}`),
      ...(deterministicScenario?.passed === true ? [] : [`deterministic_scenario_failed: ${task.scenarioId}`]),
    ];
    taskProofs.push({
      taskId: task.id,
      scenarioId: task.scenarioId,
      title: task.title,
      prompt: task.prompt,
      passed: failedGates.length === 0,
      matchedPatterns,
      unmatchedPatterns,
      failedGates,
      deterministicScenarioPassed: deterministicScenario?.passed === true,
      agent,
    });
  }

  const hostScreenshotPath = join(dir, "host-visual-proof.png");
  const peerScreenshotPath = join(dir, "peer-visual-proof.png");
  await host.screenshot({ path: hostScreenshotPath, fullPage: false });
  await peer.screenshot({ path: peerScreenshotPath, fullPage: false });
  await testInfo.attach("multi-user-host-visual-proof", { path: hostScreenshotPath, contentType: "image/png" });
  await testInfo.attach("multi-user-peer-visual-proof", { path: peerScreenshotPath, contentType: "image/png" });

  const counts = mergeProblemCounts(problemCounts(hostRecorder), problemCounts(peerRecorder));
  const model = modelReceipt(OPTIONS, taskProofs.map((task) => task.agent));
  const failedGates = [
    ...taskProofs.flatMap((task) => task.failedGates.map((gate) => `${task.taskId}: ${gate}`)),
    ...Object.entries(counts).filter(([, count]) => count > 0).map(([gate, count]) => `${gate}: ${count}`),
    ...routeIntegrityFailedGates(model),
  ];
  const status = failedGates.length === 0 ? "passed" : "failed";
  const roomUrl = host.url();
  const browserProofPath = process.env.PROOFLOOP_SUITE_PROOF_PATH ?? join(dir, "browser-proof.json");
  const nodeEvalPath = join(dir, "node-eval.json");
  const liveUserContractPath = join(dir, "live-user-contract.json");
  const nodeTracePath = join(dir, "node-trace-v2.json");
  const costLedgerPath = join(dir, "cost-ledger.json");
  const verifierReceiptPath = join(dir, "verifier-receipt.json");
  const scorecardPath = join(dir, "scorecard.md");

  writeJson(liveUserContractPath, {
    schema: "proofloop-multi-user-live-user-contract-v1",
    suite: SUITE,
    contract: [
      "two browser users join one live production room",
      "shared chat fanout is visible across users",
      "selected public @nodeagent route runs with memory mode disabled in real-user mode",
      "visible stream, job detail, and room trace are required",
      "deterministic conflict scorer receipt is attached for the matching scenario",
    ],
  });
  writeJson(nodeTracePath, {
    schema: "node-trace-v2",
    source: "browser-visible-public-nodeagent-stream-plus-deterministic-conflict-receipt",
    suite: SUITE,
    runId: RUN_ID,
    roomUrl,
    peerUrl: peer.url(),
    taskProofs: taskProofs.map((task) => ({
      taskId: task.taskId,
      scenarioId: task.scenarioId,
      gatesProven: task.agent.gatesProven,
      finalTextSample: task.agent.finalTextSample,
      durationMs: task.agent.durationMs,
    })),
  });
  writeJson(nodeEvalPath, { schema: "proofloop-multi-user-node-eval-v1", status, failedGates, taskProofs, problemCounts: counts });
  writeJson(costLedgerPath, { schema: "proofloop-cost-ledger-v1", suite: SUITE, model });
  writeJson(verifierReceiptPath, {
    schema: "proofloop-multi-user-prod-browser-verifier-v1",
    suite: SUITE,
    status,
    deterministicChecks: {
      twoBrowserUsersJoined: true,
      sharedChatFanoutVisible: true,
      deterministicConflictProofPassed: deterministicProof.summary.passed,
      allRequestedScenariosPassed: taskProofs.every((task) => task.deterministicScenarioPassed),
      allTaskTracesVisible: taskProofs.every((task) => task.agent.roomTraceVisible),
      browserProblemFree: Object.values(counts).every((count) => count === 0),
      memoryModeDisabled: OPTIONS.runtimeProfile === "",
    },
    failedGates,
    deterministicReceiptPath,
  });
  writeText(scorecardPath, renderInternalScorecard({
    title: "NodeRoom Multi-User Conflict Prod Browser Adapter",
    status,
    roomUrl,
    taskRows: taskProofs.map((task) => ({ taskId: task.taskId, title: task.title, passed: task.passed, failedGates: task.failedGates })),
    problemCounts: counts,
  }));
  writeJson(browserProofPath, {
    schema: "proofloop-multi-user-prod-browser-v1",
    suite: SUITE,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    roomStartedAt,
    roomUrl,
    peerUrl: peer.url(),
    roomCode,
    model,
    tasks,
    taskProofs,
    deterministicProof,
    problemCounts: counts,
    pageErrors: [...hostRecorder.pageErrors, ...peerRecorder.pageErrors],
    consoleProblems: [...hostRecorder.consoleProblems, ...peerRecorder.consoleProblems],
    requestFailures: [...hostRecorder.requestFailures, ...peerRecorder.requestFailures],
    badResponses: [...hostRecorder.badResponses, ...peerRecorder.badResponses],
    screenshotPaths: [hostScreenshotPath, peerScreenshotPath],
    officialScoreClaim: false,
    status,
    evidence: { browserProofPath, liveUserContractPath, nodeTracePath, nodeEvalPath, costLedgerPath, verifierReceiptPath, deterministicReceiptPath, scorecardPath },
  });

  expect(status, failedGates.join("\n")).toBe("passed");
});

async function newUserPage(browser: Browser, displayName: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await installRuntimeProfile(page, OPTIONS.runtimeProfile);
  await page.addInitScript((name) => {
    try { window.localStorage?.setItem("noderoom:displayName", name); } catch { /* ignore */ }
  }, displayName);
  return page;
}

async function say(page: Page, message: string): Promise<void> {
  const panel = page.getByTestId("public-chat-panel");
  await expect(panel.getByTestId("chat-composer")).toBeVisible({ timeout: 30_000 });
  await panel.getByTestId("chat-composer").fill(message);
  await panel.getByTestId("chat-send").click();
}

function selectedTasks(): MultiUserTask[] {
  if (!TASK_ID_FILTER.length) return TASKS;
  const selected = TASKS.filter((task) => TASK_ID_FILTER.includes(task.id));
  expect(selected.map((task) => task.id).sort(), `Unknown multi-user task id(s): ${TASK_ID_FILTER.join(", ")}`).toEqual([...TASK_ID_FILTER].sort());
  return selected;
}

function parseTaskIds(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function mergeProblemCounts(...counts: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const count of counts) {
    for (const [key, value] of Object.entries(count)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function runDeterministicConflictProof(outPath: string): DeterministicConflictProof {
  const tsxCli = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(
    process.execPath,
    [tsxCli, "evals/multiUserCoordinationProof.ts", "--strict", "--json-out", outPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error([
      `deterministic multi-user verifier failed with exit ${result.status}`,
      result.error ? String(result.error.stack ?? result.error.message ?? result.error) : "",
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return JSON.parse(readFileSync(outPath, "utf8")) as DeterministicConflictProof;
}
