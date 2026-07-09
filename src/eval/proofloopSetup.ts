import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scanBankerToolBenchBundle } from "./bankerToolBenchAdapter";
import { buildBankerToolBenchManifestLock } from "./bankerToolBenchManifestLock";
import {
  BENCHMARK_ADAPTER_IDS,
  readBenchmarkAdapter,
  type BenchmarkAdapterId,
} from "./proofloopBenchmarkAdapters";
import {
  loadExternalBenchmarkLocalTasks,
  type ExternalBenchmarkAdapterId,
} from "../../proofloop/benchmarks/common/local-tasks";

export type ProofloopSetupStatus = "ready" | "needs_download" | "blocked" | "needs_local_adapter_implementation";

export type ProofloopSetupReceipt = {
  schema: 1;
  adapterId: string;
  generatedAt: string;
  productRule: string;
  status: ProofloopSetupStatus;
  root?: string;
  dataset?: string;
  revision?: string;
  taskIds: string[];
  downloadedFiles: string[];
  fixtureFiles?: string[];
  manifestLockfile?: string;
  totalBytes: number;
  message: string;
  requiredFiles?: string[];
  nextCommands: string[];
  scan?: unknown;
};

export type ProofloopSetupOptions = {
  adapterId: string;
  projectRoot?: string;
  fixtureRoot?: string;
  dataset?: string;
  revision?: string;
  limit?: number;
  maxBytes?: number;
  taskId?: string;
  allowDownload?: boolean;
  generatedAt?: string;
};

export async function setupProofloopAdapter(options: ProofloopSetupOptions): Promise<ProofloopSetupReceipt> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  if (options.adapterId === "bankertoolbench") return setupBankerToolBench(projectRoot, options);
  if (isExternalBenchmarkAdapterId(options.adapterId)) return setupExternalLocalAdapter(projectRoot, options.adapterId, options.generatedAt ?? new Date().toISOString());
  return setupUnsupportedAdapter(projectRoot, options.adapterId, options.generatedAt ?? new Date().toISOString());
}

export function setupReceiptPath(projectRoot: string, adapterId: string): string {
  return join(projectRoot, ".proofloop", "setup", `${adapterId}-local-setup.json`);
}

async function setupBankerToolBench(projectRoot: string, options: ProofloopSetupOptions): Promise<ProofloopSetupReceipt> {
  const fixtureRoot = resolve(projectRoot, options.fixtureRoot ?? ".tmp/official-benchmarks/btb-fixture");
  const dataset = options.dataset ?? "handshake-ai-research/bankertoolbench";
  const revision = options.revision ?? "main";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const limit = Math.max(1, options.limit ?? 1);
  const maxBytes = options.maxBytes ?? 250_000_000;
  mkdirSync(fixtureRoot, { recursive: true });

  const existing = tryScanBtb(fixtureRoot);
  if (existing.ok) {
    const manifestLockfile = writeBtbManifestLock(projectRoot, fixtureRoot, revision, generatedAt);
    const fixtureFiles = listBtbFixtureFiles(fixtureRoot, existing.taskIds);
    return writeSetupReceipt(projectRoot, btbSetupReceipt({
      projectRoot,
      generatedAt,
      status: "ready",
      fixtureRoot,
      dataset,
      revision,
      taskIds: existing.taskIds,
      downloadedFiles: [],
      fixtureFiles,
      manifestLockfile,
      totalBytes: totalRelativeFileBytes(fixtureRoot, fixtureFiles),
      message: "Existing local BankerToolBench fixture scanned successfully.",
      scan: existing.scan,
    }));
  }

  if (!options.allowDownload) {
    return writeSetupReceipt(projectRoot, btbSetupReceipt({
      projectRoot,
      generatedAt,
      status: "needs_download",
      fixtureRoot,
      dataset,
      revision,
      taskIds: [],
      downloadedFiles: [],
      totalBytes: 0,
      message: "Local fixture is missing. Re-run with --allow-download to fetch an official-shaped subset locally.",
    }));
  }

  const tree = await fetchHfDatasetTree(dataset, revision);
  const tasksJsonlEntry = tree.find((entry) => entry.type === "file" && entry.path === "tasks.jsonl");
  if (!tasksJsonlEntry) {
    return writeSetupReceipt(projectRoot, btbSetupReceipt({
      projectRoot,
      generatedAt,
      status: "blocked",
      fixtureRoot,
      dataset,
      revision,
      taskIds: [],
      downloadedFiles: [],
      totalBytes: 0,
      message: `Hugging Face dataset ${dataset}@${revision} does not expose tasks.jsonl.`,
    }));
  }

  await downloadHfFile({ dataset, revision, filePath: "tasks.jsonl", root: fixtureRoot, expectedSize: tasksJsonlEntry.size });
  const rows = readJsonlObjects(join(fixtureRoot, "tasks.jsonl"));
  const selectedTaskIds = selectBtbTaskIds(rows, tree, { taskId: options.taskId, limit });
  const files = tree
    .filter((entry) => entry.type === "file")
    .filter((entry) =>
      entry.path === "tasks.jsonl" ||
      selectedTaskIds.some((id) => entry.path.startsWith(`task-data/${id}/`) || entry.path.startsWith(`golden-outputs/${id}/`)),
    );
  const totalBytes = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  if (totalBytes > maxBytes) {
    return writeSetupReceipt(projectRoot, btbSetupReceipt({
      projectRoot,
      generatedAt,
      status: "blocked",
      fixtureRoot,
      dataset,
      revision,
      taskIds: selectedTaskIds,
      downloadedFiles: [],
      totalBytes,
      message: `Selected local fixture is ${totalBytes} bytes, above --max-bytes ${maxBytes}.`,
    }));
  }

  const downloadedFiles: string[] = [];
  for (const entry of files) {
    const downloaded = await downloadHfFile({ dataset, revision, filePath: entry.path, root: fixtureRoot, expectedSize: entry.size });
    if (downloaded) downloadedFiles.push(entry.path);
  }
  writeSelectedBtbTasksJsonl(fixtureRoot, rows, selectedTaskIds);
  const scan = scanBankerToolBenchBundle(fixtureRoot, { includeTasks: false, sampleLimit: 3, generatedAt });
  const manifestLockfile = writeBtbManifestLock(projectRoot, fixtureRoot, revision, generatedAt);
  return writeSetupReceipt(projectRoot, btbSetupReceipt({
    projectRoot,
    generatedAt,
    status: "ready",
    fixtureRoot,
    dataset,
    revision,
    taskIds: selectedTaskIds,
    downloadedFiles,
    fixtureFiles: files.map((entry) => entry.path),
    manifestLockfile,
    totalBytes,
    message: `Downloaded and verified ${selectedTaskIds.length} local BankerToolBench task fixture(s).`,
    scan,
  }));
}

function setupUnsupportedAdapter(projectRoot: string, adapterId: string, generatedAt: string): ProofloopSetupReceipt {
  const adapter = isBenchmarkAdapterId(adapterId) ? readBenchmarkAdapterIfExists(adapterId, projectRoot) : undefined;
  return writeSetupReceipt(projectRoot, {
    schema: 1,
    adapterId,
    generatedAt,
    productRule: "Proof Loop records setup and doctor attempts before declaring an external benchmark blocked.",
    status: "needs_local_adapter_implementation",
    taskIds: [],
    downloadedFiles: [],
    totalBytes: 0,
    requiredFiles: adapter
      ? [
          adapter.taskLoader,
          adapter.browserScenario,
          adapter.verifierCommand,
          ...adapter.expectedArtifacts,
        ].filter(Boolean)
      : [`proofloop/benchmarks/${adapterId}/adapter.json`],
    message: `${adapterId} does not have a local setup recipe yet.`,
    nextCommands: [
      `Complete proofloop/benchmarks/${adapterId}/adapter.json and local setup recipe.`,
      `Run npm run proofloop -- setup ${adapterId} --doctor.`,
      `Run npm run benchmark:proofloop:external-adapter-live-room -- --id ${adapterId} --prod --user-emulation strict.`,
      `Run npm run benchmark:proofloop:adapter-blockers -- --id ${adapterId} --strict.`,
    ],
  });
}

function setupExternalLocalAdapter(projectRoot: string, adapterId: ExternalBenchmarkAdapterId, generatedAt: string): ProofloopSetupReceipt {
  const adapter = readBenchmarkAdapterIfExists(adapterId, projectRoot);
  const tasks = loadExternalBenchmarkLocalTasks(adapterId);
  const expectedFiles = [
    `proofloop/benchmarks/${adapterId}/adapter.json`,
    adapter?.taskLoader ?? `proofloop/benchmarks/${adapterId}/load-tasks.ts`,
    adapter?.browserScenario ?? `proofloop/benchmarks/${adapterId}/browser-scenario.spec.ts`,
    ...tasks.flatMap((task) => task.inputRefs),
  ].filter((file): file is string => Boolean(file));
  const missingFiles = expectedFiles.filter((file) => !existsSync(join(projectRoot, ...file.split("/"))));
  const manifestRelativePath = `.proofloop/setup/${adapterId}-local-task-manifest.json`;
  const manifestPath = join(projectRoot, ...manifestRelativePath.split("/"));
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    schema: "proofloop-external-local-task-manifest-v1",
    adapterId,
    generatedAt,
    tasks,
  }, null, 2)}\n`, "utf8");

  return writeSetupReceipt(projectRoot, {
    schema: 1,
    adapterId,
    generatedAt,
    productRule: "Proof Loop validates local proxy benchmark task adapters before declaring external benchmark lanes blocked.",
    status: missingFiles.length ? "blocked" : "ready",
    taskIds: tasks.map((task) => task.taskId),
    downloadedFiles: [],
    fixtureFiles: [manifestRelativePath, ...expectedFiles],
    manifestLockfile: manifestRelativePath,
    totalBytes: totalRelativeFileBytes(projectRoot, expectedFiles.filter((file) => !missingFiles.includes(file))),
    requiredFiles: missingFiles.length ? missingFiles : undefined,
    message: missingFiles.length
      ? `${adapterId} local setup is missing ${missingFiles.length} required file(s).`
      : `${adapterId} local proxy task adapter is ready with ${tasks.length} task(s).`,
    nextCommands: [
      `npm run proofloop -- setup ${adapterId} --strict`,
      `npm run benchmark:proofloop:external-adapter-live-room -- --id ${adapterId} --prod --user-emulation strict`,
      `npm run benchmark:proofloop:adapter-blockers -- --id ${adapterId} --strict`,
    ],
    scan: {
      taskCount: tasks.length,
      taskIds: tasks.map((task) => task.taskId),
      officialScoreClaim: false,
      missingFiles,
    },
  });
}

function readBenchmarkAdapterIfExists(adapterId: BenchmarkAdapterId, projectRoot: string) {
  try {
    return readBenchmarkAdapter(adapterId, projectRoot);
  } catch {
    try {
      return readBenchmarkAdapter(adapterId, process.cwd());
    } catch {
      return undefined;
    }
  }
}

function btbSetupReceipt(args: {
  projectRoot: string;
  generatedAt: string;
  status: "ready" | "needs_download" | "blocked";
  fixtureRoot: string;
  dataset: string;
  revision: string;
  taskIds: string[];
  downloadedFiles: string[];
  fixtureFiles?: string[];
  manifestLockfile?: string;
  totalBytes: number;
  message: string;
  scan?: unknown;
}): ProofloopSetupReceipt {
  return {
    schema: 1,
    adapterId: "bankertoolbench",
    generatedAt: args.generatedAt,
    productRule: "Proof Loop guides the coding agent to set up local fixtures before declaring external blockers.",
    root: rel(args.projectRoot, args.fixtureRoot),
    dataset: args.dataset,
    revision: args.revision,
    status: args.status,
    taskIds: args.taskIds,
    downloadedFiles: args.downloadedFiles,
    fixtureFiles: args.fixtureFiles,
    manifestLockfile: args.manifestLockfile,
    totalBytes: args.totalBytes,
    message: args.message,
    nextCommands: [
      "npm run proofloop -- setup bankertoolbench --allow-download --limit 1",
      "npm run proofloop -- setup bankertoolbench --doctor",
      "npm run proofloop -- run bankertoolbench --prod --user-emulation strict --cockpit",
    ],
    scan: args.scan,
  };
}

function writeSetupReceipt(projectRoot: string, receipt: ProofloopSetupReceipt): ProofloopSetupReceipt {
  const path = setupReceiptPath(projectRoot, receipt.adapterId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}

type HfTreeEntry = {
  type: "file" | "directory";
  path: string;
  size?: number;
};

async function fetchHfDatasetTree(dataset: string, revision: string): Promise<HfTreeEntry[]> {
  const url = `https://huggingface.co/api/datasets/${dataset}/tree/${revision}?recursive=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hugging Face tree fetch failed (${response.status}): ${url}`);
  return await response.json() as HfTreeEntry[];
}

async function downloadHfFile(args: {
  dataset: string;
  revision: string;
  filePath: string;
  root: string;
  expectedSize?: number;
}): Promise<boolean> {
  const { dataset, revision, filePath, root, expectedSize } = args;
  const output = join(root, filePath);
  if (existsSync(output) && (expectedSize === undefined || statSync(output).size === expectedSize)) return false;
  const url = `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hugging Face file download failed (${response.status}): ${filePath}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  return true;
}

function readJsonlObjects(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function selectBtbTaskIds(
  rows: Array<Record<string, unknown>>,
  tree: HfTreeEntry[],
  options: { taskId?: string; limit: number },
): string[] {
  const taskIdsWithInputs = new Set(
    tree
      .filter((entry) => entry.type === "file" && /^task-data\/[^/]+\/Inputs?\//i.test(entry.path))
      .map((entry) => entry.path.split("/")[1])
      .filter(Boolean),
  );
  const requested = options.taskId ? [options.taskId] : [];
  const candidates = requested.length
    ? rows.filter((row) => requested.includes(String(row.task_id ?? "")))
    : rows.filter((row) => typeof row.final_prompt === "string" && taskIdsWithInputs.has(String(row.task_id ?? "")));
  const selected = candidates
    .map((row) => String(row.task_id ?? ""))
    .filter(Boolean)
    .slice(0, Math.max(1, options.limit));
  if (!selected.length) throw new Error(options.taskId ? `BTB task not found or has no input files: ${options.taskId}` : "No BTB task with input files found");
  return selected;
}

function writeSelectedBtbTasksJsonl(root: string, rows: Array<Record<string, unknown>>, selectedTaskIds: string[]): void {
  const selected = rows.filter((row) => selectedTaskIds.includes(String(row.task_id ?? "")));
  writeFileSync(join(root, "tasks.jsonl"), `${selected.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function writeBtbManifestLock(projectRoot: string, root: string, revision: string, generatedAt: string): string {
  const relativePath = ".proofloop/setup/bankertoolbench-manifest-lock.json";
  const manifestLockfile = join(projectRoot, ...relativePath.split("/"));
  const manifest = buildBankerToolBenchManifestLock(root, { generatedAt, datasetRevision: revision });
  mkdirSync(dirname(manifestLockfile), { recursive: true });
  writeFileSync(manifestLockfile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return relativePath;
}

function tryScanBtb(root: string): { ok: boolean; taskIds: string[]; scan?: unknown } {
  try {
    const report = scanBankerToolBenchBundle(root, { includeTasks: true, sampleLimit: 3 });
    const missingTaskData = report.warnings.some((warning) => /missing task-data directory/i.test(warning));
    const taskIds = (report.tasks ?? [])
      .filter((task) => task.agentTask.inputFiles.length > 0 && task.agentTask.instruction.trim())
      .slice(0, 3)
      .map((task) => task.id);
    return { ok: taskIds.length > 0 && !missingTaskData, taskIds, scan: report };
  } catch {
    return { ok: false, taskIds: [] };
  }
}

function listBtbFixtureFiles(root: string, taskIds: string[]): string[] {
  const files = new Set<string>();
  if (existsSync(join(root, "tasks.jsonl"))) files.add("tasks.jsonl");
  for (const taskId of taskIds) {
    collectRelativeFiles(root, `task-data/${taskId}`, files);
    collectRelativeFiles(root, `golden-outputs/${taskId}`, files);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

function collectRelativeFiles(root: string, relativeDir: string, out: Set<string>): void {
  const dir = join(root, relativeDir);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRelative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) collectRelativeFiles(root, childRelative, out);
    else if (entry.isFile()) out.add(childRelative.replace(/\\/g, "/"));
  }
}

function totalRelativeFileBytes(root: string, files: string[]): number {
  return files.reduce((sum, file) => {
    const absolute = join(root, file);
    return existsSync(absolute) && statSync(absolute).isFile() ? sum + statSync(absolute).size : sum;
  }, 0);
}

function isBenchmarkAdapterId(adapterId: string): adapterId is BenchmarkAdapterId {
  return BENCHMARK_ADAPTER_IDS.includes(adapterId as BenchmarkAdapterId);
}

function isExternalBenchmarkAdapterId(adapterId: string): adapterId is ExternalBenchmarkAdapterId {
  return adapterId === "finch" || adapterId === "finauditing" || adapterId === "workstreambench";
}

function rel(projectRoot: string, absolutePath: string): string {
  return absolutePath.startsWith(projectRoot) ? absolutePath.slice(projectRoot.length + 1).replace(/\\/g, "/") : absolutePath.replace(/\\/g, "/");
}
