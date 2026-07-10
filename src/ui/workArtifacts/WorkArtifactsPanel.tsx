import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Archive, Bot, CheckCircle2, Clock3, Download, FileDown, GitPullRequest, Network, Search, ShieldAlert, Sparkles } from "lucide-react";
import { useStore } from "../../app/store";
import type { Actor, Artifact, Proposal, TraceEvent } from "../../engine/types";
import { buildSemanticGraph } from "../graph/semanticGraph";
import { buildDeckStoryboardFromRoom, buildLivePerformanceSummary, buildNotebookArtifactStructure, buildNotebookKernelTables, buildProofBundleExportManifest, buildProofBundleReceipt, buildTraceReplaySummary, buildWorkArtifacts, collaborativeDeckArtifactInput, deckArtifactInputFromStoryboard, isCollaborativeDeckArtifact, notebookKernelOutputElementId, proofBundleManifestFileName, proofBundleManifestJson, readCollaborativeDeckArtifact, readNotebookKernelOutputs, DECK_STORYBOARD_ELEMENT_ID, type DeckStoryboard, type WorkArtifactKind, type WorkArtifactStatus, type WorkArtifactViewModel } from ".";
import { DeckStoryboardWorkbench } from "./DeckStoryboardWorkbench";
import { GraphRelationshipReviewWorkbench } from "./GraphRelationshipReviewWorkbench";
import { LivePerformanceCenter } from "./LivePerformanceCenter";
import { NotebookDigestWorkbench } from "./NotebookDigestWorkbench";
import { ProposalReviewCenter } from "./ProposalReviewCenter";
import { TraceReplayWorkbench } from "./TraceReplayWorkbench";
import "./work-artifacts.css";

const KIND_LABEL: Record<WorkArtifactKind, string> = {
  spreadsheet: "Spreadsheet",
  notebook: "Notebook",
  wall: "Wall",
  deck: "Deck",
  graph: "Graph",
  trace: "Trace",
  proposal: "Proposal",
  export: "Export",
};

const STATUS_LABEL: Record<WorkArtifactStatus, string> = {
  empty: "Empty",
  ready: "Ready",
  running: "Running",
  needs_review: "Needs review",
  failed: "Failed",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_TONE: Record<WorkArtifactStatus, string> = {
  empty: "quiet",
  ready: "ready",
  running: "running",
  needs_review: "review",
  failed: "failed",
  pending: "review",
  approved: "ready",
  rejected: "failed",
};

function iconFor(kind: WorkArtifactKind): ReactElement {
  if (kind === "graph") return <Network size={15} />;
  if (kind === "proposal") return <GitPullRequest size={15} />;
  if (kind === "trace") return <Clock3 size={15} />;
  if (kind === "export") return <FileDown size={15} />;
  if (kind === "deck") return <Sparkles size={15} />;
  return <Archive size={15} />;
}

function statusIcon(status: WorkArtifactStatus): ReactElement {
  if (status === "ready" || status === "approved") return <CheckCircle2 size={12} />;
  if (status === "running") return <Bot size={12} />;
  if (status === "failed" || status === "rejected" || status === "needs_review" || status === "pending") return <ShieldAlert size={12} />;
  return <Clock3 size={12} />;
}

function scoreArtifacts(artifact: WorkArtifactViewModel): number {
  const statusScore = artifact.status === "needs_review" || artifact.status === "pending" || artifact.status === "failed" ? 0 : 1;
  const kindScore = artifact.kind === "proposal" ? 0 : artifact.kind === "graph" ? 1 : artifact.kind === "deck" ? 2 : 3;
  return statusScore * 10 + kindScore;
}

export function WorkArtifactsPanel({ roomId, me, onOpenArtifact }: { roomId: string; me: Actor; onOpenArtifact: (id: string) => void }): ReactElement {
  const store = useStore();
  const storeRef = useRef(store);
  const actorRef = useRef(me);
  storeRef.current = store;
  actorRef.current = me;
  const artifacts = store.listArtifacts(roomId);
  const messages = store.listMessages(roomId, "public");
  const proposals = store.listProposals(roomId);
  const traces = store.listTraces(roomId);
  const room = store.getRoom(roomId);
  const lastRun = store.lastRun();
  const longJob = store.lastLongFreeJob();
  const longJobAttempts = store.lastLongFreeJobAttempts();
  const longJobDetail = store.lastLongFreeJobDetail();
  const canResolve = store.listMembers(roomId).some((member) => member.id === me.id && member.role === "host");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const collaborativeDeckArtifact = useMemo(() => artifacts.find(isCollaborativeDeckArtifact), [artifacts]);
  const collaborativeDeck = useMemo(() => collaborativeDeckArtifact ? readCollaborativeDeckArtifact(collaborativeDeckArtifact) : null, [collaborativeDeckArtifact]);
  const sourceArtifacts = useMemo(() => artifacts.filter((artifact) => !isCollaborativeDeckArtifact(artifact)), [artifacts]);
  const storyboard = useMemo(() => (
    collaborativeDeck?.storyboard ?? (sourceArtifacts.length > 0
      ? buildDeckStoryboardFromRoom({ roomId, roomTitle: room?.title, artifacts: sourceArtifacts, proposals, traces })
      : null)
  ), [collaborativeDeck?.storyboard, proposals, room?.title, roomId, sourceArtifacts, traces]);
  const graph = useMemo(() => (
    buildSemanticGraph({ roomId, artifacts, proposals, traces, decks: storyboard ? [storyboard] : [] })
  ), [artifacts, proposals, roomId, storyboard, traces]);
  const bundle = useMemo(() => {
    return buildWorkArtifacts({
      artifacts: sourceArtifacts,
      proposals,
      traces: traces.slice(-12),
      graph,
      decks: storyboard ? [deckArtifactInputFromStoryboard(storyboard)] : [],
      exports: inferExports(roomId, artifacts, traces, proposals),
    }).sort((a, b) => scoreArtifacts(a) - scoreArtifacts(b) || (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  }, [graph, proposals, roomId, sourceArtifacts, storyboard, traces]);

  const totals = useMemo(() => ({
    evidence: bundle.reduce((sum, item) => sum + item.receipt.evidenceCount, 0),
    unresolved: bundle.reduce((sum, item) => sum + item.receipt.unresolvedCount, 0),
    traces: new Set(bundle.flatMap((item) => item.receipt.traceIds)).size,
    proposals: new Set(bundle.flatMap((item) => item.receipt.proposalIds)).size,
  }), [bundle]);
  const receipt = useMemo(() => buildProofBundleReceipt({ roomId, artifacts: bundle, generatedAt: 0 }), [bundle, roomId]);
  const traceReplay = useMemo(() => buildTraceReplaySummary({ roomId, traces, proposals }), [proposals, roomId, traces]);
  const livePerformance = useMemo(() => buildLivePerformanceSummary({
    roomId,
    messages,
    traces,
    run: lastRun,
    job: longJob,
    attempts: longJobAttempts,
    detail: longJobDetail,
  }), [lastRun, longJob, longJobAttempts, longJobDetail, messages, roomId, traces]);

  const openFirstRef = (item: WorkArtifactViewModel) => {
    if (item.kind === "deck" || item.kind === "notebook" || item.kind === "trace" || item.kind === "graph") {
      setSelectedId(item.id);
      return;
    }
    const ref = item.refs.find((candidate) => candidate.artifactId && artifacts.some((artifact) => artifact.id === candidate.artifactId));
    if (ref?.artifactId) onOpenArtifact(ref.artifactId);
  };
  const selectedDeck = storyboard && selectedId === `deck:${storyboard.deckId}` ? storyboard : null;
  const selectedNotebook = useMemo(() => {
    if (!selectedId?.startsWith("artifact:")) return null;
    const artifactId = selectedId.slice("artifact:".length);
    const artifact = artifacts.find((candidate) => candidate.id === artifactId && candidate.kind === "note" && !isCollaborativeDeckArtifact(candidate));
    return artifact ? { artifact, structure: buildNotebookArtifactStructure(artifact, { traces, proposals }) } : null;
  }, [artifacts, proposals, selectedId, traces]);
  const notebookKernelTables = useMemo(() => buildNotebookKernelTables(sourceArtifacts), [sourceArtifacts]);
  const selectedGraph = selectedId === `graph:${roomId}` ? graph : null;
  const selectedTraceId = selectedId?.startsWith("trace:") ? selectedId.slice("trace:".length) : undefined;
  const collaborativeDeckArtifactId = collaborativeDeck?.artifactId;
  const deckPresence = collaborativeDeckArtifactId ? store.listPresence(roomId, collaborativeDeckArtifactId) : [];
  const deckCollaboratorCount = new Set([me.id, ...deckPresence.map((presence) => presence.actor.id)]).size;
  const focusDeckSlide = useCallback((slideId: string | null) => {
    if (!collaborativeDeckArtifactId) return;
    if (slideId) {
      storeRef.current.updatePresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "slide", targetId: slideId, mode: "focus", actor: actorRef.current, label: "Editing deck slide", ttlMs: 30_000 });
    } else {
      storeRef.current.clearPresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "slide", actor: actorRef.current });
    }
  }, [collaborativeDeckArtifactId, me.id, roomId]);
  const saveStoryboard = async (next: DeckStoryboard): Promise<{ ok: boolean; reason?: string }> => {
    if (!collaborativeDeck) {
      try {
        await store.uploadArtifact({ roomId, artifact: collaborativeDeckArtifactInput(next), actor: me, visibility: "room" });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "deck_create_failed" };
      }
    }
    const feedback = await store.applyEdit({
      roomId,
      actor: me,
      op: {
        opId: crypto.randomUUID(),
        artifactId: collaborativeDeck.artifactId,
        elementId: DECK_STORYBOARD_ELEMENT_ID,
        kind: "set",
        value: next,
        baseVersion: collaborativeDeck.elementVersion,
      },
    });
    return feedback.ok ? { ok: true } : { ok: false, reason: feedback.reason };
  };
  const requestDeckPatch = async (prompt: string, slideId?: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!storyboard) return { ok: false, reason: "deck_not_found" };
    const slide = storyboard.slides.find((candidate) => candidate.slideId === slideId);
    const goal = [
      "Collaborative deck patch request from the NodeRoom storyboard workbench.",
      `Deck: ${storyboard.title} (plan ${storyboard.planHash}, v${storyboard.version}).`,
      slide ? `Target slide: ${slide.title} (${slide.slideId}). Purpose: ${slide.purpose}. Claims: ${slide.claims.map((claim) => `[${claim.status}] ${claim.text}`).join(" | ") || "none"}.` : "Target: full storyboard.",
      `Reviewer request: ${prompt}`,
      "Use room evidence and traces. Do not mark a claim verified without a source. Return a reviewable patch workpaper and preserve the target slide id.",
    ].join("\n\n");
    try {
      await store.askAgent({ goal, contextArtifactId: collaborativeDeck?.artifactId ?? slide?.sourceArtifactIds[0] ?? storyboard.sourceArtifactIds[0] });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "agent_patch_failed" };
    }
  };
  const downloadManifest = () => {
    const liveReceipt = buildProofBundleReceipt({ roomId, artifacts: bundle });
    const manifest = buildProofBundleExportManifest({
      roomId,
      artifacts: bundle,
      receipt: liveReceipt,
      traceReplay,
      generatedAt: liveReceipt.generatedAt,
    });
    const fileName = proofBundleManifestFileName(room?.title, manifest);
    const blob = new Blob([proofBundleManifestJson(manifest)], { type: "application/json;charset=utf-8" });
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

  return (
    <div className="r-art-body wa-panel" data-testid="work-artifacts-panel" data-noderoom-surface="workSurface.artifacts">
      <header className="wa-header">
        <div>
          <p className="wa-eyebrow">Work artifacts</p>
          <h2>Room proof bundle</h2>
          <p className="wa-receipt" data-testid="work-artifacts-receipt" title={receipt.receiptId}>
            receipt {receipt.integrityHash}
          </p>
        </div>
        <div className="wa-header-side">
          <div className="wa-summary" aria-label="Artifact proof summary">
            <span><b>{bundle.length}</b> artifacts</span>
            <span><b>{totals.evidence}</b> evidence</span>
            <span><b>{totals.unresolved}</b> review</span>
            <span><b>{totals.traces}</b> traces</span>
          </div>
          <button type="button" className="wa-export" data-testid="proof-bundle-export-json" onClick={downloadManifest}>
            <Download size={13} />
            Receipt JSON
          </button>
        </div>
      </header>
      {exportMessage && (
        <div className="wa-export-message" role="status" data-testid="proof-bundle-export-status">
          {exportMessage}
          <button type="button" onClick={() => setExportMessage(null)}>Dismiss</button>
        </div>
      )}

      <ProposalReviewCenter
        proposals={proposals}
        artifacts={artifacts}
        traces={traces}
        me={me}
        canResolve={canResolve}
        onOpenArtifact={(artifactId) => {
          setSelectedId(null);
          onOpenArtifact(artifactId);
        }}
        onResolveProposal={(proposalId, approve) => store.resolveProposal(proposalId, approve, me)}
      />

      {selectedGraph && (
        <GraphRelationshipReviewWorkbench
          graph={selectedGraph}
          graphId={`${roomId}:semantic-graph`}
          onClose={() => setSelectedId(null)}
          onOpenArtifact={(artifactId) => {
            setSelectedId(null);
            onOpenArtifact(artifactId);
          }}
        />
      )}
      {selectedDeck && (
        <DeckStoryboardWorkbench
          storyboard={selectedDeck}
          artifactId={collaborativeDeck?.artifactId}
          collaboratorCount={deckCollaboratorCount}
          onSaveStoryboard={saveStoryboard}
          onRequestPatch={requestDeckPatch}
          onFocusSlide={focusDeckSlide}
          onClose={() => { focusDeckSlide(null); setSelectedId(null); }}
          onOpenArtifact={(artifactId) => {
            setSelectedId(null);
            onOpenArtifact(artifactId);
          }}
        />
      )}
      {selectedNotebook && (
        <NotebookDigestWorkbench
          structure={selectedNotebook.structure}
          proposals={proposals}
          kernelOutputs={readNotebookKernelOutputs(selectedNotebook.artifact)}
          onExecuteKernel={async (item) => {
            const result = await store.executeNotebookKernel({ roomId, request: { kind: item.kind, input: item.input, tables: notebookKernelTables } });
            const elementId = notebookKernelOutputElementId(item.blockId);
            const latestArtifact = store.getArtifact(selectedNotebook.artifact.id) ?? selectedNotebook.artifact;
            const existing = latestArtifact.elements[elementId];
            const feedback = await store.applyEdit({
              roomId,
              actor: me,
              op: {
                opId: crypto.randomUUID(),
                artifactId: latestArtifact.id,
                elementId,
                kind: existing ? "set" : "create",
                value: { blockId: item.blockId, input: item.input, result },
                baseVersion: existing?.version ?? 0,
              },
            });
            return feedback.ok ? { ok: true } : { ok: false, reason: feedback.reason };
          }}
          onClose={() => setSelectedId(null)}
          onOpenArtifact={(artifactId) => {
            setSelectedId(null);
            onOpenArtifact(artifactId);
          }}
        />
      )}
      {selectedTraceId && (
        <TraceReplayWorkbench
          replay={traceReplay}
          traces={traces}
          focusTraceId={selectedTraceId}
          onClose={() => setSelectedId(null)}
          onOpenArtifact={(artifactId) => {
            setSelectedId(null);
            onOpenArtifact(artifactId);
          }}
        />
      )}

      <LivePerformanceCenter
        summary={livePerformance}
        onOpenTraceReplay={() => {
          const latestTrace = traces[traces.length - 1];
          if (latestTrace) setSelectedId(`trace:${latestTrace.id}`);
        }}
      />

      <div className="wa-grid" role="list" aria-label="Room work artifacts">
        {bundle.map((item) => {
          const canOpen = item.kind === "deck" || item.kind === "notebook" || item.kind === "trace" || item.kind === "graph" || item.refs.some((ref) => ref.artifactId && artifacts.some((artifact) => artifact.id === ref.artifactId));
          return (
            <article key={item.id} className="wa-row" role="listitem" data-kind={item.kind} data-status={item.status} data-selected={String(selectedId === item.id)} data-testid="work-artifact-row">
              <button
                type="button"
                className="wa-main"
                disabled={!canOpen}
                onClick={() => openFirstRef(item)}
                title={canOpen ? `Open ${item.title}` : item.title}
              >
                <span className="wa-kind-icon" aria-hidden="true">{iconFor(item.kind)}</span>
                <span className="wa-copy">
                  <span className="wa-title">{item.title}</span>
                  <span className="wa-meta">
                    <span>{KIND_LABEL[item.kind]}</span>
                    {item.version !== undefined && <span>v{item.version}</span>}
                    {item.owner?.name && <span>{item.owner.name}</span>}
                  </span>
                  {item.summary && <span className="wa-description">{item.summary}</span>}
                </span>
              </button>
              <div className="wa-proof">
                <span className="wa-status" data-tone={STATUS_TONE[item.status]}>
                  {statusIcon(item.status)}
                  {STATUS_LABEL[item.status]}
                </span>
                <span>{item.receipt.evidenceCount} src</span>
                <span>{item.receipt.proposalIds.length} proposals</span>
                <span>{item.receipt.traceIds.length} traces</span>
              </div>
            </article>
          );
        })}
      </div>

      {bundle.length === 0 && (
        <div className="wa-empty">
          <Search size={18} />
          <span>No room artifacts yet.</span>
        </div>
      )}

    </div>
  );
}

function inferExports(roomId: string, artifacts: Artifact[], traces: TraceEvent[], proposals: Proposal[]) {
  if (artifacts.length === 0) return [];
  return [{
    id: `${roomId}:proof-bundle`,
    roomId,
    title: "Room proof export",
    format: "zip" as const,
    status: proposals.length > 0 ? "needs_review" as const : "ready" as const,
    artifactCount: artifacts.length,
    evidenceCount: 0,
    unresolvedCount: proposals.length,
    traceIds: traces.slice(-8).map((trace) => trace.id),
    proposalIds: proposals.map((proposal) => proposal.id),
  }];
}
