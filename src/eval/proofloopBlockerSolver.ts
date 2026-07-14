import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  proofloopHarnessVersionForSuite,
  proofloopModelRouteForRun,
  type ProofloopModelRoute,
} from "./proofloopModelTracking";
import { OFFICIAL_SCORE_PREFLIGHT_COMMAND } from "./proofloopOfficialScorePreflight";
import {
  officialOutputManifestComplete,
  readOfficialOutputManifest,
} from "./proofloopOfficialOutputManifests";

export type BlockerClass =
  | "local_missing_code"
  | "missing_task_bundle"
  | "missing_official_scorer"
  | "missing_output_exporter"
  | "missing_model_run"
  | "missing_judge_credentials"
  | "no_public_upstream_release"
  | "prod_ui_failure"
  | "harness_quality_failure";

export type ProofloopBlockerTaskLike = {
  id: string;
  title: string;
  blockers: string[];
  evidence: string[];
  resumeCommand?: string;
};

export type ProofloopBlockerSolvePhase = "research" | "scaffold" | "run" | "solve";

export type ProofloopBlockerSolveReceipt = {
  schema: "proofloop-blocker-solver-v1";
  blockerId: string;
  suite: string;
  title: string;
  generatedAt: string;
  phase: ProofloopBlockerSolvePhase;
  classes: BlockerClass[];
  status: "blocked_external" | "needs_scaffold_or_run" | "proxy_only" | "ready";
  externalBlockClaimAllowed: boolean;
  stopCondition: {
    setupAttempted: boolean;
    researchAttempted: boolean;
    scaffoldAttempted: boolean;
    doctorAttempted: boolean;
    resumeCommandWritten: boolean;
    allNonExternalPartsCompleted: boolean;
  };
  remainingExternalClasses: BlockerClass[];
  remainingLocalClasses: BlockerClass[];
  blockers: string[];
  artifacts: Record<string, string>;
  nextCommands: string[];
  models: ProofloopModelRoute[];
};

type LaneSpec = {
  suite: string;
  title: string;
  officialSources: string[];
  expectedOfficialOutputs: string[];
  scaffoldChanges: string[];
  runCommands: string[];
  doctorCommands: string[];
  proxyOnly: boolean;
  nonExternalPartsComplete: boolean;
  externalClasses: BlockerClass[];
  reason: string;
};

type FreeFirstRouterReceipt = {
  selectedFreeAutoRoutes?: Array<{
    id?: unknown;
    name?: unknown;
    contextLength?: unknown;
    promptPrice?: unknown;
    completionPrice?: unknown;
  }>;
  rankedLiveFreeRoutes?: Array<{
    id?: unknown;
    name?: unknown;
    contextLength?: unknown;
    promptPrice?: unknown;
    completionPrice?: unknown;
  }>;
};

type FreeModelDiscoveryReceipt = {
  models?: Array<{
    id?: unknown;
    name?: unknown;
    contextLength?: unknown;
    supportsTools?: unknown;
  }>;
};

type FreeFirstRouteCandidate = {
  id: string;
  name?: string;
  contextLength?: number;
};

const COST_SAFE_PREFLIGHT_COMMAND = OFFICIAL_SCORE_PREFLIGHT_COMMAND;
const FREE_AUTO_ROUTE = "openrouter/free-auto";
const FALLBACK_FREE_FIRST_ROUTES: FreeFirstRouteCandidate[] = [
  { id: "cohere/north-mini-code:free", name: "Cohere North Mini Code (free)", contextLength: 256_000 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA Nemotron 3 Ultra (free)", contextLength: 1_000_000 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA Nemotron 3 Super (free)", contextLength: 1_000_000 },
  { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (free)", contextLength: 1_048_576 },
  { id: "openai/gpt-oss-120b:free", name: "GPT OSS 120B (free)", contextLength: 131_072 },
];

const ARTIFACT_NAMES = [
  "blocker-analysis.json",
  "upstream-research.md",
  "scaffold-plan.md",
  "harness-version.json",
  "model-matrix.json",
  "cost-ledger.json",
  "official-output-manifest.json",
  "official-score-receipt.json",
  "proxy-score-receipt.json",
  "memory-write.json",
] as const;

export function solveProofloopBlockers(args: {
  root: string;
  tasks: ProofloopBlockerTaskLike[];
  phase?: ProofloopBlockerSolvePhase;
  generatedAt?: string;
}): ProofloopBlockerSolveReceipt[] {
  return args.tasks.map((task) =>
    solveProofloopBlocker({
      root: args.root,
      task,
      phase: args.phase ?? "solve",
      generatedAt: args.generatedAt,
    }),
  );
}

export function solveProofloopBlocker(args: {
  root: string;
  task: ProofloopBlockerTaskLike;
  phase?: ProofloopBlockerSolvePhase;
  generatedAt?: string;
}): ProofloopBlockerSolveReceipt {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const spec = laneSpecForTask(args.task);
  const completedLocalClasses = completedLocalClassesForSpec(args.root, spec);
  const effectiveExternalClasses = externalClassesForSpec(args.root, spec);
  const classes = normalizeClasses(
    [...classifyBlockers(args.task), ...effectiveExternalClasses]
      .filter((item) => !completedLocalClasses.includes(item)),
  );
  const remainingLocalClasses = classes.filter((item) => !effectiveExternalClasses.includes(item));
  const remainingExternalClasses = classes.filter((item) => effectiveExternalClasses.includes(item));
  const laneDir = join(args.root, ".proofloop", "lanes", spec.suite);
  mkdirSync(laneDir, { recursive: true });

  const models = modelRoutesForLane(args.root, spec);
  const harnessVersion = proofloopHarnessVersionForSuite(args.root, spec.suite, [
    "docs/eval/proofloop-official-score-preflight.json",
    "docs/eval/proofloop-free-openrouter-nodeagent-gauge.json",
    "docs/eval/proofloop-harness-economics.json",
    "docs/eval/official-benchmark-task-coverage.json",
  ]);

  const stopCondition = {
    setupAttempted: setupAttempted(args.task, spec),
    researchAttempted: true,
    scaffoldAttempted: true,
    doctorAttempted: spec.doctorCommands.length > 0,
    resumeCommandWritten: Boolean(args.task.resumeCommand || spec.runCommands.length),
    allNonExternalPartsCompleted: spec.nonExternalPartsComplete || remainingLocalClasses.length === 0,
  };
  const externalBlockClaimAllowed =
    Object.values(stopCondition).every(Boolean) &&
    remainingExternalClasses.length > 0 &&
    remainingLocalClasses.length === 0;
  const status: ProofloopBlockerSolveReceipt["status"] = externalBlockClaimAllowed
    ? "blocked_external"
    : spec.proxyOnly && spec.nonExternalPartsComplete
      ? "proxy_only"
      : "needs_scaffold_or_run";

  const artifactPaths = artifactPathsForLane(args.root, spec.suite);
  writeFileSync(
    join(laneDir, "upstream-research.md"),
    renderResearchMarkdown(args.task, spec, classes, generatedAt),
    "utf8",
  );
  writeFileSync(
    join(laneDir, "scaffold-plan.md"),
    renderScaffoldPlan(args.task, spec, classes, remainingLocalClasses),
    "utf8",
  );
  writeJson(join(laneDir, "harness-version.json"), {
    schema: 1,
    suite: spec.suite,
    harnessVersion: harnessVersion.harnessVersion,
    generatedAt,
    previousVersion: null,
    changes: spec.scaffoldChanges,
    modelsTested: models.map((model) => model.id),
    bestRoute: models[0]?.id ?? null,
    reason: spec.reason,
    files: harnessVersion.files,
  });
  writeJson(join(laneDir, "model-matrix.json"), {
    schema: 1,
    suite: spec.suite,
    generatedAt,
    phase: args.phase ?? "solve",
    officialScoreClaimable: false,
    policy: "Proxy/model sweeps can triage product quality but cannot replace accepted official scorer receipts.",
    models: models.map((model, index) => ({
      ...model,
      rank: index + 1,
      status: "candidate_not_run",
      qualityScore: null,
      officialScore: null,
    })),
    nextCommand: `npm run proofloop -- compare-models ${spec.suite}`,
  });
  writeJson(join(laneDir, "cost-ledger.json"), {
    schema: 1,
    suite: spec.suite,
    generatedAt,
    currency: "USD",
    policy: "free_first_until_official_scorer_contract",
    models: models.map((model) => ({
      id: model.id,
      provider: model.provider,
      role: model.role,
      costUsd: model.costUsd,
      tokensIn: model.tokensIn,
      tokensOut: model.tokensOut,
      latencyMs: model.latencyMs,
      routePolicy: model.routePolicy,
      costAccounting: model.costAccounting,
      source: model.source,
      selectionReason: model.selectionReason,
    })),
    note: "Blocked-lane exploration starts with free/local routes. Paid/provider routes require an explicit official scorer contract and positive cost/token receipt before promotion.",
  });
  writeJson(join(laneDir, "official-output-manifest.json"), {
    schema: 1,
    suite: spec.suite,
    generatedAt,
    status: remainingLocalClasses.length ? "needs_generation" : "blocked_external",
    expectedOutputs: spec.expectedOfficialOutputs,
    currentEvidence: args.task.evidence,
    missingClasses: remainingLocalClasses,
  });
  writeJson(join(laneDir, "official-score-receipt.json"), {
    schema: 1,
    suite: spec.suite,
    blockerId: args.task.id,
    generatedAt,
    status: externalBlockClaimAllowed ? "blocked_external" : "needs_scaffold_or_run",
    officialScoreClaimable: false,
    officialSemanticScore: null,
    acceptedProxyJudge: false,
    blockers: args.task.blockers,
    remainingLocalClasses,
    remainingExternalClasses,
  });
  writeJson(join(laneDir, "proxy-score-receipt.json"), {
    schema: 1,
    suite: spec.suite,
    generatedAt,
    status: "proxy_only",
    proxyOnly: spec.proxyOnly,
    officialScoreClaimable: false,
    recommendedProxyRoute: models[0]?.id ?? null,
    models: models.map((model) => model.id),
  });
  writeJson(join(laneDir, "memory-write.json"), {
    schema: 1,
    kind: "blocker_solver_memory",
    suite: spec.suite,
    blockerId: args.task.id,
    generatedAt,
    classes,
    nextCommands: nextCommandsForSpec(spec, args.task),
    lesson: "Do not declare external-blocked until setup, research, scaffold, doctor, model tracking, and resume evidence are written.",
  });

  const receipt: ProofloopBlockerSolveReceipt = {
    schema: "proofloop-blocker-solver-v1",
    blockerId: args.task.id,
    suite: spec.suite,
    title: args.task.title,
    generatedAt,
    phase: args.phase ?? "solve",
    classes,
    status,
    externalBlockClaimAllowed,
    stopCondition,
    remainingExternalClasses,
    remainingLocalClasses,
    blockers: args.task.blockers,
    artifacts: artifactPaths,
    nextCommands: nextCommandsForSpec(spec, args.task),
    models,
  };
  writeJson(join(laneDir, "blocker-analysis.json"), receipt);
  return receipt;
}

export function compareProofloopModelsForSuite(args: {
  root: string;
  suite: string;
  generatedAt?: string;
}): string {
  const spec = laneSpecForSuite(args.suite);
  const receipt = solveProofloopBlocker({
    root: args.root,
    phase: "run",
    generatedAt: args.generatedAt,
    task: canonicalTaskForSpec(spec),
  });
  return absolutePath(args.root, receipt.artifacts["model-matrix.json"]);
}

export function promoteProofloopHarnessForSuite(args: {
  root: string;
  suite: string;
  generatedAt?: string;
}): string {
  const spec = laneSpecForSuite(args.suite);
  const receipt = solveProofloopBlocker({
    root: args.root,
    phase: "scaffold",
    generatedAt: args.generatedAt,
    task: canonicalTaskForSpec(spec),
  });
  return absolutePath(args.root, receipt.artifacts["harness-version.json"]);
}

export function classifyBlockers(task: ProofloopBlockerTaskLike): BlockerClass[] {
  const text = `${task.id} ${task.title} ${task.blockers.join(" ")}`.toLowerCase();
  const classes = new Set<BlockerClass>();
  if (/local setup recipe|adapter|wire|not yet wired|missing implementation|local code/.test(text)) classes.add("local_missing_code");
  if (
    /missing task bundle|not fully staged|only the public\/example|no public official task bundle|obtain the public official .* task bundle|stage all|full official bundle.*missing/.test(text)
  ) {
    classes.add("missing_task_bundle");
  }
  if (/scorer|verifier|judge|rubric/.test(text)) classes.add("missing_official_scorer");
  if (
    /(missing|needs|need|no |incomplete|partial|required|must|still need|not complete|not produced|cannot build)[^.;]*(output artifact|prediction jsonl|content_parts|official-format|candidate workbook|exporter)/.test(text) ||
    /(output artifact|prediction jsonl|content_parts|official-format|candidate workbook|exporter)[^.;]*(missing|incomplete|partial|required|not complete|not produced|cannot build)/.test(text)
  ) {
    classes.add("missing_output_exporter");
  }
  if (/model-run|model run|run all|full 912|all 321|model matrix|outputs for every/.test(text)) classes.add("missing_model_run");
  if (/credential|api key|azure|openai/.test(text)) classes.add("missing_judge_credentials");
  if (/no public|not found|author-provided|upstream release/.test(text)) classes.add("no_public_upstream_release");
  if (/prod|browser|ui failure|live/.test(text) && /fail|missing/.test(text)) classes.add("prod_ui_failure");
  if (/quality weak|mean reward|pass-rate|unmet criteria|reward/.test(text)) classes.add("harness_quality_failure");
  return [...classes];
}

export function laneIdForBlocker(blockerId: string): string {
  if (/spreadsheetbench-v1/i.test(blockerId)) return "spreadsheetbench-v1";
  if (/spreadsheetbench-v2/i.test(blockerId)) return "spreadsheetbench-v2";
  if (/finch/i.test(blockerId)) return "finch";
  if (/finauditing/i.test(blockerId)) return "finauditing";
  if (/workstream/i.test(blockerId)) return "workstreambench";
  if (/banker|btb/i.test(blockerId)) return "bankertoolbench";
  return blockerId.replace(/-official-score$/, "").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

function laneSpecForTask(task: ProofloopBlockerTaskLike): LaneSpec {
  return laneSpecForSuite(laneIdForBlocker(task.id));
}

function laneSpecForSuite(suite: string): LaneSpec {
  const normalized = laneIdForBlocker(suite);
  const commonDoctor = ["npm run benchmark:proofloop:harness-economics"];
  const specs: Record<string, LaneSpec> = {
    "spreadsheetbench-v1": {
      suite: "spreadsheetbench-v1",
      title: "SpreadsheetBench V1 full 912-task official score",
      officialSources: [
        "https://github.com/RUCKBReasoning/SpreadsheetBench",
        "https://huggingface.co/datasets/KAKA22/SpreadsheetBench",
      ],
      expectedOfficialOutputs: [
        "912 model-generated candidate workbook outputs",
        "SpreadsheetBench workbook scorer receipt",
        "per-task model/cost/harness trace",
      ],
      scaffoldChanges: [
        "convert staged 912-task bundle into chunked model-run work queue",
        "serialize model route and harness version on every candidate workbook",
        "write official score receipt only after scorer import",
      ],
      runCommands: [
        `npm run benchmark:spreadsheetbench:run-chunked -- --stage-root .tmp/official-benchmarks/staged-v1-912 --output-root .tmp/official-benchmarks/run-v1-912-model --json-out docs/eval/spreadsheetbench-v1-912-model-run.json --mode model-edit-plan --model ${FREE_AUTO_ROUTE} --chunk-size 25`,
        "npm run benchmark:official:task-coverage -- --strict",
      ],
      doctorCommands: commonDoctor,
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: [],
      reason: "Local model-run work remains: the 912-task bundle is staged, but full model outputs are not complete.",
    },
    "spreadsheetbench-v2": {
      suite: "spreadsheetbench-v2",
      title: "SpreadsheetBench V2 full 321-task official score",
      officialSources: [
        "https://spreadsheetbench.github.io/",
        "https://github.com/RUCKBReasoning/SpreadsheetBench-2",
        "https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2",
        "docs/eval/spreadsheetbench-v2-full-stage.json",
      ],
      expectedOfficialOutputs: [
        "321 official V2 task manifests",
        "candidate workbook outputs",
        "static workbook scorer receipt",
        "rendered chart/visual grader receipt",
      ],
      scaffoldChanges: [
        "keep the full 321-task official bundle staged under agent/evaluator isolation",
        "add rendered chart/visual scorer hook",
        "run model matrix across staged V2 tasks",
      ],
      runCommands: [
        "npm run benchmark:spreadsheetbench:stage -- --track spreadsheetbench-v2 --root .tmp/official-benchmarks/spreadsheetbench-v2-full/spreadsheetbench-v2 --output-root .tmp/official-benchmarks/staged-v2-full --json-out docs/eval/spreadsheetbench-v2-full-stage.json",
        `npm run benchmark:spreadsheetbench:run-chunked -- --stage-root .tmp/official-benchmarks/staged-v2-full --output-root .tmp/official-benchmarks/run-v2-full-model --json-out docs/eval/spreadsheetbench-v2-full-model-run.json --mode model-edit-plan --model ${FREE_AUTO_ROUTE} --chunk-size 25`,
      ],
      doctorCommands: commonDoctor,
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: [],
      reason: "Full V2 staging is available; model/scorer execution remains local scaffold/run work before official score promotion.",
    },
    finch: {
      suite: "finch",
      title: "Finch / FinWorkBench official score",
      officialSources: [
        "proofloop/benchmarks/finch/adapter.json",
        "docs/eval/proofloop-official-task-bundles/finch.json",
      ],
      expectedOfficialOutputs: [
        "complete NodeRoom model-output artifact manifest for all 172 official Finch task ids",
        "content_parts.jsonl",
        "accepted upstream Finch judge/scorer receipt",
      ],
      scaffoldChanges: [
        "retry upstream Finch content_parts rendering against the complete model-output manifest",
        "wire accepted Finch judge command adapter when credentials exist",
      ],
      runCommands: [
        "npm run benchmark:proofloop:official-outputs -- --id finch",
        "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
      ],
      doctorCommands: [
        "npm run proofloop -- setup finch --doctor",
        "npm run benchmark:proofloop:adapter-blockers -- --id finch",
      ],
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: ["missing_judge_credentials"],
      reason: "Official model-output artifacts are complete; upstream content_parts rendering and accepted judge import remain before official score promotion.",
    },
    finauditing: {
      suite: "finauditing",
      title: "FinAuditing official score",
      officialSources: [
        "proofloop/benchmarks/finauditing/adapter.json",
        "docs/eval/proofloop-official-task-bundles/finauditing.json",
      ],
      expectedOfficialOutputs: [
        "complete FinSM/FinRE/FinMR prediction JSONL manifest",
        "accepted FinMR judge receipt",
      ],
      scaffoldChanges: [
        "keep official-format FinSM/FinRE/FinMR prediction exporters reproducible",
        "wire FinBen/FinAuditing evaluator command",
        "block only at judge credential layer after predictions exist",
      ],
      runCommands: [
        "npm run benchmark:proofloop:official-outputs -- --id finauditing",
        "npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict",
      ],
      doctorCommands: [
        "npm run proofloop -- setup finauditing --doctor",
        "npm run benchmark:proofloop:adapter-blockers -- --id finauditing",
      ],
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: ["missing_judge_credentials"],
      reason: "Official-format predictions are complete; accepted FinMR judge/scorer import remains before official score promotion.",
    },
    workstreambench: {
      suite: "workstreambench",
      title: "WorkstreamBench official score",
      officialSources: [
        "proofloop/benchmarks/workstreambench/adapter.json",
        "docs/eval/proofloop-official-task-bundles/workstreambench.json",
        "docs/eval/proofloop-official-outputs/workstreambench.json",
        "docs/eval/proofloop-official-scores/workstreambench.json",
      ],
      expectedOfficialOutputs: [
        "38 official-format MBABench judge case folders",
        "NodeRoom ai_attempt.xlsx candidate workbook for each locked ModelOff task",
        "accepted MBABench official judge/scorer receipt",
      ],
      scaffoldChanges: [
        "convert the locked public ModelOff dataset into MBABench judge case folders",
        "write ai_attempt.xlsx outputs from NodeRoom without opening solution workbooks to the agent",
        "run/import the accepted MBABench judge output only after provider spend is explicitly approved",
      ],
      runCommands: [
        "npm run benchmark:proofloop:adapter-blockers -- --id workstreambench",
        "npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict",
      ],
      doctorCommands: [
        "npm run proofloop -- setup workstreambench --doctor",
        "npm run benchmark:proofloop:adapter-blockers -- --id workstreambench",
      ],
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: ["missing_judge_credentials"],
      reason: "The public MBABench repository, ModelOff task bundle, scorer, and rubric are locked; local MBABench case-folder export and accepted judge import remain before official score promotion.",
    },
    bankertoolbench: {
      suite: "bankertoolbench",
      title: "BankerToolBench model/harness quality sweep",
      officialSources: [
        "https://github.com/Handshake-AI-Research/bankertoolbench",
        "https://huggingface.co/datasets/handshake-ai-research/bankertoolbench",
      ],
      expectedOfficialOutputs: [
        "failure clusters for 100 scored tasks",
        "model route matrix",
        "rerun receipt for promoted route",
      ],
      scaffoldChanges: [
        "cluster low-reward tasks by unmet criteria",
        "run model/harness sweep against official scorer",
        "promote best route only after score/cost receipt",
      ],
      runCommands: [
        "npm run proofloop -- compare-models bankertoolbench",
        "npm run benchmark:bankertoolbench:fullsuite-gate -- --assert",
      ],
      doctorCommands: [
        "npm run proofloop -- setup bankertoolbench --doctor",
        "npm run benchmark:bankertoolbench:official-contract",
      ],
      proxyOnly: false,
      nonExternalPartsComplete: false,
      externalClasses: [],
      reason: "Quality failure remains local model/harness work, not an external blocker.",
    },
  };
  return specs[normalized] ?? {
    suite: normalized,
    title: normalized,
    officialSources: [],
    expectedOfficialOutputs: ["official output manifest", "official scorer receipt"],
    scaffoldChanges: ["write adapter/exporter/scorer scaffold"],
    runCommands: [`npm run proofloop -- blocker solve ${normalized}`],
    doctorCommands: [],
    proxyOnly: false,
    nonExternalPartsComplete: false,
    externalClasses: [],
    reason: "Unknown lane needs explicit blocker analysis before external status.",
  };
}

function completedLocalClassesForSpec(root: string, spec: LaneSpec): BlockerClass[] {
  const completed = new Set<BlockerClass>();
  if (["finch", "finauditing", "workstreambench"].includes(spec.suite)) {
    const manifest = readOfficialOutputManifest(root, spec.suite as "finch" | "finauditing" | "workstreambench");
    if (officialOutputManifestComplete(manifest)) completed.add("missing_output_exporter");
  }
  return [...completed];
}

function externalClassesForSpec(root: string, spec: LaneSpec): BlockerClass[] {
  const external = new Set<BlockerClass>(spec.externalClasses);
  if (["finch", "finauditing", "workstreambench"].includes(spec.suite)) {
    const manifest = readOfficialOutputManifest(root, spec.suite as "finch" | "finauditing" | "workstreambench");
    if (officialOutputManifestComplete(manifest)) external.add("missing_official_scorer");
  }
  return [...external];
}

function canonicalTaskForSpec(spec: LaneSpec, resumeCommand?: string): ProofloopBlockerTaskLike {
  return {
    id: canonicalBlockerId(spec.suite),
    title: spec.title,
    blockers: [
      spec.reason,
      canonicalSourceStatus(spec),
      ...spec.expectedOfficialOutputs.map((output) => canonicalOutputText(spec, output)),
      ...spec.scaffoldChanges.map((change) => canonicalScaffoldText(spec, change)),
      ...spec.externalClasses.map((blockerClass) => externalBlockerText(blockerClass)),
    ],
    evidence: spec.officialSources.filter((source) => !/^https?:\/\//.test(source)),
    resumeCommand,
  };
}

function canonicalSourceStatus(spec: LaneSpec): string {
  if (spec.suite === "bankertoolbench") {
    return `Official sources checked for model/harness sweep context: ${spec.officialSources.join(", ") || "not recorded"}.`;
  }
  return `Official task bundle and scorer source status: ${spec.officialSources.join(", ") || "not recorded"}.`;
}

function canonicalOutputText(spec: LaneSpec, output: string): string {
  if (spec.suite === "bankertoolbench") return `Model/harness sweep artifact: ${output}.`;
  return `Required official output artifact: ${output}.`;
}

function canonicalScaffoldText(spec: LaneSpec, change: string): string {
  if (spec.suite === "bankertoolbench") return `Model/harness sweep work: ${change.replace(/official scorer/g, "existing scored gate")}.`;
  return `Local scaffold/run work: ${change}.`;
}

function canonicalBlockerId(suite: string): string {
  if (suite === "spreadsheetbench-v1") return "spreadsheetbench-v1-full-official-score";
  if (suite === "spreadsheetbench-v2") return "spreadsheetbench-v2-full-official-score";
  return `${suite}-official-score`;
}

function externalBlockerText(blockerClass: BlockerClass): string {
  if (blockerClass === "missing_judge_credentials") return "External judge credential is missing: a direct provider API key, or optional upstream-compatible Azure deployment credentials, is required for official promotion.";
  if (blockerClass === "no_public_upstream_release") return "No public upstream official release was found.";
  if (blockerClass === "missing_official_scorer") return "No public official scorer or rubric command is available locally.";
  if (blockerClass === "missing_task_bundle") return "No public official task bundle is available locally.";
  return `${blockerClass} remains.`;
}

function modelRoutesForLane(root: string, spec: LaneSpec): ProofloopModelRoute[] {
  return freeFirstRouteCandidates(root).map((candidate, index) => {
    const selectionReason = index === 0
      ? `Governed free-first router for ${spec.suite}; run ${COST_SAFE_PREFLIGHT_COMMAND} before any blocked-lane model sweep.`
      : `Concrete zero-priced free-auto candidate for ${spec.suite}${candidate.name ? ` (${candidate.name})` : ""}.`;
    return {
      ...proofloopModelRouteForRun({
        suite: spec.suite,
        cmd: `model-matrix ${spec.suite}`,
        env: {
          PROOFLOOP_MODEL_ID: candidate.id,
          PROOFLOOP_MODEL_SELECTION_REASON: selectionReason,
        },
      }),
      provider: "openrouter",
      selectionReason,
      source: "env",
    };
  });
}

function artifactPathsForLane(root: string, suite: string): Record<string, string> {
  const dir = join(root, ".proofloop", "lanes", suite);
  return Object.fromEntries(ARTIFACT_NAMES.map((name) => [name, rel(root, join(dir, name))]));
}

function renderResearchMarkdown(task: ProofloopBlockerTaskLike, spec: LaneSpec, classes: BlockerClass[], generatedAt: string): string {
  const lines = [
    `# ${spec.title} Research`,
    "",
    `Generated: ${generatedAt}`,
    `Blocker: ${task.id}`,
    "",
    "## Classes",
    "",
    ...classes.map((item) => `- ${item}`),
    "",
    "## Official Sources Checked",
    "",
    ...(spec.officialSources.length ? spec.officialSources.map((source) => `- ${source}`) : ["- none recorded"]),
    "",
    "## Conclusion",
    "",
    spec.reason,
    "",
    "## Original Blockers",
    "",
    ...task.blockers.map((blocker) => `- ${blocker}`),
    "",
  ];
  return lines.join("\n");
}

function renderScaffoldPlan(
  task: ProofloopBlockerTaskLike,
  spec: LaneSpec,
  classes: BlockerClass[],
  remainingLocalClasses: BlockerClass[],
): string {
  const lines = [
    `# ${spec.title} Scaffold Plan`,
    "",
    "## Required Changes",
    "",
    ...spec.scaffoldChanges.map((change) => `- ${change}`),
    "",
    "## Remaining Local Classes",
    "",
    ...(remainingLocalClasses.length ? remainingLocalClasses.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Commands",
    "",
    ...nextCommandsForSpec(spec, task).map((command) => `- \`${command}\``),
    "",
    "## Stop Rule",
    "",
    "Do not promote this lane to official score until official-output-manifest.json and official-score-receipt.json are claimable.",
    "",
  ];
  if (classes.includes("missing_judge_credentials")) {
    lines.push("Judge credentials can block official promotion, but they must not block local exporter/output scaffolding.", "");
  }
  return lines.join("\n");
}

function nextCommandsForSpec(spec: LaneSpec, task: ProofloopBlockerTaskLike): string[] {
  return [...new Set([
    COST_SAFE_PREFLIGHT_COMMAND,
    ...(task.resumeCommand ? [task.resumeCommand] : []),
    ...spec.doctorCommands,
    ...spec.runCommands,
  ])];
}

function freeFirstRouteCandidates(root: string): FreeFirstRouteCandidate[] {
  const discovery = readJson<FreeModelDiscoveryReceipt>(join(root, "docs/eval/openrouter-free-model-discovery.json"));
  const receipt = readJson<FreeFirstRouterReceipt>(join(root, "docs/eval/dev-audience-ready/free-first-router-cost-receipt.json"));
  const fromDiscovery = (discovery?.models ?? [])
    .map((route): FreeFirstRouteCandidate | null => {
      if (typeof route.id !== "string" || !route.id.trim() || route.supportsTools !== true) return null;
      return {
        id: route.id.trim(),
        name: typeof route.name === "string" ? route.name : undefined,
        contextLength: typeof route.contextLength === "number" ? route.contextLength : undefined,
      };
    })
    .filter((route): route is FreeFirstRouteCandidate => route !== null);
  const fromReceipt = [
    ...(receipt?.selectedFreeAutoRoutes ?? []),
    ...(receipt?.rankedLiveFreeRoutes ?? []),
  ]
    .map((route): FreeFirstRouteCandidate | null => {
      if (typeof route.id !== "string" || !route.id.trim()) return null;
      if (String(route.promptPrice ?? "0") !== "0" || String(route.completionPrice ?? "0") !== "0") return null;
      return {
        id: route.id.trim(),
        name: typeof route.name === "string" ? route.name : undefined,
        contextLength: typeof route.contextLength === "number" ? route.contextLength : undefined,
      };
    })
    .filter((route): route is FreeFirstRouteCandidate => route !== null);
  const uniqueFreeRoutes = uniqueRouteCandidates(fromDiscovery.length ? fromDiscovery : fromReceipt.length ? fromReceipt : FALLBACK_FREE_FIRST_ROUTES);
  return [{ id: FREE_AUTO_ROUTE, name: "OpenRouter free-auto governed router" }, ...uniqueFreeRoutes].slice(0, 6);
}

function uniqueRouteCandidates(routes: FreeFirstRouteCandidate[]): FreeFirstRouteCandidate[] {
  const seen = new Set<string>();
  const result: FreeFirstRouteCandidate[] = [];
  for (const route of routes) {
    const id = route.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...route, id });
  }
  return result;
}

function setupAttempted(task: ProofloopBlockerTaskLike, spec: LaneSpec): boolean {
  if (/spreadsheetbench/.test(spec.suite)) return true;
  return task.evidence.some((item) => item.includes(".proofloop/setup/")) || spec.doctorCommands.some((command) => command.includes("setup"));
}

function normalizeClasses(classes: BlockerClass[]): BlockerClass[] {
  return [...new Set(classes)].sort();
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rel(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

function absolutePath(root: string, path: string | undefined): string {
  return path ? join(root, path) : root;
}
