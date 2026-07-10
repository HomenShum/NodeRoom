import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Download, FileDown, FileText, MessageSquarePlus, Plus, Save, ShieldAlert, Sparkles, Trash2, Users, X } from "lucide-react";
import type { DeckSlidePlan, DeckStoryboard } from "./deckStoryboard";
import { addCollaborativeDeckSlide, cloneStoryboard, deleteCollaborativeDeckSlide, duplicateCollaborativeDeckSlide, moveCollaborativeDeckSlide, normalizeCollaborativeDeck } from "./collaborativeDeck";
import { buildDeckPatchPlan, deckPatchPlanFileName, deckPatchPlanJson, deckPatchPlanMimeType, type DeckPatchItem } from "./deckPatchPlan";
import { buildDeckPreviewExport, deckPreviewFileName } from "./deckPreviewExport";
import { buildDeckPdfExport, deckPdfMimeType } from "./deckPdfExport";
import { buildDeckPptxExport, deckPptxMimeType } from "./deckPptxExport";

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

export function DeckStoryboardWorkbench({
  storyboard,
  artifactId,
  collaboratorCount = 0,
  onClose,
  onOpenArtifact,
  onSaveStoryboard,
  onRequestPatch,
  onFocusSlide,
}: {
  storyboard: DeckStoryboard;
  artifactId?: string;
  collaboratorCount?: number;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onSaveStoryboard?: (storyboard: DeckStoryboard) => Promise<{ ok: boolean; reason?: string }>;
  onRequestPatch?: (prompt: string, slideId?: string) => Promise<{ ok: boolean; reason?: string }>;
  onFocusSlide?: (slideId: string | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState(() => cloneStoryboard(storyboard));
  const [selectedSlideId, setSelectedSlideId] = useState(storyboard.slides[0]?.slideId ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [patchPrompt, setPatchPrompt] = useState("");
  const [patchSending, setPatchSending] = useState(false);
  const [collabMessage, setCollabMessage] = useState<string | null>(null);
  useEffect(() => {
    if (dirty) return;
    setDraft(cloneStoryboard(storyboard));
    setSelectedSlideId((current) => storyboard.slides.some((slide) => slide.slideId === current) ? current : storyboard.slides[0]?.slideId ?? "");
  }, [dirty, storyboard]);
  useEffect(() => {
    onFocusSlide?.(selectedSlideId || null);
    return () => onFocusSlide?.(null);
  }, [onFocusSlide, selectedSlideId]);
  const needsReview = draft.storyboardStatus === "needs_review" || draft.requiredEvidence.length > 0;
  const preview = useMemo(() => buildDeckPreviewExport(draft), [draft]);
  const patchPlan = useMemo(() => buildDeckPatchPlan(draft), [draft]);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [pptxExporting, setPptxExporting] = useState(false);
  const firstSlide = draft.slides[0];
  const selectedSlide = draft.slides.find((slide) => slide.slideId === selectedSlideId) ?? firstSlide;
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
      const result = await onSaveStoryboard(normalized);
      if (result.ok) {
        setDraft(normalized);
        setDirty(false);
        setCollabMessage(artifactId ? `Saved collaborative deck v${normalized.version}.` : "Collaborative deck created.");
      } else {
        setCollabMessage(result.reason === "conflict" ? "A collaborator changed this deck. Review the refreshed version, then apply your edit again." : result.reason ?? "Deck save failed.");
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
          <button type="button" onClick={() => setCollabMessage(null)}>Dismiss</button>
        </div>
      )}

      <div className="wa-deck-grid">
        <div className="wa-deck-slides" role="list" aria-label="Storyboard slides">
          {draft.slides.map((slide, index) => (
            <article key={slide.slideId} className="wa-deck-slide" role="listitem" data-status={slide.status} data-selected={String(selectedSlide?.slideId === slide.slideId)} data-testid="deck-storyboard-slide" onClick={() => setSelectedSlideId(slide.slideId)}>
              <div className="wa-deck-slide-num">{index + 1}</div>
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
            {storyboard.requiredEvidence.length > 0 ? (
              <ul>
                {storyboard.requiredEvidence.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
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
              <label>Title<input value={selectedSlide.title} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.title = event.target.value; })} /></label>
              <label>Purpose<textarea rows={2} value={selectedSlide.purpose} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.purpose = event.target.value; })} /></label>
              <div className="wa-deck-editor-claims">
                <span>Claims</span>
                {selectedSlide.claims.map((claim) => (
                  <div key={claim.claimId} className="wa-deck-editor-claim">
                    <textarea rows={2} value={claim.text} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.claims.find((item) => item.claimId === claim.claimId)!.text = event.target.value; })} />
                    <select value={claim.status} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.claims.find((item) => item.claimId === claim.claimId)!.status = event.target.value as typeof claim.status; })}>
                      <option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="manual">Manual</option>
                    </select>
                    <button type="button" aria-label="Remove claim" onClick={() => updateDraft((next) => { const slide = next.slides.find((item) => item.slideId === selectedSlide.slideId)!; slide.claims = slide.claims.filter((item) => item.claimId !== claim.claimId); })}><X size={11} /></button>
                  </div>
                ))}
                <button type="button" className="wa-deck-editor-add" onClick={() => updateDraft((next) => { const slide = next.slides.find((item) => item.slideId === selectedSlide.slideId)!; slide.claims.push({ claimId: `${slide.slideId}-claim-${Date.now().toString(36)}`, text: "New claim", status: "needs_review" }); })}><Plus size={11} /> Claim</button>
              </div>
              <label>Open gaps<textarea rows={3} value={selectedSlide.unresolvedGaps.join("\n")} onChange={(event) => updateDraft((next) => { next.slides.find((slide) => slide.slideId === selectedSlide.slideId)!.unresolvedGaps = event.target.value.split("\n").map((item) => item.trim()).filter(Boolean); })} /></label>
            </div>
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
