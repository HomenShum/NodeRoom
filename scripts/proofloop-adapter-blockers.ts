import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildExternalAdapterBlockerReceipt,
  externalAdapterIds,
  type ExternalAdapterBlockerReceipt,
} from "../src/eval/proofloopAdapterBlockers";
import type { BenchmarkAdapterId } from "../src/eval/proofloopBenchmarkAdapters";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOutDir = optionValue("--json-out-dir") ?? "docs/eval/proofloop-adapter-blockers";
const ids = optionValues("--id") as BenchmarkAdapterId[];
const selectedIds = ids.length ? ids : externalAdapterIds();
const receipts = selectedIds.map((id) => buildExternalAdapterBlockerReceipt({ id }));

for (const receipt of receipts) {
  const path = join(jsonOutDir, `${receipt.adapterId}.json`);
  writeJson(path, receipt);
  console.log(`${receipt.adapterId}: ${receipt.status} (${receipt.blockers.length} blocker(s)) -> ${path}`);
}

if (strict && receipts.some((receipt) => receipt.status !== "ready")) process.exitCode = 1;

function writeJson(path: string, value: ExternalAdapterBlockerReceipt): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i++;
      }
    }
  }
  return values;
}
