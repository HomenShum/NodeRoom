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

function main(): void {
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

main();
