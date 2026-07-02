import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopHarnessEconomicsLedger,
  renderProofloopHarnessEconomicsMarkdown,
} from "../src/eval/proofloopHarnessEconomics";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-harness-economics.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_HARNESS_ECONOMICS.md";
const strict = args.includes("--strict");

const ledger = buildProofloopHarnessEconomicsLedger({ generatedAt: new Date().toISOString() });
writeJson(jsonOut, ledger);
writeText(mdOut, renderProofloopHarnessEconomicsMarkdown(ledger));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop harness economics: files=${ledger.summary.harnessFilesTracked}, ` +
  `missing=${ledger.summary.missingHarnessFiles}, ` +
  `openrouterCandidates=${ledger.summary.openRouterCandidates}, ` +
  `proxyJudgeCandidates=${ledger.summary.proxyJudgeCandidates}, ` +
  `cheaperProxyRoutes=${ledger.summary.cheaperProxyRoutesAvailable}`,
);

if (strict && (ledger.summary.missingHarnessFiles > 0 || ledger.summary.proxyJudgeCandidates === 0)) {
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
