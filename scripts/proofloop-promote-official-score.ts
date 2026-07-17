import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type PromotionId = "finch" | "finauditing" | "workstreambench";

const args = process.argv.slice(2);
const id = optionValue("--id") as PromotionId | undefined;
const judgeReceiptPath = optionValue("--judge-receipt");
if (!id || !["finch", "finauditing", "workstreambench"].includes(id) || !judgeReceiptPath) {
  throw new Error("Usage: tsx scripts/proofloop-promote-official-score.ts --id finch|finauditing|workstreambench --judge-receipt <path> [--json-out <path>]");
}

const outputPath = optionValue("--json-out") ?? `docs/eval/proofloop-official-scores/${id}.json`;
const judge = readJson<Record<string, unknown>>(judgeReceiptPath);
const outputManifestPath = `docs/eval/proofloop-official-outputs/${id}.json`;
const outputManifest = readJson<Record<string, unknown>>(outputManifestPath);
const previous = existsSync(outputPath) ? readJson<Record<string, unknown>>(outputPath) : {};

const acceptedSources = id === "finch"
  ? ["upstream_official", "upstream_equivalent"]
  : ["upstream_official"];
if (
  judge.accepted !== true
  || judge.status !== "accepted"
  || judge.official !== true
  || !acceptedSources.includes(String(judge.source))
) {
  throw new Error(`${id} judge receipt is not an accepted upstream official receipt: ${judgeReceiptPath}`);
}
if (outputManifest.status !== "complete") throw new Error(`${id} official output manifest is not complete: ${outputManifestPath}`);

const generatedAt = new Date().toISOString();
const judgeEvidence = {
  path: normalizePath(judgeReceiptPath),
  sha256: sha256(judgeReceiptPath),
};
const receipt = id === "finch"
  ? promoteFinch(previous, outputManifest, judge, judgeEvidence, generatedAt)
  : id === "finauditing"
    ? promoteFinAuditing(previous, outputManifest, judge, judgeEvidence, generatedAt)
    : promoteWorkstreamBench(previous, outputManifest, judge, judgeEvidence, generatedAt);

mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${id}: promoted accepted official score receipt -> ${normalizePath(outputPath)}`);

function promoteFinch(
  previous: Record<string, unknown>,
  manifest: Record<string, unknown>,
  acceptedJudge: Record<string, unknown>,
  judgeEvidence: { path: string; sha256: string },
  generatedAt: string,
) {
  const officialTaskCount = numberField(manifest, "officialTaskCount");
  const outputTaskCount = numberField(manifest, "outputTaskCount");
  const contentPartsCount = numberField(manifest, "contentPartsCount");
  const contentPartsSha256 = String(manifest.contentPartsSha256 ?? "");
  const expectedTasks = numberField(acceptedJudge, "expectedTasks");
  const selectedTasks = numberField(acceptedJudge, "selectedTasks");
  const completedTasks = numberField(acceptedJudge, "completedTasks");
  const judgedContentParts = numberField(acceptedJudge, "contentPartsCount");
  const providerCalls = numberField(acceptedJudge, "providerCalls");
  const parseErrorCount = numberField(acceptedJudge, "parseErrorCount");
  if (officialTaskCount !== 172 || outputTaskCount !== 172 || contentPartsCount !== 172) {
    throw new Error(`Finch output coverage must be 172/172 with full content_parts, got outputs=${outputTaskCount}/${officialTaskCount}, content_parts=${contentPartsCount}`);
  }
  if (expectedTasks !== 172 || selectedTasks !== 172 || completedTasks !== 172 || judgedContentParts !== 172) {
    throw new Error(`Finch accepted canonical judge receipt must cover 172/172 tasks, got selected=${selectedTasks}, completed=${completedTasks}/${expectedTasks} with ${judgedContentParts} content_parts`);
  }
  const judgedContentPartsEvidence = recordField(acceptedJudge, "contentParts");
  const judgedContentPartsPath = String(judgedContentPartsEvidence.path ?? "");
  const judgedContentPartsSha256 = String(judgedContentPartsEvidence.sha256 ?? "");
  if (!judgedContentPartsPath || !existsSync(resolve(judgedContentPartsPath))) {
    throw new Error(`Finch accepted receipt content_parts path is missing: ${judgedContentPartsPath || "unspecified"}.`);
  }
  const actualContentPartsSha256 = sha256(judgedContentPartsPath);
  if (
    !contentPartsSha256 ||
    !judgedContentPartsSha256 ||
    contentPartsSha256 !== judgedContentPartsSha256 ||
    actualContentPartsSha256 !== judgedContentPartsSha256
  ) {
    throw new Error(
      `Finch content_parts SHA-256 mismatch: manifest=${contentPartsSha256 || "missing"}, ` +
      `judge=${judgedContentPartsSha256 || "missing"}, actual=${actualContentPartsSha256}.`,
    );
  }
  const source = String(acceptedJudge.source ?? "");
  if (
    acceptedJudge.status !== "accepted"
    || acceptedJudge.accepted !== true
    || acceptedJudge.official !== true
    || !["upstream_official", "upstream_equivalent"].includes(source)
  ) {
    throw new Error("Finch judge receipt must be accepted official upstream evidence before promotion.");
  }
  const provider = String(acceptedJudge.provider ?? "");
  const kind = String(acceptedJudge.kind ?? "");
  const azureOfficial = source === "upstream_official"
    && provider === "azure_openai"
    && kind === "finch_azure_judge";
  const directEquivalent = source === "upstream_equivalent"
    && provider === "openai"
    && kind === "finch_canonical_judge";
  if (!azureOfficial && !directEquivalent) {
    throw new Error(`Unexpected Finch judge contract: source=${source}, provider=${provider}, kind=${kind}`);
  }
  if (providerCalls < 172) throw new Error(`Finch accepted receipt requires at least 172 provider calls, got ${providerCalls}.`);
  if (parseErrorCount !== 0) throw new Error(`Finch accepted receipt contains ${parseErrorCount} parse error(s).`);
  const usage = recordField(acceptedJudge, "usage");
  const accountedProviderCostUsd = numberField(usage, "accountedProviderCostUsd");
  const maxProviderCostUsd = numberField(usage, "maxProviderCostUsd");
  if (accountedProviderCostUsd > maxProviderCostUsd) {
    throw new Error(`Finch accounted provider cost ${accountedProviderCostUsd} exceeds cap ${maxProviderCostUsd}.`);
  }
  const upstream = recordField(acceptedJudge, "upstream");
  if (upstream.commit !== "95a8b8d135a528b325be003e54c55f886a22602d") {
    throw new Error(`Unexpected Finch upstream commit: ${String(upstream.commit)}`);
  }
  const judgeModel = String(acceptedJudge.judgeModel ?? "").trim();
  if (!judgeModel) throw new Error("Finch accepted receipt must identify the canonical judge model or Azure deployment.");
  const taskInputBinding = validateFinchTaskInputBinding(acceptedJudge, provider, judgeModel);
  let equivalenceSummary: Record<string, unknown> | null = null;
  if (directEquivalent) {
    if (!isCanonicalFinchJudgeModel(judgeModel)) {
      throw new Error(`Finch direct equivalent must request canonical gpt-5-mini, got ${judgeModel}.`);
    }
    const resolvedModels = arrayStrings(acceptedJudge.resolvedJudgeModels);
    if (resolvedModels.length === 0 || resolvedModels.some((model) => !isCanonicalFinchJudgeModel(model))) {
      throw new Error(`Finch direct equivalent resolved unexpected judge model(s): ${resolvedModels.join(", ") || "missing"}.`);
    }
    const equivalence = recordField(acceptedJudge, "equivalenceContract");
    const expectedPromptPath = ".tmp/official-benchmarks/finch-repo/src/build_prompt/content_builder/prompts.py";
    if (!existsSync(resolve(expectedPromptPath))) {
      throw new Error(`Missing pinned Finch prompt source: ${expectedPromptPath}`);
    }
    const expectedPromptSha256 = sha256(expectedPromptPath);
    const requestFields = arrayStrings(equivalence.requestFields);
    if (
      equivalence.schema !== "finch-judge-transport-equivalence-v1"
      || equivalence.status !== "accepted"
      || equivalence.accepted !== true
      || equivalence.contractId !== "finch-gpt5mini-canonical-v1"
      || equivalence.canonicalModel !== "gpt-5-mini"
      || equivalence.canonicalModelVersion !== "2025-08-07"
      || equivalence.transportOnly !== true
      || equivalence.releasedTransport !== "openai.AzureOpenAI"
      || equivalence.equivalentTransport !== "openai.OpenAI"
      || equivalence.requestPath !== "chat.completions.create"
      || requestFields.join(",") !== "model,messages,max_completion_tokens,temperature"
      || equivalence.promptUpgradeMethod !== "GPTJudgeCaller._upgrade_prompt"
      || equivalence.parserMethod !== "GPTJudgeCaller._parse_response"
      || equivalence.requestedModel !== judgeModel
      || equivalence.promptSourceSha256 !== expectedPromptSha256
    ) {
      throw new Error("Finch direct OpenAI receipt is missing the accepted canonical transport-equivalence contract.");
    }
    equivalenceSummary = {
      schema: equivalence.schema,
      status: "accepted",
      accepted: true,
      contractId: equivalence.contractId,
      canonicalModel: equivalence.canonicalModel,
      canonicalModelVersion: equivalence.canonicalModelVersion,
      transportOnly: true,
      promptSourceSha256: expectedPromptSha256,
      resolvedModels,
    };
  }

  return {
    ...previous,
    schema: "proofloop-official-score-receipt-v1",
    adapterId: "finch",
    status: "scored",
    generatedAt,
    blockers: [],
    scoreClaim: true,
    claimBoundary: {
      productPathStatus: "complete_model_outputs",
      proxyStatus: "proxy_only_not_official",
      officialScorerStatus: "accepted",
      officialJudgeReceiptStatus: "accepted",
      officialScoreClaimable: true,
      requiredAcceptedReceipt: "accepted canonical Finch GPT-5-mini judge receipt over full content_parts.jsonl coverage",
    },
    acceptedExternalScorerReceipt: {
      kind,
      status: "accepted",
      accepted: true,
      official: true,
      source,
      provider,
      judgeModel,
      taskCount: completedTasks,
      contentPartsCount: judgedContentParts,
      contentPartsSha256: judgedContentPartsSha256,
      taskInputBinding,
      receiptPath: judgeEvidence.path,
      receiptSha256: judgeEvidence.sha256,
      equivalenceContract: equivalenceSummary,
    },
    pendingExternalScorerReceipt: null,
    scores: {
      expectedTasks,
      completedTasks,
      meanScore: acceptedJudge.meanScore,
      parseErrorCount,
      providerCostUsd: acceptedJudge.providerCostUsd,
      usage,
    },
    officialOutputManifest: {
      path: outputManifestPathFor("finch"),
      status: manifest.status,
      officialTaskCount,
      outputTaskCount,
      predictionRowCount: null,
      contentPartsCount,
      contentPartsSha256,
    },
    evidence: unique([
      ...arrayStrings(previous.evidence),
      outputManifestPathFor("finch"),
      judgeEvidence.path,
    ]),
  };
}

function isCanonicalFinchJudgeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "gpt-5-mini" || normalized === "gpt-5-mini-2025-08-07";
}

function validateFinchTaskInputBinding(
  acceptedJudge: Record<string, unknown>,
  provider: string,
  judgeModel: string,
): Record<string, unknown> {
  const evidence = recordField(acceptedJudge, "judgeOutput");
  const path = String(evidence.path ?? "");
  const expectedSha256 = String(evidence.sha256 ?? "");
  if (!path || !existsSync(resolve(path))) {
    throw new Error(`Finch accepted receipt judge-output path is missing: ${path || "unspecified"}.`);
  }
  const actualSha256 = sha256(path);
  if (!expectedSha256 || expectedSha256 !== actualSha256) {
    throw new Error(`Finch judge-output SHA-256 mismatch: receipt=${expectedSha256 || "missing"}, actual=${actualSha256}.`);
  }

  const lines = readFileSync(resolve(path), "utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length !== 172) {
    throw new Error(`Finch judge output must contain 172 hash-bound rows, got ${lines.length}.`);
  }
  const seen = new Set<string>();
  const bindings: string[] = [];
  for (const [index, line] of lines.entries()) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Finch judge output row ${index + 1} is invalid JSON: ${String(error)}`);
    }
    const taskId = String(row.task_id ?? "");
    const contentRecordSha256 = String(row.content_record_sha256 ?? "");
    const rowProvider = String(row.judge_provider ?? row.provider ?? "");
    const rowJudgeModel = String(row.judge_model ?? "");
    const score = row.score;
    if (!taskId || seen.has(taskId)) {
      throw new Error(`Finch judge output has a missing or duplicate task id at row ${index + 1}: ${taskId || "missing"}.`);
    }
    if (!/^[0-9a-f]{64}$/.test(contentRecordSha256)) {
      throw new Error(`Finch judge output task ${taskId} is missing its canonical content-record SHA-256.`);
    }
    if (
      rowProvider !== provider
      || rowJudgeModel !== judgeModel
      || row.judge_contract !== "finch-gpt5mini-canonical-v1"
      || row.provider_call !== true
      || row.error
      || typeof score !== "number"
      || !Number.isFinite(score)
    ) {
      throw new Error(`Finch judge output task ${taskId} does not satisfy the accepted provider/model/result contract.`);
    }
    if (provider === "openai" && !isCanonicalFinchJudgeModel(String(row.resolved_judge_model ?? ""))) {
      throw new Error(`Finch judge output task ${taskId} resolved a non-canonical direct judge model.`);
    }
    seen.add(taskId);
    bindings.push(`${taskId}:${contentRecordSha256}`);
  }

  return {
    schema: "finch-task-input-binding-v1",
    algorithm: "sha256-canonical-json-v1",
    boundTasks: bindings.length,
    aggregateSha256: createHash("sha256").update(bindings.sort().join("\n")).digest("hex"),
    judgeOutputPath: normalizePath(path),
    judgeOutputSha256: actualSha256,
  };
}

function promoteFinAuditing(
  previous: Record<string, unknown>,
  manifest: Record<string, unknown>,
  acceptedJudge: Record<string, unknown>,
  judgeEvidence: { path: string; sha256: string },
  generatedAt: string,
) {
  const officialTaskCount = numberField(manifest, "officialTaskCount");
  const predictionRowCount = numberField(manifest, "predictionRowCount");
  const expectedRows = numberField(acceptedJudge, "expectedRows");
  const judgedRows = numberField(acceptedJudge, "judgedRows");
  if (officialTaskCount !== 1102 || predictionRowCount !== 1102) {
    throw new Error(`FinAuditing output coverage must be 1102/1102, got ${predictionRowCount}/${officialTaskCount}`);
  }
  if (expectedRows !== 332 || judgedRows !== 332) {
    throw new Error(`FinAuditing accepted FinMR receipt must cover 332/332 rows, got ${judgedRows}/${expectedRows}`);
  }
  if (acceptedJudge.judgeModel !== "gpt-5-mini") throw new Error(`Unexpected FinMR judge model: ${String(acceptedJudge.judgeModel)}`);
  const localEvaluatorPath = "docs/eval/proofloop-finauditing-local-evaluator-smoke.json";
  const localEvaluator = readJson<Record<string, unknown>>(localEvaluatorPath);
  const localEvaluation = recordField(localEvaluator, "localDeterministicEvaluation");
  if (localEvaluation.status !== "complete") throw new Error("FinAuditing deterministic FinSM/FinRE evaluation is not complete.");

  return {
    ...previous,
    schema: "proofloop-official-score-receipt-v1",
    adapterId: "finauditing",
    status: "scored",
    generatedAt,
    blockers: [],
    scoreClaim: true,
    claimBoundary: {
      productPathStatus: "complete_prediction_jsonl",
      proxyStatus: "proxy_only_not_official",
      officialScorerStatus: "accepted",
      officialJudgeReceiptStatus: "accepted",
      officialScoreClaimable: true,
      requiredAcceptedReceipt: "accepted FinAuditing scorer receipt with an accepted FinMR judge result",
    },
    acceptedExternalScorerReceipt: {
      kind: "finauditing_finmr_judge",
      status: "accepted",
      accepted: true,
      official: true,
      source: "upstream_official",
      provider: acceptedJudge.provider,
      judgeModel: acceptedJudge.judgeModel,
      datasets: ["FinSM", "FinRE", "FinMR"],
      finMr: {
        status: "accepted",
        accepted: true,
        expectedRows,
        judgedRows,
        labelCounts: acceptedJudge.labelCounts,
        receiptPath: judgeEvidence.path,
      },
      receiptPath: judgeEvidence.path,
      receiptSha256: judgeEvidence.sha256,
    },
    pendingExternalScorerReceipt: null,
    scores: {
      FinSM: recordField(localEvaluation, "FinSM"),
      FinRE: recordField(localEvaluation, "FinRE"),
      FinMR: {
        expectedRows,
        judgedRows,
        labelCounts: acceptedJudge.labelCounts,
        usage: acceptedJudge.usage,
      },
    },
    officialOutputManifest: {
      path: outputManifestPathFor("finauditing"),
      status: manifest.status,
      officialTaskCount,
      outputTaskCount: null,
      predictionRowCount,
      contentPartsCount: null,
    },
    evidence: unique([
      ...arrayStrings(previous.evidence),
      outputManifestPathFor("finauditing"),
      localEvaluatorPath,
      judgeEvidence.path,
    ]),
  };
}

function promoteWorkstreamBench(
  previous: Record<string, unknown>,
  manifest: Record<string, unknown>,
  acceptedJudge: Record<string, unknown>,
  judgeEvidence: { path: string; sha256: string },
  generatedAt: string,
) {
  const officialTaskCount = numberField(manifest, "officialTaskCount");
  const outputTaskCount = numberField(manifest, "outputTaskCount");
  const expectedCases = numberField(acceptedJudge, "expectedCases");
  const completedCases = numberField(acceptedJudge, "completedCases");
  if (officialTaskCount !== 38 || outputTaskCount !== 38) {
    throw new Error(`WorkstreamBench output coverage must be 38/38, got ${outputTaskCount}/${officialTaskCount}`);
  }
  if (expectedCases !== 38 || completedCases !== 38) {
    throw new Error(`MBABench accepted receipt must cover 38/38 cases, got ${completedCases}/${expectedCases}`);
  }
  if (acceptedJudge.judgeModel !== "google/gemini-3-flash-preview") {
    throw new Error(`Unexpected MBABench judge model: ${String(acceptedJudge.judgeModel)}`);
  }
  return {
    ...previous,
    schema: "proofloop-official-score-receipt-v1",
    adapterId: "workstreambench",
    status: "scored",
    generatedAt,
    blockers: [],
    scoreClaim: true,
    acceptedExternalScorerReceipt: {
      kind: "workstreambench_mbabench_judge",
      status: "accepted",
      accepted: true,
      official: true,
      source: "upstream_official",
      provider: acceptedJudge.provider,
      judgeModel: acceptedJudge.judgeModel,
      expectedCases,
      completedCases,
      receiptPath: judgeEvidence.path,
      receiptSha256: judgeEvidence.sha256,
    },
    claimGate: {
      officialScoreClaimable: true,
      acceptedProxyJudge: false,
      providerSpendUsd: acceptedJudge.providerCostUsd,
      providerCallsAttempted: true,
      paidProviderCalls: true,
      acceptedOfficialJudgeReceipt: true,
      noProviderSmokeAcceptedAsOfficial: false,
      reason: "All 38 locked public ModelOff cases were scored by the pinned upstream MBABench judge contract.",
    },
    officialMetrics: {
      meanScore: acceptedJudge.meanScore,
      providerCostUsd: acceptedJudge.providerCostUsd,
      promptTokens: acceptedJudge.promptTokens,
      completionTokens: acceptedJudge.completionTokens,
      totalTokens: acceptedJudge.totalTokens,
    },
    officialOutputManifest: {
      path: outputManifestPathFor("workstreambench"),
      status: manifest.status,
      officialTaskCount,
      outputTaskCount,
      predictionRowCount: null,
      contentPartsCount: null,
    },
    evidence: unique([
      ...arrayStrings(previous.evidence),
      outputManifestPathFor("workstreambench"),
      judgeEvidence.path,
    ]),
  };
}

function optionValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJson<T>(path: string): T {
  if (!existsSync(resolve(path))) throw new Error(`Missing JSON file: ${path}`);
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing numeric ${key}`);
  return value;
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

function normalizePath(path: string): string {
  return resolve(path).startsWith(process.cwd())
    ? resolve(path).slice(process.cwd().length + 1).replace(/\\/g, "/")
    : resolve(path).replace(/\\/g, "/");
}

function outputManifestPathFor(adapterId: PromotionId): string {
  return `docs/eval/proofloop-official-outputs/${adapterId}.json`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
