import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofReleaseBundle,
  renderProofReleaseDossier,
  renderReadmeProofRelease,
  renderSocialProofRelease,
  type JsonRecord,
} from "../src/eval/proofReleasePublishing";

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const writeReadme = args.has("--write-readme") || check;
const generatedAt = new Date().toISOString();
const packageJson = readJson("package.json");
const bundle = buildProofReleaseBundle({
  generatedAt,
  packageVersion: String(packageJson.version),
  gitCommit: gitCommit(),
  goalLedger: readJson("docs/eval/proofloop-goal-ledger.json"),
  coverage: readJson("docs/eval/official-benchmark-task-coverage.json"),
  spreadsheetReports: [
    report(
      "spreadsheetbench-v1",
      "SpreadsheetBench V1",
      "docs/eval/spreadsheetbench-v1-912-model-run.json",
      "docs/eval/spreadsheetbench-v1-accepted-official-scorer-receipt.json",
    ),
    report("spreadsheetbench-verified-400", "SpreadsheetBench Verified400", "docs/eval/spreadsheetbench-v1-verified-400-model-run.json"),
    report(
      "spreadsheetbench-v2",
      "SpreadsheetBench V2",
      "docs/eval/spreadsheetbench-v2-321-model-run.json",
      "docs/eval/spreadsheetbench-v2-accepted-official-scorer-receipt.json",
    ),
  ],
  officialScores: [
    score("finauditing", "FinAuditing", 332, "FinMR rows"),
    score("workstreambench", "MBABench", 38, "cases"),
    score("finch", "Finch / FinWorkBench", 172, "tasks"),
  ],
  validation: readJson("docs/eval/proof-release-validation.json"),
  personaDogfood: readJson("docs/eval/noderoom-persona-dogfood-receipt.json"),
  mediaJudge: readJson("episodes/noderoom-proof-release-v1/judge.json"),
});

const outputs = new Map<string, string>([
  ["docs/release/noderoom-proof-release.json", `${JSON.stringify(bundle, null, 2)}\n`],
  ["docs/release/NODEROOM_PROOF_RELEASE.md", `${renderProofReleaseDossier(bundle)}\n`],
  ["docs/release/NODEROOM_SOCIAL_COPY.md", `${renderSocialProofRelease(bundle)}\n`],
]);

if (writeReadme) {
  const readmePath = resolve("README.md");
  const readme = readFileSync(readmePath, "utf8");
  const start = "<!-- proof-release:start -->";
  const end = "<!-- proof-release:end -->";
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) throw new Error("README proof-release markers are missing or out of order.");
  outputs.set("README.md", `${readme.slice(0, startIndex)}${start}\n${renderReadmeProofRelease(bundle)}\n${end}${readme.slice(endIndex + end.length)}`);
}

const mismatches: string[] = [];
for (const [path, content] of outputs) {
  const absolute = resolve(path);
  if (check) {
    const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    if (normalizeGeneratedAt(existing) !== normalizeGeneratedAt(content)) mismatches.push(path);
    continue;
  }
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  console.log(`wrote ${path}`);
}

if (mismatches.length) {
  throw new Error(`Proof release artifacts are stale: ${mismatches.join(", ")}. Run npm run proofs:publish.`);
}
if (check) console.log("proof release artifacts: current");
console.log(`proof release publication status: ${bundle.publication.status}`);

function report(id: string, title: string, path: string, officialReceiptPath?: string) {
  return {
    id,
    title,
    path,
    report: readJson(path),
    officialRequired: Boolean(officialReceiptPath),
    ...(officialReceiptPath ? { officialReceiptPath, officialReceipt: readJson(officialReceiptPath) } : {}),
  };
}

function score(id: "finauditing" | "workstreambench" | "finch", title: string, expectedCount: number, unit: string) {
  return {
    id,
    title,
    expectedCount,
    unit,
    path: `docs/eval/proofloop-official-scores/${id}.json`,
    receipt: readJson(`docs/eval/proofloop-official-scores/${id}.json`),
    output: readJson(`docs/eval/proofloop-official-outputs/${id}.json`),
  };
}

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as JsonRecord;
}

function gitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function normalizeGeneratedAt(value: string): string {
  return value.replace(/"generatedAt": "[^"]+"/g, '"generatedAt": "<generated>"').replace(/^Generated: .+$/gm, "Generated: <generated>");
}
