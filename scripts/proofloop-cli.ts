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
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const PROOFLOOP_DIR = join(ROOT, ".proofloop");
const CONFIG_PATH = join(PROOFLOOP_DIR, "config.json");
const RUNS_DIR = join(PROOFLOOP_DIR, "runs");
const MEMORY_PATH = join(PROOFLOOP_DIR, "memory.jsonl");
const REGRESSIONS_PATH = join(PROOFLOOP_DIR, "regressions.json");

type SuiteConfig = {
  cmd: string;
  minScore?: number;
  kind?: "cli" | "browser";
  receiptGlob?: "live-cli" | "live-browser" | "none";
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
  },
};

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init":
      return cmdInit();
    case "status":
      return cmdStatus();
    case "run":
      return cmdRun(args[0]);
    case "show":
      return cmdShow(args[0]);
    case "log":
      return cmdLog();
    case "diff":
      return cmdDiff(args[0], args[1]);
    case "replay":
      return cmdReplay(args[0]);
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
    console.log(`proofloop: ${rel(CONFIG_PATH)} already exists`);
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

function cmdRun(suiteArg: string | undefined): void {
  const config = loadConfig();
  const suite = suiteArg ?? config.defaultSuite;
  const suiteConfig = config.suites[suite];
  if (!suiteConfig) {
    console.error(`proofloop: unknown suite "${suite}". Known: ${Object.keys(config.suites).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const runId = `${suite}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  console.log(`proofloop: running suite "${suite}"`);
  console.log(`proofloop: ${suiteConfig.cmd}`);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(suiteConfig.cmd, {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
    env: { ...process.env, PROOFLOOP_RUN_ID: runId },
  });
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const exitCode = result.status ?? 1;

  const receipt = locateReceipt(suite, suiteConfig, runId);
  const passed = exitCode === 0 && (receipt.passed ?? true);

  const meta: RunMeta = {
    runId,
    suite,
    cmd: suiteConfig.cmd,
    startedAt,
    finishedAt,
    durationMs,
    exitCode,
    passed,
    score: receipt.score,
    minScore: suiteConfig.minScore,
    failedGates: receipt.failedGates,
    receiptPaths: receipt.receiptPaths,
  };
  writeJson(join(runDir, "meta.json"), meta);
  console.log("");
  console.log(`proofloop: run recorded -- ${runId} (${passed ? "PASS" : "FAIL"})`);
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
  console.log(`Score: ${a.score ?? "n/a"} -> ${b.score ?? "n/a"}`);
  console.log(`Passed: ${a.passed} -> ${b.passed}`);
  const gatesA = new Set(a.failedGates ?? []);
  const gatesB = new Set(b.failedGates ?? []);
  const fixed = [...gatesA].filter((g) => !gatesB.has(g));
  const regressed = [...gatesB].filter((g) => !gatesA.has(g));
  if (fixed.length) {
    console.log("");
    console.log("Fixed:");
    for (const gate of fixed) console.log(`  - ${gate}`);
  }
  if (regressed.length) {
    console.log("");
    console.log("Regressed:");
    for (const gate of regressed) console.log(`  - ${gate}`);
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
  console.log(`proofloop: replaying ${meta.runId} -- ${meta.cmd}`);
  cmdRun(meta.suite);
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

function resolveRun(runIdArg: string | undefined): RunMeta | undefined {
  const runs = listRuns().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!runIdArg || runIdArg === "latest") return runs[0];
  return runs.find((r) => r.runId === runIdArg);
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
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rel(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1).replace(/\\/g, "/") : path;
}

main();
