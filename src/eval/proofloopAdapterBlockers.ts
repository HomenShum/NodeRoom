import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BENCHMARK_ADAPTER_IDS,
  readBenchmarkAdapter,
  validateBenchmarkAdapter,
  type BenchmarkAdapterId,
  type ProofloopBenchmarkAdapter,
} from "./proofloopBenchmarkAdapters";

export type ExternalAdapterBlockerStatus = "ready" | "blocked_external";

export type ExternalAdapterBlockerReceipt = {
  schema: "proofloop-external-adapter-blocker-v1";
  adapterId: BenchmarkAdapterId;
  name: string;
  status: ExternalAdapterBlockerStatus;
  officialSourceUrls: string[];
  verifierCommand: string;
  liveUserCommand: string;
  missingImplementationFiles: string[];
  validationErrors: string[];
  blockers: string[];
  officialCommandPlan: string[];
  resumeCommands: string[];
  evidence: string[];
};

export function externalAdapterIds(): BenchmarkAdapterId[] {
  return BENCHMARK_ADAPTER_IDS.filter((id) => id !== "bankertoolbench");
}

export function buildExternalAdapterBlockerReceipt(args: {
  id: BenchmarkAdapterId;
  root?: string;
}): ExternalAdapterBlockerReceipt {
  const root = args.root ?? process.cwd();
  const adapter = readBenchmarkAdapter(args.id, root);
  const validationErrors = validateBenchmarkAdapter(adapter);
  const missingImplementationFiles = adapterImplementationFiles(adapter)
    .filter((file) => !existsSync(join(root, file)));
  const officialSourceUrls = adapterSourceUrls(adapter);
  const officialCommandPlan = officialCommandsFor(adapter);
  const blockers = [
    ...validationErrors,
    ...missingImplementationFiles.map((file) => `${adapter.id}: missing implementation file ${file}`),
    ...(officialCommandPlan.length ? [] : [`${adapter.id}: no official scorer command plan is registered.`]),
  ];

  return {
    schema: "proofloop-external-adapter-blocker-v1",
    adapterId: adapter.id,
    name: String(adapter.source.name ?? adapter.id),
    status: blockers.length ? "blocked_external" : "ready",
    officialSourceUrls,
    verifierCommand: adapter.verifierCommand,
    liveUserCommand: adapter.liveUserCommand,
    missingImplementationFiles,
    validationErrors,
    blockers,
    officialCommandPlan,
    resumeCommands: resumeCommandsFor(adapter),
    evidence: [
      `proofloop/benchmarks/${adapter.id}/adapter.json`,
      ...officialSourceUrls,
    ],
  };
}

export function adapterImplementationFiles(adapter: ProofloopBenchmarkAdapter): string[] {
  const files = [adapter.taskLoader, adapter.browserScenario];
  if (/\.tsx?$/.test(adapter.verifierCommand) && !adapter.verifierCommand.startsWith("npm ")) {
    files.push(adapter.verifierCommand);
  }
  return files;
}

function adapterSourceUrls(adapter: ProofloopBenchmarkAdapter): string[] {
  const urls: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) urls.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(adapter.source);
  return [...new Set(urls)].sort();
}

function officialCommandsFor(adapter: ProofloopBenchmarkAdapter): string[] {
  switch (adapter.id) {
    case "finch":
      return [
        "Clone/lock https://github.com/FinWorkBench/Finch and https://huggingface.co/datasets/FinWorkBench/Finch.",
        "Run the upstream Finch prompt_build_pipeline against the locked official task split.",
        "Run the upstream Finch call_gpt_judge scorer on NodeRoom output artifacts.",
        "Import the official judge JSON into docs/eval/proofloop-adapter-blockers/finch.json before claiming score.",
      ];
    case "finauditing":
      return [
        "Lock the official FinAuditing task source for FinSM, FinRE, and FinMR.",
        "Run NodeRoom generated answers through the upstream FinAuditing metric/scorer for every official split.",
        "Import the official scorer output into docs/eval/proofloop-adapter-blockers/finauditing.json before claiming score.",
      ];
    case "workstreambench":
      return [
        "Lock the official WorkstreamBench task bundle and scorer from the paper/supplementary source.",
        "Run every official workstream through NodeRoom live-user seeding and artifact export.",
        "Run the official WorkstreamBench scorer and import the result into docs/eval/proofloop-adapter-blockers/workstreambench.json before claiming score.",
      ];
    default:
      return [];
  }
}

function resumeCommandsFor(adapter: ProofloopBenchmarkAdapter): string[] {
  const refreshReceipt = `npm run benchmark:proofloop:adapter-blockers -- --id ${adapter.id}`;
  return [
    refreshReceipt,
    `implement ${adapter.taskLoader}`,
    `implement ${adapter.browserScenario}`,
    adapter.liveUserCommand,
    adapter.verifierCommand,
  ];
}
