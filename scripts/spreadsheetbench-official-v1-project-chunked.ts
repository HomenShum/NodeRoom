import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

type ProjectionShardReceipt = {
  schema: 1;
  generatedAt: string;
  track: "spreadsheetbench-v1";
  policy: string;
  stageRoot: string;
  modelOutputRoot: string;
  datasetRoot: string;
  taskOffset: number;
  totalTaskCount: number;
  taskCount: number;
  caseCount: number;
  projectionErrorCount: number;
  caseManifestSha256: string;
  upstream: Record<string, unknown>;
  errors: Array<{ taskId: string; caseIndex: number; message: string }>;
  cases: Array<Record<string, unknown>>;
};

const args = process.argv.slice(2);
const stageRoot = requiredOption("--stage-root");
const modelOutputRoot = requiredOption("--model-output-root");
const datasetRoot = resolve(requiredOption("--dataset-root"));
const upstreamRepo = requiredOption("--upstream-repo");
const receiptOut = resolve(requiredOption("--receipt-out"));
const chunkSize = numberOption("--chunk-size") ?? 40;
const resume = args.includes("--resume");
const taskCount = countTasks(resolve(stageRoot, "tasks"));
const shardRoot = resolve(datasetRoot, ".projection-shards");
mkdirSync(shardRoot, { recursive: true });

const shardReceipts: ProjectionShardReceipt[] = [];
for (let offset = 0, index = 1; offset < taskCount; offset += chunkSize, index += 1) {
  const limit = Math.min(chunkSize, taskCount - offset);
  shardReceipts.push(...await projectRange(offset, limit, String(index)));
}

async function projectRange(offset: number, limit: number, label: string): Promise<ProjectionShardReceipt[]> {
  const receiptPath = resolve(shardRoot, `receipt-${String(offset).padStart(4, "0")}-${String(limit).padStart(4, "0")}.json`);
  const datasetPath = resolve(shardRoot, `dataset-${String(offset).padStart(4, "0")}-${String(limit).padStart(4, "0")}.json`);
  if (resume && existsSync(receiptPath) && existsSync(datasetPath)) {
    const existing = readJson<ProjectionShardReceipt>(receiptPath);
    if (existing.taskOffset === offset && existing.taskCount === limit) {
      console.log(`projection shard ${label}: resumed offset=${offset} limit=${limit}`);
      return [existing];
    }
  }

  const childArgs = [
    resolve("node_modules", "tsx", "dist", "cli.mjs"),
    resolve("scripts", "spreadsheetbench-official-v1-project.ts"),
    "--stage-root", resolve(stageRoot),
    "--model-output-root", resolve(modelOutputRoot),
    "--dataset-root", datasetRoot,
    "--upstream-repo", resolve(upstreamRepo),
    "--receipt-out", receiptPath,
    "--offset", String(offset),
    "--limit", String(limit),
    ...(resume ? ["--resume"] : []),
  ];
  const exitCode = await runChild(process.execPath, childArgs);
  if (exitCode !== 0) {
    if (limit <= 1) throw new Error(`projection shard ${label} failed with exit code ${exitCode}`);
    const leftSize = Math.ceil(limit / 2);
    const rightSize = limit - leftSize;
    console.log(`projection shard ${label}: failed with exit code ${exitCode}; splitting ${limit} into ${leftSize}+${rightSize}`);
    return [
      ...await projectRange(offset, leftSize, `${label}.1`),
      ...await projectRange(offset + leftSize, rightSize, `${label}.2`),
    ];
  }
  const receipt = readJson<ProjectionShardReceipt>(receiptPath);
  if (receipt.taskOffset !== offset || receipt.taskCount !== limit) throw new Error(`projection shard ${label} receipt mismatch`);
  console.log(`projection shard ${label}: offset=${offset} limit=${limit} cases=${receipt.caseCount} errors=${receipt.projectionErrorCount}`);
  return [receipt];
}

shardReceipts.sort((a, b) => a.taskOffset - b.taskOffset);
const dataset = shardReceipts.flatMap((shard) => {
  const path = resolve(shardRoot, `dataset-${String(shard.taskOffset).padStart(4, "0")}-${String(shard.taskCount).padStart(4, "0")}.json`);
  return readJson<Array<Record<string, unknown>>>(path);
});
const ids = dataset.map((item) => String(item.id));
if (dataset.length !== taskCount || new Set(ids).size !== taskCount) {
  throw new Error(`projection aggregate requires ${taskCount} unique tasks, got ${dataset.length}/${new Set(ids).size}`);
}
const cases = shardReceipts.flatMap((shard) => shard.cases);
const errors = shardReceipts.flatMap((shard) => shard.errors);
const caseManifestSha256 = createHash("sha256")
  .update(JSON.stringify(cases.map((item) => [item.taskId, item.caseIndex, item.candidateSha256, item.goldSha256])))
  .digest("hex");
writeJson(resolve(datasetRoot, "dataset.json"), dataset);
writeJson(receiptOut, {
  schema: 1,
  generatedAt: new Date().toISOString(),
  track: "spreadsheetbench-v1",
  policy: "one model-generated edit plan projected across every official workbook variant in isolated shards",
  taskCount,
  caseCount: cases.length,
  projectionErrorCount: errors.length,
  caseManifestSha256,
  upstream: shardReceipts[0]?.upstream,
  shardCount: shardReceipts.length,
  shards: shardReceipts.map((shard) => ({
    taskOffset: shard.taskOffset,
    taskCount: shard.taskCount,
    caseCount: shard.caseCount,
    projectionErrorCount: shard.projectionErrorCount,
    caseManifestSha256: shard.caseManifestSha256,
  })),
  errors,
  cases,
});
console.log(`SpreadsheetBench V1 projection complete: tasks=${taskCount} cases=${cases.length} errors=${errors.length}`);
console.log(`wrote ${rel(receiptOut)}`);

function runChild(command: string, childArgs: string[]): Promise<number | null> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, childArgs, {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", resolveRun);
  });
}

function countTasks(root: string): number {
  if (!existsSync(root)) return 0;
  const entries = readdirSync(root, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = resolve(root, entry.name);
    if (existsSync(resolve(path, "agent", "task.json"))) count += 1;
    else count += countTasks(path);
  }
  return count;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredOption(name: string): string {
  const value = optionValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const value = optionValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive number`);
  return Math.trunc(parsed);
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
