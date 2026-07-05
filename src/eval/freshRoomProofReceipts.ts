import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isProofloopFreeLocalOrNoProviderModel, type ProofloopCostAccounting } from "./proofloopModelTracking";

export const FRESH_ROOM_PROOF_ROOT = "docs/eval/fresh-room";
export const FRESH_ROOM_LATEST_FILENAME = "latest.json";

export const BASE_FRESH_ROOM_GATES = [
  "fresh_room_join",
  "public_nodeagent_invocation",
  "visible_streaming_progress",
  "trace_video_artifacts",
  "no_memory_mode_shortcut",
] as const;

export const FOCUS_MODE_PROOF_GATES = [
  "focus_mode_enabled",
  "focus_box_or_attention_overlay",
] as const;

export type FreshRoomProofGate =
  | (typeof BASE_FRESH_ROOM_GATES)[number]
  | (typeof FOCUS_MODE_PROOF_GATES)[number]
  | "official_fixture_upload"
  | "deliverable_export_download"
  | "artifact_reopen_validation"
  | "artifact_placeholder_scan"
  | "official_scorer_handoff"
  | "recovered_completed_fresh_room"
  | "agent_live_loop"
  | "agent_terminal_quality_gate"
  | "room_trace_visible"
  | "job_detail_visible"
  | "mutation_visible_in_artifact"
  | "evidence_box_or_citation_anchor"
  | "internal_verifier_handoff"
  | "visual_judge_handoff"
  | "human_review_handoff";

export type FreshRoomExportReceipt = {
  kind: "workbook" | "presentation" | "document" | "pdf" | "csv" | "image" | "scorecard" | "trace" | "video";
  filename: string;
  path?: string;
  extension?: string;
  downloaded?: boolean;
  bytes?: number;
  magic?: string;
};

export type FreshRoomReopenReceipt = {
  kind: FreshRoomExportReceipt["kind"];
  filename: string;
  reopened: boolean;
  scorerResult?: "pass" | "fail";
  detail?: string;
};

export type FreshRoomProofReceipt = {
  schema: 1;
  caseId: string;
  benchmark?: "spreadsheetbench-v1" | "spreadsheetbench-v2" | "bankertoolbench" | "nonbtb" | "product-smoke" | "collaboration" | "failure";
  taskId?: string;
  generatedAt: string;
  baseUrl: string;
  roomId?: string;
  roomUrl?: string;
  command: string;
  model?: {
    id?: string;
    requested?: string;
    resolved?: string;
    routePolicy?: string;
    role?: "planner" | "worker" | "judge" | "verifier";
    costUsd?: number | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    costAccounting?: ProofloopCostAccounting;
    runtimeProfile?: string;
    provider?: string;
    routeIntegrity?: {
      status: "matched" | "unverified" | "model_route_mismatch";
      requestedModel: string | null;
      telemetryModels: string[];
      measuredCostUsd: number | null;
      failures: string[];
    };
  };
  prompt?: string;
  memoryMode: boolean;
  freshness: {
    roomCreatedAfterRunStart: boolean;
    forbiddenPreloadedArtifactsAbsent: boolean;
    artifactsCreatedFresh: string[];
    uploadedFiles?: string[];
  };
  ui: {
    focusModeEnabled: boolean;
    attentionOverlayVisible: boolean;
    streamingVisible: boolean;
    jobDetailVisible?: boolean;
    roomTraceVisible?: boolean;
    screenshotPaths: string[];
    videoPaths?: string[];
    tracePath?: string;
  };
  artifacts: {
    uploadedFiles?: string[];
    created?: string[];
    exportedFiles?: FreshRoomExportReceipt[];
    reopenedFiles?: FreshRoomReopenReceipt[];
  };
  scorer?: {
    name: string;
    command?: string;
    verdict: "pass" | "fail";
    score?: number;
    details?: Record<string, unknown>;
  };
  visualJudge?: {
    command?: string;
    verdict: "pass" | "fail" | "not_run";
    scorecardPath?: string;
    reason?: string;
  };
  telemetry?: {
    latencyMs?: number;
    firstStreamMs?: number;
    firstMutationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    modelCalls?: number;
    toolCalls?: number;
    mutationCount?: number;
    costUsd?: number;
  };
  gatesProven: FreshRoomProofGate[];
  gatesNotProven?: Record<string, string>;
  passed: boolean;
};

export type FreshRoomProofValidation = {
  ok: boolean;
  path?: string;
  caseId?: string;
  errors: string[];
};

export function freshRoomProofPath(caseId: string, root = FRESH_ROOM_PROOF_ROOT): string {
  return join(root, caseId, FRESH_ROOM_LATEST_FILENAME);
}

export function writeFreshRoomProofReceipt(
  receipt: FreshRoomProofReceipt,
  path = freshRoomProofPath(receipt.caseId),
): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(receipt, null, 2)}\n`);
}

export function readFreshRoomProofReceipt(path: string): FreshRoomProofReceipt | null {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8")) as FreshRoomProofReceipt;
  } catch {
    return null;
  }
}

export function validateFreshRoomProofReceipt(
  receipt: unknown,
  options: {
    path?: string;
    caseId?: string;
    requireFocusMode?: boolean;
    requireOfficialScorer?: boolean;
    requireArtifactPlaceholderScan?: boolean;
    requireAgentTerminalQuality?: boolean;
  } = {},
): FreshRoomProofValidation {
  const errors: string[] = [];
  const proof = objectRecord(receipt) as Partial<FreshRoomProofReceipt> | undefined;
  const gateSet = new Set(Array.isArray(proof?.gatesProven) ? proof.gatesProven : []);

  const add = (message: string) => errors.push(message);
  if (!proof) add("receipt must be a JSON object");
  if (proof?.schema !== 1) add("schema must be 1");
  if (!nonEmptyString(proof?.caseId)) add("caseId is required");
  if (options.caseId && proof?.caseId !== options.caseId) add(`caseId must be ${options.caseId}`);
  if (!nonEmptyString(proof?.generatedAt) || Number.isNaN(Date.parse(proof.generatedAt ?? ""))) add("generatedAt must be an ISO timestamp");
  if (!nonEmptyString(proof?.baseUrl)) add("baseUrl is required");
  if (!nonEmptyString(proof?.command)) add("command is required");
  if (!proof?.model || typeof proof.model !== "object") add("model is required");
  if (!nonEmptyString(proof?.model?.id ?? proof?.model?.resolved)) add("model.id is required");
  if (!nonEmptyString(proof?.model?.provider)) add("model.provider is required");
  if (!nonEmptyString(proof?.model?.routePolicy)) add("model.routePolicy is required");
  if (!nonEmptyString(proof?.model?.role)) add("model.role is required");
  if (typeof proof?.model?.costUsd !== "number" || !Number.isFinite(proof.model.costUsd)) add("model.costUsd is required");
  if (typeof proof?.model?.tokensIn !== "number" || !Number.isFinite(proof.model.tokensIn)) add("model.tokensIn is required");
  if (typeof proof?.model?.tokensOut !== "number" || !Number.isFinite(proof.model.tokensOut)) add("model.tokensOut is required");
  if (!proof?.model?.costAccounting?.status) add("model.costAccounting.status is required");
  const modelId = proof?.model?.id ?? proof?.model?.resolved;
  const freeOrLocalModel = isProofloopFreeLocalOrNoProviderModel({
    id: modelId,
    provider: proof?.model?.provider,
    routePolicy: proof?.model?.routePolicy,
  });
  if (proof?.model?.costAccounting?.status === "free" && !freeOrLocalModel) {
    add("model.costAccounting.status=free requires a free/local/no-provider model route");
  }
  if (!freeOrLocalModel) {
    if (proof?.model?.costAccounting?.status === "unknown") add("paid/provider model cost accounting cannot be unknown in a passing proof receipt");
    if (typeof proof?.model?.costUsd === "number" && Number.isFinite(proof.model.costUsd) && proof.model.costUsd <= 0) {
      add("model.costUsd must be > 0 for paid/provider model routes");
    }
    if (typeof proof?.model?.tokensIn === "number" && Number.isFinite(proof.model.tokensIn) && proof.model.tokensIn <= 0) {
      add("model.tokensIn must be > 0 for paid/provider model routes");
    }
    if (typeof proof?.model?.tokensOut === "number" && Number.isFinite(proof.model.tokensOut) && proof.model.tokensOut <= 0) {
      add("model.tokensOut must be > 0 for paid/provider model routes");
    }
  }
  if (proof?.memoryMode !== false) add("memoryMode must be false");
  if (proof?.passed !== true) add("passed must be true");

  for (const gate of BASE_FRESH_ROOM_GATES) {
    if (!gateSet.has(gate)) add(`missing required gate: ${gate}`);
  }
  if (gateSet.has("official_fixture_upload")) {
    const uploaded = proof?.artifacts?.uploadedFiles ?? proof?.freshness?.uploadedFiles ?? [];
    if (!Array.isArray(uploaded) || uploaded.length === 0) {
      add("official_fixture_upload requires uploaded file evidence");
    }
  }
  if (options.requireFocusMode ?? true) {
    for (const gate of FOCUS_MODE_PROOF_GATES) {
      if (!gateSet.has(gate)) add(`missing Focus Mode gate: ${gate}`);
    }
    if (proof?.ui?.focusModeEnabled !== true) add("ui.focusModeEnabled must be true");
    if (proof?.ui?.attentionOverlayVisible !== true) add("ui.attentionOverlayVisible must be true");
  }

  if (proof?.freshness?.roomCreatedAfterRunStart !== true) add("freshness.roomCreatedAfterRunStart must be true");
  if (proof?.freshness?.forbiddenPreloadedArtifactsAbsent !== true) add("freshness.forbiddenPreloadedArtifactsAbsent must be true");
  if (!Array.isArray(proof?.freshness?.artifactsCreatedFresh) || proof.freshness.artifactsCreatedFresh.length === 0) {
    add("freshness.artifactsCreatedFresh must list fresh artifacts");
  }
  if (proof?.ui?.streamingVisible !== true) add("ui.streamingVisible must be true");
  if (!Array.isArray(proof?.ui?.screenshotPaths) || proof.ui.screenshotPaths.length === 0) add("ui.screenshotPaths must list at least one screenshot");
  for (const path of proof?.ui?.screenshotPaths ?? []) {
    if (!existingPath(path)) add(`screenshot path does not exist: ${path}`);
  }
  if (!proof?.ui?.tracePath && (!Array.isArray(proof?.ui?.videoPaths) || proof.ui.videoPaths.length === 0)) {
    add("ui.tracePath or ui.videoPaths is required for trace/video proof");
  }
  if (proof?.ui?.tracePath && !existingPath(proof.ui.tracePath)) add(`trace path does not exist: ${proof.ui.tracePath}`);
  for (const path of proof?.ui?.videoPaths ?? []) {
    if (!existingPath(path)) add(`video path does not exist: ${path}`);
  }

  if (gateSet.has("deliverable_export_download")) {
    const exported = proof?.artifacts?.exportedFiles ?? [];
    if (!exported.length) add("deliverable_export_download requires artifacts.exportedFiles");
    for (const file of exported) {
      if (!nonEmptyString(file.filename)) add("exported file is missing filename");
      if (file.downloaded !== true) add(`${file.filename || "exported file"} must have downloaded=true`);
      if (typeof file.bytes !== "number" || !Number.isFinite(file.bytes) || file.bytes <= 0) add(`${file.filename || "exported file"} must have bytes > 0`);
      if (file.path && !existingPath(file.path)) add(`exported file path does not exist: ${file.path}`);
    }
  }
  if (gateSet.has("artifact_reopen_validation")) {
    const reopened = proof?.artifacts?.reopenedFiles ?? [];
    if (!reopened.length) add("artifact_reopen_validation requires artifacts.reopenedFiles");
    for (const file of reopened) {
      if (file.reopened !== true) add(`${file.filename || "reopened file"} must have reopened=true`);
      if (file.scorerResult && file.scorerResult !== "pass") add(`${file.filename || "reopened file"} scorerResult must pass`);
    }
  }
  if ((options.requireOfficialScorer ?? gateSet.has("official_scorer_handoff")) && proof?.scorer?.verdict !== "pass") {
    add("official scorer handoff requires scorer.verdict=pass");
  }
  if ((options.requireArtifactPlaceholderScan ?? false) && !gateSet.has("artifact_placeholder_scan")) {
    add("missing required gate: artifact_placeholder_scan");
  }
  if ((options.requireAgentTerminalQuality ?? false) && !gateSet.has("agent_terminal_quality_gate")) {
    add("missing required gate: agent_terminal_quality_gate");
  }
  if (proof?.visualJudge?.verdict === "fail") add("visualJudge verdict must not be fail");

  return { ok: errors.length === 0, path: options.path, caseId: proof?.caseId, errors };
}

function existingPath(path: string): boolean {
  if (!nonEmptyString(path)) return false;
  const normalized = path.replace(/\\/g, "/");
  // Try direct resolution first (handles relative paths and same-machine absolute paths)
  const direct = resolve(process.cwd(), normalized);
  if (existsSync(direct)) return true;
  // For absolute paths from a different machine, try to extract the project-relative portion.
  // Receipts generated on other machines may contain paths like:
  //   C:\Users\hshum\.codex\worktrees\b349\noderoom\test-results\...
  // We look for the last occurrence of a known project root segment and resolve from there.
  const projectRootMarkers = ["noderoom/", "test-results/"];
  for (const marker of projectRootMarkers) {
    const idx = normalized.lastIndexOf(marker);
    if (idx >= 0) {
      const relativePart = normalized.slice(idx + marker.length);
      const candidate = resolve(process.cwd(), relativePart);
      if (existsSync(candidate)) return true;
      // Also try with the marker itself (in case the project root IS the marker)
      const candidateWithMarker = resolve(process.cwd(), marker + relativePart);
      if (existsSync(candidateWithMarker)) return true;
    }
  }
  return false;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export type FreshRoomProofBoundaryCaseId = "FR-020" | "FR-020A" | "FR-020B" | "FR-020C";
export type FreshRoomProofBoundaryStatus = "passed" | "partial" | "blocked";
export type FreshRoomProofBoundaryGateStatus = "pass" | "partial" | "blocked";

export type FreshRoomProofBoundaryGate = {
  id: string;
  label: string;
  status: FreshRoomProofBoundaryGateStatus;
  evidence?: string[];
  blocker?: string;
};

export type FreshRoomProofBoundaryCase = {
  id: FreshRoomProofBoundaryCaseId;
  title: string;
  lane:
    | "bankertoolbench_selective_live_task"
    | "bankertoolbench_full_suite";
  status: FreshRoomProofBoundaryStatus;
  sourceReceipt?: string;
  claimBoundary: string;
  proves: string[];
  doesNotProve: string[];
  gates: FreshRoomProofBoundaryGate[];
};

export type FreshRoomProofRegistry = {
  schema: 1;
  generatedAt?: string;
  policy: string[];
  summary: {
    cases: number;
    passedCases: number;
    partialCases: number;
    blockedCases: number;
    financeDomainGatePassed: boolean;
    selectiveBankerToolBenchReady: boolean;
    selectiveLiveBrowserBenchmarkReady: boolean;
    bankerToolBenchFullSuiteReady: boolean;
    liveBrowserBenchmarkReady: boolean;
  };
  financeReceiptPath: string;
  cases: FreshRoomProofBoundaryCase[];
};

export type FinanceDomainReceipt = {
  schema: 1;
  caseId: "FIN-020";
  generatedAt?: string;
  sourceReceipt: string;
  status: FreshRoomProofBoundaryStatus;
  runtimeProfile?: string;
  model?: string;
  totalCases?: number;
  passedCases?: number;
  claimBoundary: string;
  proves: string[];
  doesNotProve: string[];
  gates: FreshRoomProofBoundaryGate[];
};

type ProfessionalRuntimeReceipt = {
  harnessVersion?: string;
  model?: string;
  total?: number;
  passed?: number;
  failed?: number;
  allPassed?: boolean;
  rows?: Array<{ checks?: Record<string, boolean | undefined> }>;
};

const FINANCE_RUNTIME_PATH = "docs/eval/professional-live-runtime.json";
const FINANCE_BOUNDARY_RECEIPT = "docs/eval/fresh-room/FR-020/finance-domain-receipt.json";
const FR020_LIVE_BTB_RECEIPT = "docs/eval/fresh-room/FR-020/latest.json";
const FULLSUITE_GATE_VERDICT = "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json";
const LIVESUITE_GATE_VERDICT = "docs/eval/fresh-room/FR-020/livesuite-gate-receipt.json";

type FullSuiteGateVerdictFile = {
  schema?: string;
  flipEligible?: boolean;
  cleanScoredTaskCount?: number;
  expectedCount?: number;
  meanCleanReward?: number | null;
  passRate?: number | null;
  passThreshold?: number;
};

type LiveSuiteGateVerdictFile = {
  schema?: string;
  flipEligible?: boolean;
  passedTaskCount?: number;
  expectedCount?: number;
};

function readGateVerdict<T>(path: string): T | null {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8")) as T;
  } catch {
    return null;
  }
}

function fmtReward(value: number | null | undefined): string {
  return value == null ? "n/a" : value.toFixed(4);
}
const FULL_SUITE_EVIDENCE = [
  "docs/eval/official-benchmark-readiness.json",
  "docs/eval/official-benchmark-ui-coverage.json",
  "docs/eval/bankertoolbench-official-contract.json",
];

function readJsonFileIfExists<T>(relPath: string): T | undefined {
  const absolute = resolve(process.cwd(), relPath);
  if (!existsSync(absolute)) return undefined;
  return JSON.parse(readFileSync(absolute, "utf8")) as T;
}

function boundaryGate(
  id: string,
  label: string,
  status: FreshRoomProofBoundaryGateStatus,
  evidence?: string[],
  blocker?: string,
): FreshRoomProofBoundaryGate {
  return {
    id,
    label,
    status,
    ...(evidence?.length ? { evidence } : {}),
    ...(blocker ? { blocker } : {}),
  };
}

export function buildFinanceDomainReceipt(args: { generatedAt?: string } = {}): FinanceDomainReceipt {
  const runtime = readJsonFileIfExists<ProfessionalRuntimeReceipt>(FINANCE_RUNTIME_PATH);
  const runtimePassed = runtime?.allPassed === true && runtime.total === runtime.passed && (runtime.total ?? 0) > 0;
  const managedNoClobber = (runtime?.rows ?? []).length > 0
    && (runtime?.rows ?? []).every((row) =>
      row.checks?.usedProductionManagedWrite === true
      && row.checks.noSilentClobber === true
      && row.checks.releaseOrTtlFallback === true
    );

  return {
    schema: 1,
    caseId: "FIN-020",
    generatedAt: args.generatedAt,
    sourceReceipt: FINANCE_RUNTIME_PATH,
    status: runtimePassed ? "passed" : "blocked",
    runtimeProfile: runtime?.harnessVersion,
    model: runtime?.model,
    totalCases: runtime?.total,
    passedCases: runtime?.passed,
    claimBoundary:
      "FIN-020 is the finance-domain runtime gate. It proves professional workflow execution through the runtime harness, not a live-browser official BankerToolBench score.",
    proves: [
      "professional finance/GTM workflow cases pass through the runtime harness",
      "managed write coordination, evidence-bearing cell payloads, no-clobber checks, privacy boundaries, and human-review signals are exercised",
    ],
    doesNotProve: [
      "fresh live-browser benchmark completion",
      "official BankerToolBench score",
      "browser export/download and reopen proof",
      "full 100-task BankerToolBench suite completion",
    ],
    gates: [
      boundaryGate(
        "professional_runtime_cases",
        "All professional finance runtime cases passed",
        runtimePassed ? "pass" : "blocked",
        [FINANCE_RUNTIME_PATH],
        runtimePassed ? undefined : "Professional runtime receipt is missing or not fully passing.",
      ),
      boundaryGate(
        "managed_write_coordination",
        "Managed write coordination and no-clobber checks passed",
        managedNoClobber ? "pass" : "partial",
        [FINANCE_RUNTIME_PATH],
        managedNoClobber ? undefined : "One or more runtime rows lack managed write/no-clobber evidence.",
      ),
      boundaryGate(
        "live_browser",
        "Fresh live-browser room proof",
        "blocked",
        undefined,
        "Finance runtime proof is not a browser-run proof lane.",
      ),
      boundaryGate(
        "export_reopen",
        "Browser export/download and reopen proof",
        "blocked",
        undefined,
        "Finance runtime proof does not include browser-downloaded/reopened artifacts.",
      ),
      boundaryGate(
        "official_scorer",
        "Official benchmark scorer or verifier handoff",
        "blocked",
        undefined,
        "Finance runtime proof uses the professional runtime harness, not an official benchmark scorer.",
      ),
    ],
  };
}

export function buildFreshRoomProofRegistry(args: { generatedAt?: string } = {}): FreshRoomProofRegistry {
  const finance = buildFinanceDomainReceipt({ generatedAt: args.generatedAt });
  const fr020 = readFreshRoomProofReceipt(FR020_LIVE_BTB_RECEIPT);
  const fr020Validation = fr020
    ? validateFreshRoomProofReceipt(fr020, {
        path: FR020_LIVE_BTB_RECEIPT,
        caseId: "FR-020",
        requireArtifactPlaceholderScan: true,
        requireAgentTerminalQuality: true,
        requireOfficialScorer: true,
      })
    : { ok: false, errors: ["FR-020 receipt is missing"] };
  const fr020SelectiveReady =
    fr020?.benchmark === "bankertoolbench"
    && fr020?.passed === true
    && fr020Validation.ok;

  // FR-020B (official isolated lane) and FR-020C (live product-UI lane) are DERIVED from the
  // committed gate-verdict receipts, not hardcoded -- so `benchmark:fresh-room:proofs` regenerates
  // an honest, evidence-driven registry that survives re-runs.
  const fullSuiteVerdict = readGateVerdict<FullSuiteGateVerdictFile>(FULLSUITE_GATE_VERDICT);
  const fullSuiteReady = fullSuiteVerdict?.flipEligible === true;
  const liveSuiteVerdict = readGateVerdict<LiveSuiteGateVerdictFile>(LIVESUITE_GATE_VERDICT);
  const liveSuiteReady = liveSuiteVerdict?.flipEligible === true;

  const selectiveGates = [
    boundaryGate(
      "fresh_room_ui",
      "Fresh live-browser room, official prompt, and public NodeAgent lane",
      fr020SelectiveReady ? "pass" : "blocked",
      [FR020_LIVE_BTB_RECEIPT],
      fr020SelectiveReady ? undefined : fr020Validation.errors.join("; "),
    ),
    boundaryGate(
      "export_reopen",
      "Browser-run deliverable export and reopen",
      fr020?.gatesProven.includes("deliverable_export_download") && fr020.gatesProven.includes("artifact_reopen_validation") ? "pass" : "blocked",
      [FR020_LIVE_BTB_RECEIPT],
      fr020?.gatesProven.includes("deliverable_export_download") && fr020.gatesProven.includes("artifact_reopen_validation")
        ? undefined
        : "FR-020 does not prove export/reopen gates.",
    ),
    boundaryGate(
      "official_verifier",
      "Benchmark-faithful verifier handoff",
      fr020?.gatesProven.includes("official_scorer_handoff") && fr020.scorer?.verdict === "pass" ? "pass" : "blocked",
      [FR020_LIVE_BTB_RECEIPT, fr020?.scorer?.details?.packageManifestPath as string].filter(nonEmptyString),
      fr020?.gatesProven.includes("official_scorer_handoff") && fr020.scorer?.verdict === "pass"
        ? undefined
        : "FR-020 lacks a passing verifier/scorer handoff.",
    ),
    boundaryGate(
      "visual_judge",
      "Media judge or visual proof handoff",
      fr020?.visualJudge?.verdict === "pass" ? "pass" : "partial",
      [FR020_LIVE_BTB_RECEIPT, fr020?.visualJudge?.scorecardPath].filter(nonEmptyString),
      fr020?.visualJudge?.verdict === "pass" ? undefined : "Visual judge did not pass or was not run.",
    ),
  ];
  const cases: FreshRoomProofBoundaryCase[] = [
    {
      id: "FR-020",
      title: "Current FR-020 selective live BankerToolBench receipt",
      lane: "bankertoolbench_selective_live_task",
      status: fr020SelectiveReady ? "passed" : "blocked",
      sourceReceipt: FR020_LIVE_BTB_RECEIPT,
      claimBoundary:
        "FR-020 proves one selective BankerToolBench live-browser task package. It does not prove the full BankerToolBench suite.",
      proves: [
        "fresh live room flow for one BankerToolBench task",
        "official fixture upload, public NodeAgent invocation, export/download, reopen, scorer handoff, and visual proof gates for the selected task",
      ],
      doesNotProve: [
        "100/100 task official BankerToolBench completion",
        "aggregate production benchmark score",
        "all BankerToolBench task families and edge cases",
      ],
      gates: selectiveGates,
    },
    {
      id: "FR-020A",
      title: "Selective BankerToolBench task proof lane",
      lane: "bankertoolbench_selective_live_task",
      status: fr020SelectiveReady ? "passed" : "blocked",
      sourceReceipt: FR020_LIVE_BTB_RECEIPT,
      claimBoundary:
        "FR-020A is the narrow selective-task claim. It may cite the FR-020 live receipt, but only for the specific task and package it actually ran.",
      proves: [
        "a31173e3 selective BankerToolBench task can be run through the live room proof path",
      ],
      doesNotProve: [
        "full suite pass rate",
        "official public leaderboard score",
      ],
      gates: selectiveGates,
    },
    {
      id: "FR-020B",
      title: "Full BankerToolBench suite completion (official isolated lane)",
      lane: "bankertoolbench_full_suite",
      status: fullSuiteReady ? "passed" : "blocked",
      claimBoundary: fullSuiteReady
        ? "FR-020B proves full-suite COMPLETION + official Gandalf scoring via the isolated (Harbor) generic-only lane. It does NOT prove a 100% rubric pass rate, nor live-browser UI for all 100 tasks (FR-020C is the live-UI lane)."
        : "FR-020B remains blocked until the full official BankerToolBench suite runs through isolated execution and official verifier scoring (generic-only).",
      proves: fullSuiteReady
        ? [
            `Full BankerToolBench suite executed and officially scored generic-only (${fullSuiteVerdict?.cleanScoredTaskCount ?? 0}/${fullSuiteVerdict?.expectedCount ?? 100} clean tasks, mean reward ${fmtReward(fullSuiteVerdict?.meanCleanReward)}).`,
          ]
        : [],
      doesNotProve: [
        `A 100% rubric pass rate (observed pass-rate ${fmtReward(fullSuiteVerdict?.passRate)} at reward >= ${fullSuiteVerdict?.passThreshold ?? 1}).`,
        "Live-browser UI evidence for all 100 tasks (that is FR-020C; FR-020A proves live-UI for one task).",
      ],
      gates: [
        boundaryGate(
          "full_suite_execution",
          "All 100 official BankerToolBench tasks execute",
          fullSuiteReady ? "pass" : "blocked",
          [FULLSUITE_GATE_VERDICT, ...FULL_SUITE_EVIDENCE],
          fullSuiteReady ? undefined : "No flip-eligible full-suite gate verdict present.",
        ),
        boundaryGate(
          "aggregate_score_import",
          "Official aggregate verifier scores are imported and trace-linked",
          fullSuiteReady ? "pass" : "blocked",
          [FULLSUITE_GATE_VERDICT],
          fullSuiteReady ? undefined : "No flip-eligible full-suite gate verdict present.",
        ),
      ],
    },
    {
      id: "FR-020C",
      title: "Full BankerToolBench suite through live product UI",
      lane: "bankertoolbench_full_suite",
      status: liveSuiteReady ? "passed" : "blocked",
      claimBoundary: liveSuiteReady
        ? "FR-020C proves all 100 tasks completed through the live product UI (fresh room -> upload -> public @nodeagent -> export -> reopen -> verifier + visual judge)."
        : "FR-020C remains blocked until all 100 tasks pass the live-browser UI flow (per-task fresh-room receipts). FR-020A proves the live-UI flow for one task today.",
      proves: liveSuiteReady
        ? [
            `All ${liveSuiteVerdict?.passedTaskCount ?? 0}/${liveSuiteVerdict?.expectedCount ?? 100} tasks completed through the live product UI with passing per-task fresh-room receipts.`,
          ]
        : [],
      doesNotProve: liveSuiteReady
        ? ["A 100% rubric pass rate (live UI proves completion through the product, not perfect scores)."]
        : ["Full live-UI suite completion (only FR-020A, one task, is proven live today)."],
      gates: [
        boundaryGate(
          "full_suite_live_ui_execution",
          "All 100 tasks complete through the live product UI",
          liveSuiteReady ? "pass" : "blocked",
          [LIVESUITE_GATE_VERDICT],
          liveSuiteReady ? undefined : "No flip-eligible live-suite gate verdict present.",
        ),
      ],
    },
  ];

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    policy: [
      "FR-020/FR-020A selective task proof and FR-020B full-suite proof are separate claims and may not be collapsed into one pass.",
      "FR-020B (official isolated/Harbor lane) and FR-020C (live product-UI lane) are separate full-suite claims; completion + scoring is not a 100% pass rate.",
      "A domain runtime pass may not imply live-browser benchmark completion.",
      "A selective benchmark task proof may not imply a full-suite official benchmark score.",
      "A benchmark claim must name the exact lane, scorer, UI proof status, export/reopen status, and verifier handoff status.",
    ],
    summary: {
      cases: cases.length,
      passedCases: cases.filter((item) => item.status === "passed").length,
      partialCases: cases.filter((item) => item.status === "partial").length,
      blockedCases: cases.filter((item) => item.status === "blocked").length,
      financeDomainGatePassed: finance.status === "passed",
      selectiveBankerToolBenchReady: fr020SelectiveReady,
      selectiveLiveBrowserBenchmarkReady: fr020SelectiveReady,
      bankerToolBenchFullSuiteReady: fullSuiteReady,
      liveBrowserBenchmarkReady: liveSuiteReady,
    },
    financeReceiptPath: FINANCE_BOUNDARY_RECEIPT,
    cases,
  };
}
