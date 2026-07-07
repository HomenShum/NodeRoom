/**
 * Audit evidence bundle export — design item "Audit: signed evidence bundle
 * (CSV + sources + trace)".
 *
 * One proof-gated action turns a sheet into four downloadable file artifacts:
 *   (a) a CSV of the sheet (headers from meta.dataframe.columns when present,
 *       else derived from element ids; values flattened; RFC 4180 quoting),
 *   (b) an evidence list (elementId, label, url, snippet) lifted from each
 *       cell's CellPayload.evidence entries,
 *   (c) a trace excerpt (latest room traces, bounded),
 *   (d) a manifest.json carrying the sha256 content hash of each part.
 *
 * The manifest is the "signature": DETERMINISTIC sorted-key serialization,
 * hashed with the same sha256Hex the token/CAS layers use, and deliberately
 * free of wall-clock timestamps — re-exporting identical room data yields the
 * identical manifestHash (the creation time lives on the artifact row and in
 * meta.upload.parsedAt, NOT in the hashed content). To keep that fixed-point
 * property, the trace excerpt excludes the traces this exporter itself writes
 * (file-generation traces whose fileName carries the bundle prefix).
 *
 * Honesty gates:
 *   - BOUND: sheets over 25,000 elements are refused with
 *     { ok:false, reason:"sheet_too_large" }; every read uses .take; parts
 *     over the byte cap refuse with "bundle_too_large" instead of silently
 *     truncating the file.
 *   - HONEST_STATUS: every failure path returns { ok:false, reason } (or
 *     throws for proof failures) — never a fake success.
 *   - Visibility: a private sheet not owned by the requester refuses with
 *     "artifact_not_visible", and traces written by OTHER members' private
 *     agents are excluded from the excerpt (okf.ts trace-visibility
 *     precedent) — the requester's own private-agent traces stay.
 *
 * convex/_generated lags until the next codegen — which must NOT be run
 * casually (`npx convex codegen` against a configured cloud deployment
 * DEPLOYS schema+functions, documented gotcha). Cross-module references use
 * makeFunctionReference, the convexRoomTools.ts precedent.
 */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, sha256Hex, type ActorValue } from "./lib";

/** BOUND: refuse sheets over this many elements. This supports the 1,000-row live starter while still preventing runaway exports. */
const MAX_BUNDLE_ELEMENTS = 25_000;
/** Latest-N trace excerpt the bundle attests to. */
const TRACE_EXCERPT_LIMIT = 500;
/** Raw trace read window before exclusion filtering (auditLog.list take×N precedent). */
const TRACE_RAW_WINDOW = 600;
/** BOUND: per-field truncation caps so one giant cell can't balloon a part. */
const MAX_CSV_CELL_CHARS = 2_000;
const MAX_SNIPPET_CHARS = 500;
const MAX_TRACE_DETAIL_CHARS = 500;
const MAX_EVIDENCE_PER_CELL = 8;
/** BOUND_READ analog: a bundle part must stay under createAgentFileArtifact's
 *  seed-byte ceiling (5MB) with headroom — refuse honestly, never clip a file. */
const MAX_PART_BYTES = 4_000_000;
/** Shared file-name prefix — also the trace-excerpt self-exclusion marker. */
const BUNDLE_FILE_PREFIX = "evidence-bundle";

type BundleFailureReason =
  | "artifact_not_found"
  | "not_a_sheet"
  | "artifact_not_visible"
  | "sheet_too_large"
  | "bundle_too_large"
  | "persist_failed";

type CollectResult =
  | { ok: false; reason: BundleFailureReason }
  | {
      ok: true;
      actor: ActorValue;
      sheet: { artifactId: string; title: string; version: number; order: string[]; meta: unknown };
      elements: Array<{ elementId: string; version: number; value: unknown }>;
      traces: Array<{ ts: number; type: string; actor: ActorValue; summary: string; detail: string | null }>;
    };

type CollectArgs = { roomId: Id<"rooms">; artifactId: Id<"artifacts">; requester: { actor: ActorValue; token?: string } };

const collectEvidenceBundleDataRef = makeFunctionReference<"query", CollectArgs, CollectResult>(
  "auditBundle:collectEvidenceBundleData",
);

type CreateFileArgs = {
  roomId: Id<"rooms">;
  actor: ActorValue;
  fileName: string;
  mimeType: string;
  size: number;
  text: string;
  summary?: string;
  sourceArtifactIds?: string[];
};

const createAgentFileArtifactRef = makeFunctionReference<"mutation", CreateFileArgs, { artifactId: string }>(
  "artifacts:createAgentFileArtifact",
);

/** Proof-verified bounded read of everything the bundle attests to. Read-only. */
export const collectEvidenceBundleData = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (ctx, a): Promise<CollectResult> => {
    const by = await requireActorProof(ctx, a.roomId, a.requester);
    const art = await ctx.db.get(a.artifactId);
    if (!art || String(art.roomId) !== String(a.roomId)) return { ok: false, reason: "artifact_not_found" };
    if (art.kind !== "sheet") return { ok: false, reason: "not_a_sheet" };
    // Visibility honesty: a private sheet is exportable only by its owner.
    const createdBy = art.createdBy as ActorValue | undefined;
    const owned = !!createdBy && createdBy.kind === "user" && createdBy.id === by.id;
    if ((art.visibility ?? "room") === "private" && !owned) return { ok: false, reason: "artifact_not_visible" };
    if (art.order.length > MAX_BUNDLE_ELEMENTS) return { ok: false, reason: "sheet_too_large" };
    // BOUND: read one past the cap so oversized sheets are detected without collect().
    const els = await ctx.db
      .query("elements")
      .withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId))
      .take(MAX_BUNDLE_ELEMENTS + 1);
    if (els.length > MAX_BUNDLE_ELEMENTS) return { ok: false, reason: "sheet_too_large" };
    const rawTraces = await ctx.db
      .query("traces")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .take(TRACE_RAW_WINDOW);
    const traces = rawTraces
      .filter((t) => {
        // Visibility honesty: another member's PRIVATE agent traces never leak
        // into a bundle (okf.ts traceVisibility precedent). Your own do.
        const actor = t.actor as ActorValue;
        if (actor.kind === "agent" && actor.scope === "private" && actor.ownerId !== by.id) return false;
        // Fixed point: exclude this exporter's own file-generation traces so a
        // re-export of identical room data hashes identically (see header).
        if (t.detail?.startsWith("create_agent_file_artifact") && t.summary.includes(BUNDLE_FILE_PREFIX)) return false;
        return true;
      })
      .slice(0, TRACE_EXCERPT_LIMIT)
      .map((t) => ({
        ts: t.ts,
        type: t.type,
        actor: t.actor as ActorValue,
        summary: t.summary,
        detail: t.detail ? t.detail.slice(0, MAX_TRACE_DETAIL_CHARS) : null,
      }));
    return {
      ok: true,
      actor: by,
      sheet: { artifactId: String(art._id), title: art.title, version: art.version, order: art.order, meta: art.meta },
      elements: els.map((e) => ({ elementId: e.elementId, version: e.version, value: e.value })),
      traces,
    };
  },
});

/**
 * Build + persist the signed evidence bundle. Returns
 * { ok:true, artifactIds:[csv, evidence, trace, manifest], manifestHash }
 * or an honest { ok:false, reason }. Proof failures throw (requireActorProof).
 */
export const buildEvidenceBundle = action({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), requester: actorProofV },
  handler: async (
    ctx,
    a,
  ): Promise<{ ok: true; artifactIds: string[]; manifestHash: string } | { ok: false; reason: BundleFailureReason }> => {
    const data = await ctx.runQuery(collectEvidenceBundleDataRef, a);
    if (!data.ok) return data;
    const { sheet, elements, traces, actor } = data;

    const columns = sheetColumns(sheet.meta, sheet.order, elements);
    const rowIds = sheetRowIds(sheet.order, elements);
    const valueByKey = new Map<string, unknown>();
    for (const e of elements) valueByKey.set(e.elementId.includes("__") ? e.elementId : `${e.elementId}__value`, e.value);
    const header = ["row_id", ...columns.map((c) => c.label)].map(csvField).join(",");
    const lines = rowIds.map((rowId) =>
      [rowId, ...columns.map((c) => flattenCellValue(valueByKey.get(`${rowId}__${c.id}`)))].map(csvField).join(","),
    );
    const csv = [header, ...lines].join("\r\n") + "\r\n";

    const evidence: Array<{ elementId: string; label: string; url: string | null; snippet: string | null }> = [];
    for (const e of elements) {
      const list = evidenceOf(e.value);
      for (const entry of list.slice(0, MAX_EVIDENCE_PER_CELL)) {
        evidence.push({
          elementId: e.elementId,
          label: typeof entry.label === "string" && entry.label ? entry.label : String(entry.kind ?? "evidence"),
          url: typeof entry.url === "string" ? entry.url : null,
          snippet: typeof entry.snippet === "string" ? entry.snippet.slice(0, MAX_SNIPPET_CHARS) : null,
        });
      }
    }

    const evidenceJson = stableStringify(evidence, true);
    const traceJson = stableStringify(traces, true);
    const parts = [
      { name: `${BUNDLE_FILE_PREFIX}-${slug(sheet.title)}.csv`, mimeType: "text/csv", text: csv },
      { name: `${BUNDLE_FILE_PREFIX}-evidence.json`, mimeType: "application/json", text: evidenceJson },
      { name: `${BUNDLE_FILE_PREFIX}-trace.json`, mimeType: "application/json", text: traceJson },
    ];
    const encoder = new TextEncoder();
    const manifestParts: Array<{ name: string; sha256: string; bytes: number }> = [];
    for (const part of parts) {
      const bytes = encoder.encode(part.text).byteLength;
      if (bytes > MAX_PART_BYTES) return { ok: false, reason: "bundle_too_large" };
      manifestParts.push({ name: part.name, sha256: await sha256Hex(part.text), bytes });
    }

    // DETERMINISTIC: sorted-key serialization, no timestamps (see file header).
    const manifest = {
      bundle: "evidence_bundle_v1",
      counts: { columns: columns.length, evidence: evidence.length, rows: rowIds.length, traces: traces.length },
      parts: manifestParts,
      requestedBy: { id: actor.id, kind: actor.kind, name: actor.name },
      roomId: String(a.roomId),
      sheet: { artifactId: sheet.artifactId, title: sheet.title, version: sheet.version },
    };
    const manifestJson = stableStringify(manifest, true);
    const manifestHash = await sha256Hex(manifestJson);

    const artifactIds: string[] = [];
    try {
      for (const part of [...parts, { name: `${BUNDLE_FILE_PREFIX}-manifest.json`, mimeType: "application/json", text: manifestJson }]) {
        const created = await ctx.runMutation(createAgentFileArtifactRef, {
          roomId: a.roomId,
          // Author = the requesting USER actor: the bundle is the member's attested export.
          actor,
          fileName: part.name,
          mimeType: part.mimeType,
          size: encoder.encode(part.text).byteLength,
          text: part.text,
          summary: `Evidence bundle part for "${sheet.title}" — manifest ${manifestHash.slice(0, 12)}`,
          sourceArtifactIds: [sheet.artifactId],
        });
        artifactIds.push(String(created.artifactId));
      }
    } catch {
      // HONEST_STATUS: a mid-write failure reports failure — never a fake success
      // (already-created parts remain visible in the room as partial output).
      return { ok: false, reason: "persist_failed" };
    }
    return { ok: true, artifactIds, manifestHash };
  },
});

/* ───────────────────────── deterministic helpers ───────────────────────── */

type BundleColumn = { id: string; label: string };

/** Headers from meta.dataframe.columns (sorted by order, then id) or derived
 *  from element ids (`row__col`) in artifact-order-first appearance. */
function sheetColumns(meta: unknown, order: string[], elements: Array<{ elementId: string }>): BundleColumn[] {
  const dfCols = (meta as { dataframe?: { columns?: unknown } } | null | undefined)?.dataframe?.columns;
  const metaCols = Array.isArray(dfCols)
    ? (dfCols as Array<{ id?: unknown; label?: unknown; order?: unknown }>).filter((c) => typeof c?.id === "string" && c.id)
    : [];
  if (metaCols.length > 0) {
    return [...metaCols]
      .sort((x, y) => (asNumber(x.order) - asNumber(y.order)) || String(x.id).localeCompare(String(y.id)))
      .map((c) => ({ id: String(c.id), label: typeof c.label === "string" && c.label ? c.label : String(c.id) }));
  }
  const seen = new Set<string>();
  const cols: BundleColumn[] = [];
  for (const elementId of [...order, ...elements.map((e) => e.elementId)]) {
    const sep = elementId.indexOf("__");
    const id = sep > 0 ? elementId.slice(sep + 2) : "value";
    if (!seen.has(id)) {
      seen.add(id);
      cols.push({ id, label: id });
    }
  }
  return cols;
}

/** Row ids in artifact-order-first appearance (getSheet's rowIds precedent),
 *  then any index-ordered stragglers — fully deterministic. */
function sheetRowIds(order: string[], elements: Array<{ elementId: string }>): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const elementId of [...order, ...elements.map((e) => e.elementId)]) {
    const sep = elementId.indexOf("__");
    const id = sep > 0 ? elementId.slice(0, sep) : elementId;
    if (id && !seen.has(id)) {
      seen.add(id);
      rows.push(id);
    }
  }
  return rows;
}

/** Flatten a cell for CSV: CellPayload `{ value }` unwraps (artifacts.ts
 *  displayValue precedent), objects serialize sorted-key, giant cells truncate
 *  with an explicit marker (never silently). */
function flattenCellValue(value: unknown): string {
  const raw = value && typeof value === "object" && "value" in (value as object) ? (value as { value?: unknown }).value : value;
  if (raw === null || raw === undefined) return "";
  const text = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : stableStringify(raw, false);
  return text.length > MAX_CSV_CELL_CHARS ? `${text.slice(0, MAX_CSV_CELL_CHARS)}…[truncated]` : text;
}

/** RFC 4180: quote fields containing comma/quote/CR/LF; double embedded quotes. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type CellEvidenceLike = { kind?: unknown; label?: unknown; url?: unknown; snippet?: unknown };

function evidenceOf(value: unknown): CellEvidenceLike[] {
  if (!value || typeof value !== "object") return [];
  const list = (value as { evidence?: unknown }).evidence;
  return Array.isArray(list) ? list.filter((e): e is CellEvidenceLike => !!e && typeof e === "object") : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Sorted-key JSON (auditLog.ts stableJson precedent) — the DETERMINISTIC spine
 *  of every hashed part. `pretty` keeps downloadable files human-readable
 *  without breaking determinism. */
function stableStringify(value: unknown, pretty: boolean): string {
  return JSON.stringify(normalizeForStableJson(value), null, pretty ? 2 : undefined);
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = normalizeForStableJson(input[key]);
    return output;
  }
  return String(value);
}

/** Deterministic file-name slug from the sheet title. */
function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "sheet";
}
