import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FRESH_ROOM_LATEST_FILENAME,
  FRESH_ROOM_PROOF_ROOT,
  readFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
  type FreshRoomProofValidation,
} from "../src/eval/freshRoomProofReceipts";

const args = process.argv.slice(2);
const root = optionValue("--root") ?? FRESH_ROOM_PROOF_ROOT;
const explicitPath = optionValue("--path");
const caseId = optionValue("--case");
const paths = explicitPath ? [explicitPath] : discoverProofPaths(root, caseId);

if (paths.length === 0) {
  console.error(`fresh-room proof verification failed: no ${FRESH_ROOM_LATEST_FILENAME} receipts found under ${root}`);
  process.exit(1);
}

const results: FreshRoomProofValidation[] = paths.map((path) => {
  const receipt = readFreshRoomProofReceipt(path);
  if (!receipt) return { ok: false, path, errors: ["receipt missing or invalid JSON"] };
  return validateFreshRoomProofReceipt(receipt, {
    path,
    caseId: caseId ?? receipt.caseId,
    requireFocusMode: true,
  });
});

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  const label = `${result.caseId ?? "unknown"} (${result.path ?? "unknown path"})`;
  if (result.ok) {
    console.log(`fresh-room proof ok: ${label}`);
  } else {
    console.error(`fresh-room proof invalid: ${label}`);
    for (const error of result.errors) console.error(`  - ${error}`);
  }
}

if (failed.length > 0) process.exit(1);

function discoverProofPaths(rootPath: string, onlyCaseId?: string): string[] {
  const absoluteRoot = resolve(process.cwd(), rootPath);
  if (!existsSync(absoluteRoot)) return [];
  const cases = onlyCaseId ? [onlyCaseId] : readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return cases
    .map((id) => join(rootPath, id, FRESH_ROOM_LATEST_FILENAME))
    .filter((path) => existsSync(resolve(process.cwd(), path)));
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
