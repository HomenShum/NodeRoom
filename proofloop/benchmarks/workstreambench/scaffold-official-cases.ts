import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";

type HfSibling = {
  rfilename?: string;
};

type HfDatasetInfo = {
  sha?: string;
  siblings?: HfSibling[];
};

type TaskFile = {
  path: string;
  url: string;
};

type WorkstreamTask = {
  taskId: string;
  startingWorkbooks: TaskFile[];
  startingPdfs: TaskFile[];
  solutionWorkbooks: TaskFile[];
};

type CaseEntry = {
  taskId: string;
  caseDir: string;
  aiAttemptPath: string;
  solutionDir: string;
  solutionWorkbookPath: string | null;
  sourceWorkbookPath: string | null;
  generationPolicy: string;
  startingFiles: TaskFile[];
  solutionFiles: TaskFile[];
};

const ADAPTER_ID = "workstreambench";
const DATASET_URL = "https://huggingface.co/datasets/namkoong-lab/mbabench-modeloff";
const DATASET_COMMIT = "867fb5395b8e3fc28606dc681ba5ea284340ddd2";
const EXPECTED_TASK_COUNT = 38;
const DEFAULT_OUTPUT_ROOT = ".tmp/official-benchmarks/proofloop-official-outputs/workstreambench";
const TASK_BUNDLE_PATH = "docs/eval/proofloop-official-task-bundles/workstreambench.json";
const OUTPUT_MANIFEST_PATH = "docs/eval/proofloop-official-outputs/workstreambench.json";
const SCORE_RECEIPT_PATH = "docs/eval/proofloop-official-scores/workstreambench.json";
const GENERATED_AT = optionValue("--generated-at") ?? new Date().toISOString();
const outputRoot = normalizeSlashes(optionValue("--output-root") ?? DEFAULT_OUTPUT_ROOT);
const absoluteOutputRoot = resolve(outputRoot);

const dataset = await fetchJson<HfDatasetInfo>(`https://huggingface.co/api/datasets/namkoong-lab/mbabench-modeloff`);
const tasks = collectTasks(dataset);
const blockers: string[] = [];

if (dataset.sha !== DATASET_COMMIT) {
  blockers.push(`Hugging Face dataset HEAD is ${dataset.sha ?? "missing"}; locked commit is ${DATASET_COMMIT}.`);
}
if (tasks.length !== EXPECTED_TASK_COUNT) {
  blockers.push(`Expected ${EXPECTED_TASK_COUNT} locked ModelOff tasks but discovered ${tasks.length}.`);
}

rmSync(absoluteOutputRoot, { recursive: true, force: true });
mkdirSync(absoluteOutputRoot, { recursive: true });

const cases: CaseEntry[] = [];
let sourceWorkbookBaselineCount = 0;
let generatedBlankWorkbookCount = 0;
let solutionWorkbookCount = 0;

for (const task of tasks) {
  const caseDir = join(absoluteOutputRoot, task.taskId);
  const sourceDir = join(caseDir, "source");
  const solutionDir = join(caseDir, "solution");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(solutionDir, { recursive: true });

  const aiAttemptPath = join(caseDir, "ai_attempt.xlsx");
  const sourceWorkbook = task.startingWorkbooks[0];
  let sourceWorkbookPath: string | null = null;
  if (sourceWorkbook) {
    sourceWorkbookPath = join(sourceDir, basenameFromRemotePath(sourceWorkbook.path));
    await downloadFile(sourceWorkbook.url, sourceWorkbookPath);
    copyFileSync(sourceWorkbookPath, aiAttemptPath);
    sourceWorkbookBaselineCount++;
  } else {
    await writeBlankAttemptWorkbook(aiAttemptPath, task);
    generatedBlankWorkbookCount++;
  }

  const solutionWorkbook = task.solutionWorkbooks[0];
  let solutionWorkbookPath: string | null = null;
  if (solutionWorkbook) {
    solutionWorkbookPath = join(solutionDir, basenameFromRemotePath(solutionWorkbook.path));
    await downloadFile(solutionWorkbook.url, solutionWorkbookPath);
    solutionWorkbookCount++;
  } else {
    blockers.push(`${task.taskId}: no solution workbook found in locked MBABench dataset metadata.`);
  }

  const entry: CaseEntry = {
    taskId: task.taskId,
    caseDir: rel(caseDir),
    aiAttemptPath: rel(aiAttemptPath),
    solutionDir: rel(solutionDir),
    solutionWorkbookPath: solutionWorkbookPath ? rel(solutionWorkbookPath) : null,
    sourceWorkbookPath: sourceWorkbookPath ? rel(sourceWorkbookPath) : null,
    generationPolicy: sourceWorkbook
      ? "No-model source-workbook baseline copied to ai_attempt.xlsx; proves official-format folder/export coverage only, not model quality."
      : "No-model blank baseline written to ai_attempt.xlsx because no starting workbook is present; proves folder/export coverage only, not model quality.",
    startingFiles: [...task.startingWorkbooks, ...task.startingPdfs],
    solutionFiles: task.solutionWorkbooks,
  };
  cases.push(entry);
  writeJson(join(caseDir, "case-manifest.json"), entry);
}

const complete = blockers.length === 0 &&
  cases.length === EXPECTED_TASK_COUNT &&
  cases.every((entry) => existsSync(join(process.cwd(), entry.aiAttemptPath))) &&
  solutionWorkbookCount === EXPECTED_TASK_COUNT;

const caseManifestPath = join(absoluteOutputRoot, "case-manifest.json");
writeJson(caseManifestPath, {
  schema: "proofloop-workstreambench-case-manifest-v1",
  adapterId: ADAPTER_ID,
  generatedAt: GENERATED_AT,
  status: complete ? "complete" : "partial",
  dataset: {
    url: DATASET_URL,
    commit: DATASET_COMMIT,
    observedHead: dataset.sha ?? null,
  },
  officialTaskCount: EXPECTED_TASK_COUNT,
  caseFolderCount: cases.length,
  aiAttemptWorkbookCount: cases.length,
  sourceWorkbookBaselineCount,
  generatedBlankWorkbookCount,
  solutionWorkbookCount,
  generationPolicy: "No model or judge/provider calls. ai_attempt.xlsx is a deterministic source-workbook/blank baseline that makes MBABench judge case-folder ingestion locally ready but does not claim model quality.",
  cases,
  blockers,
});

const outputManifest = {
  schema: "proofloop-official-output-manifest-v1",
  adapterId: ADAPTER_ID,
  status: complete ? "complete" : "partial",
  generatedAt: GENERATED_AT,
  officialTaskCount: EXPECTED_TASK_COUNT,
  outputTaskCount: cases.length,
  caseFolderCount: cases.length,
  aiAttemptWorkbookCount: cases.length,
  sourceWorkbookBaselineCount,
  generatedBlankWorkbookCount,
  solutionWorkbookCount,
  outputRoot,
  officialFormat: "MBABench judge case folder with ai_attempt.xlsx and solution/<solution>.xlsx, scored by judge/main_scripts/judge.py.",
  generationPolicy: "No-provider local scaffold: deterministic source-workbook baseline where available, blank workbook fallback otherwise. This proves case-folder/export coverage only and is not an official model score claim.",
  upstreamPipeline: {
    ran: false,
    exitCode: null,
    status: "skipped",
    noProviderSmokeCommand: "python judge/main_scripts/judge.py -f judge/scratch/test_cases/Bread_And_Butter --nocall",
    blocker: "Upstream MBABench judge was not run here because the repo is not vendored in this workspace and official scoring requires approved provider credentials/spend.",
  },
  blockers,
  evidence: [
    TASK_BUNDLE_PATH,
    "proofloop/benchmarks/workstreambench/scaffold-official-cases.ts",
    rel(caseManifestPath),
    outputRoot,
  ],
};

writeJson(OUTPUT_MANIFEST_PATH, outputManifest);
updateTaskBundle(cases);
updateScoreReceipt(outputManifest);

console.log(`${ADAPTER_ID}: ${outputManifest.status} caseFolders=${cases.length}/${EXPECTED_TASK_COUNT} ai_attempt=${cases.length}/${EXPECTED_TASK_COUNT} solutions=${solutionWorkbookCount}/${EXPECTED_TASK_COUNT} -> ${OUTPUT_MANIFEST_PATH}`);

function collectTasks(datasetInfo: HfDatasetInfo): WorkstreamTask[] {
  const grouped = new Map<string, WorkstreamTask>();
  for (const sibling of datasetInfo.siblings ?? []) {
    const path = sibling.rfilename;
    if (!path) continue;
    const match = /^task_(\d+)\/(starting_files|solution_files)\/(.+)$/.exec(path);
    if (!match) continue;
    const taskId = `task_${match[1]}`;
    const task = grouped.get(taskId) ?? {
      taskId,
      startingWorkbooks: [],
      startingPdfs: [],
      solutionWorkbooks: [],
    };
    const file = { path, url: hfResolveUrl(path) };
    const lower = path.toLowerCase();
    if (match[2] === "starting_files" && /\.(xlsx|xlsm)$/.test(lower)) task.startingWorkbooks.push(file);
    if (match[2] === "starting_files" && lower.endsWith(".pdf")) task.startingPdfs.push(file);
    if (match[2] === "solution_files" && /\.(xlsx|xlsm)$/.test(lower)) task.solutionWorkbooks.push(file);
    grouped.set(taskId, task);
  }
  return [...grouped.values()].sort((a, b) => taskIndex(a.taskId) - taskIndex(b.taskId));
}

async function writeBlankAttemptWorkbook(path: string, task: WorkstreamTask): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProofLoop";
  workbook.created = new Date(GENERATED_AT);
  const sheet = workbook.addWorksheet("ProofLoop Baseline");
  sheet.columns = [
    { header: "Field", key: "field", width: 36 },
    { header: "Value", key: "value", width: 120 },
  ];
  sheet.addRow({ field: "task_id", value: task.taskId });
  sheet.addRow({ field: "adapter_id", value: ADAPTER_ID });
  sheet.addRow({
    field: "generation_policy",
    value: "No model call; blank local scaffold to make MBABench case folder shape complete. Not an official score claim.",
  });
  sheet.addRow({
    field: "starting_pdf_count",
    value: String(task.startingPdfs.length),
  });
  mkdirSync(dirname(path), { recursive: true });
  await workbook.xlsx.writeFile(path);
}

function updateTaskBundle(cases: CaseEntry[]): void {
  const existing = readJson<Record<string, unknown>>(TASK_BUNDLE_PATH) ?? {};
  writeJson(TASK_BUNDLE_PATH, {
    ...existing,
    generatedAt: GENERATED_AT,
    officialTaskIds: cases.map((entry) => entry.taskId),
    localCaseScaffold: {
      status: cases.length === EXPECTED_TASK_COUNT ? "complete" : "partial",
      generatedAt: GENERATED_AT,
      outputManifestPath: OUTPUT_MANIFEST_PATH,
      outputRoot,
      caseFolderCount: cases.length,
      aiAttemptWorkbookCount: cases.length,
      solutionWorkbookCount,
      generationPolicy: "No-provider source-workbook/blank baseline. Official scorer remains unclaimed until accepted MBABench judge receipt is imported.",
    },
    claimGate: {
      scoreClaim: false,
      reason: "This lock plus localCaseScaffold proves public artifact discovery and no-provider MBABench case-folder export coverage. It does not prove model quality or an official LLM judge score.",
    },
  });
}

function updateScoreReceipt(manifest: Record<string, unknown>): void {
  const existing = readJson<Record<string, unknown>>(SCORE_RECEIPT_PATH) ?? {};
  const attempted = arrayStrings(existing.attempted)
    .filter((item) => !item.startsWith("Generated WorkstreamBench official-format"));
  const evidence = arrayStrings(existing.evidence);
  const blockers = arrayStrings(existing.blockers).filter((blocker) => !isCaseFolderBlocker(blocker) && !isProviderCredentialBlocker(blocker));
  writeJson(SCORE_RECEIPT_PATH, {
    ...existing,
    status: "blocked_external",
    generatedAt: GENERATED_AT,
    attempted: [
      ...new Set([
        ...attempted,
        `Generated WorkstreamBench official-format MBABench output manifest with ${EXPECTED_TASK_COUNT} expected tasks, ${String(manifest.outputTaskCount ?? 0)} case folders, ${String(manifest.aiAttemptWorkbookCount ?? 0)} ai_attempt.xlsx files, and ${String(manifest.solutionWorkbookCount ?? 0)} solution workbooks.`,
        "Did not run the official MBABench judge because provider credentials/spend were not approved for this no-spend pass.",
      ]),
    ],
    blockers: [
      ...new Set([
        ...blockers,
        "No accepted MBABench official judge/scorer receipt has been imported.",
        "The official MBABench LLM judge requires approved provider credentials/model calls for a claimable score; this pass intentionally made no paid provider calls.",
      ]),
    ],
    scoreClaim: false,
    officialOutputManifest: {
      path: OUTPUT_MANIFEST_PATH,
      status: manifest.status,
      officialTaskCount: manifest.officialTaskCount,
      outputTaskCount: manifest.outputTaskCount,
      predictionRowCount: null,
      contentPartsCount: null,
      caseFolderCount: manifest.caseFolderCount,
      aiAttemptWorkbookCount: manifest.aiAttemptWorkbookCount,
      solutionWorkbookCount: manifest.solutionWorkbookCount,
    },
    claimGate: {
      officialScoreClaimable: false,
      acceptedProxyJudge: false,
      providerSpendUsd: 0,
      reason: "Local MBABench case-folder/export scaffold is complete, but an accepted official judge/scorer receipt has not been imported.",
    },
    evidence: [
      ...new Set([
        ...evidence,
        OUTPUT_MANIFEST_PATH,
        TASK_BUNDLE_PATH,
        rel(caseManifestPath),
        outputRoot,
      ]),
    ],
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "user-agent": "noderoom-proofloop/1.0" } });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  return await response.json() as T;
}

async function downloadFile(url: string, path: string): Promise<void> {
  const response = await fetch(url, { headers: { "user-agent": "noderoom-proofloop/1.0" } });
  if (!response.ok) throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function hfResolveUrl(path: string): string {
  return `${DATASET_URL}/resolve/${DATASET_COMMIT}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function isCaseFolderBlocker(blocker: string): boolean {
  const text = blocker.toLowerCase();
  return text.includes("no noderoom official-format mbabench case folders") ||
    text.includes("no noderoom candidate ai_attempt.xlsx") ||
    text.includes("case folders or candidate ai_attempt.xlsx");
}

function isProviderCredentialBlocker(blocker: string): boolean {
  const text = blocker.toLowerCase();
  return text.includes("official mbabench llm judge requires") &&
    (text.includes("provider credentials") || text.includes("paid provider"));
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function taskIndex(taskId: string): number {
  return Number(taskId.replace(/^task_/, ""));
}

function basenameFromRemotePath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function optionValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
