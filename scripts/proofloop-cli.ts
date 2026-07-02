/**
 * Proofloop CLI -- Git-like interface for proving agent work actually completed.
 *
 * Git traces code changes:      what changed, who, when.
 * Proofloop traces task work:   goal, agent actions, evidence, judge verdict, next state.
 *
 * Mental model:
 *   .git/         history of code changes
 *   .proofloop/   history of proof runs
 *
 * Commands (mirrors git on purpose -- an agent should only need these five):
 *   proofloop init                 install .proofloop/ scaffold + config
 *   proofloop status                is the repo currently proven or broken?
 *   proofloop run [suite]           run a suite, record a proof run
 *   proofloop show [runId|latest]   print a proof run's scorecard/receipt
 *   proofloop log                   list past proof runs
 *   proofloop diff <a> <b>          compare two proof runs
 *   proofloop replay <runId>        re-run a past run's exact command
 *   proofloop eval [runId|latest]   write NodeTrace v2 + NodeEval for a run
 *   proofloop mem write [runId]     write run reward/failure to Proofloop memory
 *   proofloop storybook [runId]     write trace-storybook.html for a run
 *   proofloop repair [runId]        write/print the smallest repair prompt
 *   proofloop rerun [runId]         alias for replay
 *   proofloop storyboard [runId]    write storyboard.json/md
 *   proofloop clips [runId]         write clip manifest and social assets
 *   proofloop release-video [runId] render final-release-video.mp4 from trace cards
 *   proofloop lagging [runId]       classify lagging layers from NodeEval
 *   proofloop router suggest [runId] write a route-plan suggestion
 *   proofloop promote <runId>       turn a failure into a tracked regression
 *   proofloop export rl [runId]     export a run as agentic-RL trace data
 *
 * Usage: npx tsx scripts/proofloop-cli.ts <command> [args]
 *        npm run proofloop -- <command> [args]
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { scanBankerToolBenchBundle } from "../src/eval/bankerToolBenchAdapter";
import { buildBankerToolBenchManifestLock } from "../src/eval/bankerToolBenchManifestLock";
import { writeLoopArtifactsForMeta } from "../src/eval/proofloopLoopArtifacts";

const ROOT = process.cwd();
const PROOFLOOP_DIR = join(ROOT, ".proofloop");
const CONFIG_PATH = join(PROOFLOOP_DIR, "config.json");
const RUNS_DIR = join(PROOFLOOP_DIR, "runs");
const LEGACY_MEMORY_PATH = join(PROOFLOOP_DIR, "memory.jsonl");
const MEMORY_DIR = join(PROOFLOOP_DIR, "memory");
const MEMORY_PATH = join(MEMORY_DIR, "memory.jsonl");
const MEMORY_INDEX_PATH = join(MEMORY_DIR, "index.db");
const MEMORY_POLICY_PATH = join(MEMORY_DIR, "policies.json");
const MEMORY_COMPACTED_DIR = join(MEMORY_DIR, "compacted");
const GOALS_DIR = join(PROOFLOOP_DIR, "goals");
const SETUP_DIR = join(PROOFLOOP_DIR, "setup");
const REGRESSIONS_PATH = join(PROOFLOOP_DIR, "regressions.json");
const requireFromCli = createRequire(import.meta.url);

type SuiteConfig = {
  cmd: string;
  minScore?: number;
  kind?: "cli" | "browser";
  receiptGlob?: "live-cli" | "live-browser" | "none";
};

type BenchmarkAdapter = {
  schema: 1;
  id: string;
  browserScenario?: string;
  verifierCommand: string;
  officialScorer?: {
    name: string;
    required: true;
    command?: string;
    receiptPath?: string;
    unavailableReason?: string;
  };
  expectedArtifacts?: string[];
};

type ProofloopConfig = {
  defaultSuite: string;
  suites: Record<string, SuiteConfig>;
};

type RunMeta = {
  runId: string;
  suite: string;
  cmd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  passed: boolean;
  score?: number;
  minScore?: number;
  failedGates?: string[];
  receiptPaths: string[];
};

type GoalState =
  | "queued"
  | "running"
  | "verifying"
  | "repairing"
  | "rerunning"
  | "blocked_external"
  | "needs_human_approval"
  | "budget_exhausted"
  | "passed"
  | "failed";

type GoalTaskBucket = "must_do_now" | "blocked" | "unblocked_next" | "nice_to_have" | "done";

type GoalTask = {
  id: string;
  title: string;
  command?: string;
  bucket: GoalTaskBucket;
  required: boolean;
  retries: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  evidence?: string;
  resumeCommand?: string;
  blockerType?: GoalBlocker["type"];
  blockerName?: string;
};

type GoalQueue = {
  schema: 1;
  goalId: string;
  must_do_now: GoalTask[];
  blocked: GoalTask[];
  unblocked_next: GoalTask[];
  nice_to_have: GoalTask[];
  done: GoalTask[];
};

type GoalBlocker = {
  type:
    | "missing_credential"
    | "missing_dataset"
    | "missing_official_scorer"
    | "paid_service_required"
    | "destructive_approval_required"
    | "external_service_down";
  name?: string;
  evidence: string;
  resumeCommand: string;
  unblockedTasksRemaining: boolean;
  taskId?: string;
  recordedAt: string;
  requirements?: string[];
};

type GoalBlockers = {
  schema: 1;
  goalId: string;
  blockers: GoalBlocker[];
};

type GoalStateFile = {
  schema: 1;
  goalId: string;
  state: GoalState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  maxHours: number;
  budgetUsd?: number;
  heartbeatTimeoutMinutes: number;
  maxStalls: number;
  maxRetriesPerTask: number;
  stallCount: number;
  latestRunId?: string;
  latestGate?: {
    passed: boolean;
    checkedAt: string;
    missing: string[];
  };
  requiresShippingProof: boolean;
  spentUsd: number;
};

type GoalPaths = {
  root: string;
  state: string;
  ledger: string;
  queue: string;
  blockers: string;
  heartbeats: string;
};

const DEFAULT_CONFIG: ProofloopConfig = {
  defaultSuite: "accounting-live",
  suites: {
    "accounting-live": {
      cmd: "npm run proofloop:live:accounting",
      minScore: 75,
      kind: "cli",
      receiptGlob: "live-cli",
    },
    "notion-live": {
      cmd: "npm run proofloop:live:notion",
      minScore: 75,
      kind: "cli",
      receiptGlob: "live-cli",
    },
    "browser-live": {
      cmd: "npm run proofloop:live:browser",
      minScore: 100,
      kind: "browser",
      receiptGlob: "live-browser",
    },
    "bankertoolbench": {
      cmd: "npm run proofloop:live:btb",
      minScore: 100,
      kind: "browser",
      receiptGlob: "live-browser",
    },
  },
};

const DEFAULT_MEMORY_POLICY = {
  schema: 1,
  rawTraceRetentionDays: 30,
  rawVideoRetentionDays: 7,
  storeRawTranscripts: false,
  screenshots: "path-only",
  videos: "path-only",
  scrubSecrets: true,
  scrubPII: true,
  cloudSync: false,
  customerOwnedStorage: true,
};

const TERMINAL_GOAL_STATES: GoalState[] = ["passed", "blocked_external", "needs_human_approval", "budget_exhausted", "failed"];

const DEFAULT_SUPERVISOR_POLICY = {
  heartbeatTimeoutMinutes: 10,
  maxStalls: 5,
  maxRetriesPerTask: 3,
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init":
      return cmdInit();
    case "status":
      return cmdStatus();
    case "run": {
      const suiteArg = args[0]?.startsWith("--") ? undefined : args[0];
      const flagArgs = suiteArg ? args.slice(1) : args;
      return cmdRun(suiteArg, flagArgs);
    }
    case "show":
      return cmdShow(args[0]);
    case "log":
      return cmdLog();
    case "diff":
      return cmdDiff(args[0], args[1]);
    case "replay":
      return cmdReplay(args[0]);
    case "rerun":
      return cmdReplay(args[0]);
    case "eval":
      return cmdEval(args[0]);
    case "mem":
      if (args[0] === "write") return cmdMemWrite(args[1]);
      return cmdMemory(args);
    case "memory":
      return cmdMemory(args);
    case "goal":
      return cmdGoal(args);
    case "gate":
      return cmdGate(args);
    case "supervise":
      return cmdSupervise(args);
    case "resume":
      return cmdResume(args);
    case "setup":
      return await cmdSetup(args);
    case "storybook":
      return cmdStorybook(args[0]);
    case "repair":
      return cmdRepair(args[0]);
    case "storyboard":
      return cmdStoryboard(args[0]);
    case "clips":
      return cmdClips(args[0]);
    case "release-video":
      return cmdReleaseVideo(args[0]);
    case "lagging":
      return cmdLagging(args[0]);
    case "router":
      if (args[0] === "suggest") return cmdRouterSuggest(args[1]);
      return usage(`unknown router target: ${args[0] ?? ""}`);
    case "promote":
      return cmdPromote(args[0]);
    case "export":
      if (args[0] === "rl") return cmdExportRl(args[1]);
      return usage(`unknown export target: ${args[0] ?? ""}`);
    default:
      return usage(command ? `unknown command: ${command}` : undefined);
  }
}

function usage(error?: string): void {
  if (error) console.error(`proofloop: ${error}\n`);
  console.log(
    [
      "Usage: proofloop <command> [args]",
      "",
      "  init                 install .proofloop/ scaffold + config",
      "  status               is the repo currently proven or broken?",
      "  run [suite]          run a suite, record a proof run",
      "  show [runId|latest]  print a proof run's scorecard/receipt",
      "  log                  list past proof runs",
      "  diff <a> <b>         compare two proof runs",
      "  replay <runId>       re-run a past run's exact command",
      "  rerun <runId>        alias for replay",
      "  eval [runId|latest]  write NodeTrace v2 and NodeEval",
      "  mem write [runId]    write run reward/failure to Proofloop memory",
      "  memory init          create local memory store, retention policy, and compacted logs",
      "  memory compact [runId|latest] compact a proof run into recall memory",
      "  memory index         build local searchable memory index",
      "  memory search <q>    search compacted local memory",
      "  memory show <id>     show a memory entry by id or runId",
      "  memory doctor        verify local memory policy and files",
      "  memory export --redacted write a redacted memory export",
      "  goal init <goal-id>  create supervisor state, ledger, queue, blockers, heartbeats",
      "  goal status <goal-id> print supervisor state and queue counts",
      "  goal next <goal-id>  print the next unblocked task",
      "  goal block <goal-id> record an external blocker",
      "  gate --goal <id>     fail unless the proof ledger can close the goal",
      "  supervise --goal <id> run queued work until a terminal ledger state",
      "  resume --goal <id>   print the worker resume prompt and next task",
      "  setup <adapter>      prepare local fixtures/adapters before proof runs",
      "  storybook [runId]    write trace-storybook.html",
      "  repair [runId]       write/print repair-prompt.md",
      "  storyboard [runId]   write storyboard.json/md",
      "  clips [runId]        write clip manifest and social assets",
      "  release-video [runId] render final-release-video.mp4 from trace cards",
      "  lagging [runId]      classify lagging layers",
      "  router suggest [runId] write route-plan suggestion",
      "  promote <runId>      turn a failure into a tracked regression",
      "  export rl [runId]    export a run as agentic-RL trace data",
    ].join("\n"),
  );
  process.exitCode = error ? 1 : 0;
}

function cmdInit(): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    writeJson(CONFIG_PATH, DEFAULT_CONFIG);
    console.log(`proofloop: wrote ${rel(CONFIG_PATH)}`);
  } else {
    const existing = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ProofloopConfig;
    const knownSuites = new Set(Object.keys(existing.suites));
    let added = 0;
    for (const [name, cfg] of Object.entries(DEFAULT_CONFIG.suites)) {
      if (!knownSuites.has(name)) {
        existing.suites[name] = cfg;
        added++;
      }
    }
    if (added > 0) {
      writeJson(CONFIG_PATH, existing);
      console.log(`proofloop: merged ${added} new suite(s) into ${rel(CONFIG_PATH)}`);
    } else {
      console.log(`proofloop: ${rel(CONFIG_PATH)} already up to date`);
    }
  }
  initMemoryStore();
  console.log("proofloop: initialized. Run `proofloop status` next.");
}

function cmdStatus(): void {
  const config = loadConfig();
  const runs = listRuns();
  console.log("Proofloop status");
  console.log("");
  for (const suite of Object.keys(config.suites)) {
    const latest = runs.filter((r) => r.suite === suite).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!latest) {
      console.log(`  ${suite.padEnd(16)} never run`);
      continue;
    }
    const verdict = latest.passed ? "passing" : "FAILING";
    const scoreText = latest.score !== undefined ? ` score=${latest.score}${latest.minScore !== undefined ? `/${latest.minScore}` : ""}` : "";
    console.log(`  ${suite.padEnd(16)} ${verdict}${scoreText}  (${latest.runId})`);
    if (!latest.passed && latest.failedGates?.length) {
      console.log(`    failed gates: ${latest.failedGates.join(", ")}`);
    }
  }
  const latestBySuite = Object.keys(config.suites).map(
    (suite) => runs.filter((r) => r.suite === suite).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0],
  );
  const everRun = latestBySuite.filter((r): r is RunMeta => Boolean(r));
  const anyFailing = everRun.some((r) => !r.passed);
  console.log("");
  if (!everRun.length) {
    console.log("No runs recorded yet. Run `proofloop run` to prove a suite.");
  } else if (anyFailing) {
    console.log("Next action: proofloop show latest");
  } else if (everRun.length < latestBySuite.length) {
    console.log(`${everRun.length}/${latestBySuite.length} suites have run at least once and last passed.`);
  } else {
    console.log("All known suites last passed.");
  }
}

function cmdRun(suiteArg: string | undefined, extraArgs: string[] = []): void {
  const config = loadConfig();
  const suite = suiteArg ?? config.defaultSuite;
  const adapter = readBenchmarkAdapterIfExists(suite);
  const suiteConfig = config.suites[suite] ?? suiteConfigForAdapter(adapter);
  if (!suiteConfig) {
    console.error(`proofloop: unknown suite "${suite}". Known: ${knownSuites(config).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const flags = forceOfficialAdapterFlags(parseRunFlags(extraArgs), adapter);
  const runId = `${suite}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const cmd = suiteConfig.cmd;
  const recordedCmd = [cmd, flags.prod ? "--prod" : "", flags.headed ? "--headed" : "", flags.userEmulationStrict ? "--user-emulation strict" : ""]
    .filter(Boolean)
    .join(" ");
  const env: Record<string, string> = { ...process.env, PROOFLOOP_RUN_ID: runId, PROOFLOOP_RUN_DIR: runDir };
  if (flags.prod) env.VITE_CONVEX_URL = process.env.CONVEX_PROD_URL ?? "";
  if (flags.cockpit) env.PROOFLOOP_COCKPIT = "1";
  if (flags.userEmulationStrict) env.PROOFLOOP_USER_EMULATION = "strict";
  if (suiteConfig.receiptGlob === "live-browser") env.PROOFLOOP_SUITE_PROOF_PATH = join(runDir, "verifier-receipt.json");
  applyBenchmarkAdapterEnv(env, adapter, runDir, flags, recordedCmd);

  console.log(`proofloop: running suite "${suite}"${adapter ? " [official adapter]" : ""}${flags.prod ? " --prod" : ""}${flags.headed ? " --headed" : ""}${flags.cockpit ? " --cockpit" : ""}${flags.userEmulationStrict ? " --user-emulation strict" : ""}`);
  console.log(`proofloop: ${cmd}`);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(cmd, {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env,
  });
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const exitCode = result.status ?? 1;

  const receipt = locateReceipt(suite, suiteConfig, runId, runDir);
  hydrateRunArtifactsFromReceipts(runDir, receipt.receiptPaths);
  const officialScorer = writeOfficialScorerReceipt({ adapter, suite, runDir });
  const preContractPassed = exitCode === 0 && (receipt.passed ?? true) && officialScorer.passed;

  writeCostLedger(runDir, { suite, runId, durationMs, exitCode, passed: preContractPassed });
  writeCockpitSnapshot(runDir, runId);

  const meta: RunMeta = {
    runId,
    suite,
    cmd: recordedCmd,
    startedAt,
    finishedAt,
    durationMs,
    exitCode,
    passed: preContractPassed,
    score: receipt.score,
    minScore: suiteConfig.minScore,
    failedGates: [
      ...(receipt.failedGates ?? []),
      ...officialScorer.failedGates,
    ],
    receiptPaths: receipt.receiptPaths,
  };
  writeJson(join(runDir, "meta.json"), meta);
  const paths = writeLoopArtifactsForMeta({
    meta,
    runDir,
    baseUrl: baseUrlForRun(flags, recordedCmd),
    strictLiveUser: flags.userEmulationStrict,
  });
  const contract = readJsonIfExists<{ valid?: boolean; gates?: Array<{ gate: string; passed: boolean }> }>(paths.liveUserContractPath);
  const finalPassed = preContractPassed && contract?.valid === true;
  if (finalPassed !== meta.passed) {
    meta.passed = finalPassed;
    meta.failedGates = [
      ...(meta.failedGates ?? []),
      ...((contract?.gates ?? []).filter((gate) => !gate.passed).map((gate) => gate.gate)),
    ];
    writeJson(join(runDir, "meta.json"), meta);
    writeLoopArtifactsForMeta({
      meta,
      runDir,
      baseUrl: baseUrlForRun(flags, recordedCmd),
      strictLiveUser: flags.userEmulationStrict,
    });
  }
  writeCostLedger(runDir, { suite, runId, durationMs, exitCode, passed: finalPassed });
  console.log("");
  console.log(`proofloop: run recorded -- ${runId} (${finalPassed ? "PASS" : "FAIL"})`);
  console.log(`proofloop: node trace -- ${rel(paths.nodeTracePath)}`);
  console.log(`proofloop: node eval  -- ${rel(paths.nodeEvalPath)}`);
  console.log(`proofloop: contract   -- ${rel(paths.liveUserContractPath)}`);
  console.log(`proofloop: official scorer -- ${rel(join(runDir, "official-scorer-receipt.json"))}`);
  if (!finalPassed) process.exitCode = 1;
}

function cmdShow(runIdArg: string | undefined): void {
  const meta = resolveRun(runIdArg);
  if (!meta) {
    console.error(`proofloop: no run found for "${runIdArg ?? "latest"}"`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(meta, null, 2));
  for (const receiptPath of meta.receiptPaths) {
    if (receiptPath.endsWith(".md") && existsSync(resolve(ROOT, receiptPath))) {
      console.log("");
      console.log(`--- ${receiptPath} ---`);
      console.log(readFileSync(resolve(ROOT, receiptPath), "utf8"));
    }
  }
}

function cmdLog(): void {
  const runs = listRuns().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!runs.length) {
    console.log("proofloop: no runs recorded yet. Run `proofloop run` first.");
    return;
  }
  for (const run of runs) {
    const verdict = run.passed ? "pass" : "fail";
    const scoreText = run.score !== undefined ? ` score=${run.score}${run.minScore !== undefined ? `/${run.minScore}` : ""}` : "";
    console.log(`${run.startedAt}  ${verdict}${scoreText}  ${run.suite}  (${run.runId})`);
  }
}

function cmdDiff(runA: string | undefined, runB: string | undefined): void {
  const a = resolveRun(runA);
  const b = resolveRun(runB);
  if (!a || !b) {
    console.error("proofloop: usage: proofloop diff <runA> <runB>");
    process.exitCode = 1;
    return;
  }
  console.log(`Suite:   ${a.suite} -> ${b.suite}`);
  console.log(`Score:   ${a.score ?? "n/a"} -> ${b.score ?? "n/a"}`);
  console.log(`Passed:  ${a.passed} -> ${b.passed}`);
  console.log(`Duration: ${formatMs(a.durationMs)} -> ${formatMs(b.durationMs)}`);
  console.log(`Exit:    ${a.exitCode} -> ${b.exitCode}`);
  const gatesA = new Set(a.failedGates ?? []);
  const gatesB = new Set(b.failedGates ?? []);
  const fixed = [...gatesA].filter((g) => !gatesB.has(g));
  const regressed = [...gatesB].filter((g) => !gatesA.has(g));
  const persisted = [...gatesA].filter((g) => gatesB.has(g));
  if (fixed.length) {
    console.log("");
    console.log(`Fixed (${fixed.length}):`);
    for (const gate of fixed) console.log(`  + ${gate}`);
  }
  if (regressed.length) {
    console.log("");
    console.log(`Regressed (${regressed.length}):`);
    for (const gate of regressed) console.log(`  - ${gate}`);
  }
  if (persisted.length) {
    console.log("");
    console.log(`Still failing (${persisted.length}):`);
    for (const gate of persisted) console.log(`  ! ${gate}`);
  }
  if (!fixed.length && !regressed.length) console.log("\nNo gate differences.");
}

function cmdReplay(runIdArg: string | undefined): void {
  const meta = resolveRun(runIdArg);
  if (!meta) {
    console.error(`proofloop: no run found for "${runIdArg ?? "latest"}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`proofloop: replaying ${meta.runId}`);
  console.log(`  suite:   ${meta.suite}`);
  console.log(`  cmd:     ${meta.cmd}`);
  console.log(`  origin:  ${meta.startedAt} (${meta.passed ? "PASS" : "FAIL"}, score=${meta.score ?? "n/a"}, ${formatMs(meta.durationMs)})`);
  console.log("");
  cmdRun(meta.suite);
}

function cmdEval(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(`proofloop: wrote ${rel(paths.nodeTracePath)}`);
  console.log(`proofloop: wrote ${rel(paths.nodeEvalPath)}`);
  console.log(readFileSync(paths.nodeEvalPath, "utf8"));
}

function cmdMemWrite(runIdArg: string | undefined): void {
  initMemoryStore();
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta, { memoryPath: MEMORY_PATH });
  console.log(`proofloop: wrote memory entry to ${rel(paths.memoryPath ?? MEMORY_PATH)}`);
}

function cmdMemory(args: string[]): void {
  const [target, ...rest] = args;
  switch (target) {
    case "init":
    case undefined:
      return cmdMemoryInit();
    case "compact":
      return cmdMemoryCompact(rest[0]);
    case "index":
      return cmdMemoryIndex();
    case "search":
      return cmdMemorySearch(rest.join(" "));
    case "show":
      return cmdMemoryShow(rest[0]);
    case "doctor":
      return cmdMemoryDoctor();
    case "export":
      return cmdMemoryExport(rest.includes("--redacted"));
    default:
      return usage(`unknown memory target: ${target}`);
  }
}

function cmdMemoryInit(): void {
  initMemoryStore();
  console.log(`proofloop: memory initialized at ${rel(MEMORY_DIR)}`);
}

function cmdMemoryCompact(runIdArg: string | undefined): void {
  initMemoryStore();
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const runDir = resolveRunDir(meta);
  const paths = ensureLoopArtifacts(meta, { memoryPath: MEMORY_PATH });
  const nodeEval = readJsonIfExists<{ reward?: unknown; verifier?: { failReasons?: string[] } }>(join(runDir, "node-eval.json"));
  const episode = {
    schema: 1,
    id: `episode-${meta.runId}`,
    runId: meta.runId,
    traceId: `traj-${meta.runId}`,
    suite: meta.suite,
    passed: meta.passed,
    reward: nodeEval?.reward ?? null,
    receipts: meta.receiptPaths,
    sourceTracePath: rel(paths.nodeTracePath),
    compactedAt: new Date().toISOString(),
  };
  appendJsonl(join(MEMORY_COMPACTED_DIR, "episodes.jsonl"), episode);
  if (!meta.passed) {
    appendJsonl(join(MEMORY_COMPACTED_DIR, "failures.jsonl"), {
      schema: 1,
      id: `failure-${meta.runId}`,
      runId: meta.runId,
      traceId: `traj-${meta.runId}`,
      suite: meta.suite,
      failReasons: nodeEval?.verifier?.failReasons ?? meta.failedGates ?? [`exit ${meta.exitCode}`],
      repairPromptPath: rel(paths.repairPromptPath),
      writtenAt: new Date().toISOString(),
    });
  }
  cmdMemoryIndex();
  console.log(`proofloop: compacted ${meta.runId} into ${rel(MEMORY_COMPACTED_DIR)}`);
}

function cmdMemoryIndex(): void {
  initMemoryStore();
  const documents = loadMemoryDocuments();
  const engine = writeMemoryIndex(documents);
  console.log(`proofloop: indexed ${documents.length} memory document(s) at ${rel(MEMORY_INDEX_PATH)} (${engine})`);
}

function cmdMemorySearch(query: string): void {
  initMemoryStore();
  if (!query.trim()) {
    console.error("proofloop: usage: proofloop memory search <query>");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(MEMORY_INDEX_PATH)) cmdMemoryIndex();
  const hits = searchMemoryIndex(query);
  for (const hit of hits) {
    console.log(`${hit.id} score=${hit.score} run=${hit.runId ?? "unknown"} source=${hit.source}`);
    console.log(`  ${hit.textPreview.replace(/\s+/g, " ")}`);
  }
  if (!hits.length) console.log("proofloop: no memory hits");
}

function cmdMemoryShow(id: string | undefined): void {
  initMemoryStore();
  if (!id) {
    console.error("proofloop: usage: proofloop memory show <id-or-runId>");
    process.exitCode = 1;
    return;
  }
  const doc = loadMemoryDocuments().find((entry) => entry.id === id || entry.runId === id);
  if (!doc) {
    console.error(`proofloop: memory entry not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(doc.text);
}

function cmdMemoryDoctor(): void {
  initMemoryStore();
  const required = [
    MEMORY_INDEX_PATH,
    MEMORY_PATH,
    join(MEMORY_COMPACTED_DIR, "episodes.jsonl"),
    join(MEMORY_COMPACTED_DIR, "failures.jsonl"),
    join(MEMORY_COMPACTED_DIR, "scaffold-deltas.jsonl"),
    join(MEMORY_COMPACTED_DIR, "model-deltas.jsonl"),
    join(MEMORY_DIR, "redaction.log"),
    MEMORY_POLICY_PATH,
  ];
  const missing = required.filter((path) => !existsSync(path));
  const policy = readJsonIfExists<typeof DEFAULT_MEMORY_POLICY>(MEMORY_POLICY_PATH);
  const policyErrors: string[] = [];
  if (policy?.cloudSync !== false) policyErrors.push("cloudSync must default to false");
  if (policy?.storeRawTranscripts !== false) policyErrors.push("storeRawTranscripts must default to false");
  if (policy?.scrubSecrets !== true) policyErrors.push("scrubSecrets must default to true");
  if (policy?.scrubPII !== true) policyErrors.push("scrubPII must default to true");
  if (missing.length || policyErrors.length) {
    console.error("proofloop: memory doctor FAIL");
    for (const path of missing) console.error(`  missing ${rel(path)}`);
    for (const error of policyErrors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("proofloop: memory doctor PASS");
}

function cmdMemoryExport(redacted: boolean): void {
  initMemoryStore();
  if (!redacted) {
    console.error("proofloop: only redacted memory export is supported; pass --redacted");
    process.exitCode = 1;
    return;
  }
  const output = join(MEMORY_DIR, "export-redacted.jsonl");
  const lines = loadMemoryDocuments().map((doc) => redactText(doc.text));
  writeFileSync(output, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  appendFileSync(join(MEMORY_DIR, "redaction.log"), `${new Date().toISOString()} export-redacted count=${lines.length}\n`, "utf8");
  console.log(`proofloop: wrote ${rel(output)}`);
}

function cmdGoal(args: string[]): void {
  const [target, goalId, ...rest] = args;
  if (!target) return usage("usage: proofloop goal <init|status|next|block> <goal-id>");
  if (!goalId) return usage(`usage: proofloop goal ${target} <goal-id>`);
  switch (target) {
    case "init":
      return cmdGoalInit(goalId, rest);
    case "status":
      return cmdGoalStatus(goalId);
    case "next":
      return cmdGoalNext(goalId);
    case "block":
      return cmdGoalBlock(goalId, rest);
    default:
      return usage(`unknown goal target: ${target}`);
  }
}

function cmdGoalInit(goalIdArg: string, args: string[]): void {
  const goalId = normalizeGoalId(goalIdArg);
  if (!goalId) return;
  const paths = ensureGoal(goalId, {
    maxHours: Number(optionValue(args, "--max-hours") ?? 72),
    budgetUsd: optionNumber(args, "--budget-usd"),
    requiresShippingProof: hasFlag(args, "--shipping"),
  });
  console.log(`proofloop: goal initialized at ${rel(paths.root)}`);
}

function cmdGoalStatus(goalIdArg: string): void {
  const goalId = normalizeGoalId(goalIdArg);
  if (!goalId) return;
  const paths = ensureGoal(goalId);
  const state = readGoalState(paths);
  const queue = readGoalQueue(paths);
  const blockers = readGoalBlockers(paths);
  const next = nextRunnableTask(queue);
  console.log(JSON.stringify({
    goalId,
    state: state.state,
    terminal: isTerminalGoalState(state.state),
    latestRunId: state.latestRunId ?? null,
    latestGate: state.latestGate ?? null,
    queue: queueCounts(queue),
    blockers: blockers.blockers.length,
    next: next ? { id: next.id, bucket: next.bucket, command: next.command ?? null } : null,
  }, null, 2));
}

function cmdGoalNext(goalIdArg: string): void {
  const goalId = normalizeGoalId(goalIdArg);
  if (!goalId) return;
  const paths = ensureGoal(goalId);
  const queue = readGoalQueue(paths);
  const task = nextRunnableTask(queue);
  if (!task) {
    console.log(`proofloop: no unblocked task for goal ${goalId}`);
    return;
  }
  console.log(JSON.stringify(task, null, 2));
}

function cmdGoalBlock(goalIdArg: string, args: string[]): void {
  const goalId = normalizeGoalId(goalIdArg);
  if (!goalId) return;
  const paths = ensureGoal(goalId);
  const queue = readGoalQueue(paths);
  const task = optionValue(args, "--task") ? findTask(queue, optionValue(args, "--task") ?? "")?.task : nextRunnableTask(queue);
  const blocker = blockerFromArgs(args, task) ?? classifyLatestExternalBlocker(paths, task);
  if (!blocker) {
    console.error("proofloop: blocker requires --type, --evidence, and --resume-command, or a latest Proof Loop run with a known external blocker");
    process.exitCode = 1;
    return;
  }
  recordGoalBlocker(paths, blocker, task);
  console.log(`proofloop: recorded blocker ${blocker.type}${blocker.name ? ` (${blocker.name})` : ""}`);
}

function cmdGate(args: string[]): void {
  const goalId = optionValue(args, "--goal") ?? args[0];
  if (!goalId) return usage("usage: proofloop gate --goal <goal-id>");
  const normalized = normalizeGoalId(goalId);
  if (!normalized) return;
  const paths = ensureGoal(normalized);
  const result = evaluateGoalGate(paths, { shipping: hasFlag(args, "--shipping") });
  const state = readGoalState(paths);
  state.latestGate = {
    passed: result.passed,
    checkedAt: new Date().toISOString(),
    missing: result.missing,
  };
  if (result.passed) {
    state.state = "passed";
    state.completedAt = state.completedAt ?? state.latestGate.checkedAt;
  }
  writeGoalState(paths, state);
  appendGoalLedger(paths, "gate_checked", { passed: result.passed, missing: result.missing });
  if (result.passed) {
    console.log(`proofloop gate: PASS goal=${normalized}`);
    return;
  }
  console.error(`proofloop gate: FAIL goal=${normalized}`);
  for (const missing of result.missing) console.error(`  - ${missing}`);
  process.exitCode = 1;
}

function cmdSupervise(args: string[]): void {
  const goalId = optionValue(args, "--goal") ?? args[0];
  if (!goalId) return usage("usage: proofloop supervise --goal <goal-id>");
  const normalized = normalizeGoalId(goalId);
  if (!normalized) return;
  const paths = ensureGoal(normalized, {
    maxHours: Number(optionValue(args, "--max-hours") ?? 72),
    budgetUsd: optionNumber(args, "--budget-usd"),
    requiresShippingProof: hasFlag(args, "--shipping"),
  });
  detectStalledWorker(paths);
  let state = readGoalState(paths);
  if (isTerminalGoalState(state.state)) {
    console.log(`proofloop: goal ${normalized} is already terminal (${state.state})`);
    return;
  }
  state.state = "running";
  state.startedAt = state.startedAt ?? new Date().toISOString();
  writeGoalState(paths, state);

  const maxIterations = Number(optionValue(args, "--max-iterations") ?? 100);
  const once = hasFlag(args, "--once");
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    writeGoalHeartbeat(paths, "supervisor", { iteration });
    state = readGoalState(paths);
    if (isTerminalGoalState(state.state)) break;
    if (budgetExceeded(state)) {
      markGoalState(paths, "budget_exhausted", { spentUsd: state.spentUsd, budgetUsd: state.budgetUsd });
      break;
    }
    if (maxHoursExceeded(state)) {
      markGoalState(paths, "budget_exhausted", { reason: "max-hours exceeded", maxHours: state.maxHours });
      break;
    }

    const gate = evaluateGoalGate(paths);
    if (gate.passed) {
      markGoalState(paths, "passed", { gate });
      break;
    }

    const queue = readGoalQueue(paths);
    const task = nextRunnableTask(queue);
    if (!task) {
      const openRequired = requiredOpenTasks(queue);
      const blockedRequired = queue.blocked.filter((item) => item.required);
      if (blockedRequired.length && openRequired.length === blockedRequired.length) {
        markGoalState(paths, "blocked_external", { blockedRequired: blockedRequired.map((item) => item.id) });
      } else {
        markGoalState(paths, "failed", { reason: "gate failed and no unblocked queue item remains", missing: gate.missing });
      }
      break;
    }

    runGoalTask(paths, task);
    if (once) break;
  }

  const finalState = readGoalState(paths);
  console.log(`proofloop: supervisor goal=${normalized} state=${finalState.state}`);
  if (!isTerminalGoalState(finalState.state)) process.exitCode = 1;
}

function cmdResume(args: string[]): void {
  const goalId = optionValue(args, "--goal") ?? args[0];
  if (!goalId) return usage("usage: proofloop resume --goal <goal-id>");
  const normalized = normalizeGoalId(goalId);
  if (!normalized) return;
  const paths = ensureGoal(normalized);
  detectStalledWorker(paths);
  writeGoalHeartbeat(paths, "resume_prompt", {});
  const queue = readGoalQueue(paths);
  const task = nextRunnableTask(queue);
  const latest = readGoalState(paths).latestRunId ?? resolveRun("latest")?.runId ?? "latest";
  console.log(renderResumePrompt(normalized, task, latest));
}

async function cmdSetup(args: string[]): Promise<void> {
  const [target, ...rest] = args;
  if (!target) return usage("usage: proofloop setup <adapter>");
  if (target === "bankertoolbench") return cmdSetupBankerToolBench(rest);
  return cmdSetupUnsupportedAdapter(target, rest);
}

async function cmdSetupBankerToolBench(args: string[]): Promise<void> {
  const root = resolve(ROOT, optionValue(args, "--root") ?? ".tmp/official-benchmarks/btb-fixture");
  const dataset = optionValue(args, "--dataset") ?? "handshake-ai-research/bankertoolbench";
  const revision = optionValue(args, "--revision") ?? "main";
  const limit = Number(optionValue(args, "--limit") ?? 1);
  const maxBytes = Number(optionValue(args, "--max-bytes") ?? 250_000_000);
  const taskId = optionValue(args, "--task-id");
  const allowDownload = hasFlag(args, "--allow-download");
  const verifyOfficialContract = hasFlag(args, "--verify-official-contract");
  const receiptPath = join(SETUP_DIR, "bankertoolbench-local-setup.json");
  mkdirSync(root, { recursive: true });
  mkdirSync(SETUP_DIR, { recursive: true });

  const existing = tryScanBtb(root);
  if (existing.ok) {
    const manifestLockfile = writeBtbManifestLock(root, revision);
    const fixtureFiles = listBtbFixtureFiles(root, existing.taskIds);
    writeJson(receiptPath, btbSetupReceipt({
      status: "ready",
      root,
      dataset,
      revision,
      taskIds: existing.taskIds,
      downloadedFiles: [],
      fixtureFiles,
      manifestLockfile,
      totalBytes: totalRelativeFileBytes(root, fixtureFiles),
      message: "Existing local BankerToolBench fixture scanned successfully.",
    }));
    console.log(`proofloop setup: BankerToolBench local fixture ready at ${rel(root)}`);
    console.log(`proofloop setup: manifest lock ${rel(manifestLockfile)}`);
    console.log(`proofloop setup: receipt ${rel(receiptPath)}`);
    if (verifyOfficialContract) runBtbOfficialContractPreflight(revision, manifestLockfile);
    return;
  }

  if (!allowDownload) {
    writeJson(receiptPath, btbSetupReceipt({
      status: "needs_download",
      root,
      dataset,
      revision,
      taskIds: [],
      downloadedFiles: [],
      totalBytes: 0,
      message: "Local fixture is missing. Re-run with --allow-download to fetch an official-shaped subset locally.",
    }));
    console.error(`proofloop setup: local BankerToolBench fixture missing at ${rel(root)}`);
    console.error(`proofloop setup: run npm run proofloop -- setup bankertoolbench --allow-download --limit ${limit}`);
    process.exitCode = 1;
    return;
  }

  const tree = await fetchHfDatasetTree(dataset, revision);
  const tasksJsonlPath = "tasks.jsonl";
  const tasksJsonlEntry = tree.find((entry) => entry.type === "file" && entry.path === tasksJsonlPath);
  if (!tasksJsonlEntry) throw new Error(`Hugging Face dataset ${dataset}@${revision} does not expose tasks.jsonl`);
  await downloadHfFile({ dataset, revision, filePath: tasksJsonlPath, root, expectedSize: tasksJsonlEntry.size });
  const rows = readJsonlObjects(join(root, tasksJsonlPath));
  const selectedTaskIds = selectBtbTaskIds(rows, tree, { taskId, limit });
  const files = tree
    .filter((entry) => entry.type === "file")
    .filter((entry) =>
      entry.path === tasksJsonlPath ||
      selectedTaskIds.some((id) => entry.path.startsWith(`task-data/${id}/`) || entry.path.startsWith(`golden-outputs/${id}/`)),
    );
  const totalBytes = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (totalBytes > maxBytes) {
    writeJson(receiptPath, btbSetupReceipt({
      status: "blocked",
      root,
      dataset,
      revision,
      taskIds: selectedTaskIds,
      downloadedFiles: [],
      totalBytes,
      message: `Selected local fixture is ${totalBytes} bytes, above --max-bytes ${maxBytes}.`,
    }));
    console.error(`proofloop setup: selected BTB fixture would download ${totalBytes} bytes, above --max-bytes ${maxBytes}`);
    process.exitCode = 1;
    return;
  }

  const downloadedFiles: string[] = [];
  for (const entry of files) {
    const downloaded = await downloadHfFile({ dataset, revision, filePath: entry.path, root, expectedSize: entry.size });
    if (downloaded) downloadedFiles.push(entry.path);
  }
  writeSelectedBtbTasksJsonl(root, rows, selectedTaskIds);

  const scan = scanBankerToolBenchBundle(root, { includeTasks: false, sampleLimit: 3, generatedAt: new Date().toISOString() });
  const manifestLockfile = writeBtbManifestLock(root, revision);
  writeJson(receiptPath, btbSetupReceipt({
    status: "ready",
    root,
    dataset,
    revision,
    taskIds: selectedTaskIds,
    downloadedFiles,
    fixtureFiles: files.map((entry) => entry.path),
    manifestLockfile,
    totalBytes,
    message: `Downloaded and verified ${selectedTaskIds.length} local BankerToolBench task fixture(s).`,
    scan,
  }));
  console.log(`proofloop setup: BankerToolBench local fixture ready at ${rel(root)}`);
  console.log(`proofloop setup: downloaded ${downloadedFiles.length} file(s), ${totalBytes} bytes`);
  console.log(`proofloop setup: manifest lock ${rel(manifestLockfile)}`);
  console.log(`proofloop setup: next npm run proofloop -- run bankertoolbench`);
  if (verifyOfficialContract) runBtbOfficialContractPreflight(revision, manifestLockfile);
}

function cmdSetupUnsupportedAdapter(adapterId: string, _args: string[]): void {
  const adapter = readBenchmarkAdapterIfExists(adapterId);
  const receiptPath = join(SETUP_DIR, `${adapterId}-local-setup.json`);
  mkdirSync(SETUP_DIR, { recursive: true });
  writeJson(receiptPath, {
    schema: 1,
    adapterId,
    status: "needs_local_adapter_implementation",
    generatedAt: new Date().toISOString(),
    requiredFiles: adapter
      ? [
          adapter.browserScenario,
          adapter.verifierCommand,
          adapter.officialScorer?.command ?? adapter.officialScorer?.unavailableReason,
        ].filter(Boolean)
      : [`proofloop/benchmarks/${adapterId}/adapter.json`],
    nextActions: [
      `Create or complete proofloop/benchmarks/${adapterId}/adapter.json`,
      "Add a Playwright browser scenario that uploads official inputs through the public UI.",
      "Add a verifier/official scorer command that writes official-scorer-receipt.json.",
      `Rerun npm run proofloop -- setup ${adapterId}`,
      `Rerun npm run proofloop -- run ${adapterId}`,
    ],
  });
  console.error(`proofloop setup: ${adapterId} local setup recipe is not implemented yet`);
  console.error(`proofloop setup: wrote ${rel(receiptPath)}`);
  process.exitCode = 1;
}

type HfTreeEntry = {
  type: "file" | "directory";
  path: string;
  size?: number;
};

async function fetchHfDatasetTree(dataset: string, revision: string): Promise<HfTreeEntry[]> {
  const url = `https://huggingface.co/api/datasets/${dataset}/tree/${revision}?recursive=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hugging Face tree fetch failed (${response.status}): ${url}`);
  const parsed = await response.json() as HfTreeEntry[];
  return parsed;
}

async function downloadHfFile(args: {
  dataset: string;
  revision: string;
  filePath: string;
  root: string;
  expectedSize?: number;
}): Promise<boolean> {
  const { dataset, revision, filePath, root, expectedSize } = args;
  const output = join(root, filePath);
  if (existsSync(output) && (expectedSize === undefined || statSync(output).size === expectedSize)) return false;
  const url = `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hugging Face file download failed (${response.status}): ${filePath}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  return true;
}

function readJsonlObjects(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function selectBtbTaskIds(
  rows: Array<Record<string, unknown>>,
  tree: HfTreeEntry[],
  options: { taskId?: string; limit: number },
): string[] {
  const taskIdsWithInputs = new Set(
    tree
      .filter((entry) => entry.type === "file" && /^task-data\/[^/]+\/Inputs?\//i.test(entry.path))
      .map((entry) => entry.path.split("/")[1])
      .filter(Boolean),
  );
  const requested = options.taskId ? [options.taskId] : [];
  const candidates = requested.length
    ? rows.filter((row) => requested.includes(String(row.task_id ?? "")))
    : rows.filter((row) => typeof row.final_prompt === "string" && taskIdsWithInputs.has(String(row.task_id ?? "")));
  const selected = candidates
    .map((row) => String(row.task_id ?? ""))
    .filter(Boolean)
    .slice(0, Math.max(1, options.limit));
  if (!selected.length) throw new Error(options.taskId ? `BTB task not found or has no input files: ${options.taskId}` : "No BTB task with input files found");
  return selected;
}

function writeSelectedBtbTasksJsonl(root: string, rows: Array<Record<string, unknown>>, selectedTaskIds: string[]): void {
  const selected = rows.filter((row) => selectedTaskIds.includes(String(row.task_id ?? "")));
  writeFileSync(join(root, "tasks.jsonl"), `${selected.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function writeBtbManifestLock(root: string, revision: string): string {
  const manifestLockfile = join(SETUP_DIR, "bankertoolbench-manifest-lock.json");
  const manifest = buildBankerToolBenchManifestLock(root, {
    generatedAt: new Date().toISOString(),
    datasetRevision: revision,
  });
  writeJson(manifestLockfile, manifest);
  return manifestLockfile;
}

function listBtbFixtureFiles(root: string, taskIds: string[]): string[] {
  const files = new Set<string>();
  if (existsSync(join(root, "tasks.jsonl"))) files.add("tasks.jsonl");
  for (const taskId of taskIds) {
    collectRelativeFiles(root, `task-data/${taskId}`, files);
    collectRelativeFiles(root, `golden-outputs/${taskId}`, files);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

function collectRelativeFiles(root: string, relativeDir: string, out: Set<string>): void {
  const dir = join(root, relativeDir);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRelative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) collectRelativeFiles(root, childRelative, out);
    else if (entry.isFile()) out.add(childRelative.replace(/\\/g, "/"));
  }
}

function totalRelativeFileBytes(root: string, files: string[]): number {
  return files.reduce((sum, file) => {
    const absolute = join(root, file);
    return existsSync(absolute) && statSync(absolute).isFile() ? sum + statSync(absolute).size : sum;
  }, 0);
}

function runBtbOfficialContractPreflight(revision: string, manifestLockfile: string): void {
  const command = [
    "npm run benchmark:bankertoolbench:official-contract -- --strict",
    `--dataset-revision ${quoteShellArg(revision)}`,
    `--manifest-lockfile ${quoteShellArg(rel(manifestLockfile))}`,
  ].join(" ");
  console.log(`proofloop setup: official contract preflight ${command}`);
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      BTB_DATASET_REVISION: revision,
      BTB_MANIFEST_LOCKFILE: rel(manifestLockfile),
    },
  });
  process.exitCode = result.status ?? 1;
}

function tryScanBtb(root: string): { ok: boolean; taskIds: string[] } {
  try {
    const report = scanBankerToolBenchBundle(root, { includeTasks: true, sampleLimit: 3 });
    const missingTaskData = report.warnings.some((warning) => /missing task-data directory/i.test(warning));
    const taskIds = (report.tasks ?? [])
      .filter((task) => task.agentTask.inputFiles.length > 0 && task.agentTask.instruction.trim())
      .slice(0, 3)
      .map((task) => task.id);
    return { ok: taskIds.length > 0 && !missingTaskData, taskIds };
  } catch {
    return { ok: false, taskIds: [] };
  }
}

function btbSetupReceipt(args: {
  status: "ready" | "needs_download" | "blocked";
  root: string;
  dataset: string;
  revision: string;
  taskIds: string[];
  downloadedFiles: string[];
  fixtureFiles?: string[];
  manifestLockfile?: string;
  totalBytes: number;
  message: string;
  scan?: unknown;
}): Record<string, unknown> {
  return {
    schema: 1,
    benchmark: "bankertoolbench",
    generatedAt: new Date().toISOString(),
    productRule: "Proof Loop guides the coding agent to set up local fixtures before declaring external blockers.",
    root: rel(args.root),
    dataset: args.dataset,
    revision: args.revision,
    status: args.status,
    taskIds: args.taskIds,
    downloadedFiles: args.downloadedFiles,
    fixtureFiles: args.fixtureFiles,
    manifestLockfile: args.manifestLockfile ? rel(args.manifestLockfile) : undefined,
    totalBytes: args.totalBytes,
    message: args.message,
    nextCommands: [
      "npm run proofloop -- setup bankertoolbench --allow-download --limit 1",
      "npm run proofloop -- setup bankertoolbench --allow-download --limit 1 --verify-official-contract",
      "npm run proofloop -- run bankertoolbench",
    ],
    scan: args.scan,
  };
}

function normalizeGoalId(goalId: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(goalId)) {
    console.error("proofloop: goal id must use only letters, numbers, dot, underscore, or dash");
    process.exitCode = 1;
    return undefined;
  }
  return goalId;
}

function goalPaths(goalId: string): GoalPaths {
  const root = join(GOALS_DIR, goalId);
  return {
    root,
    state: join(root, "state.json"),
    ledger: join(root, "ledger.jsonl"),
    queue: join(root, "queue.json"),
    blockers: join(root, "blockers.json"),
    heartbeats: join(root, "heartbeats.jsonl"),
  };
}

function ensureGoal(goalId: string, options: { maxHours?: number; budgetUsd?: number; requiresShippingProof?: boolean } = {}): GoalPaths {
  const paths = goalPaths(goalId);
  mkdirSync(paths.root, { recursive: true });
  const now = new Date().toISOString();
  let created = false;
  if (!existsSync(paths.state)) {
    const state: GoalStateFile = {
      schema: 1,
      goalId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
      maxHours: Number.isFinite(options.maxHours) ? options.maxHours ?? 72 : 72,
      budgetUsd: options.budgetUsd,
      heartbeatTimeoutMinutes: DEFAULT_SUPERVISOR_POLICY.heartbeatTimeoutMinutes,
      maxStalls: DEFAULT_SUPERVISOR_POLICY.maxStalls,
      maxRetriesPerTask: DEFAULT_SUPERVISOR_POLICY.maxRetriesPerTask,
      stallCount: 0,
      requiresShippingProof: options.requiresShippingProof ?? false,
      spentUsd: 0,
    };
    writeJson(paths.state, state);
    created = true;
  }
  if (!existsSync(paths.queue)) writeJson(paths.queue, defaultGoalQueue(goalId));
  if (!existsSync(paths.blockers)) writeJson(paths.blockers, { schema: 1, goalId, blockers: [] } satisfies GoalBlockers);
  if (!existsSync(paths.ledger)) writeFileSync(paths.ledger, "", "utf8");
  if (!existsSync(paths.heartbeats)) writeFileSync(paths.heartbeats, "", "utf8");
  if (created) {
    appendGoalLedger(paths, "goal_initialized", { state: "queued" });
    writeGoalHeartbeat(paths, "supervisor", { event: "goal_initialized" });
  }
  return paths;
}

function defaultGoalQueue(goalId: string): GoalQueue {
  const now = new Date().toISOString();
  const task = (id: string, title: string, bucket: GoalTaskBucket, command: string | undefined, required = true): GoalTask => ({
    id,
    title,
    command,
    bucket,
    required,
    retries: 0,
    maxRetries: DEFAULT_SUPERVISOR_POLICY.maxRetriesPerTask,
    createdAt: now,
    updatedAt: now,
  });
  return {
    schema: 1,
    goalId,
    must_do_now: [
      task("typecheck", "TypeScript typecheck", "must_do_now", "npm run typecheck -- --pretty false"),
      task("proofloop-focused-tests", "Proof Loop focused tests", "must_do_now", "npm test -- --run tests/proofloopArtifacts.test.ts tests/proofloopLoopArtifacts.test.ts tests/proofloopPipeline.test.ts"),
      task("nodeagent-trace-frame-tests", "NodeAgent trace/frame tests", "must_do_now", "npm test -- --run tests/nodeagentTraceSpine.test.ts tests/frameRunner.test.ts"),
      task("nodeagent-frame-smoke", "NodeAgent frame smoke", "must_do_now", "npm run nodeagent:frame:smoke"),
      task("omnigent-nodeagent-smoke", "Omnigent NodeAgent smoke", "must_do_now", "npm run omnigent:nodeagent:smoke"),
      task("memory-doctor", "NodeMem local-first memory doctor", "must_do_now", "npm run proofloop -- memory doctor"),
      task("setup-bankertoolbench-local", "Prepare local BankerToolBench fixture", "must_do_now", "npm run proofloop -- setup bankertoolbench --allow-download --limit 1"),
      task("bankertoolbench-official-contract", "BankerToolBench official scorer contract preflight", "must_do_now", "npm run proofloop -- setup bankertoolbench --allow-download --limit 1 --verify-official-contract"),
      task("bankertoolbench-live", "BankerToolBench strict live proof", "must_do_now", "npm run proofloop -- run bankertoolbench"),
    ],
    blocked: [],
    unblocked_next: [
      task("setup-finch-local", "Prepare local Finch adapter", "unblocked_next", "npm run proofloop -- setup finch"),
      task("finch-live", "Finch strict live proof", "unblocked_next", "npm run proofloop -- run finch"),
      task("setup-finauditing-local", "Prepare local FinAuditing adapter", "unblocked_next", "npm run proofloop -- setup finauditing"),
      task("finauditing-live", "FinAuditing strict live proof", "unblocked_next", "npm run proofloop -- run finauditing"),
      task("setup-workstreambench-local", "Prepare local WorkstreamBench adapter", "unblocked_next", "npm run proofloop -- setup workstreambench"),
      task("workstreambench-live", "WorkstreamBench strict live proof", "unblocked_next", "npm run proofloop -- run workstreambench"),
      task("memory-index", "NodeMem searchable index", "unblocked_next", "npm run proofloop -- memory index"),
    ],
    nice_to_have: [
      task("trace-storybook", "Trace Storybook deterministic trace atoms", "nice_to_have", undefined, false),
      task("model-delta-reports", "Model-delta reports", "nice_to_have", undefined, false),
      task("prototype-mode", "Prototype-to-proof mode", "nice_to_have", undefined, false),
      task("design-adapters", "Open Design/Open CoDesign adapters", "nice_to_have", undefined, false),
      task("ci-hardening", "CI/deploy proof hardening", "nice_to_have", undefined, false),
    ],
    done: [],
  };
}

function readGoalState(paths: GoalPaths): GoalStateFile {
  return JSON.parse(readFileSync(paths.state, "utf8")) as GoalStateFile;
}

function writeGoalState(paths: GoalPaths, state: GoalStateFile): void {
  state.updatedAt = new Date().toISOString();
  writeJson(paths.state, state);
}

function readGoalQueue(paths: GoalPaths): GoalQueue {
  return JSON.parse(readFileSync(paths.queue, "utf8")) as GoalQueue;
}

function writeGoalQueue(paths: GoalPaths, queue: GoalQueue): void {
  writeJson(paths.queue, queue);
}

function readGoalBlockers(paths: GoalPaths): GoalBlockers {
  return JSON.parse(readFileSync(paths.blockers, "utf8")) as GoalBlockers;
}

function writeGoalBlockers(paths: GoalPaths, blockers: GoalBlockers): void {
  writeJson(paths.blockers, blockers);
}

function appendGoalLedger(paths: GoalPaths, event: string, data: Record<string, unknown>): void {
  appendJsonl(paths.ledger, {
    schema: 1,
    ts: new Date().toISOString(),
    event,
    ...data,
  });
}

function writeGoalHeartbeat(paths: GoalPaths, workerId: string, data: Record<string, unknown>): void {
  appendJsonl(paths.heartbeats, {
    schema: 1,
    ts: new Date().toISOString(),
    workerId,
    ...data,
  });
}

function detectStalledWorker(paths: GoalPaths): void {
  const state = readGoalState(paths);
  if (isTerminalGoalState(state.state) || !existsSync(paths.heartbeats)) return;
  const last = readLastJsonl<{ ts?: string }>(paths.heartbeats);
  if (!last?.ts) return;
  const ageMs = Date.now() - Date.parse(last.ts);
  if (ageMs < state.heartbeatTimeoutMinutes * 60_000) return;
  state.stallCount += 1;
  state.state = state.stallCount >= state.maxStalls ? "needs_human_approval" : state.state;
  writeGoalState(paths, state);
  appendGoalLedger(paths, "worker_stalled", {
    ageMs,
    heartbeatTimeoutMinutes: state.heartbeatTimeoutMinutes,
    stallCount: state.stallCount,
    terminal: state.state === "needs_human_approval",
  });
}

function readLastJsonl<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (!lines.length) return undefined;
  try {
    return JSON.parse(lines[lines.length - 1]) as T;
  } catch {
    return undefined;
  }
}

function isTerminalGoalState(state: GoalState): boolean {
  return TERMINAL_GOAL_STATES.includes(state);
}

function queueCounts(queue: GoalQueue): Record<GoalTaskBucket, number> {
  return {
    must_do_now: queue.must_do_now.length,
    blocked: queue.blocked.length,
    unblocked_next: queue.unblocked_next.length,
    nice_to_have: queue.nice_to_have.length,
    done: queue.done.length,
  };
}

function nextRunnableTask(queue: GoalQueue): GoalTask | undefined {
  return [...queue.must_do_now, ...queue.unblocked_next].find((task) => Boolean(task.command));
}

function requiredOpenTasks(queue: GoalQueue): GoalTask[] {
  return [...queue.must_do_now, ...queue.blocked, ...queue.unblocked_next, ...queue.nice_to_have].filter((task) => task.required);
}

function findTask(queue: GoalQueue, taskId: string): { task: GoalTask; bucket: GoalTaskBucket } | undefined {
  for (const bucket of ["must_do_now", "blocked", "unblocked_next", "nice_to_have", "done"] as GoalTaskBucket[]) {
    const task = queue[bucket].find((item) => item.id === taskId);
    if (task) return { task, bucket };
  }
  return undefined;
}

function moveTask(queue: GoalQueue, taskId: string, target: GoalTaskBucket, update: Partial<GoalTask> = {}): GoalTask | undefined {
  const found = findTask(queue, taskId);
  if (!found) return undefined;
  for (const bucket of ["must_do_now", "blocked", "unblocked_next", "nice_to_have", "done"] as GoalTaskBucket[]) {
    queue[bucket] = queue[bucket].filter((task) => task.id !== taskId);
  }
  const moved: GoalTask = {
    ...found.task,
    ...update,
    bucket: target,
    updatedAt: new Date().toISOString(),
  };
  queue[target].push(moved);
  return moved;
}

function prependTask(queue: GoalQueue, task: GoalTask): void {
  for (const bucket of ["must_do_now", "blocked", "unblocked_next", "nice_to_have", "done"] as GoalTaskBucket[]) {
    queue[bucket] = queue[bucket].filter((item) => item.id !== task.id);
  }
  queue.must_do_now.unshift({ ...task, bucket: "must_do_now", updatedAt: new Date().toISOString() });
}

function runGoalTask(paths: GoalPaths, task: GoalTask): void {
  if (!task.command) {
    const queue = readGoalQueue(paths);
    moveTask(queue, task.id, "done");
    writeGoalQueue(paths, queue);
    appendGoalLedger(paths, "task_done", { taskId: task.id, skipped: true });
    return;
  }

  markGoalState(paths, "running", { taskId: task.id, command: task.command });
  appendGoalLedger(paths, "task_started", { taskId: task.id, command: task.command, retries: task.retries });
  const beforeRunIds = new Set(listRuns().map((run) => run.runId));
  const result = spawnSync(task.command, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    env: process.env,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const newRun = listRuns()
    .filter((run) => !beforeRunIds.has(run.runId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (newRun) {
    const state = readGoalState(paths);
    state.latestRunId = newRun.runId;
    writeGoalState(paths, state);
    initMemoryStore();
    ensureLoopArtifacts(newRun, { memoryPath: MEMORY_PATH });
  }

  const exitCode = result.status ?? 1;
  if (exitCode === 0) {
    const queue = readGoalQueue(paths);
    moveTask(queue, task.id, "done", { evidence: newRun ? rel(join(resolveRunDir(newRun), "meta.json")) : undefined });
    writeGoalQueue(paths, queue);
    appendGoalLedger(paths, "task_passed", { taskId: task.id, exitCode, latestRunId: newRun?.runId });
    return;
  }

  const setupTask = localSetupTaskForFailure(task, `${stdout}\n${stderr}`);
  if (setupTask) {
    const queue = readGoalQueue(paths);
    if (!findTask(queue, setupTask.id)) prependTask(queue, setupTask);
    if (findTask(queue, task.id)?.bucket === "must_do_now") moveTask(queue, task.id, "unblocked_next", { retries: task.retries + 1 });
    writeGoalQueue(paths, queue);
    markGoalState(paths, "repairing", { taskId: task.id, setupTaskId: setupTask.id, reason: "local setup required before blocker classification" });
    appendGoalLedger(paths, "local_setup_task_created", { taskId: task.id, setupTaskId: setupTask.id, command: setupTask.command });
    return;
  }

  const blocker = classifyExternalBlocker(paths, task, `${stdout}\n${stderr}`, newRun);
  if (blocker) {
    recordGoalBlocker(paths, blocker, task);
    appendGoalLedger(paths, "task_blocked_external", { taskId: task.id, blocker });
    return;
  }

  const queue = readGoalQueue(paths);
  const retries = task.retries + 1;
  if (retries > task.maxRetries) {
    moveTask(queue, task.id, "blocked", { retries, blockerName: "max retries exceeded", evidence: newRun ? rel(join(resolveRunDir(newRun), "meta.json")) : undefined });
    writeGoalQueue(paths, queue);
    markGoalState(paths, "failed", { taskId: task.id, exitCode, retries, reason: "max retries exceeded" });
    return;
  }

  moveTask(queue, task.id, task.bucket, { retries });
  prependTask(queue, {
    id: `repair-${task.id}-${retries}`,
    title: `Repair ${task.title}`,
    command: "npm run proofloop -- repair latest",
    bucket: "must_do_now",
    required: false,
    retries: 0,
    maxRetries: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  writeGoalQueue(paths, queue);
  markGoalState(paths, "repairing", { taskId: task.id, exitCode, retries });
  appendGoalLedger(paths, "repair_task_created", { taskId: task.id, repairTaskId: `repair-${task.id}-${retries}` });
}

function localSetupTaskForFailure(task: GoalTask, output: string): GoalTask | undefined {
  const lower = output.toLowerCase();
  const now = new Date().toISOString();
  if (task.id === "bankertoolbench-live" && /btb_ui_bundle_root does not exist|btb-fixture/.test(lower)) {
    return {
      id: "setup-bankertoolbench-local",
      title: "Prepare local BankerToolBench fixture",
      command: "npm run proofloop -- setup bankertoolbench --allow-download --limit 1",
      bucket: "must_do_now",
      required: true,
      retries: 0,
      maxRetries: DEFAULT_SUPERVISOR_POLICY.maxRetriesPerTask,
      createdAt: now,
      updatedAt: now,
    };
  }
  return undefined;
}

function recordGoalBlocker(paths: GoalPaths, blocker: GoalBlocker, task: GoalTask | undefined): void {
  const blockers = readGoalBlockers(paths);
  blockers.blockers.push(blocker);
  writeGoalBlockers(paths, blockers);

  const queue = readGoalQueue(paths);
  if (task) {
    moveTask(queue, task.id, "blocked", {
      blockerType: blocker.type,
      blockerName: blocker.name,
      evidence: blocker.evidence,
      resumeCommand: blocker.resumeCommand,
    });
  }
  writeGoalQueue(paths, queue);

  const unblockedRequired = requiredOpenTasks(queue).filter((item) => item.bucket !== "blocked");
  const state = readGoalState(paths);
  state.state = unblockedRequired.length ? "running" : "blocked_external";
  writeGoalState(paths, state);
  appendGoalLedger(paths, "blocker_recorded", { blocker });
}

function blockerFromArgs(args: string[], task: GoalTask | undefined): GoalBlocker | undefined {
  const type = optionValue(args, "--type") as GoalBlocker["type"] | undefined;
  const evidence = optionValue(args, "--evidence");
  const resumeCommand = optionValue(args, "--resume-command");
  if (!type || !evidence || !resumeCommand) return undefined;
  if (!isGoalBlockerType(type)) return undefined;
  return {
    type,
    name: optionValue(args, "--name"),
    evidence,
    resumeCommand,
    unblockedTasksRemaining: parseBooleanOption(args, "--unblocked-tasks-remaining", true),
    taskId: optionValue(args, "--task") ?? task?.id,
    recordedAt: new Date().toISOString(),
  };
}

function classifyLatestExternalBlocker(paths: GoalPaths, task: GoalTask | undefined): GoalBlocker | undefined {
  const state = readGoalState(paths);
  const latest = state.latestRunId ? resolveRun(state.latestRunId) : resolveRun("latest");
  return classifyExternalBlocker(paths, task, "", latest);
}

function classifyExternalBlocker(paths: GoalPaths, task: GoalTask | undefined, output: string, latestRun: RunMeta | undefined): GoalBlocker | undefined {
  const queue = readGoalQueue(paths);
  const unblockedTasksRemaining = requiredOpenTasks(queue).some((item) => item.id !== task?.id && item.bucket !== "blocked");
  const runDir = latestRun ? resolveRunDir(latestRun) : undefined;
  const officialReceiptPath = runDir ? join(runDir, "official-scorer-receipt.json") : undefined;
  const officialReceipt = officialReceiptPath ? readJsonIfExists<{
    status?: string;
    blocker?: string;
    sourceReceipt?: {
      status?: string;
      blockers?: string[];
    };
  }>(officialReceiptPath) : null;
  const receiptBlockers = officialReceipt?.sourceReceipt?.blockers ?? extractOutputBlockers(output);
  const evidence = officialReceiptPath && existsSync(officialReceiptPath)
    ? rel(officialReceiptPath)
    : latestRun ? rel(join(resolveRunDir(latestRun), "meta.json")) : paths.ledger;
  const command = task?.command ?? "npm run proofloop -- run bankertoolbench";
  const lower = `${output}\n${officialReceipt?.blocker ?? ""}\n${receiptBlockers.join("\n") ?? ""}`.toLowerCase();

  if (/btb_ui_bundle_root does not exist|official bankertoolbench fixture|btb-fixture/.test(lower)) {
    return {
      type: "missing_dataset",
      name: "official BankerToolBench fixture bundle",
      evidence,
      resumeCommand: "BTB_UI_BUNDLE_ROOT=.tmp/official-benchmarks/btb-fixture npm run proofloop -- run bankertoolbench",
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
    };
  }
  if (/blocked_external_requirements|harbor\/docker|official gandalf verifier|mcp financial tools|manifest lockfile/.test(lower)) {
    return {
      type: "missing_official_scorer",
      name: task ? `${task.title} official execution contract` : "BankerToolBench official execution contract",
      evidence,
      resumeCommand: command,
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
      requirements: receiptBlockers.length ? receiptBlockers : [
        "Record dataset revision plus a manifest lockfile with per-file hashes.",
        "Run each official task in Harbor/Docker with agent-only workspace mounts before verifier access.",
        "Adapt required MCP financial tools.",
        "Import official Gandalf verifier scores.",
      ],
    };
  }
  if (/browserscenario does not exist|official scorer command is not configured|not implemented in this repo yet/.test(lower)) {
    return {
      type: "missing_official_scorer",
      name: task ? `${task.title} adapter/scorer` : "official scorer adapter",
      evidence,
      resumeCommand: command,
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
    };
  }
  if (/credential|api key|auth|login required|unauthorized/.test(lower)) {
    return {
      type: "missing_credential",
      name: "credential required by proof command",
      evidence,
      resumeCommand: command,
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
    };
  }
  if (/paid service|billing|quota|payment required/.test(lower)) {
    return {
      type: "paid_service_required",
      name: "paid service requirement",
      evidence,
      resumeCommand: command,
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
    };
  }
  if (/service unavailable|econnreset|etimedout|external service down/.test(lower)) {
    return {
      type: "external_service_down",
      name: "external service unavailable",
      evidence,
      resumeCommand: command,
      unblockedTasksRemaining,
      taskId: task?.id,
      recordedAt: new Date().toISOString(),
    };
  }
  return undefined;
}

function extractOutputBlockers(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[*-]\s*/, ""))
    .filter((line) => (
      /^Record BankerToolBench dataset revision/i.test(line) ||
      /^Run each official task in Harbor\/Docker/i.test(line) ||
      /^Adapt required MCP financial tools/i.test(line) ||
      /^Import official Gandalf verifier scores/i.test(line)
    ));
}

function isGoalBlockerType(value: string): value is GoalBlocker["type"] {
  return [
    "missing_credential",
    "missing_dataset",
    "missing_official_scorer",
    "paid_service_required",
    "destructive_approval_required",
    "external_service_down",
  ].includes(value);
}

function evaluateGoalGate(paths: GoalPaths, options: { shipping?: boolean } = {}): { passed: boolean; missing: string[] } {
  const state = readGoalState(paths);
  const queue = readGoalQueue(paths);
  const blockers = readGoalBlockers(paths);
  const missing: string[] = [];

  for (const task of requiredOpenTasks(queue)) {
    missing.push(`${task.bucket === "blocked" ? "required task blocked" : "required task open"}: ${task.id}`);
  }
  if (blockers.blockers.length) missing.push(`known blockers remain: ${blockers.blockers.map((blocker) => blocker.type).join(", ")}`);

  const latest = state.latestRunId ? resolveRun(state.latestRunId) : resolveRun("latest");
  if (!latest) {
    missing.push("latest proof run missing");
  } else {
    const runDir = resolveRunDir(latest);
    if (!latest.passed) missing.push(`latest proof run did not pass: ${latest.runId}`);
    for (const artifact of ["node-trace-v2.json", "node-eval.json", "scorecard.md"]) {
      if (!existsSync(join(runDir, artifact))) missing.push(`${artifact} missing for ${latest.runId}`);
    }
    if (!memoryContainsRun(latest.runId)) missing.push(`NodeMem write missing for ${latest.runId}`);
    if (isLiveRun(latest)) {
      const contract = readJsonIfExists<{ valid?: boolean }>(join(runDir, "live-user-contract.json"));
      if (contract?.valid !== true) missing.push(`live-user proof missing or invalid for ${latest.runId}`);
      if (!existsSync(join(runDir, "verifier-receipt.json"))) missing.push(`verifier receipt missing for ${latest.runId}`);
      if (!hasAnyFile(join(runDir, "screenshots"))) missing.push(`browser visual evidence missing for ${latest.runId}`);
      if (!fileHasBytesLocal(join(runDir, "cockpit-events.jsonl"))) missing.push(`cockpit events missing for ${latest.runId}`);
    }
    if (readBenchmarkAdapterIfExists(latest.suite) || existsSync(join(runDir, "official-scorer-receipt.json"))) {
      const receipt = readJsonIfExists<{ passed?: boolean; status?: string }>(join(runDir, "official-scorer-receipt.json"));
      if (receipt?.passed !== true) missing.push(`official scorer receipt missing or failing for ${latest.runId}`);
    }
  }

  if ((state.requiresShippingProof || options.shipping) && !existsSync(join(paths.root, "ci-deploy-proof.json"))) {
    missing.push("CI/deploy proof missing for shipping goal");
  }
  if (state.state !== "passed" && isTerminalGoalState(state.state)) missing.push(`goal terminal state is ${state.state}, not passed`);

  return { passed: missing.length === 0, missing };
}

function isLiveRun(meta: RunMeta): boolean {
  return /live|browser|btb|banker|playwright|--prod|ui/i.test(`${meta.suite} ${meta.cmd}`);
}

function memoryContainsRun(runId: string): boolean {
  const memoryFiles = [
    MEMORY_PATH,
    LEGACY_MEMORY_PATH,
    join(MEMORY_COMPACTED_DIR, "episodes.jsonl"),
    join(MEMORY_COMPACTED_DIR, "failures.jsonl"),
  ];
  return memoryFiles.some((path) => existsSync(path) && readFileSync(path, "utf8").includes(runId));
}

function hasAnyFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (stat.isFile()) return stat.size > 0;
  return readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() && statSync(join(path, entry.name)).size > 0);
}

function fileHasBytesLocal(path: string): boolean {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

function markGoalState(paths: GoalPaths, goalState: GoalState, data: Record<string, unknown>): void {
  const state = readGoalState(paths);
  state.state = goalState;
  if (isTerminalGoalState(goalState)) state.completedAt = new Date().toISOString();
  writeGoalState(paths, state);
  appendGoalLedger(paths, "state_changed", { state: goalState, ...data });
}

function budgetExceeded(state: GoalStateFile): boolean {
  return typeof state.budgetUsd === "number" && state.spentUsd > state.budgetUsd;
}

function maxHoursExceeded(state: GoalStateFile): boolean {
  if (!state.startedAt) return false;
  return Date.now() - Date.parse(state.startedAt) > state.maxHours * 60 * 60 * 1000;
}

function renderResumePrompt(goalId: string, task: GoalTask | undefined, latestRunId: string): string {
  return [
    "You are resuming a Proof Loop goal.",
    "",
    "Do not summarize and stop.",
    "Read:",
    `- .proofloop/goals/${goalId}/state.json`,
    `- .proofloop/goals/${goalId}/ledger.jsonl`,
    "- latest scorecard",
    `- .proofloop/goals/${goalId}/blockers.json`,
    `- .proofloop/goals/${goalId}/queue.json`,
    "",
    "Continue the next unblocked task.",
    "",
    "You may stop only if:",
    `1. proofloop gate --goal ${goalId} passes, or`,
    "2. all remaining tasks are blocked by explicit external requirements.",
    "",
    "Return BLOCKED only with:",
    "- exact missing requirement",
    "- exact resume command",
    "- completed deterministic work",
    "- next unblocked task if any.",
    "",
    `latestRunId: ${latestRunId}`,
    `nextTask: ${task ? `${task.id} :: ${task.command ?? task.title}` : "none"}`,
  ].join("\n");
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) value = args[index + 1];
    else if (args[index].startsWith(prefix)) value = args[index].slice(prefix.length);
  }
  return value;
}

function optionNumber(args: string[], name: string): number | undefined {
  const value = optionValue(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseBooleanOption(args: string[], name: string, fallback: boolean): boolean {
  const value = optionValue(args, name);
  if (value === undefined) return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function cmdStorybook(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(`proofloop: storybook ${rel(paths.storybookPath)}`);
}

function cmdRepair(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(readFileSync(paths.repairPromptPath, "utf8"));
}

function cmdStoryboard(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(`proofloop: storyboard ${rel(paths.storyboardJsonPath)}`);
  console.log(readFileSync(paths.storyboardMdPath, "utf8"));
}

function cmdClips(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  const clipsManifest = join(resolveRunDir(meta), "clips", "clip-manifest.json");
  console.log(`proofloop: storyboard ${rel(paths.storyboardMdPath)}`);
  console.log(`proofloop: clips     ${rel(clipsManifest)}`);
  console.log(`proofloop: social    ${rel(join(resolveRunDir(meta), "social"))}`);
}

function cmdReleaseVideo(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  ensureLoopArtifacts(meta);
  const output = renderReleaseVideo(meta, resolveRunDir(meta));
  if (output) console.log(`proofloop: release video ${rel(output)}`);
}

function cmdLagging(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(readFileSync(paths.laggingMdPath, "utf8"));
}

function cmdRouterSuggest(runIdArg: string | undefined): void {
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta);
  console.log(readFileSync(paths.routerSuggestionPath, "utf8"));
}

function cmdPromote(runIdArg: string | undefined): void {
  const meta = resolveRun(runIdArg);
  if (!meta) {
    console.error(`proofloop: no run found for "${runIdArg ?? "latest"}"`);
    process.exitCode = 1;
    return;
  }
  if (meta.passed) {
    console.log(`proofloop: run ${meta.runId} passed -- nothing to promote.`);
    return;
  }
  const regressions: Array<{ suite: string; runId: string; failedGates: string[]; promotedAt: string }> = existsSync(REGRESSIONS_PATH)
    ? JSON.parse(readFileSync(REGRESSIONS_PATH, "utf8"))
    : [];
  const entry = { suite: meta.suite, runId: meta.runId, failedGates: meta.failedGates ?? [], promotedAt: new Date().toISOString() };
  const alreadyPromoted = regressions.some((r) => r.suite === entry.suite && JSON.stringify(r.failedGates) === JSON.stringify(entry.failedGates));
  if (!alreadyPromoted) regressions.push(entry);
  writeJson(REGRESSIONS_PATH, regressions);
  console.log(`proofloop: promoted ${meta.runId} to ${rel(REGRESSIONS_PATH)} (${alreadyPromoted ? "already tracked" : "new regression"})`);
  console.log(`  suite:       ${meta.suite}`);
  console.log(`  failed gates: ${meta.failedGates?.length ?? 0}`);
  if (meta.failedGates?.length) {
    for (const gate of meta.failedGates) console.log(`    - ${gate}`);
  }
  console.log(`  score:       ${meta.score ?? "n/a"}/${meta.minScore ?? "n/a"}`);
  console.log(`  duration:    ${formatMs(meta.durationMs)}`);
  console.log(`  total tracked regressions: ${regressions.length}`);
}

function cmdExportRl(runIdArg: string | undefined): void {
  const meta = resolveRun(runIdArg);
  if (!meta) {
    console.error(`proofloop: no run found for "${runIdArg ?? "latest"}"`);
    process.exitCode = 1;
    return;
  }
  const liveDir = meta.receiptPaths.find((p) => p.includes(".proofloop/live/") || p.includes(".proofloop\\live\\"));
  const outputDir = liveDir ? resolve(ROOT, liveDir, "..") : join(RUNS_DIR, meta.runId);
  const result = spawnSync("npx", ["tsx", "proofloop/adapters/export-rl-trace.ts", `--suite=${meta.suite}`], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PROOFLOOP_OUTPUT_DIR: outputDir },
    shell: process.platform === "win32",
  });
  process.exitCode = result.status ?? 1;
}

// ---------------------------------------------------------------------------

function readBenchmarkAdapterIfExists(suite: string): BenchmarkAdapter | undefined {
  const path = join(ROOT, "proofloop", "benchmarks", suite, "adapter.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as BenchmarkAdapter;
}

function suiteConfigForAdapter(adapter: BenchmarkAdapter | undefined): SuiteConfig | undefined {
  if (!adapter) return undefined;
  return {
    cmd: `npm run proofloop:live:adapter -- ${adapter.id}`,
    minScore: 100,
    kind: "browser",
    receiptGlob: "live-browser",
  };
}

function knownSuites(config: ProofloopConfig): string[] {
  const configured = Object.keys(config.suites);
  const benchmarkDir = join(ROOT, "proofloop", "benchmarks");
  if (!existsSync(benchmarkDir)) return configured;
  const adapters = readdirSync(benchmarkDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(benchmarkDir, entry.name, "adapter.json")))
    .map((entry) => entry.name);
  return [...new Set([...configured, ...adapters])].sort();
}

function forceOfficialAdapterFlags(flags: RunFlags, adapter: BenchmarkAdapter | undefined): RunFlags {
  if (!adapter) return flags;
  return {
    ...flags,
    prod: true,
    cockpit: true,
    userEmulationStrict: true,
  };
}

function applyBenchmarkAdapterEnv(
  env: Record<string, string>,
  adapter: BenchmarkAdapter | undefined,
  runDir: string,
  flags: RunFlags,
  recordedCmd: string,
): void {
  if (!adapter) return;
  const baseUrl = baseUrlForRun(flags, recordedCmd);
  env.PROOFLOOP_OFFICIAL_ADAPTER = adapter.id;
  env.PROOFLOOP_COCKPIT = "1";
  env.PROOFLOOP_USER_EMULATION = "strict";
  env.PLAYWRIGHT_BASE_URL = baseUrl;
  env.BENCH_BASE_URL = baseUrl;
  if (adapter.id === "bankertoolbench") {
    env.BTB_LIVE_ROOM_E2E = "1";
    env.BTB_UI_VERIFIER_COMMAND = env.BTB_UI_VERIFIER_COMMAND || adapter.verifierCommand;
    env.BTB_LIVE_ROOM_PROOF_PATH = join(runDir, "verifier-receipt.json");
    env.BTB_FRESH_ROOM_PROOF_PATH = join(runDir, "fresh-room-proof.json");
    env.BTB_PACKAGE_MANIFEST_PATH = join(runDir, "exported-files-reopen-proof.json");
    const setupReceipt = readJsonIfExists<{ revision?: string; manifestLockfile?: string }>(join(SETUP_DIR, "bankertoolbench-local-setup.json"));
    const manifestLockfile = setupReceipt?.manifestLockfile ? resolve(ROOT, setupReceipt.manifestLockfile) : join(SETUP_DIR, "bankertoolbench-manifest-lock.json");
    if (setupReceipt?.revision) env.BTB_DATASET_REVISION = env.BTB_DATASET_REVISION || String(setupReceipt.revision);
    if (existsSync(manifestLockfile)) env.BTB_MANIFEST_LOCKFILE = env.BTB_MANIFEST_LOCKFILE || rel(manifestLockfile);
  }
}

function writeOfficialScorerReceipt(args: {
  adapter: BenchmarkAdapter | undefined;
  suite: string;
  runDir: string;
}): { passed: boolean; failedGates: string[] } {
  const { adapter, runDir, suite } = args;
  const receiptPath = join(runDir, "official-scorer-receipt.json");
  if (!adapter) {
    writeJson(receiptPath, {
      schema: 1,
      required: true,
      status: "blocked",
      passed: false,
      benchmark: suite,
      generatedAt: new Date().toISOString(),
      blocker: "No official benchmark adapter is registered for this suite.",
    });
    return { passed: false, failedGates: ["official_scorer_unregistered"] };
  }
  const scorer = adapter.officialScorer;
  if (!scorer?.command) {
    writeJson(receiptPath, {
      schema: 1,
      required: true,
      status: "blocked",
      passed: false,
      benchmark: adapter.id,
      scorerName: scorer?.name ?? "official scorer",
      generatedAt: new Date().toISOString(),
      blocker: scorer?.unavailableReason ?? "Official scorer command is not configured.",
    });
    return { passed: false, failedGates: ["official_scorer_unavailable"] };
  }

  const sourceReceipt = scorer.receiptPath ? join(runDir, "official-scorer-source-receipt.json") : undefined;
  const command = sourceReceipt ? `${scorer.command} --json-out ${quoteShellArg(sourceReceipt)}` : scorer.command;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    env: {
      ...process.env,
      PROOFLOOP_OFFICIAL_SCORER_RECEIPT_PATH: receiptPath,
      ...(sourceReceipt ? { PROOFLOOP_OFFICIAL_SCORER_SOURCE_RECEIPT_PATH: sourceReceipt } : {}),
    },
  });
  const exitCode = result.status ?? 1;
  const sourceReceiptJson = sourceReceipt ? readJsonIfExists<unknown>(sourceReceipt) : null;
  const passed = exitCode === 0 && (!sourceReceipt || sourceReceiptJson !== null) && officialSourceReceiptPassed(sourceReceiptJson);
  writeJson(receiptPath, {
    schema: 1,
    required: true,
    status: passed ? "pass" : "fail",
    passed,
    benchmark: adapter.id,
    scorerName: scorer.name,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    exitCode,
    sourceReceiptPath: sourceReceipt ? rel(sourceReceipt) : undefined,
    sourceReceipt: sourceReceiptJson,
    stdoutTail: String(result.stdout ?? "").slice(-4000),
    stderrTail: String(result.stderr ?? "").slice(-4000),
  });
  return { passed, failedGates: passed ? [] : ["official_scorer_failed"] };
}

function quoteShellArg(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function officialSourceReceiptPassed(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== "object") return true;
  const record = receipt as { pass?: unknown; passed?: unknown; status?: unknown };
  if (typeof record.pass === "boolean") return record.pass;
  if (typeof record.passed === "boolean") return record.passed;
  if (typeof record.status === "string") return /pass|ready|green/i.test(record.status);
  return true;
}

function hydrateRunArtifactsFromReceipts(runDir: string, receiptPaths: string[]): void {
  for (const receiptPath of receiptPaths) {
    const absolute = resolve(ROOT, receiptPath);
    const receipt = readJsonIfExists<{
      screenshot?: string;
      ui?: { screenshotPaths?: string[] };
      packageManifestPath?: string;
      artifacts?: {
        exportedFiles?: Array<{ path?: string; reopened?: boolean; filename?: string; extension?: string }>;
        reopenedFiles?: Array<{ reopened?: boolean; filename?: string; detail?: string }>;
      };
      scorer?: unknown;
    }>(absolute);
    if (!receipt) continue;
    if (!existsSync(join(runDir, "verifier-receipt.json"))) copyJsonOrFile(absolute, join(runDir, "verifier-receipt.json"));

    const screenshots = [
      receipt.screenshot,
      ...(receipt.ui?.screenshotPaths ?? []),
    ].filter((path): path is string => Boolean(path));
    if (screenshots.length) {
      const screenshotsDir = join(runDir, "screenshots");
      mkdirSync(screenshotsDir, { recursive: true });
      for (const screenshot of screenshots) {
        const source = resolve(ROOT, screenshot);
        if (existsSync(source)) copyFileSync(source, join(screenshotsDir, `${Date.now()}-${source.split(/[\\/]/).pop() ?? "proof.png"}`));
      }
    }

    if (!existsSync(join(runDir, "exported-files-reopen-proof.json"))) {
      const manifestSource = receipt.packageManifestPath ? resolve(ROOT, receipt.packageManifestPath) : undefined;
      if (manifestSource && existsSync(manifestSource)) {
        copyJsonOrFile(manifestSource, join(runDir, "exported-files-reopen-proof.json"));
      } else if (receipt.artifacts?.exportedFiles || receipt.artifacts?.reopenedFiles) {
        writeJson(join(runDir, "exported-files-reopen-proof.json"), {
          schema: 1,
          exportedFiles: receipt.artifacts.exportedFiles ?? [],
          reopenedFiles: receipt.artifacts.reopenedFiles ?? [],
          allReopened: (receipt.artifacts.reopenedFiles ?? []).every((file) => file.reopened !== false),
        });
      }
    }
  }
}

function copyJsonOrFile(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  try {
    const parsed = JSON.parse(readFileSync(source, "utf8"));
    writeJson(destination, parsed);
  } catch {
    copyFileSync(source, destination);
  }
}

// ---------------------------------------------------------------------------

function initMemoryStore(): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  mkdirSync(MEMORY_COMPACTED_DIR, { recursive: true });
  for (const path of [
    MEMORY_PATH,
    join(MEMORY_COMPACTED_DIR, "episodes.jsonl"),
    join(MEMORY_COMPACTED_DIR, "failures.jsonl"),
    join(MEMORY_COMPACTED_DIR, "scaffold-deltas.jsonl"),
    join(MEMORY_COMPACTED_DIR, "model-deltas.jsonl"),
    join(MEMORY_DIR, "redaction.log"),
  ]) {
    if (!existsSync(path)) writeFileSync(path, "", "utf8");
  }
  if (!existsSync(MEMORY_POLICY_PATH)) writeJson(MEMORY_POLICY_PATH, DEFAULT_MEMORY_POLICY);
  if (existsSync(LEGACY_MEMORY_PATH) && statSync(LEGACY_MEMORY_PATH).size > 0 && statSync(MEMORY_PATH).size === 0) {
    writeFileSync(MEMORY_PATH, readFileSync(LEGACY_MEMORY_PATH, "utf8"), "utf8");
  }
  if (!existsSync(MEMORY_INDEX_PATH)) writeMemoryIndex([]);
}

function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function loadMemoryDocuments(): Array<{ id: string; runId?: string; source: string; text: string }> {
  const paths = [
    MEMORY_PATH,
    join(MEMORY_COMPACTED_DIR, "episodes.jsonl"),
    join(MEMORY_COMPACTED_DIR, "failures.jsonl"),
    join(MEMORY_COMPACTED_DIR, "scaffold-deltas.jsonl"),
    join(MEMORY_COMPACTED_DIR, "model-deltas.jsonl"),
  ];
  const docs: Array<{ id: string; runId?: string; source: string; text: string }> = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const parsed = parseJsonLine(raw);
      const runId = parsed && typeof parsed === "object" && "runId" in parsed ? String((parsed as { runId?: unknown }).runId ?? "") : undefined;
      const explicitId = parsed && typeof parsed === "object" && "id" in parsed ? String((parsed as { id?: unknown }).id ?? "") : undefined;
      docs.push({
        id: explicitId || runId || `${rel(path)}#${i + 1}`,
        runId,
        source: path,
        text: raw,
      });
    }
  }
  return docs;
}

type MemorySearchHit = {
  id: string;
  runId?: string;
  source: string;
  textPreview: string;
  score: number;
};

type SqliteStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => Array<Record<string, unknown>>;
};

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

function writeMemoryIndex(documents: Array<{ id: string; runId?: string; source: string; text: string }>): string {
  const db = openMemorySqlite(true);
  if (!db) {
    writeJsonMemoryIndex(documents);
    return "local-jsonl-inverted-index";
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        runId TEXT,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        tokens TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(id UNINDEXED, runId UNINDEXED, source UNINDEXED, text);
      DELETE FROM documents;
      DELETE FROM documents_fts;
      DELETE FROM meta;
    `);
    const insertDoc = db.prepare("INSERT INTO documents (id, runId, source, text, tokens) VALUES (?, ?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO documents_fts (id, runId, source, text) VALUES (?, ?, ?, ?)");
    for (const doc of documents) {
      const source = rel(doc.source);
      const tokens = [...new Set(tokenize(doc.text))].sort().join(" ");
      insertDoc.run(doc.id, doc.runId ?? null, source, doc.text, tokens);
      insertFts.run(doc.id, doc.runId ?? null, source, doc.text);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("engine", "sqlite-fts5");
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("generatedAt", new Date().toISOString());
    db.close();
    return "sqlite-fts5";
  } catch {
    db.close();
    writeJsonMemoryIndex(documents);
    return "local-jsonl-inverted-index";
  }
}

function searchMemoryIndex(query: string): MemorySearchHit[] {
  const db = openMemorySqlite(false);
  const fts = ftsQuery(query);
  if (db && fts) {
    try {
      const rows = db.prepare(`
        SELECT id, runId, source, snippet(documents_fts, 3, '[', ']', ' ... ', 18) AS textPreview, bm25(documents_fts) AS rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT 10
      `).all(fts);
      db.close();
      return rows.map((row) => ({
        id: String(row.id ?? ""),
        runId: row.runId === null || row.runId === undefined ? undefined : String(row.runId),
        source: String(row.source ?? ""),
        textPreview: String(row.textPreview ?? ""),
        score: Math.max(0, Math.round(Math.abs(Number(row.rank ?? 0)) * 1000) / 1000),
      }));
    } catch {
      db.close();
    }
  } else if (db) {
    db.close();
  }
  return searchJsonMemoryIndex(query);
}

function openMemorySqlite(resetInvalid: boolean): SqliteDatabase | null {
  try {
    const sqlite = requireFromCli("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };
    if (resetInvalid && existsSync(MEMORY_INDEX_PATH) && statSync(MEMORY_INDEX_PATH).size > 0 && !looksLikeSqlite(MEMORY_INDEX_PATH)) {
      rmSync(MEMORY_INDEX_PATH, { force: true });
    }
    return new sqlite.DatabaseSync(MEMORY_INDEX_PATH);
  } catch {
    return null;
  }
}

function looksLikeSqlite(path: string): boolean {
  try {
    return readFileSync(path).subarray(0, 16).toString("utf8").startsWith("SQLite format 3");
  } catch {
    return false;
  }
}

function writeJsonMemoryIndex(documents: Array<{ id: string; runId?: string; source: string; text: string }>): void {
  const index = {
    schema: 1,
    engine: "local-jsonl-inverted-index",
    note: "Fallback index for runtimes without node:sqlite. The primary memory index is SQLite FTS5.",
    generatedAt: new Date().toISOString(),
    documents: documents.map((doc) => ({
      id: doc.id,
      runId: doc.runId,
      source: rel(doc.source),
      tokens: [...new Set(tokenize(doc.text))].sort(),
      textPreview: doc.text.slice(0, 280),
    })),
  };
  writeJson(MEMORY_INDEX_PATH, index);
}

function searchJsonMemoryIndex(query: string): MemorySearchHit[] {
  const index = readJsonIfExists<{ documents?: Array<{ id: string; runId?: string; source: string; tokens: string[]; textPreview: string }> }>(MEMORY_INDEX_PATH);
  const queryTokens = new Set(tokenize(query));
  return (index?.documents ?? [])
    .map((doc) => ({
      ...doc,
      score: doc.tokens.reduce((sum, token) => sum + (queryTokens.has(token) ? 1 : 0), 0),
    }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function ftsQuery(value: string): string {
  return tokenize(value)
    .map((token) => token.replace(/[^a-z0-9_]/g, ""))
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(" OR ");
}

function parseJsonLine(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_:\-./]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && token.length <= 80);
}

function redactText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_=-]{12,}\b/g, "[redacted-secret]")
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, "[redacted-ssn]");
}

// ---------------------------------------------------------------------------

function loadConfig(): ProofloopConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.warn(`proofloop: ${rel(CONFIG_PATH)} not found -- run \`proofloop init\` first. Using defaults.`);
    return DEFAULT_CONFIG;
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ProofloopConfig;
}

function listRuns(): RunMeta[] {
  if (!existsSync(RUNS_DIR)) return [];
  const out: RunMeta[] = [];
  for (const entry of readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(RUNS_DIR, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      out.push(JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta);
    } catch {
      // skip malformed run records
    }
  }
  return out;
}

function requireRun(runIdArg: string | undefined): RunMeta | undefined {
  const meta = resolveRun(runIdArg);
  if (!meta) {
    console.error(`proofloop: no run found for "${runIdArg ?? "latest"}"`);
    process.exitCode = 1;
  }
  return meta;
}

function resolveRun(runIdArg: string | undefined): RunMeta | undefined {
  const runs = listRuns().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!runIdArg || runIdArg === "latest") return runs[0];
  return runs.find((r) => r.runId === runIdArg);
}

function resolveRunDir(meta: RunMeta): string {
  return join(RUNS_DIR, meta.runId);
}

function ensureLoopArtifacts(meta: RunMeta, options: { memoryPath?: string } = {}) {
  const strictLiveUser = /--user-emulation\s+strict|--user-emulation=strict/i.test(meta.cmd);
  return writeLoopArtifactsForMeta({
    meta,
    runDir: resolveRunDir(meta),
    memoryPath: options.memoryPath,
    baseUrl: baseUrlForMeta(meta),
    strictLiveUser,
  });
}

function baseUrlForRun(flags: RunFlags, cmd: string): string {
  if (flags.prod) return process.env.PROOFLOOP_PROD_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
  return extractBaseUrl(cmd) ?? process.env.PLAYWRIGHT_BASE_URL ?? "";
}

function baseUrlForMeta(meta: RunMeta): string {
  if (/--prod/i.test(meta.cmd)) return process.env.PROOFLOOP_PROD_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
  return extractBaseUrl(meta.cmd) ?? process.env.PLAYWRIGHT_BASE_URL ?? "";
}

function extractBaseUrl(cmd: string): string | undefined {
  const explicit = cmd.match(/--base-url(?:=|\s+)(https?:\/\/[^\s"']+)/i);
  if (explicit) return explicit[1];
  return cmd.match(/https?:\/\/[^\s"']+/i)?.[0];
}

function renderReleaseVideo(meta: RunMeta, runDir: string): string | undefined {
  const clipsDir = join(runDir, "clips");
  mkdirSync(clipsDir, { recursive: true });
  const evalResult = readJsonIfExists<{ reward?: { total?: number; failureCategories?: string[] } }>(join(runDir, "node-eval.json"));
  const verdict = meta.passed ? "passed" : "failed";
  const lagging = evalResult?.reward?.failureCategories?.length
    ? evalResult.reward.failureCategories.join(", ")
    : meta.passed ? "none above threshold" : "see repair prompt";
  const data = {
    episodeId: `proofloop-${meta.runId}`,
    fps: 30,
    title: `${meta.suite} proof loop`,
    scenes: [
      {
        id: "task-setup",
        kind: "card",
        video: null,
        audio: null,
        durationInFrames: 105,
        narration: "Same app, same task, same verifier. The proof is generated from the recorded run.",
        card: {
          title: "Task Setup",
          bullets: [meta.suite, baseUrlForMeta(meta) || "local harness", `run ${meta.runId}`],
        },
      },
      {
        id: "agent-run",
        kind: "card",
        video: null,
        audio: null,
        durationInFrames: 105,
        narration: "The run is judged by product path evidence, not a backend-only shortcut.",
        card: {
          title: `Run ${verdict}`,
          bullets: [`score ${meta.score ?? "n/a"}/${meta.minScore ?? "n/a"}`, `duration ${formatMs(meta.durationMs)}`, `exit ${meta.exitCode}`],
        },
      },
      {
        id: "delta",
        kind: "card",
        video: null,
        audio: null,
        durationInFrames: 105,
        narration: "NodeEval turns the trace into reward fields that a router can learn from.",
        card: {
          title: "NodeEval",
          bullets: [`reward ${evalResult?.reward?.total ?? "unknown"}`, `lagging ${lagging}`, "trace, eval, contract, receipt"],
        },
      },
      {
        id: "next-action",
        kind: "card",
        video: null,
        audio: null,
        durationInFrames: 105,
        narration: "Repair and rerun are now part of the loop, with memory and regression promotion attached.",
        card: {
          title: "Next Action",
          bullets: meta.passed ? ["write memory", "promote as proof", "shadow cheaper route"] : ["repair prompt", "add regression", "rerun latest"],
        },
      },
    ],
    totalFrames: 420,
    music: null,
  };
  const episodeDataPath = join(ROOT, "remotion", "episode.data.js");
  const previousEpisodeData = existsSync(episodeDataPath) ? readFileSync(episodeDataPath, "utf8") : null;
  const output = join(clipsDir, "final-release-video.mp4");
  writeFileSync(episodeDataPath, `// AUTO-GENERATED by proofloop release-video\nexport default ${JSON.stringify(data, null, 2)};\n`, "utf8");
  const remotionCli = join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const result = spawnSync(process.execPath, [remotionCli, "render", "remotion/index.ts", "episode-short", output, "--codec=h264", "--crf=18", `--port=${process.env.REMOTION_RENDER_PORT ?? "3998"}`], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (previousEpisodeData !== null) writeFileSync(episodeDataPath, previousEpisodeData, "utf8");
  if ((result.status ?? 1) !== 0) {
    process.exitCode = result.status ?? 1;
    console.error("proofloop: release-video render failed");
    return undefined;
  }
  writeJson(join(clipsDir, "clip-manifest.json"), {
    schema: 1,
    provider: "remotion",
    status: "rendered",
    output,
    clips: [
      "01-task-setup.mp4",
      "02-model-a-run.mp4",
      "03-model-b-run.mp4",
      "04-delta.mp4",
      "05-lagging-layer.mp4",
      "final-release-video.mp4",
    ].map((name) => ({ output: join(clipsDir, name), ready: name === "final-release-video.mp4" })),
  });
  return output;
}

function locateReceipt(
  suite: string,
  suiteConfig: SuiteConfig,
  runId: string,
  runDir: string,
): { passed?: boolean; score?: number; failedGates?: string[]; receiptPaths: string[] } {
  if (suiteConfig.receiptGlob === "live-cli") {
    const liveRoot = join(PROOFLOOP_DIR, "live");
    const latestDir = latestSubdir(liveRoot);
    if (!latestDir) return { receiptPaths: [] };
    const scorecardPath = join(liveRoot, latestDir, "scorecard.md");
    if (!existsSync(scorecardPath)) return { receiptPaths: [] };
    const text = readFileSync(scorecardPath, "utf8");
    const scoreMatch = text.match(/Score:\s*(\d+)\/(\d+)/);
    const failedGates = [...text.matchAll(/^- Task "([^"]+)" (?:fail|timeout)/gm)].map((m) => m[1]);
    return {
      passed: /## Verdict: ✅ PASS/.test(text),
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
      failedGates,
      receiptPaths: [rel(scorecardPath)],
    };
  }
  if (suiteConfig.receiptGlob === "live-browser") {
    const candidateReceipts = [
      join(runDir, "verifier-receipt.json"),
      join(runDir, "fresh-room-proof.json"),
    ].filter(Boolean);
    const suiteReceiptPath = candidateReceipts.find((path) => existsSync(path));
    if (!suiteReceiptPath) return { receiptPaths: [] };
    const receipt = JSON.parse(readFileSync(suiteReceiptPath, "utf8"));
    const failedGates = ((receipt.scorer?.details?.taskProofs ?? []) as Array<{ taskId: string; passed: boolean }>)
      .filter((t) => !t.passed)
      .map((t) => t.taskId);
    return {
      passed: receipt.passed === true,
      score: receipt.scorer?.score !== undefined ? Math.round(receipt.scorer.score * 100) : undefined,
      failedGates,
      receiptPaths: [rel(suiteReceiptPath)],
    };
  }
  return { receiptPaths: [] };
}

function latestSubdir(root: string): string | undefined {
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (!dirs.length) return undefined;
  return dirs
    .map((d) => ({ name: d.name, mtime: statSync(join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function rel(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1).replace(/\\/g, "/") : path;
}

type CockpitEvent = {
  ts?: string;
  type: string;
  gate?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

type RunFlags = { prod: boolean; headed: boolean; cockpit: boolean; userEmulationStrict: boolean };

function parseRunFlags(args: string[]): RunFlags {
  const flags: RunFlags = { prod: false, headed: false, cockpit: false, userEmulationStrict: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--prod") flags.prod = true;
    if (arg === "--headed") flags.headed = true;
    if (arg === "--cockpit") flags.cockpit = true;
    if (arg === "--user-emulation" && args[i + 1] === "strict") {
      flags.userEmulationStrict = true;
      i++;
    }
    if (arg === "--user-emulation=strict") flags.userEmulationStrict = true;
  }
  return flags;
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

type CostLedger = {
  suite: string;
  runId: string;
  durationMs: number;
  exitCode: number;
  passed: boolean;
  costUsd: string;
  note: string;
};

function writeCostLedger(runDir: string, info: { suite: string; runId: string; durationMs: number; exitCode: number; passed: boolean }): void {
  const ledger: CostLedger = {
    ...info,
    costUsd: "not exposed in UI",
    note: "NodeRoom job-detail UI does not render dollar cost; cockpit signals track visible counters only.",
  };
  writeJson(join(runDir, "cost-ledger.json"), ledger);
}

type CockpitSnapshot = {
  runId: string;
  capturedAt: string;
  totalEvents: number;
  gateResults: Array<{ gate: string; status: string; ts: string }>;
  signals: Array<{ type: string; message: string; ts: string }>;
};

function writeCockpitSnapshot(runDir: string, runId: string): void {
  const eventsPath = firstExistingPath(runDir, ["cockpit-events.jsonl", "events.jsonl"]);
  if (!existsSync(eventsPath)) {
    writeJson(join(runDir, "cockpit-snapshot.json"), { runId, capturedAt: new Date().toISOString(), totalEvents: 0, gateResults: [], signals: [] } satisfies CockpitSnapshot);
    return;
  }
  const lines = readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
  const gateResults: CockpitSnapshot["gateResults"] = [];
  const signals: CockpitSnapshot["signals"] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as CockpitEvent;
      if (ev.type === "gate_pass" || ev.type === "gate_fail") {
        gateResults.push({ gate: ev.gate ?? ev.message ?? "gate", status: ev.type === "gate_pass" ? "pass" : "fail", ts: ev.ts ?? "" });
      } else {
        signals.push({ type: ev.type, message: ev.message ?? ev.type, ts: ev.ts ?? "" });
      }
    } catch {
      // skip malformed lines
    }
  }
  const snapshot: CockpitSnapshot = {
    runId,
    capturedAt: new Date().toISOString(),
    totalEvents: lines.length,
    gateResults,
    signals,
  };
  writeJson(join(runDir, "cockpit-snapshot.json"), snapshot);
}

function firstExistingPath(root: string, names: string[]): string {
  return names.map((name) => join(root, name)).find((path) => existsSync(path)) ?? join(root, names[0]);
}

main().catch((error) => {
  console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
