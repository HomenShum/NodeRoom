import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildProofloopHarnessEconomicsLedger,
  type HarnessEconomicsLedger,
} from "./proofloopHarnessEconomics";

export const OFFICIAL_SCORE_PREFLIGHT_JSON = "docs/eval/proofloop-official-score-preflight.json";
export const OFFICIAL_SCORE_PREFLIGHT_MARKDOWN = "docs/eval/PROOFLOOP_OFFICIAL_SCORE_PREFLIGHT.md";
export const OFFICIAL_SCORE_PREFLIGHT_COMMAND = "npm run benchmark:proofloop:official-preflight -- --strict";
export const OFFICIAL_SCORE_PREFLIGHT_REFRESH_COMMAND = [
  "npm run openrouter:free -- --limit=8 --json-out docs/eval/openrouter-free-model-discovery.json",
  "npm run benchmark:proofloop:free-model-gauge -- --skip-live --strict",
  "npm run benchmark:proofloop:harness-economics -- --strict",
  OFFICIAL_SCORE_PREFLIGHT_COMMAND,
].join(" && ");

const FREE_DISCOVERY_PATH = "docs/eval/openrouter-free-model-discovery.json";
const FREE_GAUGE_PATH = "docs/eval/proofloop-free-openrouter-nodeagent-gauge.json";
const HARNESS_ECONOMICS_PATH = "docs/eval/proofloop-harness-economics.json";
const OFFICIAL_SCORE_RECEIPTS_DIR = "docs/eval/proofloop-official-scores";

export type OfficialScorePreflightStatus = "pass" | "fail";

export type OfficialScorePreflightCheck = {
  id: string;
  status: OfficialScorePreflightStatus;
  detail: string;
  evidence: string[];
};

export type OfficialScorePreflightLane = {
  lane: string;
  blockedWhen: string;
  safeNextCommand: string;
  checklist: string[];
};

export type OfficialScorePreflightReceipt = {
  schema: "proofloop-official-score-preflight-v1";
  generatedAt: string;
  status: OfficialScorePreflightStatus;
  officialBenchmarkScoreClaim: false;
  /** Backward-compatible alias for preflightExecution.paidProviderCalls. */
  paidProviderCalls: false;
  preflightExecution: {
    providerCallsAttempted: false;
    paidProviderCalls: false;
    providerSpendUsd: 0;
  };
  acceptedOfficialScoreReceipts: {
    count: number;
    paidProviderCalls: boolean;
    providerSpendUsd: number;
    receipts: AcceptedOfficialScoreReceiptSummary[];
  };
  requiredBeforeExpensiveLaneRuns: true;
  command: string;
  refreshCommand: string;
  evidence: string[];
  summary: {
    checksPassed: number;
    checksFailed: number;
    lanesGuarded: number;
    freeRoutesDiscovered: number;
    freeGaugeEstimatedCostUsd: number | null;
    proxyJudgeCandidates: number;
  };
  checks: OfficialScorePreflightCheck[];
  lanes: OfficialScorePreflightLane[];
  policy: string[];
};

export type AcceptedOfficialScoreReceiptSummary = {
  adapterId: string;
  provider: string;
  judgeModel: string;
  providerSpendUsd: number;
  evidence: string;
};

type FreeGaugeReceipt = {
  officialBenchmarkScoreClaim?: boolean;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    estimatedCostUsd?: number;
  };
  rows?: Array<{ modelId?: string; status?: string; estimatedCostUsd?: number }>;
};

type FreeDiscoveryReceipt = {
  modelCount?: number;
  models?: Array<{
    id?: string;
    supportsTools?: boolean;
    supportsToolChoice?: boolean;
    supportsStructuredOutputs?: boolean;
  }>;
};

type OfficialScoreReceipt = {
  adapterId?: string;
  status?: string;
  scoreClaim?: boolean;
  acceptedExternalScorerReceipt?: {
    accepted?: boolean;
    provider?: string;
    judgeModel?: string;
  };
  scores?: {
    providerCostUsd?: number;
    usage?: { estimatedProviderCostUsd?: number };
    FinMR?: { usage?: { estimatedProviderCostUsd?: number } };
  };
  claimGate?: {
    officialScoreClaimable?: boolean;
    providerSpendUsd?: number;
  };
  officialMetrics?: { providerCostUsd?: number };
};

export function buildOfficialScorePreflightReceipt(args: {
  root?: string;
  generatedAt?: string;
  economics?: HarnessEconomicsLedger;
} = {}): OfficialScorePreflightReceipt {
  const root = args.root ?? process.cwd();
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const economics = args.economics ?? buildProofloopHarnessEconomicsLedger({ root, generatedAt });
  const discovery = readJson<FreeDiscoveryReceipt>(root, FREE_DISCOVERY_PATH);
  const gauge = readJson<FreeGaugeReceipt>(root, FREE_GAUGE_PATH);
  const freeRoutes = discovery?.models ?? [];
  const toolFreeRoutes = freeRoutes.filter((model) => model.supportsTools === true);
  const gaugeCost = typeof gauge?.summary?.estimatedCostUsd === "number" ? gauge.summary.estimatedCostUsd : null;
  const gaugeRows = gauge?.rows ?? [];
  const acceptedOfficialScoreReceipts = readAcceptedOfficialScoreReceipts(root);
  const acceptedProviderSpendUsd = roundUsd(
    acceptedOfficialScoreReceipts.reduce((total, receipt) => total + receipt.providerSpendUsd, 0),
  );
  const lanes = officialScorePreflightLanes();
  const checks: OfficialScorePreflightCheck[] = [
    check(
      "free-discovery-receipt-present",
      existsSync(join(root, FREE_DISCOVERY_PATH)) && toolFreeRoutes.length > 0,
      `${toolFreeRoutes.length} tool-capable free route(s) discovered.`,
      [FREE_DISCOVERY_PATH],
    ),
    check(
      "free-gauge-zero-provider-spend",
      existsSync(join(root, FREE_GAUGE_PATH)) &&
        gaugeCost === 0 &&
        gaugeRows.every((row) => (row.estimatedCostUsd ?? 0) === 0),
      `Free gauge estimated cost is ${gaugeCost === null ? "missing" : `$${gaugeCost.toFixed(6)}`}.`,
      [FREE_GAUGE_PATH],
    ),
    check(
      "free-gauge-not-official-score",
      gauge?.officialBenchmarkScoreClaim === false,
      "Free model gauge is labeled as non-official benchmark evidence.",
      [FREE_GAUGE_PATH],
    ),
    check(
      "free-gauge-has-usable-route-or-safe-skip",
      (gauge?.summary?.passed ?? 0) > 0 || ((gauge?.summary?.skipped ?? 0) > 0 && (gauge?.summary?.failed ?? 0) === 0),
      `Gauge passed=${gauge?.summary?.passed ?? 0}, skipped=${gauge?.summary?.skipped ?? 0}, failed=${gauge?.summary?.failed ?? 0}.`,
      [FREE_GAUGE_PATH],
    ),
    check(
      "harness-economics-receipt-present",
      existsSync(join(root, HARNESS_ECONOMICS_PATH)) &&
        economics.summary.missingHarnessFiles === 0 &&
        economics.summary.cheaperProxyRoutesAvailable,
      `Harness economics tracks ${economics.summary.harnessFilesTracked} file(s), missing ${economics.summary.missingHarnessFiles}; proxy candidates ${economics.summary.proxyJudgeCandidates}.`,
      [HARNESS_ECONOMICS_PATH],
    ),
    check(
      "official-claim-boundary-preserved",
      economics.summary.acceptedOfficialScorerStillRequiredForOfficialClaims === true &&
        economics.officialScoreBoundaries.every((boundary) => boundary.proxyJudgeCannotClaimOfficialScore),
      "Every official score lane still requires an accepted scorer or accepted judge contract before a claim.",
      [HARNESS_ECONOMICS_PATH],
    ),
    check(
      "expensive-lanes-have-preflight-next-command",
      lanes.every((lane) => lane.safeNextCommand.startsWith(OFFICIAL_SCORE_PREFLIGHT_COMMAND)),
      `${lanes.length} lane checklist(s) start with the official preflight command.`,
      [OFFICIAL_SCORE_PREFLIGHT_JSON],
    ),
  ];
  const checksFailed = checks.filter((item) => item.status === "fail").length;
  return {
    schema: "proofloop-official-score-preflight-v1",
    generatedAt,
    status: checksFailed === 0 ? "pass" : "fail",
    officialBenchmarkScoreClaim: false,
    paidProviderCalls: false,
    preflightExecution: {
      providerCallsAttempted: false,
      paidProviderCalls: false,
      providerSpendUsd: 0,
    },
    acceptedOfficialScoreReceipts: {
      count: acceptedOfficialScoreReceipts.length,
      paidProviderCalls: acceptedProviderSpendUsd > 0,
      providerSpendUsd: acceptedProviderSpendUsd,
      receipts: acceptedOfficialScoreReceipts,
    },
    requiredBeforeExpensiveLaneRuns: true,
    command: OFFICIAL_SCORE_PREFLIGHT_COMMAND,
    refreshCommand: OFFICIAL_SCORE_PREFLIGHT_REFRESH_COMMAND,
    evidence: [
      FREE_DISCOVERY_PATH,
      FREE_GAUGE_PATH,
      HARNESS_ECONOMICS_PATH,
      ...acceptedOfficialScoreReceipts.map((receipt) => receipt.evidence),
      OFFICIAL_SCORE_PREFLIGHT_JSON,
      OFFICIAL_SCORE_PREFLIGHT_MARKDOWN,
    ],
    summary: {
      checksPassed: checks.length - checksFailed,
      checksFailed,
      lanesGuarded: lanes.length,
      freeRoutesDiscovered: toolFreeRoutes.length,
      freeGaugeEstimatedCostUsd: gaugeCost,
      proxyJudgeCandidates: economics.summary.proxyJudgeCandidates,
    },
    checks,
    lanes,
    policy: [
      "Run this preflight before any official-score lane command that could spend model or judge budget.",
      "The preflight itself does not call paid providers; the free model gauge is invoked with --skip-live by the official-scores goal.",
      "Free/proxy routes can support product iteration and blocker triage, but they cannot become official benchmark score claims without accepted scorer receipts.",
      "Official claims stay gated by benchmark scorer receipts or explicitly accepted judge contracts.",
    ],
  };
}

export function renderOfficialScorePreflightMarkdown(receipt: OfficialScorePreflightReceipt): string {
  const lines = [
    "# ProofLoop Official Score Preflight",
    "",
    `Generated: ${receipt.generatedAt}`,
    `Status: ${receipt.status}`,
    `Preflight paid provider calls: ${receipt.preflightExecution.paidProviderCalls ? "yes" : "no"}`,
    `Preflight provider spend: $${receipt.preflightExecution.providerSpendUsd.toFixed(6)}`,
    `Accepted scorer receipt spend: $${receipt.acceptedOfficialScoreReceipts.providerSpendUsd.toFixed(6)}`,
    `Official benchmark score claim: ${receipt.officialBenchmarkScoreClaim ? "yes" : "no"}`,
    "",
    "This receipt is the cost and claim-boundary guard for the `official-scores` goal. Run it before any lane command that could spend model or judge budget.",
    "",
    "## Commands",
    "",
    `- Strict preflight: \`${receipt.command}\``,
    `- Refresh receipts without paid model calls: \`${receipt.refreshCommand}\``,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail | Evidence |",
    "|---|---:|---|---|",
    ...receipt.checks.map((item) =>
      `| \`${item.id}\` | ${item.status} | ${escapePipes(item.detail)} | ${item.evidence.map((path) => `\`${path}\``).join("<br>")} |`,
    ),
    "",
    "## Accepted Scorer Receipts",
    "",
    "The preflight command itself is read-only and spends $0. The table below accounts for provider spend already recorded by accepted official scorer receipts.",
    "",
    "| Lane | Provider | Judge model | Recorded spend | Evidence |",
    "|---|---|---|---:|---|",
    ...receipt.acceptedOfficialScoreReceipts.receipts.map((item) =>
      `| \`${item.adapterId}\` | \`${item.provider}\` | \`${item.judgeModel}\` | $${item.providerSpendUsd.toFixed(6)} | \`${item.evidence}\` |`,
    ),
    "",
    "## Blocker Checklist",
    "",
    "| Lane | Blocked When | Safe Next Command | Checklist |",
    "|---|---|---|---|",
    ...receipt.lanes.map((lane) =>
      `| \`${lane.lane}\` | ${escapePipes(lane.blockedWhen)} | \`${lane.safeNextCommand}\` | ${lane.checklist.map(escapePipes).join("<br>")} |`,
    ),
    "",
    "## Policy",
    "",
    ...receipt.policy.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

export function officialScoreSafeNextCommand(taskId?: string): string {
  const lane = officialScoreLaneFromTaskId(taskId);
  const verifier = lane ? OFFICIAL_SCORE_LANE_VERIFY_COMMANDS[lane] : undefined;
  return verifier ? `${OFFICIAL_SCORE_PREFLIGHT_COMMAND} && ${verifier}` : OFFICIAL_SCORE_PREFLIGHT_COMMAND;
}

export function officialScorePreflightLanes(): OfficialScorePreflightLane[] {
  return [
    {
      lane: "bankertoolbench",
      blockedWhen: "Full-suite scored receipt or Gandalf/Harbor official execution evidence is missing.",
      safeNextCommand: officialScoreSafeNextCommand("btb-fullsuite-official-score"),
      checklist: [
        "Keep BTB official score claims tied to full-suite gate or accepted Gandalf/Harbor receipts.",
        "Do not use proxy/free model sweeps as leaderboard score evidence.",
      ],
    },
    {
      lane: "spreadsheetbench-v1",
      blockedWhen: "Full 912-task model-run output and SpreadsheetBench scorer receipt are missing.",
      safeNextCommand: officialScoreSafeNextCommand("spreadsheetbench-v1-full-official-score"),
      checklist: [
        "Confirm the 912-task stage and contamination receipts before model spend.",
        "Use free/proxy routes for iteration only; official claim requires SpreadsheetBench scorer output.",
      ],
    },
    {
      lane: "spreadsheetbench-v2",
      blockedWhen: "Full V2 run artifacts, workbook scorer, or chart grader receipt are missing.",
      safeNextCommand: officialScoreSafeNextCommand("spreadsheetbench-v2-full-official-score"),
      checklist: [
        "Confirm the 321-task stage and chart-grader path before model spend.",
        "Keep rendered chart grading separate from proxy judge triage.",
      ],
    },
    {
      lane: "finch",
      blockedWhen: "Upstream Finch content_parts rendering or an accepted canonical GPT-5-mini judge/scorer receipt is missing.",
      safeNextCommand: officialScoreSafeNextCommand("finch-official-score"),
      checklist: [
        "Refresh the typed adapter blocker receipt after importing upstream scorer output.",
        "Do not label OpenRouter proxy judge evidence as Finch official score evidence.",
      ],
    },
    {
      lane: "finauditing",
      blockedWhen: "Accepted FinMR judge path or official scorer import is missing.",
      safeNextCommand: officialScoreSafeNextCommand("finauditing-official-score"),
      checklist: [
        "Refresh the typed adapter blocker receipt after importing accepted scorer output.",
        "OpenAI or other judge credentials block official promotion only, not local output export proof.",
      ],
    },
    {
      lane: "workstreambench",
      blockedWhen: "Upstream official task bundle, rubric, or scorer package is not available.",
      safeNextCommand: officialScoreSafeNextCommand("workstreambench-official-score"),
      checklist: [
        "Keep local proof as proxy-only until upstream bundle/scorer evidence exists.",
        "Refresh the typed adapter blocker receipt after locking any author-provided package.",
      ],
    },
  ];
}

function officialScoreLaneFromTaskId(taskId?: string): string | undefined {
  if (!taskId) return undefined;
  if (taskId.includes("btb") || taskId.includes("bankertoolbench")) return "bankertoolbench";
  if (taskId.includes("spreadsheetbench-v1")) return "spreadsheetbench-v1";
  if (taskId.includes("spreadsheetbench-v2")) return "spreadsheetbench-v2";
  if (taskId.includes("finch")) return "finch";
  if (taskId.includes("finauditing")) return "finauditing";
  if (taskId.includes("workstreambench")) return "workstreambench";
  return undefined;
}

const OFFICIAL_SCORE_LANE_VERIFY_COMMANDS: Record<string, string> = {
  bankertoolbench: "npm run benchmark:bankertoolbench:fullsuite-gate -- --assert",
  "spreadsheetbench-v1": "npm run benchmark:official:task-coverage -- --strict",
  "spreadsheetbench-v2": "npm run benchmark:official:task-coverage -- --strict",
  finch: "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
  finauditing: "npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict",
  workstreambench: "npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict",
};

function check(id: string, passed: boolean, detail: string, evidence: string[]): OfficialScorePreflightCheck {
  return { id, status: passed ? "pass" : "fail", detail, evidence };
}

function readJson<T>(root: string, path: string): T | undefined {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return undefined;
  try {
    return JSON.parse(readFileSync(absolute, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function readAcceptedOfficialScoreReceipts(root: string): AcceptedOfficialScoreReceiptSummary[] {
  const directory = join(root, OFFICIAL_SCORE_RECEIPTS_DIR);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const evidence = `${OFFICIAL_SCORE_RECEIPTS_DIR}/${name}`;
      const receipt = readJson<OfficialScoreReceipt>(root, evidence);
      const accepted = receipt?.acceptedExternalScorerReceipt?.accepted === true;
      const claimable = receipt?.scoreClaim === true || receipt?.claimGate?.officialScoreClaimable === true;
      if (!receipt || receipt.status !== "scored" || !accepted || !claimable) return [];
      const providerSpendUsd = firstFiniteNumber(
        receipt.scores?.providerCostUsd,
        receipt.scores?.usage?.estimatedProviderCostUsd,
        receipt.scores?.FinMR?.usage?.estimatedProviderCostUsd,
        receipt.officialMetrics?.providerCostUsd,
        receipt.claimGate?.providerSpendUsd,
      ) ?? 0;
      return [{
        adapterId: receipt.adapterId ?? name.replace(/\.json$/, ""),
        provider: receipt.acceptedExternalScorerReceipt?.provider ?? "unknown",
        judgeModel: receipt.acceptedExternalScorerReceipt?.judgeModel ?? "unknown",
        providerSpendUsd: roundUsd(providerSpendUsd),
        evidence,
      }];
    });
}

function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
