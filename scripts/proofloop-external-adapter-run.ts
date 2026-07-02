import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildExternalAdapterBlockerReceipt } from "../src/eval/proofloopAdapterBlockers";
import { readBenchmarkAdapter, type BenchmarkAdapterId } from "../src/eval/proofloopBenchmarkAdapters";
import { externalBenchmarkLocalTaskIds, loadExternalBenchmarkLocalTasks } from "../proofloop/benchmarks/common/local-tasks";

type ExternalAdapterProductProofReceipt = {
  schema: "proofloop-external-adapter-product-proof-v1";
  adapterId: BenchmarkAdapterId;
  status: "passed" | "failed";
  runId: string;
  generatedAt: string;
  localAdapterOnly: true;
  officialScoreClaim: false;
  taskCount: number;
  baseUrl: string;
  scenario: string;
  outputDir: string;
  exitCode: number;
  evidence: string[];
  failedGates: string[];
  browserProof?: {
    url?: string;
    title?: string;
    visibleSignals?: Record<string, unknown>;
    problemCounts: {
      pageErrors: number;
      consoleProblems: number;
      requestFailures: number;
      badResponses: number;
    };
  };
  officialSemanticScore: {
    status: "blocked_external";
    blockers: string[];
    verifierCommand: string;
  };
};

const args = process.argv.slice(2);
const selectedIds = optionValues("--id") as BenchmarkAdapterId[];
const ids = selectedIds.length ? selectedIds : externalBenchmarkLocalTaskIds();
const prod = args.includes("--prod");
const userEmulation = optionValue("--user-emulation") ?? (args.includes("--user-emulation=strict") ? "strict" : "standard");
const cockpit = args.includes("--cockpit");
const jsonOutDir = optionValue("--json-out-dir") ?? "docs/eval/proofloop-external-adapter-runs";
let exitCode = 0;

for (const id of ids) {
  const status = runAdapter(id);
  if (status !== 0) exitCode = status;
}

process.exitCode = exitCode;

function runAdapter(id: BenchmarkAdapterId): number {
  if (id === "bankertoolbench") {
    console.error("proofloop external adapter runner is for non-BTB adapters only.");
    return 1;
  }
  const adapter = readBenchmarkAdapter(id);
  const tasks = loadExternalBenchmarkLocalTasks(id);
  const runId = process.env.PROOFLOOP_RUN_ID ?? `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputDir = resolve(".proofloop", "runs", runId, "external-adapter", id);
  mkdirSync(outputDir, { recursive: true });

  const baseUrl = prod
    ? process.env.PROOFLOOP_PROD_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live"
    : process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
  const env = {
    ...process.env,
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_REUSE_SERVER: prod ? "1" : process.env.PLAYWRIGHT_REUSE_SERVER ?? "0",
    PROOFLOOP_OUTPUT_DIR: outputDir,
    PROOFLOOP_RUN_ID: runId,
    PROOFLOOP_EXTERNAL_ADAPTER_ID: id,
    PROOFLOOP_USER_EMULATION: userEmulation,
    PROOFLOOP_COCKPIT: cockpit ? "1" : process.env.PROOFLOOP_COCKPIT ?? "",
  };
  const result = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--config",
      "playwright.proofloop.config.ts",
      adapter.browserScenario,
      "--reporter=line",
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
      env,
    },
  );

  const runStatus = result.status ?? 1;
  const blockerReceipt = buildExternalAdapterBlockerReceipt({ id });
  const browserProofPath = join(outputDir, "browser-proof.json");
  const taskManifestPath = join(outputDir, "local-task-manifest.json");
  const visualProofPath = join(outputDir, "visual-proof.png");
  const evidence = [
    adapter.taskLoader,
    adapter.browserScenario,
    browserProofPath,
    taskManifestPath,
    visualProofPath,
  ].filter((path) => path.includes(".proofloop") ? existsSync(path) : true).map(rel);

  const browserProof = readJsonIfExists<{
    url?: string;
    title?: string;
    visibleSignals?: Record<string, unknown>;
    pageErrors?: unknown[];
    consoleProblems?: unknown[];
    requestFailures?: unknown[];
    badResponses?: unknown[];
  }>(browserProofPath);
  const failedGates = runStatus === 0
    ? []
    : [
      `${id}: browser scenario failed`,
      ...(browserProof?.pageErrors?.length ? [`${id}: page errors captured`] : []),
      ...(browserProof?.consoleProblems?.length ? [`${id}: console warnings/errors captured`] : []),
      ...(browserProof?.requestFailures?.length ? [`${id}: request failures captured`] : []),
      ...(browserProof?.badResponses?.length ? [`${id}: HTTP >=400 responses captured`] : []),
    ];

  const receipt: ExternalAdapterProductProofReceipt = {
    schema: "proofloop-external-adapter-product-proof-v1",
    adapterId: id,
    status: runStatus === 0 ? "passed" : "failed",
    runId,
    generatedAt: new Date().toISOString(),
    localAdapterOnly: true,
    officialScoreClaim: false,
    taskCount: tasks.length,
    baseUrl,
    scenario: adapter.browserScenario,
    outputDir: rel(outputDir),
    exitCode: runStatus,
    evidence,
    failedGates,
    browserProof: browserProof
      ? {
        url: browserProof.url,
        title: browserProof.title,
        visibleSignals: browserProof.visibleSignals,
        problemCounts: {
          pageErrors: browserProof.pageErrors?.length ?? 0,
          consoleProblems: browserProof.consoleProblems?.length ?? 0,
          requestFailures: browserProof.requestFailures?.length ?? 0,
          badResponses: browserProof.badResponses?.length ?? 0,
        },
      }
      : undefined,
    officialSemanticScore: {
      status: "blocked_external",
      blockers: blockerReceipt.blockers,
      verifierCommand: adapter.verifierCommand,
    },
  };

  const outPath = join(jsonOutDir, `${id}.json`);
  writeJson(outPath, receipt);
  console.log(`${id}: local product proof ${receipt.status} (${tasks.length} task(s)) -> ${outPath}`);
  return runStatus;
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
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

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function rel(path: string): string {
  const absolute = resolve(path);
  const root = process.cwd();
  return absolute.startsWith(root) ? absolute.slice(root.length + 1).replace(/\\/g, "/") : path.replace(/\\/g, "/");
}
