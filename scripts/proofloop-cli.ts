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
 *   proofloop manifest --json      print the machine-readable command surface
 *   proofloop doctor --json        verify setup without writing
 *   proofloop docs agents --dense  print compact on-demand docs
 *   proofloop init                 install .proofloop/ scaffold + config
 *   proofloop setup <adapter>      prepare local fixtures/adapters before proof runs
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
 *   proofloop charts [latest|runId] write chart-pack.json, chart-pack.html, Vega-Lite specs, data, Markdown, and SVG
 *   proofloop orchestrator dogfood   run the durable repo-level ProofLoop Orchestrator
 *   proofloop this-repo --goal "..." dogfood the current repo against a natural-language goal
 *   proofloop hooks install         wire Claude Code Stop/PreToolUse proof-gate hooks
 *   proofloop ci install github     write the proofloop-gate workflow into a target repo
 *   proofloop prompt                print the canonical one-prompt kickoff text
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
import {
  blockProofloopGoal,
  formatProofloopGoalResume,
  formatProofloopGoalStatus,
  gateProofloopGoal,
  initProofloopGoal,
  loadProofloopGoal,
  runNextProofloopGoalTask,
  superviseProofloopGoal,
  officialScoresGoalTasks,
  type ProofloopGoalTask,
} from "../src/eval/proofloopGoalSupervisor";
import { installProofloopGithubCi } from "../src/eval/proofloopCi";
import {
  formatProofloopCliManifest,
  formatProofloopDoctor,
  formatProofloopDocsTopic,
  proofloopCliManifest,
  proofloopDocsTopic,
  runProofloopDoctor,
} from "../src/eval/proofloopAgentFriendlyCli";
import {
  buildProofloopProjectManifest,
  detectUiContracts,
  formatProofloopProjectManifestDense,
  formatProofloopTemplateList,
  formatProofloopUiContract,
  formatProofloopUiList,
  listProofloopTemplates,
  syncProofloopPackageScripts,
  writeProofloopAgentDocsForTarget,
  writeProofloopLiveScaffold,
  writeProofloopProjectManifest,
  writeProofloopTemplate,
  type ProofloopAgentTarget,
} from "../src/eval/proofloopAgentFriendlyProject";
import {
  formatProofloopHooksStatus,
  installProofloopHooks,
  proofloopHooksStatus,
  proofloopKickoffPrompt,
  uninstallProofloopHooks,
} from "../src/eval/proofloopHooks";
import { writeLoopArtifactsForMeta } from "../src/eval/proofloopLoopArtifacts";
import { promoteProofloopRegression } from "../src/eval/proofloopRegressions";
import { setupProofloopAdapter, setupReceiptPath } from "../src/eval/proofloopSetup";
import {
  compareProofloopModelsForSuite,
  solveProofloopBlocker,
  solveProofloopBlockers,
  promoteProofloopHarnessForSuite,
  type ProofloopBlockerSolvePhase,
  type ProofloopBlockerTaskLike,
} from "../src/eval/proofloopBlockerSolver";
import { writeProofloopChartPack } from "../src/eval/proofloopChartPack";
import {
  runGraphBlastRadius,
  runGraphExportCypher,
  runGraphIndex,
  runGraphSearch,
} from "../src/eval/proofloopCodeGraph";
import {
  assertProofloopModelTracked,
  proofloopHarnessVersionForSuite,
  proofloopModelRouteForRun,
  type ProofloopHarnessVersion,
  type ProofloopModelRoute,
} from "../src/eval/proofloopModelTracking";

const ROOT = process.cwd();
const PROOFLOOP_DIR = join(ROOT, ".proofloop");
const CONFIG_PATH = join(PROOFLOOP_DIR, "config.json");
const RUNS_DIR = join(PROOFLOOP_DIR, "runs");
const MEMORY_PATH = join(PROOFLOOP_DIR, "memory.jsonl");

type SuiteConfig = {
  cmd: string;
  minScore?: number;
  kind?: "cli" | "browser";
  receiptGlob?: "live-cli" | "live-browser" | "adapter-blocker" | "external-adapter-run" | "none";
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
  model: ProofloopModelRoute;
  harnessVersion: string;
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
      cmd: "npm run benchmark:proofloop:external-adapter -- --id finch --prod --user-emulation strict",
      kind: "browser",
      receiptGlob: "external-adapter-run",
    },
    finauditing: {
      cmd: "npm run benchmark:proofloop:external-adapter -- --id finauditing --prod --user-emulation strict",
      kind: "browser",
      receiptGlob: "external-adapter-run",
    },
    workstreambench: {
      cmd: "npm run benchmark:proofloop:external-adapter -- --id workstreambench --prod --user-emulation strict",
      kind: "browser",
      receiptGlob: "external-adapter-run",
    },
  },
};

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "manifest":
      return cmdManifest(args);
    case "doctor":
      return cmdDoctor(args);
    case "docs":
      return cmdDocs(args);
    case "init":
      return cmdInit(args);
    case "template":
      return cmdTemplate(args);
    case "workflow":
      return cmdWorkflow(args);
    case "ui":
      return cmdUi(args);
    case "status":
      return cmdStatus();
    case "run": {
      const suiteArg = args[0]?.startsWith("--") ? undefined : args[0];
      const flagArgs = suiteArg ? args.slice(1) : args;
      return cmdRun(suiteArg, flagArgs);
    }
    case "show":
      return cmdShow(args[0]);
    case "report":
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
      void cmdSetup(args);
      return;
    case "solve-blockers":
      return cmdSolveBlockers(args);
    case "blocker":
      return cmdBlocker(args);
    case "compare-models":
      return cmdCompareModels(args);
    case "promote-harness":
      return cmdPromoteHarness(args);
    case "charts":
      return cmdCharts(args);
    case "orchestrator":
      return cmdOrchestrator(args);
    case "this-repo":
      return cmdThisRepo(args);
    case "graph":
      return cmdGraph(args);
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
    case "hooks":
      return cmdHooks(args);
    case "ci":
      return cmdCi(args);
    case "prompt":
      return cmdPrompt();
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
      "  manifest [--json]    print the machine-readable command surface",
      "  doctor [--json|--dense] read-only setup check for agent adoption",
      "  docs [topic] [--json|--dense] print compact CLI docs",
      "  init [--features agents,live,github] [--agent auto|all|codex|claude|cursor|windsurf] install scaffold, manifest, scripts, docs",
      "  template --list|<id> --write write workflow/rubric/red-team starters",
      "  workflow --list [--dense] list generated proof workflows",
      "  ui list|contract|component <name> [--dense] print agent-readable UI contracts",
      "  status               is the repo currently proven or broken?",
      "  run [suite]          run a suite, record a proof run",
      "  show [runId|latest]  print a proof run's scorecard/receipt",
      "  report [runId|latest] alias for show",
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
      "  solve-blockers --goal <goal-id> convert blocked lanes into scaffold/model-run artifacts",
      "  blocker list|solve|research|scaffold|run inspect or advance one blocker",
      "  compare-models <suite> write a model matrix for a suite",
      "  promote-harness <suite> write/update harness-version.json for a suite",
      "  storybook [runId]    write trace-storybook.html",
      "  repair [runId]       write/print repair-prompt.md",
      "  storyboard [runId]   write storyboard.json/md",
      "  clips [runId]        write clip manifest and social assets",
      "  release-video [runId] render final-release-video.mp4 from trace cards",
      "  lagging [runId]      classify lagging layers",
      "  router suggest [runId] write route-plan suggestion",
      "  charts [latest|runId] write chart-pack.json, chart-pack.html, Vega-Lite specs, data, Markdown, and SVG",
      "  orchestrator dogfood run the durable repo-level ProofLoop Orchestrator",
      "  this-repo --goal <text> dogfood this repo with ProofLoop Orchestrator",
      "  graph index|blast-radius|search|export-cypher  code-graph substrate (repair blast radius)",
      "  promote <runId>      turn a failure into a tracked regression",
      "  export rl [runId]    export a run as agentic-RL trace data",
      "  hooks install|uninstall|status [--worker claude-code] [--local] [--dir <path>] wire Claude Code Stop + PreToolUse proof-gate hooks",
      "  ci install github [--dir <path>] [--goal <goal-id>] write .github/workflows/proofloop-gate.yml into a target repo",
      "  prompt               print the canonical one-prompt Proof Loop kickoff text",
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

function cmdManifest(args: string[]): void {
  const manifest = proofloopCliManifest();
  const project = buildProofloopProjectManifest(ROOT);
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify({ ...manifest, project }, null, 2));
    return;
  }
  if (hasFlag(args, "--dense")) {
    console.log(formatProofloopProjectManifestDense(project));
    return;
  }
  console.log(formatProofloopCliManifest(manifest, { dense: hasFlag(args, "--dense") }));
}

function cmdDoctor(args: string[]): void {
  const report = runProofloopDoctor(ROOT);
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatProofloopDoctor(report, { dense: hasFlag(args, "--dense") }));
  }
  if (report.status === "fail") process.exitCode = 1;
}

function cmdDocs(args: string[]): void {
  const topic = args.find((arg) => !arg.startsWith("--")) ?? "getting-started";
  const doc = proofloopDocsTopic(topic);
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }
  console.log(formatProofloopDocsTopic(doc, { dense: hasFlag(args, "--dense") }));
}

function cmdInit(args: string[]): void {
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
  const scripts = syncProofloopPackageScripts(ROOT);
  if (scripts.changed) {
    if (scripts.added.length) console.log(`proofloop: added package script(s): ${scripts.added.join(", ")}`);
    if (scripts.updated.length) console.log(`proofloop: updated package script(s): ${scripts.updated.join(", ")}`);
  } else {
    console.log("proofloop: package proofloop scripts already up to date");
  }
  const shouldWriteAgentDocs = initFeatures(args).has("agents") || args.includes("--live") || args.some((arg) => arg.startsWith("--agent"));
  if (shouldWriteAgentDocs) {
    const target = initAgentTarget(args);
    if (!target) return;
    const results = writeProofloopAgentDocsForTarget({
      root: ROOT,
      target,
      agentDocsPath: optionValueFromArgs(args, "--agent-docs-path"),
    });
    for (const result of results) {
      console.log(`proofloop: ${result.changed ? "wrote" : "kept"} ${rel(result.path)} (${result.agent} agent docs)`);
    }
  }
  if (initFeatures(args).has("github")) {
    const result = installProofloopGithubCi({ root: ROOT, sourceRoot: ROOT, goalId: "default" });
    console.log(`proofloop: wrote ${rel(result.workflowPath)} (gate goal: ${result.goalId})`);
  }
  if (initFeatures(args).has("live") || args.includes("--live")) {
    const scaffold = writeProofloopLiveScaffold(ROOT);
    for (const path of scaffold.written) console.log(`proofloop: wrote ${path}`);
    for (const path of scaffold.skipped) console.log(`proofloop: kept ${path}`);
  }
  const manifest = writeProofloopProjectManifest(ROOT);
  console.log(`proofloop: ${manifest.changed ? "wrote" : "kept"} ${rel(manifest.path)}`);
  console.log("proofloop: initialized. Run `proofloop status` next.");
}

function cmdTemplate(args: string[]): void {
  const id = args.find((arg) => !arg.startsWith("--"));
  if (!id || id === "list" || args.includes("--list")) {
    if (args.includes("--json")) console.log(JSON.stringify(listProofloopTemplates(), null, 2));
    else console.log(formatProofloopTemplateList({ dense: args.includes("--dense") }));
    return;
  }
  if (!args.includes("--write")) {
    const template = listProofloopTemplates().find((candidate) => candidate.id === id);
    if (!template) return usage(`unknown template: ${id}`);
    console.log(args.includes("--json") ? JSON.stringify(template, null, 2) : `${template.id}: ${template.description}`);
    return;
  }
  try {
    const result = writeProofloopTemplate(ROOT, id, { force: args.includes("--force") });
    for (const path of result.written) console.log(`proofloop: wrote ${path}`);
    for (const path of result.skipped) console.log(`proofloop: kept ${path}`);
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdWorkflow(args: string[]): void {
  const manifest = buildProofloopProjectManifest(ROOT);
  if (args.includes("--json")) {
    console.log(JSON.stringify(manifest.workflows, null, 2));
    return;
  }
  if (args.includes("--dense")) {
    console.log(manifest.workflows.join("\n") || "no-workflows");
    return;
  }
  console.log(["ProofLoop workflows", "", ...manifest.workflows.map((path) => `- ${path}`)].join("\n"));
}

function cmdUi(args: string[]): void {
  const [subcommand, maybeComponent] = args.filter((arg) => !arg.startsWith("--"));
  const dense = args.includes("--dense");
  if (args.includes("--json")) {
    const contracts = detectUiContracts(ROOT);
    const filtered = subcommand === "component" && maybeComponent
      ? contracts.filter((contract) => contract.id.toLowerCase().includes(maybeComponent.toLowerCase()))
      : contracts;
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }
  if (!subcommand || subcommand === "list") {
    console.log(formatProofloopUiList(ROOT, { dense }));
    return;
  }
  if (subcommand === "contract") {
    console.log(formatProofloopUiContract(ROOT, { dense }));
    return;
  }
  if (subcommand === "component") {
    if (!maybeComponent) return usage("proofloop ui component requires <name>");
    console.log(formatProofloopUiContract(ROOT, { dense, component: maybeComponent }));
    return;
  }
  return usage(`unknown ui command: ${subcommand}`);
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
  const suiteConfig = config.suites[suite];
  if (!suiteConfig) {
    console.error(`proofloop: unknown suite "${suite}". Known: ${Object.keys(config.suites).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const flags = parseRunFlags(extraArgs);
  const runId = `${suite}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const cmd = flags.cockpit ? `${suiteConfig.cmd} --cockpit` : suiteConfig.cmd;
  const recordedCmd = [cmd, flags.prod ? "--prod" : "", flags.headed ? "--headed" : "", flags.userEmulationStrict ? "--user-emulation strict" : ""]
    .filter(Boolean)
    .join(" ");
  const env: Record<string, string> = { ...process.env, PROOFLOOP_RUN_ID: runId };
  if (flags.prod) env.VITE_CONVEX_URL = process.env.CONVEX_PROD_URL ?? "";
  if (flags.cockpit) env.PROOFLOOP_COCKPIT = "1";
  if (flags.userEmulationStrict) env.PROOFLOOP_USER_EMULATION = "strict";

  console.log(`proofloop: running suite "${suite}"${flags.prod ? " --prod" : ""}${flags.headed ? " --headed" : ""}${flags.cockpit ? " --cockpit" : ""}${flags.userEmulationStrict ? " --user-emulation strict" : ""}`);
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

  const receipt = locateReceipt(suite, suiteConfig, runId, started);
  const receiptRequired = suiteConfig.receiptGlob !== undefined && suiteConfig.receiptGlob !== "none";
  const receiptFresh = !receiptRequired || receipt.receiptPaths.length > 0;
  const model = proofloopModelRouteForRun({ suite, cmd: recordedCmd, env });
  const modelTrackingFailures = assertProofloopModelTracked(model);
  const harnessVersion = proofloopHarnessVersionForSuite(ROOT, suite);
  const failedGates = [...(receipt.failedGates ?? []), ...modelTrackingFailures];
  const passed = exitCode === 0 && receiptFresh && (receipt.passed ?? true) && modelTrackingFailures.length === 0;

  writeCostLedger(runDir, { suite, runId, durationMs, exitCode, passed, model, harnessVersion });
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
    failedGates,
    receiptPaths: receipt.receiptPaths,
    model,
    harnessVersion: harnessVersion.harnessVersion,
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
  writeChartsAfterCommand(runId, join(".proofloop", "runs", runId, "charts"), { writeRunArtifacts: false });
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
  const [adapterId, ...rest] = args;
  if (!adapterId) return usage("usage: proofloop setup <adapter>");
  try {
    const receipt = await setupProofloopAdapter({
      adapterId,
      projectRoot: ROOT,
      fixtureRoot: optionValueFromArgs(rest, "--root"),
      dataset: optionValueFromArgs(rest, "--dataset"),
      revision: optionValueFromArgs(rest, "--revision"),
      limit: numberOption(rest, "--limit"),
      maxBytes: numberOption(rest, "--max-bytes"),
      taskId: optionValueFromArgs(rest, "--task-id"),
      allowDownload: hasFlag(rest, "--allow-download"),
    });
    const receiptPath = setupReceiptPath(ROOT, adapterId);
    console.log(`proofloop setup: ${adapterId} ${receipt.status}`);
    console.log(`proofloop setup: receipt ${rel(receiptPath)}`);
    console.log(`proofloop setup: next ${receipt.nextCommands[0]}`);
    if (hasFlag(rest, "--strict") && receipt.status !== "ready") process.exitCode = 1;
  } catch (error) {
    console.error(`proofloop setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdSolveBlockers(args: string[]): void {
  const goalId = optionValueFromArgs(args, "--goal") ?? args[0] ?? "official-scores";
  const phase = (optionValueFromArgs(args, "--phase") as ProofloopBlockerSolvePhase | undefined) ?? "solve";
  try {
    const blockers = blockerTasksForGoal(goalId);
    const receipts = solveProofloopBlockers({ root: ROOT, tasks: blockers, phase });
    console.log(`proofloop: solved ${receipts.length} blocker lane(s) for goal ${goalId}`);
    for (const receipt of receipts) {
      console.log(`  - ${receipt.blockerId}: ${receipt.status} (${receipt.classes.join(", ") || "unclassified"})`);
      console.log(`    analysis: ${receipt.artifacts["blocker-analysis.json"]}`);
      if (receipt.nextCommands[0]) console.log(`    next: ${receipt.nextCommands[0]}`);
    }
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdBlocker(args: string[]): void {
  const [subcommand, blockerId, ...rest] = args;
  if (!subcommand) return usage("proofloop blocker requires list|solve|research|scaffold|run");
  const goalId = optionValueFromArgs(rest, "--goal") ?? optionValueFromArgs(args, "--goal") ?? "official-scores";
  try {
    if (subcommand === "list") {
      const blockers = blockerTasksForGoal(goalId);
      for (const task of blockers) {
        const receipt = solveProofloopBlocker({ root: ROOT, task, phase: "research" });
        console.log(`${task.id}\t${receipt.status}\t${receipt.classes.join(",")}\t${receipt.artifacts["blocker-analysis.json"]}`);
      }
      return;
    }
    if (!blockerId) return usage(`proofloop blocker ${subcommand} requires <blocker-id>`);
    if (subcommand === "solve") {
      const blockers = blockerTasksForGoal(goalId);
      const exactTask = blockers.find((candidate) => candidate.id === blockerId || candidate.id.includes(blockerId));
      if (!exactTask && goalCanBeLoaded(blockerId)) {
        const receipts = solveProofloopBlockers({ root: ROOT, tasks: blockerTasksForGoal(blockerId), phase: "solve" });
        console.log(`proofloop: solved ${receipts.length} blocker lane(s) for goal ${blockerId}`);
        for (const receipt of receipts) {
          console.log(`  - ${receipt.blockerId}: ${receipt.status}`);
          console.log(`    analysis: ${receipt.artifacts["blocker-analysis.json"]}`);
        }
        return;
      }
    }
    const task = findBlockerTask(goalId, blockerId);
    const phase = phaseForBlockerCommand(subcommand);
    const receipt = solveProofloopBlocker({ root: ROOT, task, phase });
    console.log(`${receipt.blockerId}: ${receipt.status}`);
    console.log(`analysis: ${receipt.artifacts["blocker-analysis.json"]}`);
    console.log(`models: ${receipt.models.map((model) => model.id).join(", ")}`);
    if (receipt.nextCommands.length) {
      console.log("next:");
      for (const command of receipt.nextCommands) console.log(`  ${command}`);
    }
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdCompareModels(args: string[]): void {
  const suite = args[0];
  if (!suite) return usage("proofloop compare-models requires <suite>");
  try {
    const path = compareProofloopModelsForSuite({ root: ROOT, suite });
    console.log(`proofloop: model matrix ${rel(path)}`);
    writeChartsAfterCommand("latest");
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdPromoteHarness(args: string[]): void {
  const suite = args[0];
  if (!suite) return usage("proofloop promote-harness requires <suite>");
  try {
    const path = promoteProofloopHarnessForSuite({ root: ROOT, suite });
    console.log(`proofloop: harness version ${rel(path)}`);
    writeChartsAfterCommand("latest");
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdCharts(args: string[]): void {
  const target = args[0] && !args[0].startsWith("--") ? args[0] : "latest";
  const outDir = optionValueFromArgs(args, "--out-dir") ?? "docs/eval/proofloop-charts";
  const strict = hasFlag(args, "--strict");
  try {
    const result = writeProofloopChartPack({ root: ROOT, target, outDir, generatedAt: new Date().toISOString() });
    console.log(`proofloop: chart pack ${result.paths.json}`);
    console.log(`proofloop: chart report ${result.paths.markdown}`);
    console.log(`proofloop: chart html ${result.paths.html}`);
    for (const [name, path] of Object.entries(result.paths.specs)) {
      console.log(`proofloop: chart spec ${name} ${path}`);
    }
    for (const [name, path] of Object.entries(result.paths.svgs)) {
      console.log(`proofloop: chart ${name} ${path}`);
    }
    for (const artifact of result.paths.runArtifacts) {
      console.log(`proofloop: run chart pack ${artifact.json}`);
      console.log(`proofloop: run chart html ${artifact.html}`);
    }
    if (strict && (!result.validation.ok || result.pack.summary.workflowItems === 0)) {
      for (const error of result.validation.errors) console.error(`proofloop: chart validation ${error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdGraph(args: string[]): void {
  const [subcommand, ...rest] = args;
  if (!subcommand) return usage("proofloop graph requires index|blast-radius|search|export-cypher");
  try {
    if (subcommand === "index") return runGraphIndex(ROOT, rest);
    if (subcommand === "blast-radius") return runGraphBlastRadius(ROOT, rest);
    if (subcommand === "search") return runGraphSearch(ROOT, rest);
    if (subcommand === "export-cypher") return runGraphExportCypher(ROOT, rest);
    return usage(`unknown graph command: ${subcommand}`);
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function writeChartsAfterCommand(target: string, outDir?: string, options: { writeRunArtifacts?: boolean } = {}): void {
  try {
    const result = writeProofloopChartPack({
      root: ROOT,
      target,
      ...(outDir ? { outDir } : {}),
      generatedAt: new Date().toISOString(),
      ...(options.writeRunArtifacts === undefined ? {} : { writeRunArtifacts: options.writeRunArtifacts }),
    });
    console.log(`proofloop: charts -- ${result.paths.json}`);
    console.log(`proofloop: chart html -- ${result.paths.html}`);
    if (!result.validation.ok) {
      for (const error of result.validation.errors) console.error(`proofloop: chart validation ${error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`proofloop: chart generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
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
  const promotion = promoteProofloopRegression(ROOT, {
    suite: meta.suite,
    runId: meta.runId,
    failedGates: meta.failedGates ?? [],
    score: meta.score,
    minScore: meta.minScore,
    durationMs: meta.durationMs,
  });
  // "human" is deliberate: this command only runs when a person invokes `proofloop promote`,
  // never automatically from inside a repair pass, so it records a human-outside-the-loop decision.
  console.log(`proofloop: promoted ${meta.runId} to ${promotion.relativePath} (${promotion.alreadyPromoted ? "already tracked" : "new regression"})`);
  if (promotion.migratedLegacyCount > 0) {
    console.log(`  migrated legacy local regressions: ${promotion.migratedLegacyCount}`);
  }
  console.log(`  suite:       ${meta.suite}`);
  console.log(`  failed gates: ${meta.failedGates?.length ?? 0}`);
  if (meta.failedGates?.length) {
    for (const gate of meta.failedGates) console.log(`    - ${gate}`);
  }
  console.log(`  score:       ${meta.score ?? "n/a"}/${meta.minScore ?? "n/a"}`);
  console.log(`  duration:    ${formatMs(meta.durationMs)}`);
  console.log(`  total tracked regressions: ${promotion.entries.length}`);
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
    writeChartsAfterCommand("latest");
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
    writeChartsAfterCommand("latest");
    if (state.status === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdGoalResume(args: string[]): void {
  const goalId = optionValueFromArgs(args, "--goal") ?? args.find((arg) => !arg.startsWith("--")) ?? "default";
  if (!goalId) return usage("proofloop resume requires --goal <goal-id>");
  try {
    const state = loadProofloopGoal(goalId, { root: ROOT });
    if (args.includes("--dense")) {
      const pending = state.tasks.find((task) => task.status === "pending");
      const blocked = state.tasks.filter((task) => task.status === "blocked_external" || task.status === "needs_scaffold_or_run");
      console.log([
        `goal=${state.goalId}`,
        `status=${state.status}`,
        `ledger=${state.ledgerPath}`,
        `next=${pending?.id ?? "none"}`,
        `run=${pending?.command ?? pending?.resumeCommand ?? "none"}`,
        `blocked=${blocked.map((task) => task.id).join(",") || "none"}`,
      ].join("\n"));
      return;
    }
    console.log(formatProofloopGoalResume(state));
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdOrchestrator(args: string[]): void {
  const forwarded = args.length ? args : ["run"];
  const result = spawnSync("npx", ["tsx", "scripts/proofloop-orchestrator.ts", ...forwarded], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  process.exitCode = result.status ?? 1;
}

function cmdThisRepo(args: string[]): void {
  const positionalGoal = args.filter((arg) => !arg.startsWith("--") && arg !== "live").join(" ").trim();
  const goalText = optionValueFromArgs(args, "--goal") ?? optionValueFromArgs(args, "--objective") ?? positionalGoal;
  const maxSteps = optionValueFromArgs(args, "--max-steps");
  const forwarded = [
    "dogfood",
    "--goal",
    "official-scores",
    "--objective",
    goalText || "Make this repo real, tested, shipped, and externally blocked only with proof.",
    "--execute-safe",
    "--fresh-template",
    ...(maxSteps ? ["--max-steps", maxSteps] : []),
  ];
  if (args.includes("--dry-run")) forwarded.push("--dry-run");
  if (args.includes("--allow-worker-launch")) forwarded.push("--allow-worker-launch");
  const result = spawnSync("npx", ["tsx", "scripts/proofloop-orchestrator.ts", ...forwarded], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  process.exitCode = result.status ?? 1;
}

function cmdHooks(args: string[]): void {
  const [subcommand, ...rest] = args;
  const root = optionValueFromArgs(rest, "--dir") ?? ROOT;
  try {
    if (subcommand === "install") {
      const maxStopBlocksRaw = optionValueFromArgs(rest, "--max-stop-blocks");
      const result = installProofloopHooks({
        root,
        local: rest.includes("--local"),
        worker: optionValueFromArgs(rest, "--worker") ?? "claude-code",
        goalId: optionValueFromArgs(rest, "--goal"),
        gateCommand: optionValueFromArgs(rest, "--gate-command"),
        maxStopBlocks: maxStopBlocksRaw ? Number(maxStopBlocksRaw) : undefined,
      });
      console.log(`proofloop: wrote ${result.stopGatePath}`);
      console.log(`proofloop: wrote ${result.preToolUseGuardPath}`);
      console.log(`proofloop: wrote ${result.configPath}`);
      console.log(
        `proofloop: ${result.addedStopHook || result.addedPreToolUseHook ? "merged hook entries into" : "hook entries already present in"} ${result.settingsPath}`,
      );
      console.log("proofloop: Claude Code will now refuse to stop while the proof gate is failing.");
      return;
    }
    if (subcommand === "uninstall") {
      const result = uninstallProofloopHooks({ root, purge: rest.includes("--purge") });
      console.log(`proofloop: removed ${result.removedEntries} hook entr${result.removedEntries === 1 ? "y" : "ies"}${result.cleanedSettingsPaths.length ? ` from ${result.cleanedSettingsPaths.join(", ")}` : ""}`);
      if (result.purgedHooksDir) console.log("proofloop: purged .proofloop/hooks/");
      return;
    }
    if (subcommand === "status") {
      console.log(formatProofloopHooksStatus(proofloopHooksStatus({ root })));
      return;
    }
    return usage(`unknown hooks command: ${subcommand ?? ""}`);
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdCi(args: string[]): void {
  const [subcommand, provider, ...rest] = args;
  if (subcommand !== "install" || provider !== "github") {
    return usage(`unknown ci command: ${args.join(" ")} (expected: ci install github)`);
  }
  try {
    const result = installProofloopGithubCi({
      root: optionValueFromArgs(rest, "--dir") ?? ROOT,
      sourceRoot: ROOT,
      goalId: optionValueFromArgs(rest, "--goal"),
    });
    console.log(`proofloop: wrote ${result.workflowPath} (gate goal: ${result.goalId})`);
  } catch (error) {
    console.error(`proofloop: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function cmdPrompt(): void {
  console.log(proofloopKickoffPrompt());
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

function blockerTasksForGoal(goalId: string): ProofloopBlockerTaskLike[] {
  let tasks: ProofloopGoalTask[];
  try {
    tasks = loadProofloopGoal(goalId, { root: ROOT }).tasks;
  } catch {
    if (goalId !== "official-scores") throw new Error(`Goal does not exist: ${goalId}`);
    tasks = officialScoresGoalTasks();
  }
  return tasks
    .filter((task) => task.kind === "external_blocker" || task.status === "blocked_external" || task.status === "needs_scaffold_or_run")
    .map((task) => ({
      id: task.id,
      title: task.title,
      blockers: task.blockers,
      evidence: task.evidence,
      resumeCommand: task.resumeCommand,
    }));
}

function goalCanBeLoaded(goalId: string): boolean {
  if (goalId === "official-scores") return true;
  const safeGoalId = goalId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return existsSync(join(PROOFLOOP_DIR, "goals", safeGoalId, "state.json"));
}

function findBlockerTask(goalId: string, blockerId: string): ProofloopBlockerTaskLike {
  const blockers = blockerTasksForGoal(goalId);
  const task = blockers.find((candidate) => candidate.id === blockerId || candidate.id.includes(blockerId));
  if (!task) throw new Error(`Blocker not found: ${blockerId}`);
  return task;
}

function phaseForBlockerCommand(subcommand: string): ProofloopBlockerSolvePhase {
  if (subcommand === "research") return "research";
  if (subcommand === "scaffold") return "scaffold";
  if (subcommand === "run") return "run";
  if (subcommand === "solve") return "solve";
  throw new Error(`unknown blocker command: ${subcommand}`);
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
  startedMs: number,
): { passed?: boolean; score?: number; failedGates?: string[]; receiptPaths: string[] } {
  if (suiteConfig.receiptGlob === "live-cli") {
    const liveRoot = join(PROOFLOOP_DIR, "live");
    const latestDir = latestSubdir(liveRoot);
    if (!latestDir) return { receiptPaths: [] };
    const scorecardPath = join(liveRoot, latestDir, "scorecard.md");
    if (!existsSync(scorecardPath)) return { receiptPaths: [] };
    if (!fileIsFresh(scorecardPath, startedMs)) return { passed: false, failedGates: ["stale_receipt"], receiptPaths: [] };
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
    const suiteReceiptPath = resolve(ROOT, liveBrowserReceiptPathForSuite(suite));
    if (!existsSync(suiteReceiptPath)) return { receiptPaths: [] };
    if (!fileIsFresh(suiteReceiptPath, startedMs)) return { passed: false, failedGates: ["stale_receipt"], receiptPaths: [] };
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
    if (!fileIsFresh(receiptPath, startedMs)) return { passed: false, failedGates: ["stale_receipt"], receiptPaths: [] };
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { status?: string; blockers?: string[] };
    return {
      passed: receipt.status === "ready",
      failedGates: receipt.status === "ready" ? [] : receipt.blockers ?? [`${suite}: blocked_external`],
      receiptPaths: [rel(receiptPath)],
    };
  }
  if (suiteConfig.receiptGlob === "external-adapter-run") {
    const receiptPath = resolve(ROOT, "docs", "eval", "proofloop-external-adapter-runs", `${suite}.json`);
    if (!existsSync(receiptPath)) return { receiptPaths: [] };
    if (!fileIsFresh(receiptPath, startedMs)) return { passed: false, failedGates: ["stale_receipt"], receiptPaths: [] };
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { status?: string; failedGates?: string[] };
    return {
      passed: receipt.status === "passed",
      failedGates: receipt.status === "passed" ? [] : receipt.failedGates ?? [`${suite}: external adapter product proof failed`],
      receiptPaths: [rel(receiptPath)],
    };
  }
  return { receiptPaths: [] };
}

function liveBrowserReceiptPathForSuite(suite: string): string {
  if (suite === "bankertoolbench") return "docs/eval/bankertoolbench-live-room-proof.json";
  return "docs/eval/proofloop-live-room-proof.json";
}

function fileIsFresh(path: string, startedMs: number): boolean {
  return statSync(path).mtimeMs >= startedMs - 1_000;
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

function initFeatures(args: string[]): Set<string> {
  const values = optionValuesFromArgs(args, "--features")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const features = new Set(values);
  if (features.has("all")) features.add("agents");
  return features;
}

function initAgentTarget(args: string[]): ProofloopAgentTarget | undefined {
  const value = optionValueFromArgs(args, "--agent") ?? "codex";
  if (value === "auto" || value === "all" || value === "codex" || value === "claude" || value === "cursor" || value === "windsurf") return value;
  console.error(`proofloop: unsupported --agent ${value}. Expected auto, all, codex, claude, cursor, or windsurf.`);
  process.exitCode = 1;
  return undefined;
}

function numberOption(args: string[], name: string): number | undefined {
  const value = optionValueFromArgs(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  model: ProofloopModelRoute;
  harnessVersion: ProofloopHarnessVersion;
};

function writeCostLedger(
  runDir: string,
  info: {
    suite: string;
    runId: string;
    durationMs: number;
    exitCode: number;
    passed: boolean;
    model: ProofloopModelRoute;
    harnessVersion: ProofloopHarnessVersion;
  },
): void {
  const ledger: CostLedger = {
    ...info,
    costUsd: String(info.model.costUsd),
    note: "Model identity and harness version are always serialized; token/cost values remain zero unless the route reports usage.",
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
  const eventsPath = join(runDir, "events.jsonl");
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

main();
