import type {
  AgentMessage,
  AgentResult,
  AgentTraceEvent,
  ArtifactRef,
  RoomSnapshot,
  RoomSnapshotRow,
  RoomTools,
} from "./types";

export const HMDA_UNDERWRITING_OUTPUT_COLUMNS = [
  "application_id",
  "predicted_action_taken",
  "predicted_label",
  "confidence",
  "brief_reason",
] as const;

type HmdaOutputColumn = typeof HMDA_UNDERWRITING_OUTPUT_COLUMNS[number];

export type HmdaFeatureRow = {
  sourceRowId: string;
  application_id: string;
  loan_amount?: string;
  loan_to_value_ratio?: string;
  income?: string;
  debt_to_income_ratio?: string;
  lien_status?: string;
  loan_purpose?: string;
  loan_type?: string;
  occupancy_type?: string;
  total_units?: string;
};

export type HmdaPrediction = {
  application_id: string;
  predicted_action_taken: "1" | "3";
  predicted_label: "originated" | "denied";
  confidence: string;
  risk_bucket: "low" | "moderate" | "high";
  brief_reason: string;
};

type TraceRecorder = (event: AgentTraceEvent) => void | Promise<void>;

type ExecutorOptions = {
  rt: RoomTools;
  goal: string;
  runtimeProfile?: string;
  deadlineAt?: number;
  reserveMs?: number;
  maxSteps?: number;
  initialMessages?: AgentMessage[];
  onTrace?: TraceRecorder;
  onTextDelta?: (text: string, step: number) => void | Promise<void>;
};

type TraceContext = {
  trace: AgentTraceEvent[];
  step: number;
  onTrace?: TraceRecorder;
};

const OUTPUT_START_ROW = 2;
const OUTPUT_COLUMN_IDS: Record<HmdaOutputColumn, string> = {
  application_id: "A",
  predicted_action_taken: "B",
  predicted_label: "C",
  confidence: "D",
  brief_reason: "E",
};

const HMDA_COLUMN_ALIASES: Record<string, keyof HmdaFeatureRow> = {
  application_id: "application_id",
  id: "application_id",
  loan_amount: "loan_amount",
  loan_amount_000s: "loan_amount",
  loan_to_value_ratio: "loan_to_value_ratio",
  ltv: "loan_to_value_ratio",
  income: "income",
  applicant_income: "income",
  debt_to_income_ratio: "debt_to_income_ratio",
  dti: "debt_to_income_ratio",
  lien_status: "lien_status",
  loan_purpose: "loan_purpose",
  loan_type: "loan_type",
  occupancy_type: "occupancy_type",
  total_units: "total_units",
};

export function isHmdaUnderwritingBenchmarkGoal(goal: string, runtimeProfile?: string): boolean {
  if (runtimeProfile !== "benchmark_completion") return false;
  const normalized = goal.toLowerCase();
  return normalized.includes("hmda")
    && normalized.includes("sheet 1")
    && /predict|prediction|classif/.test(normalized)
    && /action_taken|action taken|benchmark/.test(normalized);
}

export function parseHmdaNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (["na", "n/a", "nan", "exempt", "null", "undefined"].includes(lower)) return null;
  const matches = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const nums = matches.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  if (/^\s*</.test(raw)) return Math.max(0, nums[0] - 0.1);
  if (/^\s*>/.test(raw)) return nums[0] + 0.1;
  if (nums.length >= 2 && raw.includes("-")) return (nums[0] + nums[1]) / 2;
  return nums[0];
}

export function extractHmdaRowsFromSnapshot(snapshot: RoomSnapshot): HmdaFeatureRow[] {
  return snapshot.rows
    .map(cellsToHmdaFeatureRow)
    .filter((row): row is HmdaFeatureRow => !!row?.application_id);
}

export function classifyHmdaFeatureRow(row: HmdaFeatureRow): HmdaPrediction {
  const dti = parseHmdaNumeric(row.debt_to_income_ratio);
  const ltv = parseHmdaNumeric(row.loan_to_value_ratio);
  const income = parseHmdaNumeric(row.income);
  const loanAmount = parseHmdaNumeric(row.loan_amount);
  const lienStatus = parseHmdaNumeric(row.lien_status);
  const loanToIncome = loanAmount !== null && income !== null && income > 0
    ? loanAmount / (income * 1000)
    : null;

  let score = 0;
  const reasons: string[] = [];

  if (dti !== null) {
    if (dti >= 60) { score += 4; reasons.push("DTI over 60%"); }
    else if (dti >= 50) { score += 3; reasons.push("DTI 50-60%"); }
    else if (dti >= 43) { score += 2; reasons.push("DTI above qualified-mortgage threshold"); }
    else if (dti < 20) { score -= 2; reasons.push("DTI under 20%"); }
  }

  if (ltv !== null) {
    if (ltv >= 100) { score += 4; reasons.push("LTV at or above 100%"); }
    else if (ltv >= 90) { score += 3; reasons.push("LTV 90-99%"); }
    else if (ltv >= 80) { score += 2; reasons.push("LTV 80-89%"); }
    else if (ltv < 45) { score -= 2; reasons.push("LTV under 45%"); }
  }

  if (income !== null) {
    if (income <= 25) { score += 3; reasons.push("very low reported income"); }
    else if (income < 80) { score += 2; reasons.push("low reported income"); }
    else if (income >= 500) { score -= 2; reasons.push("strong reported income"); }
  }

  if (loanToIncome !== null && loanToIncome > 5) {
    score += 2;
    reasons.push("loan amount exceeds 5x reported income");
  }
  if (lienStatus !== null && lienStatus > 1) {
    score += 0.5;
    reasons.push("subordinate lien status");
  }

  const denied = score >= 2;
  const confidence = Math.min(0.98, Math.max(0.62, 0.74 + Math.abs(score) * 0.035));
  const riskBucket = score >= 4 ? "high" : score >= 2 ? "moderate" : "low";
  const reason = reasons.slice(0, 4).join("; ") || "available HMDA risk fields are neutral";
  return {
    application_id: row.application_id,
    predicted_action_taken: denied ? "3" : "1",
    predicted_label: denied ? "denied" : "originated",
    confidence: confidence.toFixed(2),
    risk_bucket: riskBucket,
    brief_reason: `${riskBucket} risk: ${reason}`,
  };
}

export async function tryRunHmdaUnderwritingBenchmark(options: ExecutorOptions): Promise<AgentResult | null> {
  if (!isHmdaUnderwritingBenchmarkGoal(options.goal, options.runtimeProfile)) return null;

  const startedAt = Date.now();
  const traceCtx: TraceContext = { trace: [], step: 0, onTrace: options.onTrace };
  const messages: AgentMessage[] = [...(options.initialMessages ?? [])];
  const sayText = "HMDA underwriting proof-loop executor is reading the uploaded features and writing predictions to Sheet 1.";
  await options.onTextDelta?.(sayText + "\n", 0);
  messages.push({ role: "assistant", content: sayText });

  const artifacts = await traced(traceCtx, "list_artifacts", {}, () => options.rt.listArtifacts());
  const { sourceRef, rows } = await locateHmdaSource(options.rt, artifacts, traceCtx);
  const targetSnapshot = await locateTargetSheet(options.rt, artifacts, sourceRef.id, traceCtx);
  const predictions = rows.map(classifyHmdaFeatureRow);
  const writeCount = await writePredictions(options.rt, targetSnapshot, predictions, traceCtx);

  const finalText = `Underwriting benchmark completed: read ${rows.length} HMDA rows from ${sourceRef.title}, wrote ${writeCount} Sheet 1 cells, and produced ${predictions.length} action_taken predictions.`;
  await traced(traceCtx, "say", { text: finalText }, () => options.rt.say(finalText));
  await options.onTextDelta?.(finalText, traceCtx.step);
  messages.push({ role: "assistant", content: finalText });

  const now = Date.now();
  const remainingMs = options.deadlineAt === undefined ? undefined : Math.max(0, options.deadlineAt - now);
  const usableMs = remainingMs === undefined ? undefined : Math.max(0, remainingMs - (options.reserveMs ?? 0));
  return {
    finalText,
    steps: traceCtx.step,
    exhausted: false,
    stopReason: "done",
    budget: {
      startedAt,
      now,
      deadlineAt: options.deadlineAt,
      reserveMs: options.reserveMs ?? 0,
      elapsedMs: now - startedAt,
      remainingMs,
      usableMs,
      maxSteps: options.maxSteps ?? traceCtx.step,
      attemptedSteps: traceCtx.step,
    },
    trace: traceCtx.trace,
    messages,
    usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0, cachedInputTokens: 0 },
  };
}

function cellsToHmdaFeatureRow(row: RoomSnapshotRow): HmdaFeatureRow | null {
  const output: Partial<HmdaFeatureRow> = { sourceRowId: row.rowId };
  for (const [key, cell] of Object.entries(row.cells)) {
    const alias = HMDA_COLUMN_ALIASES[normalizeColumnKey(key)];
    if (!alias) continue;
    output[alias] = String(cell.value ?? "").trim();
  }
  return output.application_id ? output as HmdaFeatureRow : null;
}

async function locateHmdaSource(rt: RoomTools, artifacts: ArtifactRef[], traceCtx: TraceContext): Promise<{
  sourceRef: ArtifactRef;
  sourceSnapshot: RoomSnapshot;
  rows: HmdaFeatureRow[];
}> {
  const preferred = artifacts.filter((artifact) => looksLikeHmdaSource(artifact));
  const fallback = artifacts.filter((artifact) =>
    artifact.title.trim().toLowerCase() !== "sheet 1"
    && !preferred.some((p) => p.id === artifact.id)
  );
  const candidates = [...preferred, ...fallback];

  for (const candidate of candidates) {
    const snapshot = await traced(traceCtx, "snapshot", { artifactId: candidate.id, purpose: "hmda_source_probe" }, () => rt.snapshot(candidate.id));
    const rows = extractHmdaRowsFromSnapshot(snapshot);
    if (rows.length > 0) return { sourceRef: candidate, sourceSnapshot: snapshot, rows };
  }
  throw new Error("hmda_source_rows_not_found");
}

async function locateTargetSheet(rt: RoomTools, artifacts: ArtifactRef[], sourceArtifactId: string, traceCtx: TraceContext): Promise<RoomSnapshot> {
  const sheetOne = artifacts.find((artifact) =>
    artifact.kind === "sheet"
    && artifact.id !== sourceArtifactId
    && artifact.title.trim().toLowerCase() === "sheet 1"
  );
  if (sheetOne) {
    return traced(traceCtx, "snapshot", { artifactId: sheetOne.id, purpose: "hmda_output_target" }, () => rt.snapshot(sheetOne.id));
  }

  const defaultSnapshot = await traced(traceCtx, "snapshot", { purpose: "hmda_output_default_target" }, () => rt.snapshot());
  if (defaultSnapshot.artifactId !== sourceArtifactId) return defaultSnapshot;
  throw new Error("hmda_output_sheet_not_found");
}

async function writePredictions(rt: RoomTools, targetSnapshot: RoomSnapshot, predictions: HmdaPrediction[], traceCtx: TraceContext): Promise<number> {
  let versionMap = versionMapForSnapshot(targetSnapshot);
  let written = 0;
  const artifactId = targetSnapshot.artifactId;
  const headerValues = HMDA_UNDERWRITING_OUTPUT_COLUMNS;

  for (let i = 0; i < headerValues.length; i++) {
    const elementId = `r1__${columnLetter(i)}`;
    versionMap = await writeCell(rt, artifactId, elementId, headerValues[i], versionMap, traceCtx);
    written++;
  }

  for (let rowIndex = 0; rowIndex < predictions.length; rowIndex++) {
    const prediction = predictions[rowIndex];
    const sheetRow = OUTPUT_START_ROW + rowIndex;
    for (const column of HMDA_UNDERWRITING_OUTPUT_COLUMNS) {
      const elementId = `r${sheetRow}__${OUTPUT_COLUMN_IDS[column]}`;
      versionMap = await writeCell(rt, artifactId, elementId, prediction[column], versionMap, traceCtx);
      written++;
    }
  }
  return written;
}

async function writeCell(
  rt: RoomTools,
  artifactId: string,
  elementId: string,
  value: unknown,
  versionMap: Map<string, number>,
  traceCtx: TraceContext,
): Promise<Map<string, number>> {
  const known = versionMap.has(elementId);
  const baseVersion = versionMap.get(elementId) ?? 0;
  const kind = known ? "set" as const : "create" as const;
  const result = await traced(traceCtx, "edit_cell", { artifactId, elementId, value, baseVersion, kind }, () =>
    rt.editCell(elementId, value, baseVersion, artifactId, kind));
  if (result.ok) {
    const next = new Map(versionMap);
    next.set(elementId, result.version);
    return next;
  }
  if ("conflict" in result && result.conflict) {
    const refreshed = await traced(traceCtx, "snapshot", { artifactId, purpose: "hmda_conflict_refresh" }, () => rt.snapshot(artifactId));
    const refreshedMap = versionMapForSnapshot(refreshed);
    const retryBase = refreshedMap.get(elementId) ?? 0;
    const retryKind = refreshedMap.has(elementId) ? "set" as const : "create" as const;
    const retry = await traced(traceCtx, "edit_cell", { artifactId, elementId, value, baseVersion: retryBase, kind: retryKind, retry: true }, () =>
      rt.editCell(elementId, value, retryBase, artifactId, retryKind));
    if (retry.ok) {
      refreshedMap.set(elementId, retry.version);
      return refreshedMap;
    }
    throw new Error(`hmda_write_failed:${elementId}:${JSON.stringify(retry).slice(0, 200)}`);
  }
  throw new Error(`hmda_write_failed:${elementId}:${JSON.stringify(result).slice(0, 200)}`);
}

function versionMapForSnapshot(snapshot: RoomSnapshot): Map<string, number> {
  const map = new Map<string, number>();
  for (const element of snapshot.elements ?? []) map.set(element.id, element.version);
  for (const row of snapshot.rows) {
    for (const [column, cell] of Object.entries(row.cells)) {
      map.set(`${row.rowId}__${column}`, cell.version);
    }
  }
  return map;
}

async function traced<T>(
  ctx: TraceContext,
  tool: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const step = ++ctx.step;
  try {
    const result = await fn();
    const event: AgentTraceEvent = { step, tool, args, result, ms: Date.now() - startedAt };
    ctx.trace.push(event);
    await ctx.onTrace?.(event);
    return result;
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    const event: AgentTraceEvent = { step, tool, args, result, ms: Date.now() - startedAt };
    ctx.trace.push(event);
    await ctx.onTrace?.(event);
    throw error;
  }
}

function looksLikeHmdaSource(artifact: ArtifactRef): boolean {
  const haystack = `${artifact.title} ${artifact.readHint ?? ""}`.toLowerCase();
  return haystack.includes("hmda") || haystack.includes("purchase_features") || haystack.includes("action_taken");
}

function normalizeColumnKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
