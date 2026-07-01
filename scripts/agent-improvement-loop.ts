import "./benchmark/loadEnv";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DEFAULT_ARCHITECTURE_BUDGET } from "../src/eval/architectureBudget";
import { ARCHITECTURE_FIT_CHECKS, EVAL_TRUST_LEVELS } from "../src/eval/evalTrustPolicy";
import {
  ROOT_CAUSE_CATEGORIES,
  evaluateEvalCandidateForHandoff,
  type EvalCandidate,
  type HandoffDecision,
} from "../src/eval/improvementArtifacts";
import {
  PROFESSIONAL_FILE_PROFILE_SUMMARY,
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalHarnessRequirement,
} from "../evals/professionalWorkflows";
import { readEvalRuns, runKey, type EvalRunRecord } from "../evals/evalStore";
import {
  type ScaffoldProposal,
  type ScaffoldReviewResult,
  type SelfScaffoldingLoopResult,
  generateScaffoldProposals,
  rejectScaffoldProposal,
  buildSelfScaffoldingReport,
} from "../src/eval/scaffoldProposal";
import { applyAcceptedProposals, type ScaffoldLedger } from "../src/eval/scaffoldApply";

type Lane = "deterministic" | "live" | "ui" | "full-live";
type StepStatus = "pass" | "fail" | "skip" | "blocked";

type StepSpec = {
  id: string;
  label: string;
  lane: Lane;
  command: string;
  args: string[];
  timeoutMs: number;
  requiredEnv?: string[];
  includeWhen?: () => boolean;
  skipReason?: string;
  blockedExitCodes?: number[];
  blockedReason?: string;
};

type StepResult = {
  id: string;
  label: string;
  lane: Lane;
  command: string;
  status: StepStatus;
  ms: number;
  exitCode: number | null;
  reason?: string;
  stdoutTail?: string;
  stderrTail?: string;
};

type LoopRun = {
  schema: 1;
  runId: string;
  generatedAt: string;
  cookbookSource: string;
  mode: {
    live: boolean;
    fullLive: boolean;
    uiMedia?: string;
    strict: boolean;
  };
  targetUsers: string[];
  workflowProfile: typeof PROFESSIONAL_FILE_PROFILE_SUMMARY;
  workflowCoverage: ReturnType<typeof workflowCoverage>;
  architectureReview: ReturnType<typeof buildArchitectureReview>;
  steps: StepResult[];
  handoff: {
    topRecommendations: string[];
    /** P1-4: the failing eval rows from the latest recorded run — checks, failureSummary (with P1-5
     *  trace pointers), traceRef + a static repro command. The packet carries evidence, not
     *  "see captured output". */
    failingEvalEvidence: Array<{
      caseId: string; suite: string; runKey: string; score?: number;
      failingChecks: string[]; failureSummary?: string; traceRef?: string; repro: string;
    }>;
    generatedEvalIdeas: EvalCandidate[];
    implementationHandoffCandidates: HandoffDecision[];
    blockedImplementationHandoffCandidates: HandoffDecision[];
    nextLiveRuns: string[];
    architectureBudget: ReturnType<typeof buildArchitectureBudget>;
    /** Self-scaffolding proof-looping: scaffold proposals generated from failing steps. */
    scaffoldProposals: SelfScaffoldingLoopResult;
  };
};

const outDir = join(process.cwd(), "docs", "eval", "agent-improvement-loop");
const latestJson = join(outDir, "latest.json");
const summaryMd = join(process.cwd(), "docs", "eval", "agent-improvement-loop.md");
const summarySvg = join(process.cwd(), "docs", "eval", "agent-improvement-loop.svg");
const cookbookUrl = "https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop";

const args = process.argv.slice(2);
const live = args.includes("--live") || args.includes("--full-live");
const fullLive = args.includes("--full-live");
const strict = args.includes("--strict");
const humanApproved = args.includes("--human-approved");
const uiMedia = optionValue("--ui-media");

const steps: StepSpec[] = [
  {
    id: "professional-catalog",
    label: "Professional workflow catalog shape",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:professional"],
    timeoutMs: 120_000,
  },
  {
    id: "professional-catalog-proofs",
    label: "Professional catalog proof gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:professional:catalog-proofs"],
    timeoutMs: 120_000,
  },
  {
    id: "professional-proof-ledger",
    label: "Professional proof ledger",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:professional:proofs"],
    timeoutMs: 120_000,
  },
  {
    id: "workflow-evals",
    label: "GTM/finance workflow evals",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/workflowEvals.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "algorithm-artifact-smoke",
    label: "Algorithm artifact runner smoke",
    lane: "deterministic",
    command: "npm",
    args: ["run", "algorithm-artifact:smoke"],
    timeoutMs: 120_000,
  },
  {
    id: "halo-self-improvement-smoke",
    label: "HALO context/path self-improvement smoke",
    lane: "deterministic",
    command: "npm",
    args: ["run", "halo:self-improve:smoke"],
    timeoutMs: 120_000,
  },
  {
    id: "halo-variant-selection",
    label: "HALO harness variant selection",
    lane: "deterministic",
    command: "npm",
    args: ["run", "halo:variant:select"],
    timeoutMs: 120_000,
  },
  {
    id: "halo-convex-context-telemetry",
    label: "HALO Convex job-context telemetry",
    lane: "deterministic",
    command: "npm",
    args: ["run", "halo:convex-context:smoke"],
    timeoutMs: 120_000,
  },
  {
    id: "collaboration-ladder",
    label: "Collaboration ladder L1-L6",
    lane: "deterministic",
    command: "npm",
    args: ["run", "ladder", "--", "--record"],
    timeoutMs: 120_000,
  },
  {
    id: "credit-evals",
    label: "MM-banking credit decision evals",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:credit", "--", "--record"],
    timeoutMs: 120_000,
  },
  {
    id: "official-benchmark-readiness",
    label: "Official benchmark readiness report",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:official:readiness"],
    timeoutMs: 120_000,
  },
  {
    id: "official-benchmark-task-coverage",
    label: "Official benchmark task coverage ledger",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:official:task-coverage"],
    timeoutMs: 120_000,
  },
  {
    id: "openrouter-convex-benchmark",
    label: "OpenRouter-on-Convex benchmark contract",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:openrouter-convex", "--", "--strict"],
    timeoutMs: 120_000,
  },
  {
    id: "official-benchmark-promotion-gate",
    label: "Official benchmark promotion gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:official:readiness", "--", "--strict"],
    timeoutMs: 120_000,
    blockedExitCodes: [1],
    blockedReason: "official BankerToolBench/SpreadsheetBench readiness remains blocked by external benchmark prerequisites",
  },
  {
    id: "official-benchmark-task-coverage-gate",
    label: "Official benchmark full-task coverage gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:official:task-coverage", "--", "--strict"],
    timeoutMs: 120_000,
    blockedExitCodes: [1],
    blockedReason: "full official task coverage remains blocked until every published task is staged and model-run under the benchmark policy",
  },
  {
    id: "benchmark-contamination-fixture",
    label: "Official benchmark contamination fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/benchmarkContamination.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "bankertoolbench-ingest-fixture",
    label: "BankerToolBench official ingest fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/bankerToolBenchAdapter.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "bankertoolbench-stage-fixture",
    label: "BankerToolBench sandbox stage fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/bankerToolBenchStage.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "bankertoolbench-manifest-lock-fixture",
    label: "BankerToolBench manifest lock fixture",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:bankertoolbench:manifest-lock", "--", "--root", ".tmp/official-benchmarks/btb-fixture", "--json-out", "docs/eval/bankertoolbench-manifest-lock-smoke.json"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "btb-fixture")),
    skipReason: "local BankerToolBench fixture root is not present",
  },
  {
    id: "bankertoolbench-runner-fixture",
    label: "BankerToolBench staged runner fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/bankerToolBenchRunner.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "bankertoolbench-proof",
    label: "BankerToolBench local harness proof gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:bankertoolbench:proof"],
    timeoutMs: 120_000,
  },
  {
    id: "bankertoolbench-official-contract",
    label: "BankerToolBench official execution contract",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:bankertoolbench:official-contract", "--", "--strict"],
    timeoutMs: 120_000,
    blockedExitCodes: [1],
    blockedReason: "BTB official contract is missing external Docker/MCP/Gandalf/provenance evidence",
  },
  {
    id: "spreadsheetbench-ingest-fixture",
    label: "SpreadsheetBench official ingest fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/spreadsheetBenchAdapter.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "spreadsheetbench-stage-fixture",
    label: "SpreadsheetBench sandbox stage fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/spreadsheetBenchStage.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "spreadsheetbench-v1-full-stage-proof",
    label: "SpreadsheetBench V1 full-stage isolation proof",
    lane: "deterministic",
    command: "npm",
    args: [
      "run",
      "benchmark:spreadsheetbench:stage-proof",
      "--",
      "--report",
      "docs/eval/spreadsheetbench-v1-full-stage-smoke.json",
      "--stage-root",
      ".tmp/official-benchmarks/staged-v1-full",
      "--track",
      "spreadsheetbench-v1",
      "--min-tasks",
      "400",
    ],
    timeoutMs: 120_000,
    includeWhen: () =>
      existsSync(join(process.cwd(), "docs", "eval", "spreadsheetbench-v1-full-stage-smoke.json")) &&
      existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v1-full")),
    skipReason: "local SpreadsheetBench V1 full-stage proof artifact is not present",
  },
  {
    id: "spreadsheetbench-v2-stage-proof",
    label: "SpreadsheetBench V2 public-example stage proof",
    lane: "deterministic",
    command: "npm",
    args: [
      "run",
      "benchmark:spreadsheetbench:stage-proof",
      "--",
      "--report",
      "docs/eval/spreadsheetbench-v2-stage-smoke.json",
      "--stage-root",
      ".tmp/official-benchmarks/staged-v2",
      "--track",
      "spreadsheetbench-v2",
      "--min-tasks",
      "3",
    ],
    timeoutMs: 120_000,
    includeWhen: () =>
      existsSync(join(process.cwd(), "docs", "eval", "spreadsheetbench-v2-stage-smoke.json")) &&
      existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v2")),
    skipReason: "local SpreadsheetBench V2 public-example stage proof artifact is not present",
  },
  {
    id: "spreadsheetbench-v1-route-selection",
    label: "SpreadsheetBench V1 route selection report",
    lane: "deterministic",
    command: "npm",
    args: [
      "run",
      "benchmark:spreadsheetbench:routes",
      "--",
      "--stage-root",
      ".tmp/official-benchmarks/staged-v1-full",
      "--json-out",
      "docs/eval/spreadsheetbench-v1-route-selection.json",
    ],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v1-full")),
    skipReason: "local SpreadsheetBench V1 full-stage root is not present",
  },
  {
    id: "spreadsheetbench-v2-route-selection",
    label: "SpreadsheetBench V2 route selection report",
    lane: "deterministic",
    command: "npm",
    args: [
      "run",
      "benchmark:spreadsheetbench:routes",
      "--",
      "--stage-root",
      ".tmp/official-benchmarks/staged-v2",
      "--json-out",
      "docs/eval/spreadsheetbench-v2-route-selection.json",
    ],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v2")),
    skipReason: "local SpreadsheetBench V2 staged root is not present",
  },
  {
    id: "spreadsheetbench-v1-copy-full-baseline",
    label: "SpreadsheetBench V1 full-bundle copy-input baseline",
    lane: "deterministic",
    command: "npm",
    args: [
      "run",
      "benchmark:spreadsheetbench:run-chunked",
      "--",
      "--stage-root",
      ".tmp/official-benchmarks/staged-v1-full",
      "--output-root",
      ".tmp/official-benchmarks/run-v1-copy-full",
      "--mode",
      "copy-input-baseline",
      "--chunk-size",
      "25",
      "--json-out",
      "docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json",
      "--max-mismatches",
      "5",
    ],
    timeoutMs: 600_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v1-full")),
    skipReason: "local SpreadsheetBench V1 full-stage root is not present",
  },
  {
    id: "spreadsheetbench-score-fixture",
    label: "SpreadsheetBench workbook score fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/spreadsheetBenchScorer.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "spreadsheetbench-chart-score-fixture",
    label: "SpreadsheetBench chart package score fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/spreadsheetBenchChartScorer.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "spreadsheetbench-chart-visual-probe",
    label: "SpreadsheetBench rendered/VLM chart visual probe",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:spreadsheetbench:chart-visual:probe", "--", "--strict"],
    timeoutMs: 120_000,
    blockedExitCodes: [1],
    blockedReason: "SpreadsheetBench V2 rendered/VLM chart grading probe did not pass",
  },
  {
    id: "spreadsheetbench-runner-fixture",
    label: "SpreadsheetBench staged runner fixture",
    lane: "deterministic",
    command: "npx",
    args: ["vitest", "run", "tests/spreadsheetBenchRunner.test.ts"],
    timeoutMs: 120_000,
  },
  {
    id: "agent-workspace-process-sandbox",
    label: "Agent workspace process sandbox",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:agent-sandbox", "--", "--json-out", "docs/eval/agent-workspace-sandbox-smoke.json"],
    timeoutMs: 120_000,
  },
  {
    id: "docker-sandbox-probe",
    label: "Docker/Harbor availability probe",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:docker-sandbox:probe", "--", "--require-pass"],
    timeoutMs: 120_000,
    blockedExitCodes: [1],
    blockedReason: "Docker/Harbor process isolation is not proven in this environment",
  },
  {
    id: "spreadsheetbench-stage-contamination",
    label: "SpreadsheetBench staged artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/staged-v1", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v1")),
    skipReason: "local staged SpreadsheetBench V1 root is not present",
  },
  {
    id: "spreadsheetbench-v1-full-stage-contamination",
    label: "SpreadsheetBench V1 full-stage contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/staged-v1-full", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v1-full")),
    skipReason: "local SpreadsheetBench V1 full-stage root is not present",
  },
  {
    id: "spreadsheetbench-run-contamination",
    label: "SpreadsheetBench N5 run artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/run-v1-model-edit-n5", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-v1-model-edit-n5")),
    skipReason: "local SpreadsheetBench N5 run root is not present",
  },
  {
    id: "spreadsheetbench-3task-n5-run-contamination",
    label: "SpreadsheetBench 3-task N5 run artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/run-v1-model-edit-3task-n5", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-v1-model-edit-3task-n5")),
    skipReason: "local SpreadsheetBench 3-task N5 run root is not present",
  },
  {
    id: "spreadsheetbench-3task-n5-proof",
    label: "SpreadsheetBench 3-task N5 proof gate",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:spreadsheetbench:proof", "--", "--require-sidecar-files"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-v1-model-edit-3task-n5")),
    skipReason: "local SpreadsheetBench 3-task N5 run root is not present",
  },
  {
    id: "spreadsheetbench-retry-run-contamination",
    label: "SpreadsheetBench retry run artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/run-v1-model-edit-retry", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-v1-model-edit-retry")),
    skipReason: "local SpreadsheetBench retry run root is not present",
  },
  {
    id: "spreadsheetbench-v2-stage-contamination",
    label: "SpreadsheetBench V2 staged artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/staged-v2", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-v2")),
    skipReason: "local SpreadsheetBench V2 staged root is not present",
  },
  {
    id: "spreadsheetbench-v2-run-contamination",
    label: "SpreadsheetBench V2 run artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/run-v2", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-v2")),
    skipReason: "local SpreadsheetBench V2 run root is not present",
  },
  {
    id: "bankertoolbench-stage-contamination",
    label: "BankerToolBench staged artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/staged-btb", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "staged-btb")),
    skipReason: "local staged BankerToolBench root is not present",
  },
  {
    id: "bankertoolbench-run-contamination",
    label: "BankerToolBench run artifact contamination",
    lane: "deterministic",
    command: "npm",
    args: ["run", "benchmark:contamination", "--", "--root", ".tmp/official-benchmarks/run-btb", "--strict"],
    timeoutMs: 120_000,
    includeWhen: () => existsSync(join(process.cwd(), ".tmp", "official-benchmarks", "run-btb")),
    skipReason: "local BankerToolBench run root is not present",
  },
  {
    id: "eval-diff",
    label: "Eval regression diff",
    lane: "deterministic",
    command: "npm",
    args: ["run", "eval:diff"],
    timeoutMs: 120_000,
  },
  {
    id: "convex-boundaries",
    label: "Convex query/action/mutation boundaries",
    lane: "deterministic",
    command: "npm",
    args: ["run", "convex:boundaries"],
    timeoutMs: 120_000,
  },
  {
    id: "architecture-budget",
    label: "Architecture budget review",
    lane: "deterministic",
    command: "npm",
    // P0-3: the loop's own --strict arms the budget gate (exit 1 on forbidden-surface dirt).
    // Unarmed runs still REPORT; the zero-false-positive enforcement below is the handoff demotion.
    args: [
      "run",
      "architecture:budget",
      ...((strict || humanApproved) ? ["--"] : []),
      ...(strict ? ["--strict"] : []),
      ...(humanApproved ? ["--human-approved"] : []),
    ],
    timeoutMs: 120_000,
  },
  {
    id: "free-route-discovery",
    label: "OpenRouter free-auto discovery",
    lane: "live",
    command: "npm",
    args: ["run", "openrouter:free", "--", "--limit=5"],
    timeoutMs: 120_000,
    includeWhen: () => live,
    requiredEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --live and set OPENROUTER_API_KEY to discover current free-auto candidates",
  },
  {
    id: "halo-live-path-calibration",
    label: "HALO live provider path calibration",
    lane: "live",
    command: "npm",
    args: ["run", "halo:live-path:calibrate", "--", "--real", "deepseek/deepseek-v4-flash", "--repeats", "5"],
    timeoutMs: 15 * 60_000,
    includeWhen: () => live,
    requiredEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --live and set OPENROUTER_API_KEY to calibrate N=5 live path fingerprints",
  },
  {
    id: "professional-live-catalog",
    label: "Professional live-provider catalog champion",
    lane: "live",
    command: "npm",
    args: ["run", "eval:professional:live-catalog", "--", "--real", "deepseek/deepseek-v4-flash", "--require-full", "--retry-failed", "2", "--json-out", "docs/eval/professional-live-catalog.json"],
    timeoutMs: 20 * 60_000,
    includeWhen: () => live,
    requiredEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --live and set OPENROUTER_API_KEY to prove the professional catalog with the cheap champion route",
  },
  {
    id: "chat-intake-live-runtime",
    label: "Chat-first GTM live runtime",
    lane: "live",
    command: "npm",
    args: ["run", "eval:chat-intake:live", "--", "--json-out", "docs/eval/chat-intake-live.json", "--timeout-ms", "240000"],
    timeoutMs: 5 * 60_000,
    includeWhen: () => live,
    requiredEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --live and set OPENROUTER_API_KEY to run the chat-intake room runtime against a real route",
  },
  {
    id: "provider-parser-smoke",
    label: "Provider parser live smoke",
    lane: "live",
    command: "npm",
    args: ["run", "provider-parser:smoke"],
    timeoutMs: 300_000,
    includeWhen: () => live,
    skipReason: "pass --live; script will skip providers without keys",
  },
  {
    id: "free-job-smoke",
    label: "Convex /free job smoke",
    lane: "full-live",
    command: "npm",
    args: ["run", "free-job:smoke"],
    timeoutMs: 20 * 60_000,
    includeWhen: () => fullLive || process.env.FREE_JOB_SMOKE === "1",
    requiredEnv: ["CONVEX_URL"],
    skipReason: "pass --full-live or set FREE_JOB_SMOKE=1 with CONVEX_URL/VITE_CONVEX_URL for deployment /free smoke",
  },
  {
    id: "benchmark-v2",
    label: "V2 multi-model benchmark",
    lane: "full-live",
    command: "npm",
    args: ["run", "benchmark", "--", "--model-timeout-ms=180000", "--model-reserve-ms=15000", "--row-hard-timeout-ms=210000"],
    timeoutMs: 45 * 60_000,
    includeWhen: () => fullLive,
    skipReason: "pass --full-live to spend live provider calls on the full benchmark",
  },
  {
    id: "free-auto-ladder",
    label: "Free-auto router ladder",
    lane: "full-live",
    command: "npm",
    args: ["run", "ladder:free"],
    timeoutMs: 3 * 60 * 60_000,
    includeWhen: () => fullLive,
    requiredEnv: ["OPENROUTER_API_KEY"],
    skipReason: "pass --full-live and set OPENROUTER_API_KEY; this can take hours",
  },
  {
    id: "gemini-ui-review",
    label: "Gemini UI media review",
    lane: "ui",
    command: "npx",
    args: ["tsx", "scripts/gemini-ui-review.ts", ...(uiMedia ? [`--media=${uiMedia}`] : [])],
    timeoutMs: 300_000,
    includeWhen: () => !!uiMedia,
    requiredEnv: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    skipReason: "pass --ui-media=<screenshot-or-video> and set GOOGLE_GENERATIVE_AI_API_KEY",
  },
];

const runId = compactDate(new Date());
mkdirSync(outDir, { recursive: true });

const results = steps.map(runStep);
const loopRun: LoopRun = {
  schema: 1,
  runId,
  generatedAt: new Date().toISOString(),
  cookbookSource: cookbookUrl,
  mode: { live, fullLive, uiMedia, strict },
  targetUsers: [
    "GTM sales operators managing account lists, enrichment, and PitchBook-style matching",
    "Finance and banking analysts reconciling workbooks, exports, timecards, and variance evidence",
    "Harness engineers converting messy workflow evidence into repeatable eval gates",
  ],
  workflowProfile: PROFESSIONAL_FILE_PROFILE_SUMMARY,
  workflowCoverage: workflowCoverage(),
  architectureReview: buildArchitectureReview(),
  steps: results,
  handoff: buildHandoff(results),
};

const timestampedJson = join(outDir, `${runId}.json`);
writeFileSync(timestampedJson, JSON.stringify(loopRun, null, 2));
writeFileSync(latestJson, JSON.stringify(loopRun, null, 2));
writeFileSync(summaryMd, renderMarkdown(loopRun, timestampedJson));
writeFileSync(summarySvg, renderSvg(loopRun));

console.log(`wrote ${rel(timestampedJson)}`);
console.log(`wrote ${rel(summaryMd)}`);
console.log(`wrote ${rel(summarySvg)}`);

if (strict && results.some((result) => result.status === "fail" || result.status === "blocked")) process.exitCode = 1;

function runStep(step: StepSpec): StepResult {
  const commandText = [step.command, ...step.args].join(" ");
  const shouldRun = step.includeWhen ? step.includeWhen() : true;
  const missing = (step.requiredEnv ?? []).filter((name) => !hasEnv(name));
  if (!shouldRun || missing.length > 0) {
    return {
      id: step.id,
      label: step.label,
      lane: step.lane,
      command: commandText,
      status: "skip",
      ms: 0,
      exitCode: null,
      reason: missing.length > 0 ? `missing env: ${missing.join(", ")}` : step.skipReason ?? `lane ${step.lane} not selected`,
    };
  }

  const started = Date.now();
  console.log(`RUN  ${step.id} :: ${commandText}`);
  const child = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: true,
    timeout: step.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const timedOut = child.error?.message?.toLowerCase().includes("timed out");
  const blocked =
    !timedOut &&
    typeof child.status === "number" &&
    child.status !== 0 &&
    (step.blockedExitCodes ?? []).includes(child.status);
  const status: StepStatus = child.status === 0 && !timedOut ? "pass" : blocked ? "blocked" : "fail";
  console.log(`${status.toUpperCase()} ${step.id} ${(ms / 1000).toFixed(1)}s`);
  return {
    id: step.id,
    label: step.label,
    lane: step.lane,
    command: commandText,
    status,
    ms,
    exitCode: child.status,
    reason: blocked ? step.blockedReason : child.error?.message,
    stdoutTail: tail(stripAnsi(child.stdout ?? ""), 5000),
    stderrTail: tail(stripAnsi(child.stderr ?? ""), 5000),
  };
}

function workflowCoverage() {
  const byCategory: Record<string, number> = {};
  const byRequirement: Record<ProfessionalHarnessRequirement, number> = {} as Record<ProfessionalHarnessRequirement, number>;
  for (const item of PROFESSIONAL_WORKFLOW_CASES) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    for (const req of item.requiredHarness) byRequirement[req] = (byRequirement[req] ?? 0) + 1;
  }
  const topCases = [...PROFESSIONAL_WORKFLOW_CASES]
    .sort((a, b) => b.requiredHarness.length - a.requiredHarness.length)
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      category: item.category,
      persona: item.persona,
      requiredHarness: item.requiredHarness,
    }));
  return {
    totalCases: PROFESSIONAL_WORKFLOW_CASES.length,
    byCategory,
    byRequirement,
    topCases,
  };
}

function buildHandoff(results: StepResult[]): LoopRun["handoff"] {
  const failed = results.filter((step) => step.status === "fail");
  const blocked = results.filter((step) => step.status === "blocked");
  const skipped = results.filter((step) => step.status === "skip");
  const architectureBudgetStep = results.find((step) => step.id === "architecture-budget");
  const generatedEvalIdeas = buildGeneratedEvalIdeas();
  const handoffDecisions = generatedEvalIdeas.map(evaluateEvalCandidateForHandoff);
  // P0-3: when the architecture-budget gate is red (step failed, or the report says review-required),
  // NO implementation handoff may ship — a coding agent must not receive scoped impl work while
  // forbidden surfaces are dirty. Demote every implementation decision to the blocked list with the
  // reason attached. Zero false positives: a red budget is exactly the condition the gate names.
  const budgetRed =
    architectureBudgetStep?.status === "fail" ||
    !!architectureBudgetStep?.stdoutTail?.includes("architecture budget: review required");
  const rawImplementation = handoffDecisions.filter((decision) => decision.kind === "implementation");
  const implementationHandoffCandidates = budgetRed ? [] : rawImplementation;
  const blockedImplementationHandoffCandidates = [
    ...handoffDecisions.filter((decision) => decision.kind !== "implementation"),
    ...(budgetRed
      ? rawImplementation.map((decision) => ({
          ...decision,
          reasons: [...decision.reasons, "demoted: architecture budget is red (forbidden surfaces dirty / review required) — human approval before any implementation handoff"],
        }))
      : []),
  ];
  const topRecommendations = [
    ...failed.map((step) => `Fix failing loop step ${step.id}: ${step.reason ?? "see captured output"}.`),
    ...blocked.map((step) => `Unblock benchmark promotion step ${step.id}: ${step.reason ?? "external evidence missing"}.`),
    ...(architectureBudgetStep?.stdoutTail?.includes("architecture budget: review required")
      ? ["Resolve architecture budget review items or rerun with explicit handoff evidence before implementation."]
      : []),
    ...implementationHandoffCandidates.map((decision) => `Implement scoped handoff for eval candidate ${decision.evalCandidateId}.`),
    ...skipped
      .filter((step) => step.lane === "live" || step.lane === "ui")
      .slice(0, 4)
      .map((step) => `Run skipped ${step.id} once prerequisites are present: ${step.reason ?? step.command}.`),
    "Persist each new live trace into a durable eval fixture before promoting README charts.",
    "Keep provider benchmarks behind row-level hard timeouts so one stuck free model cannot block the loop.",
    "Add browser-visible multi-user checks for public/private chat, artifact references, proposals, and trace accept-all.",
  ].slice(0, 8);

  // P1-4: pull the latest recorded run's FAILING rows out of the eval store — the evidence already
  // exists one import away; the packet must carry it instead of "see captured output".
  let failingEvalEvidence: LoopRun["handoff"]["failingEvalEvidence"] = [];
  try {
    const records = readEvalRuns();
    if (records.length) {
      const newestKey = runKey([...records].sort((a, b) => b.ts - a.ts)[0]);
      const latestByCase = new Map<string, EvalRunRecord>();
      for (const r of records.filter((x) => runKey(x) === newestKey).sort((a, b) => a.ts - b.ts)) latestByCase.set(r.caseId, r);
      failingEvalEvidence = [...latestByCase.values()].filter((r) => r.status === "fail").map((r) => ({
        caseId: r.caseId,
        suite: r.suite,
        runKey: newestKey,
        score: r.score,
        failingChecks: Object.entries(r.checks ?? {}).filter(([, ok]) => !ok).map(([k]) => k),
        failureSummary: r.failureSummary,
        traceRef: r.traceRef,
        repro: reproForEvalRecord(r),
      }));
    }
  } catch { /* store unreadable — packet ships without evidence rather than failing the loop */ }

  const nextLiveRuns = [
    "npm run agent:improve -- --live",
    "npm run agent:improve -- --full-live",
    "npm run agent:improve -- --ui-media=docs/eval/ui-recordings/<recording-or-screenshot>",
    "npm run benchmark:charts",
  ];
  // Self-scaffolding proof-looping: generate scaffold proposals from failing steps.
  // The agent may improve the scaffold (playbook, rubrics, subagent roles, repair strategies).
  // The agent may NOT weaken the proof gate (verifier, CI gate, score calculation, hidden tests).
  const scaffoldSeeds = failed.map((step) => ({
    failingStepId: step.id,
    failureSummary: step.reason ?? "see captured output",
    rootCauseCategory: "bad_prompt_or_context" as const,
    currentScaffoldGaps: [`Step ${step.id} failed — scaffold may need explicit instruction or evidence assertion.`],
  }));
  const scaffoldProposalList = generateScaffoldProposals(scaffoldSeeds);
  const scaffoldReviews = scaffoldProposalList.map((p) => rejectScaffoldProposal(p, [p.target]));
  const scaffoldReport = buildSelfScaffoldingReport({
    proposals: scaffoldProposalList,
    reviews: scaffoldReviews,
  });

  const scaffoldRecommendations = scaffoldReport.accepted.length > 0
    ? [`Apply ${scaffoldReport.accepted.length} accepted scaffold proposal(s): ${scaffoldReport.accepted.map((p) => p.proposalId).join(", ")}.`]
    : scaffoldReport.needsAdversarialReview.length > 0
      ? [`Review ${scaffoldReport.needsAdversarialReview.length} scaffold proposal(s) needing adversarial review: ${scaffoldReport.needsAdversarialReview.map((p) => p.proposalId).join(", ")}.`]
      : [];

  return {
    topRecommendations: [...topRecommendations, ...scaffoldRecommendations].slice(0, 8),
    failingEvalEvidence,
    generatedEvalIdeas,
    implementationHandoffCandidates,
    blockedImplementationHandoffCandidates,
    nextLiveRuns,
    architectureBudget: buildArchitectureBudget(),
    scaffoldProposals: scaffoldReport,
  };
}

function reproForEvalRecord(record: Pick<EvalRunRecord, "suite" | "caseId">): string {
  if (record.suite === "credit") return "npm run eval:credit";
  if (record.suite === "professional") return "npm run eval:professional";
  if (record.suite === "workflow") return "npx vitest run tests/workflowEvals.test.ts";
  if (record.suite === "ladder") {
    const rung = record.caseId.split(":").slice(1).join(":");
    return rung ? `npm run ladder -- --rungs=${rung}` : "npm run ladder";
  }
  return "npm run agent:improve -- --record";
}

function buildArchitectureBudget() {
  return DEFAULT_ARCHITECTURE_BUDGET;
}

function buildArchitectureReview() {
  return {
    rule:
      "Research must describe the workflow, architecture gap, and existing capability fit before it proposes evals or code.",
    evalTrustLevels: EVAL_TRUST_LEVELS,
    gateModes: ["none", "advisory", "blocking"] as const,
    architectureFitChecks: ARCHITECTURE_FIT_CHECKS,
    rootCauseCategories: ROOT_CAUSE_CATEGORIES,
  };
}

function buildGeneratedEvalIdeas(): EvalCandidate[] {
  const caseById = new Map(PROFESSIONAL_WORKFLOW_CASES.map((item) => [item.id, item]));
  const pitchbook = caseById.get("gtm-pitchbook-company-match-enrich") ?? PROFESSIONAL_WORKFLOW_CASES[0];
  const finance = PROFESSIONAL_WORKFLOW_CASES.find((item) => item.category === "finance_ops") ?? PROFESSIONAL_WORKFLOW_CASES[0];
  const evalHarness = PROFESSIONAL_WORKFLOW_CASES.find((item) => item.category === "eval_harness") ?? PROFESSIONAL_WORKFLOW_CASES[0];

  return [
    {
      id: "candidate-gtm-pitchbook-match",
      title: "GTM PitchBook match with evidence and no CRM clobber",
      workflowDomain: pitchbook.category,
      persona: pitchbook.persona,
      goal: pitchbook.agentGoal,
      sourceResearchPacketIds: [],
      architectureFit: {
        status: "existing_capability",
        existingCapabilityNotes: ["Artifact refs, CellPayload evidence, lock/CAS, and workflow eval scaffolds already exist."],
        missingCapabilityNotes: ["Needs a concrete trace fixture before becoming a gate."],
        convexBoundaryNeeds: { queries: [], mutations: [], actions: [], tools: [], validators: ["cross-file evidence assertion"] },
        smallestChange: "Add a deterministic fixture and assertions before touching runtime code.",
        avoidAdding: ["new GTM service", "new database tables"],
        requiredEvidence: pitchbook.assertions.slice(0, 2),
      },
      confidenceLevel: "candidate",
      gateMode: "advisory",
      contestedClaims: [],
      assertions: pitchbook.assertions.slice(0, 3).map((description, index) => ({
        id: `gtm-${index + 1}`,
        description,
        evidenceRefs: pitchbook.sourcePatterns,
      })),
      rootCauseCategories: ["weak_source_evidence", "missing_read_before_write"],
    },
    {
      id: "research-validated-finance-reconcile",
      title: "Finance variance reconciliation with formula-safe writes",
      workflowDomain: finance.category,
      persona: finance.persona,
      goal: finance.agentGoal,
      sourceResearchPacketIds: ["professional-workflow-profile-20260608"],
      architectureFit: {
        status: "small_gap",
        existingCapabilityNotes: ["Formula dependency locks, CellPayload evidence, and no-clobber paths are already part of the harness."],
        missingCapabilityNotes: ["Needs one concrete variance fixture with formula-preservation assertions."],
        convexBoundaryNeeds: {
          queries: ["read bounded formula/source ranges"],
          mutations: ["CAS write only changed variance notes"],
          actions: [],
          tools: [],
          validators: ["formula-preservation assertion", "source-row evidence assertion"],
        },
        smallestChange: "Add an eval fixture and validator around existing spreadsheet tools before adding any new tool.",
        avoidAdding: ["finance workflow service", "new spreadsheet engine"],
        requiredEvidence: finance.assertions.slice(0, 2),
      },
      confidenceLevel: "research_validated",
      gateMode: "advisory",
      contestedClaims: [],
      assertions: finance.assertions.slice(0, 3).map((description, index) => ({
        id: `finance-${index + 1}`,
        description,
        evidenceRefs: finance.sourcePatterns,
      })),
      rootCauseCategories: ["bad_mutation_contract", "weak_source_evidence"],
    },
    {
      id: "contested-eval-harness-expansion",
      title: "Eval harness generated from workflow rubrics",
      workflowDomain: evalHarness.category,
      persona: evalHarness.persona,
      goal: evalHarness.agentGoal,
      sourceResearchPacketIds: ["professional-workflow-profile-20260608"],
      architectureFit: {
        status: "existing_capability",
        existingCapabilityNotes: ["agent:improve already produces local artifacts and deterministic gates."],
        missingCapabilityNotes: ["Research-derived evals need confidence and gate policy before they can block."],
        convexBoundaryNeeds: { queries: [], mutations: [], actions: [], tools: [], validators: ["eval trust policy"] },
        smallestChange: "Keep this as an advisory eval fixture until the rubric is not contested.",
        avoidAdding: ["new HALO tables", "new eval service"],
        requiredEvidence: evalHarness.assertions.slice(0, 2),
      },
      confidenceLevel: "contested",
      gateMode: "advisory",
      contestedClaims: ["Different teams disagree on how much human review is required before eval promotion."],
      assertions: evalHarness.assertions.slice(0, 3).map((description, index) => ({
        id: `eval-${index + 1}`,
        description,
        evidenceRefs: evalHarness.sourcePatterns,
      })),
      rootCauseCategories: ["eval_measures_wrong_behavior", "ui_review_friction"],
    },
  ];
}

function renderMarkdown(run: LoopRun, timestampedJson: string): string {
  const pass = run.steps.filter((step) => step.status === "pass").length;
  const fail = run.steps.filter((step) => step.status === "fail").length;
  const blocked = run.steps.filter((step) => step.status === "blocked").length;
  const skip = run.steps.filter((step) => step.status === "skip").length;
  const lines: string[] = [];
  lines.push("# Agent Improvement Loop");
  lines.push("");
  lines.push(`Generated: ${run.generatedAt}`);
  lines.push("");
  lines.push(`Source pattern: ${run.cookbookSource}`);
  lines.push("");
  lines.push("NodeRoom adapts the cookbook loop as: traces -> human/model feedback -> reusable evals -> gate -> Codex handoff -> next harness change.");
  lines.push("");
  lines.push(`Latest run artifact: \`${rel(timestampedJson)}\``);
  lines.push("");
  lines.push(`Summary: ${pass} pass, ${blocked} blocked, ${fail} fail, ${skip} skip.`);
  lines.push("");
  lines.push("## Step Results");
  lines.push("");
  lines.push("| Step | Lane | Status | Duration | Command |");
  lines.push("|---|---|---:|---:|---|");
  for (const step of run.steps) {
    lines.push(`| ${step.label} | ${step.lane} | ${step.status.toUpperCase()} | ${(step.ms / 1000).toFixed(1)}s | \`${step.command}\` |`);
  }
  lines.push("");
  lines.push("## Workflow Coverage");
  lines.push("");
  lines.push(`Reviewed file profile: ${run.workflowProfile.manifestFiles} files (${run.workflowProfile.csvFiles} CSV, ${run.workflowProfile.xlsxFiles} XLSX).`);
  lines.push("");
  lines.push("| Category | Cases |");
  lines.push("|---|---:|");
  for (const [category, count] of Object.entries(run.workflowCoverage.byCategory)) {
    lines.push(`| ${category} | ${count} |`);
  }
  lines.push("");
  lines.push("## Architecture Before Eval");
  lines.push("");
  lines.push(run.architectureReview.rule);
  lines.push("");
  lines.push("| Eval trust level | Meaning |");
  lines.push("|---|---|");
  for (const item of run.architectureReview.evalTrustLevels) {
    lines.push(`| ${item.level} | ${item.meaning} |`);
  }
  lines.push("");
  lines.push(`Gate modes: ${run.architectureReview.gateModes.join(", ")}.`);
  lines.push("");
  lines.push("Architecture fit checks before adding code:");
  lines.push("");
  for (const item of run.architectureReview.architectureFitChecks) lines.push(`- ${item}`);
  lines.push("");
  lines.push("Root-cause labels used for HALO diagnosis:");
  lines.push("");
  for (const item of run.architectureReview.rootCauseCategories) lines.push(`- \`${item.category}\`: ${item.meaning}`);
  lines.push("");
  lines.push("## Generated Eval Ideas");
  lines.push("");
  lines.push("| Eval candidate | Trust | Gate | Architecture fit | Handoff decision |");
  lines.push("|---|---|---|---|---|");
  const decisions = new Map(run.handoff.blockedImplementationHandoffCandidates.concat(run.handoff.implementationHandoffCandidates).map((decision) => [decision.evalCandidateId, decision]));
  for (const idea of run.handoff.generatedEvalIdeas) {
    const decision = decisions.get(idea.id);
    const decisionText = decision ? `${decision.kind}${decision.reasons.length > 0 ? `: ${decision.reasons.join("; ")}` : ""}` : "none";
    lines.push(`| ${idea.id} | ${idea.confidenceLevel} | ${idea.gateMode} | ${idea.architectureFit.status} | ${decisionText} |`);
  }
  lines.push("");
  lines.push("## Codex Handoff");
  lines.push("");
  lines.push("### Architecture Budget");
  lines.push("");
  lines.push(`Allowed scope: ${run.handoff.architectureBudget.allowedScope}`);
  lines.push("");
  lines.push("Default allowed areas:");
  for (const item of run.handoff.architectureBudget.defaultAllowedAreas) lines.push(`- ${item}`);
  lines.push("");
  lines.push("Forbidden without human approval:");
  for (const item of run.handoff.architectureBudget.forbiddenWithoutHumanApproval) lines.push(`- ${item}`);
  lines.push("");
  lines.push("### Recommendations");
  lines.push("");
  for (const item of run.handoff.topRecommendations) lines.push(`- ${item}`);
  if (run.handoff.implementationHandoffCandidates.length === 0) {
    lines.push("- No implementation handoff candidates passed trust and architecture-fit policy in this run.");
  }
  lines.push("");
  lines.push("## Self-Scaffolding Proof-Looping");
  lines.push("");
  lines.push(`> ${run.handoff.scaffoldProposals.thesis}`);
  lines.push("");
  const sp = run.handoff.scaffoldProposals;
  lines.push(`Proposals: ${sp.proposals.length} total, ${sp.accepted.length} accepted, ${sp.rejected.length} rejected, ${sp.needsAdversarialReview.length} needs adversarial review.`);
  lines.push("");
  if (sp.proposals.length > 0) {
    lines.push("| Proposal | Target | Type | Verdict | Problem |");
    lines.push("|---|---|---|---|---|");
    for (const proposal of sp.proposals) {
      const review = sp.reviews.find((r) => r.proposalId === proposal.proposalId);
      const verdict = review?.verdict ?? "pending";
      lines.push(`| ${proposal.proposalId} | ${proposal.target} | ${proposal.changeType} | ${verdict} | ${proposal.problem.slice(0, 80)} |`);
    }
    lines.push("");
  }
  lines.push("## Next Live Runs");
  lines.push("");
  for (const item of run.handoff.nextLiveRuns) lines.push(`- \`${item}\``);
  return `${lines.join("\n")}\n`;
}

function renderSvg(run: LoopRun): string {
  const width = 980;
  const rowH = 38;
  const height = 104 + run.steps.length * rowH + 74;
  const colors: Record<StepStatus, string> = { pass: "#3FB37F", blocked: "#D9A441", fail: "#E0564E", skip: "#8B93A1" };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'JetBrains Mono', monospace">`);
  out.push(`<rect width="${width}" height="${height}" rx="16" fill="#111418"/>`);
  out.push(`<text x="28" y="36" fill="#E6E1DA" font-size="19" font-weight="700">NodeRoom agent improvement loop</text>`);
  out.push(`<text x="28" y="58" fill="#8B93A1" font-size="11">traces -> feedback -> evals -> gate -> handoff | ${esc(run.generatedAt.slice(0, 19))}</text>`);
  out.push(`<text x="28" y="78" fill="#8B93A1" font-size="10">${run.workflowCoverage.totalCases} professional workflow cases tracked</text>`);
  run.steps.forEach((step, index) => {
    const y = 104 + index * rowH;
    const color = colors[step.status];
    out.push(`<rect x="22" y="${y - 24}" width="${width - 44}" height="${rowH - 6}" rx="8" fill="${index % 2 ? "#171B20" : "#14181D"}" stroke="#2A2F37"/>`);
    out.push(`<text x="38" y="${y - 5}" fill="#E6E1DA" font-size="12.5" font-weight="700">${esc(step.label)}</text>`);
    out.push(`<text x="38" y="${y + 11}" fill="#8B93A1" font-size="10.5">${esc(step.lane)} | ${esc(step.command.slice(0, 82))}</text>`);
    out.push(`<rect x="${width - 170}" y="${y - 19}" width="76" height="24" rx="6" fill="${color}"/>`);
    out.push(`<text x="${width - 132}" y="${y - 3}" fill="#111418" font-size="10.5" text-anchor="middle" font-weight="800">${step.status.toUpperCase()}</text>`);
    out.push(`<text x="${width - 34}" y="${y - 3}" fill="#8B93A1" font-size="10.5" text-anchor="end">${(step.ms / 1000).toFixed(1)}s</text>`);
  });
  out.push(`<text x="28" y="${height - 28}" fill="#8B93A1" font-size="10">README charts should use only recorded loop artifacts, not manual confidence.</text>`);
  out.push("</svg>");
  return out.join("");
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasEnv(name: string): boolean {
  if (process.env[name]) return true;
  if (name === "CONVEX_URL" && process.env.VITE_CONVEX_URL) return true;
  return false;
}

function compactDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function tail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

function rel(path: string): string {
  return path.startsWith(process.cwd()) ? path.slice(process.cwd().length + 1).replace(/\\/g, "/") : basename(path);
}
