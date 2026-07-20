import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import type { NodeSlideStudioShellActions } from "@nodeslide/react";
import type { DeckSnapshot } from "@nodeslide/contracts";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Download, FileDown, FileText, History, MessageCircle, MessageSquarePlus, Plus, RotateCcw, Save, ShieldAlert, Sparkles, Trash2, Users, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { ActorProof, PresenceClaim } from "../../app/store";
import type { Actor } from "../../engine/types";
import type { DeckSlidePlan, DeckStoryboard } from "./deckStoryboard";
import { addCollaborativeDeckSlide, cloneStoryboard, deckClaimElementId, deckSlideElementId, deleteCollaborativeDeckSlide, duplicateCollaborativeDeckSlide, moveCollaborativeDeckSlide, normalizeCollaborativeDeck, type DeckComment } from "./collaborativeDeck";
import { buildDeckPatchPlan, deckPatchPlanFileName, deckPatchPlanJson, deckPatchPlanMimeType, type DeckPatchItem } from "./deckPatchPlan";
import { buildDeckPreviewExport, deckPreviewFileName } from "./deckPreviewExport";
import { buildDeckPdfExport, deckPdfMimeType } from "./deckPdfExport";
import { buildDeckPptxExport, deckPptxMimeType } from "./deckPptxExport";
import {
  createNodeRoomNodeSlideReplaceTextCommand,
  nodeSlidePurposeElementId,
  nodeSlideTitleElementId,
} from "../../integrations/nodeslide/storyboardTranslation";

function slideStatusLabel(status: DeckSlidePlan["status"]): string {
  if (status === "needs_review") return "Needs review";
  if (status === "approved") return "Approved";
  return "Draft";
}

function claimStatusLabel(status: string): string {
  if (status === "verified") return "Verified";
  if (status === "needs_review") return "Needs review";
  return "Manual";
}

function patchStatusLabel(status: DeckPatchItem["status"]): string {
  return status === "ready_for_review" ? "Review" : "Needs source";
}

type DeckElementVersionRow = {
  _id: string;
  version: number;
  value: unknown;
  truncated: boolean;
  updatedBy: Actor;
  ts: number;
};
type DeckRestoreOutcome = { ok: true; version?: number } | { ok: false; reason: string };
type DeckHistoryListArgs = { roomId: string; artifactId: string; elementId: string; requester: ActorProof; limit?: number };
type DeckHistoryRestoreArgs = { roomId: string; artifactId: string; elementId: string; requester: ActorProof; version: number };
const deckHistoryApi = (api as unknown as {
  elementHistory: {
    listElementVersions: FunctionReference<"query", "public", DeckHistoryListArgs, DeckElementVersionRow[]>;
    restoreElementVersion: FunctionReference<"mutation", "public", DeckHistoryRestoreArgs, DeckRestoreOutcome>;
  };
}).elementHistory;

export function DeckStoryboardWorkbench({
  storyboard,
  artifactId,
  collaboratorCount = 0,
  onClose,
  onOpenArtifact,
  onSaveStoryboard,
  onRequestPatch,
  reviewableProposalIds = [],
  canResolvePatch = false,
  presences = [],
  comments = [],
  roomId,
  requester,
  onResolvePatch,
  onFocusSlide,
  onFocusObject,
  onAddComment,
  onResolveComment,
  nodeSlideMount,
}: {
  storyboard: DeckStoryboard;
  artifactId?: string;
  collaboratorCount?: number;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onSaveStoryboard?: (storyboard: DeckStoryboard, base: DeckStoryboard) => Promise<{ ok: boolean; reason?: string }>;
  onRequestPatch?: (prompt: string, slideId?: string) => Promise<{ ok: boolean; reason?: string }>;
  reviewableProposalIds?: string[];
  canResolvePatch?: boolean;
  presences?: PresenceClaim[];
  comments?: DeckComment[];
  roomId?: string;
  requester?: ActorProof;
  onResolvePatch?: (proposalId: string, approve: boolean) => Promise<{ ok: boolean; reason?: string }>;
  onFocusSlide?: (slideId: string | null) => void;
  onFocusObject?: (objectId: string | null) => void;
  onAddComment?: (slideId: string, body: string, targetObjectId?: string) => Promise<{ ok: boolean; reason?: string }>;
  onResolveComment?: (comment: DeckComment) => Promise<{ ok: boolean; reason?: string }>;
  nodeSlideMount?: {
    snapshot: DeckSnapshot;
    actions: NodeSlideStudioShellActions;
    busy: boolean;
  };
}): ReactElement {
  const [draft, setDraft] = useState(() => cloneStoryboard(storyboard));
  const [baseSnapshot, setBaseSnapshot] = useState(() => cloneStoryboard(storyboard));
  const [selectedSlideId, setSelectedSlideId] = useState(storyboard.slides[0]?.slideId ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [patchPrompt, setPatchPrompt] = useState("");
  const [patchSending, setPatchSending] = useState(false);
  const [resolvingPatchId, setResolvingPatchId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState<string | null>(null);
  const [collabMessage, setCollabMessage] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setDraft(cloneStoryboard(storyboard));
    setBaseSnapshot(cloneStoryboard(storyboard));
    setSelectedSlideId((current) => storyboard.slides.some((slide) => slide.slideId === current) ? current : storyboard.slides[0]?.slideId ?? "");
  }, [dirty, storyboard]);
  useEffect(() => {
    onFocusSlide?.(selectedSlideId || null);
    return () => onFocusSlide?.(null);
  }, [onFocusSlide, selectedSlideId]);
  useEffect(() => () => onFocusObject?.(null), [onFocusObject]);
  const needsReview = draft.storyboardStatus === "needs_review" || draft.requiredEvidence.length > 0;
  const preview = useMemo(() => buildDeckPreviewExport(draft), [draft]);
  const patchPlan = useMemo(() => buildDeckPatchPlan(draft), [draft]);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [pptxExporting, setPptxExporting] = useState(false);
  const firstSlide = draft.slides[0];
  const selectedSlide = draft.slides.find((slide) => slide.slideId === selectedSlideId) ?? firstSlide;
  const selectedSlideObjectId = selectedSlide ? deckSlideElementId(selectedSlide.slideId) : "";
  const selectedComments = comments.filter((comment) => comment.slideId === selectedSlide?.slideId);
  const selectedPresences = presences.filter((presence) => presence.targetId === selectedSlide?.slideId || presence.targetId === selectedSlideObjectId);
  const mountedTitleSource = selectedSlide && nodeSlideMount
    ? nodeSlideMount.snapshot.elements.find((element) => element.id === nodeSlideTitleElementId(selectedSlide.slideId))?.content
    : undefined;
  const mountedPurposeSource = selectedSlide && nodeSlideMount
    ? nodeSlideMount.snapshot.elements.find((element) => element.id === nodeSlidePurposeElementId(selectedSlide.slideId))?.content
    : undefined;
  const [mountedTitle, setMountedTitle] = useState("");
  const [mountedPurpose, setMountedPurpose] = useState("");
  useEffect(() => {
    setMountedTitle(typeof mountedTitleSource === "string" ? mountedTitleSource : selectedSlide?.title ?? "");
    setMountedPurpose(typeof mountedPurposeSource === "string" ? mountedPurposeSource : selectedSlide?.purpose ?? "");
  }, [mountedPurposeSource, mountedTitleSource, selectedSlide?.slideId]);
  const selectSlide = (slideId: string) => {
    setSelectedSlideId(slideId);
    nodeSlideMount?.actions.select({ slideId, elementIds: [] });
  };
  const updateDraft = (mutate: (next: DeckStoryboard) => void) => {
    setDraft((current) => {
      const next = cloneStoryboard(current);
      mutate(next);
      return next;
    });
    setDirty(true);
    setCollabMessage(null);
  };
  const replaceDraft = (next: DeckStoryboard, selectedId?: string) => {
    setDraft(next);
    if (selectedId) setSelectedSlideId(selectedId);
    setDirty(true);
    setCollabMessage(null);
  };
  const saveStoryboard = async () => {
    if (!onSaveStoryboard || saving) return;
    setSaving(true);
    setCollabMessage(null);
    try {
      const normalized = normalizeCollaborativeDeck(draft, Math.max(storyboard.version + 1, draft.version));
      const result = await onSaveStoryboard(normalized, baseSnapshot);
      if (result.ok) {
        setDraft(normalized);
        setBaseSnapshot(cloneStoryboard(normalized));
        setDirty(false);
        setSaveConflict(false);
        setCollabMessage(artifactId ? `Saved collaborative deck v${normalized.version}.` : "Collaborative deck created.");
      } else {
        setSaveConflict(result.reason?.startsWith("conflict") === true);
        setCollabMessage(result.reason?.startsWith("conflict") ? `A collaborator changed one of these deck objects (${result.reason}). No deck objects were applied; reload the latest objects before retrying.` : result.reason ?? "Deck save failed.");
      }
    } finally {
      setSaving(false);
    }
  };
  const requestPatch = async () => {
    const prompt = patchPrompt.trim();
    if (!prompt || !onRequestPatch || patchSending) return;
    setPatchSending(true);
    setCollabMessage(null);
    try {
      const result = await onRequestPatch(prompt, selectedSlide?.slideId);
      if (result.ok) {
        setPatchPrompt("");
        setCollabMessage("Patch request sent to NodeAgent with the current slide and deck receipt.");
      } else setCollabMessage(result.reason ?? "Patch request failed.");
    } finally {
      setPatchSending(false);
    }
  };
  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || !selectedSlide || !onAddComment || commentBusy) return;
    setCommentBusy("create");
    try {
      const result = await onAddComment(selectedSlide.slideId, body, selectedSlideObjectId);
      if (result.ok) {
        setCommentBody("");
        setCollabMessage("Comment added to the selected slide object.");
      } else setCollabMessage(result.reason ?? "Comment failed.");
    } finally {
      setCommentBusy(null);
    }
  };
  const resolveComment = async (comment: DeckComment) => {
    if (!onResolveComment || commentBusy) return;
    setCommentBusy(comment.commentId);
    try {
      const result = await onResolveComment(comment);
      setCollabMessage(result.ok ? "Comment resolved through object CAS." : result.reason ?? "Comment resolution failed.");
    } finally {
      setCommentBusy(null);
    }
  };
  const downloadPreview = () => {
    const fileName = deckPreviewFileName(draft.title, preview.integrityHash);
    const blob = new Blob([preview.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMessage(`Downloaded ${fileName}`);
  };
  const downloadPatchPlan = () => {
    const fileName = deckPatchPlanFileName(draft.title, patchPlan.integrityHash);
    const blob = new Blob([deckPatchPlanJson(patchPlan)], { type: deckPatchPlanMimeType() });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMessage(`Downloaded ${fileName}`);
  };
  const downloadPptx = async () => {
    setPptxExporting(true);
    try {
      const pptx = await buildDeckPptxExport(draft);
      const blob = new Blob([pptx.bytes as BlobPart], { type: deckPptxMimeType() });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = pptx.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(`Downloaded ${pptx.fileName}`);
    } finally {
      setPptxExporting(false);
    }
  };
  const downloadPdf = () => {
    const pdf = buildDeckPdfExport(draft);
    const blob = new Blob([pdf.bytes as BlobPart], { type: deckPdfMimeType() });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = pdf.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMessage(`Downloaded ${pdf.fileName}`);
  };
  const resolvePatch = async (proposalId: string, approve: boolean) => {
    if (!onResolvePatch || resolvingPatchId) return;
    setResolvingPatchId(proposalId);
    setCollabMessage(null);
    try {
      const result = await onResolvePatch(proposalId, approve);
      if (result.ok) {
        if (approve) setDirty(false);
        setCollabMessage(approve
          ? "Deck patch approved and applied through governed proposal review."
          : "Deck patch proposal rejected.");
      } else {
        setCollabMessage(result.reason === "conflict"
          ? "The deck changed after this patch was proposed. Re-run NodeAgent against the current version."
          : result.reason ?? "Deck patch review failed.");
      }
    } finally {
      setResolvingPatchId(null);
    }
  };

  return (
    <section className="wa-deck" data-testid="deck-storyboard-workbench" aria-label="Deck storyboard workbench">
      <header className="wa-deck-head">
        <div>
          <p className="wa-eyebrow">Storyboard-first deck</p>
          <h3>{draft.title}</h3>
          <p>{draft.objective}</p>
        </div>
        <div className="wa-deck-head-actions">
          <button type="button" className="wa-deck-export" data-testid="deck-preview-export-html" onClick={downloadPreview}>
            <Download size={13} />
            HTML
          </button>
          <button type="button" className="wa-deck-export" data-testid="deck-preview-export-pptx" onClick={() => void downloadPptx()} disabled={pptxExporting}>
            <FileDown size={13} />
            {pptxExporting ? "PPTX..." : "PPTX"}
          </button>
          <button type="button" className="wa-deck-export" data-testid="deck-preview-export-pdf" onClick={downloadPdf}>
            <FileDown size={13} />
            PDF
          </button>
          <button type="button" className="wa-deck-export" data-testid="deck-patch-plan-export-json" onClick={downloadPatchPlan}>
            <FileText size={13} />
            Patch JSON
          </button>
          {onSaveStoryboard && (
            <button type="button" className="wa-deck-export wa-deck-save" data-testid="deck-collaborative-save" disabled={!dirty || saving} onClick={() => void saveStoryboard()}>
              <Save size={13} />
              {saving ? "Saving..." : artifactId ? "Save" : "Make live"}
            </button>
          )}
          <button type="button" className="wa-deck-close" onClick={onClose} aria-label="Close storyboard">
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="wa-deck-meta">
        <span data-status={draft.storyboardStatus}>
          {needsReview ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
          {slideStatusLabel(draft.storyboardStatus)}
        </span>
        <span>v{draft.version}</span>
        <span>plan {draft.planHash}</span>
        <span>{draft.slides.length} slides</span>
        <span>{draft.traceIds.length} traces</span>
        <span data-testid="deck-collaborator-count"><Users size={11} /> {Math.max(1, collaboratorCount)} live</span>
        <span>preview {preview.integrityHash}</span>
        <span>patches {patchPlan.patchCount}</span>
      </div>
      {exportMessage && (
        <div className="wa-export-message" role="status" data-testid="deck-preview-export-status">
          {exportMessage}
          <button type="button" onClick={() => setExportMessage(null)}>Dismiss</button>
        </div>
      )}
      {collabMessage && (
        <div className="wa-export-message" role="status" data-testid="deck-collaboration-status">
          {collabMessage}
          {saveConflict && (
            <button type="button" onClick={() => {
              setDraft(cloneStoryboard(storyboard));
              setBaseSnapshot(cloneStoryboard(storyboard));
              setSelectedSlideId((current) => storyboard.slides.some((slide) => slide.slideId === current) ? current : storyboard.slides[0]?.slideId ?? "");
              setDirty(false);
              setSaveConflict(false);
              setCollabMessage("Reloaded the latest collaborative deck objects.");
            }}>Reload latest</button>
          )}
          <button type="button" onClick={() => setCollabMessage(null)}>Dismiss</button>
        </div>
      )}

      <div className="wa-deck-grid">
        <div className="wa-deck-slides" role="list" aria-label="Storyboard slides">
          {draft.slides.map((slide, index) => (
            <article key={slide.slideId} className="wa-deck-slide" role="listitem" data-status={slide.status} data-selected={String(selectedSlide?.slideId === slide.slideId)} data-testid="deck-storyboard-slide" onClick={() => selectSlide(slide.slideId)}>
              <div className="wa-deck-slide-num">{index + 1}</div>
              {presences.some((presence) => presence.targetId === slide.slideId || presence.targetId === deckSlideElementId(slide.slideId)) && (
                <div className="wa-deck-presence" aria-label={`People editing ${slide.title}`}>
                  {presences
                    .filter((presence) => presence.targetId === slide.slideId || presence.targetId === deckSlideElementId(slide.slideId))
                    .slice(0, 3)
                    .map((presence) => <span key={presence.id} title={`${presence.actor.name} is ${presence.mode === "edit" ? "editing" : "viewing"}`}>{presence.actor.name.slice(0, 1).toUpperCase()}</span>)}
                </div>
              )}
              <div className="wa-deck-slide-copy">
                <h4>{slide.title}</h4>
                <p>{slide.purpose}</p>
                <div className="wa-deck-claims">
                  {slide.claims.slice(0, 4).map((claim) => (
                    <div key={claim.claimId} className="wa-deck-claim" data-status={claim.status}>
                      <span>{claimStatusLabel(claim.status)}</span>
                      <p>{claim.text}</p>
                    </div>
                  ))}
                </div>
                {slide.unresolvedGaps.length > 0 && (
                  <div className="wa-deck-gaps">
                    {slide.unresolvedGaps.slice(0, 3).map((gap) => <span key={gap}>{gap}</span>)}
                  </div>
                )}
              </div>
              <div className="wa-deck-slide-actions">
                {slide.sourceArtifactIds.map((artifactId) => (
                  <button key={artifactId} type="button" onClick={() => onOpenArtifact(artifactId)}>
                    <FileText size={12} /> Source
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>

        <aside className="wa-deck-side">
          <div className="wa-deck-side-card">
            <h4><Sparkles size={13} /> Evidence Required</h4>
            {draft.requiredEvidence.length > 0 ? (
              <ul>
                {draft.requiredEvidence.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p>All storyboard claims are currently evidence-backed.</p>
            )}
          </div>
          <div className="wa-deck-side-card wa-deck-preview" data-testid="deck-preview-card">
            <h4>Slide Preview</h4>
            {firstSlide ? (
              <>
                <span>{preview.slideCount} slides - {preview.needsReviewCount} review</span>
                <strong>{firstSlide.title}</strong>
                <p>{firstSlide.purpose}</p>
              </>
            ) : (
              <p>No slides available.</p>
            )}
          </div>
          {selectedSlide && onSaveStoryboard && (
            <div className="wa-deck-side-card wa-deck-editor" data-testid="deck-collaborative-editor">
              <div className="wa-deck-editor-head">
                <h4>Slide {draft.slides.findIndex((slide) => slide.slideId === selectedSlide.slideId) + 1}</h4>
                <div>
                  <button type="button" aria-label="Move slide left" title="Move slide left" onClick={() => replaceDraft(moveCollaborativeDeckSlide(draft, selectedSlide.slideId, -1))}><ArrowLeft size={12} /></button>
                  <button type="button" aria-label="Move slide right" title="Move slide right" onClick={() => replaceDraft(moveCollaborativeDeckSlide(draft, selectedSlide.slideId, 1))}><ArrowRight size={12} /></button>
                  <button type="button" aria-label="Duplicate slide" title="Duplicate slide" onClick={() => {
                    const next = duplicateCollaborativeDeckSlide(draft, selectedSlide.slideId);
                    const duplicate = next.slides[draft.slides.findIndex((slide) => slide.slideId === selectedSlide.slideId) + 1];
                    replaceDraft(next, duplicate?.slideId);
                  }}><Copy size={12} /></button>
                  <button type="button" aria-label="Delete slide" title="Delete slide" disabled={draft.slides.length <= 1} onClick={() => {
                    const index = draft.slides.findIndex((slide) => slide.slideId === selectedSlide.slideId);
                    const next = deleteCollaborativeDeckSlide(draft, selectedSlide.slideId);
                    replaceDraft(next, next.slides[Math.min(index, next.slides.length - 1)]?.slideId);
                  }}><Trash2 size={12} /></button>
                  <button type="button" aria-label="Add slide" title="Add slide" onClick={() => {
                    const next = addCollaborativeDeckSlide(draft, selectedSlide.slideId);
                    const index = next.slides.findIndex((slide) => slide.slideId === selectedSlide.slideId);
                    replaceDraft(next, next.slides[index + 1]?.slideId);
                  }}><Plus size={12} /></button>
                </div>
              </div>
              {selectedPresences.length > 0 && (
                <div className="wa-deck-active-editors" data-testid="deck-active-editors">
                  {selectedPresences.map((presence) => <span key={presence.id}><Users size={10} /> {presence.actor.name}</span>)}
                </div>
              )}
              <label>Title<input value={selectedSlide.title} onFocus={() => onFocusObject?.(selectedSlideObjectId)} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.title = event.target.value; })} /></label>
              <label>Purpose<textarea rows={2} value={selectedSlide.purpose} onFocus={() => onFocusObject?.(selectedSlideObjectId)} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.purpose = event.target.value; })} /></label>
              {nodeSlideMount && (
                <div className="wa-deck-mounted-actions" data-testid="nodeslide-mounted-actions">
                  <span>NodeSlide 0.2.0 controlled boundary</span>
                  <label>
                    NodeSlide title command
                    <input
                      data-testid="nodeslide-mounted-title"
                      value={mountedTitle}
                      onChange={(event) => setMountedTitle(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!nodeSlideMount.actions.canPatch || nodeSlideMount.busy || !mountedTitle.trim()}
                    onClick={() => nodeSlideMount.actions.patch(createNodeRoomNodeSlideReplaceTextCommand({
                      snapshot: nodeSlideMount.snapshot,
                      slideId: selectedSlide.slideId,
                      elementId: nodeSlideTitleElementId(selectedSlide.slideId),
                      text: mountedTitle,
                      source: "human",
                      summary: `Apply the host title edit for ${selectedSlide.slideId}`,
                    }))}
                  >
                    Apply title through NodeSlide
                  </button>
                  <label>
                    NodeSlide purpose proposal
                    <textarea
                      data-testid="nodeslide-mounted-purpose"
                      rows={2}
                      value={mountedPurpose}
                      onChange={(event) => setMountedPurpose(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!nodeSlideMount.actions.canPropose || nodeSlideMount.busy || !mountedPurpose.trim()}
                    onClick={() => nodeSlideMount.actions.propose(createNodeRoomNodeSlideReplaceTextCommand({
                      snapshot: nodeSlideMount.snapshot,
                      slideId: selectedSlide.slideId,
                      elementId: nodeSlidePurposeElementId(selectedSlide.slideId),
                      text: mountedPurpose,
                      source: "human",
                      summary: `Propose the purpose edit for ${selectedSlide.slideId}`,
                    }))}
                  >
                    Propose purpose for review
                  </button>
                </div>
              )}
              <div className="wa-deck-editor-claims">
                <span>Claims</span>
                {selectedSlide.claims.map((claim) => (
                  <div key={claim.claimId} className="wa-deck-editor-claim">
                    <textarea rows={2} value={claim.text} onFocus={() => onFocusObject?.(deckClaimElementId(claim.claimId))} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.claims.find((item) => item.claimId === claim.claimId)!.text = event.target.value; })} />
                    <select value={claim.status} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.claims.find((item) => item.claimId === claim.claimId)!.status = event.target.value as typeof claim.status; })}>
                      <option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="manual">Manual</option>
                    </select>
                    <button type="button" aria-label="Remove claim" onClick={() => updateDraft((next) => { const slide = next.slides.find((item) => item.slideId === selectedSlide.slideId)!; slide.claims = slide.claims.filter((item) => item.claimId !== claim.claimId); })}><X size={11} /></button>
                  </div>
                ))}
                <button type="button" className="wa-deck-editor-add" onClick={() => updateDraft((next) => { const slide = next.slides.find((item) => item.slideId === selectedSlide.slideId)!; slide.claims.push({ claimId: `${slide.slideId}-claim-${Date.now().toString(36)}`, text: "New claim", status: "needs_review" }); })}><Plus size={11} /> Claim</button>
              </div>
              <label>Open gaps<textarea rows={3} value={selectedSlide.unresolvedGaps.join("\n")} onFocus={() => onFocusObject?.(selectedSlideObjectId)} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.unresolvedGaps = event.target.value.split("\n").map((item) => item.trim()).filter(Boolean); })} /></label>
            </div>
          )}
          {selectedSlide && artifactId && (
            <div className="wa-deck-side-card wa-deck-comments" data-testid="deck-comments">
              <h4><MessageCircle size={13} /> Comments <span>{selectedComments.filter((comment) => comment.status === "open").length} open</span></h4>
              {selectedComments.length > 0 ? (
                <div className="wa-deck-comment-list">
                  {selectedComments.map((comment) => (
                    <article key={comment.commentId} data-status={comment.status}>
                      <div><strong>{comment.author.name}</strong><span>{comment.status}</span></div>
                      <p>{comment.body}</p>
                      {comment.status === "open" && onResolveComment && (
                        <button type="button" disabled={commentBusy !== null} onClick={() => void resolveComment(comment)}>
                          <CheckCircle2 size={11} /> {commentBusy === comment.commentId ? "Resolving..." : "Resolve"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              ) : <p>No comments on this slide.</p>}
              {onAddComment && (
                <div className="wa-deck-comment-compose">
                  <textarea rows={2} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Comment on this slide..." />
                  <button type="button" disabled={!commentBody.trim() || commentBusy !== null} onClick={() => void addComment()}>
                    <MessageSquarePlus size={11} /> {commentBusy === "create" ? "Adding..." : "Add comment"}
                  </button>
                </div>
              )}
            </div>
          )}
          {selectedSlide && artifactId && roomId && requester && (
            <DeckObjectHistory
              roomId={roomId}
              artifactId={artifactId}
              elementId={selectedSlideObjectId}
              requester={requester}
              currentValue={selectedSlide}
              onStatus={setCollabMessage}
            />
          )}
          {onRequestPatch && (
            <div className="wa-deck-side-card wa-deck-request" data-testid="deck-nodeagent-patch-request">
              <h4><MessageSquarePlus size={13} /> Request Patch</h4>
              <textarea rows={3} value={patchPrompt} onChange={(event) => setPatchPrompt(event.target.value)} placeholder="Ask NodeAgent to revise this slide with room evidence..." />
              <button type="button" disabled={!patchPrompt.trim() || patchSending} onClick={() => void requestPatch()}>{patchSending ? "Sending..." : "Send to NodeAgent"}</button>
            </div>
          )}
          <div className="wa-deck-side-card wa-deck-patch-plan" data-testid="deck-patch-plan">
            <h4><ShieldAlert size={13} /> Patch Plan</h4>
            <div className="wa-deck-patch-metrics">
              <span><b>{patchPlan.patchCount}</b> patches</span>
              <span><b>{patchPlan.readyForReviewCount}</b> review</span>
              <span><b>{patchPlan.needsSourceCount}</b> source</span>
            </div>
            {patchPlan.items.length > 0 ? (
              <div className="wa-deck-patch-list" role="list" aria-label="Deck patch plan">
                {patchPlan.items.slice(0, 5).map((item) => (
                  <article key={item.patchId} className="wa-deck-patch-item" role="listitem" data-status={item.status}>
                    <div className="wa-deck-patch-title">
                      <span>{item.title}</span>
                      <span>{patchStatusLabel(item.status)}</span>
                    </div>
                    <p>{item.reason}</p>
                    <div className="wa-deck-patch-diff">
                      <span>Before</span>
                      <p>{item.beforeText}</p>
                      <span>After</span>
                      <p>{item.afterText}</p>
                    </div>
                    {item.sourceArtifactIds[0] && (
                      <button type="button" onClick={() => onOpenArtifact(item.sourceArtifactIds[0])}>
                        <FileText size={12} /> Source
                      </button>
                    )}
                    {item.proposalId && reviewableProposalIds.includes(item.proposalId) && onResolvePatch && (
                      <div className="wa-deck-patch-actions" data-testid="deck-governed-patch-actions">
                        <button type="button" disabled={!canResolvePatch || Boolean(resolvingPatchId)} title={canResolvePatch ? "Approve and apply deck patch" : "Only the host can resolve proposals"} onClick={() => void resolvePatch(item.proposalId!, true)}>
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button type="button" disabled={!canResolvePatch || Boolean(resolvingPatchId)} title={canResolvePatch ? "Reject deck patch" : "Only the host can resolve proposals"} onClick={() => void resolvePatch(item.proposalId!, false)}>
                          <X size={12} /> Reject
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p>No reviewer-requested deck patches are currently needed.</p>
            )}
          </div>
          <div className="wa-deck-side-card">
            <h4>Receipt</h4>
            <p>{draft.sourceArtifactIds.length} source artifacts</p>
            <p>{draft.proposalIds.length} proposals</p>
            <p>{draft.traceIds.length} trace receipts</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function DeckObjectHistory({ roomId, artifactId, elementId, requester, currentValue, onStatus }: {
  roomId: string;
  artifactId: string;
  elementId: string;
  requester: ActorProof;
  currentValue: unknown;
  onStatus: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const rows = useQuery(deckHistoryApi.listElementVersions, open ? { roomId, artifactId, elementId, requester, limit: 8 } : "skip");
  const restore = useMutation(deckHistoryApi.restoreElementVersion);
  const restoreVersion = async (version: number) => {
    setBusyVersion(version);
    try {
      const result = await restore({ roomId, artifactId, elementId, requester, version });
      if (result.ok) {
        onStatus(`Restored slide object from v${version} as a new CAS version.`);
        setOpen(false);
      } else onStatus(result.reason === "conflict" ? "Restore conflicted with a newer slide edit. Refresh before retrying." : result.reason);
    } catch {
      onStatus("Slide restore failed.");
    } finally {
      setBusyVersion(null);
    }
  };
  return (
    <div className="wa-deck-side-card wa-deck-history" data-testid="deck-object-history">
      <h4><History size={13} /> Object history <span>{elementId.replace("deck:slide:", "")}</span></h4>
      <button type="button" className="wa-deck-history-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <RotateCcw size={11} /> {open ? "Hide versions" : "Show versions"}
      </button>
      {open && (
        <div className="wa-deck-history-list">
          {rows === undefined && <p>Loading history...</p>}
          {rows?.length === 0 && <p>No overwritten versions yet.</p>}
          {rows?.map((row) => (
            <article key={row._id}>
              <div><strong>v{row.version}</strong><span>{row.updatedBy.name} - {deckHistoryAge(row.ts)}</span></div>
              <p title={deckHistoryPreview(row.value)}>{deckHistoryPreview(row.value)}</p>
              <button type="button" disabled={row.truncated || busyVersion !== null} title={row.truncated ? "Truncated snapshots cannot be restored" : `Restore v${row.version} as a new version`} onClick={() => void restoreVersion(row.version)}>
                <RotateCcw size={10} /> {busyVersion === row.version ? "Restoring..." : "Restore"}
              </button>
            </article>
          ))}
          {rows && rows.length > 0 && <p className="wa-deck-history-now">Current: {deckHistoryPreview(currentValue)}</p>}
        </div>
      )}
    </div>
  );
}

function deckHistoryPreview(value: unknown): string {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const title = record && typeof record.title === "string" ? record.title : "";
  const purpose = record && typeof record.purpose === "string" ? record.purpose : "";
  const text = (title || purpose) ? `${title}${title && purpose ? " - " : ""}${purpose}` : typeof value === "string" ? value : JSON.stringify(value);
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 180) || "Empty object";
}

function deckHistoryAge(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
