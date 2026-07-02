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
 *   proofloop memory init           create local-first SQLite/FTS memory
 *   proofloop memory compact latest compact a proof run into recall memory
 *   proofloop memory search <query> search local compacted memory
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
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scanBankerToolBenchBundle } from "../src/eval/bankerToolBenchAdapter";
import { buildBankerToolBenchManifestLock } from "../src/eval/bankerToolBenchManifestLock";
import {
  BENCHMARK_ADAPTER_IDS,
  readBenchmarkAdapter,
  type BenchmarkAdapterId,
  type ProofloopBenchmarkAdapter,
} from "../src/eval/proofloopBenchmarkAdapters";
import {
  blockProofloopGoal,
  formatProofloopGoalResume,
  formatProofloopGoalStatus,
  gateProofloopGoal,
  initProofloopGoal,
  loadProofloopGoal,
  runNextProofloopGoalTask,
  superviseProofloopGoal,
} from "../src/eval/proofloopGoalSupervisor";
import { writeLoopArtifactsForMeta } from "../src/eval/proofloopLoopArtifacts";

const ROOT = process.cwd();
const PROOFLOOP_DIR = join(ROOT, ".proofloop");
const CONFIG_PATH = join(PROOFLOOP_DIR, "config.json");
const RUNS_DIR = join(PROOFLOOP_DIR, "runs");
const MEMORY_PATH = join(PROOFLOOP_DIR, "memory.jsonl");
const SETUP_DIR = join(PROOFLOOP_DIR, "setup");
const REGRESSIONS_PATH = join(PROOFLOOP_DIR, "regressions.json");

type SuiteConfig = {
  cmd: string;
  minScore?: number;
  kind?: "cli" | "browser";
  receiptGlob?: "live-cli" | "live-browser" | "adapter-blocker" | "none";
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
    finch: {
      cmd: "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
      kind: "cli",
      receiptGlob: "adapter-blocker",
    },
    finauditing: {
      cmd: "npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict",
      kind: "cli",
      receiptGlob: "adapter-blocker",
    },
    workstreambench: {
      cmd: "npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict",
      kind: "cli",
      receiptGlob: "adapter-blocker",
    },
  },
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
      return usage(`unknown mem target: ${args[0] ?? ""}`);
    case "memory":
      return cmdMemory(args);
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
    case "goal":
      return cmdGoal(args);
    case "gate":
      return cmdGoalGate(args);
    case "supervise":
      return cmdGoalSupervise(args);
    case "resume":
      return cmdGoalResume(args);
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
      "  memory init          create local-first SQLite/FTS memory",
      "  memory compact latest compact a proof run into recall memory",
      "  memory search <query> search local compacted memory",
      "  memory show <id>     print one compacted memory episode",
      "  memory export --redacted write a redacted compacted-memory export",
      "  memory doctor        verify local memory/index health",
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
      "  goal init <goal-id> [--template official-scores] create a long-running proof ledger",
      "  goal status <goal-id> show persisted goal state",
      "  goal next <goal-id>   run or classify the next unfinished goal task",
      "  goal block <goal-id> --task <id> --reason <text> [--resume-command <cmd>] add an external blocker",
      "  gate --goal <goal-id> pass only when the persisted goal ledger passed",
      "  supervise --goal <goal-id> [--max-steps N] continue until passed or terminal blocker",
      "  resume --goal <goal-id> print the next resume action and blockers",
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
    const added = mergeDefaultSuites(existing);
    if (added > 0) {
      writeJson(CONFIG_PATH, existing);
      console.log(`proofloop: merged ${added} new suite(s) into ${rel(CONFIG_PATH)}`);
    } else {
      console.log(`proofloop: ${rel(CONFIG_PATH)} already up to date`);
    }
  }
  if (!existsSync(MEMORY_PATH)) {
    writeFileSync(MEMORY_PATH, "");
    console.log(`proofloop: wrote ${rel(MEMORY_PATH)}`);
  }
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

  const cmd = flags.cockpit ? `${suiteConfig.cmd} --cockpit` : suiteConfig.cmd;
  const recordedCmd = [cmd, flags.prod ? "--prod" : "", flags.headed ? "--headed" : "", flags.userEmulationStrict ? "--user-emulation strict" : ""]
    .filter(Boolean)
    .join(" ");
  const env: Record<string, string> = { ...process.env, PROOFLOOP_RUN_ID: runId, PROOFLOOP_RUN_DIR: runDir };
  if (flags.prod) env.VITE_CONVEX_URL = process.env.CONVEX_PROD_URL ?? "";
  if (flags.cockpit) env.PROOFLOOP_COCKPIT = "1";
  if (flags.userEmulationStrict) env.PROOFLOOP_USER_EMULATION = "strict";
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

  const receipt = locateReceipt(suite, suiteConfig, runId);
  const officialScorer = writeOfficialScorerReceipt({ adapter, suite, runDir });
  const passed = exitCode === 0 && (receipt.passed ?? true) && officialScorer.passed;

  writeCostLedger(runDir, { suite, runId, durationMs, exitCode, passed });
  writeCockpitSnapshot(runDir, runId);

  const meta: RunMeta = {
    runId,
    suite,
    cmd: recordedCmd,
    startedAt,
    finishedAt,
    durationMs,
    exitCode,
    passed,
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
  console.log("");
  console.log(`proofloop: run recorded -- ${runId} (${passed ? "PASS" : "FAIL"})`);
  console.log(`proofloop: node trace -- ${rel(paths.nodeTracePath)}`);
  console.log(`proofloop: node eval  -- ${rel(paths.nodeEvalPath)}`);
  console.log(`proofloop: contract   -- ${rel(paths.liveUserContractPath)}`);
  console.log(`proofloop: official scorer -- ${rel(join(runDir, "official-scorer-receipt.json"))}`);
  if (!passed) process.exitCode = 1;
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
  const meta = requireRun(runIdArg);
  if (!meta) return;
  const paths = ensureLoopArtifacts(meta, { memoryPath: MEMORY_PATH });
  console.log(`proofloop: wrote memory entry to ${rel(paths.memoryPath ?? MEMORY_PATH)}`);
}

function cmdMemory(args: string[]): void {
  const result = spawnSync("node", ["--no-warnings", "scripts/proofloop-memory.mjs", ...args], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exitCode = result.status ?? 1;
}

async function cmdSetup(args: string[]): Promise<void> {
  const [target, ...rest] = args;
  if (!target) return usage("usage: proofloop setup <adapter>");
  if (target === "bankertoolbench") return cmdSetupBankerToolBench(rest);
  return cmdSetupUnsupportedAdapter(target);
}

async function cmdSetupBankerToolBench(args: string[]): Promise<void> {
  const root = resolve(ROOT, optionValueFromArgs(args, "--root") ?? ".tmp/official-benchmarks/btb-fixture");
  const dataset = optionValueFromArgs(args, "--dataset") ?? "handshake-ai-research/bankertoolbench";
  const revision = optionValueFromArgs(args, "--revision") ?? "main";
  const limit = Number(optionValueFromArgs(args, "--limit") ?? 1);
  const maxBytes = Number(optionValueFromArgs(args, "--max-bytes") ?? 250_000_000);
  const taskId = optionValueFromArgs(args, "--task-id");
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
  console.log("proofloop setup: next npm run proofloop -- run bankertoolbench");
  if (verifyOfficialContract) runBtbOfficialContractPreflight(revision, manifestLockfile);
}

function cmdSetupUnsupportedAdapter(adapterId: string): void {
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
  return await response.json() as HfTreeEntry[];
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

function cmdGoal(args: string[]): void {
  const [subcommand, goalId, ...rest] = args;
  if (!subcommand) return usage("missing goal command");
  if (!goalId) return usage(`proofloop goal ${subcommand} requires <goal-id>`);
  try {
    if (subcommand === "init") {
      const template = optionValueFromArgs(rest, "--template") === "official-scores" ? "official-scores" : undefined;
      const overwrite = rest.includes("--force") || rest.includes("--overwrite");
      const state = initProofloopGoal({ root: ROOT, goalId, template, overwrite });
      console.log(formatProofloopGoalStatus(state));
      return;
    }
    if (subcommand === "status") {
      console.log(formatProofloopGoalStatus(loadProofloopGoal(goalId, { root: ROOT })));
      return;
    }
    if (subcommand === "next") {
      const result = runNextProofloopGoalTask(goalId, { root: ROOT });
      if (result.task) {
        console.log(`${result.task.id}: ${result.task.status}`);
        if (result.task.stdoutTail) console.log(result.task.stdoutTail);
        if (result.task.stderrTail) console.error(result.task.stderrTail);
      }
      console.log(formatProofloopGoalStatus(result.state));
      if (result.state.status === "failed") process.exitCode = 1;
      return;
    }
    if (subcommand === "block") {
      const taskId = optionValueFromArgs(rest, "--task");
      const reason = optionValueFromArgs(rest, "--reason");
      if (!taskId || !reason) return usage("proofloop goal block requires --task <id> and --reason <text>");
      const evidence = optionValuesFromArgs(rest, "--evidence");
      const resumeCommand = optionValueFromArgs(rest, "--resume-command");
      const state = blockProofloopGoal(goalId, { taskId, reason, evidence, resumeCommand }, { root: ROOT });
      console.log(formatProofloopGoalStatus(state));
      return;
    }
    return usage(`unknown goal command: ${subcommand}`);
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdGoalGate(args: string[]): void {
  const goalId = optionValueFromArgs(args, "--goal") ?? args[0];
  if (!goalId) return usage("proofloop gate requires --goal <goal-id>");
  try {
    const state = gateProofloopGoal(goalId, { root: ROOT });
    console.log(formatProofloopGoalStatus(state));
    if (state.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdGoalSupervise(args: string[]): void {
  const goalId = optionValueFromArgs(args, "--goal") ?? args[0];
  if (!goalId) return usage("proofloop supervise requires --goal <goal-id>");
  const maxStepsRaw = optionValueFromArgs(args, "--max-steps");
  const maxSteps = maxStepsRaw ? Number(maxStepsRaw) : undefined;
  try {
    const state = superviseProofloopGoal(goalId, { root: ROOT, maxSteps });
    console.log(formatProofloopGoalStatus(state));
    if (state.status === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdGoalResume(args: string[]): void {
  const goalId = optionValueFromArgs(args, "--goal") ?? args[0];
  if (!goalId) return usage("proofloop resume requires --goal <goal-id>");
  try {
    console.log(formatProofloopGoalResume(loadProofloopGoal(goalId, { root: ROOT })));
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------

function loadConfig(): ProofloopConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.warn(`proofloop: ${rel(CONFIG_PATH)} not found -- run \`proofloop init\` first. Using defaults.`);
    return DEFAULT_CONFIG;
  }
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ProofloopConfig;
  mergeDefaultSuites(config);
  return config;
}

function mergeDefaultSuites(config: ProofloopConfig): number {
  const knownSuites = new Set(Object.keys(config.suites));
  let added = 0;
  for (const [name, cfg] of Object.entries(DEFAULT_CONFIG.suites)) {
    if (!knownSuites.has(name)) {
      config.suites[name] = cfg;
      added++;
    }
  }
  return added;
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

function readBenchmarkAdapterIfExists(suite: string): ProofloopBenchmarkAdapter | undefined {
  if (!BENCHMARK_ADAPTER_IDS.includes(suite as BenchmarkAdapterId)) return undefined;
  try {
    return readBenchmarkAdapter(suite as BenchmarkAdapterId, ROOT);
  } catch {
    return undefined;
  }
}

function suiteConfigForAdapter(adapter: ProofloopBenchmarkAdapter | undefined): SuiteConfig | undefined {
  if (!adapter) return undefined;
  return {
    cmd: `npm run proofloop:live:adapter -- ${adapter.id}`,
    minScore: 100,
    kind: "browser",
    receiptGlob: "live-browser",
  };
}

function knownSuites(config: ProofloopConfig): string[] {
  return [...new Set([...Object.keys(config.suites), ...BENCHMARK_ADAPTER_IDS])].sort();
}

function forceOfficialAdapterFlags(flags: RunFlags, adapter: ProofloopBenchmarkAdapter | undefined): RunFlags {
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
  adapter: ProofloopBenchmarkAdapter | undefined,
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
  adapter: ProofloopBenchmarkAdapter | undefined;
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

function officialSourceReceiptPassed(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== "object") return true;
  const record = receipt as { pass?: unknown; passed?: unknown; status?: unknown };
  if (typeof record.pass === "boolean") return record.pass;
  if (typeof record.passed === "boolean") return record.passed;
  if (typeof record.status === "string") return /pass|ready|green/i.test(record.status);
  return true;
}

function quoteShellArg(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
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
    const suiteReceiptPath = resolve(ROOT, "docs/eval/proofloop-live-room-proof.json");
    if (!existsSync(suiteReceiptPath)) return { receiptPaths: [] };
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
  if (suiteConfig.receiptGlob === "adapter-blocker") {
    const receiptPath = resolve(ROOT, "docs", "eval", "proofloop-adapter-blockers", `${suite}.json`);
    if (!existsSync(receiptPath)) return { receiptPaths: [] };
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { status?: string; blockers?: string[] };
    return {
      passed: receipt.status === "ready",
      failedGates: receipt.status === "ready" ? [] : receipt.blockers ?? [`${suite}: blocked_external`],
      receiptPaths: [rel(receiptPath)],
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

function optionValueFromArgs(args: string[], name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValuesFromArgs(args: string[], name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i++;
      }
    }
  }
  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

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
  const canonicalEventsPath = join(runDir, "cockpit-events.jsonl");
  const legacyEventsPath = join(runDir, "events.jsonl");
  const eventsPath = existsSync(canonicalEventsPath) || !existsSync(legacyEventsPath) ? canonicalEventsPath : legacyEventsPath;
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

main().catch((error) => {
  console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
