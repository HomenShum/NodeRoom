/**
 * InMemoryRoomTools — the RoomTools port implemented over the in-process
 * RoomEngine. The Convex action implements the SAME interface over mutations +
 * queries; the agent code (context.ts, tools.ts, runtime.ts) is identical in
 * both. Bound at construction to one room + one artifact (the sheet) + the
 * agent's actor + session, so the tool methods take only what the model chose.
 */

import type { RoomEngine } from "../../../engine/roomEngine";
import type { Actor, CellPayload, Channel, DataframeColumn } from "../../../engine/types";
import type { RoomTools, RoomSnapshot, AwarenessView, CellView, CellMeta, EditOutcome, MergeView, SourceResult, ArtifactRef, SpreadsheetContextHit, SetColumnsOutcome, ReadNotebookOutcome, ApplyNotebookOutlineOutcome, ApplyNotebookBlockEditOutcome, NotebookEnrichmentPlan, NotebookBlockRef, NotebookOutlineSection } from "../../core/types";
import { buildSpreadsheetSemanticIndex, columnLetters } from "../../../app/spreadsheetIndex";
import type { ColumnInput } from "../../../engine/columns";
import { OUTLINE_CAPS, buildOutlineNodes, normalizeTitle, outlineToHtml, sha256HexWeb } from "../../../notebook/blockOps";

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

  /** Memory-mode notebook read: the doc is legacy HTML in elements["doc"], so
   *  blocks come from a bounded HTML parse. Honest degradation — docSource is
   *  "legacy" and stable ids exist only where the HTML carries data-blockid
   *  (agent-written blocks do; hand-seeded demo HTML gets derived ids). */
  async readNotebook(args: { artifactId?: string }): Promise<ReadNotebookOutcome> {
    const artifactId = this.targetArtifactId(args.artifactId);
    const art = this.engine.getArtifact(artifactId);
    if (!art || art.kind !== "note") return { ok: false, reason: "not_a_note" };
    const el = art.elements["doc"];
    if (el?.value != null && typeof el.value !== "string") return { ok: false, reason: "not_a_text_note" };
    const html = typeof el?.value === "string" ? el.value : "";
    const parsed = await htmlBlockRefs(html);
    const blocks: NotebookBlockRef[] = [];
    for (const [blockIndex, b] of parsed.slice(0, OUTLINE_CAPS.maxBlocksPerRead).entries()) {
      const textHash = b.textHash;
      blocks.push({
        blockId: b.readBlockId,
        hasStableId: b.hasStableId,
        blockIndex,
        blockType: b.blockType,
        depth: 0,
        text: b.text.length > OUTLINE_CAPS.maxTextChars ? `${b.text.slice(0, OUTLINE_CAPS.maxTextChars - 1)}…` : b.text,
        textHash,
        authorKind: b.authorKind ?? undefined,
        status: b.status ?? undefined,
      });
    }
    return {
      ok: true,
      docSource: "legacy",
      docVersion: el?.version ?? 0,
      artifactVersion: art.version,
      agentSection: { exists: /data-agent-root=/.test(html) },
      truncated: parsed.length > OUTLINE_CAPS.maxBlocksPerRead,
      blocks,
    };
  }

  /** Memory-mode outline append: renders the outline to attributed HTML and
   *  commits it onto elements["doc"] through the engine's CAS spine — the
   *  identical tool contract, honest "legacy_doc" lane. */
  async applyNotebookOutline(args: {
    artifactId?: string;
    title?: string;
    parentBlockId?: string;
    mode?: "append" | "merge";
    sections: NotebookOutlineSection[];
  }): Promise<ApplyNotebookOutlineOutcome> {
    const artifactId = this.targetArtifactId(args.artifactId);
    const art = this.engine.getArtifact(artifactId);
    if (!art || art.kind !== "note") return { ok: false, error: "not_a_note" };
    const el = art.elements["doc"];
    const html = typeof el?.value === "string" ? el.value : "";
    const parsed = await htmlBlockRefs(html);
    const anchor = args.parentBlockId
      ? parsed.find((b) => b.readBlockId === args.parentBlockId || b.blockId === args.parentBlockId)
      : null;
    if (args.parentBlockId && !anchor) {
      return {
        ok: false,
        noSuchBlock: true,
        parentBlockId: args.parentBlockId,
        currentBlocks: parsed.slice(0, 12).map((b) => ({ blockId: b.readBlockId, text: b.text.slice(0, 80) })),
      };
    }
    const hasAgentRoot = /data-agent-root=/.test(html);
    const existingTitles = new Set<string>();
    if ((args.mode ?? "merge") === "merge" && hasAgentRoot) {
      for (const b of parseHtmlBlocks(html)) {
        if (/^h[1-6]$/.test(b.blockType)) existingTitles.add(normalizeTitle(b.text));
      }
    }
    const outline = { title: args.title, sections: args.sections, runId: this.sessionId };
    const built = buildOutlineNodes({ outline, mintId: () => crypto.randomUUID(), mode: args.mode ?? "merge", existingTitles });
    if (built.nodes.length === 0) {
      return { ok: true, lane: "legacy_doc", blockIds: [], dedupedSections: built.dedupedSections, needsReviewCount: 0, noop: true };
    }
    const fragment = outlineToHtml({ built, outline, includeAgentRoot: !hasAgentRoot && !args.parentBlockId });
    let nextHtml: string;
    if (args.parentBlockId) {
      if (!anchor) return { ok: false, noSuchBlock: true, parentBlockId: args.parentBlockId };
      nextHtml = insertAfterParsedBlock(html, anchor, fragment);
    } else {
      nextHtml = html ? `${html}\n${fragment}` : fragment;
    }
    const res = this.engine.applyEdit({
      roomId: this.roomId,
      op: { opId: crypto.randomUUID(), artifactId, elementId: "doc", kind: el ? "set" : "create", value: nextHtml, baseVersion: el?.version ?? 0 },
      actor: this.actor,
    });
    if (res.ok) return { ok: true, lane: "legacy_doc", blockIds: built.mintedBlockIds, dedupedSections: built.dedupedSections, needsReviewCount: built.needsReviewCount };
    if (res.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: res.proposalId };
    if (res.reason === "conflict") return { ok: false, error: `conflict: doc changed (expected v${res.expected}, actual v${res.actual}) — re-read and retry` };
    if (res.reason === "locked") return { ok: false, error: `locked by ${res.by.name} — draft or wait` };
    return { ok: false, error: res.reason };
  }

  /** Memory-mode single-block edit over the legacy HTML doc — same contract,
   *  honest "legacy_doc" lane. Human prose stays protected here too. */
  async applyNotebookBlockEdit(args: {
    artifactId?: string;
    blockId: string;
    baseTextHash?: string;
    action: "replace" | "append_children" | "annotate";
    content: string;
    reason?: string;
  }): Promise<ApplyNotebookBlockEditOutcome> {
    const artifactId = this.targetArtifactId(args.artifactId);
    const art = this.engine.getArtifact(artifactId);
    if (!art || art.kind !== "note") return { ok: false, error: "not_a_note" };
    const el = art.elements["doc"];
    const html = typeof el?.value === "string" ? el.value : "";
    const clean = args.content.replace(/\s+/g, " ").trim().slice(0, 1_200);
    if (!clean) return { ok: false, error: "empty_content" };
    const escaped = clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const blockRe = new RegExp(`<(h[1-6]|p|li|pre|blockquote)\\b([^>]*data-blockid="${args.blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
    const match = html.match(blockRe);
    if (!match || match.index === undefined) {
      const parsed = parseHtmlBlocks(html);
      return { ok: false, noSuchBlock: true, blockId: args.blockId, currentBlocks: parsed.slice(0, 12).map((b, i) => ({ blockId: b.blockId ?? `b${i}`, text: b.text.slice(0, 80) })) };
    }
    const [full, tag, attrs, inner] = match;
    if (args.action !== "annotate") {
      if (!args.baseTextHash) return { ok: false, error: "base_text_hash_required" };
      if (!/data-author-kind="agent"/i.test(attrs)) {
        return { ok: false, humanBlockProtected: true, hint: "replace/append_children only apply to agent-authored blocks — use action 'annotate' to add an attributed aside after human prose instead" };
      }
      const currentText = inner.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      const currentHash = await sha256HexWeb(currentText);
      if (currentHash !== args.baseTextHash) {
        return { ok: false, blockConflict: true, currentText: currentText.slice(0, 400), currentTextHash: currentHash };
      }
    }
    const mintedId = crypto.randomUUID();
    let nextHtml: string;
    if (args.action === "replace") {
      // Rebuild the element with fresh text; a stale needs_review flag clears.
      const cleanedAttrs = attrs.replace(/\s*data-status="[^"]*"/i, "");
      nextHtml = html.slice(0, match.index) + `<${tag}${cleanedAttrs}>${escaped}</${tag}>` + html.slice(match.index + full.length);
    } else {
      const aside = `<p data-author-kind="agent" data-blockid="${mintedId}">${escaped}</p>`;
      const end = match.index + full.length;
      nextHtml = `${html.slice(0, end)}\n${aside}${html.slice(end)}`;
    }
    const res = this.engine.applyEdit({
      roomId: this.roomId,
      op: { opId: crypto.randomUUID(), artifactId, elementId: "doc", kind: "set", value: nextHtml, baseVersion: el?.version ?? 0 },
      actor: this.actor,
    });
    if (res.ok) return { ok: true, lane: "legacy_doc", action: args.action, blockIds: args.action === "replace" ? [args.blockId] : [mintedId] };
    if (res.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: res.proposalId };
    if (res.reason === "conflict") return { ok: false, error: `conflict: doc changed (expected v${res.expected}, actual v${res.actual}) — re-read and retry` };
    if (res.reason === "locked") return { ok: false, error: `locked by ${res.by.name} — draft or wait` };
    return { ok: false, error: res.reason };
  }

  /** Enrichment planning needs the live read model (entity mentions); the
   *  memory engine has none — honest unsupported instead of fake targets. */
  async planNotebookEnrichment(_args: { artifactId?: string; maxTargets?: number }): Promise<NotebookEnrichmentPlan> {
    return { ok: false, reason: "plan_notebook_enrichment requires the live notebook read model (unavailable in memory mode)" };
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

type ParsedHtmlBlock = { blockType: string; text: string; blockId: string | null; authorKind: string | null; status: string | null; start: number; end: number };
type HtmlBlockRef = ParsedHtmlBlock & { readBlockId: string; hasStableId: boolean; textHash: string };

/** Bounded regex parse of legacy note HTML into block rows (memory mode only —
 *  the synced lane reads real ProseMirror JSON). Nested tags reduce to text. */
function parseHtmlBlocks(html: string): ParsedHtmlBlock[] {
  const out: ParsedHtmlBlock[] = [];
  if (!html.trim()) return out;
  const re = /<(h[1-6]|p|li|pre|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(re)) {
    const [, tag, attrs, inner] = match;
    const text = inner.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = match.index ?? 0;
    const attr = (name: string): string | null => {
      const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`, "i"));
      return m?.[1] ?? null;
    };
    out.push({ blockType: tag.toLowerCase(), text, blockId: attr("blockid"), authorKind: attr("author-kind"), status: attr("status"), start, end: start + match[0].length });
    if (out.length >= 500) break;
  }
  return out;
}

async function htmlBlockRefs(html: string): Promise<HtmlBlockRef[]> {
  const refs: HtmlBlockRef[] = [];
  for (const [index, block] of parseHtmlBlocks(html).entries()) {
    const textHash = await sha256HexWeb(block.text);
    refs.push({
      ...block,
      textHash,
      hasStableId: block.blockId !== null,
      readBlockId: block.blockId ?? `b${index}-${textHash.slice(0, 12)}`,
    });
  }
  return refs;
}

function insertAfterParsedBlock(html: string, block: ParsedHtmlBlock, fragment: string): string {
  return `${html.slice(0, block.end)}\n${fragment}${html.slice(block.end)}`;
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
