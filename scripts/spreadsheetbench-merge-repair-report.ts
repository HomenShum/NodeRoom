import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  assertSpreadsheetBenchMergeOutputPaths,
  mergeSpreadsheetBenchRepairReport,
} from "../src/eval/spreadsheetBenchReportRepair";
import type {
  SpreadsheetBenchSidecarFileEvidence,
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
} from "../src/eval/spreadsheetBenchRunner";

const args = process.argv.slice(2);
const baseReportPath = requiredOption("--base-report");
const baseRunRoot = requiredOption("--base-run-root");
const repairReportPath = requiredOption("--repair-report");
const repairRunRoot = requiredOption("--repair-run-root");
const replacementTaskIdsPath = requiredOption("--task-ids-file");
const outputRunRoot = requiredOption("--output-run-root");
const jsonOut = requiredOption("--json-out");
const receiptOut = requiredOption("--receipt-out");

const baseReportAbsolute = resolve(baseReportPath);
const repairReportAbsolute = resolve(repairReportPath);
const replacementTaskIdsAbsolute = resolve(replacementTaskIdsPath);
const baseRoot = resolve(baseRunRoot);
const repairRoot = resolve(repairRunRoot);
const outputRoot = resolve(outputRunRoot);
const reportOutput = resolve(jsonOut);
const receiptOutput = resolve(receiptOut);
assertInPlaceRunRoot(outputRoot, baseRoot, repairRoot);

const baseContent = readFileSync(baseReportAbsolute);
const repairContent = readFileSync(repairReportAbsolute);
const base = JSON.parse(baseContent.toString("utf8")) as SpreadsheetBenchRunnerReport;
const repair = JSON.parse(repairContent.toString("utf8")) as SpreadsheetBenchRunnerReport;
const replacementTaskIds = readTaskIds(replacementTaskIdsAbsolute);
assertRunRoot(baseRoot, base.outputRoot, "base");
assertRunRoot(repairRoot, repair.outputRoot, "repair");
assertRunRoot(outputRoot, basename(outputRoot), "output");

const generatedAt = new Date().toISOString();
const baseReportSha256 = sha256(baseContent);
const repairReportSha256 = sha256(repairContent);
const merged = mergeSpreadsheetBenchRepairReport({
  base,
  repair,
  replacementTaskIds,
  generatedAt,
  outputRoot: basename(outputRoot),
  baseReportSha256,
  repairReportSha256,
});

const repairIds = new Set(replacementTaskIds);
const verifiedArtifactDirectories: Array<{ taskId: string; source: "base" | "repair"; directory: string }> = [];
const seenArtifactDirectories = new Set<string>();
const protectedArtifactPaths: string[] = [];
for (const result of merged.results) {
  const source = repairIds.has(result.taskId) ? "repair" : "base";
  const verified = verifyResultArtifacts(outputRoot, result);
  const artifactDirectory = verified.directory;
  if (seenArtifactDirectories.has(artifactDirectory)) {
    throw new Error(`multiple tasks resolve to the same artifact directory: ${artifactDirectory}`);
  }
  seenArtifactDirectories.add(artifactDirectory);
  protectedArtifactPaths.push(...verified.files);
  verifiedArtifactDirectories.push({ taskId: result.taskId, source, directory: artifactDirectory });
}
assertSpreadsheetBenchMergeOutputPaths({
  reportOutput,
  receiptOutput,
  protectedPaths: [baseReportAbsolute, repairReportAbsolute, replacementTaskIdsAbsolute, ...protectedArtifactPaths],
});

const reportContent = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
mkdirSync(dirname(reportOutput), { recursive: true });
writeFileSync(reportOutput, reportContent);
const reportSha256 = sha256(reportContent);
const receipt = {
  schema: 1,
  kind: "spreadsheetbench-nodeagent-repair-merge",
  generatedAt,
  base: {
    report: rel(baseReportAbsolute),
    reportSha256: baseReportSha256,
    runRoot: rel(baseRoot),
    taskCount: base.taskCount,
  },
  repair: {
    report: rel(repairReportAbsolute),
    reportSha256: repairReportSha256,
    runRoot: rel(repairRoot),
    taskCount: repair.taskCount,
  },
  output: {
    report: rel(reportOutput),
    reportSha256,
    runRoot: rel(outputRoot),
    taskCount: merged.taskCount,
    authenticModelCalls: merged.harness.budget.modelCalls,
    providerCostUsd: merged.harness.budget.providerCostUsd,
  },
  replacementTaskIds,
  verifiedArtifactDirectories,
  invariants: {
    uniqueTaskIds: new Set(merged.results.map((result) => result.taskId)).size === merged.taskCount,
    toolPolicy: merged.harness.toolPolicy,
    evaluatorAccess: merged.harness.evaluatorAccess,
    officialProjectorUnchanged: true,
  },
};
mkdirSync(dirname(receiptOutput), { recursive: true });
writeFileSync(receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);

console.log(`merged ${replacementTaskIds.length} repaired tasks into ${merged.taskCount} results`);
console.log(`wrote ${rel(reportOutput)} sha256=${reportSha256}`);
console.log(`wrote ${rel(receiptOutput)}`);

function verifyResultArtifacts(root: string, result: SpreadsheetBenchRunnerTaskResult): { directory: string; files: string[] } {
  if (!result.candidateWorkbook) throw new Error(`candidate workbook is missing: ${result.taskId}`);
  const candidate = safeRelativePath(result.candidateWorkbook);
  const artifactDirectory = candidate.split("/")[0];
  if (!artifactDirectory) throw new Error(`candidate artifact directory is missing: ${result.taskId}`);
  const candidatePath = resolveWithin(root, candidate);
  if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
    throw new Error(`candidate workbook does not exist: ${result.taskId} ${candidate}`);
  }
  const files = [candidatePath];

  for (const evidence of resultEvidence(result)) {
    const path = safeRelativePath(evidence.path);
    if (path.split("/")[0] !== artifactDirectory) {
      throw new Error(`artifact evidence crosses task directories: ${result.taskId} ${path}`);
    }
    const absolute = resolveWithin(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`artifact evidence does not exist: ${result.taskId} ${path}`);
    }
    const content = readFileSync(absolute);
    if (content.length !== evidence.bytes || sha256(content) !== evidence.sha256.toLowerCase()) {
      throw new Error(`artifact evidence hash mismatch: ${result.taskId} ${path}`);
    }
    files.push(absolute);
  }
  return { directory: artifactDirectory, files };
}

function resultEvidence(result: SpreadsheetBenchRunnerTaskResult): SpreadsheetBenchSidecarFileEvidence[] {
  const sidecars = result.sidecarEvidence;
  if (!sidecars) throw new Error(`sidecar evidence is missing: ${result.taskId}`);
  const evidence = [
    requireFileEvidence(result.scorerReceipt, `${result.taskId} scorer receipt`),
    requireFileEvidence(sidecars.candidateManifest, `${result.taskId} candidate manifest`),
    requireFileEvidence(sidecars.nodeAgentReceipt, `${result.taskId} NodeAgent receipt`),
    requireFileEvidence(sidecars.nodeAgentTrace, `${result.taskId} NodeAgent trace`),
  ];
  const optionalFileKeys = [
    "agentWorkspaceManifest",
    "editPlan",
    "rawModelOutput",
    "workbookInspection",
    "editVerification",
    "candidateFinalization",
  ] as const;
  for (const key of optionalFileKeys) {
    const value = sidecars[key];
    if (value !== undefined) evidence.push(requireFileEvidence(value, `${result.taskId} ${key}`));
  }
  if (sidecars.repairOutputs !== undefined) {
    if (!Array.isArray(sidecars.repairOutputs)) throw new Error(`malformed repair outputs: ${result.taskId}`);
    for (const [index, value] of sidecars.repairOutputs.entries()) {
      evidence.push(requireFileEvidence(value, `${result.taskId} repair output ${index}`));
    }
  }
  return evidence;
}

function requireFileEvidence(value: unknown, label: string): SpreadsheetBenchSidecarFileEvidence {
  if (!isFileEvidence(value)) throw new Error(`malformed file evidence: ${label}`);
  return value;
}

function isFileEvidence(value: unknown): value is SpreadsheetBenchSidecarFileEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SpreadsheetBenchSidecarFileEvidence>;
  return typeof candidate.path === "string"
    && typeof candidate.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(candidate.sha256)
    && Number.isSafeInteger(candidate.bytes)
    && (candidate.bytes ?? -1) >= 0;
}

function readTaskIds(path: string): string[] {
  const value = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`--task-ids-file must contain a JSON array of non-empty strings: ${path}`);
  }
  const normalized = value.map((item) => (item as string).trim());
  if (new Set(normalized).size !== normalized.length) throw new Error(`--task-ids-file contains duplicates: ${path}`);
  return normalized;
}

function assertRunRoot(root: string, reportOutputRoot: string, label: string): void {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${label} run root does not exist: ${root}`);
  if (basename(root).toLowerCase() !== reportOutputRoot.toLowerCase()) {
    throw new Error(`${label} run root basename does not match report outputRoot: ${basename(root)} != ${reportOutputRoot}`);
  }
}

function assertInPlaceRunRoot(output: string, base: string, repair: string): void {
  if (output.toLowerCase() !== base.toLowerCase() || output.toLowerCase() !== repair.toLowerCase()) {
    throw new Error("base, repair, and output run roots must be the same because NodeAgent receipts bind absolute candidate paths");
  }
}

function safeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || isAbsolute(normalized) || normalized.split("/").some((part) => part === ".." || !part)) {
    throw new Error(`artifact path is not a safe relative path: ${path}`);
  }
  return normalized;
}

function resolveWithin(root: string, path: string): string {
  const absolute = resolve(root, safeRelativePath(path));
  const relativePath = relative(root, absolute);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`path escapes or resolves to the run root: ${path}`);
  }
  return absolute;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredOption(name: string): string {
  const value = optionValue(name);
  if (!value) {
    console.error([
      "Usage:",
      "  npm run benchmark:spreadsheetbench:merge-repair -- --base-report <report.json> --base-run-root <dir> --repair-report <report.json> --repair-run-root <same-dir> --task-ids-file <ids.json> --output-run-root <same-dir> --json-out <merged.json> --receipt-out <receipt.json>",
    ].join("\n"));
    process.exit(2);
  }
  return value;
}

function optionValue(name: string): string | undefined {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
