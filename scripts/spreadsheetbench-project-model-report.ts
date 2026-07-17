import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { SpreadsheetBenchRunnerReport } from "../src/eval/spreadsheetBenchRunner";
import { projectSpreadsheetBenchRunnerReport } from "../src/eval/spreadsheetBenchReportProjection";

const args = process.argv.slice(2);
const sourceReport = optionValue("--source-report");
const stageRoot = optionValue("--stage-root");
const jsonOut = optionValue("--json-out");
if (!sourceReport || !stageRoot || !jsonOut) {
  console.error("Usage: tsx scripts/spreadsheetbench-project-model-report.ts --source-report <full.json> --stage-root <subset-stage> --json-out <subset.json>");
  process.exit(2);
}

const sourcePath = resolve(sourceReport);
const stagePath = resolve(stageRoot);
const outPath = resolve(jsonOut);
if (!existsSync(sourcePath)) throw new Error(`source report does not exist: ${sourceReport}`);
if (!existsSync(stagePath)) throw new Error(`stage root does not exist: ${stageRoot}`);
const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8")) as SpreadsheetBenchRunnerReport;
const taskIds = stagedTaskIds(stagePath);
const projected = projectSpreadsheetBenchRunnerReport({
  source,
  taskIds,
  sourceReport: rel(sourcePath),
  sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  stageRoot: basename(stagePath),
  generatedAt: new Date().toISOString(),
});
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(projected, null, 2)}\n`, "utf8");
console.log(`projected ${projected.projection.projectedTaskCount}/${projected.projection.requestedTaskCount} exact task ids -> ${rel(outPath)}`);

function stagedTaskIds(root: string): string[] {
  const manifests = walkDirs(resolve(root, "tasks"))
    .map((taskDir) => resolve(taskDir, "agent", "task.json"))
    .filter(existsSync)
    .sort((a, b) => a.localeCompare(b));
  return manifests.map((path) => {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { taskId?: string };
    if (!manifest.taskId) throw new Error(`staged agent manifest has no taskId: ${rel(path)}`);
    return manifest.taskId;
  });
}

function walkDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const directories: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(root, entry.name);
    directories.push(path, ...walkDirs(path));
  }
  return directories;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
