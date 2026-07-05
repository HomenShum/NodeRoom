import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  externalBenchmarkLocalTaskIds,
  loadExternalBenchmarkLocalTasks,
  type ExternalBenchmarkAdapterId,
} from "../proofloop/benchmarks/common/local-tasks";

type OpenRouterModel = {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
  supported_parameters?: string[];
};

type PricingAtRun = {
  source: string;
  fetchedAt: string;
  modelId: string;
  name?: string;
  created?: string;
  contextLength?: number;
  supportsTools: boolean;
  inputPer1M: number | null;
  outputPer1M: number | null;
  cachedInputPer1M?: number | null;
};

type AdapterReceipt = {
  adapterId: ExternalBenchmarkAdapterId;
  status: "passed" | "failed";
  runId: string;
  baseUrl: string;
  exitCode: number;
  failedGates: string[];
  browserProof?: {
    roomUrl?: string;
    roomId?: string;
    model?: {
      policy?: string;
      runtimeProfile?: string;
      realUserMode?: boolean;
      measuredCostUsd?: number | null;
      measuredTokensIn?: number | null;
      measuredTokensOut?: number | null;
    };
    taskProofs?: Array<{
      taskId?: string;
      durationMs?: number;
      completionVisible?: boolean;
    }>;
  };
};

type SweepRow = {
  modelId: string;
  adapterId: ExternalBenchmarkAdapterId;
  status: "passed" | "failed";
  runId: string;
  roomUrl?: string;
  roomId?: string;
  exitCode: number;
  failedGates: string[];
  durationMs: number | null;
  measuredCostUsd: number | null;
  measuredTokensIn: number | null;
  measuredTokensOut: number | null;
  estimatedCostUsdAtOpenRouterList: number | null;
  pricingAtRun: PricingAtRun | null;
};

type SweepPayload = {
  schema: "proofloop-proxy-model-sweep-v1";
  runId: string;
  generatedAt: string;
  baseUrl: string;
  realUserMode: boolean;
  runtimeProfile: string;
  scope: SweepScope;
  models: string[];
  adapterIds: ExternalBenchmarkAdapterId[];
  openRouterCatalogSource: string;
  summary: ReturnType<typeof summarize>;
  rows: SweepRow[];
};

type SweepScope = {
  mode: "proxy_adapter_smoke";
  fullOfficialTaskCoverageClaim: false;
  passDenominatorMeaning: string;
  includedLocalProxyTaskCount: number;
  includedAdapters: Array<{
    adapterId: ExternalBenchmarkAdapterId;
    localProxyTaskCount: number;
    localProxyTaskIds: string[];
  }>;
  notIncludedInThisRun: string[];
};

const DEFAULT_MODELS = [
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-flash",
  "poolside/laguna-xs-2.1",
  "qwen/qwen3.7-plus",
];
const OPENROUTER_MODELS_API = "https://openrouter.ai/api/v1/models";

const args = process.argv.slice(2);
const ids = optionValues("--id") as ExternalBenchmarkAdapterId[];
const adapterIds = ids.length ? ids : externalBenchmarkLocalTaskIds();
const models = modelArgs();
const prod = args.includes("--prod") || !args.includes("--local");
const realUser = !args.includes("--benchmark-mode");
const dryRun = args.includes("--dry-run");
const runId = optionValue("--run-id") ?? `proxy-model-sweep-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outJson = optionValue("--json-out") ?? "docs/eval/proofloop-proxy-model-sweep.json";
const outMd = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_PROXY_MODEL_SWEEP.md";
const outHtml = optionValue("--html-out") ?? "docs/eval/proofloop-proxy-model-sweep-costs.html";
const adapterOutRoot = optionValue("--adapter-out-root") ?? join("docs/eval/proofloop-proxy-model-sweep-runs", runId);
const allowFailures = args.includes("--allow-failures");
const generatedAt = new Date().toISOString();

const catalog = await fetchOpenRouterCatalog();
const pricingByModel = new Map(catalog.map((model) => [model.id, pricingFor(model, generatedAt)]));
const scope = buildScope();
const rows: SweepRow[] = [];
let exitCode = 0;

mkdirSync(adapterOutRoot, { recursive: true });

for (const modelId of models) {
  for (const adapterId of adapterIds) {
    const row = dryRun
      ? dryRunRow(modelId, adapterId)
      : runOne({ modelId, adapterId });
    rows.push(row);
    if (row.status !== "passed") exitCode = 1;
    writeOutputs(rows);
  }
}

writeOutputs(rows);
if (exitCode !== 0 && !allowFailures) process.exitCode = exitCode;

function runOne(args: { modelId: string; adapterId: ExternalBenchmarkAdapterId }): SweepRow {
  const outDir = join(adapterOutRoot, safePathPart(args.modelId));
  mkdirSync(outDir, { recursive: true });
  const childArgs = [
    "run",
    "benchmark:proofloop:external-adapter-live-room",
    "--",
    "--id",
    args.adapterId,
    prod ? "--prod" : "--local",
    "--model",
    args.modelId,
    "--model-mode",
    "specific",
    "--json-out-dir",
    outDir,
    "--allow-terminal-without-phrase",
  ];
  if (realUser) childArgs.push("--user-emulation", "real", "--real-user");
  const result = spawnSync("npm", childArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PROOFLOOP_RUN_ID: `${runId}-${safePathPart(args.modelId)}-${args.adapterId}`,
      PROOFLOOP_EXTERNAL_AGENT_TIMEOUT_MS: process.env.PROOFLOOP_EXTERNAL_AGENT_TIMEOUT_MS ?? "600000",
      PROOFLOOP_EXTERNAL_STREAM_TIMEOUT_MS: process.env.PROOFLOOP_EXTERNAL_STREAM_TIMEOUT_MS ?? "120000",
    },
  });
  const receiptPath = join(outDir, `${args.adapterId}.json`);
  const receipt = readJsonIfExists<AdapterReceipt>(receiptPath);
  return rowFromReceipt(args.modelId, args.adapterId, result.status ?? 1, receipt);
}

function dryRunRow(modelId: string, adapterId: ExternalBenchmarkAdapterId): SweepRow {
  return {
    modelId,
    adapterId,
    status: "failed",
    runId: `${runId}-${safePathPart(modelId)}-${adapterId}`,
    exitCode: 0,
    failedGates: ["dry-run: live browser scenario not executed"],
    durationMs: null,
    measuredCostUsd: null,
    measuredTokensIn: null,
    measuredTokensOut: null,
    estimatedCostUsdAtOpenRouterList: null,
    pricingAtRun: pricingByModel.get(modelId) ?? null,
  };
}

function rowFromReceipt(modelId: string, adapterId: ExternalBenchmarkAdapterId, fallbackExitCode: number, receipt?: AdapterReceipt): SweepRow {
  const measuredTokensIn = receipt?.browserProof?.model?.measuredTokensIn ?? null;
  const measuredTokensOut = receipt?.browserProof?.model?.measuredTokensOut ?? null;
  const pricing = pricingByModel.get(modelId) ?? null;
  return {
    modelId,
    adapterId,
    status: receipt?.status ?? "failed",
    runId: receipt?.runId ?? `${runId}-${safePathPart(modelId)}-${adapterId}`,
    roomUrl: receipt?.browserProof?.roomUrl,
    roomId: receipt?.browserProof?.roomId,
    exitCode: receipt?.exitCode ?? fallbackExitCode,
    failedGates: receipt?.failedGates ?? [`${adapterId}: missing adapter receipt`],
    durationMs: sumDurations(receipt),
    measuredCostUsd: receipt?.browserProof?.model?.measuredCostUsd ?? null,
    measuredTokensIn,
    measuredTokensOut,
    estimatedCostUsdAtOpenRouterList: estimateCost(pricing, measuredTokensIn, measuredTokensOut),
    pricingAtRun: pricing,
  };
}

async function fetchOpenRouterCatalog(): Promise<OpenRouterModel[]> {
  try {
    const response = await fetch(OPENROUTER_MODELS_API);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json() as { data?: OpenRouterModel[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    console.warn(`proxy model sweep: could not fetch OpenRouter catalog: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function pricingFor(model: OpenRouterModel, fetchedAt: string): PricingAtRun {
  return {
    source: OPENROUTER_MODELS_API,
    fetchedAt,
    modelId: model.id,
    name: model.name,
    created: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    contextLength: model.context_length,
    supportsTools: model.supported_parameters?.includes("tools") ?? false,
    inputPer1M: pricePer1M(model.pricing?.prompt),
    outputPer1M: pricePer1M(model.pricing?.completion),
    cachedInputPer1M: pricePer1M(model.pricing?.input_cache_read),
  };
}

function pricePer1M(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number((parsed * 1_000_000).toFixed(6)) : null;
}

function estimateCost(pricing: PricingAtRun | null, inputTokens: number | null, outputTokens: number | null): number | null {
  if (!pricing || pricing.inputPer1M === null || pricing.outputPer1M === null) return null;
  if (inputTokens === null || outputTokens === null) return null;
  return Number(((inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000).toFixed(6));
}

function writeOutputs(rows: SweepRow[]): void {
  const summary = summarize(rows);
  const payload: SweepPayload = {
    schema: "proofloop-proxy-model-sweep-v1",
    runId,
    generatedAt,
    baseUrl: prod ? process.env.PROOFLOOP_PROD_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live" : process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    realUserMode: realUser,
    runtimeProfile: realUser ? "standard" : "benchmark_completion",
    scope,
    models,
    adapterIds,
    openRouterCatalogSource: OPENROUTER_MODELS_API,
    summary,
    rows,
  };
  writeJson(outJson, payload);
  writeText(outMd, renderMarkdown(payload));
  writeText(outHtml, renderHtml(payload));
  console.log(`proxy model sweep: ${summary.passed}/${summary.total} passed; json ${outJson}; chart ${outHtml}`);
}

function summarize(rows: SweepRow[]) {
  const byModel = models.map((modelId) => {
    const modelRows = rows.filter((row) => row.modelId === modelId);
    const passed = modelRows.filter((row) => row.status === "passed").length;
    const estimatedCostUsdAtOpenRouterList = sumValues(modelRows.map((row) => row.estimatedCostUsdAtOpenRouterList));
    const measuredCostUsd = sumValues(modelRows.map((row) => row.measuredCostUsd));
    return {
      modelId,
      passed,
      total: modelRows.length,
      passRate: modelRows.length ? Number((passed / modelRows.length).toFixed(4)) : 0,
      measuredCostUsd,
      estimatedCostUsdAtOpenRouterList,
      avgDurationMs: averageValues(modelRows.map((row) => row.durationMs)),
      pricingAtRun: pricingByModel.get(modelId) ?? null,
    };
  });
  const completeModels = byModel.filter((row) => row.total === adapterIds.length);
  const passedModels = completeModels.filter((row) => row.passed === row.total);
  const cheapestPassed = passedModels
    .filter((row) => row.estimatedCostUsdAtOpenRouterList !== null)
    .sort((a, b) => (a.estimatedCostUsdAtOpenRouterList ?? Infinity) - (b.estimatedCostUsdAtOpenRouterList ?? Infinity))[0] ?? null;
  return {
    total: rows.length,
    passed: rows.filter((row) => row.status === "passed").length,
    failed: rows.filter((row) => row.status !== "passed").length,
    completeModelCount: completeModels.length,
    fullyPassingModelCount: passedModels.length,
    cheapestFullyPassingModel: cheapestPassed?.modelId ?? null,
    byModel,
  };
}

function buildScope(): SweepScope {
  const includedAdapters = adapterIds.map((adapterId) => {
    const tasks = loadExternalBenchmarkLocalTasks(adapterId);
    return {
      adapterId,
      localProxyTaskCount: tasks.length,
      localProxyTaskIds: tasks.map((task) => task.taskId),
    };
  });
  return {
    mode: "proxy_adapter_smoke",
    fullOfficialTaskCoverageClaim: false,
    passDenominatorMeaning: "Passes are local live-browser proxy tasks per adapter, not full official benchmark tasks.",
    includedLocalProxyTaskCount: includedAdapters.reduce((sum, adapter) => sum + adapter.localProxyTaskCount, 0),
    includedAdapters,
    notIncludedInThisRun: [
      "SpreadsheetBench V1 full 912-task model-run scorer matrix",
      "SpreadsheetBench V2 full 321-task bundle/run/scorer/chart matrix",
      "BankerToolBench full 100-task official/live-UI matrix",
      "Proximitty underwriting proof-loop suite",
      "Accounting proof-loop suite",
      "Notion SDR/BDR proof-loop suite",
      "NodeRoom internal model-route/professional workflow evals",
      "Official Finch/FinAuditing/WorkstreamBench upstream scorers or judge credentials",
    ],
  };
}

function renderMarkdown(payload: SweepPayload): string {
  return renderMarkdownFromAny(payload);
}

function renderMarkdownFromAny(payload: SweepPayload): string {
  const lines = [
    "# ProofLoop Proxy Model Sweep",
    "",
    `Generated: ${payload.generatedAt}`,
    `Base URL: ${payload.baseUrl}`,
    `Real user mode: ${payload.realUserMode}`,
    `Runtime profile: ${payload.runtimeProfile}`,
    `Scope: ${payload.scope.mode}`,
    `Full official task coverage claim: ${payload.scope.fullOfficialTaskCoverageClaim}`,
    `Included local proxy tasks: ${payload.scope.includedLocalProxyTaskCount}`,
    `Cheapest fully passing model: ${payload.summary.cheapestFullyPassingModel ?? "none yet"}`,
    "",
    "## Scope",
    "",
    payload.scope.passDenominatorMeaning,
    "",
    "| Adapter | Local proxy task count | Local proxy task IDs |",
    "| --- | ---: | --- |",
    ...payload.scope.includedAdapters.map((adapter) => `| ${adapter.adapterId} | ${adapter.localProxyTaskCount} | ${adapter.localProxyTaskIds.join("<br>")} |`),
    "",
    "Not included in this run:",
    "",
    ...payload.scope.notIncludedInThisRun.map((item) => `- ${item}`),
    "",
    "## Cost Chart",
    "",
    "| Model | Proxy task passes | Est. OpenRouter list cost | UI measured cost | Avg duration | Input $/M | Output $/M |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...payload.summary.byModel.map((row) => [
      row.modelId,
      `${row.passed}/${row.total}`,
      money(row.estimatedCostUsdAtOpenRouterList),
      money(row.measuredCostUsd),
      row.avgDurationMs === null ? "n/a" : `${Math.round(row.avgDurationMs / 1000)}s`,
      row.pricingAtRun?.inputPer1M ?? "n/a",
      row.pricingAtRun?.outputPer1M ?? "n/a",
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Runs",
    "",
    "| Model | Adapter | Status | Room | Est. cost | Tokens in/out | Failed gates |",
    "| --- | --- | --- | --- | ---: | ---: | --- |",
    ...payload.rows.map((row) => [
      row.modelId,
      row.adapterId,
      row.status,
      row.roomUrl ? `[${row.roomId ?? "room"}](${row.roomUrl})` : "n/a",
      money(row.estimatedCostUsdAtOpenRouterList),
      row.measuredTokensIn === null || row.measuredTokensOut === null ? "n/a" : `${row.measuredTokensIn}/${row.measuredTokensOut}`,
      row.failedGates.length ? row.failedGates.join("; ").replace(/\|/g, "/") : "",
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderHtml(payload: SweepPayload): string {
  const maxCost = Math.max(0.000001, ...payload.summary.byModel.map((row) => row.estimatedCostUsdAtOpenRouterList ?? 0));
  const bars = payload.summary.byModel.map((row) => {
    const cost = row.estimatedCostUsdAtOpenRouterList ?? 0;
    const width = Math.max(2, Math.round((cost / maxCost) * 100));
    const passed = row.passed === row.total && row.total > 0;
    return `<tr><td><code>${escapeHtml(row.modelId)}</code></td><td>${row.passed}/${row.total} proxy tasks</td><td>${money(cost)}</td><td><div class="bar"><span class="${passed ? "pass" : "fail"}" style="width:${width}%"></span></div></td></tr>`;
  }).join("\n");
  const runRows = payload.rows.map((row) => `<tr><td><code>${escapeHtml(row.modelId)}</code></td><td>${row.adapterId}</td><td>${row.status}</td><td>${row.roomUrl ? `<a href="${escapeHtml(row.roomUrl)}">${escapeHtml(row.roomId ?? "room")}</a>` : "n/a"}</td><td>${money(row.estimatedCostUsdAtOpenRouterList)}</td><td>${row.measuredTokensIn ?? "n/a"} / ${row.measuredTokensOut ?? "n/a"}</td></tr>`).join("\n");
  const scopeRows = payload.scope.includedAdapters.map((adapter) => `<tr><td>${escapeHtml(adapter.adapterId)}</td><td>${adapter.localProxyTaskCount}</td><td>${escapeHtml(adapter.localProxyTaskIds.join(", "))}</td></tr>`).join("\n");
  const notIncluded = payload.scope.notIncludedInThisRun.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>ProofLoop Proxy Model Sweep</title>
<style>
body { font-family: Inter, system-ui, sans-serif; margin: 32px; color: #17201a; }
table { border-collapse: collapse; width: 100%; margin: 18px 0 28px; }
th, td { border-bottom: 1px solid #dde5dd; padding: 8px 10px; text-align: left; vertical-align: top; }
th { color: #526154; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.bar { width: 100%; min-width: 180px; height: 12px; border-radius: 3px; background: #eef3ef; overflow: hidden; }
.bar span { display: block; height: 100%; }
.bar .pass { background: #2e9e6b; }
.bar .fail { background: #bd6257; }
.meta { color: #526154; }
.scope { border: 1px solid #dde5dd; background: #f8fbf8; border-radius: 6px; padding: 14px 16px; margin: 18px 0; }
</style>
<h1>ProofLoop Proxy Model Sweep</h1>
<p class="meta">Generated ${escapeHtml(payload.generatedAt)} against ${escapeHtml(payload.baseUrl)}. Real user mode: ${payload.realUserMode}. Runtime profile: ${escapeHtml(payload.runtimeProfile)}.</p>
<div class="scope">
  <strong>Scope: ${escapeHtml(payload.scope.mode)}</strong>
  <p>${escapeHtml(payload.scope.passDenominatorMeaning)} This run includes ${payload.scope.includedLocalProxyTaskCount} local proxy task(s) and does not claim full official task coverage.</p>
  <table><thead><tr><th>Adapter</th><th>Local proxy tasks</th><th>Task IDs</th></tr></thead><tbody>${scopeRows}</tbody></table>
  <p>Not included in this run:</p>
  <ul>${notIncluded}</ul>
</div>
<p>Cheapest fully passing model: <strong>${escapeHtml(payload.summary.cheapestFullyPassingModel ?? "none yet")}</strong></p>
<h2>Estimated Cost by Model</h2>
<table><thead><tr><th>Model</th><th>Proxy task passes</th><th>Est. OpenRouter list cost</th><th>Relative cost</th></tr></thead><tbody>${bars}</tbody></table>
<h2>Runs</h2>
<table><thead><tr><th>Model</th><th>Adapter</th><th>Status</th><th>Room</th><th>Est. cost</th><th>Tokens in/out</th></tr></thead><tbody>${runRows}</tbody></table>
`;
}

function modelArgs(): string[] {
  const explicit = optionValues("--model").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const csv = optionValue("--models")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const all = [...explicit, ...csv];
  return all.length ? [...new Set(all)] : DEFAULT_MODELS;
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

function sumDurations(receipt?: AdapterReceipt): number | null {
  return sumValues(receipt?.browserProof?.taskProofs?.map((task) => task.durationMs ?? null) ?? []);
}

function sumValues(values: Array<number | null | undefined>): number | null {
  let saw = false;
  let sum = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    saw = true;
    sum += value;
  }
  return saw ? Number(sum.toFixed(6)) : null;
}

function averageValues(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2));
}

function money(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function safePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function readJsonIfExists<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}
