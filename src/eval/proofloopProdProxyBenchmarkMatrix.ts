import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { scanBankerToolBenchBundle } from "./bankerToolBenchAdapter";
import {
  externalBenchmarkLocalTaskIds,
  loadExternalBenchmarkLocalTasks,
  type ExternalBenchmarkAdapterId,
} from "../../proofloop/benchmarks/common/local-tasks";
import {
  evaluateProofloopRouteIntegrity,
  routeIntegrityFailureSummary,
  type ProofloopTelemetryLike,
} from "./proofloopRouteIntegrity";

export type ProdProxyTaskStatus =
  | "prod_live_browser_passed"
  | "local_live_browser_only"
  | "ready_for_prod_browser_run"
  | "blocked_missing_prod_browser_adapter"
  | "blocked_non_browser_runner";

export type ProdProxyTask = {
  familyId: string;
  taskId: string;
  title: string;
  status: ProdProxyTaskStatus;
  prodLiveBrowserPassed: boolean;
  localLiveBrowserOnly: boolean;
  runner: {
    available: boolean;
    kind: "playwright_prod_browser" | "http_or_deterministic_only" | "missing";
    command?: string;
    env?: Record<string, string>;
  };
  evidence: string[];
  blockers: string[];
};

export type ProdProxyFamily = {
  id: string;
  title: string;
  taskCount: number;
  prodLiveBrowserPassed: number;
  localLiveBrowserOnly: number;
  runnableProdBrowserTasks: number;
  blockedTasks: number;
  tasks: ProdProxyTask[];
};

export type ProdProxyModelSummary = {
  modelId: string;
  prodAdapterSmokePassed: number;
  prodAdapterSmokeTotal: number;
  estimatedCostUsdAtOpenRouterList: number | null;
  measuredCostUsd: number | null;
  avgDurationMs: number | null;
};

export type ProofloopProdProxyBenchmarkMatrix = {
  schema: "proofloop-prod-proxy-benchmark-matrix-v1";
  generatedAt?: string;
  baseUrl: string;
  models: string[];
  summary: {
    uniqueTaskTargets: number;
    modelCount: number;
    matrixAttemptTargets: number;
    prodLiveBrowserVerifiedTaskTargets: number;
    localLiveBrowserOnlyTaskTargets: number;
    runnableProdBrowserTaskTargets: number;
    blockedTaskTargets: number;
    prodLiveBrowserAttemptPasses: number;
    allTasksProdVerified: boolean;
  };
  recommendation: {
    allTaskWinner: string | null;
    currentProdAdapterSmokeWinner: string | null;
    basis: string;
  };
  modelSummaries: ProdProxyModelSummary[];
  families: ProdProxyFamily[];
};

type ProxyModelSweep = {
  baseUrl?: string;
  rows?: Array<{
    modelId?: string;
    adapterId?: ExternalBenchmarkAdapterId;
    status?: "passed" | "failed";
    roomUrl?: string;
    measuredCostUsd?: number | null;
    estimatedCostUsdAtOpenRouterList?: number | null;
    durationMs?: number | null;
  }>;
  summary?: {
    byModel?: Array<{
      modelId?: string;
      passed?: number;
      total?: number;
      estimatedCostUsdAtOpenRouterList?: number | null;
      measuredCostUsd?: number | null;
      avgDurationMs?: number | null;
    }>;
  };
};

type LiveReceipt = {
  schema?: string | number;
  suite?: string;
  benchmark?: string;
  caseId?: string;
  taskId?: string;
  baseUrl?: string;
  roomUrl?: string;
  status?: string;
  passed?: boolean;
  memoryMode?: boolean;
  officialScoreClaim?: boolean;
  model?: {
    id?: string;
    requested?: string;
    resolved?: string;
    policy?: string;
    runtimeProfile?: string;
    measuredCostUsd?: number | null;
    costUsd?: number | null;
    telemetry?: Array<ProofloopTelemetryLike | { taskId?: string; telemetry?: ProofloopTelemetryLike | null } | null>;
  };
  tasks?: Array<{ id?: string; taskId?: string; passed?: boolean }>;
  taskProofs?: LiveReceiptTaskProof[];
  scorer?: {
    verdict?: string;
    details?: {
      taskProofs?: LiveReceiptTaskProof[];
    };
  };
};

type LiveConfig = {
  tasks?: Array<{ id?: string; title?: string; name?: string }>;
};

type LiveReceiptTaskProof = {
  taskId?: string;
  passed?: boolean;
  telemetry?: ProofloopTelemetryLike | null;
  agent?: {
    telemetry?: ProofloopTelemetryLike | null;
  };
};

type ProdLiveReceiptResult = {
  prodPassed: boolean;
  path: string;
  evidence: string[];
  blockers: string[];
};

type OfficialCoverageTrack = {
  id?: string;
  title?: string;
  officialExpectedTasks?: number;
  evidence?: string[];
  blockers?: string[];
};

type OfficialCoverageReport = {
  tracks?: OfficialCoverageTrack[];
};

const DEFAULT_MODELS = [
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-flash",
  "poolside/laguna-xs-2.1",
  "qwen/qwen3.7-plus",
];

export function buildProofloopProdProxyBenchmarkMatrix(args: {
  root?: string;
  generatedAt?: string;
  baseUrl?: string;
  models?: string[];
} = {}): ProofloopProdProxyBenchmarkMatrix {
  const root = args.root ?? process.cwd();
  const baseUrl = args.baseUrl ?? "https://noderoom.live";
  const official = readJson<OfficialCoverageReport>(root, "docs/eval/official-benchmark-task-coverage.json");
  const proxySweep = readJson<ProxyModelSweep>(root, "docs/eval/proofloop-proxy-model-sweep.json");
  const models = args.models?.length ? args.models : modelIdsFromSweep(proxySweep);
  const families = [
    spreadsheetFamily(root, official, {
      id: "spreadsheetbench-v1-full-912",
      title: "SpreadsheetBench V1 full 912",
      track: "spreadsheetbench-v1",
      stageRoot: ".tmp/official-benchmarks/staged-v1-912",
      command: "npm run proofloop:live:spreadsheetbench-v1",
      baseUrl,
      models,
    }),
    spreadsheetFamily(root, official, {
      id: "spreadsheetbench-v2-full-321",
      title: "SpreadsheetBench V2 full 321",
      track: "spreadsheetbench-v2",
      stageRoot: ".tmp/official-benchmarks/staged-v2-full",
      command: "npm run proofloop:live:spreadsheetbench-v2",
      baseUrl,
      models,
    }),
    bankerToolBenchFamily(root, official, baseUrl, models),
    accountingFamily(root, baseUrl),
    notionFamily(root, baseUrl),
    proximittyFamily(root, baseUrl),
    ...externalAdapterFamilies(baseUrl, models, proxySweep),
    internalFamily(official, baseUrl, root),
  ];
  const tasks = families.flatMap((family) => family.tasks);
  const prodLiveBrowserVerifiedTaskTargets = tasks.filter((task) => task.prodLiveBrowserPassed).length;
  const runnableProdBrowserTaskTargets = tasks.filter((task) => task.runner.available).length;
  const blockedTaskTargets = tasks.filter((task) => !task.runner.available && !task.prodLiveBrowserPassed).length;
  const modelSummaries = buildModelSummaries(models, proxySweep);
  const currentWinner = currentProdAdapterSmokeWinner(modelSummaries);
  const allTasksProdVerified = prodLiveBrowserVerifiedTaskTargets === tasks.length && tasks.length > 0;

  return {
    schema: "proofloop-prod-proxy-benchmark-matrix-v1",
    generatedAt: args.generatedAt,
    baseUrl,
    models,
    summary: {
      uniqueTaskTargets: tasks.length,
      modelCount: models.length,
      matrixAttemptTargets: tasks.length * models.length,
      prodLiveBrowserVerifiedTaskTargets,
      localLiveBrowserOnlyTaskTargets: tasks.filter((task) => task.localLiveBrowserOnly).length,
      runnableProdBrowserTaskTargets,
      blockedTaskTargets,
      prodLiveBrowserAttemptPasses: (proxySweep?.rows ?? []).filter((row) => row.status === "passed" && isProdUrl(row.roomUrl)).length,
      allTasksProdVerified,
    },
    recommendation: {
      allTaskWinner: allTasksProdVerified ? currentWinner : null,
      currentProdAdapterSmokeWinner: currentWinner,
      basis: allTasksProdVerified
        ? "All tracked proxy benchmark task targets have prod live-browser proof; winner selected from completed model summaries."
        : "No all-task model winner is claimed until every tracked task target is run through the prod browser matrix. Current winner is limited to the completed external-adapter prod smoke.",
    },
    modelSummaries,
    families,
  };
}

export function renderProofloopProdProxyBenchmarkMatrixMarkdown(report: ProofloopProdProxyBenchmarkMatrix): string {
  const lines = [
    "# ProofLoop Prod Proxy Benchmark Matrix",
    "",
    `Generated: ${report.generatedAt ?? "unknown"}`,
    `Base URL: ${report.baseUrl}`,
    `Production HTML: ${joinUrl(report.baseUrl, "/eval/proofloop-prod-proxy-benchmark-matrix.html")}`,
    `Production JSON: ${joinUrl(report.baseUrl, "/eval/proofloop-prod-proxy-benchmark-matrix.json")}`,
    "",
    "This is the execution matrix for the real prod-browser goal. It keeps the full task denominator visible and refuses to collapse the run into the existing 3-task external-adapter smoke.",
    "",
    "## Summary",
    "",
    `- Unique task targets: ${report.summary.uniqueTaskTargets}`,
    `- Models in matrix: ${report.summary.modelCount}`,
    `- Model-task attempt targets: ${report.summary.matrixAttemptTargets}`,
    `- Prod live-browser verified task targets: ${report.summary.prodLiveBrowserVerifiedTaskTargets}`,
    `- Local live-browser only task targets: ${report.summary.localLiveBrowserOnlyTaskTargets}`,
    `- Runnable prod-browser task targets today: ${report.summary.runnableProdBrowserTaskTargets}`,
    `- Blocked task targets needing a browser adapter: ${report.summary.blockedTaskTargets}`,
    `- Prod live-browser passed attempts recorded: ${report.summary.prodLiveBrowserAttemptPasses}`,
    `- All tasks prod verified: ${report.summary.allTasksProdVerified ? "yes" : "no"}`,
    "",
    "## Recommendation",
    "",
    `- All-task winner: ${report.recommendation.allTaskWinner ?? "none yet"}`,
    `- Current prod adapter-smoke winner: ${report.recommendation.currentProdAdapterSmokeWinner ?? "none yet"}`,
    `- Basis: ${report.recommendation.basis}`,
    "",
    "## Models",
    "",
    "| Model | Prod adapter smoke | Est. OpenRouter list cost | UI measured cost | Avg duration |",
    "|---|---:|---:|---:|---:|",
    ...report.modelSummaries.map((model) =>
      `| \`${model.modelId}\` | ${model.prodAdapterSmokePassed}/${model.prodAdapterSmokeTotal} | ${money(model.estimatedCostUsdAtOpenRouterList)} | ${money(model.measuredCostUsd)} | ${model.avgDurationMs == null ? "n/a" : `${Math.round(model.avgDurationMs / 1000)}s`} |`,
    ),
    "",
    "## Families",
    "",
    "| Family | Tasks | Prod passed | Local only | Runnable now | Blocked |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.families.map((family) =>
      `| \`${family.id}\` | ${family.taskCount} | ${family.prodLiveBrowserPassed} | ${family.localLiveBrowserOnly} | ${family.runnableProdBrowserTasks} | ${family.blockedTasks} |`,
    ),
    "",
    "## Not Done",
    "",
    ...report.families
      .filter((family) => family.prodLiveBrowserPassed < family.taskCount)
      .map((family) => `- ${family.id}: ${family.taskCount - family.prodLiveBrowserPassed} task target(s) still lack prod live-browser proof. First blocker: ${stripTrailingPeriod(firstBlocker(family))}.`),
    "",
    "## Runnable Command Shapes",
    "",
    ...sampleRunnableCommands(report).map((command) => `- \`${command}\``),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function renderProofloopProdProxyBenchmarkMatrixHtml(report: ProofloopProdProxyBenchmarkMatrix): string {
  const familyRows = report.families.map((family) => {
    const pct = family.taskCount ? Math.round((family.prodLiveBrowserPassed / family.taskCount) * 100) : 0;
    return `<tr><td><code>${escapeHtml(family.id)}</code></td><td>${family.taskCount}</td><td>${family.prodLiveBrowserPassed}</td><td>${family.runnableProdBrowserTasks}</td><td>${family.blockedTasks}</td><td><div class="bar"><span style="width:${Math.max(2, pct)}%"></span></div></td></tr>`;
  }).join("\n");
  const modelRows = report.modelSummaries.map((model) =>
    `<tr><td><code>${escapeHtml(model.modelId)}</code></td><td>${model.prodAdapterSmokePassed}/${model.prodAdapterSmokeTotal}</td><td>${money(model.estimatedCostUsdAtOpenRouterList)}</td><td>${money(model.measuredCostUsd)}</td></tr>`,
  ).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>ProofLoop Prod Proxy Benchmark Matrix</title>
<style>
body { font-family: Inter, system-ui, sans-serif; margin: 32px; color: #17201a; }
table { border-collapse: collapse; width: 100%; margin: 18px 0 28px; }
th, td { border-bottom: 1px solid #dde5dd; padding: 8px 10px; text-align: left; vertical-align: top; }
th { color: #526154; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.callout { border: 1px solid #dde5dd; background: #f8fbf8; border-radius: 6px; padding: 14px 16px; margin: 18px 0; }
.bar { width: 100%; min-width: 160px; height: 12px; border-radius: 3px; background: #eef3ef; overflow: hidden; }
.bar span { display: block; height: 100%; background: #2e9e6b; }
</style>
<h1>ProofLoop Prod Proxy Benchmark Matrix</h1>
<div class="callout">
  <strong>${report.summary.prodLiveBrowserVerifiedTaskTargets}/${report.summary.uniqueTaskTargets} task targets have prod live-browser proof.</strong>
  <p>All-task winner: <code>${escapeHtml(report.recommendation.allTaskWinner ?? "none yet")}</code>. Current adapter-smoke winner: <code>${escapeHtml(report.recommendation.currentProdAdapterSmokeWinner ?? "none yet")}</code>.</p>
</div>
<h2>Families</h2>
<table><thead><tr><th>Family</th><th>Tasks</th><th>Prod passed</th><th>Runnable now</th><th>Blocked</th><th>Coverage</th></tr></thead><tbody>${familyRows}</tbody></table>
<h2>Models</h2>
<table><thead><tr><th>Model</th><th>Adapter smoke</th><th>Est. cost</th><th>Measured cost</th></tr></thead><tbody>${modelRows}</tbody></table>
`;
}

function spreadsheetFamily(root: string, official: OfficialCoverageReport | undefined, args: {
  id: string;
  title: string;
  track: "spreadsheetbench-v1" | "spreadsheetbench-v2";
  stageRoot: string;
  command: string;
  baseUrl: string;
  models: string[];
}): ProdProxyFamily {
  const track = officialTrack(official, args.id);
  const taskDirs = findStagedTaskDirs(root, args.stageRoot);
  const localProof = args.id === "spreadsheetbench-v1-full-912"
    ? readJson<LiveReceipt>(root, "docs/eval/spreadsheetbench-live-room-proof.json")
    : undefined;
  const model = args.models[0] ?? DEFAULT_MODELS[0];
  const taskCount = Math.max(taskDirs.length, track?.officialExpectedTasks ?? 0);
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const taskDir = taskDirs[index];
    const manifest = taskDir
      ? readJson<{ taskId?: string; instruction?: string; inputFiles?: string[] }>(root, join(args.stageRoot, "tasks", taskDir, "agent", "task.json"))
      : undefined;
    const taskId = manifest?.taskId ?? taskDir ?? `${args.id}-task-${String(index + 1).padStart(3, "0")}`;
    const isLocalProofTask = index === 0 && localProof?.passed === true && localProof.memoryMode === false && !isProdUrl(localProof.baseUrl);
    return {
      familyId: args.id,
      taskId,
      title: manifest?.instruction?.slice(0, 120) || `${track?.title ?? args.title} task ${index + 1}`,
      status: "ready_for_prod_browser_run" as const,
      prodLiveBrowserPassed: false,
      localLiveBrowserOnly: isLocalProofTask,
      runner: {
        available: true,
        kind: "playwright_prod_browser" as const,
        command: args.command,
        env: {
          BENCH_BASE_URL: args.baseUrl,
          PLAYWRIGHT_BASE_URL: args.baseUrl,
          PLAYWRIGHT_REUSE_SERVER: "1",
          SPREADSHEETBENCH_TRACK: args.track,
          SPREADSHEETBENCH_STAGE_ROOT: args.stageRoot,
          SPREADSHEETBENCH_TASK_ID: taskId,
          BENCH_AGENT_MODEL_MODE: "specific",
          BENCH_AGENT_MODEL_POLICY: model,
          PROOFLOOP_REAL_USER_MODE: "1",
          PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: "",
        },
      },
      evidence: uniqueStrings([
        "docs/eval/official-benchmark-task-coverage.json",
        ...(track?.evidence ?? []),
        ...(taskDir ? [
          join(args.stageRoot, "tasks", taskDir, "agent", "task.json").replace(/\\/g, "/"),
          join(args.stageRoot, "tasks", taskDir, "evaluator", "evaluator.json").replace(/\\/g, "/"),
        ] : []),
        ...(isLocalProofTask ? ["docs/eval/spreadsheetbench-live-room-proof.json"] : []),
      ]),
      blockers: isLocalProofTask
        ? ["Existing SpreadsheetBench receipt is local live-browser only; rerun against https://noderoom.live."]
        : ["SpreadsheetBench task is ready for the generic prod browser workbook adapter but lacks a passing prod receipt."],
    };
  });
  return familyFromTasks(args.id, track?.title ?? args.title, tasks);
}

function bankerToolBenchFamily(root: string, official: OfficialCoverageReport | undefined, baseUrl: string, models: string[]): ProdProxyFamily {
  const track = officialTrack(official, "bankertoolbench-full-100");
  const expectedCount = track?.officialExpectedTasks ?? 100;
  const fullRoot = ".tmp/official-benchmarks/bankertoolbench-repo/btb-data";
  const fixtureRoot = ".tmp/official-benchmarks/btb-fixture";
  const bundleRoot = existsSync(join(root, fullRoot)) ? fullRoot : fixtureRoot;
  const report = existsSync(join(root, bundleRoot))
    ? scanBankerToolBenchBundle(join(root, bundleRoot), { includeTasks: true, sampleLimit: 0 })
    : undefined;
  const receiptMap = btbReceiptMap(root);
  const receiptSummaries = btbReceiptSummaries(root);
  const scannedTasks = report?.tasks?.length
    ? report.tasks.map((task) => ({
      id: task.id,
      title: task.agentTask.instruction.slice(0, 120) || task.harborTaskId,
      receipt: receiptMap.get(task.id) ?? receiptMap.get(task.harborTaskId),
      evidence: [`${bundleRoot}/tasks.jsonl`],
    }))
    : [];
  const sourceTasks = Array.from({ length: Math.max(scannedTasks.length, expectedCount) }, (_, index) => {
    const scanned = scannedTasks[index];
    if (scanned) return scanned;
      const receipt = receiptSummaries[index];
      const taskId = receipt?.taskId ?? `btb-official-${String(index + 1).padStart(3, "0")}`;
      return {
        id: taskId,
        title: `${track?.title ?? "BankerToolBench full 100"} task ${index + 1}`,
        receipt,
        evidence: ["docs/eval/official-benchmark-task-coverage.json", ...(track?.evidence ?? [])],
      };
    });
  const tasks = sourceTasks.map((task) => {
    const receipt = task.receipt;
    const prodPassed = receipt?.prod === true;
    const localOnly = !prodPassed && receipt?.local === true;
    const model = models[0] ?? DEFAULT_MODELS[0];
    return {
      familyId: "bankertoolbench-full-100",
      taskId: task.id,
      title: task.title,
      status: prodPassed ? "prod_live_browser_passed" as const : localOnly ? "local_live_browser_only" as const : "ready_for_prod_browser_run" as const,
      prodLiveBrowserPassed: prodPassed,
      localLiveBrowserOnly: localOnly,
      runner: {
        available: !prodPassed,
        kind: "playwright_prod_browser" as const,
        command: "npm run proofloop:live:btb",
        env: {
          BENCH_BASE_URL: baseUrl,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_REUSE_SERVER: "1",
          BTB_LIVE_ROOM_E2E: "1",
          BTB_UI_BUNDLE_ROOT: bundleRoot,
          BTB_UI_TASK_ID: task.id,
          BENCH_AGENT_MODEL_MODE: "specific",
          BENCH_AGENT_MODEL_POLICY: model,
        },
      },
      evidence: uniqueStrings([
        ...task.evidence,
        ...(receipt?.paths ?? []),
      ]),
      blockers: prodPassed ? [] : [
        localOnly
          ? "Existing BTB receipt is local live-browser only; rerun against https://noderoom.live."
          : "BTB task is ready but lacks a prod live-browser receipt.",
      ],
    };
  });
  return familyFromTasks("bankertoolbench-full-100", track?.title ?? "BankerToolBench full 100", tasks);
}

function accountingFamily(root: string, baseUrl: string): ProdProxyFamily {
  return configBackedFamily(root, {
    id: "accounting-live-proofloop",
    title: "Accounting live proof-loop",
    configPath: "proofloop/accounting/live.accounting.config.json",
    command: "npm run proofloop:live:accounting:browser",
    baseUrl,
    blocker: "Accounting live proof-loop has no passing prod live-browser receipt for this task/model yet.",
  });
}

function notionFamily(root: string, baseUrl: string): ProdProxyFamily {
  return configBackedFamily(root, {
    id: "notion-live-proofloop",
    title: "Notion SDR/BDR live proof-loop",
    configPath: "proofloop/notion/live.notion.config.json",
    command: "npm run proofloop:live:notion:browser",
    baseUrl,
    blocker: "Notion live proof-loop has no passing prod live-browser receipt for this task/model yet.",
  });
}

function proximittyFamily(root: string, baseUrl: string): ProdProxyFamily {
  const receiptMap = committedProdLiveReceiptMap(root);
  const scenarioRoot = join(root, "proofloop", "scenarios");
  const scenarioFiles = existsSync(scenarioRoot)
    ? readdirSync(scenarioRoot).filter((name) => name.startsWith("proximitty-") && name.endsWith(".spec.ts")).sort()
    : [];
  const tasks = scenarioFiles.map((file) => {
    const taskId = file.replace(/\.spec\.ts$/, "");
    const receipt = receiptMap.get(receiptKey("proximitty-underwriting-pr0", taskId));
    const prodPassed = receipt?.prodPassed === true;
    return {
      familyId: "proximitty-underwriting-pr0",
      taskId,
      title: file,
      status: prodPassed ? "prod_live_browser_passed" as const : "ready_for_prod_browser_run" as const,
      prodLiveBrowserPassed: prodPassed,
      localLiveBrowserOnly: false,
      runner: {
        available: true,
        kind: "playwright_prod_browser" as const,
        command: "npm run proofloop:proximitty:browser",
        env: {
          BENCH_BASE_URL: baseUrl,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_REUSE_SERVER: "1",
          PROOFLOOP_TASK_IDS: taskId,
          PROOFLOOP_REAL_USER_MODE: "1",
          PROOFLOOP_FOCUS_MODE: "0",
          PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: "",
        },
      },
      evidence: uniqueStrings([
        `proofloop/scenarios/${file}`,
        "proofloop/benchmarks/proximitty/live-room-scenario.spec.ts",
        "scripts/proofloop-live-playwright.ts",
        ...(receipt?.evidence ?? []),
      ]),
      blockers: prodPassed ? [] : receipt?.blockers.length
        ? receipt.blockers
        : ["Proximitty has a prod browser adapter, but no passing prod live-browser receipt is recorded for this task/model yet."],
    };
  });
  return familyFromTasks("proximitty-underwriting-pr0", "Proximitty underwriting PR0", tasks);
}

function externalAdapterFamilies(
  baseUrl: string,
  models: string[],
  proxySweep: ProxyModelSweep | undefined,
): ProdProxyFamily[] {
  return externalBenchmarkLocalTaskIds().map((adapterId) => {
    const localTasks = loadExternalBenchmarkLocalTasks(adapterId);
    const rows = (proxySweep?.rows ?? []).filter((row) => row.adapterId === adapterId);
    const prodPassed = rows.some((row) => row.status === "passed" && isProdUrl(row.roomUrl));
    const tasks = localTasks.map((task) => {
      const model = models[0] ?? DEFAULT_MODELS[0];
      return {
        familyId: `${adapterId}-prod-proxy-task`,
        taskId: task.taskId,
        title: task.title,
        status: prodPassed ? "prod_live_browser_passed" as const : "ready_for_prod_browser_run" as const,
        prodLiveBrowserPassed: prodPassed,
        localLiveBrowserOnly: false,
      runner: {
        available: true,
        kind: "playwright_prod_browser" as const,
        command: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --id ${adapterId} --real-user --model ${model} --model-mode specific`,
          env: {
            BENCH_BASE_URL: baseUrl,
            PLAYWRIGHT_BASE_URL: baseUrl,
          },
        },
        evidence: [
          `proofloop/benchmarks/${adapterId}/adapter.json`,
          `docs/eval/proofloop-external-adapter-live-room-runs/${adapterId}.json`,
          "docs/eval/proofloop-proxy-model-sweep.json",
        ],
        blockers: prodPassed ? [] : [`${adapterId} has no passing prod live-browser receipt in docs/eval/proofloop-proxy-model-sweep.json.`],
      };
    });
    return familyFromTasks(`${adapterId}-prod-proxy-task`, `${adapterId} prod proxy task`, tasks);
  });
}

function internalFamily(official: OfficialCoverageReport | undefined, baseUrl: string, root = process.cwd()): ProdProxyFamily {
  const receiptMap = committedProdLiveReceiptMap(root);
  const track = officialTrack(official, "noderoom-multi-user-conflict");
  const count = track?.officialExpectedTasks ?? 6;
  const tasks = Array.from({ length: count }, (_, index) => {
    const taskId = `multi-user-conflict-${index + 1}`;
    const receipt = receiptMap.get(receiptKey("noderoom-multi-user-conflict", taskId));
    const prodPassed = receipt?.prodPassed === true;
    return {
      familyId: "noderoom-multi-user-conflict",
      taskId,
      title: "NodeRoom multi-user conflict scenario",
      status: prodPassed ? "prod_live_browser_passed" as const : "ready_for_prod_browser_run" as const,
      prodLiveBrowserPassed: prodPassed,
      localLiveBrowserOnly: false,
      runner: {
        available: true,
        kind: "playwright_prod_browser" as const,
        command: "npm run proofloop:live:multi-user-conflict",
        env: {
          BENCH_BASE_URL: baseUrl,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_REUSE_SERVER: "1",
          PROOFLOOP_TASK_IDS: taskId,
          PROOFLOOP_REAL_USER_MODE: "1",
          PROOFLOOP_FOCUS_MODE: "0",
          PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: "",
        },
      },
      evidence: uniqueStrings([
        "docs/eval/official-benchmark-task-coverage.json",
        "evals/multiUserCoordinationProof.ts",
        "proofloop/benchmarks/noderoom-multi-user/live-room-scenario.spec.ts",
        "scripts/proofloop-live-playwright.ts",
        ...(receipt?.evidence ?? []),
      ]),
      blockers: prodPassed ? [] : receipt?.blockers.length
        ? receipt.blockers
        : ["Multi-user conflict has a prod browser adapter, but no passing prod live-browser receipt is recorded for this task/model yet."],
    };
  });
  return familyFromTasks("noderoom-multi-user-conflict", track?.title ?? "NodeRoom multi-user conflict suite", tasks);
}

function configBackedFamily(root: string, args: {
  id: string;
  title: string;
  configPath: string;
  blocker: string;
  command?: string;
  baseUrl?: string;
}): ProdProxyFamily {
  const receiptMap = committedProdLiveReceiptMap(root);
  const config = readJson<LiveConfig>(root, args.configPath);
  const runnable = !!args.command;
  const tasks = (config?.tasks ?? []).map((task, index) => {
    const taskId = task.id ?? `${args.id}-${index + 1}`;
    const receipt = receiptMap.get(receiptKey(args.id, taskId));
    const prodPassed = receipt?.prodPassed === true;
    return {
      familyId: args.id,
      taskId,
      title: task.title ?? task.name ?? task.id ?? args.title,
      status: prodPassed ? "prod_live_browser_passed" as const : runnable ? "ready_for_prod_browser_run" as const : "blocked_non_browser_runner" as const,
      prodLiveBrowserPassed: prodPassed,
      localLiveBrowserOnly: false,
      runner: {
        available: runnable,
        kind: runnable ? "playwright_prod_browser" as const : "http_or_deterministic_only" as const,
        ...(args.command ? { command: args.command } : {}),
        ...(args.command ? {
          env: {
            BENCH_BASE_URL: args.baseUrl ?? "https://noderoom.live",
            PLAYWRIGHT_BASE_URL: args.baseUrl ?? "https://noderoom.live",
            PLAYWRIGHT_REUSE_SERVER: "1",
            PROOFLOOP_TASKS_JSON: args.configPath,
            PROOFLOOP_TASK_IDS: taskId,
            PROOFLOOP_REAL_USER_MODE: "1",
            PROOFLOOP_FOCUS_MODE: "0",
            PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: "",
          },
        } : {}),
      },
      evidence: uniqueStrings([
        ...(args.command
          ? [args.configPath, "proofloop/live-browser-proof.spec.ts", "scripts/proofloop-live-playwright.ts"]
          : [args.configPath]),
        ...(receipt?.evidence ?? []),
      ]),
      blockers: prodPassed ? [] : receipt?.blockers.length ? receipt.blockers : [args.blocker],
    };
  });
  return familyFromTasks(args.id, args.title, tasks);
}

function familyFromTasks(id: string, title: string, tasks: ProdProxyTask[]): ProdProxyFamily {
  return {
    id,
    title,
    taskCount: tasks.length,
    prodLiveBrowserPassed: tasks.filter((task) => task.prodLiveBrowserPassed).length,
    localLiveBrowserOnly: tasks.filter((task) => task.localLiveBrowserOnly).length,
    runnableProdBrowserTasks: tasks.filter((task) => task.runner.available).length,
    blockedTasks: tasks.filter((task) => !task.runner.available && !task.prodLiveBrowserPassed).length,
    tasks,
  };
}

function officialTrack(official: OfficialCoverageReport | undefined, id: string): OfficialCoverageTrack | undefined {
  return official?.tracks?.find((item) => item.id === id);
}

function committedProdLiveReceiptMap(root: string): Map<string, ProdLiveReceiptResult> {
  const map = new Map<string, ProdLiveReceiptResult>();
  for (const path of jsonFiles(root, "docs/eval").filter((file) => basename(file).startsWith("proofloop-live-"))) {
    const receipt = readJson<LiveReceipt>(root, path);
    if (!receipt) continue;
    const familyId = receiptFamilyId(path, receipt);
    if (!familyId) continue;
    for (const taskId of receiptTaskIds(receipt)) {
      const result = validateCommittedProdLiveReceipt(path, familyId, taskId, receipt);
      mergeReceiptResult(map, receiptKey(familyId, taskId), result);
    }
  }
  return map;
}

function validateCommittedProdLiveReceipt(path: string, familyId: string, taskId: string, receipt: LiveReceipt): ProdLiveReceiptResult {
  const prod = isProdUrl(receipt.baseUrl) || isProdUrl(receipt.roomUrl);
  const taskPassed = receiptTaskPassed(receipt, taskId);
  const runtimeProfile = receipt.model?.runtimeProfile?.trim() ?? "";
  const telemetry = receiptTelemetryRows(receipt);
  const routeIntegrity = evaluateProofloopRouteIntegrity({
    requestedModel: requestedModelFromReceipt(receipt),
    telemetry,
  });
  const blockers: string[] = [];

  if (!prod) blockers.push(`Committed receipt ${path} is not a https://noderoom.live prod browser receipt.`);
  if (receipt.officialScoreClaim !== false) blockers.push(`Committed receipt ${path} must set officialScoreClaim:false before it can count as proxy proof.`);
  if (receipt.memoryMode === true) blockers.push(`Committed receipt ${path} used memory mode; current proxy proof requires normal user mode.`);
  if (runtimeProfile && runtimeProfile !== "standard") blockers.push(`Committed receipt ${path} used runtimeProfile=${runtimeProfile}; current proxy proof requires the normal user runtime.`);
  if (!receiptOverallPassed(receipt)) blockers.push(`Committed receipt ${path} did not pass overall.`);
  if (!taskPassed) blockers.push(`Committed receipt ${path} did not pass task ${taskId}.`);
  if (routeIntegrity.status !== "matched") {
    blockers.push(`${routeIntegrity.status}: ${routeIntegrityFailureSummary(routeIntegrity) ?? "model route integrity could not be proven"}.`);
  }

  return {
    prodPassed: blockers.length === 0,
    path,
    evidence: uniqueStrings([
      path,
      ...(receipt.roomUrl ? [receipt.roomUrl] : []),
      `receipt_family=${familyId}`,
      `receipt_task=${taskId}`,
      `requested_model=${routeIntegrity.requestedModel ?? "unknown"}`,
      `actual_model=${routeIntegrity.telemetryModels.join(",") || "unknown"}`,
      ...(routeIntegrity.measuredCostUsd == null ? [] : [`measured_cost_usd=${routeIntegrity.measuredCostUsd}`]),
    ]),
    blockers,
  };
}

function mergeReceiptResult(map: Map<string, ProdLiveReceiptResult>, key: string, result: ProdLiveReceiptResult): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, result);
    return;
  }
  if (result.prodPassed && !existing.prodPassed) {
    map.set(key, {
      ...result,
      evidence: uniqueStrings([...existing.evidence, ...result.evidence]),
    });
    return;
  }
  if (!existing.prodPassed && !result.prodPassed) {
    map.set(key, {
      ...existing,
      evidence: uniqueStrings([...existing.evidence, ...result.evidence]),
      blockers: uniqueStrings([...existing.blockers, ...result.blockers]),
    });
  }
}

function receiptFamilyId(path: string, receipt: LiveReceipt): string | undefined {
  if (receipt.suite === "proximitty-underwriting-pr0") return "proximitty-underwriting-pr0";
  if (receipt.suite === "noderoom-multi-user-conflict") return "noderoom-multi-user-conflict";
  if (receipt.suite === "live-accounting") return "accounting-live-proofloop";
  if (receipt.suite === "live-notion-sdr-bdr") return "notion-live-proofloop";
  const normalized = `${path} ${receipt.caseId ?? ""} ${receipt.benchmark ?? ""}`.toLowerCase();
  if (normalized.includes("proximitty")) return "proximitty-underwriting-pr0";
  if (normalized.includes("multi-user")) return "noderoom-multi-user-conflict";
  if (normalized.includes("accounting")) return "accounting-live-proofloop";
  if (normalized.includes("notion")) return "notion-live-proofloop";
  return undefined;
}

function receiptTaskIds(receipt: LiveReceipt): string[] {
  return uniqueStrings([
    receipt.taskId ?? "",
    ...(receipt.tasks ?? []).map((task) => task.taskId ?? task.id ?? ""),
    ...receiptTaskProofs(receipt).map((task) => task.taskId ?? ""),
  ]);
}

function receiptTaskPassed(receipt: LiveReceipt, taskId: string): boolean {
  const proofs = receiptTaskProofs(receipt).filter((task) => task.taskId === taskId);
  if (!proofs.length) {
    const tasks = (receipt.tasks ?? []).filter((task) => (task.taskId ?? task.id) === taskId);
    if (tasks.some((task) => task.passed === false)) return false;
    if (tasks.some((task) => task.passed === true)) return true;
    return receiptOverallPassed(receipt);
  }
  return proofs.some((proof) => proof.passed === true) && proofs.every((proof) => proof.passed !== false);
}

function receiptTaskProofs(receipt: LiveReceipt): LiveReceiptTaskProof[] {
  return [
    ...(receipt.taskProofs ?? []),
    ...(receipt.scorer?.details?.taskProofs ?? []),
  ];
}

function receiptOverallPassed(receipt: LiveReceipt): boolean {
  return receipt.status === "passed" || receipt.passed === true || receipt.scorer?.verdict === "pass";
}

function requestedModelFromReceipt(receipt: LiveReceipt): string | undefined {
  return receipt.model?.policy ?? receipt.model?.requested ?? receipt.model?.resolved ?? receipt.model?.id;
}

function receiptTelemetryRows(receipt: LiveReceipt): ProofloopTelemetryLike[] {
  const fromModel: ProofloopTelemetryLike[] = [];
  for (const row of receipt.model?.telemetry ?? []) {
    if (!row) continue;
    if (isNestedTelemetryRow(row)) {
      if (row.telemetry) fromModel.push(row.telemetry);
    } else {
      fromModel.push(row);
    }
  }
  if (fromModel.length > 0) return fromModel;
  const fromTasks = receiptTaskProofs(receipt).flatMap((task) => [
    task.telemetry,
    task.agent?.telemetry,
  ]).filter((row): row is ProofloopTelemetryLike => !!row);
  return fromTasks;
}

function isNestedTelemetryRow(row: ProofloopTelemetryLike | { taskId?: string; telemetry?: ProofloopTelemetryLike | null }): row is { taskId?: string; telemetry?: ProofloopTelemetryLike | null } {
  return "telemetry" in row;
}

function receiptKey(familyId: string, taskId: string): string {
  return `${familyId}:${taskId}`;
}

function findStagedTaskDirs(root: string, stageRoot: string): string[] {
  const tasksRoot = join(root, stageRoot, "tasks");
  if (!existsSync(tasksRoot)) return [];
  const out: string[] = [];
  walkTaskDirs(tasksRoot, "", out);
  return out.sort((a, b) => a.localeCompare(b));
}

function walkTaskDirs(root: string, relPrefix: string, out: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = join(root, entry.name);
    if (existsSync(join(full, "agent", "task.json"))) out.push(rel);
    walkTaskDirs(full, rel, out);
  }
}

function btbReceiptMap(root: string): Map<string, { prod: boolean; local: boolean; paths: string[] }> {
  const map = new Map<string, { prod: boolean; local: boolean; paths: string[] }>();
  for (const path of [
    ...jsonFiles(root, "docs/eval/bankertoolbench/live-room"),
    ...latestJsonFiles(root, "docs/eval/fresh-room/FR-020/tasks"),
  ]) {
    const receipt = readJson<LiveReceipt>(root, path);
    if (!receipt?.passed || receipt.memoryMode !== false) continue;
    const keys = [receipt.taskId, harborFromTaskId(receipt.taskId), harborFromRoomPath(path)].filter((value): value is string => !!value);
    for (const key of keys) {
      const existing = map.get(key) ?? { prod: false, local: false, paths: [] };
      existing.prod ||= isProdUrl(receipt.baseUrl) || isProdUrl(receipt.roomUrl);
      existing.local ||= !existing.prod;
      existing.paths.push(path);
      map.set(key, existing);
    }
  }
  return map;
}

function btbReceiptSummaries(root: string): Array<{ taskId: string; prod: boolean; local: boolean; paths: string[] }> {
  const map = new Map<string, { taskId: string; prod: boolean; local: boolean; paths: string[] }>();
  for (const path of [
    ...jsonFiles(root, "docs/eval/bankertoolbench/live-room"),
    ...latestJsonFiles(root, "docs/eval/fresh-room/FR-020/tasks"),
  ]) {
    const receipt = readJson<LiveReceipt>(root, path);
    if (!receipt?.passed || receipt.memoryMode !== false) continue;
    const taskId = receipt.taskId ?? harborFromRoomPath(path) ?? path;
    const existing = map.get(taskId) ?? { taskId, prod: false, local: false, paths: [] };
    const prod = isProdUrl(receipt.baseUrl) || isProdUrl(receipt.roomUrl);
    existing.prod ||= prod;
    existing.local ||= !prod;
    existing.paths.push(path);
    map.set(taskId, existing);
  }
  return [...map.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function jsonFiles(root: string, dir: string): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `${dir}/${entry.name}`);
}

function latestJsonFiles(root: string, dir: string): string[] {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(absolute, entry.name, "latest.json")))
    .map((entry) => `${dir}/${entry.name}/latest.json`);
}

function harborFromTaskId(taskId: string | undefined): string | undefined {
  if (!taskId) return undefined;
  if (taskId.startsWith("btb-")) return taskId;
  return `btb-${taskId.split("-")[0]}`;
}

function harborFromRoomPath(path: string): string | undefined {
  const name = basename(path, ".json");
  return name.startsWith("btb-") ? name : undefined;
}

function buildModelSummaries(models: string[], proxySweep: ProxyModelSweep | undefined): ProdProxyModelSummary[] {
  const byModel = proxySweep?.summary?.byModel ?? [];
  return models.map((modelId) => {
    const summary = byModel.find((row) => row.modelId === modelId);
    const rows = (proxySweep?.rows ?? []).filter((row) => row.modelId === modelId);
    return {
      modelId,
      prodAdapterSmokePassed: summary?.passed ?? rows.filter((row) => row.status === "passed" && isProdUrl(row.roomUrl)).length,
      prodAdapterSmokeTotal: summary?.total ?? rows.length,
      estimatedCostUsdAtOpenRouterList: summary?.estimatedCostUsdAtOpenRouterList ?? sumNullable(rows.map((row) => row.estimatedCostUsdAtOpenRouterList)),
      measuredCostUsd: summary?.measuredCostUsd ?? sumNullable(rows.map((row) => row.measuredCostUsd)),
      avgDurationMs: summary?.avgDurationMs ?? averageNullable(rows.map((row) => row.durationMs)),
    };
  });
}

function currentProdAdapterSmokeWinner(models: ProdProxyModelSummary[]): string | null {
  return models
    .filter((model) => model.prodAdapterSmokeTotal > 0 && model.prodAdapterSmokePassed === model.prodAdapterSmokeTotal)
    .sort((a, b) => (a.estimatedCostUsdAtOpenRouterList ?? Infinity) - (b.estimatedCostUsdAtOpenRouterList ?? Infinity))[0]?.modelId ?? null;
}

function modelIdsFromSweep(proxySweep: ProxyModelSweep | undefined): string[] {
  const ids = proxySweep?.summary?.byModel?.map((row) => row.modelId).filter((value): value is string => !!value) ?? [];
  return ids.length ? ids : DEFAULT_MODELS;
}

function sampleRunnableCommands(report: ProofloopProdProxyBenchmarkMatrix): string[] {
  const seen = new Set<string>();
  const seenFamilies = new Set<string>();
  const commands: string[] = [];
  for (const task of report.families.flatMap((family) => family.tasks)) {
    if (!task.runner.available) continue;
    if (!task.runner.command) continue;
    if (seenFamilies.has(task.familyId)) continue;
    const env = task.runner.env
      ? `${Object.entries(task.runner.env).map(([key, value]) => `${key}=${quoteShell(value)}`).join(" ")} `
      : "";
    const command = `${env}${task.runner.command}`;
    if (seen.has(command)) continue;
    seen.add(command);
    seenFamilies.add(task.familyId);
    commands.push(command);
    if (commands.length >= 6) break;
  }
  return commands;
}

function firstBlocker(family: ProdProxyFamily): string {
  return family.tasks.find((task) => task.blockers.length)?.blockers[0] ?? "none";
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.+$/g, "");
}

function readJson<T>(root: string, path: string): T | undefined {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return undefined;
  try {
    return JSON.parse(readFileSync(absolute, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function isProdUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https:\/\/noderoom\.live(?:\/|$)/i.test(value);
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Number(finite.reduce((sum, value) => sum + value, 0).toFixed(6)) : null;
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2)) : null;
}

function money(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function quoteShell(value: string): string {
  return /[\s"'$]/.test(value) ? JSON.stringify(value) : value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
