import { useState, type ReactElement } from "react";
import { BookOpen, Calculator, CheckCircle2, FileText, Layers3, LoaderCircle, Play, ShieldAlert, X } from "lucide-react";
import type { Proposal } from "../../engine/types";
import type { NotebookArtifactStructure } from "./notebookStructure";
import { buildNotebookExecutionPreview } from "./notebookExecutionPreview";
import type { NotebookExecutionPreviewItem } from "./notebookExecutionPreview";
import type { NotebookKernelStoredOutput } from "./notebookKernelAdapter";
import { buildNotebookPatchDiff, type NotebookPatchDiff } from "./notebookPatchDiff";
import { classifyNotebookTypedBlocks, summarizeNotebookTypedBlocks, type NotebookTypedBlockKind } from "./notebookTypedBlocks";

export interface NotebookDigestStats {
  blocks: number;
  sections: number;
  agentBlocks: number;
  humanBlocks: number;
  reviewBlocks: number;
  sources: number;
  traces: number;
  proposals: number;
  statusLabel: string;
}

export interface NotebookPatchPreviewItem {
  proposalId: string;
  status: Proposal["status"];
  elementId?: string;
  blockId?: string;
  blockText?: string;
  valuePreview: string;
  diff: NotebookPatchDiff;
}

function statusLabel(status: NotebookArtifactStructure["status"]): string {
  if (status === "needs_review" || status === "pending") return "Needs review";
  if (status === "ready" || status === "approved") return "Ready";
  if (status === "failed" || status === "rejected") return "Failed";
  if (status === "running") return "Running";
  return "Empty";
}

function blockStatusLabel(status: string): string {
  if (status === "needs_review") return "Review";
  if (status === "accepted") return "Accepted";
  return "Draft";
}

function typeLabel(type: NotebookTypedBlockKind): string {
  return type.replace(/_/g, " ");
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 140);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "value" in value) return previewValue((value as { value?: unknown }).value);
  if (value && typeof value === "object" && "text" in value && typeof (value as { text?: unknown }).text === "string") {
    return previewValue((value as { text: string }).text);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value).slice(0, 140);
}

export function notebookDigestStats(structure: NotebookArtifactStructure): NotebookDigestStats {
  return {
    blocks: structure.blockCount,
    sections: structure.sectionCount,
    agentBlocks: structure.agentBlockCount,
    humanBlocks: structure.humanBlockCount,
    reviewBlocks: structure.needsReviewCount,
    sources: structure.sourceIds.length,
    traces: structure.traceIds.length,
    proposals: structure.proposalIds.length,
    statusLabel: statusLabel(structure.status),
  };
}

export function buildNotebookPatchPreviewItems(
  structure: NotebookArtifactStructure,
  proposals: Proposal[] = [],
): NotebookPatchPreviewItem[] {
  return proposals
    .filter((proposal) => proposal.artifactId === structure.artifactId)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map((proposal) => {
      const block = structure.blocks.find((candidate) =>
        candidate.elementId === proposal.op.elementId ||
        candidate.blockId === proposal.op.elementId ||
        candidate.id === proposal.op.elementId);
      const valuePreview = previewValue(proposal.op.value) || proposal.op.kind;
      return {
        proposalId: proposal.id,
        status: proposal.status,
        elementId: proposal.op.elementId,
        blockId: block?.blockId,
        blockText: block?.text,
        valuePreview,
        diff: buildNotebookPatchDiff(block?.text, valuePreview),
      };
    });
}

function renderDiff(parts: NotebookPatchDiff["parts"], mode: "before" | "after"): ReactElement[] {
  return parts
    .filter((part) => (mode === "before" ? part.kind !== "added" : part.kind !== "removed"))
    .map((part, index) => (
      <span key={`${mode}:${index}`} data-kind={part.kind}>{part.text}</span>
    ));
}

export function NotebookDigestWorkbench({
  structure,
  proposals = [],
  kernelOutputs = {},
  onClose,
  onOpenArtifact,
  onExecuteKernel,
}: {
  structure: NotebookArtifactStructure;
  proposals?: Proposal[];
  kernelOutputs?: Record<string, NotebookKernelStoredOutput>;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onExecuteKernel?: (item: NotebookExecutionPreviewItem) => Promise<{ ok: boolean; reason?: string }>;
}): ReactElement {
  const [runningKernelId, setRunningKernelId] = useState<string | null>(null);
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const stats = notebookDigestStats(structure);
  const patchPreviews = buildNotebookPatchPreviewItems(structure, proposals);
  const typedBlocks = classifyNotebookTypedBlocks(structure);
  const typedById = new Map(typedBlocks.map((block) => [block.id, block]));
  const typedSummary = summarizeNotebookTypedBlocks(structure);
  const executionPreview = buildNotebookExecutionPreview(structure);
  const visibleBlocks = structure.blocks.slice(0, 48);
  const hiddenBlocks = Math.max(0, structure.blocks.length - visibleBlocks.length);
  const needsReview = structure.status === "needs_review" || structure.proposalIds.length > 0;
  const executeKernel = async (item: NotebookExecutionPreviewItem) => {
    if (!onExecuteKernel || runningKernelId) return;
    setRunningKernelId(item.id);
    setKernelMessage(null);
    try {
      const feedback = await onExecuteKernel(item);
      setKernelMessage(feedback.ok ? `${item.kind} output persisted to the notebook receipt.` : feedback.reason ?? "Kernel execution failed.");
    } finally {
      setRunningKernelId(null);
    }
  };

  return (
    <section className="wa-notebook" data-testid="notebook-digest-workbench" aria-label="Notebook digest workbench">
      <header className="wa-notebook-head">
        <div>
          <p className="wa-eyebrow">Notebook digest</p>
          <h3>{structure.title}</h3>
          <p>{structure.summary || "No notebook blocks have been captured yet."}</p>
        </div>
        <div className="wa-notebook-head-actions">
          <button type="button" className="wa-notebook-open" onClick={() => onOpenArtifact(structure.artifactId)} data-testid="notebook-digest-open-editor">
            <BookOpen size={13} />
            Open editor
          </button>
          <button type="button" className="wa-deck-close" onClick={onClose} aria-label="Close notebook digest">
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="wa-notebook-meta">
        <span data-status={structure.status}>
          {needsReview ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
          {stats.statusLabel}
        </span>
        <span>{stats.blocks} blocks</span>
        <span>{stats.sections} sections</span>
        <span>{stats.agentBlocks} agent</span>
        <span>{stats.humanBlocks} human</span>
        <span>{stats.sources} sources</span>
        <span>{stats.traces} traces</span>
        <span>{stats.proposals} proposals</span>
      </div>

      <div className="wa-notebook-grid">
        <div className="wa-notebook-blocks" role="list" aria-label="Notebook blocks">
          {visibleBlocks.map((block) => (
            <article
              key={`${block.elementId}:${block.id}`}
              className="wa-notebook-block"
              role="listitem"
              data-status={block.status}
              data-role={block.role}
              data-testid="notebook-digest-block"
            >
              <div className="wa-notebook-block-index">{block.index + 1}</div>
              <div className="wa-notebook-block-copy">
                <div className="wa-notebook-block-meta">
                  <span>{block.kind.replace("_", " ")}</span>
                  <span data-type={typedById.get(block.id)?.type}>{typeLabel(typedById.get(block.id)?.type ?? "text")}</span>
                  <span>{block.role}</span>
                  <span data-status={block.status}>{blockStatusLabel(block.status)}</span>
                </div>
                <p>{block.text}</p>
                {(block.sourceIds.length > 0 || block.traceIds.length > 0 || block.proposalIds.length > 0) && (
                  <div className="wa-notebook-block-receipts">
                    {block.sourceIds.length > 0 && <span>{block.sourceIds.length} sources</span>}
                    {block.traceIds.length > 0 && <span>{block.traceIds.length} traces</span>}
                    {block.proposalIds.length > 0 && <span>{block.proposalIds.length} proposals</span>}
                  </div>
                )}
              </div>
            </article>
          ))}
          {hiddenBlocks > 0 && (
            <div className="wa-notebook-more" data-testid="notebook-digest-hidden-blocks">
              {hiddenBlocks} more blocks available in the editor
            </div>
          )}
        </div>

        <aside className="wa-notebook-side">
          <div className="wa-notebook-side-card">
            <h4><ShieldAlert size={13} /> Patch Previews</h4>
            {patchPreviews.length > 0 ? (
              <div className="wa-notebook-patch-list">
                {patchPreviews.slice(0, 8).map((patch) => (
                  <div key={patch.proposalId} className="wa-notebook-patch" data-status={patch.status} data-testid="notebook-patch-preview">
                    <span>{patch.status} - {patch.blockId ?? patch.elementId ?? "notebook"}</span>
                    {patch.blockText && <p>{patch.blockText}</p>}
                    <strong>{patch.valuePreview}</strong>
                    {patch.diff.changed && (
                      <div className="wa-notebook-diff" data-testid="notebook-patch-diff">
                        <div className="wa-notebook-diff-row" data-mode="before">
                          <span>Before</span>
                          <p>{renderDiff(patch.diff.parts, "before")}</p>
                        </div>
                        <div className="wa-notebook-diff-row" data-mode="after">
                          <span>After</span>
                          <p>{renderDiff(patch.diff.parts, "after")}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p data-testid="notebook-patch-preview-empty">No pending notebook patches.</p>
            )}
          </div>
          <div className="wa-notebook-side-card">
            <h4><Layers3 size={13} /> Block Types</h4>
            <div className="wa-notebook-type-list" data-testid="notebook-type-summary">
              {Object.entries(typedSummary.counts).map(([type, count]) => (
                <span key={type} data-type={type}>{typeLabel(type as NotebookTypedBlockKind)} {count}</span>
              ))}
              {typedSummary.total === 0 && <p>No typed blocks detected.</p>}
            </div>
          </div>
          <div className="wa-notebook-side-card" data-testid="notebook-execution-preview">
            <h4><Calculator size={13} /> Execution Preview</h4>
            <div className="wa-notebook-exec-metrics">
              <span><b>{executionPreview.executableCount}</b> executable</span>
              <span><b>{executionPreview.readyCount}</b> ready</span>
              <span><b>{executionPreview.blockedCount}</b> blocked</span>
            </div>
            {executionPreview.items.length > 0 ? (
              <div className="wa-notebook-exec-list">
                {executionPreview.items.slice(0, 8).map((item) => (
                  <div key={item.id} className="wa-notebook-exec-item" data-kind={item.kind} data-status={item.status} data-testid="notebook-execution-preview-item">
                    <div className="wa-notebook-exec-title">
                      <span>{item.kind}</span>
                      <span>{item.status}</span>
                    </div>
                    <p>{item.input}</p>
                    <strong>{item.result}</strong>
                    <div className="wa-notebook-exec-refs">
                      <span>{item.reason}</span>
                      <span>{item.sourceIds.length} sources</span>
                      <span>{item.proposalIds.length} proposals</span>
                    </div>
                    {onExecuteKernel && (
                      <button type="button" className="wa-notebook-exec-run" data-testid="notebook-kernel-run" disabled={item.status !== "ready" || runningKernelId !== null} onClick={() => void executeKernel(item)}>
                        {runningKernelId === item.id ? <LoaderCircle size={11} className="wa-spin" /> : <Play size={11} />}
                        {runningKernelId === item.id ? "Running" : "Run"}
                      </button>
                    )}
                    {(() => {
                      const output = kernelOutputs[item.blockId];
                      if (!output) return null;
                      return (
                        <div className="wa-notebook-kernel-output" data-status={output.result.status} data-testid="notebook-kernel-output">
                          <div><span>{output.result.receipt.backend} kernel</span><span>{output.result.receipt.outputHash}</span></div>
                          <strong>{output.result.outputText}</strong>
                          {output.result.rows && (
                            <pre>{JSON.stringify(output.result.rows.slice(0, 4), null, 2)}</pre>
                          )}
                          {output.result.chart && (
                            <p>{output.result.chart.type} - {output.result.chart.y} by {output.result.chart.x} - {output.result.chart.points.length} points</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <p>No executable notebook blocks detected.</p>
            )}
            {kernelMessage && <div className="wa-notebook-kernel-message" role="status" data-testid="notebook-kernel-status">{kernelMessage}</div>}
          </div>
          <div className="wa-notebook-side-card">
            <h4><Layers3 size={13} /> Sections</h4>
            {structure.sections.length > 0 ? (
              <div className="wa-notebook-section-list">
                {structure.sections.slice(0, 10).map((section) => (
                  <div key={section.id} className="wa-notebook-section" data-testid="notebook-digest-section">
                    <span>{section.title}</span>
                    <p>{section.blockCount} blocks - {section.agentBlockCount} agent - {section.needsReviewCount} review</p>
                  </div>
                ))}
              </div>
            ) : (
              <p>No sections detected.</p>
            )}
          </div>
          <div className="wa-notebook-side-card">
            <h4><FileText size={13} /> Source IDs</h4>
            {structure.sourceIds.length > 0 ? (
              <div className="wa-notebook-source-list">
                {structure.sourceIds.slice(0, 10).map((sourceId) => (
                  <span key={sourceId} data-testid="notebook-digest-source">{sourceId}</span>
                ))}
              </div>
            ) : (
              <p>No source references detected.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
