import "./benchmark/loadEnv";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type StepReceipt = {
  name: string;
  command: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
  exitCode?: number | null;
  reason?: string;
  receiptPath: string;
  stdoutTail?: string;
  stderrTail?: string;
};

type SuiteReceipt = {
  schema: "proofloop-live-prod-v1";
  runId: string;
  generatedAt: string;
  baseUrl: string;
  receiptRoot: string;
  passed: boolean;
  steps: StepReceipt[];
};

const runId = process.env.PROOFLOOP_RUN_ID ?? `live-prod-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
const baseUrl = process.env.PROOFLOOP_LIVE_PROD_BASE_URL ?? process.env.BENCH_BASE_URL ?? "https://noderoom.live";
const root = resolve(process.env.PROOFLOOP_LIVE_PROD_RECEIPT_ROOT ?? `docs/eval/live-prod/${runId}`);
const browserRoot = resolve(root, "browser-receipts");
const continueOnFailure = process.argv.includes("--continue-on-failure") || process.env.PROOFLOOP_LIVE_PROD_CONTINUE_ON_FAILURE === "1";
const skipBtb = process.argv.includes("--skip-btb") || process.env.PROOFLOOP_LIVE_PROD_SKIP_BTB === "1";
const providerPreflightKeySource = process.env.PROOFLOOP_PROVIDER_PREFLIGHT_KEY_SOURCE ?? "convex-env";
const providerPreflightConvexDeployment =
  process.env.PROOFLOOP_PROVIDER_PREFLIGHT_CONVEX_DEPLOYMENT
  ?? parseConvexDeployment(process.env.CONVEX_DEPLOYMENT)
  ?? "zealous-goshawk-766";

mkdirSync(root, { recursive: true });
mkdirSync(browserRoot, { recursive: true });

const commonEnv = {
  PROOFLOOP_RUN_ID: runId,
  BENCH_BASE_URL: baseUrl,
  E2E_LIVE_APP: "1",
  PLAYWRIGHT_REUSE_SERVER: "1",
  PLAYWRIGHT_BASE_URL: baseUrl,
  PROOFLOOP_COCKPIT: process.env.PROOFLOOP_COCKPIT ?? "1",
};

const steps: StepReceipt[] = [];
let suiteWritten = false;

process.on("exit", () => {
  if (!suiteWritten && steps.length > 0) writeSuitePartial();
});
process.on("uncaughtException", (error) => {
  const now = new Date().toISOString();
  const receiptPath = resolve(root, "live-prod-wrapper-crash.json");
  const receipt: StepReceipt = {
    name: "live_prod_wrapper",
    command: "tsx scripts/proofloop-live-prod.ts",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    status: "failed",
    reason: error instanceof Error ? error.stack ?? error.message : String(error),
    receiptPath,
  };
  writeJson(receiptPath, receipt);
  steps.push(receipt);
  writeSuitePartial();
  process.exit(1);
});

await runStep("qa_story_prod", "npm run qa:story:prod", {});
await runStep(
  "live_starter_room",
  "npm run proofloop:live:starter",
  {
    ...commonEnv,
    PROOFLOOP_LIVE_STARTER_RECEIPT_ROOT: resolve(browserRoot, "live-starter-room"),
  },
);
await runStep("underwriting_live", "npm run proofloop:live:underwriting", {});
await runStep("underwriting_verify", "npm run proofloop:live:underwriting:verify", {});
await runStep(
  "uploaded_artifact_rendering",
  "npx playwright test --config playwright.real-flow.config.ts e2e/uploaded-artifact-live-rendering.spec.ts",
  commonEnv,
);
await runStep(
  "public_nodeagent",
  "npx playwright test --config playwright.real-flow.config.ts e2e/public-nodeagent-real-room.spec.ts",
  commonEnv,
);
await runStep(
  "generic_proofloop_browser",
  "npm run proofloop:live:browser",
  {
    ...commonEnv,
    PROOFLOOP_LIVE_BROWSER: "1",
    PROOFLOOP_TASK_ID: "variance-calc",
    PROOFLOOP_TEST_TIMEOUT_MS: process.env.PROOFLOOP_GENERIC_BROWSER_TEST_TIMEOUT_MS ?? "180000",
    PROOFLOOP_AGENT_TIMEOUT_MS: process.env.PROOFLOOP_GENERIC_BROWSER_AGENT_TIMEOUT_MS ?? "45000",
    PROOFLOOP_SUITE_PROOF_PATH: resolve(browserRoot, "proofloop-live-room-proof.json"),
    PROOFLOOP_FRESH_ROOM_ROOT: resolve(browserRoot, "fresh-room"),
  },
);

const providerReceiptPath = resolve(root, "provider-route-preflight.json");
await runStep(
  "provider_preflight",
  [
    "npm run proofloop:provider:preflight --",
    `--min-balance-usd ${process.env.PROOFLOOP_PROVIDER_PREFLIGHT_MIN_USD ?? "1"}`,
    `--json-out ${quote(providerReceiptPath)}`,
    `--key-source ${providerPreflightKeySource}`,
    providerPreflightKeySource === "convex-env" ? `--convex-deployment ${providerPreflightConvexDeployment}` : "",
    "--soft",
  ].filter(Boolean).join(" "),
  {},
);
const providerOk = readJson(providerReceiptPath)?.ok === true;
if (skipBtb) {
  writeSkipped("bankertoolbench_live", "BTB skipped by --skip-btb/PROOFLOOP_LIVE_PROD_SKIP_BTB", "btb-skipped.json");
} else if (!providerOk) {
  writeSkipped("bankertoolbench_live", "BTB skipped because provider preflight did not pass", "btb-provider-preflight-skipped.json");
} else {
  await runStep(
    "bankertoolbench_live",
    "npm run proofloop:live:btb",
    {
      ...commonEnv,
      BTB_LIVE_ROOM_PROOF_PATH: resolve(browserRoot, "bankertoolbench-live-room-proof.json"),
      BTB_PACKAGE_MANIFEST_PATH: resolve(root, "bankertoolbench-package-manifest.json"),
    },
  );
}

const suite: SuiteReceipt = {
  schema: "proofloop-live-prod-v1",
  runId,
  generatedAt: new Date().toISOString(),
  baseUrl,
  receiptRoot: root,
  passed: steps.every((step) => step.status === "passed" || step.status === "skipped"),
  steps,
};
const suitePath = resolve(root, "suite-receipt.json");
writeFileSync(suitePath, `${JSON.stringify(suite, null, 2)}\n`);
suiteWritten = true;
console.log(`wrote ${suitePath}`);
if (!suite.passed) process.exit(1);

async function runStep(name: string, command: string, env: Record<string, string>): Promise<void> {
  const started = Date.now();
  const receiptPath = resolve(root, `${name}.json`);
  console.log(`[proofloop-live-prod] ${name}: ${command}`);
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: true,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const completed = Date.now();
  const receipt: StepReceipt = {
    name,
    command,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    reason: result.error ? result.error.message : undefined,
    receiptPath,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
  writeJson(receiptPath, receipt);
  steps.push(receipt);
  if (receipt.status === "failed" && !continueOnFailure) {
    writeSuitePartial();
    process.exit(result.status ?? 1);
  }
}

function writeSkipped(name: string, reason: string, filename: string): void {
  const now = new Date().toISOString();
  const receiptPath = resolve(root, filename);
  const receipt: StepReceipt = {
    name,
    command: "(skipped)",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    status: "skipped",
    reason,
    receiptPath,
  };
  writeJson(receiptPath, receipt);
  steps.push(receipt);
}

function writeSuitePartial(): void {
  const suitePath = resolve(root, "suite-receipt.partial.json");
  writeJson(suitePath, {
    schema: "proofloop-live-prod-v1",
    runId,
    generatedAt: new Date().toISOString(),
    baseUrl,
    receiptRoot: root,
    passed: false,
    steps,
  });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`[proofloop-live-prod] receipt: ${path}`);
}

function readJson(path: string): any {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function tail(value: string | Buffer | null | undefined): string {
  return String(value ?? "").slice(-8_000);
}

function quote(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function parseConvexDeployment(value: string | undefined): string | undefined {
  const clean = value?.split("#")[0]?.trim();
  if (!clean) return undefined;
  return clean.includes(":") ? clean.split(":").at(-1)?.trim() : clean;
}
