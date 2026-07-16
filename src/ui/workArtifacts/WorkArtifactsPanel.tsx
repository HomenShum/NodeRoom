import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery } from "convex/react";
import { Archive, Bot, CheckCircle2, Clock3, Download, FileDown, GitPullRequest, Network, Search, ShieldAlert, Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useStore } from "../../app/store";
import type { Actor, Artifact, Proposal, TraceEvent } from "../../engine/types";
import { buildSemanticGraph } from "../graph/semanticGraph";
import { getBrowserNotebookKernelBroker } from "../../notebook/browserKernelBroker";
import { buildDeckObjectProposalGoal, buildDeckStoryboardFromRoom, buildLivePerformanceSummary, buildNotebookArtifactStructure, buildNotebookArtifactStructureFromReadModel, buildNotebookKernelTables, buildProofBundleExportManifest, buildProofBundleReceipt, buildTraceReplaySummary, buildWorkArtifacts, changedDeckObjectIds, collaborativeDeckArtifactInput, createDeckComment, deckArtifactInputFromStoryboard, deckCommentElementId, deckSlideElementId, findDeckObjectConflicts, isCollaborativeDeckArtifact, mergeCollaborativeDeckObjectChanges, notebookKernelOutputElementId, planDeckObjectMutations, proofBundleManifestFileName, proofBundleManifestJson, readCollaborativeDeckArtifact, readCollaborativeDeckProposal, readNotebookKernelOutputs, resolveDeckComment, type DeckComment, type DeckStoryboard, type WorkArtifactKind, type WorkArtifactStatus, type WorkArtifactViewModel } from ".";
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

export function WorkArtifactsPanel({ roomId, me, onOpenArtifact, initialArtifactId, reviewJobId }: { roomId: string; me: Actor; onOpenArtifact: (id: string) => void; initialArtifactId?: string; reviewJobId?: string }): ReactElement {
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
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const collaborativeDeckEntries = useMemo(() => artifacts.flatMap((artifact) => {
    const snapshot = readCollaborativeDeckArtifact(artifact);
    return snapshot ? [{ artifact, snapshot }] : [];
  }), [artifacts]);
  const directDeckEntry = useMemo(() => (
    initialArtifactId
      ? collaborativeDeckEntries.find((entry) => entry.artifact.id === initialArtifactId)
      : undefined
  ), [collaborativeDeckEntries, initialArtifactId]);
  const directDeckId = directDeckEntry ? `deck:${directDeckEntry.artifact.id}` : null;
  const [selectedId, setSelectedId] = useState<string | null>(directDeckId);
  useEffect(() => {
    if (directDeckId) setSelectedId(directDeckId);
  }, [directDeckId]);
  const selectedDeckEntry = useMemo(() => (
    selectedId?.startsWith("deck:")
      ? collaborativeDeckEntries.find((entry) => `deck:${entry.artifact.id}` === selectedId)
      : undefined
  ), [collaborativeDeckEntries, selectedId]);
  const activeDeckEntry = selectedDeckEntry ?? directDeckEntry ?? collaborativeDeckEntries[0];
  const collaborativeDeck = activeDeckEntry?.snapshot ?? null;
  const sourceArtifacts = useMemo(() => artifacts.filter((artifact) => !isCollaborativeDeckArtifact(artifact)), [artifacts]);
  const generatedStoryboard = useMemo(() => (
    collaborativeDeckEntries.length === 0 && sourceArtifacts.length > 0
      ? buildDeckStoryboardFromRoom({ roomId, roomTitle: room?.title, artifacts: sourceArtifacts, proposals, traces })
      : null
  ), [collaborativeDeckEntries.length, proposals, room?.title, roomId, sourceArtifacts, traces]);
  const storyboard = collaborativeDeck?.storyboard ?? generatedStoryboard;
  const deckStoryboards = useMemo(() => (
    collaborativeDeckEntries.length > 0
      ? collaborativeDeckEntries.map((entry) => entry.snapshot.storyboard)
      : generatedStoryboard ? [generatedStoryboard] : []
  ), [collaborativeDeckEntries, generatedStoryboard]);
  const deckArtifactInputs = useMemo(() => (
    collaborativeDeckEntries.length > 0
      ? collaborativeDeckEntries.map((entry) => ({
          ...deckArtifactInputFromStoryboard(entry.snapshot.storyboard),
          id: entry.artifact.id,
          updatedAt: entry.artifact.updatedAt,
        }))
      : generatedStoryboard ? [deckArtifactInputFromStoryboard(generatedStoryboard)] : []
  ), [collaborativeDeckEntries, generatedStoryboard]);
  const graph = useMemo(() => (
    buildSemanticGraph({ roomId, artifacts, proposals, traces, decks: deckStoryboards })
  ), [artifacts, deckStoryboards, proposals, roomId, traces]);
  const bundle = useMemo(() => {
    return buildWorkArtifacts({
      artifacts: sourceArtifacts,
      proposals,
      traces: traces.slice(-12),
      graph,
      decks: deckArtifactInputs,
      exports: inferExports(roomId, artifacts, traces, proposals),
    }).sort((a, b) => scoreArtifacts(a) - scoreArtifacts(b) || (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  }, [deckArtifactInputs, graph, proposals, roomId, sourceArtifacts, traces]);

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
  const selectedDeck = selectedDeckEntry?.snapshot.storyboard ?? (
    generatedStoryboard && selectedId === `deck:${generatedStoryboard.deckId}` ? generatedStoryboard : null
  );
  const selectedNotebookArtifact = useMemo(() => {
    if (!selectedId?.startsWith("artifact:")) return null;
    const artifactId = selectedId.slice("artifact:".length);
    return artifacts.find((candidate) => candidate.id === artifactId && candidate.kind === "note" && !isCollaborativeDeckArtifact(candidate)) ?? null;
  }, [artifacts, selectedId]);
  const notebookRequester = store.actorProof?.() ?? null;
  const liveNotebookRows = useQuery(
    api.notebookProcessing.listNotebookBlocks,
    selectedNotebookArtifact && notebookRequester
      ? {
          roomId: roomId as never,
          artifactId: selectedNotebookArtifact.id as never,
          requester: notebookRequester,
          limit: 240,
        }
      : "skip",
  );
  const selectedNotebook = useMemo(() => {
    if (!selectedNotebookArtifact) return null;
    const structure = liveNotebookRows && liveNotebookRows.length > 0
      ? buildNotebookArtifactStructureFromReadModel(selectedNotebookArtifact, liveNotebookRows, { traces, proposals })
      : buildNotebookArtifactStructure(selectedNotebookArtifact, { traces, proposals });
    return { artifact: selectedNotebookArtifact, structure };
  }, [liveNotebookRows, proposals, selectedNotebookArtifact, traces]);
  const notebookKernelTables = useMemo(() => buildNotebookKernelTables(sourceArtifacts), [sourceArtifacts]);
  const selectedGraph = selectedId === `graph:${roomId}` ? graph : null;
  const selectedTraceId = selectedId?.startsWith("trace:") ? selectedId.slice("trace:".length) : undefined;
  const collaborativeDeckArtifactId = collaborativeDeck?.artifactId;
  const deckPresence = collaborativeDeckArtifactId ? store.listPresence(roomId, collaborativeDeckArtifactId) : [];
  const deckCollaboratorCount = new Set([me.id, ...deckPresence.map((presence) => presence.actor.id)]).size;
  const reviewableDeckProposalIds = collaborativeDeckArtifactId
    ? proposals.flatMap((proposal) => {
        const candidate = readCollaborativeDeckProposal(proposal, collaborativeDeckArtifactId);
        return candidate?.status === "pending" ? [candidate.proposalId] : [];
      })
    : [];
  const focusDeckSlide = useCallback((slideId: string | null) => {
    if (!collaborativeDeckArtifactId) return;
    if (slideId) {
      storeRef.current.updatePresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "slide", targetId: slideId, mode: "focus", actor: actorRef.current, label: "Editing deck slide", ttlMs: 30_000 });
    } else {
      storeRef.current.clearPresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "slide", actor: actorRef.current });
    }
  }, [collaborativeDeckArtifactId, me.id, roomId]);
  const focusDeckObject = useCallback((objectId: string | null) => {
    if (!collaborativeDeckArtifactId) return;
    if (objectId) {
      storeRef.current.updatePresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "deck_component", targetId: objectId, mode: "edit", actor: actorRef.current, label: "Editing deck object", ttlMs: 30_000 });
    } else {
      storeRef.current.clearPresence({ roomId, artifactId: collaborativeDeckArtifactId, targetKind: "deck_component", actor: actorRef.current });
    }
  }, [collaborativeDeckArtifactId, me.id, roomId]);
  const saveStoryboard = async (next: DeckStoryboard, base: DeckStoryboard): Promise<{ ok: boolean; reason?: string }> => {
    if (!collaborativeDeck) {
      try {
        await store.uploadArtifact({ roomId, artifact: collaborativeDeckArtifactInput(next), actor: me, visibility: "room" });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "deck_create_failed" };
      }
    }
    const latestArtifact = store.getArtifact(collaborativeDeck.artifactId);
    const latest = latestArtifact ? readCollaborativeDeckArtifact(latestArtifact) : null;
    if (!latest) return { ok: false, reason: "deck_not_found" };
    const remoteObjectIds = changedDeckObjectIds(base, latest.storyboard);
    const conflicts = findDeckObjectConflicts({ base, current: latest.storyboard, next });
    if (conflicts.length > 0) return { ok: false, reason: `conflict:${conflicts.join(",")}` };
    // Legacy decks do not have per-object versions yet. Refuse any concurrent
    // migration rather than flattening a disjoint remote edit into stale JSON.
    if (latest.storageMode === "legacy-v1" && remoteObjectIds.length > 0) {
      return { ok: false, reason: `conflict:${remoteObjectIds.join(",")}` };
    }
    const mergedNext = latest.storageMode === "object-v2"
      ? mergeCollaborativeDeckObjectChanges({ base, current: latest.storyboard, next })
      : next;
    const changedObjectIds = new Set(changedDeckObjectIds(latest.storyboard, mergedNext));
    const mutations = planDeckObjectMutations({
      storageMode: latest.storageMode,
      current: latest.storyboard,
      objectVersions: latest.objectVersions,
      next: mergedNext,
      ...(latest.storageMode === "object-v2" ? { changedObjectIds } : {}),
    });
    if (mutations.length === 0) return { ok: true };
    const feedback = await store.applyArtifactEdits({
      roomId,
      artifactId: latest.artifactId,
      actor: me,
      ops: mutations.map((mutation) => ({
        opId: crypto.randomUUID(),
        artifactId: latest.artifactId,
        elementId: mutation.elementId,
        kind: mutation.kind,
        value: mutation.kind === "delete" ? null : mutation.value,
        baseVersion: mutation.baseVersion,
      })),
    });
    return feedback.ok ? { ok: true } : { ok: false, reason: `${feedback.reason}${feedback.elementId ? `:${feedback.elementId}` : ""}` };
  };
  const addDeckComment = async (slideId: string, body: string, targetObjectId?: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!collaborativeDeck) return { ok: false, reason: "deck_not_live" };
    const commentId = crypto.randomUUID();
    const feedback = await store.applyEdit({
      roomId,
      actor: me,
      op: {
        opId: crypto.randomUUID(),
        artifactId: collaborativeDeck.artifactId,
        elementId: deckCommentElementId(commentId),
        kind: "create",
        value: createDeckComment({ commentId, slideId, targetObjectId, body, author: me }),
        baseVersion: 0,
      },
    });
    return feedback.ok ? { ok: true } : { ok: false, reason: feedback.reason };
  };
  const resolveDeckCommentAt = async (comment: DeckComment): Promise<{ ok: boolean; reason?: string }> => {
    if (!collaborativeDeck) return { ok: false, reason: "deck_not_live" };
    const elementId = deckCommentElementId(comment.commentId);
    const latestArtifact = store.getArtifact(collaborativeDeck.artifactId);
    const current = latestArtifact?.elements[elementId];
    if (!current) return { ok: false, reason: "comment_not_found" };
    const feedback = await store.applyEdit({
      roomId,
      actor: me,
      op: {
        opId: crypto.randomUUID(),
        artifactId: collaborativeDeck.artifactId,
        elementId,
        kind: "set",
        value: resolveDeckComment(comment, me),
        baseVersion: current.version,
      },
    });
    return feedback.ok ? { ok: true } : { ok: false, reason: feedback.reason };
  };
  const requestDeckPatch = async (prompt: string, slideId?: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!storyboard) return { ok: false, reason: "deck_not_found" };
    const slide = storyboard.slides.find((candidate) => candidate.slideId === slideId);
    if (!collaborativeDeck || !slide) return { ok: false, reason: "deck_object_target_required" };
    const elementId = deckSlideElementId(slide.slideId);
    const goal = buildDeckObjectProposalGoal({
      artifactId: collaborativeDeck.artifactId,
      storyboard,
      slide,
      baseVersion: collaborativeDeck.objectVersions[elementId] ?? 0,
      reviewerRequest: prompt,
    });
    try {
      await store.askAgent({
        goal,
        contextArtifactId: collaborativeDeck.artifactId,
        contextArtifactRequired: true,
        allowedElementIds: [elementId],
        maxAttempts: 1,
      });
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
    <div
      className="r-art-body wa-panel"
      data-testid="work-artifacts-panel"
      data-noderoom-surface="workSurface.artifacts"
      data-detail={selectedNotebook ? "notebook" : undefined}
    >
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
        jobId={reviewJobId}
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
          key={collaborativeDeck?.artifactId ?? selectedDeck.deckId}
          storyboard={selectedDeck}
          artifactId={collaborativeDeck?.artifactId}
          collaboratorCount={deckCollaboratorCount}
          presences={deckPresence}
          comments={collaborativeDeck?.comments ?? []}
          roomId={roomId}
          requester={store.actorProof?.() ?? undefined}
          onSaveStoryboard={saveStoryboard}
          onAddComment={addDeckComment}
          onResolveComment={resolveDeckCommentAt}
          onRequestPatch={requestDeckPatch}
          reviewableProposalIds={reviewableDeckProposalIds}
          canResolvePatch={canResolve}
          onResolvePatch={(proposalId, approve) => store.resolveProposal(proposalId, approve, me)}
          onFocusSlide={focusDeckSlide}
          onFocusObject={focusDeckObject}
          onClose={() => { focusDeckSlide(null); focusDeckObject(null); setSelectedId(null); }}
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
          onExecuteKernel={async (item, execution) => {
            const result = execution.backend === "pyodide"
              ? await getBrowserNotebookKernelBroker().start({ backend: "pyodide", kind: "python", input: item.input, tables: notebookKernelTables, traceId: traces[0]?.id }, { signal: execution.signal }).result
              : await store.executeNotebookKernel({ roomId, request: { kind: item.kind, input: item.input, tables: notebookKernelTables } });
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
            if (!feedback.ok) return { ok: false, reason: feedback.reason };
            return result.status === "completed" ? { ok: true } : { ok: false, reason: result.outputText };
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
