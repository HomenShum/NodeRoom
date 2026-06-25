/**
 * InMemoryRoomTools — the RoomTools port implemented over the in-process
 * RoomEngine. The Convex action implements the SAME interface over mutations +
 * queries; the agent code (context.ts, tools.ts, runtime.ts) is identical in
 * both. Bound at construction to one room + one artifact (the sheet) + the
 * agent's actor + session, so the tool methods take only what the model chose.
 */

import type { RoomEngine } from "../../../engine/roomEngine";
import type { Actor, CellPayload, Channel, DataframeColumn } from "../../../engine/types";
import type { RoomTools, RoomSnapshot, AwarenessView, CellView, CellMeta, EditOutcome, MergeView, SourceResult, ArtifactRef, SpreadsheetContextHit, SetColumnsOutcome } from "../../core/types";
import { buildSpreadsheetSemanticIndex, columnLetters } from "../../../app/spreadsheetIndex";
import type { ColumnInput } from "../../../engine/columns";

export class InMemoryRoomTools implements RoomTools {
  constructor(
    private engine: RoomEngine,
    private roomId: string,
    private artifactId: string,
    private actor: Actor,
    private sessionId: string,
  ) {}

  private targetArtifactId(artifactId?: string): string {
    return artifactId?.trim() || this.artifactId;
  }

  private rowIds(artifactId: string = this.artifactId): string[] {
    const art = this.engine.getArtifact(artifactId);
    const ids: string[] = [];
    for (const e of art?.order ?? []) { const r = e.split("__")[0]; if (!ids.includes(r)) ids.push(r); }
    return ids;
  }

  private displayValue(value: unknown): string {
    const raw = value && typeof value === "object" && "value" in value ? (value as CellPayload).value : value;
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "string") return raw;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return JSON.stringify(raw);
  }

  async snapshot(artifactId: string = this.artifactId): Promise<RoomSnapshot> {
    const art = this.engine.getArtifact(artifactId)!;
    const cell = (rid: string, c: string) => this.displayValue(art.elements[`${rid}__${c}`]?.value);
    const rows = this.rowIds(artifactId).map((rid) => {
      const cells: Record<string, CellMeta> = {};
      for (const [eid, el] of Object.entries(art.elements)) {
        if (!eid.startsWith(`${rid}__`)) continue;
        cells[eid.slice(rid.length + 2)] = { value: this.displayValue(el.value), version: el.version, locked: !!this.engine.lockFor(artifactId, eid) };
      }
      return {
        rowId: rid,
        label: cell(rid, "label"), q2: cell(rid, "q2"), q3: cell(rid, "q3"),
        variance: cell(rid, "variance"), note: cell(rid, "note"),
        varianceVersion: art.elements[`${rid}__variance`]?.version ?? 0,
        locked: !!this.engine.lockFor(artifactId, `${rid}__variance`),
        cells,
      };
    });
    const elements = Object.entries(art.elements).map(([id, el]) => ({ id, value: el.value, version: el.version, locked: !!this.engine.lockFor(artifactId, id) }));
    return { artifactId, version: art.version, kind: art.kind, rows, elements };
  }

  async listArtifacts(): Promise<ArtifactRef[]> {
    return this.engine.listArtifacts(this.roomId).map((a) => ({ id: a.id, title: a.title, kind: a.kind }));
  }

  async setArtifactMeta(args: { artifactId: string; title?: string; summary?: string; tags?: string[] }): Promise<{ ok: boolean; error?: string }> {
    return this.engine.setArtifactMeta({ roomId: this.roomId, artifactId: args.artifactId, title: args.title, summary: args.summary, tags: args.tags, by: this.actor });
  }

  async setColumns(args: { artifactId?: string; baseVersion: number; mode: "replace" | "merge"; columns: Array<{ label: string; type?: string; agentWritable?: boolean }> }): Promise<SetColumnsOutcome> {
    const res = this.engine.setColumns({
      roomId: this.roomId,
      artifactId: this.targetArtifactId(args.artifactId),
      baseVersion: args.baseVersion,
      mode: args.mode,
      columns: args.columns as unknown as ColumnInput[],
      by: this.actor,
    });
    if (res.ok) return { ok: true, version: res.version, columns: res.columns };
    if (res.conflict) return { ok: false, conflict: true, expected: res.expected!, actual: res.actual! };
    return { ok: false, error: res.error ?? "set_columns_failed" };
  }

  async awareness(): Promise<AwarenessView> {
    const a = this.engine.awareness(this.roomId, this.actor.id);
    return {
      activeLocks: a.activeLocks.map((l) => ({ lockId: l.id, elementIds: l.elementIds, holder: l.holder.name, reason: l.reason })),
      agents: a.sessions.map((s) => ({ name: s.agentName, scope: s.scope, status: s.status })),
      recentTrace: a.recentTraces.slice(-6).map((t) => `${t.type}: ${t.summary}`),
      autoAllow: this.engine.getRoom(this.roomId)?.autoAllow,
    };
  }

  async readRange(elementIds: string[], artifactId: string = this.artifactId): Promise<CellView[]> {
    artifactId = this.targetArtifactId(artifactId);
    const art = this.engine.getArtifact(artifactId);
    const resolvedIds = elementIds.map((id) => normalizeExcelGridElementId(art?.meta, id));
    const els = this.engine.readRange(artifactId, resolvedIds);
    return resolvedIds.map((id) => {
      const el = els[id];
      const lk = this.engine.lockFor(artifactId, id);
      return { id, value: el?.value ?? null, version: el?.version ?? 0, locked: lk ? { by: lk.holder.name, reason: lk.reason } : null };
    });
  }

  async searchSheetContext(query: string, artifactId: string = this.artifactId, limit = 8): Promise<SpreadsheetContextHit[]> {
    artifactId = this.targetArtifactId(artifactId);
    const art = this.engine.getArtifact(artifactId);
    const grid = excelGridMeta(art?.meta);
    if (art && grid) {
      const hits: SpreadsheetContextHit[] = [];
      const columns = Array.from({ length: grid.columns }, (_, idx) => columnLetters(idx));
      const rowHeaders = new Map<number, string>();
      for (let row = 1; row <= grid.rows; row++) {
        for (const column of columns) {
          const value = this.displayValue(art.elements[`${column}${row}`]?.value).trim();
          if (value) { rowHeaders.set(row, value.slice(0, 120)); break; }
        }
      }
      for (let row = 1; row <= grid.rows; row++) {
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
          const column = columns[colIndex];
          const elementId = `${column}${row}`;
          const raw = art.elements[elementId]?.value;
          if (raw === undefined) continue;
          const rawValue = this.displayValue(raw);
          const formula = raw && typeof raw === "object" && "formula" in raw ? String((raw as CellPayload).formula ?? "").trim() : "";
          const formulaText = formula ? ` | Formula: ${formula}` : "";
          hits.push({
            kind: "cell",
            score: 0,
            elementId,
            coordinate: elementId,
            rowHeader: rowHeaders.get(row) ?? String(row),
            columnHeader: column,
            rawValue,
            semanticSummary: `Sheet: ${art.title} | Cell: ${elementId} | Row: ${rowHeaders.get(row) ?? row} | Column: ${column} | Value: ${rawValue}${formulaText}`,
          });
        }
      }
      return rankSpreadsheetHits(query, hits).slice(0, Math.max(1, Math.min(limit, 20)));
    }
    const columns = dataframeColumns(art?.meta);
    if (!art || !columns.length) return [];
    const index = buildSpreadsheetSemanticIndex({
      title: art.title,
      columns,
      seed: Object.values(art.elements).map((el) => ({ id: el.id, value: el.value })),
    });
    return rankSpreadsheetHits(query, [
      ...index.cells.map((cell): SpreadsheetContextHit => ({ kind: "cell", score: 0, ...cell })),
      ...index.chunks.map((chunk): SpreadsheetContextHit => ({ kind: "chunk", score: 0, ...chunk })),
    ]).slice(0, Math.max(1, Math.min(limit, 20)));
  }

  async proposeLock(elementIds: string[], reason: string, artifactId: string = this.artifactId) {
    artifactId = this.targetArtifactId(artifactId);
    const r = this.engine.proposeLock({ roomId: this.roomId, artifactId, elementIds, holder: this.actor, sessionId: this.sessionId, reason });
    if (r.ok) {
      this.engine.updateSession(this.sessionId, { status: "working", heldLockId: r.lock.id, lastAction: `locked ${elementIds.join(", ")}` });
      return { ok: true as const, lockId: r.lock.id };
    }
    return { ok: false as const, reason: `range already locked by ${r.conflicting.map((c) => c.by.name).join(", ")}`, lockId: r.conflicting[0]?.lockId };
  }

  async releaseLock(lockId: string): Promise<{ ok?: boolean; reason?: string; merged: MergeView[] }> {
    const r = this.engine.releaseLock(lockId, this.actor);
    if (!r.ok) return { ok: false, reason: r.reason, merged: [] };
    this.engine.updateSession(this.sessionId, { status: "done", heldLockId: undefined, lastAction: "released lock" });
    return { merged: r.merged.map((m) => ({ draftId: m.draftId, verdict: m.resolution.verdict, note: m.resolution.note, applied: m.applied.length, conflicts: m.conflicts.length })) };
  }

  async editCell(elementId: string, value: unknown, baseVersion: number, artifactId: string = this.artifactId, kind: "set" | "create" | "delete" = "set"): Promise<EditOutcome> {
    artifactId = this.targetArtifactId(artifactId);
    const res = this.engine.applyEdit({ roomId: this.roomId, op: { opId: crypto.randomUUID(), artifactId, elementId, kind, value, baseVersion }, actor: this.actor });
    if (res.ok) return { ok: true, version: res.toVersion };
    if (res.reason === "conflict") return { ok: false, conflict: true, expected: res.expected, actual: res.actual };
    if (res.reason === "locked") return { ok: false, locked: true, holder: res.by.name };
    if (res.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: res.proposalId };
    return { ok: false, error: res.reason };
  }

  async createDraft(ops: { elementId: string; value: unknown; baseVersion: number }[], blockedByLockId: string, note: string, artifactId: string = this.artifactId) {
    artifactId = this.targetArtifactId(artifactId);
    const draft = this.engine.createDraft({
      roomId: this.roomId, artifactId, author: this.actor, note, blockedByLockId,
      ops: ops.map((o) => ({ opId: crypto.randomUUID(), artifactId, elementId: o.elementId, kind: "set" as const, value: o.value, baseVersion: o.baseVersion })),
    });
    this.engine.updateSession(this.sessionId, { status: "drafting", lastAction: `drafted ${ops.length} change(s)` });
    return { draftId: draft.id };
  }

  async say(text: string): Promise<void> {
    const channel: Channel = this.actor.scope === "private" && this.actor.ownerId ? { private: this.actor.ownerId } : "public";
    this.engine.postMessage({ roomId: this.roomId, channel, author: this.actor, text, clientMsgId: crypto.randomUUID(), kind: "agent" });
  }

  async fetchSource(url: string): Promise<SourceResult> {
    // No-keys / in-memory path: a deterministic stub (no network in the browser; tests stay hermetic).
    // The Convex action does a real SSRF-guarded fetch — see convexRoomTools.fetchSource.
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return { ok: true, title: host, snippet: `Reference page at ${host} (stub — live runs fetch the real page).`, url };
    } catch {
      return { ok: false, error: "invalid url" };
    }
  }
}

function excelGridMeta(meta: unknown): { rows: number; columns: number; sheetName?: string } | null {
  const grid = (meta as { excelGrid?: { rows?: unknown; columns?: unknown; sheetName?: unknown } } | undefined)?.excelGrid;
  const rows = typeof grid?.rows === "number" ? grid.rows : 0;
  const columns = typeof grid?.columns === "number" ? grid.columns : 0;
  if (rows <= 0 || columns <= 0) return null;
  return { rows, columns, sheetName: typeof grid?.sheetName === "string" ? grid.sheetName : undefined };
}

function normalizeExcelGridElementId(meta: unknown, elementId: string): string {
  if (!excelGridMeta(meta)) return elementId;
  const trimmed = elementId.trim();
  if (/^[A-Z]{1,3}\d+$/i.test(trimmed)) return trimmed.toUpperCase();
  const alias = trimmed.match(/^(?:r)?(\d+)__([A-Z]{1,3})$/i);
  return alias ? `${alias[2].toUpperCase()}${Number(alias[1])}` : elementId;
}

function dataframeColumns(meta: unknown): DataframeColumn[] {
  const columns = (meta as { dataframe?: { columns?: unknown } } | undefined)?.dataframe?.columns;
  return Array.isArray(columns)
    ? columns.filter((column): column is DataframeColumn => {
      const c = column as Partial<DataframeColumn>;
      return typeof c.id === "string" && typeof c.label === "string" && typeof c.order === "number";
    })
    : [];
}

function rankSpreadsheetHits(query: string, hits: SpreadsheetContextHit[]): SpreadsheetContextHit[] {
  const terms = query.toLowerCase().split(/[^a-z0-9$%._-]+/).filter(Boolean);
  return hits
    .map((hit) => ({ ...hit, score: scoreHit(hit, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
}

function scoreHit(hit: SpreadsheetContextHit, terms: string[]): number {
  const text = (hit.kind === "cell" ? hit.semanticSummary : hit.text).toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}
