import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildOfficialScorePreflightReceipt,
  OFFICIAL_SCORE_PREFLIGHT_JSON,
  OFFICIAL_SCORE_PREFLIGHT_MARKDOWN,
  renderOfficialScorePreflightMarkdown,
} from "../src/eval/proofloopOfficialScorePreflight";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOut = optionValue("--json-out") ?? OFFICIAL_SCORE_PREFLIGHT_JSON;
const mdOut = optionValue("--md-out") ?? OFFICIAL_SCORE_PREFLIGHT_MARKDOWN;

const receipt = buildOfficialScorePreflightReceipt({
  root: process.cwd(),
  generatedAt: new Date().toISOString(),
});

writeJson(jsonOut, receipt);
writeText(mdOut, renderOfficialScorePreflightMarkdown(receipt));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop official-score preflight: ${receipt.status} ` +
  `checks=${receipt.summary.checksPassed}/${receipt.checks.length} ` +
  `lanes=${receipt.summary.lanesGuarded} ` +
  `preflightProviderSpendUsd=${receipt.preflightExecution.providerSpendUsd} ` +
  `acceptedReceiptProviderSpendUsd=${receipt.acceptedOfficialScoreReceipts.providerSpendUsd}`,
);

if (strict && receipt.status !== "pass") {
  for (const check of receipt.checks.filter((item) => item.status === "fail")) {
    console.error(`preflight failed: ${check.id} - ${check.detail}`);
  }
  process.exitCode = 1;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
