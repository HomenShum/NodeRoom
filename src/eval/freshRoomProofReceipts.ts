import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
    requested?: string;
    resolved?: string;
    routePolicy?: string;
    runtimeProfile?: string;
    provider?: string;
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
  return nonEmptyString(path) && existsSync(resolve(process.cwd(), path.replace(/\\/g, "/")));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
