/** Room Binder (`.r-panel.left`): source files, room artifacts, people, and public agents. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { FolderOpen, Table2, FileText, StickyNote, BookOpen, Upload, Loader2, ShieldCheck, Activity, ChevronRight, Search, type LucideIcon } from "lucide-react";
import { useStore } from "../app/store";
import type { Actor, Artifact } from "../engine/types";
import { ARTIFACT_REF_MIME, encodeArtifactRef } from "./artifactRefs";
import { focusStage } from "./stageFocus";
import { abortable, formatBytes, parseUploadedFiles, UPLOAD_TIMEOUT_MS } from "../app/uploadedArtifact";

const WIKI_TITLE = "Agent wiki";

// C4: reject a promise as soon as `signal` aborts (timeout or unmount) even if the underlying
// promise never settles — so the upload spinner always clears instead of hanging.
function initials(name: string): string {
  return name.replace(/[^A-Za-z· ]/g, "").split(/[ ·]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const fileIcon = (a: { kind: string; title: string }): LucideIcon => (a.title === WIKI_TITLE ? BookOpen : a.kind === "sheet" ? Table2 : a.kind === "note" ? FileText : StickyNote);
function roleOf(name: string, role: string, anon: boolean): string {
  if (role === "host") return "Host";
  if (name === "Priya") return "Finance lead";
  return anon ? "Guest" : "Member";
}
/** Compact "A1:C5"-style label for a lock's claimed range (binder agent/person rows). */
function rangeLabel(elementIds: string[]): string {
  if (!elementIds.length) return "";
  if (elementIds.length === 1) return elementIds[0];
  return `${elementIds[0]}:${elementIds[elementIds.length - 1]}`;
}
// A binder row becomes a focus button only when there is a real claimed range to jump to.
// looks-clickable-must-act. Reset to a bare row visually; .r-person provides the layout.
const personFocusBtn: CSSProperties = { width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", font: "inherit", color: "inherit" };

type BinderTreeRow = {
  id: string;
  title: string;
  meta: string;
  badge?: string;
  Icon: LucideIcon;
  level: number;
  artifact?: Artifact;
  children?: BinderTreeRow[];
  action?: () => void;
  testId?: string;
  draggable?: boolean;
  active?: boolean;
  searchText: string;
};

export function LeftRail({ roomId, me, artId, onPick, style }: { roomId: string; me: Actor; artId: string; onPick: (id: string) => void; style?: CSSProperties }) {
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pinned: true,
    recent: true,
    workbooks: true,
    documents: true,
    proof: true,
    people: true,
  });
  const aliveRef = useRef(true); // A4: don't setState after unmount when an upload resolves late
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  const arts = store.listArtifacts(roomId);
  const members = store.listMembers(roomId);
  const sessions = store.listSessions(roomId);
  const proposals = store.listProposals(roomId);
  const traces = store.listTraces(roomId);
  const locks = store.awareness(roomId).activeLocks;
  const allPublicMessages = store.listMessages(roomId, "public");
  const publicSessions = sessions.filter((s) => s.scope === "public");
  const sheetRowCount = useMemo(() => arts.reduce((total, artifact) => total + (artifact.kind === "sheet" ? rowCount(artifact) : 0), 0), [arts]);
  const largeBinder = arts.length >= 20 || sheetRowCount >= 500 || allPublicMessages.length >= 100 || traces.length >= 100;
  const visibleMembers = largeBinder ? members.slice(0, 8) : members;
  const visiblePublicSessions = largeBinder ? publicSessions.slice(0, Math.max(0, 8 - visibleMembers.length)) : publicSessions;
  const collapsedPeopleCount = members.length + publicSessions.length - visibleMembers.length - visiblePublicSessions.length;
  const firstProposal = proposals[0] as { artifactId: string; op?: { elementId?: string } } | undefined;
  const openProposal = () => {
    if (!firstProposal) return;
    onPick(firstProposal.artifactId);
    requestAnimationFrame(() => focusStage({ artifactId: firstProposal.artifactId, elementId: firstProposal.op?.elementId }));
  };
  const sub = (a: { kind: string; title: string; version: number; elements: Record<string, unknown>; order?: string[]; meta?: { excelGrid?: { rows: number; columns: number }; upload?: { fileName: string } } }) => {
    if (a.title === WIKI_TITLE) return `v${a.version} · live TOC`;
    const sourceName = sourceFileLabel(a);
    const base = uploadDocMeta(a) ?? (a.kind === "sheet" ? `v${a.version} · ${rowCount(a)} rows` : a.kind === "wall" ? `${a.order?.length ?? 0} notes` : "edited recently");
    return sourceName && sourceName !== a.title && !base.includes(sourceName) ? `${sourceName} · ${base}` : base;
  };
  void sub;
  const searchNeedle = query.trim().toLowerCase();
  const toggleSection = (id: string) => setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  const pinnedRows = useMemo(() => {
    const out: BinderTreeRow[] = [];
    const active = arts.find((a) => a.id === artId);
    if (active) out.push(artifactTreeRow(active, artId, 1, { id: "pinned-active", metaPrefix: "Open now" }));
    const wiki = arts.find((a) => a.title === WIKI_TITLE && a.id !== active?.id);
    if (wiki) out.push(artifactTreeRow(wiki, artId, 1, { id: "pinned-wiki", metaPrefix: "Pinned" }));
    return out;
  }, [arts, artId]);
  const recentRows = useMemo(
    () => [...arts].filter((artifact) => artifact.kind !== "sheet").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((artifact) => artifactTreeRow(artifact, artId, 1, { id: `recent-${artifact.id}` })),
    [arts, artId],
  );
  const workbookRows = useMemo(() => workbookTreeRows(arts, artId), [arts, artId]);
  const documentRows = useMemo(() => documentTreeRows(arts, artId), [arts, artId]);
  const proofRows = useMemo(() => {
    const reviewMeta = firstProposal ? `${proposals.length} pending proposal${proposals.length === 1 ? "" : "s"}` : "no pending proposals";
    return [
      {
        id: "review-queue",
        title: "Review queue",
        meta: reviewMeta,
        Icon: Activity,
        level: 1,
        action: firstProposal ? openProposal : undefined,
        testId: "binder-review-queue",
        searchText: `review queue ${reviewMeta}`,
      },
      {
        id: "permissions",
        title: "Permissions",
        meta: `host controls - ${traces.length} trace events`,
        Icon: ShieldCheck,
        level: 1,
        searchText: `permissions host controls ${traces.length} trace events`,
      },
    ];
  }, [firstProposal, proposals.length, traces.length]);
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Upload timed out — try fewer or smaller files.")), UPLOAD_TIMEOUT_MS);
    try {
      // Phase 1 — parse EVERY file before committing anything (B3). A single bad file (e.g. over the
      // 5MB cap) aborts the whole drop, so a failed upload can never leave a half-populated binder.
      const parsed = await parseUploadedFiles(files, controller.signal);
      // Phase 2 — commit. There is no server-side delete to roll back a partial batch, so if a commit
      // rejects mid-way we report honestly how many landed (C2) rather than leaving a silent partial.
      let lastId = "";
      let committed = 0;
      try {
        for (const artifact of parsed) {
          lastId = await abortable(store.uploadArtifact({ roomId, artifact, actor: me }), controller.signal);
          committed += 1;
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "please try again";
        throw new Error(committed > 0 ? `Uploaded ${committed} of ${parsed.length} item(s), then failed — ${reason}` : `Upload failed — ${reason}`);
      }
      if (aliveRef.current && lastId) onPick(lastId);
    } catch (err) {
      if (aliveRef.current) setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      clearTimeout(timer);
      if (aliveRef.current) setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="r-panel left fx-side nr-panel nr-panel--left nr-surface-rail" style={style} data-testid="left-rail">
      <div className="r-panel-head">
        <FolderOpen size={15} />
        <span className="h-title">Room Binder</span>
        <span className="h-sub">{arts.length} items</span>
        <span className="r-binder-count" data-testid="binder-scale-count" aria-label={`${arts.length} binder items`}>{arts.length}</span>
      </div>
      <div className="r-rail">
        <label className="r-rail-search r-binder-search sc-search" data-testid="binder-search" aria-label="Find in binder">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Find in binder..." />
        </label>

        <TreeSection id="pinned" title="Pinned" count={pinnedRows.length} rows={filterTreeRows(pinnedRows, searchNeedle)} open={openSections.pinned} searching={!!searchNeedle} onToggle={toggleSection}>
          {(row) => <BinderTreeRowView key={row.id} row={row} artId={artId} onPick={onPick} />}
        </TreeSection>
        <TreeSection id="recent" title="Recent" count={recentRows.length} rows={filterTreeRows(recentRows, searchNeedle)} open={openSections.recent} searching={!!searchNeedle} onToggle={toggleSection}>
          {(row) => <BinderTreeRowView key={row.id} row={row} artId={artId} onPick={onPick} />}
        </TreeSection>
        <TreeSection id="workbooks" title="Sheets" count={countTreeLeafRows(workbookRows)} rows={filterTreeRows(workbookRows, searchNeedle)} open={openSections.workbooks} searching={!!searchNeedle} onToggle={toggleSection}>
          {(row) => <BinderTreeRowView key={row.id} row={row} artId={artId} onPick={onPick} />}
        </TreeSection>
        <TreeSection id="documents" title="Docs" count={countTreeLeafRows(documentRows)} rows={filterTreeRows(documentRows, searchNeedle)} open={openSections.documents} searching={!!searchNeedle} onToggle={toggleSection}>
          {(row) => <BinderTreeRowView key={row.id} row={row} artId={artId} onPick={onPick} />}
        </TreeSection>
        <div className="r-rail-section">
          <input ref={inputRef} className="r-file-input" type="file" multiple onChange={(e) => void onUpload(e.currentTarget.files)} />
          {/* Busy = an inline spinner + aria-busy (not text-only) per the skeleton-vs-spinner rule. */}
          <button className="r-file r-upload" disabled={uploading} aria-busy={uploading} onClick={() => inputRef.current?.click()}>
            <span className="fi">{uploading ? <Loader2 size={14} className="r-spin" /> : <Upload size={14} />}</span>
            <span style={{ minWidth: 0 }}><div className="fn">{uploading ? "Uploading..." : "Upload file"}</div><div className="fm">CSV, XLSX, text, image, PDF</div></span>
          </button>
          {/* Error gains a recovery path (Retry) — the empty-states error convention. */}
          {uploadError && (
            <div className="r-upload-error" role="alert">
              <span className="r-upload-error-msg">{uploadError}</span>
              <button className="r-upload-retry" onClick={() => { setUploadError(null); inputRef.current?.click(); }}>Retry</button>
            </div>
          )}
        </div>

        <TreeSection id="proof" title="Review & proof" count={proofRows.length} rows={filterTreeRows(proofRows, searchNeedle)} open={openSections.proof} searching={!!searchNeedle} onToggle={toggleSection}>
          {(row) => <BinderTreeRowView key={row.id} row={row} artId={artId} onPick={onPick} />}
        </TreeSection>
        {false && (
        <div className="r-rail-section">
          {firstProposal ? (
            <button type="button" className="r-file" data-testid="binder-review-queue" title="Open the first pending proposal" onClick={openProposal}>
            <span className="fi"><Activity size={14} /></span>
            <span><div className="fn">Review queue</div><div className="fm">{proposals.length} pending proposal{proposals.length === 1 ? "" : "s"}</div></span>
            </button>
          ) : (
            <div className="r-file r-file-static">
              <span className="fi"><Activity size={14} /></span>
              <span><div className="fn">Review queue</div><div className="fm">no pending proposals</div></span>
            </div>
          )}
          <div className="r-file r-file-static">
            <span className="fi"><ShieldCheck size={14} /></span>
            <span><div className="fn">Permissions</div><div className="fm">host controls · {traces.length} trace events</div></span>
          </div>
        </div>
        )}

        <div className="r-rail-section r-tree-section">
          <button type="button" className="r-tree-section-head sc-sec fx-folder" data-open={String(!!searchNeedle || openSections.people)} onClick={() => toggleSection("people")} aria-expanded={!!searchNeedle || !!openSections.people}>
            <ChevronRight size={13} />
            <span>People & agents</span>
            <em className="sc-count">{members.length + publicSessions.length} live</em>
          </button>
          {(searchNeedle || openSections.people) && (
          <div className="r-tree-rows">
          <div className="kicker r-rail-kicker">People & agents · {members.length} live</div>
          {visibleMembers.map((m) => {
            const lock = locks.find((l) => l.holder.id === m.id);
            const range = lock ? rangeLabel(lock.elementIds) : "";
            const body = (
              <>
                <span className="r-avatar sm" style={{ background: m.color }}>{initials(m.name)}</span>
                <span className="grow"><div className="pn">{m.name}</div><div className="pr">{roleOf(m.name, m.role, m.anon)}{range ? ` · editing ${range}` : ""}</div></span>
                <span className="r-dot-live" />
              </>
            );
            return lock ? (
              <button key={m.id} className="r-person" data-testid="binder-person" style={personFocusBtn} title={`Jump to ${m.name}'s edit (${range})`}
                onClick={() => { onPick(lock.artifactId); focusStage({ artifactId: lock.artifactId, elementId: lock.elementIds[0] }); }}>{body}</button>
            ) : (
              <div key={m.id} className="r-person">{body}</div>
            );
          })}
          {visiblePublicSessions.map((s) => {
            const lock = locks.find((l) => l.sessionId === s.id);
            const range = lock ? rangeLabel(lock.elementIds) : "";
            const body = (
              <>
                <span className="r-avatar agent sm" style={{ background: "#8F3F27" }}>◆</span>
                <span className="grow"><div className="pn">{s.agentName}</div><div className="pr">Public agent · {s.status}{range ? ` · ${range}` : ""}</div></span>
                {/* The agent is a live participant too — same presence dot as human members. */}
                <span className="r-dot-live" />
              </>
            );
            return lock ? (
              <button key={s.id} className="r-person" data-testid="binder-agent" style={personFocusBtn} title={`Highlight ${s.agentName}'s claimed range (${range})`}
                onClick={() => { onPick(lock.artifactId); focusStage({ artifactId: lock.artifactId, elementId: lock.elementIds[0] }); }}>{body}</button>
            ) : (
              <div key={s.id} className="r-person">{body}</div>
            );
          })}
          {collapsedPeopleCount > 0 && (
            <div className="r-binder-more" data-testid="binder-people-collapsed">
              {collapsedPeopleCount} more live participant{collapsedPeopleCount === 1 ? "" : "s"}
            </div>
          )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeSection({
  id,
  title,
  count,
  rows,
  open,
  searching,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  rows: BinderTreeRow[];
  open?: boolean;
  searching?: boolean;
  onToggle: (id: string) => void;
  children: (row: BinderTreeRow) => ReactNode;
}) {
  const expanded = searching || !!open;
  return (
    <div className="r-rail-section r-tree-section">
      <button type="button" className="r-tree-section-head sc-sec fx-folder" data-open={String(expanded)} onClick={() => onToggle(id)} aria-expanded={expanded}>
        <ChevronRight size={13} />
        <span>{title}</span>
        <em className="sc-count">{count}</em>
      </button>
      {expanded && (
        <div className="r-tree-rows" role="group">
          {rows.length ? rows.map(children) : <div className="r-tree-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}

function BinderTreeRowView({ row, artId, onPick }: { row: BinderTreeRow; artId: string; onPick: (id: string) => void }) {
  const Icon = row.Icon;
  const body = (
    <>
      <span className="fi"><Icon size={14} /></span>
      <span className="r-tree-copy">
        <div className="fn"><span className="r-file-name">{row.title}</span>{row.badge && <span className="r-file-ext">{row.badge}</span>}</div>
        <div className="fm">{row.meta}</div>
      </span>
      {row.children?.length ? <span className="r-tree-count sc-count">{row.children.length}</span> : null}
    </>
  );
  const rowClass = `r-file r-tree-row fx-item${row.artifact || row.action ? "" : " r-file-static"}`;
  const rowProps = {
    className: rowClass,
    "data-level": row.level,
    "data-active": String(row.active ?? row.artifact?.id === artId),
    "data-testid": row.testId ?? (row.artifact ? "binder-artifact" : undefined),
    "data-artifact-id": row.artifact?.id,
    "data-artifact-kind": row.artifact?.kind,
    "data-artifact-title": row.artifact?.title,
    title: row.artifact ? `${row.artifact.title}\nDrag into chat to reference this file` : row.title,
  };
  return (
    <div className="r-tree-node">
      {row.artifact ? (
        <button
          type="button"
          {...rowProps}
          draggable={row.draggable !== false}
          onClick={() => onPick(row.artifact!.id)}
          onDragStart={(e) => dragArtifactRef(e, row.artifact!)}
        >
          {body}
        </button>
      ) : row.action ? (
        <button type="button" {...rowProps} onClick={row.action}>{body}</button>
      ) : (
        <div {...rowProps}>{body}</div>
      )}
      {row.children?.length ? (
        <div className="r-tree-children">
          {row.children.map((child) => <BinderTreeRowView key={child.id} row={child} artId={artId} onPick={onPick} />)}
        </div>
      ) : null}
    </div>
  );
}

function artifactTreeRow(a: Artifact, artId: string, level: number, opts: { id?: string; metaPrefix?: string } = {}): BinderTreeRow {
  const display = binderArtifactDisplay(a);
  const Icon = fileIcon(a);
  const meta = opts.metaPrefix ? `${opts.metaPrefix} - ${display.meta}` : display.meta;
  const searchText = [a.title, display.title, display.badge, meta, sourceFileLabel(a), a.kind, ...(a.meta?.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  return {
    id: opts.id ?? a.id,
    title: display.title,
    meta,
    badge: display.badge,
    Icon,
    level,
    artifact: a,
    active: a.id === artId,
    draggable: true,
    searchText,
  };
}

function workbookTreeRows(arts: Artifact[], artId: string): BinderTreeRow[] {
  const sheets = arts.filter((a) => a.kind === "sheet");
  const groups = new Map<string, Artifact[]>();
  for (const artifact of sheets) {
    const key = workbookGroupLabel(artifact);
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => {
    const children = items.sort((a, b) => a.title.localeCompare(b.title)).map((artifact) => artifactTreeRow(artifact, artId, 2));
    return {
      id: `workbook-${label}`,
      title: compactFileTitle(label),
      meta: `${items.length} sheet${items.length === 1 ? "" : "s"}`,
      badge: fileExtension(label).toUpperCase(),
      Icon: Table2,
      level: 1,
      children,
      searchText: [label, ...children.map((child) => child.searchText)].join(" ").toLowerCase(),
    };
  });
}

function documentTreeRows(arts: Artifact[], artId: string): BinderTreeRow[] {
  const groups = new Map<string, { Icon: LucideIcon; items: Artifact[] }>();
  for (const artifact of arts.filter((a) => a.kind !== "sheet")) {
    const group = documentGroupFor(artifact);
    groups.set(group.title, { Icon: group.Icon, items: [...(groups.get(group.title)?.items ?? []), artifact] });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, group]) => {
    const children = group.items.sort((a, b) => a.title.localeCompare(b.title)).map((artifact) => artifactTreeRow(artifact, artId, 2));
    return {
      id: `docs-${title}`,
      title,
      meta: `${children.length} item${children.length === 1 ? "" : "s"}`,
      Icon: group.Icon,
      level: 1,
      children,
      searchText: [title, ...children.map((child) => child.searchText)].join(" ").toLowerCase(),
    };
  });
}

function documentGroupFor(a: Artifact): { title: string; Icon: LucideIcon } {
  if (a.title === WIKI_TITLE) return { title: "Knowledge", Icon: BookOpen };
  if (sourceFileLabel(a)) return { title: "Source uploads", Icon: FileText };
  if (a.kind === "wall") return { title: "Boards", Icon: StickyNote };
  return { title: "Notes & memos", Icon: FileText };
}

function workbookGroupLabel(a: Artifact): string {
  const source = sourceFileLabel(a);
  if (source) return source;
  return a.meta?.excelGrid?.sheetName && a.meta?.upload?.fileName ? a.meta.upload.fileName : "Room sheets";
}

function filterTreeRows(rows: BinderTreeRow[], needle: string): BinderTreeRow[] {
  if (!needle) return rows;
  return rows.flatMap((row) => {
    const children = filterTreeRows(row.children ?? [], needle);
    const match = row.searchText.includes(needle);
    if (!match && !children.length) return [];
    return [{ ...row, children: match ? row.children : children }];
  });
}

function countTreeLeafRows(rows: BinderTreeRow[]): number {
  return rows.reduce((total, row) => total + (row.children?.length ? countTreeLeafRows(row.children) : 1), 0);
}

function dragArtifactRef(e: DragEvent<HTMLButtonElement>, artifact: { id: string; title: string; kind: string }) {
  const ref = { id: artifact.id, title: artifact.title, kind: artifact.kind };
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(ARTIFACT_REF_MIME, JSON.stringify(ref));
  e.dataTransfer.setData("text/plain", encodeArtifactRef(ref));
}

function rowCount(a: { order?: string[]; meta?: { excelGrid?: { rows: number }; dataframe?: { rowCount?: number } } }) {
  if (a.meta?.excelGrid) return a.meta.excelGrid.rows;
  if (typeof a.meta?.dataframe?.rowCount === "number") return a.meta.dataframe.rowCount;
  const ids: string[] = [];
  for (const id of a.order ?? []) {
    const row = id.split("__")[0];
    if (!ids.includes(row)) ids.push(row);
  }
  return ids.length;
}

function uploadDocMeta(a: { kind: string; elements: Record<string, unknown> }) {
  if (a.kind !== "note") return null;
  const doc = (a.elements.doc as { value?: unknown } | undefined)?.value;
  if (!isUploadDoc(doc)) return null;
  return `${readableFileType(doc.fileName, doc.mimeType)} · ${formatBytes(doc.size)}`;
}

function sourceFileLabel(a: { elements: Record<string, unknown>; meta?: { upload?: { fileName: string } } }) {
  if (a.meta?.upload?.fileName) return a.meta.upload.fileName;
  const doc = (a.elements.doc as { value?: unknown } | undefined)?.value;
  return isUploadDoc(doc) ? doc.fileName : "";
}

function isUploadDoc(value: unknown): value is {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
} {
  return !!value && typeof value === "object" && (value as { upload?: unknown }).upload === true;
}

function binderArtifactDisplay(a: { kind: string; title: string; version: number; elements: Record<string, unknown>; order?: string[]; meta?: { excelGrid?: { rows: number; columns: number }; upload?: { fileName: string } } }) {
  const sourceName = sourceFileLabel(a) || a.title;
  const ext = fileExtension(sourceName);
  const generated = generatedBtbDeliverableLabel(sourceName);
  return {
    title: generated ?? compactFileTitle(sourceName),
    badge: ext ? ext.toUpperCase() : "",
    meta: subForDisplay(a, sourceName),
  };
}

function subForDisplay(a: { kind: string; title: string; version: number; elements: Record<string, unknown>; order?: string[]; meta?: { excelGrid?: { rows: number; columns: number }; upload?: { fileName: string } } }, sourceName: string) {
  if (a.title === WIKI_TITLE) return `v${a.version} · live TOC`;
  const uploaded = uploadDocMeta(a);
  if (uploaded) return uploaded;
  if (a.kind === "sheet") {
    const rows = rowCount(a);
    const type = fileExtension(sourceName) ? readableFileType(sourceName, "") : "Sheet";
    return `${type} · v${a.version} · ${rows} row${rows === 1 ? "" : "s"}`;
  }
  if (a.kind === "wall") return `${a.order?.length ?? 0} notes`;
  return "edited recently";
}

function generatedBtbDeliverableLabel(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (!/^btb-[a-f0-9]{8}-/.test(lower)) return null;
  if (lower.endsWith(".xlsx")) return "Valuation model";
  if (lower.endsWith(".xlsm")) return "Macro workbook";
  if (lower.endsWith(".pptx")) return "Presentation deck";
  if (lower.endsWith(".docx")) return "Support memo";
  if (lower.endsWith(".pdf")) return "PDF export";
  if (lower.endsWith("-manifest.json") || lower.endsWith(".json")) return "Package manifest";
  return null;
}

function compactFileTitle(fileName: string): string {
  const ext = fileExtension(fileName);
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const cleaned = base
    .replace(/^btb-[a-f0-9]{8}-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fileName;
  return cleaned.length > 34 ? `${cleaned.slice(0, 31).trim()}...` : cleaned;
}

function readableFileType(fileName: string, mimeType: string): string {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerName.endsWith(".xlsm") || lowerMime.includes("macroenabled")) return "Macro workbook";
  if (lowerName.endsWith(".xlsx") || lowerMime.includes("spreadsheetml.sheet")) return "Excel workbook";
  if (lowerName.endsWith(".pptx") || lowerMime.includes("presentationml.presentation")) return "PowerPoint";
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml.document")) return "Word document";
  if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") return "PDF";
  if (lowerName.endsWith(".json") || lowerMime === "application/json") return "JSON";
  if (lowerName.endsWith(".txt") || lowerMime.startsWith("text/")) return "Text";
  if (lowerMime.startsWith("image/")) return "Image";
  return "File";
}

function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match?.[1] ?? "";
}
