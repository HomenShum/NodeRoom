import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

type ProjectionReceipt = {
  schema: 1;
  track: "spreadsheetbench-v1";
  taskCount: number;
  caseCount: number;
  projectionErrorCount: number;
  caseManifestSha256: string;
  upstream?: {
    repository?: string;
    commit?: string;
    evaluator?: string;
    evaluatorSha256?: string;
  };
};

type UpstreamResult = {
  id: string | number;
  test_case_results: number[];
  soft_restriction: number;
  hard_restriction: number;
};

const args = process.argv.slice(2);
const projectionPath = resolve(requiredOption("--projection"));
const resultPath = resolve(requiredOption("--result"));
const upstreamRepo = resolve(requiredOption("--upstream-repo"));
const receiptOut = resolve(requiredOption("--receipt-out"));
const resultCopy = resolve(requiredOption("--result-copy"));
const projection = readJson<ProjectionReceipt>(projectionPath);
const results = readJson<UpstreamResult[]>(resultPath);
const evaluatorPath = resolve(upstreamRepo, "evaluation", "evaluation.py");

if (projection.schema !== 1 || projection.track !== "spreadsheetbench-v1") throw new Error("invalid V1 projection receipt");
if (projection.taskCount !== 912) throw new Error(`official V1 projection must contain 912 tasks, got ${projection.taskCount}`);
if (projection.caseCount !== 2729) throw new Error(`official V1 projection must contain 2729 published workbook pairs, got ${projection.caseCount}`);
if (projection.projectionErrorCount !== 0) throw new Error(`official V1 projection has ${projection.projectionErrorCount} application errors`);
if (!/^[a-f0-9]{64}$/i.test(projection.caseManifestSha256)) throw new Error("projection case manifest hash is invalid");
if (!existsSync(evaluatorPath)) throw new Error(`upstream evaluator is missing: ${evaluatorPath}`);
if (projection.upstream?.evaluatorSha256 !== sha256File(evaluatorPath)) throw new Error("upstream evaluator hash does not match projection receipt");
if (results.length !== 912) throw new Error(`upstream V1 result must contain 912 rows, got ${results.length}`);

const ids = new Set<string>();
let hardPassCount = 0;
let softTotal = 0;
let testCaseCount = 0;
for (const row of results) {
  const id = String(row.id);
  if (!id || ids.has(id)) throw new Error(`upstream result has missing or duplicate task id: ${id}`);
  ids.add(id);
  if (row.test_case_results.length !== 3 || row.test_case_results.some((value) => value !== 0 && value !== 1)) {
    throw new Error(`upstream result ${id} must contain exactly three binary test-case outcomes`);
  }
  const expectedSoft = row.test_case_results.reduce((sum, value) => sum + value, 0) / 3;
  const expectedHard = row.test_case_results.includes(0) ? 0 : 1;
  if (Math.abs(row.soft_restriction - expectedSoft) > 1e-12) throw new Error(`upstream result ${id} has inconsistent soft restriction`);
  if (row.hard_restriction !== expectedHard) throw new Error(`upstream result ${id} has inconsistent hard restriction`);
  hardPassCount += row.hard_restriction;
  softTotal += row.soft_restriction;
  testCaseCount += row.test_case_results.length;
}

const resultBytes = readFileSync(resultPath);
mkdirSync(dirname(resultCopy), { recursive: true });
writeFileSync(resultCopy, resultBytes);
const averageOverall = Number((softTotal / results.length).toFixed(8));
const passRate = Number((hardPassCount / results.length).toFixed(8));
writeJson(receiptOut, {
  schema: 1,
  verifier: "spreadsheetbench_official_scorer",
  track: "spreadsheetbench-v1",
  accepted: true,
  generatedAt: new Date().toISOString(),
  score: {
    averageOverall,
    passRate,
    passCount: hardPassCount,
    scoredTaskCount: results.length,
  },
  metric: {
    primary: "hard_restriction",
    hardRestrictionPassCount: hardPassCount,
    hardRestrictionPassRate: passRate,
    meanSoftRestriction: averageOverall,
    testCaseCount,
    publishedWorkbookPairCount: projection.caseCount,
    missingPublishedVariantSlotsScoredAsFailure: testCaseCount - projection.caseCount,
  },
  source: {
    kind: "upstream_official_evaluator",
    repository: projection.upstream?.repository,
    commit: projection.upstream?.commit,
    evaluator: rel(evaluatorPath),
    evaluatorSha256: sha256File(evaluatorPath),
    projectionReceipt: rel(projectionPath),
    projectionReceiptSha256: sha256File(projectionPath),
    caseManifestSha256: projection.caseManifestSha256,
    result: rel(resultCopy),
    resultSha256: sha256File(resultCopy),
    runtime: "Python 3 with PYTHONUTF8=1; upstream evaluation.py unmodified",
    command: "python evaluation.py --setting single --model noderoom --dataset noderoom_v1_912",
  },
  claimBoundary: "Canonical upstream V1 hard/soft workbook scorer over one model plan projected across all published workbook variants; no claim is made for SpreadsheetBench V2.",
});
console.log(`accepted SpreadsheetBench V1 official score: hard=${hardPassCount}/${results.length} soft=${averageOverall}`);
console.log(`wrote ${rel(receiptOut)}`);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredOption(name: string): string {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
