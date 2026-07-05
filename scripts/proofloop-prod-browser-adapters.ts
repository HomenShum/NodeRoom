import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopProdBrowserAdapterLedger,
  renderProofloopProdBrowserAdapterLedgerMarkdown,
} from "../src/eval/proofloopProdBrowserAdapters";

const args = process.argv.slice(2);
const generatedAt = new Date().toISOString();
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-prod-browser-adapters.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_PROD_BROWSER_ADAPTERS.md";
const models = optionValues("--model")
  .flatMap((value) => value.split(","))
  .concat(optionValue("--models")?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);

const ledger = buildProofloopProdBrowserAdapterLedger({
  generatedAt,
  models: models.length ? [...new Set(models)] : undefined,
});

writeJson(jsonOut, ledger);
writeText(mdOut, renderProofloopProdBrowserAdapterLedgerMarkdown(ledger));

console.log(`proofloop prod browser adapters: ${ledger.summary.adaptersTracked} contracts, ${ledger.summary.browserScenarioMissing} browser scenarios missing`);
console.log(`harness version: ${ledger.harnessVersion}`);
console.log(`covered attempts: ${ledger.summary.modelTaskAttemptsCoveredByContracts}`);
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const absolute = resolve(path);
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

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }
    }
  }
  return values;
}
