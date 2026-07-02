import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BENCHMARK_ADAPTER_IDS = ["bankertoolbench", "finch", "finauditing", "workstreambench"] as const;

export type BenchmarkAdapterId = (typeof BENCHMARK_ADAPTER_IDS)[number];

export type ProofloopBenchmarkAdapter = {
  schema: 1;
  id: BenchmarkAdapterId;
  source: Record<string, unknown>;
  taskLoader: string;
  seedInputsThroughUi: boolean;
  browserScenario: string;
  verifierCommand: string;
  expectedArtifacts: string[];
  scoringMode: "completion" | "semantic" | "hybrid";
  scoreFields: Array<"productPathCompletion" | "officialSemanticScore">;
  liveUserCommand: string;
};

const REQUIRED_LIVE_USER_ARTIFACTS = [
  "live-user-contract.json",
  "node-trace-v2.json",
  "node-eval.json",
  "scorecard.md",
  "cost-ledger.json",
  "verifier-receipt.json",
  "official-scorer-receipt.json",
];

export function readBenchmarkAdapter(id: BenchmarkAdapterId, root = process.cwd()): ProofloopBenchmarkAdapter {
  const path = benchmarkAdapterPath(id, root);
  if (!existsSync(path)) throw new Error(`Missing benchmark adapter: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8")) as ProofloopBenchmarkAdapter;
}

export function listBenchmarkAdapters(root = process.cwd()): ProofloopBenchmarkAdapter[] {
  return BENCHMARK_ADAPTER_IDS.map((id) => readBenchmarkAdapter(id, root));
}

export function benchmarkAdapterPath(id: BenchmarkAdapterId, root = process.cwd()): string {
  return join(root, "proofloop", "benchmarks", id, "adapter.json");
}

export function validateBenchmarkAdapter(adapter: ProofloopBenchmarkAdapter): string[] {
  const errors: string[] = [];
  if (adapter.schema !== 1) errors.push(`${adapter.id}: schema must be 1`);
  if (!BENCHMARK_ADAPTER_IDS.includes(adapter.id)) errors.push(`${adapter.id}: unknown adapter id`);
  if (!adapter.seedInputsThroughUi) errors.push(`${adapter.id}: benchmark inputs must be seeded through the UI`);
  if (!adapter.liveUserCommand.includes("--prod")) errors.push(`${adapter.id}: live command must include --prod`);
  if (!adapter.liveUserCommand.includes("--cockpit")) errors.push(`${adapter.id}: live command must include --cockpit`);
  if (!/--user-emulation(?:=|\s+)strict/.test(adapter.liveUserCommand)) errors.push(`${adapter.id}: live command must use strict user emulation`);
  if (!adapter.scoreFields.includes("productPathCompletion")) errors.push(`${adapter.id}: missing productPathCompletion score field`);
  if (!adapter.scoreFields.includes("officialSemanticScore")) errors.push(`${adapter.id}: missing officialSemanticScore score field`);
  for (const artifact of REQUIRED_LIVE_USER_ARTIFACTS) {
    if (!adapter.expectedArtifacts.includes(artifact)) errors.push(`${adapter.id}: missing expected artifact ${artifact}`);
  }
  return errors;
}
