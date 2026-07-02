import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopCompanyTaskCoverageReport,
  renderProofloopCompanyTaskCoverageMarkdown,
} from "../src/eval/proofloopCompanyTaskCoverage";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-company-task-coverage.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_COMPANY_TASK_COVERAGE.md";
const strictProdBrowser = args.includes("--strict-prod-browser");

const report = buildProofloopCompanyTaskCoverageReport({ generatedAt: new Date().toISOString() });
writeJson(jsonOut, report);
writeText(mdOut, renderProofloopCompanyTaskCoverageMarkdown(report));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop company tasks: entries=${report.summary.entries}, ` +
  `prodBrowser=${report.summary.prodBrowserProven}, ` +
  `prodRuntime=${report.summary.prodRuntimeProven}, ` +
  `ready=${report.summary.readyForProdBrowser}, ` +
  `externalClosed=${report.summary.externalPermissionOrClosed}`,
);

if (strictProdBrowser && report.entries.some((entry) =>
  entry.externalTargetStatus !== "closed_external" &&
  entry.externalTargetStatus !== "permission_required" &&
  entry.prodBrowserProof.status !== "prod_browser_proven"
)) {
  process.exitCode = 1;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
