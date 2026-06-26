import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RALPH_MILESTONES,
  SOLO_MILESTONE_CONTRACTS,
  readSoloLoopState,
  type RalphMilestone,
  type SoloLoopRun,
} from "./ralphLoopLedger";
import { readSoloBusEvents, renderAgentMatrix } from "./soloEventBus";
import { freshRoomProofPath, readFreshRoomProofReceipt, validateFreshRoomProofReceipt, type FreshRoomProofReceipt } from "../eval/freshRoomProofReceipts";

export type SfnDashboardOptions = {
  projectRoot?: string;
  caseId?: string;
};

export function renderSfnDashboard(options: SfnDashboardOptions = {}): string {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const state = readSoloLoopState(projectRoot);
  const caseId = options.caseId ?? "FR-010";
  const proof = readFreshRoomProofReceipt(freshRoomProofPath(caseId));
  const events = readSoloBusEvents(projectRoot).slice(-6);
  const title = state
    ? `Solo Founder Agent Builder | Loop ${shortId(state.loopId)} | Goal: ${state.goal}`
    : "Solo Founder Agent Builder | No active .solo loop";

  return frame(title, [
    ...renderMilestones(state),
    "",
    ...renderProofCase(caseId, proof),
    "",
    "Recent events",
    ...(events.length ? events.map((event) => `  ${event.createdAt} ${event.agent} ${event.event} ${event.status ?? ""}`) : ["  none"]),
  ]);
}

export function renderProofCaseSummary(caseId: string): string {
  const proof = readFreshRoomProofReceipt(freshRoomProofPath(caseId));
  return frame(`${caseId} Proof Run`, renderProofCase(caseId, proof));
}

export function renderNodeRoomWatch(caseId: string): string {
  const proof = readNodeRoomWatchProof(caseId);
  return frame("NodeRoom Live Proof", renderNodeRoomProofSurface(caseId, proof));
}

export function renderSfnAgentMatrix(): string {
  return frame("sfn agent matrix", renderAgentMatrix().split("\n"));
}

export function renderLoopDoctor(projectRoot: string = process.cwd()): string {
  const state = readSoloLoopState(projectRoot);
  const errors: string[] = [];
  if (!state) {
    errors.push("missing .solo/loop-state.json");
  } else {
    for (const milestone of RALPH_MILESTONES) {
      const row = state.milestones[milestone];
      for (const receipt of row.receipts) {
        const absolute = resolve(projectRoot, ".solo", receipt);
        if (!existsSync(absolute)) errors.push(`${milestone} receipt listed but missing: ${receipt}`);
      }
    }
  }
  return frame("sfn doctor", errors.length ? errors.map((error) => `! ${error}`) : ["ok"]);
}

function renderMilestones(state: SoloLoopRun | null): string[] {
  if (!state) return ["Run: npm run sfn -- loop init --goal \"build agent for this app\""];
  return RALPH_MILESTONES.map((milestone) => {
    const row = state.milestones[milestone];
    return `${milestone} ${SOLO_MILESTONE_CONTRACTS[milestone].label.padEnd(21)} ${statusLabel(row.status)} ${receiptSummary(milestone, state)}`;
  });
}

function renderProofCase(caseId: string, proof: FreshRoomProofReceipt | null): string[] {
  if (!proof) return [`Active proof case: ${caseId}`, "  receipt missing"];
  const validation = validateFreshRoomProofReceipt(proof, { caseId, requireOfficialScorer: proof.gatesProven.includes("official_scorer_handoff") });
  const exported = proof.artifacts.exportedFiles ?? [];
  const reopened = proof.artifacts.reopenedFiles ?? [];
  return [
    `Active proof case: ${caseId} ${validation.ok ? "PASS" : "FAIL"}`,
    `Agent host: ${proof.model?.provider ?? "unknown"} / ${proof.model?.resolved ?? "unknown"}`,
    `Room: ${proof.roomUrl ?? proof.roomId ?? "unknown"}`,
    `Runtime profile: ${proof.model?.runtimeProfile ?? "standard"}`,
    `Cost: ${money(proof.telemetry?.costUsd)} | Tool calls: ${proof.telemetry?.toolCalls ?? 0} | Model calls: ${proof.telemetry?.modelCalls ?? 0}`,
    "Artifacts",
    ...exported.map((file) => `  [x] ${file.filename} ${file.bytes ? `${file.bytes} bytes` : ""}`),
    ...reopened.map((file) => `  [x] reopened ${file.filename}`),
    ...(proof.visualJudge?.verdict === "not_run" ? [`  [!] visual judge not run: ${proof.visualJudge.reason ?? "not configured"}`] : []),
    ...(validation.ok ? [] : validation.errors.map((error) => `  [!] ${error}`)),
  ];
}

function renderNodeRoomProofSurface(caseId: string, proof: FreshRoomProofReceipt | null): string[] {
  if (!proof) return [
    `Proof case: ${caseId}`,
    "Room: receipt missing",
    "Run: npm run sfn -- noderoom run-fresh-room --case <case> --headed",
  ];

  const validation = validateFreshRoomProofReceipt(proof, {
    caseId,
    requireOfficialScorer: proof.gatesProven.includes("official_scorer_handoff"),
  });
  const exported = proof.artifacts.exportedFiles ?? [];
  const reopened = proof.artifacts.reopenedFiles ?? [];
  const btbLedger = caseId === "FR-020" ? readBtbLedgerSummary() : null;

  return [
    `Proof case: ${caseId} ${validation.ok ? "PASS" : "FAIL"}`,
    `Room: ${proof.roomUrl ?? proof.roomId ?? "unknown"}`,
    `Benchmark: ${proof.benchmark ?? "product-smoke"} | task: ${proof.taskId ?? "n/a"}`,
    `Model: ${proof.model?.resolved ?? "unknown"} | profile: ${proof.model?.runtimeProfile ?? "standard"} | provider: ${proof.model?.provider ?? "unknown"}`,
    "",
    "Real user path",
    `  ${mark(proof.memoryMode === false)} fresh live room, no memory-mode shortcut`,
    `  ${mark(proof.gatesProven.includes("official_fixture_upload"))} uploaded room source files`,
    `  ${mark(proof.gatesProven.includes("public_nodeagent_invocation"))} public @nodeagent ask in room chat`,
    `  ${mark(proof.ui.streamingVisible)} NodeAgent stream visible in UI`,
    `  ${mark(proof.gatesProven.includes("agent_live_loop"))} live model/tool loop recorded`,
    "",
    "NodeRoom surfaces",
    `  ${mark(proof.ui.focusModeEnabled)} Focus Mode on`,
    `  ${mark(proof.ui.attentionOverlayVisible)} focus/evidence boxes mounted`,
    `  ${mark(Boolean(proof.ui.roomTraceVisible) || proof.gatesProven.includes("room_trace_visible"))} room trace visible`,
    `  ${mark(Boolean(proof.ui.jobDetailVisible) || proof.gatesProven.includes("job_detail_visible"))} job detail visible`,
    `  ${mark(Boolean(proof.ui.tracePath) || Boolean(proof.ui.videoPaths?.length))} trace/video artifact captured`,
    "",
    "Artifacts",
    `  ${mark((proof.freshness.artifactsCreatedFresh ?? []).length > 0)} fresh artifacts: ${proof.freshness.artifactsCreatedFresh.length}`,
    `  ${mark(exported.length > 0)} exported/downloaded files: ${exported.length}`,
    `  ${mark(reopened.length > 0 && reopened.every((file) => file.reopened))} reopened files: ${reopened.filter((file) => file.reopened).length}/${reopened.length}`,
    ...exported.slice(0, 8).map((file) => `    - ${file.filename}${file.bytes ? ` (${file.bytes} bytes)` : ""}`),
    ...(exported.length > 8 ? [`    - ... ${exported.length - 8} more`] : []),
    "",
    "Judges",
    `  ${mark(proof.scorer?.verdict === "pass")} deterministic verifier: ${proof.scorer?.verdict ?? "missing"}`,
    `  ${visualJudgeMark(proof)} visual judge: ${proof.visualJudge?.verdict ?? "missing"}${proof.visualJudge?.reason ? ` (${proof.visualJudge.reason})` : ""}`,
    "",
    "Metrics",
    `  cost: ${money(proof.telemetry?.costUsd)} | model calls: ${proof.telemetry?.modelCalls ?? 0} | tool calls: ${proof.telemetry?.toolCalls ?? 0}`,
    `  screenshots: ${proof.ui.screenshotPaths.length} | trace: ${proof.ui.tracePath ?? "missing"}`,
    ...(btbLedger ? [
      "",
      "FR-020 BTB matrix",
      `  ${mark(btbLedger.fullBenchmarkClaim === "ready")} tasks proven: ${btbLedger.provenTaskCount}/${btbLedger.selectedTaskCount}`,
      `  ${mark(btbLedger.failedReceiptCount === 0)} failed receipts: ${btbLedger.failedReceiptCount}`,
      `  ${mark(btbLedger.missingReceiptCount === 0)} missing receipts: ${btbLedger.missingReceiptCount}`,
    ] : []),
    ...(validation.ok ? [] : ["", "Validation errors", ...validation.errors.map((error) => `  [!] ${error}`)]),
  ];
}

function readNodeRoomWatchProof(caseId: string): FreshRoomProofReceipt | null {
  if (caseId !== "FR-020") return readFreshRoomProofReceipt(freshRoomProofPath(caseId));
  const ledger = readBtbLedger();
  const newestPassed = ledger?.rows
    ?.filter((row) => row.passed && row.receiptPath)
    .sort((a, b) => Date.parse(b.generatedAt ?? "") - Date.parse(a.generatedAt ?? ""))[0];
  return newestPassed?.receiptPath
    ? readFreshRoomProofReceipt(newestPassed.receiptPath) ?? readFreshRoomProofReceipt(freshRoomProofPath(caseId))
    : readFreshRoomProofReceipt(freshRoomProofPath(caseId));
}

function mark(ok: boolean): string {
  return ok ? "[x]" : "[ ]";
}

function visualJudgeMark(proof: FreshRoomProofReceipt): string {
  if (proof.visualJudge?.verdict === "pass") return "[x]";
  if (proof.visualJudge?.verdict === "fail") return "[!]";
  return "[-]";
}

function readBtbLedgerSummary(): {
  selectedTaskCount: number;
  provenTaskCount: number;
  failedReceiptCount: number;
  missingReceiptCount: number;
  fullBenchmarkClaim: string;
} | null {
  const parsed = readBtbLedger();
  if (!parsed) return null;
  if (
    typeof parsed.selectedTaskCount !== "number"
    || typeof parsed.provenTaskCount !== "number"
    || typeof parsed.failedReceiptCount !== "number"
    || typeof parsed.missingReceiptCount !== "number"
    || typeof parsed.fullBenchmarkClaim !== "string"
  ) return null;
  return {
    selectedTaskCount: parsed.selectedTaskCount,
    provenTaskCount: parsed.provenTaskCount,
    failedReceiptCount: parsed.failedReceiptCount,
    missingReceiptCount: parsed.missingReceiptCount,
    fullBenchmarkClaim: parsed.fullBenchmarkClaim,
  };
}

function readBtbLedger(): Partial<{
  selectedTaskCount: number;
  provenTaskCount: number;
  failedReceiptCount: number;
  missingReceiptCount: number;
  fullBenchmarkClaim: string;
  rows: Array<{
    receiptPath?: string;
    generatedAt?: string;
    passed?: boolean;
  }>;
}> | null {
  const text = readTextIfExists("docs/eval/fresh-room/FR-020/matrix-ledger.json");
  if (!text) return null;
  try {
    return JSON.parse(text) as Partial<{
      selectedTaskCount: number;
      provenTaskCount: number;
      failedReceiptCount: number;
      missingReceiptCount: number;
      fullBenchmarkClaim: string;
      rows: Array<{
        receiptPath?: string;
        generatedAt?: string;
        passed?: boolean;
      }>;
    }>;
  } catch {
    return null;
  }
}

function frame(title: string, lines: string[]): string {
  const width = Math.max(78, title.length + 4, ...lines.map((line) => line.length + 4));
  const bar = "+-" + "-".repeat(width - 4) + "-+";
  const titleLine = `| ${title.padEnd(width - 4)} |`;
  const body = lines.map((line) => `| ${line.padEnd(width - 4)} |`);
  return [bar, titleLine, bar, ...body, bar].join("\n");
}

function statusLabel(status: string): string {
  if (status === "completed") return "DONE   ";
  if (status === "running") return "RUNNING";
  if (status === "blocked") return "BLOCKED";
  if (status === "failed") return "FAILED ";
  return "PENDING";
}

function receiptSummary(milestone: RalphMilestone, state: SoloLoopRun): string {
  const row = state.milestones[milestone];
  return `${row.receipts.length}/${SOLO_MILESTONE_CONTRACTS[milestone].exitReceipts.length} receipts`;
}

function shortId(value: string): string {
  return value.replace(/^loop_/, "").slice(0, 8);
}

function money(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "$0.0000";
}

export function readTextIfExists(path: string): string | null {
  const absolute = resolve(path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}
