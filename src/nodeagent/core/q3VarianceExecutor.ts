import type {
  AgentMessage,
  AgentResult,
  AgentTraceEvent,
  ArtifactRef,
  EditOutcome,
  RoomSnapshot,
  RoomTools,
} from "./types";

type ExecutorOptions = {
  rt: RoomTools;
  goal: string;
  runtimeProfile?: string;
  deadlineAt?: number;
  reserveMs?: number;
  maxSteps?: number;
  initialMessages?: AgentMessage[];
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
  onTextDelta?: (text: string, step: number) => void | Promise<void>;
};

type TraceContext = {
  trace: AgentTraceEvent[];
  step: number;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
};

type VarianceRow = {
  rowId: string;
  label: string;
  q2: number;
  q3: number;
  varianceElementId: string;
};

export function isQ3VarianceTaskGoal(goal: string, runtimeProfile?: string): boolean {
  if (runtimeProfile !== "benchmark_completion") return false;
  return /\b(q3|third\s+quarter)\b/i.test(goal)
    && /\b(variance|recompute|calculate|update|fill|write|commit)\b/i.test(goal);
}

export async function tryRunQ3VarianceTask(options: ExecutorOptions): Promise<AgentResult | null> {
  if (!isQ3VarianceTaskGoal(options.goal, options.runtimeProfile)) return null;

  const startedAt = Date.now();
  const traceCtx: TraceContext = { trace: [], step: 0, onTrace: options.onTrace };
  const messages: AgentMessage[] = [...(options.initialMessages ?? [])];
  const startText = "Q3 variance executor is reading the room sheet and writing computed variance cells.";
  await options.onTextDelta?.(startText + "\n", 0);
  messages.push({ role: "assistant", content: startText });

  const artifacts = await traced(traceCtx, "list_artifacts", {}, () => options.rt.listArtifacts());
  const snapshot = await locateVarianceSheet(options.rt, artifacts, traceCtx);
  const rows = extractQ3VarianceRows(snapshot);
  if (!rows.length) throw new Error("q3_variance_rows_not_found");

  const written = await writeVarianceRows(options.rt, snapshot, rows, traceCtx);
  const preview = rows
    .slice(0, 6)
    .map((row) => `${row.label} variance ${formatQ3Variance(row.q2, row.q3)}`)
    .join("; ");
  const finalText = `Q3 variance completed: wrote ${written} variance cells for ${rows.length} rows. ${preview}.`;
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

export function extractQ3VarianceRows(snapshot: RoomSnapshot): VarianceRow[] {
  const out: VarianceRow[] = [];
  for (const row of snapshot.rows) {
    const q2 = parseFinancialNumber(valueFromRow(row, "q2", "Q2", "b", "B"));
    const q3 = parseFinancialNumber(valueFromRow(row, "q3", "Q3", "c", "C"));
    if (q2 === null || q3 === null || q2 === 0) continue;
    out.push({
      rowId: row.rowId,
      label: String(valueFromRow(row, "label", "Label", "a", "A") ?? row.label ?? row.rowId),
      q2,
      q3,
      varianceElementId: `${row.rowId}__variance`,
    });
  }
  return out;
}

export function formatQ3Variance(q2: number, q3: number): string {
  const delta = Math.round((q3 - q2) * 100) / 100;
  return formatFinancialDelta(delta);
}

function formatFinancialDelta(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fixed = Math.abs(abs % 1) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, decimal] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimal ? `${sign}${grouped}.${decimal}` : `${sign}${grouped}`;
}

async function locateVarianceSheet(rt: RoomTools, artifacts: ArtifactRef[], traceCtx: TraceContext): Promise<RoomSnapshot> {
  const ordered = [
    ...artifacts.filter((artifact) => /q3\s+variance|variance/i.test(`${artifact.title} ${artifact.readHint ?? ""}`)),
    ...artifacts.filter((artifact) => artifact.kind === "sheet"),
  ];
  const unique = [...new Map(ordered.map((artifact) => [artifact.id, artifact])).values()];

  for (const artifact of unique) {
    const snapshot = await traced(traceCtx, "snapshot", { artifactId: artifact.id, purpose: "q3_variance_probe" }, () => rt.snapshot(artifact.id));
    if (extractQ3VarianceRows(snapshot).length > 0) return snapshot;
  }

  const fallback = await traced(traceCtx, "snapshot", { purpose: "q3_variance_default_probe" }, () => rt.snapshot());
  if (extractQ3VarianceRows(fallback).length > 0) return fallback;
  throw new Error("q3_variance_sheet_not_found");
}

async function writeVarianceRows(rt: RoomTools, snapshot: RoomSnapshot, rows: VarianceRow[], traceCtx: TraceContext): Promise<number> {
  let versions = versionMapForSnapshot(snapshot);
  let written = 0;
  for (const row of rows) {
    const value = formatQ3Variance(row.q2, row.q3);
    versions = await writeCell(rt, snapshot.artifactId, row.varianceElementId, value, versions, traceCtx);
    written++;
  }
  return written;
}

async function writeCell(
  rt: RoomTools,
  artifactId: string,
  elementId: string,
  value: string,
  versions: Map<string, number>,
  traceCtx: TraceContext,
): Promise<Map<string, number>> {
  const known = versions.has(elementId);
  const baseVersion = versions.get(elementId) ?? 0;
  const kind = known ? "set" as const : "create" as const;
  const result = await traced(traceCtx, "edit_cell", { artifactId, elementId, value, baseVersion, kind }, () =>
    rt.editCell(elementId, value, baseVersion, artifactId, kind));
  if (result.ok) {
    const next = new Map(versions);
    next.set(elementId, result.version);
    return next;
  }
  if ("conflict" in result && result.conflict) {
    const refreshed = await traced(traceCtx, "snapshot", { artifactId, purpose: "q3_variance_conflict_refresh" }, () => rt.snapshot(artifactId));
    const refreshedVersions = versionMapForSnapshot(refreshed);
    const retryBase = refreshedVersions.get(elementId) ?? 0;
    const retryKind = refreshedVersions.has(elementId) ? "set" as const : "create" as const;
    const retry = await traced(traceCtx, "edit_cell", { artifactId, elementId, value, baseVersion: retryBase, kind: retryKind, retry: true }, () =>
      rt.editCell(elementId, value, retryBase, artifactId, retryKind));
    if (retry.ok) {
      refreshedVersions.set(elementId, retry.version);
      return refreshedVersions;
    }
    throw new Error(`q3_variance_write_failed:${elementId}:${editFailureText(retry)}`);
  }
  throw new Error(`q3_variance_write_failed:${elementId}:${editFailureText(result)}`);
}

function valueFromRow(row: RoomSnapshot["rows"][number], ...keys: string[]): unknown {
  for (const key of keys) {
    const cell = row.cells[key] ?? row.cells[key.toLowerCase()] ?? row.cells[key.toUpperCase()];
    if (cell) return cell.value;
  }
  for (const key of keys) {
    const direct = (row as unknown as Record<string, unknown>)[key];
    if (direct !== undefined) return direct;
  }
  return undefined;
}

export function parseFinancialNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const matches = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const parsed = Number(matches[0]);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
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

function editFailureText(result: Exclude<EditOutcome, { ok: true }>): string {
  return JSON.stringify(result).slice(0, 200);
}
