import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  buildBtbLedgerImport,
  toConvexBtbLedgerPayload,
  type BankerToolBenchSweepSummary,
} from "../src/eval/bankerToolBenchEvalLedger";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/loop-ledger/btb-ledger-import-preview.json";
const writeConvex = args.includes("--write-convex");
const includeDryRun = args.includes("--include-dry-run");
const allSummaries = args.includes("--all-summaries");
const summaryPaths = optionValues("--summary");
const discovered = summaryPaths.length ? summaryPaths : discoverSummaryFiles({ includeDryRun, allSummaries });

if (!discovered.length) {
  throw new Error("No BTB sweep summaries found. Pass --summary <path> or run from the repo root.");
}

const summaries = discovered.map((path) => ({
  path,
  summary: readSummary(path),
}));
const ledger = buildBtbLedgerImport({ summaries });
writeJson(jsonOut, ledger);

console.log(`BTB ledger ingest preview: runs=${ledger.totals.runs} tasks=${ledger.totals.tasks} clean=${ledger.totals.cleanAcceptedTasks} mean=${ledger.totals.cleanMeanReward ?? "n/a"}`);
console.log(`wrote ${jsonOut}`);

if (writeConvex) {
  const convexUrl = optionValue("--convex-url") ?? process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  const ingestToken = optionValue("--ingest-token") ?? process.env.BTB_LEDGER_INGEST_TOKEN;
  if (!convexUrl) throw new Error("Missing Convex URL. Pass --convex-url or set CONVEX_URL/VITE_CONVEX_URL.");
  if (!ingestToken) throw new Error("Missing ingest token. Pass --ingest-token or set BTB_LEDGER_INGEST_TOKEN.");
  const client = new ConvexHttpClient(convexUrl);
  const actionRef = makeFunctionReference<"action">("evalLedgerIngest:ingestBankerToolBenchSummary") as any;
  const roomId = optionValue("--room-id");
  const roomCode = optionValue("--room-code") ?? "BTBLEDGER";
  const roomTitle = optionValue("--room-title") ?? "BankerToolBench Eval Ledger";
  const hostName = optionValue("--host-name") ?? "BTB Ledger";
  const hostAuthToken = optionValue("--host-auth-token") ?? process.env.BTB_LEDGER_ROOM_AUTH_TOKEN;
  for (const run of ledger.runs) {
    const result = await client.action(actionRef, {
      ingestToken,
      roomId,
      roomCode,
      roomTitle,
      hostName,
      hostAuthToken,
      payload: toConvexBtbLedgerPayload(run),
    });
    console.log(`ingested ${run.iterationLabel}: ${JSON.stringify(result)}`);
  }
}

function discoverSummaryFiles(options: { includeDryRun: boolean; allSummaries: boolean }): string[] {
  const evalDir = resolve("docs/eval");
  if (!existsSync(evalDir)) return [];
  return readdirSync(evalDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => options.allSummaries ? name.includes("btb") || name.includes("bankertoolbench") : name.startsWith("btb-clean-capability-"))
    .filter((name) => options.includeDryRun || !/dryrun/i.test(name))
    .map((name) => join(evalDir, name))
    .filter((path) => {
      try {
        const parsed = readSummary(path);
        return parsed.schema === "noderoom-btb-nodeagent-full-sweep-summary-v1" && Array.isArray(parsed.tasks);
      } catch {
        return false;
      }
    })
    .sort();
}

function readSummary(path: string): BankerToolBenchSweepSummary {
  const raw = readFileSync(path);
  const text = decodeJsonBuffer(raw);
  return JSON.parse(text) as BankerToolBenchSweepSummary;
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

function decodeJsonBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.swap16().toString("utf16le").replace(/^\uFEFF/, "");
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 200));
  let nulBytes = 0;
  for (const byte of sample) if (byte === 0) nulBytes++;
  if (nulBytes > sample.length / 4) return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}
