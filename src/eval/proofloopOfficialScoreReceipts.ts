import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkAdapterId } from "./proofloopBenchmarkAdapters";
import {
  officialOutputManifestComplete,
  officialOutputManifestEvidence,
  officialOutputManifestPath,
  readOfficialOutputManifest,
} from "./proofloopOfficialOutputManifests";

export type OfficialScoreImportAdapterId = Extract<BenchmarkAdapterId, "finch" | "finauditing" | "workstreambench">;

export type OfficialScoreBoundaryStatus =
  | "complete"
  | "partial"
  | "missing"
  | "proxy_only"
  | "accepted"
  | "blocked_external"
  | "invalid";

export type OfficialScoreBoundary = {
  productPath: {
    status: Extract<OfficialScoreBoundaryStatus, "complete" | "partial" | "missing">;
    officialScoreClaim: false;
    reason: string;
    evidence: string[];
  };
  proxy: {
    status: "proxy_only";
    officialScoreClaim: false;
    reason: string;
    evidence: string[];
  };
  officialScorer: {
    status: Extract<OfficialScoreBoundaryStatus, "accepted" | "blocked_external" | "invalid">;
    officialScoreClaim: boolean;
    requiredAcceptedReceipt: string;
    evidence: string[];
  };
};

export type OfficialScoreImportReadiness = {
  schema: "proofloop-official-score-import-readiness-v1";
  adapterId: OfficialScoreImportAdapterId;
  receiptPath: string;
  status: Extract<OfficialScoreBoundaryStatus, "accepted" | "blocked_external" | "invalid">;
  scoreClaim: boolean;
  officialScoreClaimable: boolean;
  acceptedExternalScorerReceipt: boolean;
  acceptedExternalScorerKind: string | null;
  pendingExternalScorerReceipt: boolean;
  pendingExternalScorerKind: string | null;
  requiredAcceptedReceipt: string;
  metrics: {
    officialTaskCount: number | null;
    outputTaskCount: number | null;
    predictionRowCount: number | null;
    contentPartsCount: number | null;
  };
  boundary: OfficialScoreBoundary;
  blockers: string[];
  evidence: string[];
};

type JsonRecord = Record<string, unknown>;

export type LocalOfficialScoreScaffoldReceipt = {
  schema: "proofloop-official-score-receipt-v1";
  adapterId: OfficialScoreImportAdapterId;
  status: "blocked_external";
  generatedAt: string;
  officialScorer: JsonRecord;
  attempted: string[];
  blockers: string[];
  scoreClaim: false;
  claimBoundary: {
    productPathStatus: string;
    proxyStatus: "proxy_only_not_official";
    officialScorerStatus: "blocked_external";
    officialJudgeReceiptStatus: "pending";
    officialScoreClaimable: false;
    requiredAcceptedReceipt: string;
  };
  acceptedExternalScorerReceipt: null;
  pendingExternalScorerReceipt: {
    kind: string;
    status: "pending";
    accepted: false;
    official: true;
    source: "upstream_official_pending";
    requiredAcceptedReceipt: string;
    reason: string;
    paidProviderCalls: false;
    providerCallsAttempted: false;
  } & JsonRecord;
  localProductOutputReceipt: {
    status: "complete" | "partial" | "missing";
    officialScoreClaim: false;
    reason: string;
    metrics: OfficialScoreImportReadiness["metrics"];
    evidence: string[];
  };
  officialOutputManifest: {
    path: string;
    status: string | null;
    officialTaskCount: number | null;
    outputTaskCount: number | null;
    predictionRowCount: number | null;
    contentPartsCount: number | null;
  };
  evidence: string[];
};

export function isOfficialScoreImportAdapterId(id: BenchmarkAdapterId): id is OfficialScoreImportAdapterId {
  return id === "finch" || id === "finauditing" || id === "workstreambench";
}

export function officialScoreReceiptPath(adapterId: BenchmarkAdapterId): string {
  return `docs/eval/proofloop-official-scores/${adapterId}.json`;
}

export function officialScoreImportReadinessPath(adapterId: OfficialScoreImportAdapterId): string {
  return `docs/eval/proofloop-official-score-imports/${adapterId}.json`;
}

export function buildOfficialScoreImportReadiness(args: {
  root?: string;
  adapterId: OfficialScoreImportAdapterId;
  receiptPath?: string;
}): OfficialScoreImportReadiness {
  const root = args.root ?? process.cwd();
  const receiptPath = args.receiptPath ?? officialScoreReceiptPath(args.adapterId);
  const receipt = readJson(join(root, receiptPath));
  const outputManifest = readOfficialOutputManifest(root, args.adapterId);
  const receiptOutputManifest = asRecord(receipt?.officialOutputManifest);
  const metrics = {
    officialTaskCount: numberField(receiptOutputManifest, "officialTaskCount") ?? outputManifest?.officialTaskCount ?? null,
    outputTaskCount: numberField(receiptOutputManifest, "outputTaskCount") ?? outputManifest?.outputTaskCount ?? null,
    predictionRowCount: numberField(receiptOutputManifest, "predictionRowCount") ?? outputManifest?.predictionRowCount ?? null,
    contentPartsCount: numberField(receiptOutputManifest, "contentPartsCount") ?? outputManifest?.contentPartsCount ?? null,
  };
  const expectedTaskCount = metrics.officialTaskCount ?? 0;
  const outputComplete = officialOutputManifestComplete(outputManifest) || receiptOutputManifestComplete(args.adapterId, metrics);
  const acceptedReceipt = acceptedReceiptFrom(receipt);
  const acceptedKind = acceptedExternalScorerKind(acceptedReceipt);
  const pendingReceipt = pendingReceiptFrom(receipt);
  const pendingKind = acceptedExternalScorerKind(pendingReceipt);
  const acceptedReceiptBaseBlockers = acceptedReceiptBlockers(acceptedReceipt);
  const adapterBlockers = args.adapterId === "finch"
    ? finchAcceptedReceiptBlockers(acceptedReceipt, metrics)
    : args.adapterId === "workstreambench"
      ? workstreamBenchAcceptedReceiptBlockers(acceptedReceipt, metrics)
      : finAuditingAcceptedReceiptBlockers(acceptedReceipt, metrics);
  const receiptBlockers: string[] = [];
  const invalidBlockers: string[] = [];

  if (!receipt) {
    receiptBlockers.push(`${args.adapterId}: official scorer receipt ${receiptPath} is not imported yet.`);
  } else {
    if (receipt.schema !== "proofloop-official-score-receipt-v1") {
      invalidBlockers.push(`${args.adapterId}: official scorer receipt ${receiptPath} has invalid schema ${String(receipt.schema ?? "missing")}.`);
    }
    if (receipt.adapterId !== args.adapterId) {
      invalidBlockers.push(`${args.adapterId}: official scorer receipt ${receiptPath} has adapterId ${String(receipt.adapterId ?? "missing")}.`);
    }
    if (receipt.status !== "scored") {
      const detail = arrayStrings(receipt.blockers).length
        ? ` ${arrayStrings(receipt.blockers).join(" ")}`
        : "";
      receiptBlockers.push(`${args.adapterId}: official scorer receipt ${receiptPath} is ${String(receipt.status ?? "invalid")}; scored receipt is still required before claiming score.${detail}`);
    }
  }

  const scoreClaim = receipt?.scoreClaim === true;
  if (receipt?.status === "scored" && !scoreClaim) {
    receiptBlockers.push(`${args.adapterId}: scored official scorer receipt is present, but scoreClaim is not true; official score remains unclaimed.`);
  }
  if (scoreClaim && receipt?.status !== "scored") {
    invalidBlockers.push(`${args.adapterId}: scoreClaim=true is invalid unless the imported receipt status is scored.`);
  }
  if (scoreClaim && acceptedReceiptBaseBlockers.length + adapterBlockers.length > 0) {
    invalidBlockers.push(`${args.adapterId}: refusing official score claim without an accepted external scorer receipt.`);
  }
  if (scoreClaim && !outputComplete) {
    invalidBlockers.push(`${args.adapterId}: refusing official score claim until official output export coverage is complete.`);
  }

  const blockers = [
    ...receiptBlockers,
    ...acceptedReceiptBaseBlockers,
    ...adapterBlockers,
    ...invalidBlockers,
  ];
  const officialScorerAccepted = acceptedReceiptBaseBlockers.length === 0 && adapterBlockers.length === 0;
  const officialScoreClaimable =
    receipt?.status === "scored" &&
    scoreClaim &&
    outputComplete &&
    officialScorerAccepted &&
    invalidBlockers.length === 0 &&
    receiptBlockers.length === 0;
  const productEvidence = [
    ...officialOutputManifestEvidence(args.adapterId, outputManifest),
    ...arrayStrings(receipt?.evidence).filter((item) => item.includes("proofloop-official-outputs")),
  ];
  const officialEvidence = [
    ...(existsSync(join(root, receiptPath)) ? [receiptPath] : []),
    ...acceptedReceiptEvidence(acceptedReceipt),
  ];
  const boundary: OfficialScoreBoundary = {
    productPath: {
      status: outputComplete ? "complete" : outputManifest || receiptOutputManifest ? "partial" : "missing",
      officialScoreClaim: false,
      reason: outputComplete
        ? productPathCompleteReason(args.adapterId)
        : productPathIncompleteReason(args.adapterId, expectedTaskCount),
      evidence: [...new Set(productEvidence)],
    },
    proxy: {
      status: "proxy_only",
      officialScoreClaim: false,
      reason: "Proxy/product-path receipts can triage quality and prove local workflow shape, but they are not accepted upstream official scorer receipts.",
      evidence: proxyEvidenceFor(args.adapterId, receipt),
    },
    officialScorer: {
      status: officialScoreClaimable ? "accepted" : invalidBlockers.length ? "invalid" : "blocked_external",
      officialScoreClaim: officialScoreClaimable,
      requiredAcceptedReceipt: requiredAcceptedReceiptFor(args.adapterId),
      evidence: [...new Set(officialEvidence)],
    },
  };

  return {
    schema: "proofloop-official-score-import-readiness-v1",
    adapterId: args.adapterId,
    receiptPath,
    status: officialScoreClaimable ? "accepted" : invalidBlockers.length ? "invalid" : "blocked_external",
    scoreClaim,
    officialScoreClaimable,
    acceptedExternalScorerReceipt: officialScorerAccepted,
    acceptedExternalScorerKind: acceptedKind,
    pendingExternalScorerReceipt: Boolean(pendingReceipt),
    pendingExternalScorerKind: pendingKind,
    requiredAcceptedReceipt: requiredAcceptedReceiptFor(args.adapterId),
    metrics,
    boundary,
    blockers: [...new Set(blockers)],
    evidence: [...new Set([
      ...productEvidence,
      ...officialEvidence,
      officialScoreImportReadinessPath(args.adapterId),
    ])],
  };
}

export function buildLocalOfficialScoreScaffoldReceipt(args: {
  root?: string;
  adapterId: OfficialScoreImportAdapterId;
  generatedAt?: string;
}): LocalOfficialScoreScaffoldReceipt {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const outputManifest = readOfficialOutputManifest(root, args.adapterId);
  const outputComplete = officialOutputManifestComplete(outputManifest);
  const metrics = {
    officialTaskCount: outputManifest?.officialTaskCount ?? null,
    outputTaskCount: outputManifest?.outputTaskCount ?? null,
    predictionRowCount: outputManifest?.predictionRowCount ?? null,
    contentPartsCount: outputManifest?.contentPartsCount ?? null,
  };
  const outputEvidence = [...new Set(officialOutputManifestEvidence(args.adapterId, outputManifest))];
  const expected = metrics.officialTaskCount ?? 0;
  const blockers = [
    ...(!outputComplete ? [`${args.adapterId}: local product output manifest is incomplete or missing; official scorer input coverage is not ready.`] : []),
    ...localScaffoldBlockers(args.adapterId, metrics),
  ];
  const productStatus: "complete" | "partial" | "missing" = outputComplete
    ? "complete"
    : outputManifest ? "partial" : "missing";

  return {
    schema: "proofloop-official-score-receipt-v1",
    adapterId: args.adapterId,
    status: "blocked_external",
    generatedAt,
    officialScorer: officialScorerMetadata(args.adapterId),
    attempted: scaffoldAttempted(args.adapterId, metrics),
    blockers: [...new Set(blockers)],
    scoreClaim: false,
    claimBoundary: {
      productPathStatus: args.adapterId === "finch" || args.adapterId === "workstreambench"
        ? outputComplete ? "complete_model_outputs" : "incomplete_model_outputs"
        : outputComplete ? "complete_prediction_jsonl" : "incomplete_prediction_jsonl",
      proxyStatus: "proxy_only_not_official",
      officialScorerStatus: "blocked_external",
      officialJudgeReceiptStatus: "pending",
      officialScoreClaimable: false,
      requiredAcceptedReceipt: requiredAcceptedReceiptFor(args.adapterId),
    },
    acceptedExternalScorerReceipt: null,
    pendingExternalScorerReceipt: pendingScorerReceipt(args.adapterId, expected),
    localProductOutputReceipt: {
      status: productStatus,
      officialScoreClaim: false,
      reason: outputComplete
        ? productPathCompleteReason(args.adapterId)
        : productPathIncompleteReason(args.adapterId, expected),
      metrics,
      evidence: outputEvidence,
    },
    officialOutputManifest: {
      path: officialOutputManifestPath(args.adapterId),
      status: outputManifest?.status ?? null,
      officialTaskCount: metrics.officialTaskCount,
      outputTaskCount: metrics.outputTaskCount,
      predictionRowCount: metrics.predictionRowCount,
      contentPartsCount: metrics.contentPartsCount,
    },
    evidence: [...new Set([
      `docs/eval/proofloop-official-task-bundles/${args.adapterId}.json`,
      `proofloop/benchmarks/${args.adapterId}/adapter.json`,
      `docs/eval/proofloop-external-adapter-runs/${args.adapterId}.json`,
      ...outputEvidence,
    ])],
  };
}

function receiptOutputManifestComplete(
  adapterId: OfficialScoreImportAdapterId,
  metrics: OfficialScoreImportReadiness["metrics"],
): boolean {
  const expected = metrics.officialTaskCount ?? 0;
  if (expected <= 0) return false;
  if (adapterId === "finch" || adapterId === "workstreambench") return (metrics.outputTaskCount ?? 0) >= expected;
  return (metrics.predictionRowCount ?? 0) >= expected;
}

function acceptedReceiptFrom(receipt: JsonRecord | undefined): JsonRecord | undefined {
  const candidateKeys = [
    "acceptedExternalScorerReceipt",
    "acceptedExternalJudgeReceipt",
    "acceptedJudgeReceipt",
    "officialScorerReceipt",
    "officialJudgeReceipt",
  ];
  for (const key of candidateKeys) {
    const candidate = asRecord(receipt?.[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function pendingReceiptFrom(receipt: JsonRecord | undefined): JsonRecord | undefined {
  const candidateKeys = [
    "pendingExternalScorerReceipt",
    "pendingOfficialJudgeReceipt",
    "pendingOfficialScorerReceipt",
  ];
  for (const key of candidateKeys) {
    const candidate = asRecord(receipt?.[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function acceptedExternalScorerKind(receipt: JsonRecord | undefined): string | null {
  return stringField(receipt, "kind") ?? stringField(receipt, "scorer") ?? stringField(receipt, "judge") ?? null;
}

function acceptedReceiptBlockers(receipt: JsonRecord | undefined): string[] {
  if (!receipt) return ["accepted upstream external scorer receipt is missing."];
  const blockers: string[] = [];
  const status = lower(stringField(receipt, "status"));
  const accepted = receipt.accepted === true || ["accepted", "passed", "scored"].includes(status);
  const source = lower(stringField(receipt, "source"));
  const isProxy = receipt.proxy === true || source.includes("proxy") || source.includes("local");
  const isOfficial = receipt.official === true || source.includes("official") || source.includes("upstream");
  if (!accepted) blockers.push(`accepted upstream external scorer receipt status is ${String(receipt.status ?? "missing")}.`);
  if (!isOfficial) blockers.push("accepted upstream external scorer receipt must identify an official/upstream source.");
  if (isProxy) blockers.push("proxy or local judge receipts cannot promote an official score.");
  return blockers;
}

function finchAcceptedReceiptBlockers(
  receipt: JsonRecord | undefined,
  metrics: OfficialScoreImportReadiness["metrics"],
): string[] {
  const blockers: string[] = [];
  const expected = metrics.officialTaskCount ?? 0;
  const contentPartsCount = contentPartsCountFor(receipt, metrics);
  if (expected <= 0 || contentPartsCount < expected) {
    blockers.push(`finch: content_parts coverage is ${contentPartsCount}/${expected}; the canonical judge requires full content_parts.jsonl coverage.`);
  }
  if (!receipt) {
    blockers.push("finch: accepted canonical Finch GPT-5-mini judge receipt is missing.");
    return blockers;
  }
  const kind = lower(acceptedExternalScorerKind(receipt));
  const provider = lower(stringField(receipt, "provider"));
  if (!kind.includes("finch") || !kind.includes("judge")) {
    blockers.push("finch: accepted receipt must be a Finch judge/scorer receipt.");
  }
  const azureOfficial = kind.includes("azure") && provider.includes("azure");
  const directEquivalent = kind.includes("canonical") && provider === "openai";
  if (!azureOfficial && !directEquivalent) {
    blockers.push("finch: accepted receipt must identify either the canonical direct-OpenAI transport-equivalent path or the released Azure judge path.");
  }
  if (directEquivalent) {
    const equivalence = asRecord(receipt.equivalenceContract);
    if (
      !equivalence
      || equivalence.accepted !== true
      || stringField(equivalence, "contractId") !== "finch-gpt5mini-canonical-v1"
      || stringField(equivalence, "canonicalModel") !== "gpt-5-mini"
      || equivalence.transportOnly !== true
    ) {
      blockers.push("finch: direct OpenAI receipt is missing the accepted canonical GPT-5-mini transport-equivalence contract.");
    }
  }
  return blockers;
}

function finAuditingAcceptedReceiptBlockers(
  receipt: JsonRecord | undefined,
  metrics: OfficialScoreImportReadiness["metrics"],
): string[] {
  const blockers: string[] = [];
  const expected = metrics.officialTaskCount ?? 0;
  const predictionRows = metrics.predictionRowCount ?? 0;
  if (expected <= 0 || predictionRows < expected) {
    blockers.push(`finauditing: prediction coverage is ${predictionRows}/${expected}; official scorer input requires full FinSM/FinRE/FinMR prediction JSONL coverage.`);
  }
  if (!receipt) {
    blockers.push("finauditing: accepted FinMR judge/scorer receipt is missing.");
    return blockers;
  }
  const kind = lower(acceptedExternalScorerKind(receipt));
  const datasets = arrayStrings(receipt.datasets).map((item) => item.toLowerCase());
  const finMr = asRecord(receipt.finMr) ?? asRecord(receipt.FinMR);
  const hasFinMr = kind.includes("finmr") || datasets.includes("finmr") || Boolean(finMr);
  const finMrAccepted = isAccepted(finMr) || (hasFinMr && isAccepted(receipt));
  if (!kind.includes("finauditing") && !kind.includes("finmr")) {
    blockers.push("finauditing: accepted receipt must identify the FinAuditing scorer or FinMR judge.");
  }
  if (!hasFinMr || !finMrAccepted) {
    blockers.push("finauditing: accepted FinMR judge receipt is required before claiming an official score.");
  }
  return blockers;
}

function workstreamBenchAcceptedReceiptBlockers(
  receipt: JsonRecord | undefined,
  metrics: OfficialScoreImportReadiness["metrics"],
): string[] {
  const blockers: string[] = [];
  const expected = metrics.officialTaskCount ?? 0;
  const outputTasks = metrics.outputTaskCount ?? 0;
  if (expected <= 0 || outputTasks < expected) {
    blockers.push(`workstreambench: MBABench case coverage is ${outputTasks}/${expected}; official scoring requires every exported case folder.`);
  }
  if (!receipt) {
    blockers.push("workstreambench: accepted full MBABench judge receipt is missing.");
    return blockers;
  }
  const kind = lower(acceptedExternalScorerKind(receipt));
  const provider = lower(stringField(receipt, "provider"));
  const judgeModel = stringField(receipt, "judgeModel");
  const expectedCases = numberField(receipt, "expectedCases") ?? 0;
  const completedCases = numberField(receipt, "completedCases") ?? 0;
  if (!kind.includes("workstreambench") || !kind.includes("mbabench") || !kind.includes("judge")) {
    blockers.push("workstreambench: accepted receipt must identify the WorkstreamBench MBABench judge.");
  }
  if (expected <= 0 || expectedCases !== expected || completedCases !== expected) {
    blockers.push(`workstreambench: accepted MBABench judge coverage is ${completedCases}/${expectedCases}; expected ${expected}/${expected}.`);
  }
  if (provider !== "google" || judgeModel !== "google/gemini-3-flash-preview") {
    blockers.push("workstreambench: accepted receipt must use the pinned google/gemini-3-flash-preview judge contract.");
  }
  return blockers;
}

function contentPartsCountFor(
  receipt: JsonRecord | undefined,
  metrics: OfficialScoreImportReadiness["metrics"],
): number {
  const receiptCount = numberField(receipt, "contentPartsCount");
  if (typeof receiptCount === "number") return receiptCount;
  return metrics.contentPartsCount ?? 0;
}

function isAccepted(value: JsonRecord | undefined): boolean {
  if (!value) return false;
  return value.accepted === true || ["accepted", "passed", "scored"].includes(lower(stringField(value, "status")));
}

function requiredAcceptedReceiptFor(adapterId: OfficialScoreImportAdapterId): string {
  if (adapterId === "finch") {
    return "accepted canonical Finch GPT-5-mini judge receipt over full content_parts.jsonl coverage";
  }
  if (adapterId === "workstreambench") {
    return "accepted MBABench judge receipt over all 38 locked WorkstreamBench cases";
  }
  return "accepted FinAuditing scorer receipt with an accepted FinMR judge result";
}

function officialScorerMetadata(adapterId: OfficialScoreImportAdapterId): JsonRecord {
  if (adapterId === "finch") {
    return {
      repository: "https://github.com/FinWorkBench/Finch",
      commit: "95a8b8d135a528b325be003e54c55f886a22602d",
      canonicalJudgeModel: "gpt-5-mini",
      paper: "https://aclanthology.org/2026.findings-acl.523/",
      releasedCommandTemplate: "python src/call_gpt_judge.py eval_set -o results.xlsx --api-key <AZURE_KEY> --azure-endpoint <AZURE_ENDPOINT> --api-version <API_VERSION> --model <DEPLOYMENT_NAME>",
      equivalentCommandTemplate: "python scripts/finch-official-judge.py --provider openai --judge-model gpt-5-mini --allow-provider-spend --max-provider-cost-usd <CAP>",
      inputPrerequisite: "eval_set/<model>/content_parts.jsonl produced by src/prompt_build_pipeline.py from the official 172-task Finch dataset and model output files",
    };
  }
  if (adapterId === "workstreambench") {
    return {
      repository: "https://github.com/namkoong-lab/MBABench",
      commit: "c56319bea67fa5bfea8ed8010e93a88e1b8877e5",
      paper: "https://arxiv.org/abs/2605.22664",
      scorerEntrypoint: "judge/main_scripts/judge.py",
      canonicalJudgeModel: "google/gemini-3-flash-preview",
      expectedCaseFormat: "MBABench case folders with ai_attempt.xlsx and solution workbooks",
    };
  }
  return {
    repository: "https://github.com/The-FinAI/FinAuditing",
    commit: "cee2b4e563d8d6cadb94cd0138163bb72e8ee0e7",
    localEvaluatorEntrypoints: [
      "StartKit/evaluateFinSM.ipynb",
      "StartKit/evaluateFinRE.ipynb",
      "StartKit/evaluateFinMR.ipynb",
    ],
    expectedPredictionFormat: "JSONL rows with prediction and ground_truth fields",
  };
}

function scaffoldAttempted(
  adapterId: OfficialScoreImportAdapterId,
  metrics: OfficialScoreImportReadiness["metrics"],
): string[] {
  if (adapterId === "finch") {
    return [
      "Locked the official Finch task-bundle receipt and local adapter metadata.",
      "Verified NodeRoom local product output artifacts against the official Finch task count.",
      `Scaffolded a blocked official-score receipt with ${metrics.outputTaskCount ?? 0}/${metrics.officialTaskCount ?? 0} model-output artifacts and no canonical GPT-5-mini judge score claim.`,
    ];
  }
  if (adapterId === "workstreambench") {
    return [
      "Locked the public MBABench ModelOff task bundle and pinned scorer revision.",
      "Verified NodeRoom official-format case folders, ai_attempt workbooks, and solution workbooks.",
      `Scaffolded a blocked official-score receipt with ${metrics.outputTaskCount ?? 0}/${metrics.officialTaskCount ?? 0} case folders and no accepted MBABench judge score claim.`,
    ];
  }
  return [
    "Locked the official FinAuditing task-bundle receipt and local adapter metadata.",
    "Verified NodeRoom official-format FinSM, FinRE, and FinMR prediction JSONL exports.",
    `Scaffolded a blocked official-score receipt with ${metrics.predictionRowCount ?? 0}/${metrics.officialTaskCount ?? 0} prediction rows and no official judge score claim.`,
  ];
}

function localScaffoldBlockers(
  adapterId: OfficialScoreImportAdapterId,
  metrics: OfficialScoreImportReadiness["metrics"],
): string[] {
  if (adapterId === "finch") {
    const contentPartsCount = metrics.contentPartsCount ?? 0;
    const expected = metrics.officialTaskCount ?? 0;
    return [
      "No accepted canonical Finch GPT-5-mini judge/scorer receipt has been imported; no official score is claimed.",
      "No paid canonical judge call was invoked in this local scaffold pass.",
      ...(expected <= 0 || contentPartsCount < expected
        ? [`Upstream Finch content_parts rendering is ${contentPartsCount}/${expected}; canonical judge input remains incomplete even though model-output artifacts are complete.`]
        : []),
    ];
  }
  if (adapterId === "workstreambench") {
    return [
      "No accepted full MBABench judge receipt has been imported; no official score is claimed.",
      "The no-provider MBABench smoke proves file preparation only and cannot promote a score.",
    ];
  }
  return [
    "No accepted upstream FinAuditing FinMR judge/scorer receipt has been imported; no official score is claimed.",
    "No paid OpenAI/LLM judge call was invoked in this local scaffold pass.",
  ];
}

function pendingScorerReceipt(
  adapterId: OfficialScoreImportAdapterId,
  expectedTaskCount: number,
): LocalOfficialScoreScaffoldReceipt["pendingExternalScorerReceipt"] {
  if (adapterId === "finch") {
    return {
      kind: "finch_canonical_judge",
      status: "pending",
      accepted: false,
      official: true,
      source: "upstream_official_pending",
      provider: "canonical_gpt5mini_transport_pending",
      taskCount: expectedTaskCount,
      requiredAcceptedReceipt: requiredAcceptedReceiptFor(adapterId),
      reason: "The local scaffold proves product-output coverage only. Finch official scoring remains pending until the canonical GPT-5-mini judge produces an accepted receipt over full content_parts.jsonl coverage through the recorded direct-OpenAI transport-equivalent contract or the released Azure transport.",
      paidProviderCalls: false,
      providerCallsAttempted: false,
    };
  }
  if (adapterId === "workstreambench") {
    return {
      kind: "workstreambench_mbabench_judge",
      status: "pending",
      accepted: false,
      official: true,
      source: "upstream_official_pending",
      provider: "google",
      judgeModel: "google/gemini-3-flash-preview",
      taskCount: expectedTaskCount,
      requiredAcceptedReceipt: requiredAcceptedReceiptFor(adapterId),
      reason: "The local scaffold proves MBABench case-folder coverage only. Official scoring remains pending until all locked cases have an accepted pinned-judge receipt.",
      paidProviderCalls: false,
      providerCallsAttempted: false,
    };
  }
  return {
    kind: "finauditing_finmr_judge",
    status: "pending",
    accepted: false,
    official: true,
    source: "upstream_official_pending",
    datasets: ["FinSM", "FinRE", "FinMR"],
    taskCount: expectedTaskCount,
    requiredAcceptedReceipt: requiredAcceptedReceiptFor(adapterId),
    reason: "The local scaffold proves prediction JSONL coverage only. FinAuditing official scoring remains pending until the upstream FinMR judge/scorer produces an accepted receipt.",
    paidProviderCalls: false,
    providerCallsAttempted: false,
  };
}

function productPathCompleteReason(adapterId: OfficialScoreImportAdapterId): string {
  if (adapterId === "finch") {
    return "NodeRoom model-output artifacts cover the official Finch task set; this is product/export evidence, not an official score.";
  }
  if (adapterId === "workstreambench") {
    return "NodeRoom exports every locked WorkstreamBench task as an MBABench judge case folder; this is product/export evidence, not an official score.";
  }
  return "NodeRoom official-format prediction JSONL covers FinSM, FinRE, and FinMR; this is product/export evidence, not an official score.";
}

function productPathIncompleteReason(adapterId: OfficialScoreImportAdapterId, expectedTaskCount: number): string {
  if (adapterId === "finch") {
    return `NodeRoom Finch model-output artifact coverage is incomplete for ${expectedTaskCount || "unknown"} official tasks.`;
  }
  if (adapterId === "workstreambench") {
    return `NodeRoom MBABench case-folder coverage is incomplete for ${expectedTaskCount || "unknown"} official cases.`;
  }
  return `NodeRoom FinAuditing prediction JSONL coverage is incomplete for ${expectedTaskCount || "unknown"} official rows.`;
}

function proxyEvidenceFor(adapterId: OfficialScoreImportAdapterId, receipt: JsonRecord | undefined): string[] {
  const evidence = arrayStrings(receipt?.evidence).filter((item) =>
    item.includes("proofloop-proxy") ||
    item.includes("proofloop-external-adapter-runs") ||
    item.includes("proofloop-external-adapter-live-room-runs")
  );
  return [...new Set([
    `docs/eval/proofloop-external-adapter-runs/${adapterId}.json`,
    `docs/eval/proofloop-external-adapter-live-room-runs/${adapterId}.json`,
    ...evidence,
  ])];
}

function acceptedReceiptEvidence(receipt: JsonRecord | undefined): string[] {
  if (!receipt) return [];
  return [
    stringField(receipt, "receiptPath"),
    stringField(receipt, "artifactPath"),
    stringField(receipt, "outputPath"),
    stringField(receipt, "contentPartsPath"),
  ].filter((item): item is string => Boolean(item));
}

function readJson(path: string): JsonRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as JsonRecord;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringField(value: JsonRecord | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: JsonRecord | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function lower(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase();
}
