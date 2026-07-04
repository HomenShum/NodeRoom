/**
 * The backend for the read_range / edit_cell tools.
 *
 * `applyCellEdit` is the single most important function in the whole system: it
 * is the application-level CAS that makes "no silent clobber" true. Convex's
 * built-in OCC will RETRY a transaction that loses a write race, but it will
 * happily commit a write whose BASELINE is stale — that's the clobber. The
 * `version` check below rejects a stale write and returns the conflict as DATA
 * (not a thrown error), which the agent runtime feeds back to the model so it
 * re-reads and retries. Same function backs hand-edits from the UI.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, actorV, getElement, activeLockOn, lockCoveringElement, LOCK_TTL_MS, requireActorInRoom, requireActorProof, requireArtifactInRoom, type ActorValue } from "./lib";
import { syncSpreadsheetIndexFromDb, syncSpreadsheetIndexFromSeed } from "./spreadsheetIndexLib";
import { planAndRecordRebase } from "./semanticRebase";
import { enqueueArtifactSnapshotForOkf } from "./okf";
import { enqueueRoomActivity } from "./roomActivity";
import { enqueueFileProcessingJob } from "./fileProcessing";
// Shared COLUMN normalizer — the SAME id/order/BOUND rules as the in-memory RoomEngine lane, so the
// governed-columns schema can never drift between the two lanes. (docs/architecture/AGENT_GOVERNED_COLUMNS.md)
import { normalizeColumns, columnIdOfElement, type ColumnInput } from "../src/engine/columns";
import type { DataframeColumn } from "../src/engine/types";

const MAX_ARTIFACT_TITLE_CHARS = 180;
// Convex v.array() arguments are rejected above 8,192 items before this
// mutation body can run, so keep the local contract aligned with that boundary.
const MAX_ARTIFACT_SEED_ELEMENTS = 8_192;
const MAX_ARTIFACT_SEED_BYTES = 5_000_000;
const MAX_ELEMENT_ID_CHARS = 160;
const MAX_RAW_UPLOAD_BYTES = 25_000_000;
const MAX_UPLOAD_FILE_NAME_CHARS = 240;
const MAX_UPLOAD_MIME_CHARS = 200;
const MAX_DIRECT_ELEMENT_MAP_FIELDS = 900;
const SPREADSHEET_INDEX_QUIET_MS = 1_500;
const AGENT_INTENT_CONFLICT_DELAY_MS = 6_000;
const AGENT_INTENT_TTL_MS = 45_000;
const AGENT_COMMIT_LEASE_TTL_MS = 20_000;
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));
type Visibility = "private" | "room" | "public";
type ArtifactAcl = { visibility?: Visibility; createdBy?: ActorValue };
type ArtifactDocForIndex = { _id: Id<"artifacts">; kind: "sheet" | "note" | "wall"; title: string; meta?: unknown };

function artifactVisibility(a: ArtifactAcl): Visibility {
  return a.visibility ?? "room";
}

function actorOwnsArtifact(a: ArtifactAcl, actor: ActorValue): boolean {
  if (!a.createdBy) return false;
  if (a.createdBy.kind === actor.kind && a.createdBy.id === actor.id) return true;
  return actor.kind === "agent" && actor.scope === "private" && !!actor.ownerId && a.createdBy.kind === "user" && a.createdBy.id === actor.ownerId;
}

function actorOwnerId(actor: ActorValue): string {
  return actor.kind === "agent" && actor.ownerId ? actor.ownerId : actor.id;
}

function canReadArtifact(a: ArtifactAcl, actor: ActorValue): boolean {
  return artifactVisibility(a) !== "private" || actorOwnsArtifact(a, actor);
}

function publicRoomAgent(): ActorValue {
  return { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
}

async function ensureAgentSession(ctx: MutationCtx, roomId: Id<"rooms">, actor: ActorValue, lastAction: string) {
  if (actor.kind !== "agent") throw new Error("agent_actor_required");
  const now = Date.now();
  const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const existing = sessions.find((s) =>
    s.agentId === actor.id &&
    s.agentName === actor.name &&
    s.scope === (actor.scope ?? "public") &&
    (actor.ownerId ? s.ownerId === actor.ownerId : true)
  );
  if (existing) {
    await ctx.db.patch(existing._id, { status: "working", lastAction, updatedAt: now });
    return existing._id;
  }
  return ctx.db.insert("agentSessions", {
    roomId,
    agentId: actor.id,
    agentName: actor.name,
    scope: actor.scope ?? "public",
    ownerId: actor.ownerId,
    status: "working",
    lastAction,
    updatedAt: now,
  });
}

function cleanPresenceLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

async function upsertAgentPresence(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  elementId: string;
  mode: "agent_intent" | "commit_lease";
  actor: ActorValue;
  label: string;
  ttlMs: number;
}) {
  if (args.actor.kind !== "agent") throw new Error("agent_actor_required");
  await requireActorInRoom(ctx, args.roomId, args.actor);
  const now = Date.now();
  const expiresAt = now + Math.max(2_000, Math.min(args.ttlMs, 180_000));
  const existing = await ctx.db
    .query("presenceClaims")
    .withIndex("by_actor_mode", (q) =>
      q.eq("roomId", args.roomId)
        .eq("artifactId", args.artifactId)
        .eq("actorId", args.actor.id)
        .eq("mode", args.mode))
    .take(50);
  const same = existing.find((row) => row.targetKind === "cell" && row.targetId === args.elementId);
  const patch = {
    targetKind: "cell" as const,
    targetId: args.elementId,
    actorId: args.actor.id,
    actor: args.actor,
    label: cleanPresenceLabel(args.label),
    color: "#5E6AD2",
    updatedAt: now,
    expiresAt,
  };
  if (same) {
    await ctx.db.patch(same._id, patch);
  } else {
    await ctx.db.insert("presenceClaims", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      mode: args.mode,
      createdAt: now,
      ...patch,
    });
  }
  for (const row of existing) {
    if (same && String(row._id) === String(same._id)) continue;
    await ctx.db.delete(row._id);
  }
}

async function scheduleSpreadsheetIndexRefresh(ctx: MutationCtx, artifact: ArtifactDocForIndex) {
  if (artifact.kind !== "sheet") return;
  const now = Date.now();
  const dueAt = now + SPREADSHEET_INDEX_QUIET_MS;
  const existing = await ctx.db
    .query("spreadsheetIndexRefreshes")
    .withIndex("by_artifact_status", (q) => q.eq("artifactId", artifact._id).eq("status", "queued"))
    .order("desc")
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { dueAt, updatedAt: now });
    return;
  }
  const refreshId = await ctx.db.insert("spreadsheetIndexRefreshes", {
    artifactId: artifact._id,
    status: "queued",
    dueAt,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(SPREADSHEET_INDEX_QUIET_MS, internal.artifacts.refreshSpreadsheetIndex, {
    artifactId: artifact._id,
    refreshId,
  });
}

export const refreshSpreadsheetIndex = internalMutation({
  args: { artifactId: v.id("artifacts"), refreshId: v.optional(v.id("spreadsheetIndexRefreshes")) },
  handler: async (ctx, { artifactId, refreshId }) => {
    const now = Date.now();
    const queued = refreshId
      ? await ctx.db.get(refreshId)
      : await ctx.db.query("spreadsheetIndexRefreshes")
        .withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "queued"))
        .order("desc")
        .first();
    if (!queued || queued.status !== "queued") return { ok: false as const, reason: "not_queued" as const };
    if (queued.dueAt > now) {
      await ctx.scheduler.runAfter(Math.max(1, queued.dueAt - now), internal.artifacts.refreshSpreadsheetIndex, { artifactId, refreshId: queued._id });
      return { ok: true as const, deferred: true as const };
    }
    await ctx.db.patch(queued._id, { status: "running", updatedAt: now });
    const artifact = await ctx.db.get(artifactId);
    if (!artifact || artifact.kind !== "sheet") {
      await ctx.db.patch(queued._id, { status: "completed", updatedAt: Date.now(), completedAt: Date.now() });
      return { ok: false as const, reason: "not_sheet" as const };
    }
    try {
      await syncSpreadsheetIndexFromDb(ctx, artifact);
      await ctx.db.patch(queued._id, { status: "completed", updatedAt: Date.now(), completedAt: Date.now() });
      return { ok: true as const };
    } catch (err) {
      await ctx.db.patch(queued._id, { status: "failed", error: String(err).slice(0, 480), updatedAt: Date.now() });
      return { ok: false as const, reason: "refresh_failed" as const };
    }
  },
});

async function syncArtifactVisibilitySidecars(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  visibility: "private" | "room";
  ownerId?: string;
}) {
  const now = Date.now();
  const patch = { visibility: args.visibility, ownerId: args.ownerId };
  const doc = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_room_artifact_element", (q) =>
      q.eq("roomId", args.roomId).eq("artifactId", args.artifactId).eq("elementId", "doc"))
    .unique();
  if (doc) await ctx.db.patch(doc._id, { ...patch, updatedAt: now });

  const dirtyStates = ["pending", "processing"] as const;
  for (const state of dirtyStates) {
    const rows = await ctx.db
      .query("notebookDirtyEvents")
      .withIndex("by_room_state", (q) => q.eq("roomId", args.roomId).eq("state", state))
      .collect();
    for (const row of rows) {
      if (String(row.artifactId) === String(args.artifactId)) {
        await ctx.db.patch(row._id, { ...patch, updatedAt: now });
      }
    }
  }

  const [blocks, claims, mentions] = await Promise.all([
    ctx.db.query("notebookBlocks").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).collect(),
    ctx.db.query("notebookClaims").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).collect(),
    ctx.db.query("notebookMentions").withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId)).collect(),
  ]);
  for (const row of blocks) await ctx.db.patch(row._id, { ...patch, updatedAt: now });
  for (const row of claims) await ctx.db.patch(row._id, patch);
  for (const row of mentions) await ctx.db.patch(row._id, patch);

  const sourceIds = [`${String(args.artifactId)}:doc`, String(args.artifactId)];
  for (const sourceId of sourceIds) {
    for (const sourceKind of ["element", "artifact_element", "artifact"] as const) {
      const rows = await ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", args.roomId).eq("sourceKind", sourceKind).eq("sourceId", sourceId))
        .collect();
      for (const row of rows) await ctx.db.patch(row._id, { ...patch, updatedAt: now });
    }
  }

  const agentArtifactRows = await Promise.all((["private", "room", "public"] as const).map((visibility) =>
    ctx.db
      .query("agentArtifacts")
      .withIndex("by_room_visibility_updated", (q) => q.eq("roomId", args.roomId).eq("visibility", visibility))
      .collect()
  ));
  for (const row of agentArtifactRows.flat()) {
    if (String(row.artifactId) === String(args.artifactId)) {
      await ctx.db.patch(row._id, { ...patch, updatedAt: now });
    }
  }
}

function assertInternalArtifactReadable(a: ArtifactAcl): void {
  if (artifactVisibility(a) === "private") throw new Error("artifact_not_visible");
}

export function assertCreateArtifactLimits(a: { title: string; seed: Array<{ id: string; value: unknown }>; meta?: unknown }) {
  if (a.title.length > MAX_ARTIFACT_TITLE_CHARS) throw new Error("Artifact title is too long.");
  if (a.seed.length > MAX_ARTIFACT_SEED_ELEMENTS) throw new Error("Artifact seed has too many elements for one mutation.");
  const ids = new Set<string>();
  for (const s of a.seed) {
    if (!s.id || s.id.length > MAX_ELEMENT_ID_CHARS) throw new Error("Artifact seed contains an invalid element id.");
    if (ids.has(s.id)) throw new Error(`Artifact seed contains duplicate element id: ${s.id}`);
    ids.add(s.id);
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ seed: a.seed, meta: a.meta ?? null })).byteLength;
  if (bytes > MAX_ARTIFACT_SEED_BYTES) throw new Error("Artifact seed payload is too large for one mutation.");
}

function displayValue(value: unknown): string {
  const raw = value && typeof value === "object" && "value" in value ? (value as { value?: unknown }).value : value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

function stableValueKey(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function formulaOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const formula = (value as { formula?: unknown }).formula;
  return typeof formula === "string" ? formula : undefined;
}

/** Trace-friendly rendering of a cell value: show the formula for a formula cell (so the ledger
 *  reads "set D2 = =C2-B2" not "[object Object]"), else the plain display value. */
function formatCellForTrace(value: unknown): string {
  return formulaOf(value) ?? displayValue(value);
}

function blocksFormulaScalar(current: unknown, next: unknown, actor: ActorValue, kind: "set" | "create" | "delete"): boolean {
  return kind === "set" && actor.kind === "agent" && !!formulaOf(current) && !formulaOf(next);
}

function samePendingProposal(
  proposal: { roomId: Id<"rooms">; artifactId: Id<"artifacts">; op: unknown; author: ActorValue; status: string },
  a: ApplyCellEditArgs,
  kind: "set" | "create" | "delete",
): boolean {
  const op = proposal.op as { elementId?: unknown; kind?: unknown; baseVersion?: unknown; value?: unknown } | null;
  return proposal.status === "pending"
    && String(proposal.roomId) === String(a.roomId)
    && String(proposal.artifactId) === String(a.artifactId)
    && proposal.author.kind === a.actor.kind
    && proposal.author.id === a.actor.id
    && op?.elementId === a.elementId
    && op.kind === kind
    && op.baseVersion === a.baseVersion
    && stableValueKey(op.value) === stableValueKey(a.value);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

type DataframeColumnMeta = { id?: unknown; label?: unknown; mode?: unknown; agentWritable?: unknown };
type DataframeMetaLike = { columns?: unknown };
type WorkbookSampleElement = { elementId: string; value: unknown };
type ReadRangeCell = {
  id: string;
  value: unknown;
  version: number;
  locked: { by: string; reason: string } | null;
  hint?: string;
  artifactId?: Id<"artifacts">;
  artifactTitle?: string;
  sampleElementIds?: string[];
  error?: string;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasExcelGridAddressSpace(meta: unknown): boolean {
  const grid = objectRecord(objectRecord(meta).excelGrid);
  return typeof grid.rows === "number" && typeof grid.columns === "number";
}

function normalizeExcelGridElementId(meta: unknown, elementId: string): string {
  if (!hasExcelGridAddressSpace(meta)) return elementId;
  const trimmed = elementId.trim();
  if (/^[A-Z]{1,3}\d+$/i.test(trimmed)) return trimmed.toUpperCase();
  const alias = trimmed.match(/^(?:r)?(\d+)__([A-Z]{1,3})$/i);
  if (!alias) return elementId;
  return `${alias[2].toUpperCase()}${Number(alias[1])}`;
}

function displayCellValue(value: unknown): unknown {
  const record = objectRecord(value);
  if ("value" in record) return record.value;
  if ("rawValue" in record) return record.rawValue;
  if ("text" in record) return record.text;
  return value;
}

function isNonEmptyCellValue(value: unknown): boolean {
  const display = displayCellValue(value);
  if (display === null || display === undefined) return false;
  if (typeof display === "string") return display.trim().length > 0;
  if (typeof display === "number" || typeof display === "boolean") return true;
  if (Array.isArray(display)) return display.some(isNonEmptyCellValue);
  if (typeof display === "object") {
    return Object.entries(objectRecord(display)).some(([key, child]) => key !== "status" && isNonEmptyCellValue(child));
  }
  return true;
}

async function workbookReadSample(ctx: any, artifactId: Id<"artifacts">, art: { meta?: unknown; order?: string[] }, sampleLimit: number) {
  const elements = await ctx.db
    .query("elements")
    .withIndex("by_artifact", (q: any) => q.eq("artifactId", artifactId))
    .collect() as WorkbookSampleElement[];
  const byId = new Map<string, WorkbookSampleElement>(elements.map((element) => [
    normalizeExcelGridElementId(art.meta, element.elementId),
    element,
  ]));
  const orderedIds = Array.isArray(art.order) ? art.order.map(String).map((id) => normalizeExcelGridElementId(art.meta, id)) : [];
  const databaseIds = elements.map((element: { elementId: string }) => normalizeExcelGridElementId(art.meta, element.elementId));
  const sampleIds: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!id || seen.has(id) || sampleIds.length >= sampleLimit) return;
    seen.add(id);
    sampleIds.push(id);
  };

  for (const id of orderedIds) if (isNonEmptyCellValue(byId.get(id)?.value)) push(id);
  for (const id of databaseIds) if (isNonEmptyCellValue(byId.get(id)?.value)) push(id);
  for (const id of orderedIds) push(id);
  for (const id of databaseIds) push(id);

  return { sampleIds, byId };
}

function dataframeColumnForElement(meta: unknown, elementId: string): DataframeColumnMeta | null {
  const columnId = elementId.includes("__") ? elementId.split("__").slice(1).join("__") : elementId.replace(/\d+$/, "");
  const dataframe = objectRecord(objectRecord(meta).dataframe) as DataframeMetaLike;
  const columns = Array.isArray(dataframe.columns) ? dataframe.columns : [];
  for (const column of columns) {
    const c = objectRecord(column) as DataframeColumnMeta;
    if (c.id === columnId || c.label === columnId) return c;
  }
  return null;
}

function hasCellPayloadEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = (value as { evidence?: unknown }).evidence;
  return Array.isArray(evidence) && evidence.some((item) => {
    const e = objectRecord(item);
    return typeof e.id === "string" && typeof e.kind === "string" && typeof e.label === "string";
  });
}

/** Declared column ids on a sheet's governed schema (empty when the sheet has no dataframe schema yet). */
function declaredColumnIds(meta: unknown): string[] {
  const dataframe = objectRecord(objectRecord(meta).dataframe) as DataframeMetaLike;
  const cols = Array.isArray(dataframe.columns) ? dataframe.columns : [];
  return cols.map((c) => objectRecord(c).id).filter((id): id is string => typeof id === "string");
}

function agentWritePolicyViolation(
  art: { meta?: unknown },
  elementId: string,
  value: unknown,
  actor: ActorValue,
  kind: "set" | "create" | "delete",
): "agent_write_forbidden_column" | "evidence_required" | "no_such_column" | null {
  if (actor.kind !== "agent") return null;
  // Declare-then-fill (parity with RoomEngine.applyOpInternal): once a sheet has a governed schema, an
  // agent may only write DECLARED columns. An undeclared-column write would otherwise land as an invisible
  // orphan — a column the UI never renders — so reject it and steer the agent to call define_columns first.
  if (kind === "set" || kind === "create") {
    const declared = declaredColumnIds(art.meta);
    const col = declared.length ? columnIdOfElement(elementId) : null;
    if (col && !declared.includes(col)) return "no_such_column";
  }
  const column = dataframeColumnForElement(art.meta, elementId);
  if (!column) return null;
  if (column.agentWritable === false) return "agent_write_forbidden_column";
  if (kind === "delete") return null;
  if ((column.mode === "enrich" || column.mode === "resolve" || column.mode === "classify") && !hasCellPayloadEvidence(value)) {
    return "evidence_required";
  }
  return null;
}

/** read_range tool — returns values + versions + lock flags. Works on locked cells. */
export const readRange = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), elementIds: v.array(v.string()) },
  handler: async (ctx, { roomId, artifactId, elementIds }) => {
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    assertInternalArtifactReadable(art);
    if (elementIds.length === 0) {
      const sampleLimit = 24;
      const { sampleIds } = await workbookReadSample(ctx, artifactId, art, sampleLimit);

      const hint = "read_range requires explicit elementIds. Use these sampleElementIds, or call search_sheet_context with this artifactId to find the exact cells before retrying read_range.";
      if (sampleIds.length === 0) {
        return [{
          id: "__read_range_missing_elementIds__",
          value: null,
          version: 0,
          locked: null,
          error: "missing_elementIds",
          hint,
          artifactId,
          artifactTitle: art.title,
          sampleElementIds: [],
        }];
      }

      const sampleElementIds = sampleIds.slice(0, sampleLimit);
      const out: ReadRangeCell[] = [];
      for (const id of sampleElementIds) {
        const el = await getElement(ctx, artifactId, id);
        const lock = await activeLockOn(ctx, artifactId, id);
        out.push({
          id,
          value: el?.value ?? null,
          version: el?.version ?? 0,
          locked: lock ? { by: lock.holder.name, reason: lock.reason } : null,
          hint,
          artifactId,
          artifactTitle: art.title,
          sampleElementIds,
        });
      }
      return out;
    }
    const out: ReadRangeCell[] = [];
    for (const id of elementIds) {
      const resolvedId = normalizeExcelGridElementId(art.meta, id);
      const el = await getElement(ctx, artifactId, resolvedId);
      const lock = await activeLockOn(ctx, artifactId, resolvedId);
      out.push({ id: resolvedId, value: el?.value ?? null, version: el?.version ?? 0, locked: lock ? { by: lock.holder.name, reason: lock.reason } : null });
    }
    if (hasExcelGridAddressSpace(art.meta) && out.length > 0 && out.every((cell) => !isNonEmptyCellValue(cell.value))) {
      const { sampleIds } = await workbookReadSample(ctx, artifactId, art, 12);
      const nonRequestedSampleIds = sampleIds.filter((id) => !out.some((cell) => cell.id === id));
      if (nonRequestedSampleIds.length) {
        const hint = `Requested cells were blank or missing in uploaded workbook "${art.title}". Use sampleElementIds or search_sheet_context with this artifactId before concluding the workbook is empty.`;
        return out.map((cell) => ({
          ...cell,
          hint,
          artifactId,
          artifactTitle: art.title,
          sampleElementIds: nonRequestedSampleIds,
        }));
      }
    }
    return out;
  },
});

export const searchSheetContext = internalQuery({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, artifactId, query, limit }) => {
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    assertInternalArtifactReadable(art);
    const capped = Math.max(1, Math.min(limit ?? 8, 20));
    const terms = query.toLowerCase().split(/[^a-z0-9$%._-]+/).filter(Boolean);
    if (!terms.length) return [];
    const cells = await ctx.db.query("spreadsheetCells").withIndex("by_artifact_element", (q) => q.eq("artifactId", artifactId)).collect();
    const chunks = await ctx.db.query("spreadsheetChunks").withIndex("by_artifact_chunk", (q) => q.eq("artifactId", artifactId)).collect();
    const cellHits = cells.map((cell) => ({
      kind: "cell" as const,
      elementId: cell.elementId,
      coordinate: cell.coordinate,
      rowHeader: cell.rowHeader,
      columnHeader: cell.columnHeader,
      rawValue: cell.rawValue,
      semanticSummary: cell.semanticSummary,
      score: scoreText(cell.semanticSummary, terms),
    }));
    const chunkHits = chunks.map((chunk) => ({
      kind: "chunk" as const,
      chunkId: chunk.chunkId,
      elementIds: chunk.elementIds,
      text: chunk.text,
      score: scoreText(chunk.text, terms),
    }));
    return [...cellHits, ...chunkHits].filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, capped);
  },
});

/** snapshot for the agent's context + the UI grid. */
export const getSheet = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts") },
  handler: async (ctx, { roomId, artifactId }) => {
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    assertInternalArtifactReadable(art);
    const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    const byId = new Map(els.map((e) => [e.elementId, e]));
    const lockedSet = new Set<string>();
    const locks = await ctx.db.query("locks").withIndex("by_artifact_status", (q) => q.eq("artifactId", artifactId).eq("status", "active")).collect();
    for (const l of locks) for (const id of l.elementIds) lockedSet.add(id);
    const rowIds: string[] = [];
    for (const e of art.order) { const r = e.split("__")[0]; if (!rowIds.includes(r)) rowIds.push(r); }
    const cell = (rid: string, c: string) => displayValue(byId.get(`${rid}__${c}`)?.value);
    const rows = rowIds.map((rid) => {
      const cells: Record<string, { value: string; version: number; locked: boolean }> = {};
      for (const e of els) {
        if (!e.elementId.startsWith(`${rid}__`)) continue;
        cells[e.elementId.slice(rid.length + 2)] = { value: displayValue(e.value), version: e.version, locked: lockedSet.has(e.elementId) };
      }
      return {
        rowId: rid, label: cell(rid, "label"), q2: cell(rid, "q2"), q3: cell(rid, "q3"),
        variance: cell(rid, "variance"), note: cell(rid, "note"),
        varianceVersion: byId.get(`${rid}__variance`)?.version ?? 0,
        locked: lockedSet.has(`${rid}__variance`),
        cells,
      };
    });
    // Raw element list — the kind-agnostic view the agent's note/wall context builders read
    // (rows[] above is the sheet-shaped projection; this exposes every element's true value).
    const elements = els.map((e) => ({ id: e.elementId, value: e.value, version: e.version, locked: lockedSet.has(e.elementId) }));
    return { artifactId, version: art.version, kind: art.kind, rows, elements };
  },
});

type ApplyCellEditArgs = {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  elementId: string;
  kind?: "set" | "create" | "delete";
  value: unknown;
  baseVersion: number;
  actor: ActorValue;
  jobId?: Id<"agentJobs">;
  runId?: Id<"agentRuns">;
  /** Internal: set when this apply IS a semantic-rebase auto-merge, so it does not re-trigger rebase. */
  _rebased?: boolean;
};

type ProposalOp = {
  opId: string;
  artifactId: string;
  elementId: string;
  kind: "set" | "create" | "delete";
  value: unknown;
  baseVersion: number;
};

function parseProposalOp(op: unknown): ProposalOp {
  const o = op as Partial<ProposalOp> | null;
  if (!o || typeof o.opId !== "string" || typeof o.artifactId !== "string" || typeof o.elementId !== "string" || !["set", "create", "delete"].includes(String(o.kind)) || typeof o.baseVersion !== "number") {
    throw new Error("invalid_proposal_op");
  }
  return { opId: o.opId, artifactId: o.artifactId, elementId: o.elementId, kind: o.kind as ProposalOp["kind"], value: o.value, baseVersion: o.baseVersion };
}

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

function objectMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
}

function withSourceUploadMeta(meta: unknown, file: {
  _id: unknown;
  storageId: unknown;
  fileName: string;
  mimeType: string;
  size: number;
  sha256?: string;
}): unknown {
  const out = objectMeta(meta);
  const upload = objectMeta(out.upload);
  out.upload = clean({
    ...upload,
    fileName: typeof upload.fileName === "string" ? upload.fileName : file.fileName,
    mimeType: typeof upload.mimeType === "string" ? upload.mimeType : file.mimeType,
    size: typeof upload.size === "number" ? upload.size : file.size,
    parsedAt: typeof upload.parsedAt === "number" ? upload.parsedAt : Date.now(),
    sourceStorageId: String(file.storageId),
    uploadedFileId: String(file._id),
    sha256: file.sha256,
  });
  return out;
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = canonical((value as Record<string, unknown>)[key]);
    return acc;
  }, {});
}

/** BOUND: version-log snapshots are capped so the elementVersions history can never
 *  become a second unbounded copy of the sheet. Scalars store as-is (long strings are
 *  cut at the cap); non-scalars are stringified to MEASURE the cap — small ones store
 *  the ORIGINAL value (restore round-trips exactly), oversized ones store a cut JSON
 *  prefix with truncated:true, which restore refuses (display-only, never corrupt data). */
const MAX_VERSION_SNAPSHOT_CHARS = 4_000;
function versionLogSnapshot(value: unknown): { value: unknown; truncated: boolean } {
  if (value === undefined || value === null) return { value: null, truncated: false };
  if (typeof value === "string") {
    return value.length > MAX_VERSION_SNAPSHOT_CHARS
      ? { value: value.slice(0, MAX_VERSION_SNAPSHOT_CHARS), truncated: true }
      : { value, truncated: false };
  }
  if (typeof value !== "object") return { value, truncated: false }; // number/boolean/bigint — always small
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return { value: "[unserializable value]", truncated: true };
  }
  return json.length > MAX_VERSION_SNAPSHOT_CHARS
    ? { value: json.slice(0, MAX_VERSION_SNAPSHOT_CHARS), truncated: true }
    : { value, truncated: false };
}

async function applyApprovedProposal(ctx: MutationCtx, roomId: Id<"rooms">, artifactId: Id<"artifacts">, op: ProposalOp, author: ActorValue) {
  if (String(op.artifactId) !== String(artifactId)) throw new Error("proposal_artifact_mismatch");
  const art = await requireArtifactInRoom(ctx, roomId, artifactId);
  const el = await getElement(ctx, artifactId, op.elementId);
  const actual = el?.version ?? 0;
  if (actual !== op.baseVersion) {
    return { ok: false as const, reason: "conflict" as const, expected: op.baseVersion, actual };
  }
  if (blocksFormulaScalar(el?.value, op.value, author, op.kind)) {
    return { ok: false as const, reason: "formula_protected" as const };
  }
  const policyViolation = agentWritePolicyViolation(art, op.elementId, op.value, author, op.kind);
  if (policyViolation) return { ok: false as const, reason: policyViolation };
  const now = Date.now();
  const nextOrder = op.kind === "create" && !el ? [...art.order, op.elementId] : op.kind === "delete" ? art.order.filter((id) => id !== op.elementId) : art.order;
  if (op.kind === "delete") {
    if (el) await ctx.db.delete(el._id);
  } else if (el) {
    await ctx.db.patch(el._id, { value: op.value, version: actual + 1, updatedAt: now, updatedBy: author });
  } else {
    await ctx.db.insert("elements", { artifactId, elementId: op.elementId, value: op.value, version: 1, updatedAt: now, updatedBy: author });
  }
  await ctx.db.patch(artifactId, { version: art.version + 1, updatedAt: now, order: nextOrder });
  const nextVersion = op.kind === "delete" ? actual : actual + 1;
  const summary = op.kind === "delete" ? `${author.name} deleted ${op.elementId}` : `${author.name} set ${op.elementId} = ${formatCellForTrace(op.value)}`;
  await ctx.db.insert("traces", { roomId, ts: now, actor: author, type: "edit_applied", summary, detail: `edit_cell - ${op.elementId} = ${formatCellForTrace(op.value)} - v${actual} -> v${nextVersion}` });
  await enqueueArtifactSnapshotForOkf(ctx, { roomId, artifactId });
  return { ok: true as const, version: nextVersion };
}

// Exported for elementHistory.restoreElementVersion — restore IS this same CAS write
// (a logged before-image re-applied through the human path), never a history rewrite.
export async function applyCellEditCore(ctx: MutationCtx, a: ApplyCellEditArgs) {
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.actor);
    if (!canReadArtifact(art, a.actor)) throw new Error("artifact_not_visible");
    const job = a.jobId ? await ctx.db.get(a.jobId) : null;
    if (a.jobId && (!job || String(job.roomId) !== String(a.roomId))) throw new Error("job_room_mismatch");
    const kind = a.kind ?? "set";
    // 1. LOCK gate — a held range is read-only for non-holders; P0-5 lease fencing for the holder.
    //    Kleppmann's fencing-token failure mode: TTL (5min) < slice budget (9min) means a long job's
    //    own lease can lapse mid-run. activeLockOn erases expired locks, which silently degraded the
    //    holder's write into an UNLOCKED write — losing the cross-cell range guarantee the lock
    //    expansion exists to provide. Fencing semantics:
    //      - another holder, lease valid  → "locked" (unchanged)
    //      - another holder, lease lapsed → treated as gone (janitor sweeps it)
    //      - MY lock, lease lapsed        → "lease_expired" as DATA (re-acquire, don't force)
    //      - MY lock, lease valid         → write proceeds and RENEWS the lease (post-apply below)
    const coveringLock = await lockCoveringElement(ctx, a.artifactId, a.elementId);
    const lockNow = Date.now();
    const leaseValid = !!coveringLock && (coveringLock.expiresAt === undefined || coveringLock.expiresAt > lockNow);
    const heldByMe = !!coveringLock && coveringLock.holder.id === a.actor.id;
    if (coveringLock && !heldByMe && leaseValid) {
      return { ok: false as const, reason: "locked" as const, by: coveringLock.holder.name };
    }
    if (coveringLock && heldByMe && !leaseValid) {
      return { ok: false as const, reason: "lease_expired" as const, lockId: String(coveringLock._id) };
    }
    // 2. CAS gate — reject a stale baseline (this is the anti-clobber check).
    const el = await getElement(ctx, a.artifactId, a.elementId);
    const actual = el?.version ?? 0;
    if (actual !== a.baseVersion) {
      // Per-element CAS rejected a stale write. For an AGENT write, complete the no-clobber wedge:
      // build a durable semantic-conflict packet, classify it, and rebase — auto-merge the safe ones
      // through the CAS spine, route the rest to a review proposal (or record under auto-allow). A
      // human's own stale write stays a plain conflict (humans drive their own retries).
      if (a.actor.kind === "agent" && !a._rebased) {
        try {
          const rebaseRoom = await ctx.db.get(a.roomId);
          const rebase = await planAndRecordRebase(ctx, {
            roomId: a.roomId,
            artifactId: a.artifactId,
            artifactKind: art.kind,
            elementId: a.elementId,
            kind,
            proposedValue: a.value,
            baseVersion: a.baseVersion,
            currentValue: el?.value,
            currentVersion: actual,
            currentUpdatedBy: el?.updatedBy,
            actor: a.actor,
            autoAllow: !!rebaseRoom?.autoAllow,
          });
          // The full loop completes via review: an approved rebased proposal re-runs the CAS in
          // resolveProposal (the "final CAS from resolution"). Deterministic auto-merge never fires
          // for a single-element same-element conflict — classify routes those to review — so there
          // is nothing to commit inline here; the durable packet + proposal are the outcome.
          return { ok: false as const, reason: "conflict" as const, expected: a.baseVersion, actual, rebase };
        } catch (rebaseErr) {
          // Rebase is strictly additive: if it fails, fall back to the plain CAS conflict so the core
          // no-clobber guarantee (a stale write is rejected as data) is never compromised by it. Leave
          // a breadcrumb so a persistent rebase failure is observable instead of silently swallowed.
          try {
            await ctx.db.insert("traces", { roomId: a.roomId, ts: Date.now(), actor: a.actor, type: "semantic_rebase_failed", summary: `Semantic rebase failed for ${a.elementId}; fell back to a plain CAS conflict`, detail: String(rebaseErr).slice(0, 480) });
          } catch { /* never let the breadcrumb itself break the conflict return */ }
          return { ok: false as const, reason: "conflict" as const, expected: a.baseVersion, actual };
        }
      }
      return { ok: false as const, reason: "conflict" as const, expected: a.baseVersion, actual };
    }
    if (blocksFormulaScalar(el?.value, a.value, a.actor, kind)) {
      return { ok: false as const, reason: "formula_protected" as const };
    }
    const policyViolation = agentWritePolicyViolation(art, a.elementId, a.value, a.actor, kind);
    if (policyViolation) return { ok: false as const, reason: policyViolation };
    const room = await ctx.db.get(a.roomId);
    if (a.actor.kind === "agent" && room && !room.autoAllow) {
      const pending = await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", a.roomId).eq("status", "pending")).collect();
      const existing = pending.find((proposal) => samePendingProposal(proposal, a, kind));
      if (existing) return { ok: false as const, reason: "pending_approval" as const, proposalId: existing._id };
      const proposalId = await ctx.db.insert("proposals", {
        roomId: a.roomId,
        artifactId: a.artifactId,
        op: { opId: `proposal_${a.elementId}_${Date.now()}`, artifactId: String(a.artifactId), elementId: a.elementId, kind, value: a.value, baseVersion: a.baseVersion },
        author: a.actor,
        status: "pending",
        createdAt: Date.now(),
      });
      return { ok: false as const, reason: "pending_approval" as const, proposalId };
    }
    // 3. APPLY — bump the per-element version + the artifact clock.
    const now = Date.now();
    // Before-image for the VERSION LOG, captured before the write below replaces it.
    const previousValue = el?.value;
    const nextOrder = kind === "create" && !el ? [...art.order, a.elementId] : kind === "delete" ? art.order.filter((id) => id !== a.elementId) : art.order;
    if (kind === "delete") {
      if (el) await ctx.db.delete(el._id);
    } else if (el) {
      await ctx.db.patch(el._id, { value: a.value, version: actual + 1, updatedAt: now, updatedBy: a.actor });
    } else {
      await ctx.db.insert("elements", { artifactId: a.artifactId, elementId: a.elementId, value: a.value, version: 1, updatedAt: now, updatedBy: a.actor });
    }
    await ctx.db.patch(a.artifactId, { version: art.version + 1, updatedAt: now, order: nextOrder });
    await scheduleSpreadsheetIndexRefresh(ctx, art);
    await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId: a.artifactId, createdByJobId: a.jobId });
    try {
      await enqueueRoomActivity(ctx, {
        roomId: a.roomId,
        sourceKind: "element",
        sourceId: `${String(a.artifactId)}:${a.elementId}`,
        sourceVersion: actual + 1,
        sourceHash: await sha256hex(JSON.stringify(canonical(a.value))),
        eventKind: "cell_committed",
        actor: a.actor,
        visibility: artifactVisibility(art),
        ownerId: artifactVisibility(art) === "private" ? actorOwnerId(a.actor) : undefined,
      });
    } catch (err) {
      await ctx.db.insert("traces", {
        roomId: a.roomId,
        ts: now,
        actor: a.actor,
        type: "room_activity_enqueue_failed",
        summary: `Passive activity enqueue failed for ${a.elementId}`,
        detail: String(err).slice(0, 480),
      });
    }
    // P0-5 renewal: a successful write under my valid lease extends it — a healthy long job
    // (9-min slices) keeps its lock alive by working, instead of structurally outliving the 5-min TTL.
    if (coveringLock && heldByMe && leaseValid && coveringLock.expiresAt !== undefined) {
      await ctx.db.patch(coveringLock._id, { expiresAt: now + LOCK_TTL_MS });
    }
    const nextVersion = kind === "delete" ? actual : actual + 1;
    // 4. TRACE — every applied edit is auditable.
    await ctx.db.insert("traces", { roomId: art.roomId, ts: now, actor: a.actor, type: "edit_applied", summary: `${a.actor.name} set ${a.elementId} = ${formatCellForTrace(a.value)}`, detail: `edit_cell · ${a.elementId} = ${formatCellForTrace(a.value)} · v${actual} → v${actual + 1}` });
    // 5. VERSION LOG — append the BEFORE-image this write superseded (the row keyed
    //    version N holds the value the element had AT version N, so restoring N is a
    //    lookup + this same CAS write). APPLIED writes only — the conflict/locked/
    //    lease_expired/pending_approval paths all returned above and never log.
    //    Kept cheap: one bounded insert (versionLogSnapshot caps it), no hashing.
    const beforeImage = versionLogSnapshot(previousValue);
    await ctx.db.insert("elementVersions", {
      artifactId: a.artifactId,
      elementId: a.elementId,
      version: actual,
      value: beforeImage.value,
      truncated: beforeImage.truncated,
      updatedBy: a.actor,
      kind,
      ts: now,
    });
    let mutationReceiptId: Id<"agentMutationReceipts"> | undefined;
    if (a.jobId && job) {
      mutationReceiptId = await ctx.db.insert("agentMutationReceipts", clean({
        jobId: a.jobId,
        runId: a.runId,
        mutationName: "artifacts.applyAgentCellEdit",
        permission: a.actor.kind === "agent" ? "agent_session" : "actor_proof",
        inputHash: await sha256hex(JSON.stringify(canonical({
          roomId: String(a.roomId),
          artifactId: String(a.artifactId),
          elementId: a.elementId,
          kind,
          value: a.value,
          baseVersion: a.baseVersion,
        }))),
        output: { ok: true, version: nextVersion },
        affectedIds: [String(a.artifactId), `${String(a.artifactId)}:${a.elementId}`],
        beforeVersions: { [a.elementId]: actual },
        afterVersions: { [a.elementId]: kind === "delete" ? null : nextVersion },
        createdAt: now,
      }));
      await ctx.db.patch(a.jobId, {
        mutationCount: (job.mutationCount ?? 0) + 1,
        receiptCount: (job.receiptCount ?? 0) + 1,
        updatedAt: now,
      });
    }
    return clean({ ok: true as const, version: nextVersion, mutationReceiptId });
}

/** UI hand-edit path — token-bound user proof plus the same CAS write. */
export const applyCellEdit = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    kind: v.optional(v.union(v.literal("set"), v.literal("create"), v.literal("delete"))),
    value: v.any(),
    baseVersion: v.number(),
    proof: actorProofV,
  },
  handler: async (ctx, a) => applyCellEditCore(ctx, { ...a, actor: await requireActorProof(ctx, a.roomId, a.proof) }),
});

export const startAgentIntentConflictProof = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.optional(v.string()),
    proposedValue: v.optional(v.any()),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const host = await requireActorProof(ctx, a.roomId, a.requester);
    const member = await ctx.db.get(host.id as Id<"members">);
    if (member?.role !== "host") throw new Error("host_required");
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (!canReadArtifact(art, host)) throw new Error("artifact_not_visible");
    if (art.kind !== "sheet") throw new Error("sheet_required");

    const elementId = (a.elementId ?? "r_rev__variance").trim();
    if (!elementId || elementId.length > MAX_ELEMENT_ID_CHARS) throw new Error("invalid_presence_target");
    const current = await getElement(ctx, a.artifactId, elementId);
    const baseVersion = current?.version ?? 0;
    const proposedValue = a.proposedValue ?? "+19%";
    const agent = publicRoomAgent();
    await ensureAgentSession(ctx, a.roomId, agent, `planning patch for ${elementId}`);
    await upsertAgentPresence(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementId,
      mode: "agent_intent",
      actor: agent,
      label: "NodeAgent planning",
      ttlMs: AGENT_INTENT_TTL_MS,
    });
    const now = Date.now();
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: agent,
      type: "agent_intent_started",
      summary: `NodeAgent planned ${elementId} from v${baseVersion}`,
      detail: `agent_intent - affected=${elementId} - baseVersion=${baseVersion}`,
    });
    await ctx.scheduler.runAfter(AGENT_INTENT_CONFLICT_DELAY_MS, internal.artifacts.commitAgentIntentConflictProof, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementId,
      value: proposedValue,
      baseVersion,
      actor: agent,
    });
    return {
      ok: true as const,
      elementId,
      baseVersion,
      proposedValue,
      delayMs: AGENT_INTENT_CONFLICT_DELAY_MS,
    };
  },
});

/** Owner-gated visibility toggle: share your OWN sheet to the room, or pull it back to private.
 * Two-way (private <-> room) per product decision; only the artifact's owner may change it, and the
 * legacy "public" tier is not reachable from here. Uniform error (no enumeration oracle). */
export const setArtifactVisibility = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    visibility: v.union(v.literal("private"), v.literal("room")),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (!actorOwnsArtifact(art, actor) || (art.visibility ?? "room") === "public") {
      throw new Error("artifact_visibility_forbidden");
    }
    const ownerId = a.visibility === "private" ? actorOwnerId(actor) : undefined;
    await ctx.db.patch(a.artifactId, { visibility: a.visibility });
    await syncArtifactVisibilitySidecars(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      visibility: a.visibility,
      ownerId,
    });
    return { ok: true as const };
  },
});

/** Owner-gated topic + metadata edit (rename + summary + tags). The agent-managed metadata that feeds
 * the OKF/RAG embedding lives here; a user can rename their own file, the agent authors richer meta. */
export const setArtifactMeta = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    requester: actorProofV,
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (!actorOwnsArtifact(art, actor)) throw new Error("artifact_meta_forbidden");
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined && a.title.trim()) patch.title = a.title.trim().slice(0, 120);
    if (a.summary !== undefined || a.tags !== undefined) {
      patch.meta = {
        ...((art.meta as Record<string, unknown> | undefined) ?? {}),
        ...(a.summary !== undefined ? { summary: a.summary.slice(0, 400) } : {}),
        ...(a.tags !== undefined ? { tags: a.tags.slice(0, 12) } : {}),
      };
    }
    if (Object.keys(patch).length) {
      await ctx.db.patch(a.artifactId, patch);
      // Re-index so the new title/summary/tags reach the OKF/RAG embedding (concept frontmatter).
      await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId: a.artifactId });
    }
    return { ok: true as const };
  },
});

/** Agent path for set_artifact_meta: the NodeAgent authors a file's topic/summary/tags from content.
 * Authed by room membership (requireActorInRoom), NOT owner-gated — the agent manages room artifacts
 * it did not create. Re-indexes into OKF so the agent-authored metadata feeds the embedding. */
export const setArtifactMetaByAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    actor: actorV,
  },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined && a.title.trim()) patch.title = a.title.trim().slice(0, 120);
    if (a.summary !== undefined || a.tags !== undefined) {
      patch.meta = {
        ...((art.meta as Record<string, unknown> | undefined) ?? {}),
        ...(a.summary !== undefined ? { summary: a.summary.slice(0, 400) } : {}),
        ...(a.tags !== undefined ? { tags: a.tags.slice(0, 12) } : {}),
      };
    }
    if (Object.keys(patch).length) {
      await ctx.db.patch(a.artifactId, patch);
      await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId: a.artifactId });
    }
    return { ok: true as const };
  },
});

/** Agent path for define_columns: declare/replace a sheet's COLUMN SCHEMA before filling rows. CAS-guarded
 *  on the ARTIFACT VERSION (the schema's CAS token, exactly like a cell's per-element version) — a stale
 *  baseVersion is returned as DATA ({ reason: "conflict" }), never thrown, so the agent's re-read/retry loop
 *  handles it. Mirrors RoomEngine.setColumns and reuses the shared engine normalizer, so the id/order/BOUND
 *  (MAX_COLUMNS) rules never drift from the in-memory lane. Authed by room membership (the agent governs
 *  room artifacts it did not create), and re-indexes into OKF so the new schema feeds retrieval. */
export const setColumnsByAgent = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    baseVersion: v.number(),
    mode: v.optional(v.union(v.literal("replace"), v.literal("merge"))),
    columns: v.array(v.object({
      id: v.optional(v.string()),
      label: v.string(),
      type: v.optional(v.string()),
      mode: v.optional(v.string()),
      agentWritable: v.optional(v.boolean()),
    })),
    actor: actorV,
  },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);
    const art = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    if (art.kind !== "sheet") return { ok: false as const, reason: "not_a_sheet" as const };
    // CAS on the artifact version — reject a stale SCHEMA baseline (the anti-clobber check for columns).
    if (art.version !== a.baseVersion) {
      return { ok: false as const, reason: "conflict" as const, expected: a.baseVersion, actual: art.version };
    }
    const mode = a.mode ?? "merge";
    const df = objectRecord(objectRecord(art.meta).dataframe);
    const existing = (Array.isArray(df.columns) ? df.columns : []) as DataframeColumn[];
    const cols = normalizeColumns(a.columns as unknown as ColumnInput[], existing, mode);
    const now = Date.now();
    let nextOrder = art.order;
    if (mode === "replace") {
      // orphan rule = delete: drop cells whose column id is no longer declared, then trim art.order.
      const keep = new Set(cols.map((c) => c.id));
      const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId)).collect();
      for (const el of els) {
        const colId = columnIdOfElement(el.elementId);
        if (colId && !keep.has(colId)) await ctx.db.delete(el._id);
      }
      nextOrder = art.order.filter((id) => { const colId = columnIdOfElement(id); return !colId || keep.has(colId); });
    }
    const meta = { ...objectRecord(art.meta), dataframe: { rowCount: (df.rowCount as number) ?? 0, ...df, columns: cols } };
    await ctx.db.patch(a.artifactId, { version: art.version + 1, updatedAt: now, order: nextOrder, meta });
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: a.actor,
      type: "schema_changed",
      summary: `${a.actor.name} set ${cols.length} column(s) on ${art.title}`,
      detail: `define_columns(${mode}) · artifact ${String(a.artifactId)} · ${cols.map((c) => c.id).join(", ")} → v${art.version + 1}`,
    });
    await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId: a.artifactId });
    return { ok: true as const, version: art.version + 1, columns: cols };
  },
});

/** Agent tool path — callable only from Convex actions through `internal`. */
/** List the room's artifacts (id/title/kind) — the multi-artifact tool layer's cross-file reach.
 *  internalQuery: called server-side by ConvexRoomTools inside an already-authorized agent action. */
export const listForRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const arts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    return arts
      .filter((a) => artifactVisibility(a) !== "private")
      .map((a) => ({ id: String(a._id), title: a.title, kind: a.kind, meta: a.meta, visibility: a.visibility ?? "room" }));
  },
});

export const listProposals = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const rows = await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).collect();
    const visibleRows = [];
    for (const row of rows) {
      const art = await ctx.db.get(row.artifactId);
      if (art && canReadArtifact(art, actor)) visibleRows.push(row);
    }
    return visibleRows.map((p) => ({
      id: String(p._id),
      roomId: String(p.roomId),
      artifactId: String(p.artifactId),
      op: p.op,
      author: p.author,
      review: p.review,
      status: p.status,
      createdAt: p.createdAt,
    }));
  },
});

// B1 Phase 2: artifact-row bump-carriers (version + order + updatedAt) split out of `rooms.meta`.
// `rooms.meta` now projects ONLY the stable artifact fields (id/roomId/kind/title/createdBy/visibility/meta),
// so a cell edit no longer changes meta's result hash and meta stops re-shipping. This sibling query
// carries the bumped fields — its result is a small per-artifact tuple, so an edit re-ships only the
// ~tens of bytes the version/order/updatedAt fields actually changed. Clients merge the two on the
// way into the engine `Artifact` shape; consumers (LeftRail label, status-bar v-pill, OKF source-version,
// agent worldModel prompt, optimistic updates) keep reading `a.version` from the merged structure with
// no call-site changes. Server bumps at applyCellEditCore/applyAgentCellEdit/addResearchRows/
// ensurePassiveResearchRow/resolveProposal are untouched — the CAS spine + OKF invalidation still work.
export const versions = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const arts = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((a) => canReadArtifact(a, actor));
    return arts.map((a) => ({ id: a._id, version: a.version, order: a.order, updatedAt: a.updatedAt }));
  },
});

// B1: per-artifact cell elements — the companion to `rooms.meta`. A cell edit changes an `elements`
// row for ONE artifact, so only this query (for that artifactId) re-runs/re-ships, not the whole room.
// Guards the artifact is in the requester's room so a member can't read another room's cells.
export const elements = query({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await ctx.db.get(artifactId);
    if (!art || art.roomId !== roomId) return {};
    if (!canReadArtifact(art, actor)) throw new Error("artifact_not_visible");
    const els = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    if (els.length > MAX_DIRECT_ELEMENT_MAP_FIELDS) {
      return {
        __transport: "entries" as const,
        entries: els.map((e) => [
          e.elementId,
          { id: e.elementId, version: e.version, value: e.value, updatedAt: e.updatedAt, updatedBy: e.updatedBy },
        ]),
      };
    }
    const out: Record<string, { id: string; version: number; value: unknown; updatedAt: number; updatedBy: unknown }> = {};
    for (const e of els) out[e.elementId] = { id: e.elementId, version: e.version, value: e.value, updatedAt: e.updatedAt, updatedBy: e.updatedBy };
    return out;
  },
});

export const sourceFilePreviewUrl = query({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await ctx.db.get(artifactId);
    if (!art || art.roomId !== roomId) return null;
    if (!canReadArtifact(art, actor)) throw new Error("artifact_not_visible");
    const file = await ctx.db.query("uploadedFiles").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).first();
    if (!file || file.roomId !== roomId || file.status === "deleted") return null;
    if (!canReadArtifact(file, actor)) throw new Error("source_file_not_visible");
    const lowerName = file.fileName.toLowerCase();
    const lowerMime = file.mimeType.toLowerCase();
    if (lowerMime !== "application/pdf" && !lowerName.endsWith(".pdf")) return null;
    const url = await ctx.storage.getUrl(file.storageId as Id<"_storage">);
    return url ? { url, fileName: file.fileName, mimeType: file.mimeType, size: file.size } : null;
  },
});

export const resolveProposal = mutation({
  args: { proposalId: v.id("proposals"), approve: v.boolean(), requester: actorProofV },
  handler: async (ctx, { proposalId, approve, requester }) => {
    const proposal = await ctx.db.get(proposalId);
    if (!proposal) return { ok: false as const, reason: "not_found" as const };
    const actor = await requireActorProof(ctx, proposal.roomId, requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (member?.role !== "host") throw new Error("host_required");
    const art = await ctx.db.get(proposal.artifactId);
    if (!art || !canReadArtifact(art, actor)) throw new Error("artifact_not_visible");
    if (proposal.status !== "pending") return { ok: false as const, reason: "not_pending" as const };

    const now = Date.now();
    if (approve) {
      const result = await applyApprovedProposal(ctx, proposal.roomId, proposal.artifactId, parseProposalOp(proposal.op), proposal.author as ActorValue);
      if (!result.ok) {
        await ctx.db.insert("traces", {
          roomId: proposal.roomId,
          ts: now,
          actor,
          type: "proposal_resolve_failed",
          summary: `${actor.name} tried to approve ${proposal.author.name}'s edit, but final validation rejected it`,
          detail: `proposal ${String(proposalId)} - approval blocked - ${result.reason}`,
        });
        return result;
      }
      await ctx.db.patch(proposalId, { status: "approved", resolvedAt: now });
      await ctx.db.insert("traces", {
        roomId: proposal.roomId,
        ts: now,
        actor,
        type: "proposal_resolved",
        summary: `${actor.name} approved ${proposal.author.name}'s edit`,
        detail: `proposal ${String(proposalId)} - approved`,
      });
      return result;
    }
    await ctx.db.patch(proposalId, { status: "rejected", resolvedAt: now });
    await ctx.db.insert("traces", {
      roomId: proposal.roomId,
      ts: now,
      actor,
      type: "proposal_resolved",
      summary: `${actor.name} rejected ${proposal.author.name}'s edit`,
      detail: `proposal ${String(proposalId)} - rejected`,
    });
    return { ok: true as const, rejected: true as const };
  },
});

const researchRowInputV = v.object({
  company: v.string(),
  website: v.optional(v.string()),
  tier: v.optional(v.string()),
  intent: v.optional(v.string()),
  owner: v.optional(v.string()),
  crmStatus: v.optional(v.string()),
});
const researchCols = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;
function slugResearchRow(company: string) {
  const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return base ? `rc_${base}` : `rc_company`;
}
function defaultWebsite(company: string) {
  const host = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return host ? `https://www.${host}.com` : "";
}
function normalizeResearchIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function normalizeResearchDomain(value?: string): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}
function displayResearchValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}
function rowIdsFromOrder(order: string[]): string[] {
  return [...new Set(order.map((id) => id.split("__")[0]))];
}
function findExistingResearchRow(order: string[], byElementId: Map<string, { value: unknown }>, row: { company: string; website?: string }): string | null {
  const wantedCompany = normalizeResearchIdentity(row.company);
  const wantedDomain = normalizeResearchDomain(row.website);
  return rowIdsFromOrder(order).find((rid) => {
    const company = normalizeResearchIdentity(displayResearchValue(byElementId.get(`${rid}__company`)?.value));
    if (wantedCompany && company === wantedCompany) return true;
    const domain = normalizeResearchDomain(displayResearchValue(byElementId.get(`${rid}__website`)?.value));
    return !!wantedDomain && domain === wantedDomain;
  }) ?? null;
}

export const addResearchRows = mutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), rows: v.array(researchRowInputV), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, rows, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    const now = Date.now();
    const nextOrder = [...art.order];
    const existingElements = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    const byElementId = new Map(existingElements.map((e) => [e.elementId, e]));
    const touched: string[] = [];
    let addedCount = 0;
    let updatedCount = 0;
    let changed = false;
    for (const row of rows) {
      const company = row.company.trim();
      if (!company) continue;
      const base = slugResearchRow(company);
      const existing = findExistingResearchRow(nextOrder, byElementId, { company, website: row.website });
      let rowId = existing ?? base, suffix = 1;
      while (!existing && nextOrder.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
      const vals: Record<(typeof researchCols)[number], string> = {
        company,
        website: row.website?.trim() || defaultWebsite(company),
        status: existing ? displayResearchValue(byElementId.get(`${rowId}__status`)?.value) || "pending" : "pending",
        tier: row.tier?.trim() || "B",
        intent: row.intent?.trim() ?? "",
        owner: row.owner?.trim() || actor.name,
        crm_status: row.crmStatus?.trim() || "Research",
        summary: existing ? displayResearchValue(byElementId.get(`${rowId}__summary`)?.value) : "",
        funding: existing ? displayResearchValue(byElementId.get(`${rowId}__funding`)?.value) : "",
        headcount: existing ? displayResearchValue(byElementId.get(`${rowId}__headcount`)?.value) : "",
        recent_signal: existing ? displayResearchValue(byElementId.get(`${rowId}__recent_signal`)?.value) : "",
        source: existing ? displayResearchValue(byElementId.get(`${rowId}__source`)?.value) : "",
        source2: existing ? displayResearchValue(byElementId.get(`${rowId}__source2`)?.value) : "",
        last_researched: existing ? displayResearchValue(byElementId.get(`${rowId}__last_researched`)?.value) : "",
      };
      const writableCols = existing ? ["company", "website", "tier", "intent", "owner", "crm_status"] as const : researchCols;
      for (const col of writableCols) {
        const elementId = `${rowId}__${col}`;
        const prev = byElementId.get(elementId);
        if (prev) {
          if (Object.is(prev.value, vals[col])) continue;
          await ctx.db.patch(prev._id, { value: vals[col], version: prev.version + 1, updatedAt: now, updatedBy: actor });
          byElementId.set(elementId, { ...prev, value: vals[col], version: prev.version + 1, updatedAt: now, updatedBy: actor });
        } else {
          const inserted = await ctx.db.insert("elements", { artifactId, elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: actor });
          const row = await ctx.db.get(inserted);
          if (row) byElementId.set(elementId, row);
          nextOrder.push(elementId);
        }
        changed = true;
      }
      if (existing) updatedCount++;
      else {
        addedCount++;
        for (const col of researchCols) {
          const elementId = `${rowId}__${col}`;
          if (byElementId.has(elementId)) continue;
          const inserted = await ctx.db.insert("elements", { artifactId, elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: actor });
          const insertedRow = await ctx.db.get(inserted);
          if (insertedRow) byElementId.set(elementId, insertedRow);
          nextOrder.push(elementId);
        }
        changed = true;
      }
      touched.push(rowId);
    }
    if (touched.length && changed) {
      await ctx.db.patch(artifactId, { order: nextOrder, version: art.version + 1, updatedAt: now });
      await ctx.db.insert("traces", { roomId, ts: now, actor, type: "edit_applied", summary: `${actor.name} imported ${touched.length} research row(s)`, detail: `add_research_rows added=${addedCount} updated=${updatedCount} rows=${touched.join(", ")}` });
      await enqueueArtifactSnapshotForOkf(ctx, { roomId, artifactId });
    }
    return touched;
  },
});

export const ensurePassiveResearchRow = mutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), company: v.string(), requester: actorProofV },
  handler: async (ctx, { roomId, artifactId, company, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const art = await requireArtifactInRoom(ctx, roomId, artifactId);
    const name = company.trim();
    if (!name) return { rowId: null, created: false as const };
    const now = Date.now();
    const nextOrder = [...art.order];
    const existingElements = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
    const byElementId = new Map(existingElements.map((e) => [e.elementId, e]));
    const existing = findExistingResearchRow(nextOrder, byElementId, { company: name });
    if (existing) return { rowId: existing, created: false as const };

    const base = slugResearchRow(name);
    let rowId = base;
    let suffix = 1;
    while (nextOrder.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
    const vals: Record<(typeof researchCols)[number], string> = {
      company: name,
      website: defaultWebsite(name),
      status: "pending",
      tier: "B",
      intent: "",
      owner: actor.name,
      crm_status: "Research",
      summary: "",
      funding: "",
      headcount: "",
      recent_signal: "",
      source: "",
      source2: "",
      last_researched: "",
    };
    for (const col of researchCols) {
      const elementId = `${rowId}__${col}`;
      const inserted = await ctx.db.insert("elements", { artifactId, elementId, value: vals[col], version: 1, updatedAt: now, updatedBy: actor });
      const row = await ctx.db.get(inserted);
      if (row) byElementId.set(elementId, row);
      nextOrder.push(elementId);
    }
    await ctx.db.patch(artifactId, { order: nextOrder, version: art.version + 1, updatedAt: now });
    await ctx.db.insert("traces", {
      roomId,
      ts: now,
      actor,
      type: "edit_applied",
      summary: `${actor.name} added ${name} to the research sheet`,
      detail: `ensure_passive_research_row row=${rowId}`,
    });
    await enqueueArtifactSnapshotForOkf(ctx, { roomId, artifactId });
    return { rowId, created: true as const };
  },
});

export const applyAgentCellEdit = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    // "set" (default) updates an existing element; "create" adds a NEW one (e.g. a post-it on a wall);
    // "delete" removes one. The CAS/lock/proposal spine in applyCellEditCore is identical for all three.
    kind: v.optional(v.union(v.literal("set"), v.literal("create"), v.literal("delete"))),
    value: v.any(),
    baseVersion: v.number(),
    actor: actorV,
    jobId: v.optional(v.id("agentJobs")),
    runId: v.optional(v.id("agentRuns")),
  },
  handler: applyCellEditCore,
});

export const commitAgentIntentConflictProof = internalMutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    value: v.any(),
    baseVersion: v.number(),
    actor: actorV,
  },
  handler: async (ctx, a) => {
    await ensureAgentSession(ctx, a.roomId, a.actor, `publishing patch for ${a.elementId}`);
    await upsertAgentPresence(ctx, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementId: a.elementId,
      mode: "commit_lease",
      actor: a.actor,
      label: "NodeAgent checking CAS",
      ttlMs: AGENT_COMMIT_LEASE_TTL_MS,
    });
    const result = await applyCellEditCore(ctx, { ...a, kind: "set" });
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: Date.now(),
      actor: a.actor,
      type: result.ok ? "agent_intent_committed" : "agent_intent_conflict",
      summary: result.ok
        ? `NodeAgent committed ${a.elementId}`
        : `NodeAgent did not overwrite ${a.elementId}; ${result.reason}`,
      detail: `agent_intent_commit - baseVersion=${a.baseVersion} - result=${JSON.stringify(result).slice(0, 320)}`,
    });
    return result;
  },
});

/** Seed an artifact + its elements (used once per room). */
export const generateFileUploadUrl = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.storage.generateUploadUrl();
  },
});

export const registerUploadedFile = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    visibility: v.optional(visibilityV),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    if (!a.fileName || a.fileName.length > MAX_UPLOAD_FILE_NAME_CHARS) throw new Error("invalid_file_name");
    if (a.mimeType.length > MAX_UPLOAD_MIME_CHARS) throw new Error("invalid_mime_type");
    if (!Number.isFinite(a.size) || a.size <= 0 || a.size > MAX_RAW_UPLOAD_BYTES) throw new Error("file_size_not_allowed");
    const metadata = await ctx.storage.getMetadata(a.storageId);
    if (!metadata) throw new Error("storage_file_not_found");
    if (metadata.size !== a.size) throw new Error("storage_size_mismatch");
    const existing = await ctx.db.query("uploadedFiles").withIndex("by_storage", (q) => q.eq("storageId", a.storageId)).first();
    if (existing) {
      if (String(existing.roomId) !== String(a.roomId)) throw new Error("storage_room_mismatch");
      if (existing.visibility === "private" && !actorOwnsArtifact(existing, actor)) throw new Error("source_file_not_visible");
      return {
        fileId: existing._id,
        storageId: existing.storageId,
        sha256: existing.sha256,
        size: existing.size,
        mimeType: existing.mimeType,
        reused: true as const,
      };
    }
    const now = Date.now();
    const mimeType = a.mimeType || metadata.contentType || "application/octet-stream";
    const fileId = await ctx.db.insert("uploadedFiles", clean({
      roomId: a.roomId,
      storageId: a.storageId,
      fileName: a.fileName,
      mimeType,
      size: a.size,
      sha256: metadata.sha256,
      createdBy: actor,
      visibility: a.visibility ?? "room",
      status: "uploaded",
      createdAt: now,
    }));
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor,
      type: "file_uploaded",
      summary: `${actor.name} uploaded ${a.fileName}`,
      detail: `upload_file - storage=${String(a.storageId)} - bytes=${a.size}`,
    });
    try {
      await enqueueFileProcessingJob(ctx, {
        roomId: a.roomId,
        uploadedFileId: fileId,
        storageId: String(a.storageId),
        provider: "convex_storage",
        purpose: "normalize",
        status: "queued",
        inputMeta: { fileName: a.fileName, mimeType, size: a.size, sha256: metadata.sha256 },
        createdBy: actor,
        visibility: a.visibility ?? "room",
        ownerId: (a.visibility ?? "room") === "private" ? actorOwnerId(actor) : undefined,
      });
      await enqueueRoomActivity(ctx, {
        roomId: a.roomId,
        sourceKind: "upload",
        sourceId: String(fileId),
        sourceHash: metadata.sha256 ?? await sha256hex(`${a.fileName}:${mimeType}:${a.size}:${String(a.storageId)}`),
        eventKind: "file_uploaded",
        actor,
        visibility: a.visibility ?? "room",
        ownerId: (a.visibility ?? "room") === "private" ? actorOwnerId(actor) : undefined,
        quietMs: 1_500,
      });
    } catch (err) {
      await ctx.db.insert("traces", {
        roomId: a.roomId,
        ts: now,
        actor,
        type: "file_processing_enqueue_failed",
        summary: `File processing enqueue failed for ${a.fileName}`,
        detail: String(err).slice(0, 480),
      });
    }
    return { fileId, storageId: a.storageId, sha256: metadata.sha256, size: a.size, mimeType, reused: false as const };
  },
});

export const createArtifact = mutation({
  args: {
    roomId: v.id("rooms"),
    kind: v.union(v.literal("sheet"), v.literal("note"), v.literal("wall")),
    title: v.string(),
    seed: v.array(v.object({ id: v.string(), value: v.any() })),
    meta: v.optional(v.any()),
    sourceFileId: v.optional(v.id("uploadedFiles")),
    proof: actorProofV,
  },
  handler: async (ctx, a) => {
    const by = await requireActorProof(ctx, a.roomId, a.proof);
    assertCreateArtifactLimits(a);
    const now = Date.now();
    const sourceFile = a.sourceFileId ? await ctx.db.get(a.sourceFileId) : null;
    if (a.sourceFileId && !sourceFile) throw new Error("source_file_not_found");
    if (sourceFile && String(sourceFile.roomId) !== String(a.roomId)) throw new Error("source_file_room_mismatch");
    if (sourceFile && sourceFile.visibility === "private" && !actorOwnsArtifact(sourceFile, by)) throw new Error("source_file_not_visible");
    const meta = sourceFile ? withSourceUploadMeta(a.meta, sourceFile) : a.meta;
    const artifactId = await ctx.db.insert("artifacts", {
      roomId: a.roomId,
      kind: a.kind,
      title: a.title,
      version: 1,
      order: a.seed.map((s) => s.id),
      updatedAt: now,
      createdBy: by,
      visibility: sourceFile?.visibility ?? "room",
      meta,
    });
    for (const s of a.seed) await ctx.db.insert("elements", { artifactId, elementId: s.id, value: s.value, version: 1, updatedAt: now, updatedBy: by });
    if (sourceFile && !sourceFile.artifactId) await ctx.db.patch(sourceFile._id, { artifactId, status: "linked", linkedAt: now });
    await syncSpreadsheetIndexFromSeed(ctx, { artifactId, title: a.title, kind: a.kind, meta, seed: a.seed, now });
    await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor: by, type: "edit_applied", summary: `${by.name} added ${a.title}`, detail: `create_artifact · ${a.kind} · ${String(artifactId)}` });
    await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId });
    return artifactId;
  },
});

export const createAgentFileArtifact = internalMutation({
  args: {
    roomId: v.id("rooms"),
    actor: actorV,
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    dataUrl: v.optional(v.string()),
    text: v.optional(v.string()),
    summary: v.optional(v.string()),
    sourceArtifactIds: v.optional(v.array(v.string())),
    sourceUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    if (!a.fileName || a.fileName.length > MAX_UPLOAD_FILE_NAME_CHARS) throw new Error("invalid_file_name");
    if (a.mimeType.length > MAX_UPLOAD_MIME_CHARS) throw new Error("invalid_mime_type");
    if (!Number.isFinite(a.size) || a.size <= 0 || a.size > MAX_RAW_UPLOAD_BYTES) throw new Error("file_size_not_allowed");
    const room = await ctx.db.get(a.roomId);
    if (!room) throw new Error("room_not_found");
    const now = Date.now();
    const doc = clean({
      upload: true,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      dataUrl: a.dataUrl,
      text: a.text,
    });
    const seed = [{ id: "doc", value: doc }];
    const meta = clean({
      upload: { fileName: a.fileName, mimeType: a.mimeType, size: a.size, parsedAt: now },
      generated: {
        by: "nodeagent",
        summary: a.summary,
        sourceArtifactIds: a.sourceArtifactIds ?? [],
        sourceUrls: a.sourceUrls ?? [],
      },
    });
    assertCreateArtifactLimits({ title: a.fileName, seed, meta });
    const artifactId = await ctx.db.insert("artifacts", {
      roomId: a.roomId,
      kind: "note",
      title: a.fileName,
      version: 1,
      order: ["doc"],
      updatedAt: now,
      createdBy: a.actor,
      visibility: "room",
      meta,
    });
    await ctx.db.insert("elements", { artifactId, elementId: "doc", value: doc, version: 1, updatedAt: now, updatedBy: a.actor });
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: a.actor,
      type: "edit_applied",
      summary: `${a.actor.name} generated ${a.fileName}`,
      detail: `create_agent_file_artifact - ${a.mimeType} - bytes=${a.size} - artifact=${String(artifactId)}`,
    });
    await enqueueArtifactSnapshotForOkf(ctx, { roomId: a.roomId, artifactId });
    return { artifactId };
  },
});
