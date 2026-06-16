/** Room Binder (`.r-panel.left`): source files, room artifacts, people, and public agents. */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { FolderOpen, Table2, FileText, StickyNote, Database, BookOpen, Upload, Loader2, ShieldCheck, Activity, MessageCircle, ArrowRight, type LucideIcon } from "lucide-react";
import { useStore } from "../app/store";
import type { Actor } from "../engine/types";
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

export function LeftRail({ roomId, me, artId, onPick, onOpenChat, style }: { roomId: string; me: Actor; artId: string; onPick: (id: string) => void; onOpenChat?: () => void; style?: CSSProperties }) {
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
  const hasQ3DemoSeed = arts.some((a) => a.kind === "sheet" && a.title === "Q3 variance");
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
    <div className="r-panel left" style={style} data-testid="left-rail">
      <div className="r-panel-head"><FolderOpen size={15} /><span className="h-title">Room Binder</span></div>
      <div className="r-rail">
        <div className="r-rail-section">
          <div className="kicker r-rail-kicker">Live room chat</div>
          <button
            type="button"
            className="r-sidebar-chat"
            data-testid="sidebar-chat-peek"
            onClick={onOpenChat}
            disabled={!onOpenChat}
            aria-label="Open sidebar chat"
          >
            <span className="r-sidebar-chat-ico"><MessageCircle size={14} /></span>
            <span className="r-sidebar-chat-title">
              <span>Room conversation</span>
              <em>{allPublicMessages.length ? `${allPublicMessages.length} messages` : "empty"}</em>
            </span>
            <span className="r-sidebar-chat-open"><ArrowRight size={13} /></span>
          </button>
        </div>

        <div className="r-rail-section">
          <div className="kicker r-rail-kicker">Workbooks & work products</div>
          {arts.map((a) => {
            const FI = fileIcon(a);
            return (
              <button
                key={a.id}
                className="r-file"
                data-active={String(a.id === artId)}
                data-testid="binder-artifact"
                data-artifact-id={a.id}
                data-artifact-kind={a.kind}
                draggable
                title="Drag into chat to reference this file"
                onClick={() => onPick(a.id)}
                onDragStart={(e) => dragArtifactRef(e, a)}
              >
                <span className="fi"><FI size={14} /></span>
                <span style={{ minWidth: 0 }}><div className="fn">{a.title}</div><div className="fm">{sub(a)}</div></span>
              </button>
            );
          })}
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
          {/* Inert reference row — r-file-static strips the clickable hover affordance it was
              borrowing from the real artifact buttons above (looks-clickable-must-act rule). */}
          {hasQ3DemoSeed && <div className="r-file r-file-static">
            <span className="fi"><Database size={14} /></span>
            <span><div className="fn">Data room exports</div><div className="fm">source · read-only</div></span>
          </div>}
        </div>

        <div className="r-rail-section">
          <div className="kicker r-rail-kicker">Review & proof</div>
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

        <div className="r-rail-section">
          <div className="kicker r-rail-kicker">People & agents · {members.length} live</div>
          {members.map((m) => {
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
          {sessions.filter((s) => s.scope === "public").map((s) => {
            const lock = locks.find((l) => l.sessionId === s.id);
            const range = lock ? rangeLabel(lock.elementIds) : "";
            const body = (
              <>
                <span className="r-avatar agent sm" style={{ background: "#d97757" }}>◆</span>
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
        </div>
      </div>
    </div>
  );
}

function dragArtifactRef(e: DragEvent<HTMLButtonElement>, artifact: { id: string; title: string; kind: string }) {
  const ref = { id: artifact.id, title: artifact.title, kind: artifact.kind };
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(ARTIFACT_REF_MIME, JSON.stringify(ref));
  e.dataTransfer.setData("text/plain", encodeArtifactRef(ref));
}

function rowCount(a: { order?: string[]; meta?: { excelGrid?: { rows: number } } }) {
  if (a.meta?.excelGrid) return a.meta.excelGrid.rows;
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
  return `${doc.mimeType || "file"} · ${formatBytes(doc.size)}`;
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
