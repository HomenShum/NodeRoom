import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type HarnessVersionFile = {
  path: string;
  exists: boolean;
  sha256?: string;
};

export type OpenRouterEconomicsModel = {
  rank: number;
  id: string;
  name: string;
  createdAt?: string;
  contextLength: number;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsStructuredOutputs: boolean;
  supportsParallelToolCalls: boolean;
};

export type ProxyJudgeCandidate = OpenRouterEconomicsModel & {
  proxyJudgeScore: number;
  reasons: string[];
};

export type HarnessEconomicsLedger = {
  schema: "proofloop-harness-economics-v1";
  generatedAt?: string;
  git: {
    commit: string;
    dirty: boolean;
  };
  packageVersion?: string;
  policy: string[];
  harnessFiles: HarnessVersionFile[];
  openRouterSnapshot: {
    source?: string;
    generatedAt?: string;
    modelCount: number;
    cheapestToolRoutes: OpenRouterEconomicsModel[];
    newestCheapToolRoutes: OpenRouterEconomicsModel[];
    proxyJudgeCandidates: ProxyJudgeCandidate[];
    deepseekV4Pro?: OpenRouterEconomicsModel;
  };
  existingProofEconomics: {
    liveRunSuite?: string;
    liveRunPassed?: boolean;
    liveRunTotalCostUsd?: number;
    liveRunTotalDurationMs?: number;
    proximittyCostUsd?: number;
    proximittyWinner?: string;
    professionalLiveRuntimePassed?: number;
    professionalAllLiveProven?: boolean;
  };
    officialScoreBoundaries: Array<{
    lane: string;
    officialRequirement: string;
    proxyJudgeAllowedForProofLoop: boolean;
    proxyJudgeCannotClaimOfficialScore: boolean;
    recommendedProxyRoute?: string;
  }>;
  recommendations: string[];
  summary: {
    harnessFilesTracked: number;
    missingHarnessFiles: number;
    openRouterCandidates: number;
    proxyJudgeCandidates: number;
    cheaperProxyRoutesAvailable: boolean;
    acceptedOfficialScorerStillRequiredForOfficialClaims: boolean;
    officialJudgeCredentialsStillRequiredForOfficialClaims: boolean;
  };
};

type OpenRouterSnapshot = {
  source?: string;
  generatedAt?: string;
  models?: OpenRouterEconomicsModel[];
};

type LiveRunResult = {
  suite?: string;
  passed?: boolean;
  totalCostUsd?: number;
  totalDurationMs?: number;
};

type ModelComparison = {
  winner?: string;
  policies?: Array<{ policy?: string; costUsd?: number; passed?: boolean }>;
};

type CostLedger = {
  totalCostUsd?: number;
};

type ProfessionalLedger = {
  summary?: {
    liveProviderRuntimePassed?: number;
    allLiveProven?: boolean;
  };
};

const HARNESS_VERSION_FILES = [
  "scripts/proofloop.mjs",
  "scripts/proofloop-runner.ts",
  "scripts/live-proofloop-runner.ts",
  "proofloop/live-browser-proof.spec.ts",
  "proofloop/cockpit/playwrightOverlay.ts",
  "proofloop/suites/proximitty-underwriting-pr0.json",
  "proofloop/accounting/proofloop.accounting.config.json",
  "proofloop/accounting/live.accounting.config.json",
  "proofloop/notion/proofloop.notion.config.json",
  "proofloop/notion/live.notion.config.json",
  "proofloop/benchmarks/finch/adapter.json",
  "proofloop/benchmarks/finauditing/adapter.json",
  "proofloop/benchmarks/workstreambench/adapter.json",
  "scripts/proofloop-company-task-coverage.ts",
  "scripts/proofloop-harness-economics.ts",
  "src/eval/proofloopGoalSupervisor.ts",
  "src/eval/proofloopBlockerSolver.ts",
  "src/eval/proofloopModelTracking.ts",
  "src/eval/proofloopBenchmarkNormalization.ts",
  "src/eval/proofloopBenchmarkBoard.ts",
  "src/eval/proofloopCompanyTaskCoverage.ts",
  "src/eval/proofloopHarnessEconomics.ts",
  "src/eval/proofloopLiveBrowserPrompt.ts",
];

export function buildProofloopHarnessEconomicsLedger(args: {
  root?: string;
  generatedAt?: string;
} = {}): HarnessEconomicsLedger {
  const root = args.root ?? process.cwd();
  const packageJson = readJson<{ version?: string }>(root, "package.json");
  const snapshot = readJson<OpenRouterSnapshot>(root, "docs/eval/openrouter-top-paid-tools-snapshot.json");
  const models = snapshot?.models ?? [];
  const liveRun = readJson<LiveRunResult>(root, ".proofloop/live/latest/run-result.json");
  const proxModel = readJson<ModelComparison>(root, ".proofloop/runs/latest/model-comparison.json");
  const proxCost = readJson<CostLedger>(root, ".proofloop/runs/latest/cost-ledger.json");
  const professional = readJson<ProfessionalLedger>(root, "docs/eval/professional-proof-ledger.json");
  const proxyCandidates = chooseProxyJudgeCandidates(models);
  const recommendedProxyRoute = proxyCandidates[0]?.id ?? models[0]?.id;

  const ledger: HarnessEconomicsLedger = {
    schema: "proofloop-harness-economics-v1",
    generatedAt: args.generatedAt,
    git: gitState(root),
    packageVersion: packageJson?.version,
    policy: [
      "Harness versioning is based on content hashes for runner, config, adapter, and supervisor files.",
      "Cheaper model discovery is live metadata evidence, not proof of task quality until a route passes the relevant Proof Loop task.",
      "Proxy judges can keep product Proof Loop moving when official scorer credentials or hosted judges are missing.",
      "Proxy judges must not be promoted as official leaderboard scores unless the benchmark accepts that judge/scorer path.",
      "Official score receipts and product proof receipts remain separate artifacts.",
      "Judge credentials are not intrinsically required when an accepted official scorer or accepted proxy-judge path exists.",
    ],
    harnessFiles: HARNESS_VERSION_FILES.map((path) => hashFile(root, path)),
    openRouterSnapshot: {
      source: snapshot?.source,
      generatedAt: snapshot?.generatedAt,
      modelCount: models.length,
      cheapestToolRoutes: [...models].sort(byPriceThenName).slice(0, 8),
      newestCheapToolRoutes: [...models].sort(byCreatedThenPrice).slice(0, 8),
      proxyJudgeCandidates: proxyCandidates,
      deepseekV4Pro: models.find((model) => model.id === "deepseek/deepseek-v4-pro"),
    },
    existingProofEconomics: {
      liveRunSuite: liveRun?.suite,
      liveRunPassed: liveRun?.passed,
      liveRunTotalCostUsd: liveRun?.totalCostUsd,
      liveRunTotalDurationMs: liveRun?.totalDurationMs,
      proximittyCostUsd: proxCost?.totalCostUsd,
      proximittyWinner: proxModel?.winner,
      professionalLiveRuntimePassed: professional?.summary?.liveProviderRuntimePassed,
      professionalAllLiveProven: professional?.summary?.allLiveProven,
    },
    officialScoreBoundaries: [
      {
        lane: "spreadsheetbench-v1",
        officialRequirement: "Full 912-task model-run outputs and SpreadsheetBench workbook scorer receipt.",
        proxyJudgeAllowedForProofLoop: true,
        proxyJudgeCannotClaimOfficialScore: true,
        recommendedProxyRoute,
      },
      {
        lane: "spreadsheetbench-v2",
        officialRequirement: "Full 321-task bundle, run artifacts, workbook scorer, and rendered chart-grader receipt.",
        proxyJudgeAllowedForProofLoop: true,
        proxyJudgeCannotClaimOfficialScore: true,
        recommendedProxyRoute,
      },
      {
        lane: "finch",
        officialRequirement: "Upstream Finch scorer imports Azure OpenAI judge output for official claim.",
        proxyJudgeAllowedForProofLoop: true,
        proxyJudgeCannotClaimOfficialScore: true,
        recommendedProxyRoute,
      },
      {
        lane: "finauditing",
        officialRequirement: "Official-format FinSM/FinRE/FinMR predictions and the accepted FinMR judge path.",
        proxyJudgeAllowedForProofLoop: true,
        proxyJudgeCannotClaimOfficialScore: true,
        recommendedProxyRoute,
      },
      {
        lane: "workstreambench",
        officialRequirement: "Upstream official task bundle, rubric, and scorer or author-provided package.",
        proxyJudgeAllowedForProofLoop: true,
        proxyJudgeCannotClaimOfficialScore: true,
        recommendedProxyRoute,
      },
    ],
    recommendations: buildRecommendations(models, proxyCandidates),
    summary: {
      harnessFilesTracked: HARNESS_VERSION_FILES.length,
      missingHarnessFiles: 0,
      openRouterCandidates: models.length,
      proxyJudgeCandidates: proxyCandidates.length,
      cheaperProxyRoutesAvailable: proxyCandidates.length > 0,
      acceptedOfficialScorerStillRequiredForOfficialClaims: true,
      officialJudgeCredentialsStillRequiredForOfficialClaims: false,
    },
  };
  ledger.summary.missingHarnessFiles = ledger.harnessFiles.filter((file) => !file.exists).length;
  return ledger;
}

export function renderProofloopHarnessEconomicsMarkdown(ledger: HarnessEconomicsLedger): string {
  const lines = [
    "# Proof Loop Harness Economics",
    "",
    `Generated: ${ledger.generatedAt ?? "unknown"}`,
    "",
    "This ledger records harness/config versions and cheaper model routes for Proof Loop product gates while preserving official scorer boundaries.",
    "",
    "## Summary",
    "",
    `- Package version: ${ledger.packageVersion ?? "unknown"}`,
    `- Git commit: ${ledger.git.commit}${ledger.git.dirty ? " (dirty)" : ""}`,
    `- Harness files tracked: ${ledger.summary.harnessFilesTracked}`,
    `- Missing harness files: ${ledger.summary.missingHarnessFiles}`,
    `- OpenRouter candidates: ${ledger.summary.openRouterCandidates}`,
    `- Proxy judge candidates: ${ledger.summary.proxyJudgeCandidates}`,
    `- Cheaper proxy routes available: ${ledger.summary.cheaperProxyRoutesAvailable ? "yes" : "no"}`,
    `- Accepted official scorer still required for official claims: ${ledger.summary.acceptedOfficialScorerStillRequiredForOfficialClaims ? "yes" : "no"}`,
    `- Official judge credentials still required for official claims: ${ledger.summary.officialJudgeCredentialsStillRequiredForOfficialClaims ? "yes" : "no"}`,
    "",
    "## Policy",
    "",
    ...ledger.policy.map((item) => `- ${item}`),
    "",
    "## Best Proxy Judge Candidates",
    "",
    "| Rank | Model | Context | Input $/M | Output $/M | Score | Reasons |",
    "|---:|---|---:|---:|---:|---:|---|",
  ];

  for (const [index, model] of ledger.openRouterSnapshot.proxyJudgeCandidates.entries()) {
    lines.push(
      `| ${index + 1} | \`${model.id}\` | ${model.contextLength} | ${model.inputPerMillionUsd} | ` +
      `${model.outputPerMillionUsd} | ${model.proxyJudgeScore.toFixed(1)} | ${escapePipes(model.reasons.join("; "))} |`,
    );
  }

  lines.push("", "## Cheapest Tool Routes", "");
  lines.push("| Rank | Model | Context | Input $/M | Output $/M | Structured |");
  lines.push("|---:|---|---:|---:|---:|---:|");
  for (const [index, model] of ledger.openRouterSnapshot.cheapestToolRoutes.entries()) {
    lines.push(
      `| ${index + 1} | \`${model.id}\` | ${model.contextLength} | ${model.inputPerMillionUsd} | ` +
      `${model.outputPerMillionUsd} | ${model.supportsStructuredOutputs ? "yes" : "no"} |`,
    );
  }

  if (ledger.openRouterSnapshot.deepseekV4Pro) {
    const deepseek = ledger.openRouterSnapshot.deepseekV4Pro;
    lines.push(
      "",
      "## DeepSeek V4 Pro",
      "",
      `- Model: \`${deepseek.id}\``,
      `- Context: ${deepseek.contextLength}`,
      `- Pricing: $${deepseek.inputPerMillionUsd}/M input, $${deepseek.outputPerMillionUsd}/M output`,
      `- Tool capable: ${deepseek.supportsTools && deepseek.supportsToolChoice ? "yes" : "no"}`,
      `- Structured outputs: ${deepseek.supportsStructuredOutputs ? "yes" : "no"}`,
    );
  }

  lines.push("", "## Official Score Boundaries", "");
  lines.push("| Lane | Official requirement | Proxy allowed | Official claim with proxy | Recommended proxy |");
  lines.push("|---|---|---:|---:|---|");
  for (const boundary of ledger.officialScoreBoundaries) {
    lines.push(
      `| \`${boundary.lane}\` | ${escapePipes(boundary.officialRequirement)} | ` +
      `${boundary.proxyJudgeAllowedForProofLoop ? "yes" : "no"} | ` +
      `${boundary.proxyJudgeCannotClaimOfficialScore ? "no" : "yes"} | ` +
      `${boundary.recommendedProxyRoute ? `\`${boundary.recommendedProxyRoute}\`` : "none"} |`,
    );
  }

  lines.push("", "## Harness File Hashes", "");
  for (const file of ledger.harnessFiles) {
    lines.push(`- \`${file.path}\`: ${file.exists ? file.sha256 : "missing"}`);
  }

  lines.push("", "## Recommendations", "");
  for (const recommendation of ledger.recommendations) lines.push(`- ${recommendation}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function chooseProxyJudgeCandidates(models: OpenRouterEconomicsModel[]): ProxyJudgeCandidate[] {
  return models
    .filter((model) => model.supportsTools && model.supportsToolChoice && model.supportsStructuredOutputs)
    .map((model) => {
      const reasons: string[] = ["tools", "tool_choice", "structured_outputs"];
      if (model.contextLength >= 1_000_000) reasons.push("1M context");
      else if (model.contextLength >= 128_000) reasons.push("large context");
      if (/deepseek|qwen|glm|nemotron|kimi|minimax|step/i.test(model.id)) reasons.push("finance/proxy-judge candidate family");
      const price = model.inputPerMillionUsd + model.outputPerMillionUsd;
      const contextScore = Math.min(model.contextLength / 100_000, 12);
      const priceScore = Math.max(0, 8 - price);
      const freshnessScore = model.createdAt ? 2 : 0;
      return {
        ...model,
        proxyJudgeScore: contextScore + priceScore + freshnessScore + (model.supportsParallelToolCalls ? 1 : 0),
        reasons,
      };
    })
    .sort((a, b) => b.proxyJudgeScore - a.proxyJudgeScore || byPriceThenName(a, b))
    .slice(0, 8);
}

function buildRecommendations(models: OpenRouterEconomicsModel[], proxyCandidates: ProxyJudgeCandidate[]): string[] {
  const recs = [
    "Run proxy judge comparisons as Proof Loop product gates before spending on official scorer reruns.",
    "Keep official score receipts separate: proxy routes can triage and improve outputs, but cannot replace official scorer imports for leaderboard claims.",
    "Do not block product iteration on Azure/OpenAI judge credentials; block only official-score promotion when no accepted scorer receipt exists.",
  ];
  const deepseek = models.find((model) => model.id === "deepseek/deepseek-v4-pro");
  if (deepseek) {
    recs.push(
      `Add deepseek/deepseek-v4-pro to the proxy judge matrix: current snapshot shows ${deepseek.contextLength} context and $${deepseek.inputPerMillionUsd}/M input, $${deepseek.outputPerMillionUsd}/M output.`,
    );
  }
  const best = proxyCandidates[0];
  if (best) {
    recs.push(`Use ${best.id} as the first cheap structured proxy judge candidate, then require task-level Proof Loop pass before promotion.`);
  }
  return recs;
}

function hashFile(root: string, path: string): HarnessVersionFile {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return { path, exists: false };
  const hash = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  return { path, exists: true, sha256: hash };
}

function gitState(root: string): { commit: string; dirty: boolean } {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim() || "unknown";
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();
  return { commit, dirty: status.length > 0 };
}

function byPriceThenName(a: OpenRouterEconomicsModel, b: OpenRouterEconomicsModel): number {
  return (a.inputPerMillionUsd + a.outputPerMillionUsd) - (b.inputPerMillionUsd + b.outputPerMillionUsd) ||
    b.contextLength - a.contextLength ||
    a.id.localeCompare(b.id);
}

function byCreatedThenPrice(a: OpenRouterEconomicsModel, b: OpenRouterEconomicsModel): number {
  const aTime = Date.parse(a.createdAt ?? "");
  const bTime = Date.parse(b.createdAt ?? "");
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0) || byPriceThenName(a, b);
}

function readJson<T>(root: string, relativePath: string): T | undefined {
  const path = join(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
