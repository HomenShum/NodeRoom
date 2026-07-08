import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setupProofloopAdapter } from "../src/eval/proofloopSetup";

const suite = process.argv[2];
const passthrough = process.argv.slice(3);
const env: NodeJS.ProcessEnv = { ...process.env };
let args: string[];

if (suite === "bankertoolbench") {
  env.BTB_LIVE_ROOM_E2E = "1";
  env.BTB_UI_BUNDLE_ROOT = env.BTB_UI_BUNDLE_ROOT ?? ".tmp/official-benchmarks/btb-fixture";
  env.BTB_UI_VERIFIER_COMMAND = env.BTB_UI_VERIFIER_COMMAND ?? "npm run benchmark:bankertoolbench:proof";
  env.BENCH_BASE_URL = env.BENCH_BASE_URL ?? "http://localhost:5273";
  env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL ?? env.BENCH_BASE_URL;
  const taskId = flagValue("--task-id") ?? env.BTB_UI_TASK_ID;
  if (taskId) env.BTB_UI_TASK_ID = taskId;
  await ensureBankerToolBenchFixture(env);
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.real-flow.config.ts",
    "e2e/benchmark-ui-bankertoolbench.spec.ts",
    "--headed",
  ];
} else if (suite === "spreadsheetbench-v1" || suite === "spreadsheetbench-v2") {
  env.SPREADSHEETBENCH_TRACK = suite === "spreadsheetbench-v1" ? "spreadsheetbench-v1" : "spreadsheetbench-v2";
  env.SPREADSHEETBENCH_STAGE_ROOT = env.SPREADSHEETBENCH_STAGE_ROOT
    ?? (suite === "spreadsheetbench-v1" ? ".tmp/official-benchmarks/staged-v1-912" : ".tmp/official-benchmarks/staged-v2-full");
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.real-flow.config.ts",
    "e2e/benchmark-ui-spreadsheetbench-generic.spec.ts",
    "--headed",
  ];
} else if (suite === "browser") {
  env.PROOFLOOP_LIVE_BROWSER = "1";
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.proofloop.config.ts",
    "proofloop/live-browser-proof.spec.ts",
    "--headed",
  ];
} else if (suite === "accounting-browser" || suite === "notion-browser") {
  const isAccounting = suite === "accounting-browser";
  env.PROOFLOOP_LIVE_BROWSER = "1";
  env.PROOFLOOP_TASKS_JSON = env.PROOFLOOP_TASKS_JSON
    ?? (isAccounting ? "proofloop/accounting/live.accounting.config.json" : "proofloop/notion/live.notion.config.json");
  env.PROOFLOOP_REAL_USER_MODE = "1";
  env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE = env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE ?? "";
  env.PLAYWRIGHT_REUSE_SERVER = env.PLAYWRIGHT_REUSE_SERVER ?? "1";
  if (passthrough.includes("--prod")) {
    env.BENCH_BASE_URL = env.BENCH_BASE_URL ?? "https://noderoom.live";
    env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
  }
  const taskId = flagValue("--task-id");
  if (taskId) env.PROOFLOOP_TASK_IDS = taskId;
  const model = flagValue("--model");
  if (model) {
    env.BENCH_AGENT_MODEL_MODE = "specific";
    env.BENCH_AGENT_MODEL_POLICY = model;
  }
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.proofloop.config.ts",
    "proofloop/live-browser-proof.spec.ts",
    "--headed",
  ];
} else if (suite === "proximitty-browser" || suite === "multi-user-conflict") {
  const isProximitty = suite === "proximitty-browser";
  env.PROOFLOOP_LIVE_BROWSER = "1";
  env.PROOFLOOP_REAL_USER_MODE = "1";
  env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE = env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE ?? "";
  env.PLAYWRIGHT_REUSE_SERVER = env.PLAYWRIGHT_REUSE_SERVER ?? "1";
  if (passthrough.includes("--prod")) {
    env.BENCH_BASE_URL = env.BENCH_BASE_URL ?? "https://noderoom.live";
    env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
  }
  const taskId = flagValue("--task-id") ?? flagValue("--scenario");
  if (taskId) env.PROOFLOOP_TASK_IDS = taskId;
  const model = flagValue("--model");
  if (model) {
    env.BENCH_AGENT_MODEL_MODE = "specific";
    env.BENCH_AGENT_MODEL_POLICY = model;
  }
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.proofloop.config.ts",
    isProximitty
      ? "proofloop/benchmarks/proximitty/live-room-scenario.spec.ts"
      : "proofloop/benchmarks/noderoom-multi-user/live-room-scenario.spec.ts",
    "--headed",
  ];
} else if (suite === "adapter") {
  const adapterId = process.argv[3];
  if (!adapterId) {
    console.error("Missing benchmark adapter id.");
    process.exit(1);
  }
  const adapterPath = resolve(process.cwd(), "proofloop", "benchmarks", adapterId, "adapter.json");
  if (!existsSync(adapterPath)) {
    console.error(`Benchmark adapter does not exist: ${adapterPath}`);
    process.exit(1);
  }
  const adapter = JSON.parse(readFileSync(adapterPath, "utf8")) as { browserScenario?: string };
  if (!adapter.browserScenario) {
    console.error(`Benchmark adapter ${adapterId} does not declare browserScenario.`);
    process.exit(1);
  }
  const scenarioPath = resolve(process.cwd(), adapter.browserScenario);
  if (!existsSync(scenarioPath)) {
    console.error(`Benchmark adapter ${adapterId} browserScenario does not exist: ${scenarioPath}`);
    process.exit(1);
  }
  env.PROOFLOOP_LIVE_BROWSER = "1";
  env.PROOFLOOP_BENCHMARK_ADAPTER = adapterId;
  args = [
    "playwright",
    "test",
    "--config",
    "playwright.proofloop.config.ts",
    adapter.browserScenario,
    "--headed",
  ];
} else {
  console.error(`Unknown proofloop live suite: ${suite ?? "(missing)"}`);
  process.exit(1);
}

const result = spawnSync("npx", args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);

function flagValue(name: string): string | undefined {
  const equals = passthrough.find((item) => item.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = passthrough.indexOf(name);
  if (index >= 0) return passthrough[index + 1];
  return undefined;
}

async function ensureBankerToolBenchFixture(runEnv: NodeJS.ProcessEnv): Promise<void> {
  const fixtureRoot = runEnv.BTB_UI_BUNDLE_ROOT ?? ".tmp/official-benchmarks/btb-fixture";
  const limit = positiveInteger(runEnv.BTB_SETUP_LIMIT) ?? 1;
  const maxBytes = positiveInteger(runEnv.BTB_SETUP_MAX_BYTES);
  const allowDownload = runEnv.BTB_SETUP_ALLOW_DOWNLOAD !== "0";
  const receipt = await setupProofloopAdapter({
    adapterId: "bankertoolbench",
    projectRoot: process.cwd(),
    fixtureRoot,
    dataset: runEnv.BTB_SETUP_DATASET,
    revision: runEnv.BTB_SETUP_REVISION,
    limit,
    maxBytes,
    taskId: runEnv.BTB_UI_TASK_ID,
    allowDownload,
  });
  if (receipt.status !== "ready") {
    console.error(`BankerToolBench fixture is not ready: ${receipt.message}`);
    console.error(`Receipt: ${resolve(process.cwd(), ".proofloop", "setup", "bankertoolbench-local-setup.json")}`);
    process.exit(1);
  }
  if (!runEnv.BTB_UI_TASK_ID && receipt.taskIds[0]) runEnv.BTB_UI_TASK_ID = receipt.taskIds[0];
  console.log([
    "BankerToolBench fixture ready:",
    `root=${receipt.root ?? fixtureRoot}`,
    `task=${runEnv.BTB_UI_TASK_ID ?? "(auto)"}`,
    `downloaded=${receipt.downloadedFiles.length}`,
  ].join(" "));
}

function positiveInteger(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) throw new Error(`Expected positive integer, got ${raw}`);
  return Math.floor(value);
}
