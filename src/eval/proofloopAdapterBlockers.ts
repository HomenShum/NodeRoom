import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BENCHMARK_ADAPTER_IDS,
  readBenchmarkAdapter,
  validateBenchmarkAdapter,
  type BenchmarkAdapterId,
  type ProofloopBenchmarkAdapter,
} from "./proofloopBenchmarkAdapters";
import {
  isOfficialOutputExporterBlocker,
  officialOutputManifestComplete,
  officialOutputManifestEvidence,
  readOfficialOutputManifest,
} from "./proofloopOfficialOutputManifests";
import {
  buildOfficialScoreImportReadiness,
  isOfficialScoreImportAdapterId,
  officialScoreReceiptPath,
  type OfficialScoreImportReadiness,
} from "./proofloopOfficialScoreReceipts";

export type ExternalAdapterBlockerStatus = "ready" | "blocked_external";

export type ExternalAdapterBlockerReceipt = {
  schema: "proofloop-external-adapter-blocker-v1";
  adapterId: BenchmarkAdapterId;
  name: string;
  status: ExternalAdapterBlockerStatus;
  localImplementationStatus: "ready" | "missing";
  officialScoreStatus: "imported" | "blocked_external";
  officialSourceUrls: string[];
  verifierCommand: string;
  liveUserCommand: string;
  missingImplementationFiles: string[];
  officialScoreReceiptPath: string;
  officialTaskBundleManifestPath: string;
  validationErrors: string[];
  blockers: string[];
  officialCommandPlan: string[];
  resumeCommands: string[];
  evidence: string[];
  officialScoreReadiness?: OfficialScoreImportReadiness;
};

type OfficialScoreReceipt = {
  status?: "scored" | "blocked_external";
  blockers?: unknown;
};

type OfficialTaskBundleLock = {
  status?: "locked" | "partial" | "blocked";
  blockers?: unknown;
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
  const officialScoreReceiptPath = officialScoreReceiptPathFor(adapter.id);
  const officialTaskBundleManifestPath = `docs/eval/proofloop-official-task-bundles/${adapter.id}.json`;
  const outputManifest = readOfficialOutputManifest(root, adapter.id);
  const outputComplete = officialOutputManifestComplete(outputManifest);
  const officialScoreReadiness = isOfficialScoreImportAdapterId(adapter.id)
    ? buildOfficialScoreImportReadiness({ root, adapterId: adapter.id })
    : undefined;
  const officialScoreBlockers = officialScoreBlockersFor(adapter, root, {
    officialScoreReceiptPath,
    officialTaskBundleManifestPath,
  }, officialScoreReadiness).filter((blocker) => !outputComplete || !isOfficialOutputExporterBlocker(adapter.id, blocker));
  const blockers = [
    ...validationErrors,
    ...missingImplementationFiles.map((file) => `${adapter.id}: missing implementation file ${file}`),
    ...officialScoreBlockers,
    ...(officialCommandPlan.length ? [] : [`${adapter.id}: no official scorer command plan is registered.`]),
  ];

  return {
    schema: "proofloop-external-adapter-blocker-v1",
    adapterId: adapter.id,
    name: String(adapter.source.name ?? adapter.id),
    status: blockers.length ? "blocked_external" : "ready",
    localImplementationStatus: validationErrors.length === 0 && missingImplementationFiles.length === 0 ? "ready" : "missing",
    officialScoreStatus: officialScoreReadiness
      ? officialScoreReadiness.officialScoreClaimable ? "imported" : "blocked_external"
      : officialScoreBlockers.length === 0 ? "imported" : "blocked_external",
    officialSourceUrls,
    verifierCommand: adapter.verifierCommand,
    liveUserCommand: adapter.liveUserCommand,
    missingImplementationFiles,
    officialScoreReceiptPath,
    officialTaskBundleManifestPath,
    validationErrors,
    blockers,
    officialCommandPlan,
    resumeCommands: resumeCommandsFor(adapter),
    evidence: [...new Set([
      `proofloop/benchmarks/${adapter.id}/adapter.json`,
      ...officialSourceUrls,
      ...officialOutputManifestEvidence(adapter.id, outputManifest),
      ...(officialScoreReadiness?.evidence ?? []),
    ])],
    ...(officialScoreReadiness ? { officialScoreReadiness } : {}),
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
        "Import the accepted official judge JSON into docs/eval/proofloop-official-scores/finch.json, then refresh the adapter-blocker receipt before claiming score.",
      ];
    case "finauditing":
      return [
        "Lock the official FinAuditing task source for FinSM, FinRE, and FinMR.",
        "Run NodeRoom generated answers through the upstream FinAuditing metric/scorer for every official split.",
        "Import the accepted official scorer output into docs/eval/proofloop-official-scores/finauditing.json, including the FinMR judge receipt, then refresh the adapter-blocker receipt before claiming score.",
      ];
    case "workstreambench":
      return [
        "Use the locked MBABench public ModelOff task bundle and upstream judge/rubric from namkoong-lab/MBABench.",
        "Run every locked public ModelOff workstream through NodeRoom live-user seeding and export MBABench judge case folders.",
        "Run the official MBABench judge only after provider credentials/spend are approved, then import the accepted scorer receipt into docs/eval/proofloop-official-scores/workstreambench.json before claiming score.",
      ];
    default:
      return [];
  }
}

function officialScoreBlockersFor(
  adapter: ProofloopBenchmarkAdapter,
  root: string,
  paths: { officialScoreReceiptPath: string; officialTaskBundleManifestPath: string },
  readiness?: OfficialScoreImportReadiness,
): string[] {
  const blockers: string[] = readiness
    ? [...readiness.blockers]
    : officialScoreReceiptBlockers(adapter, root, paths.officialScoreReceiptPath);
  if (!existsSync(join(root, paths.officialTaskBundleManifestPath))) {
    const reason = adapter.id === "workstreambench"
      ? "lock the public MBABench repository/dataset/rubric revisions before claiming an official score"
      : "the locked official task bundle must be imported before claiming an official score";
    blockers.push(`${adapter.id}: official task bundle lock ${paths.officialTaskBundleManifestPath} is missing: ${reason}.`);
  } else {
    const taskBundle = readJson<OfficialTaskBundleLock>(join(root, paths.officialTaskBundleManifestPath));
    if (taskBundle?.status !== "locked") {
      const detail = Array.isArray(taskBundle?.blockers) && taskBundle.blockers.length
        ? ` ${taskBundle.blockers.map(String).join(" ")}`
        : "";
      blockers.push(`${adapter.id}: official task bundle lock ${paths.officialTaskBundleManifestPath} is ${taskBundle?.status ?? "invalid"}; locked source revisions are required before claiming an official score.${detail}`);
    }
  }
  return blockers;
}

function officialScoreReceiptBlockers(
  adapter: ProofloopBenchmarkAdapter,
  root: string,
  path: string,
): string[] {
  const scoreReceipt = readJson<OfficialScoreReceipt>(join(root, path));
  if (!scoreReceipt) return [`${adapter.id}: official scorer receipt ${path} is not imported yet.`];
  if (scoreReceipt.status === "scored") return [];
  const detail = Array.isArray(scoreReceipt.blockers) && scoreReceipt.blockers.length
    ? ` ${scoreReceipt.blockers.map(String).join(" ")}`
    : "";
  return [`${adapter.id}: official scorer receipt ${path} is ${scoreReceipt.status ?? "invalid"}; scored receipt is still required before claiming score.${detail}`];
}

function resumeCommandsFor(adapter: ProofloopBenchmarkAdapter): string[] {
  const refreshReceipt = `npm run benchmark:proofloop:adapter-blockers -- --id ${adapter.id}`;
  return [
    `npm run benchmark:proofloop:external-adapter-live-room -- --id ${adapter.id} --prod --user-emulation strict`,
    `npm run benchmark:proofloop:external-adapter -- --id ${adapter.id} --prod --user-emulation strict`,
    refreshReceipt,
    ...(isOfficialScoreImportAdapterId(adapter.id)
      ? [`npx tsx scripts/proofloop-official-score-import.ts --id ${adapter.id} --input docs/eval/proofloop-official-scores/${adapter.id}.json --json-out docs/eval/proofloop-official-score-imports/${adapter.id}.json`]
      : []),
    `import docs/eval/proofloop-official-scores/${adapter.id}.json from the upstream official scorer`,
    `stage docs/eval/proofloop-official-task-bundles/${adapter.id}.json from the locked official task bundle`,
    adapter.liveUserCommand,
    adapter.verifierCommand,
  ];
}

function officialScoreReceiptPathFor(adapterId: BenchmarkAdapterId): string {
  return officialScoreReceiptPath(adapterId);
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
