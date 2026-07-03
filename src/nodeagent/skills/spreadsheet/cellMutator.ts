/**
 * The agent's tools. Each is `{ name, description, schema (zod), execute }`.
 * `execute` does NOT touch the database directly — it calls a RoomTools method,
 * which in production is a Convex mutation/query. So the tool layer is pure +
 * portable; the backend is swappable. The descriptions encode the protocol
 * (claim → CAS → release / draft-when-locked) so the model uses them correctly.
 *
 * The critical contract: edit_cell returns a conflict as a normal result value,
 * which the runtime feeds back to the model as a tool message — turning a race
 * into a re-read-and-retry instead of a clobber.
 */

import { z } from "zod";
import type { AgentTool, EditOutcome, RoomTools } from "../../core/types";
import type { CellEvidence, CellPayload, CellStatus } from "../../../engine/types";
import { runAlgorithmArtifactFromRoomTools, type AlgorithmArtifact } from "./algorithmArtifacts";
import { BANKER_COACH_TOOLS } from "../bankerCoach/tools";
import { OKF_RETRIEVAL_TOOLS } from "../../retrieval/tools";
import { retrieveUntilSufficient } from "../../retrieval/retrievalLoop";
import { NOTEBOOK_TOOLS } from "../notebook/notebookTools";

/**
 * Tolerant array for cheap/quantized models that emit a single object instead of a one-element
 * array, or a JSON-encoded string, when calling a batch tool. Coerces both to a proper array
 * before validation so a slightly-malformed batch call succeeds instead of looping. Batch stays
 * first-class and the single-cell tools are unaffected — this only widens what a batch call accepts.
 */
function tolerantArray<T extends z.ZodTypeAny>(item: T, opts: { min?: number; singleString?: boolean } = {}) {
  const base = opts.min != null ? z.array(item).min(opts.min) : z.array(item);
  return z.preprocess((v) => {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        if (opts.singleString) return [v];
      }
    }
    if (v != null && !Array.isArray(v) && typeof v === "object") return [v];
    return v;
  }, base);
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function arrayish(value: unknown): unknown[] {
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) return parsed;
  return parsed === undefined || parsed === null ? [] : [parsed];
}

function firstDefined(record: RawManagedOp, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function firstString(record: RawManagedOp, keys: string[]): string | undefined {
  const value = firstDefined(record, keys);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type ParallelField = {
  opKey: string;
  inputKeys: string[];
};

type ScalarWriteKind = "set" | "create" | "delete";
type ResultWriteKind = "set" | "create";
type RawManagedOp = Record<string, unknown>;
type ScalarManagedOp = { elementId: string; value: unknown; baseVersion?: number; kind?: ScalarWriteKind };
type ScalarManagedOpWithVersion = { elementId: string; value: unknown; baseVersion: number; kind?: ScalarWriteKind };
type ResultManagedOp = ScalarManagedOp & {
  status: CellStatus;
  confidence?: number;
  normalizedValue?: unknown;
  formula?: string;
  error?: string;
  evidence: CellEvidence[];
  kind?: ResultWriteKind;
};

function normalizeParallelBatchCall(value: unknown, fields: ParallelField[] = []) {
  const parsed = parseJsonish(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const record = { ...(parsed as Record<string, unknown>) };
  if (record.ops !== undefined) return record;

  const elementIds = arrayish(record.elementIds ?? record.cellIds ?? record.ids ?? record.targets ?? record.targetCells ?? record.elementId ?? record.cellId ?? record.id ?? record.cell ?? record.targetCell ?? record.target);
  const values = arrayish(record.values ?? record.newValues ?? record.results ?? record.value ?? record.newValue ?? record.new_value ?? record.result ?? record.text ?? record.content ?? record.expectedValue);
  const baseVersions = arrayish(record.baseVersions ?? record.base_versions ?? record.baseVersion ?? record.base_version ?? record.currentVersions ?? record.currentVersion ?? record.versions ?? record.version);
  if (!elementIds.length || values.length !== elementIds.length) return record;
  if (baseVersions.length && baseVersions.length !== 1 && baseVersions.length !== elementIds.length) return record;

  const kinds = arrayish(record.kinds ?? record.kind);
  record.ops = elementIds.map((elementId, idx) => {
    const op: Record<string, unknown> = {
      elementId,
      value: values[idx],
    };
    if (baseVersions.length) op.baseVersion = baseVersions.length === 1 ? baseVersions[0] : baseVersions[idx];
    if (kinds.length === 1 || kinds.length === elementIds.length) op.kind = kinds.length === 1 ? kinds[0] : kinds[idx];
    for (const field of fields) {
      const raw = field.inputKeys.map((key) => record[key]).find((candidate) => candidate !== undefined);
      if (raw === undefined) continue;
      const entries = arrayish(raw);
      if (entries.length === 1) op[field.opKey] = entries[0];
      else if (entries.length === elementIds.length) op[field.opKey] = entries[idx];
      else op[field.opKey] = raw;
    }
    return op;
  });
  return record;
}

function numericVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function normalizeRawOp(value: unknown): RawManagedOp {
  const parsed = parseJsonish(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as RawManagedOp) } : {};
}

function normalizeScalarOp(value: unknown): ScalarManagedOp {
  const op = normalizeRawOp(value);
  const elementId = firstString(op, ["elementId", "cellId", "id", "cell", "cellKey", "targetCell", "target", "targetId", "element_id", "cell_id"]);
  const nextValue = firstDefined(op, ["value", "newValue", "new_value", "result", "text", "content", "expectedValue", "expected_value"]);
  if (typeof elementId !== "string" || !elementId.trim()) throw new Error("managed_write_missing_elementId");
  const kind = op.kind === "create" || op.kind === "delete" || op.kind === "set" ? op.kind : undefined;
  if (nextValue === undefined && kind !== "delete") throw new Error("managed_write_missing_value");
  return {
    ...op,
    elementId,
    value: nextValue,
    baseVersion: numericVersion(firstDefined(op, ["baseVersion", "base_version", "currentVersion", "current_version", "version"])),
    kind,
  } as ScalarManagedOp;
}

function addScalarOpIssues(value: unknown, ctx: z.RefinementCtx) {
  try {
    normalizeScalarOp(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: message.includes("value") ? ["value"] : ["elementId"],
      message,
    });
  }
}

function normalizeBatchArgs(value: unknown, fields: ParallelField[] = []) {
  const parallel = normalizeParallelBatchCall(value, fields);
  const record = parallel && typeof parallel === "object" && !Array.isArray(parallel)
    ? parallel as Record<string, unknown>
    : {};
  const rawOps = record.ops ?? record.cells;
  return {
    reason: typeof record.reason === "string" ? record.reason : undefined,
    artifactId: typeof record.artifactId === "string" ? record.artifactId : undefined,
    ops: arrayish(rawOps).map(normalizeScalarOp),
  };
}

function hasNormalizableBatchOps(value: unknown, fields: ParallelField[] = []) {
  try {
    return normalizeBatchArgs(value, fields).ops.length > 0;
  } catch {
    return false;
  }
}

const opSchema = z.object({ elementId: z.string(), value: z.any(), baseVersion: z.coerce.number().int() });
const cellStatusSchema = z.enum(["empty", "running", "complete", "needs_review", "failed", "gap"]);
const evidenceSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["upload", "source", "computed", "manual"]),
  label: z.string(),
  source: z.string().optional(),
  sourceStorageId: z.string().optional(),
  sourceArtifactId: z.string().optional(),
  providerFileId: z.string().optional(),
  sheetName: z.string().optional(),
  row: z.number().optional(),
  column: z.string().optional(),
  page: z.number().int().positive().optional(),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    unit: z.enum(["px", "pt", "normalized"]).optional(),
  }).optional(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

function cellPayload(args: {
  elementId: string;
  value: unknown;
  status: CellStatus;
  evidence: CellEvidence[];
  confidence?: number;
  error?: string;
  normalizedValue?: unknown;
  formula?: string;
  review?: CellPayload["review"];
}): CellPayload {
  return {
    value: args.value,
    status: args.status,
    confidence: args.confidence,
    error: args.error,
    normalizedValue: args.normalizedValue,
    formula: args.formula,
    review: args.review,
    evidence: args.evidence.map((e, idx) => ({
      ...e,
      id: e.id || `${e.kind}:${args.elementId}:${idx + 1}`,
    })),
  };
}

function compactClaimValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function shouldCheckOkfEvidence(args: { status: CellStatus; evidence: CellEvidence[] }): boolean {
  if (args.status !== "complete") return false;
  return args.evidence.some((e) => e.kind === "source" || e.kind === "upload");
}

async function reviewedCellPayload(args: {
  elementId: string;
  value: unknown;
  status: CellStatus;
  evidence: CellEvidence[];
  confidence?: number;
  error?: string;
  normalizedValue?: unknown;
  formula?: string;
}, rt: RoomTools): Promise<CellPayload> {
  if (!rt.okf || !shouldCheckOkfEvidence(args)) return cellPayload(args);
  const claim = `${args.elementId}: ${compactClaimValue(args.value)}`;
  const query = [
    args.elementId,
    compactClaimValue(args.value),
    ...args.evidence.flatMap((e) => [e.label, e.source, e.url, e.sourceArtifactId, e.snippet]).filter((v): v is string => !!v),
  ].join(" ").slice(0, 900);
  try {
    const packet = await retrieveUntilSufficient({
      retrieval: rt.okf,
      claim,
      query: query || claim,
      clientReadyRequired: true,
    });
    const memo = packet.evidenceMemos[0];
    const status = memo?.recommendedAction === "answer" ? args.status : "needs_review";
    return cellPayload({
      ...args,
      status,
      review: {
        evidenceMemo: memo,
        caveat: packet.caveat,
        source: "okf_evidence_memo",
      },
    });
  } catch (error) {
    return cellPayload({
      ...args,
      status: "needs_review",
      review: {
        caveat: `OKF evidence check unavailable: ${error instanceof Error ? error.message : String(error)}`,
        source: "okf_evidence_memo",
      },
    });
  }
}

type SkippedEditOutcome = { ok: true; skipped: true; reason: "unchanged"; version: number };
type ManagedSingleWriteOutcome =
  | (EditOutcome & { coordination: Record<string, unknown>; drafted?: boolean; draftId?: string })
  | (SkippedEditOutcome & { coordination: Record<string, unknown> });

function stablePayloadKey(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stablePayloadKey).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stablePayloadKey(record[key])}`).join(",")}}`;
}

function payloadsEquivalent(current: unknown, proposed: unknown): boolean {
  return stablePayloadKey(current) === stablePayloadKey(proposed);
}

async function unchangedSetOps(args: {
  ops: ScalarManagedOpWithVersion[];
  artifactId?: string;
}, rt: RoomTools): Promise<{
  activeOps: ScalarManagedOpWithVersion[];
  skipped: Array<SkippedEditOutcome & { elementId: string; baseVersion: number }>;
}> {
  if (typeof rt.readRange !== "function") return { activeOps: args.ops, skipped: [] };
  const comparable = args.ops.filter((op) => (op.kind ?? "set") === "set");
  if (!comparable.length) return { activeOps: args.ops, skipped: [] };
  const cells = await rt.readRange(comparable.map((op) => op.elementId), args.artifactId);
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const skipped: Array<SkippedEditOutcome & { elementId: string; baseVersion: number }> = [];
  const activeOps = args.ops.filter((op) => {
    if ((op.kind ?? "set") !== "set") return true;
    const current = byId.get(op.elementId);
    if (!current || !payloadsEquivalent(current.value, op.value)) return true;
    skipped.push({ ok: true, skipped: true, reason: "unchanged", version: current.version, elementId: op.elementId, baseVersion: op.baseVersion });
    return false;
  });
  return { activeOps, skipped };
}

async function withBaseVersions(ops: ScalarManagedOp[], rt: RoomTools, artifactId?: string): Promise<ScalarManagedOpWithVersion[]> {
  const missing = ops.filter((op) => op.baseVersion === undefined && (op.kind ?? "set") !== "create");
  const current = missing.length && typeof rt.readRange === "function"
    ? await rt.readRange(missing.map((op) => op.elementId), artifactId)
    : [];
  const byId = new Map(current.map((cell) => [cell.id, cell.version]));
  return ops.map((op) => ({
    ...op,
    baseVersion: op.baseVersion ?? ((op.kind ?? "set") === "create" ? 0 : byId.get(op.elementId) ?? 0),
  }));
}

async function writeWithManagedLock(args: {
  elementId: string;
  value: unknown;
  baseVersion?: number;
  reason?: string;
  kind?: "set" | "create" | "delete";
  artifactId?: string;
}, rt: RoomTools): Promise<ManagedSingleWriteOutcome> {
  const [op] = await withBaseVersions([args], rt, args.artifactId);
  const reason = args.reason?.trim() || `write ${args.elementId}`;
  if ((args.kind ?? "set") === "set" && typeof rt.readRange === "function") {
    const [current] = await rt.readRange([args.elementId], args.artifactId);
    if (current && payloadsEquivalent(current.value, args.value)) {
      return {
        ok: true,
        skipped: true,
        reason: "unchanged",
        version: current.version,
        coordination: {
          mode: "managed_lock",
          targetIds: [args.elementId],
          acquired: false,
          skipped: true,
          baseVersion: op.baseVersion,
          currentVersion: current.version,
        },
      };
    }
  }
  const lock = await rt.proposeLock([args.elementId], reason, args.artifactId);
  if (!lock.ok) {
    if (args.kind !== "create" && args.kind !== "delete" && lock.lockId) {
      const draft = await rt.createDraft(
        [{ elementId: args.elementId, value: args.value, baseVersion: op.baseVersion }],
        lock.lockId,
        `Managed-lock draft: ${reason}`,
        args.artifactId,
      );
      return {
        ok: false,
        locked: true,
        holder: lock.reason,
        drafted: true,
        draftId: draft.draftId,
        coordination: {
          mode: "managed_lock",
          targetIds: [args.elementId],
          acquired: false,
          blockingLockId: lock.lockId,
          drafted: true,
        },
      };
    }
    return {
      ok: false,
      locked: true,
      holder: lock.reason,
      coordination: {
        mode: "managed_lock",
        targetIds: [args.elementId],
        acquired: false,
        blockingLockId: lock.lockId,
        drafted: false,
      },
    };
  }

  let edit: EditOutcome | undefined;
  let release: Awaited<ReturnType<RoomTools["releaseLock"]>> | undefined;
  try {
    edit = await rt.editCell(args.elementId, args.value, op.baseVersion, args.artifactId, args.kind);
  } finally {
    release = await rt.releaseLock(lock.lockId);
  }
  return {
    ...(edit ?? { ok: false as const, error: "managed write did not run" }),
    coordination: {
      mode: "managed_lock",
      targetIds: [args.elementId],
      acquired: true,
      lockId: lock.lockId,
      released: release?.ok !== false,
      mergedDrafts: release?.merged?.length ?? 0,
      releaseReason: release?.reason,
    },
  };
}

async function writeBatchWithManagedLock(args: {
  ops: ScalarManagedOp[];
  reason?: string;
  artifactId?: string;
}, rt: RoomTools): Promise<Record<string, unknown>> {
  const ops = await withBaseVersions(args.ops, rt, args.artifactId);
  const preflight = await unchangedSetOps({ ...args, ops }, rt);
  if (!preflight.activeOps.length) {
    const targetIds = args.ops.map((op) => op.elementId);
    return {
      ok: true,
      skipped: true,
      reason: "unchanged",
      results: preflight.skipped,
      coordination: {
        mode: "managed_lock_batch",
        targetIds,
        acquired: false,
        skipped: true,
        skippedCount: preflight.skipped.length,
      },
    };
  }
  const elementIds = preflight.activeOps.map((op) => op.elementId);
  const reason = args.reason?.trim() || `write ${elementIds.length} cell(s)`;
  const lock = await rt.proposeLock(elementIds, reason, args.artifactId);
  if (!lock.ok) {
    const canDraft = preflight.activeOps.every((op) => op.kind !== "create" && op.kind !== "delete") && !!lock.lockId;
    if (canDraft && lock.lockId) {
      const draft = await rt.createDraft(
        preflight.activeOps.map((op) => ({ elementId: op.elementId, value: op.value, baseVersion: op.baseVersion })),
        lock.lockId,
        `Managed-lock batch draft: ${reason}`,
        args.artifactId,
      );
      return {
        ok: false,
        locked: true,
        holder: lock.reason,
        drafted: true,
        draftId: draft.draftId,
        results: [],
        coordination: {
          mode: "managed_lock_batch",
          targetIds: args.ops.map((op) => op.elementId),
          acquired: false,
          blockingLockId: lock.lockId,
          drafted: true,
          skippedCount: preflight.skipped.length,
        },
      };
    }
    return {
      ok: false,
      locked: true,
      holder: lock.reason,
      drafted: false,
      results: [],
      coordination: {
        mode: "managed_lock_batch",
        targetIds: args.ops.map((op) => op.elementId),
        acquired: false,
        blockingLockId: lock.lockId,
        drafted: false,
        skippedCount: preflight.skipped.length,
      },
    };
  }

  const results: Array<(EditOutcome | SkippedEditOutcome) & { elementId: string }> = [...preflight.skipped];
  let release: Awaited<ReturnType<RoomTools["releaseLock"]>> | undefined;
  try {
    for (const op of preflight.activeOps) {
      const edit = await rt.editCell(op.elementId, op.value, op.baseVersion, args.artifactId, op.kind);
      results.push({ ...edit, elementId: op.elementId });
      if (!edit.ok && !("pendingApproval" in edit && edit.pendingApproval)) break;
    }
  } finally {
    release = await rt.releaseLock(lock.lockId);
  }
  const accepted = results.length === args.ops.length && results.every((result) => result.ok || ("pendingApproval" in result && result.pendingApproval));
  return {
    ok: accepted,
    results,
    coordination: {
      mode: "managed_lock_batch",
      targetIds: args.ops.map((op) => op.elementId),
      acquired: true,
      lockId: lock.lockId,
      released: release?.ok !== false,
      mergedDrafts: release?.merged?.length ?? 0,
      releaseReason: release?.reason,
      skippedCount: preflight.skipped.length,
    },
  };
}

const scalarOpInputObject = z.object({
  elementId: z.string().optional(),
  cellId: z.string().optional(),
  id: z.string().optional(),
  cell: z.string().optional(),
  cellKey: z.string().optional(),
  targetCell: z.string().optional(),
  target: z.string().optional(),
  targetId: z.string().optional(),
  element_id: z.string().optional(),
  cell_id: z.string().optional(),
  value: z.any().optional(),
  newValue: z.any().optional(),
  new_value: z.any().optional(),
  result: z.any().optional(),
  text: z.any().optional(),
  content: z.any().optional(),
  expectedValue: z.any().optional(),
  expected_value: z.any().optional(),
  baseVersion: z.coerce.number().int().optional(),
  base_version: z.coerce.number().int().optional(),
  currentVersion: z.coerce.number().int().optional(),
  current_version: z.coerce.number().int().optional(),
  version: z.coerce.number().int().optional(),
  kind: z.enum(["set", "create", "delete"]).optional(),
}).passthrough();

const writeLockedCellInputSchema = scalarOpInputObject.extend({
  reason: z.string().optional().describe("one short phrase shown in the room trace"),
  artifactId: z.string().optional(),
}).superRefine(addScalarOpIssues);

const WRITE_LOCKED_CELL_TOOL: AgentTool = {
  name: "write_locked_cell",
  description: "Production write path for a simple scalar cell. The runtime acquires the exact-cell lock, writes with CAS, releases in finally, and returns coordination evidence. Use this instead of propose_lock/edit_cell/release_lock when it is available.",
  schema: writeLockedCellInputSchema,
  execute: (a: { elementId?: string; cellId?: string; value: unknown; baseVersion?: number; version?: number; reason?: string; kind?: "set" | "create" | "delete"; artifactId?: string }, rt) =>
    writeWithManagedLock({ ...a, ...normalizeScalarOp(a), reason: a.reason, artifactId: a.artifactId }, rt),
};

const scalarOpInputSchema = scalarOpInputObject.superRefine(addScalarOpIssues);

const scalarBatchSchema = z.object({
  reason: z.string().optional().describe("one short phrase shown in the room trace"),
  artifactId: z.string().optional(),
  ops: tolerantArray(scalarOpInputSchema, { min: 1 }).optional(),
  cells: tolerantArray(scalarOpInputSchema, { min: 1 }).optional(),
  elementIds: z.any().optional(),
  cellIds: z.any().optional(),
  ids: z.any().optional(),
  targets: z.any().optional(),
  targetCells: z.any().optional(),
  id: z.any().optional(),
  cell: z.any().optional(),
  targetCell: z.any().optional(),
  target: z.any().optional(),
  values: z.any().optional(),
  newValues: z.any().optional(),
  newValue: z.any().optional(),
  new_value: z.any().optional(),
  results: z.any().optional(),
  result: z.any().optional(),
  text: z.any().optional(),
  content: z.any().optional(),
  expectedValue: z.any().optional(),
  baseVersions: z.any().optional(),
  base_versions: z.any().optional(),
  versions: z.any().optional(),
  base_version: z.any().optional(),
  currentVersions: z.any().optional(),
  currentVersion: z.any().optional(),
  kinds: z.any().optional(),
  kind: z.any().optional(),
}).superRefine((value, ctx) => {
  if (!hasNormalizableBatchOps(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ops"], message: "ops required" });
});

const WRITE_LOCKED_CELLS_TOOL: AgentTool = {
  name: "write_locked_cells",
  description: "Production batch write path for scalar cells. The runtime acquires one exact-range lock, writes every op with CAS, releases in finally, and returns per-cell results plus coordination evidence. Prefer this over separate lock/edit/release calls for multi-cell work.",
  schema: scalarBatchSchema,
  execute: (a: unknown, rt) => writeBatchWithManagedLock(normalizeBatchArgs(a), rt),
};

const WRITE_LOCKED_CELL_RESULT_TOOL: AgentTool = {
  name: "write_locked_cell_result",
  description: "Production write path for ENRICH, CLASSIFY, RESOLVE, CAPTURE, and COMPUTE cells. The runtime acquires/releases the lock around an evidence-bearing CellPayload so the model spends one write call instead of separate lock/edit/release calls.",
  schema: scalarOpInputObject.extend({
    status: cellStatusSchema.default("complete"),
    confidence: z.coerce.number().min(0).max(1).optional(),
    normalizedValue: z.any().optional(),
    formula: z.string().optional(),
    error: z.string().optional(),
    evidence: tolerantArray(evidenceSchema, { min: 1 }),
    reason: z.string().optional().describe("one short phrase shown in the room trace"),
    kind: z.enum(["set", "create"]).optional().describe("'set' updates an existing result cell; 'create' adds a new one"),
    artifactId: z.string().optional(),
  }).superRefine(addScalarOpIssues),
  execute: (a: {
    elementId?: string;
    cellId?: string;
    value: unknown;
    baseVersion?: number;
    version?: number;
    status: CellStatus;
    confidence?: number;
    normalizedValue?: unknown;
    formula?: string;
    error?: string;
    evidence: CellEvidence[];
    reason?: string;
    kind?: "set" | "create";
    artifactId?: string;
  }, rt) => {
    const op = normalizeScalarOp(a);
    const normalized = { ...a, ...op, kind: a.kind };
    return reviewedCellPayload(normalized as ResultManagedOp, rt).then((value) => writeWithManagedLock({ ...normalized, value }, rt));
  },
};

const resultParallelFields: ParallelField[] = [
  { opKey: "status", inputKeys: ["statuses", "status"] },
  { opKey: "confidence", inputKeys: ["confidences", "confidence"] },
  { opKey: "normalizedValue", inputKeys: ["normalizedValues", "normalizedValue"] },
  { opKey: "formula", inputKeys: ["formulas", "formula"] },
  { opKey: "error", inputKeys: ["errors", "error"] },
  { opKey: "evidence", inputKeys: ["evidences", "evidence"] },
];

const resultOpInputSchema = scalarOpInputObject.extend({
  status: cellStatusSchema.default("complete"),
  confidence: z.coerce.number().min(0).max(1).optional(),
  normalizedValue: z.any().optional(),
  formula: z.string().optional(),
  error: z.string().optional(),
  evidence: tolerantArray(evidenceSchema, { min: 1 }),
  kind: z.enum(["set", "create"]).optional(),
}).superRefine(addScalarOpIssues);

const resultBatchSchema = z.object({
  reason: z.string().optional().describe("one short phrase shown in the room trace"),
  artifactId: z.string().optional(),
  ops: tolerantArray(resultOpInputSchema, { min: 1 }).optional(),
  cells: tolerantArray(resultOpInputSchema, { min: 1 }).optional(),
  elementIds: z.any().optional(),
  cellIds: z.any().optional(),
  ids: z.any().optional(),
  targets: z.any().optional(),
  targetCells: z.any().optional(),
  id: z.any().optional(),
  cell: z.any().optional(),
  targetCell: z.any().optional(),
  target: z.any().optional(),
  values: z.any().optional(),
  newValues: z.any().optional(),
  newValue: z.any().optional(),
  new_value: z.any().optional(),
  results: z.any().optional(),
  result: z.any().optional(),
  text: z.any().optional(),
  content: z.any().optional(),
  expectedValue: z.any().optional(),
  baseVersions: z.any().optional(),
  base_versions: z.any().optional(),
  versions: z.any().optional(),
  base_version: z.any().optional(),
  currentVersions: z.any().optional(),
  currentVersion: z.any().optional(),
  statuses: z.any().optional(),
  status: z.any().optional(),
  confidences: z.any().optional(),
  confidence: z.any().optional(),
  normalizedValues: z.any().optional(),
  normalizedValue: z.any().optional(),
  formulas: z.any().optional(),
  formula: z.any().optional(),
  errors: z.any().optional(),
  error: z.any().optional(),
  evidences: z.any().optional(),
  evidence: z.any().optional(),
  kinds: z.any().optional(),
  kind: z.any().optional(),
}).superRefine((value, ctx) => {
  if (!hasNormalizableBatchOps(value, resultParallelFields)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ops"], message: "ops required" });
});

const WRITE_LOCKED_CELL_RESULTS_TOOL: AgentTool = {
  name: "write_locked_cell_results",
  description: "Production batch write path for ENRICH, CLASSIFY, RESOLVE, CAPTURE, and COMPUTE cells. The runtime acquires one exact-range lock around evidence-bearing CellPayload writes, so the model spends one tool call for the range instead of separate lock/write/release calls.",
  schema: resultBatchSchema,
  execute: async (a: unknown, rt) => {
    const normalized = normalizeBatchArgs(a, resultParallelFields);
    const ops = await Promise.all(normalized.ops.map(async (op) => {
      const raw = normalizeRawOp(op);
      const resultOp = {
        ...op,
        status: (raw.status as CellStatus | undefined) ?? "complete",
        confidence: raw.confidence === undefined ? undefined : Number(raw.confidence),
        normalizedValue: raw.normalizedValue,
        formula: typeof raw.formula === "string" ? raw.formula : undefined,
        error: typeof raw.error === "string" ? raw.error : undefined,
        evidence: arrayish(raw.evidence) as CellEvidence[],
        kind: op.kind === "create" ? "create" as const : "set" as const,
      };
      return { ...op, kind: resultOp.kind, value: await reviewedCellPayload(resultOp, rt) };
    }));
    return writeBatchWithManagedLock({ reason: normalized.reason, artifactId: normalized.artifactId, ops }, rt);
  },
};


export const ROOM_TOOLS: AgentTool[] = [
  {
    name: "read_range",
    description: "Read the current value + version of specific cells. Works even on LOCKED cells (locked = read-only, not invisible). Call this before editing, and again after any conflict. Defaults to the primary file ONLY. For uploaded source workbooks or any non-primary file, you MUST pass artifactId from list_artifacts; A1-style ids like A1/B2 without artifactId usually read the blank Sheet 1 and are wrong. If you omit elementIds, the tool returns a bounded artifact sample and instructions instead of dumping the file.",
    schema: z.object({ elementIds: tolerantArray(z.string(), { singleString: true }).optional().default([]).describe("cell ids, e.g. ['r_rev__variance','r_cogs__variance'] or uploaded workbook cells ['A1','B2']; a single id string is accepted and coerced to a one-cell read"), artifactId: z.string().optional().describe("another file's id from list_artifacts; REQUIRED for uploaded source workbooks and other non-primary files") }),
    execute: (a: { elementIds?: string[]; artifactId?: string }, rt) => rt.readRange(a.elementIds ?? [], a.artifactId),
  },
  {
    name: "search_sheet_context",
    description: "Search a spreadsheet's header-prepended semantic cell summaries and structural sub-grid chunks. Use this before reading/editing large uploaded sheets so you find relevant cells without dumping the full grid. For uploaded workbooks, pass artifactId from list_artifacts; otherwise you search only the primary blank Sheet 1. Returns cell hits with elementId/coordinate and chunk hits with elementIds.",
    schema: z.object({
      query: z.string().describe("business terms to search, e.g. 'software API fees cost' or 'ARR metric'"),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: (a: { query: string; artifactId?: string; limit?: number }, rt) => rt.searchSheetContext(a.query, a.artifactId, a.limit),
  },
  {
    name: "propose_lock",
    description: "Claim an affected range: make these cells read-only for everyone else while you edit. Returns { ok:true, lockId } or { ok:false } if already locked (then read + create_draft instead of waiting).",
    schema: z.object({ elementIds: tolerantArray(z.string(), { singleString: true }), reason: z.string().describe("one short phrase, shown to the room"), artifactId: z.string().optional() }),
    execute: (a: { elementIds: string[]; reason: string; artifactId?: string }, rt) => rt.proposeLock(a.elementIds, a.reason, a.artifactId),
  },
  {
    name: "edit_cell",
    description: "Write an element value with optimistic concurrency control. Works on ANY artifact: a spreadsheet cell, a note's `doc` body, or a post-it on a wall. baseVersion MUST be the version you last read for that element. `kind` defaults to \"set\" (update an existing element); pass \"create\" to ADD a new element (e.g. a new post-it — use a fresh elementId and baseVersion 0), or \"delete\" to remove one. Returns { ok:true, version } on success, or { ok:false, conflict:true, actual:N } if it changed since you read it — read_range again and retry with version N. Never ignore a conflict. If the room is in REVIEW MODE, the result is { ok:false, pendingApproval:true, proposalId } — that is SUCCESS (your proposal is filed for the host to approve): do NOT retry that write, move on to the next cell.",
    schema: z.object({ elementId: z.string(), value: z.any(), baseVersion: z.coerce.number().int(), kind: z.enum(["set", "create", "delete"]).optional().describe("'set' (default) updates an existing element; 'create' adds a new one; 'delete' removes one"), artifactId: z.string().optional() }),
    execute: (a: { elementId: string; value: unknown; baseVersion: number; kind?: "set" | "create" | "delete"; artifactId?: string }, rt) => rt.editCell(a.elementId, a.value, a.baseVersion, a.artifactId, a.kind),
  },
  {
    name: "write_cell_result",
    description: "Write an agent-produced dataframe result as { value, status, evidence[], confidence }. Use this for ENRICH, CLASSIFY, RESOLVE, CAPTURE, and COMPUTE cells instead of scalar edit_cell. baseVersion MUST be the version you last read. `kind` defaults to \"set\"; pass \"create\" when adding a new row/cell.",
    schema: z.object({
      elementId: z.string(),
      value: z.any(),
      baseVersion: z.coerce.number().int(),
      status: cellStatusSchema.default("complete"),
      confidence: z.coerce.number().min(0).max(1).optional(),
      normalizedValue: z.any().optional(),
      formula: z.string().optional(),
      error: z.string().optional(),
      evidence: tolerantArray(evidenceSchema, { min: 1 }),
      kind: z.enum(["set", "create"]).optional().describe("'set' updates an existing result cell; 'create' adds a new one"),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
    }),
    execute: (a: {
      elementId: string;
      value: unknown;
      baseVersion: number;
      status: CellStatus;
      confidence?: number;
      normalizedValue?: unknown;
      formula?: string;
      error?: string;
      evidence: CellEvidence[];
      kind?: "set" | "create";
      artifactId?: string;
    }, rt) => reviewedCellPayload(a, rt).then((value) => rt.editCell(a.elementId, value, a.baseVersion, a.artifactId, a.kind)),
  },
  {
    name: "list_artifacts",
    description: "List the files in this room (sheet/note/wiki/wall) with id, title, kind, and read hints. Use this to discover uploaded source workbooks — then pass the chosen id as artifactId to search_sheet_context/read_range/edit_cell/write_cell_result. This is how one run reads one file and writes another; never read uploaded A1-style cells from the primary blank Sheet 1.",
    schema: z.object({}),
    execute: (_a: Record<string, never>, rt) => rt.listArtifacts(),
  },
  {
    name: "update_wiki",
    description: "Update a wiki/note doc with a GROUNDED summary. You MUST cite the artifact ids this summary is derived from (citesArtifactIds — use list_artifacts to find them and read_range to read their cells first). Writes the target note's 'doc' element with a visible Sources footer so the grounding is auditable. CAS: pass the baseVersion you last read for 'doc'; a conflict returns as data (re-read + retry). No ungrounded wiki writes.",
    schema: z.object({
      artifactId: z.string().describe("the wiki/note artifact id from list_artifacts"),
      content: z.string().describe("the markdown/HTML body of the update"),
      citesArtifactIds: z.array(z.string()).min(1).describe("artifact ids this summary is grounded in — REQUIRED, no ungrounded wiki writes"),
      baseVersion: z.coerce.number().int().describe("the version you last read for the 'doc' element"),
      elementId: z.string().optional().describe("the doc element to write; defaults to 'doc'"),
    }),
    execute: (a: { artifactId: string; content: string; citesArtifactIds: string[]; baseVersion: number; elementId?: string }, rt) =>
      writeWithManagedLock({
        elementId: a.elementId ?? "doc",
        value: `${a.content}\n\n<p class="wiki-sources">Sources: ${a.citesArtifactIds.join(", ")}</p>`,
        baseVersion: a.baseVersion,
        artifactId: a.artifactId,
        reason: "grounded wiki update",
      }, rt),
  },
  {
    name: "reconcile_cell",
    description: "Reconcile a cell to an expected value — read it, and write ONLY if it differs. SKIPS already-correct cells (a re-run is a no-op; you never clobber a matching value), corrects wrong ones with CAS. Returns { ok:true, skipped:true } if it already matched, { ok:true, corrected:true, version } if written, or { ok:false, conflict:true } if it changed since baseVersion (re-read + retry). Use for finance reconciliation: derive the expected value (from other cells, or a source file via list_artifacts + read_range), then reconcile each cell against it.",
    schema: z.object({
      elementId: z.string(),
      expectedValue: z.any(),
      baseVersion: z.coerce.number().int().describe("the version you last read for this cell"),
      artifactId: z.string().optional().describe("another file's id from list_artifacts; omit for the primary file"),
    }),
    execute: async (a: { elementId: string; expectedValue: unknown; baseVersion: number; artifactId?: string }, rt) => {
      const [cur] = await rt.readRange([a.elementId], a.artifactId);
      const raw = cur?.value;
      const curScalar = raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>) ? (raw as { value: unknown }).value : raw;
      if (String(curScalar ?? "") === String(a.expectedValue ?? "")) return { ok: true as const, skipped: true as const, version: cur?.version ?? 0 };
      const res = await writeWithManagedLock({
        elementId: a.elementId,
        value: a.expectedValue,
        baseVersion: a.baseVersion,
        artifactId: a.artifactId,
        reason: "reconcile expected value",
      }, rt);
      return res.ok ? { ok: true as const, corrected: true as const, version: res.version } : res;
    },
  },
  {
    name: "run_algorithm_artifact",
    description: "Validate and execute a deterministic spreadsheet calculation artifact against the current room cells. This returns an evidence-bearing patch bundle only; it never commits. After inspection, apply returned patches with write_locked_cell_results so lock/CAS/review policy remains runtime-managed.",
    schema: z.object({
      artifactId: z.string().optional().describe("another sheet artifact id from list_artifacts; omit for the primary sheet"),
      artifact: z.object({
        schema: z.literal(1),
        algorithmId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        kind: z.literal("spreadsheet_formula"),
        language: z.enum(["formula_dsl", "noderoom_dsl"]),
        inputs: z.array(z.object({
          id: z.string(),
          elementId: z.string(),
          label: z.string().optional(),
        })).min(1),
        outputs: z.array(z.object({
          id: z.string(),
          elementId: z.string(),
          expression: z.string(),
          format: z.enum(["number", "currency", "percent"]).optional(),
          label: z.string().optional(),
        })).min(1),
        constraints: z.object({
          deterministic: z.boolean().optional(),
          noNetwork: z.boolean().optional(),
          noRandom: z.boolean().optional(),
          noDateNow: z.boolean().optional(),
          maxInputs: z.number().int().positive().optional(),
          maxOutputs: z.number().int().positive().optional(),
        }).optional(),
        evidencePolicy: z.object({
          requireSourceCells: z.boolean().optional(),
        }).optional(),
        tests: z.array(z.object({
          name: z.string(),
          inputs: z.record(z.string(), z.number()),
          expected: z.record(z.string(), z.number()),
          tolerance: z.number().optional(),
        })).optional(),
      }),
    }),
    execute: (a: { artifactId?: string; artifact: AlgorithmArtifact }, rt) =>
      runAlgorithmArtifactFromRoomTools(a.artifact, rt, a.artifactId),
  },
  {
    name: "create_draft",
    description: "When a range you need is locked by someone else, draft your intended changes here instead of waiting. They smart-merge automatically the moment the blocking lock releases, and can never clobber work committed in the meantime.",
    schema: z.object({ ops: tolerantArray(opSchema), blockedByLockId: z.string(), note: z.string(), artifactId: z.string().optional() }),
    execute: (a: { ops: { elementId: string; value: unknown; baseVersion: number }[]; blockedByLockId: string; note: string; artifactId?: string }, rt) => rt.createDraft(a.ops, a.blockedByLockId, a.note, a.artifactId),
  },
  {
    name: "release_lock",
    description: "Release your lock when finished. Any drafts that were waiting on it are smart-merged at this moment.",
    schema: z.object({ lockId: z.string() }),
    execute: (a: { lockId: string }, rt) => rt.releaseLock(a.lockId),
  },
  {
    name: "say",
    description: "Post one short status line to the room chat (a public agent posts publicly; a private agent posts only to its owner).",
    schema: z.object({ text: z.string() }),
    execute: async (a: { text: string }, rt) => { await rt.say(a.text); return { ok: true }; },
  },
  {
    name: "fetch_source",
    description: "Fetch a real web page for sourced enrichment. Returns { ok:true, title, snippet, url } or { ok:false, error }. Use the returned title/url as the CITATION when you write a researched value — NEVER cite a source you did not fetch.",
    schema: z.object({ url: z.string().describe("an https URL to fetch as evidence") }),
    execute: (a: { url: string }, rt) => rt.fetchSource(a.url),
  },
  // Notebook lane: structured block reads + governed outline appends (both
  // capability-guarded — rooms whose RoomTools lack the port return unsupported).
  ...NOTEBOOK_TOOLS,
];

export const TOOL_NAMES = ROOM_TOOLS.map((t) => t.name);
const SET_ARTIFACT_META_TOOL: AgentTool = {
  name: "set_artifact_meta",
  description: "Title, summarize, and tag a file from its CONTENT so it is findable and never a raw filename. Sets the artifact's topic (title), a one-line summary, and tags. This metadata feeds retrieval (the OKF/RAG embedding), so write a precise human topic (e.g. \"CardioNova Series-C diligence model\") and tags a banker would search. Get artifactId from list_artifacts.",
  schema: z.object({
    artifactId: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  execute: async (a: { artifactId: string; title?: string; summary?: string; tags?: string[] }, rt) =>
    (await rt.setArtifactMeta?.(a)) ?? { ok: false, error: "set_artifact_meta is unsupported in this room" },
};

/**
 * define_columns — the agent governs a sheet's SCHEMA (its columns) per task, CAS-guarded on the
 * artifact version exactly like a cell write. Conflict comes back as a tool RESULT, so the runtime
 * re-reads snapshot() and retries (no new coordination primitive). docs/architecture/AGENT_GOVERNED_COLUMNS.md
 */
const DEFINE_COLUMNS_TOOL: AgentTool = {
  name: "define_columns",
  description:
    "Declare or replace the COLUMNS (schema) of a tabular sheet BEFORE filling rows — you decide the columns the task needs. " +
    "CAS-guarded: pass baseVersion (the artifact `version` from snapshot()); if the result is {conflict}, re-read snapshot() and call again with the new version. " +
    "mode 'merge' (default) upserts columns by id; 'replace' sets EXACTLY these columns and deletes cells in any dropped column. " +
    "After it returns ok, fill rows with the locked-cell tools keyed `${rowId}__${columnId}` using each returned column's id.",
  schema: z.object({
    artifactId: z.string().optional(),
    baseVersion: z.coerce.number(),
    mode: z.enum(["replace", "merge"]).default("merge"),
    columns: tolerantArray(
      z.object({
        label: z.string().min(1).max(80),
        type: z.enum(["text", "number", "date", "currency", "boolean", "json"]).default("text"),
        agentWritable: z.coerce.boolean().default(true),
      }),
      { min: 1 },
    ),
  }),
  execute: async (
    a: { artifactId?: string; baseVersion: number; mode: "replace" | "merge"; columns: Array<{ label: string; type?: string; agentWritable?: boolean }> },
    rt,
  ) => (await rt.setColumns?.(a)) ?? { ok: false, error: "define_columns is unsupported in this room" },
};

export const MANAGED_LOCK_TOOLS: AgentTool[] = [
  WRITE_LOCKED_CELL_TOOL,
  WRITE_LOCKED_CELLS_TOOL,
  WRITE_LOCKED_CELL_RESULT_TOOL,
  WRITE_LOCKED_CELL_RESULTS_TOOL,
];
export const PRODUCTION_ROOM_TOOLS: AgentTool[] = [
  ...ROOM_TOOLS.filter((toolDef) => !new Set(["propose_lock", "release_lock", "edit_cell", "write_cell_result", "create_draft"]).has(toolDef.name)),
  ...MANAGED_LOCK_TOOLS,
  ...OKF_RETRIEVAL_TOOLS,
  ...BANKER_COACH_TOOLS,
  SET_ARTIFACT_META_TOOL,
  DEFINE_COLUMNS_TOOL,
];
export const PRODUCTION_TOOL_NAMES = PRODUCTION_ROOM_TOOLS.map((t) => t.name);
