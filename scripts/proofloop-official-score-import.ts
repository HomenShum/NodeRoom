import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildOfficialScoreImportReadiness,
  buildLocalOfficialScoreScaffoldReceipt,
  officialScoreReceiptPath,
  type OfficialScoreImportAdapterId,
} from "../src/eval/proofloopOfficialScoreReceipts";

const args = process.argv.slice(2);
const ids = optionValues("--id") as OfficialScoreImportAdapterId[];
const selectedIds: OfficialScoreImportAdapterId[] = ids.length ? ids : ["finch", "finauditing", "workstreambench"];
const input = optionValue("--input");
const jsonOut = optionValue("--json-out");
const jsonOutDir = optionValue("--json-out-dir");
const scaffoldLocal = args.includes("--scaffold-local");
const strict = args.includes("--strict");

if (input && selectedIds.length !== 1) {
  throw new Error("--input can only be used with exactly one --id");
}
if (jsonOut && selectedIds.length !== 1) {
  throw new Error("--json-out can only be used with exactly one --id");
}
if (input && scaffoldLocal) {
  throw new Error("--input cannot be combined with --scaffold-local");
}

if (scaffoldLocal) {
  for (const adapterId of selectedIds) {
    const path = officialScoreReceiptPath(adapterId);
    const receipt = buildLocalOfficialScoreScaffoldReceipt({ adapterId });
    writeJson(path, receipt);
    console.log(`${adapterId}: scaffolded blocked official-score receipt -> ${path}`);
  }
}

const receipts = selectedIds.map((adapterId) => {
  const receipt = buildOfficialScoreImportReadiness({
    adapterId,
    receiptPath: input ?? officialScoreReceiptPath(adapterId),
  });
  const path = jsonOut ?? join(jsonOutDir ?? "docs/eval/proofloop-official-score-imports", `${adapterId}.json`);
  writeJson(path, receipt);
  console.log(`${adapterId}: ${receipt.status} claimable=${receipt.officialScoreClaimable} blockers=${receipt.blockers.length} -> ${path}`);
  return receipt;
});

if (strict && receipts.some((receipt) => !receipt.officialScoreClaimable)) {
  process.exitCode = 1;
}

function writeJson(path: string, value: unknown): void {
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
