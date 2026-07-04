import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildExternalAdapterBlockerReceipt } from "../src/eval/proofloopAdapterBlockers";
import { readBenchmarkAdapter, type BenchmarkAdapterId } from "../src/eval/proofloopBenchmarkAdapters";
import { externalBenchmarkLocalTaskIds, loadExternalBenchmarkLocalTasks } from "../proofloop/benchmarks/common/local-tasks";

type ExternalAdapterLiveRoomProofReceipt = {
  schema: "proofloop-external-adapter-live-room-proof-v1";
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
    roomUrl?: string;
    roomId?: string;
    model?: {
      provider?: string;
      mode?: string;
      policy?: string;
      runtimeProfile?: string;
      realUserMode?: boolean;
      measuredCostUsd?: number | null;
      measuredTokensIn?: number | null;
      measuredTokensOut?: number | null;
    };
    problemCounts: {
      pageErrors: number;
      consoleProblems: number;
      requestFailures: number;
      badResponses: number;
    };
    taskProofs?: Array<{
      taskId?: string;
      completionVisible?: boolean;
      streamingVisible?: boolean;
      jobStatusVisible?: boolean;
      roomTraceVisible?: boolean;
      durationMs?: number;
    }>;
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
const realUserMode = args.includes("--real-user") || userEmulation === "real";
const cockpit = args.includes("--cockpit");
const jsonOutDir = optionValue("--json-out-dir") ?? "docs/eval/proofloop-external-adapter-live-room-runs";
const modelMode = optionValue("--model-mode") ?? process.env.BENCH_AGENT_MODEL_MODE ?? "specific";
const modelPolicy = optionValue("--model") ?? optionValue("--model-policy") ?? process.env.BENCH_AGENT_MODEL_POLICY ?? "deepseek/deepseek-v4-pro";
const requireFinalPhrase = realUserMode || args.includes("--allow-terminal-without-phrase") ? "0" : process.env.PROOFLOOP_EXTERNAL_REQUIRE_FINAL_PHRASE ?? "1";
let exitCode = 0;

for (const id of ids) {
  const status = runAdapter(id);
  if (status !== 0) exitCode = status;
}

process.exitCode = exitCode;

function runAdapter(id: BenchmarkAdapterId): number {
  if (id === "bankertoolbench") {
    console.error("proofloop external adapter live-room runner is for non-BTB adapters only.");
    return 1;
  }
  const adapter = readBenchmarkAdapter(id);
  const tasks = loadExternalBenchmarkLocalTasks(id);
  const runId = process.env.PROOFLOOP_RUN_ID ?? `${id}-live-room-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputDir = resolve(".proofloop", "runs", runId, "external-adapter-live-room", id);
  mkdirSync(outputDir, { recursive: true });

  const baseUrl = prod
    ? process.env.PROOFLOOP_PROD_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live"
    : process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
  const env = {
    ...process.env,
    BENCH_BASE_URL: baseUrl,
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_REUSE_SERVER: prod ? "1" : process.env.PLAYWRIGHT_REUSE_SERVER ?? "0",
    PROOFLOOP_OUTPUT_DIR: outputDir,
    PROOFLOOP_RUN_ID: runId,
    PROOFLOOP_EXTERNAL_ADAPTER_ID: id,
    PROOFLOOP_USER_EMULATION: userEmulation,
    PROOFLOOP_COCKPIT: cockpit ? "1" : process.env.PROOFLOOP_COCKPIT ?? "",
    PROOFLOOP_EXTERNAL_REQUIRE_FINAL_PHRASE: requireFinalPhrase,
    PROOFLOOP_REAL_USER_MODE: realUserMode ? "1" : process.env.PROOFLOOP_REAL_USER_MODE ?? "",
    PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: realUserMode ? "" : process.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE ?? "benchmark_completion",
    PROOFLOOP_FOCUS_MODE: realUserMode ? "0" : process.env.PROOFLOOP_FOCUS_MODE ?? "",
    BENCH_AGENT_MODEL_MODE: modelMode,
    BENCH_AGENT_MODEL_POLICY: modelPolicy,
  };
  const scenario = "proofloop/benchmarks/common/live-room-scenario.spec.ts";
  const result = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--config",
      "playwright.proofloop.config.ts",
      scenario,
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
  const browserProof = readJsonIfExists<{
    roomUrl?: string;
    roomId?: string;
    model?: ExternalAdapterLiveRoomProofReceipt["browserProof"] extends infer T ? T extends { model?: infer M } ? M : never : never;
    problemCounts?: {
      pageErrors?: number;
      consoleProblems?: number;
      requestFailures?: number;
      badResponses?: number;
    };
    taskProofs?: ExternalAdapterLiveRoomProofReceipt["browserProof"]["taskProofs"];
  }>(browserProofPath);
  const problemCounts = {
    pageErrors: browserProof?.problemCounts?.pageErrors ?? 0,
    consoleProblems: browserProof?.problemCounts?.consoleProblems ?? 0,
    requestFailures: browserProof?.problemCounts?.requestFailures ?? 0,
    badResponses: browserProof?.problemCounts?.badResponses ?? 0,
  };
  const failedGates = runStatus === 0
    ? []
    : [
      `${id}: live-room browser scenario failed`,
      ...Object.entries(problemCounts).filter(([, count]) => count > 0).map(([gate, count]) => `${id}: ${gate}=${count}`),
    ];
  const evidenceCandidates = [
    adapter.taskLoader,
    scenario,
    join(outputDir, "live-user-contract.json"),
    join(outputDir, "node-trace-v2.json"),
    join(outputDir, "node-eval.json"),
    join(outputDir, "scorecard.md"),
    join(outputDir, "cost-ledger.json"),
    join(outputDir, "verifier-receipt.json"),
    join(outputDir, "official-scorer-receipt.json"),
    browserProofPath,
    join(outputDir, "local-task-manifest.json"),
    join(outputDir, "visual-proof.png"),
  ];
  const evidence = evidenceCandidates.filter((path) => path.includes(".proofloop") ? existsSync(path) : true).map(rel);

  const receipt: ExternalAdapterLiveRoomProofReceipt = {
    schema: "proofloop-external-adapter-live-room-proof-v1",
    adapterId: id,
    status: runStatus === 0 ? "passed" : "failed",
    runId,
    generatedAt: new Date().toISOString(),
    localAdapterOnly: true,
    officialScoreClaim: false,
    taskCount: tasks.length,
    baseUrl,
    scenario,
    outputDir: rel(outputDir),
    exitCode: runStatus,
    evidence,
    failedGates,
    browserProof: browserProof
      ? {
        roomUrl: browserProof.roomUrl,
        roomId: browserProof.roomId,
        model: browserProof.model,
        problemCounts,
        taskProofs: browserProof.taskProofs,
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
  console.log(`${id}: live-room product proof ${receipt.status} (${tasks.length} task(s)) -> ${outPath}`);
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
