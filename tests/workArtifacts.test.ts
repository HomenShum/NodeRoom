import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { Actor, Artifact, DataframeColumn, Element, Message, Proposal, TraceEvent } from "../src/engine/types";
import { buildSemanticGraph } from "../src/ui/graph/semanticGraph";
import {
  buildDeckStoryboardFromRoom,
  buildDeckPatchPlan,
  buildDeckPreviewExport,
  buildDeckPdfExport,
  buildDeckPptxExport,
  collaborativeDeckArtifactInput,
  createDeckComment,
  deckClaimElementId,
  deckCommentElementId,
  deckSlideElementId,
  addCollaborativeDeckSlide,
  deleteCollaborativeDeckSlide,
  duplicateCollaborativeDeckSlide,
  isCollaborativeDeckArtifact,
  moveCollaborativeDeckSlide,
  normalizeCollaborativeDeck,
  planDeckObjectMutations,
  readCollaborativeDeckArtifact,
  readCollaborativeDeckProposal,
  buildDeckObjectProposalGoal,
  resolveDeckComment,
  resolveRoomDeckStoryboard,
  buildGraphRelationshipReviewPlan,
  buildLivePerformanceSummary,
  buildNotebookExecutionPreview,
  buildNotebookArtifactStructure,
  buildNotebookArtifactStructureFromReadModel,
  buildNotebookPatchPreviewItems,
  buildNotebookPatchDiff,
  notebookPatchValueText,
  buildProofBundleReceipt,
  buildProofBundleExportManifest,
  buildTraceReplaySummary,
  buildWorkArtifacts,
  classifyNotebookTypedBlocks,
  buildProposalReviewItems,
  countProposalReviewItems,
  deckArtifactInputFromStoryboard,
  deckPatchPlanFileName,
  deckPatchPlanJson,
  deckPdfFileName,
  deckPreviewFileName,
  deckPptxFileName,
  filterProposalReviewItems,
  graphRelationshipReviewFileName,
  graphRelationshipReviewJson,
  mapDeckArtifactToWorkArtifact,
  mapEngineArtifactToWorkArtifact,
  mapExportToWorkArtifact,
  mapProposalToWorkArtifact,
  mapSemanticGraphToWorkArtifact,
  mapTraceToWorkArtifact,
  notebookDigestStats,
  proofBundleManifestFileName,
  proofBundleManifestJson,
  proposalReviewFeedbackMessage,
  proposalValuePreview,
  summarizeNotebookTypedBlocks,
  traceReplayPhaseForTrace,
  traceReplayStats,
} from "../src/ui/workArtifacts";

const human: Actor = { kind: "user", id: "u-priya", name: "Priya" };
const agent: Actor = { kind: "agent", id: "room-agent", name: "Room NodeAgent", scope: "public" };

const columns: DataframeColumn[] = [
  { id: "company", label: "Company", order: 0 },
  { id: "owner", label: "Owner", order: 1 },
  { id: "funding", label: "Funding", order: 2 },
  { id: "risk", label: "Risk", order: 3 },
];

function cell(id: string, value: unknown, updatedBy: Actor = human): Element {
  return { id, value, updatedBy, version: 1, updatedAt: 10 };
}

const researchSheet: Artifact = {
  id: "art-research",
  roomId: "room-1",
  kind: "sheet",
  title: "Company research",
  version: 3,
  createdBy: human,
  updatedAt: 20,
  order: ["r1__company", "r1__owner", "r1__funding", "r1__risk"],
  elements: {
    "r1__company": cell("r1__company", "CardioNova"),
    "r1__owner": cell("r1__owner", "Priya"),
    "r1__funding": cell("r1__funding", {
      value: "$14M Series A",
      status: "complete",
      evidence: [{
        id: "ev-funding",
        kind: "source",
        label: "Funding source",
        url: "https://source.example/cardionova",
      }],
    }, agent),
    "r1__risk": cell("r1__risk", { value: "Missing HIPAA source", status: "needs_review" }, agent),
  },
  meta: { dataframe: { columns, rowCount: 1 } },
};

const notebook: Artifact = {
  id: "art-note",
  roomId: "room-1",
  kind: "note",
  title: "Diligence notebook",
  version: 1,
  createdBy: human,
  updatedAt: 30,
  order: ["b1"],
  elements: {
    b1: cell("b1", { text: "Priya researched CardioNova and cited the funding source." }),
  },
};

const structuredNotebook: Artifact = {
  id: "art-structured-note",
  roomId: "room-1",
  kind: "note",
  title: "Capture Notebook",
  version: 2,
  createdBy: human,
  updatedAt: 35,
  order: ["doc"],
  elements: {
    doc: cell("doc", `
      <h1 data-blockid="blk-title">CardioNova diligence</h1>
      <p data-blockid="blk-human">Human context from the diligence call.</p>
      <h2 data-blockid="blk-agent-root" data-agent-root="true" data-author-kind="agent">Agent notes</h2>
      <p data-blockid="blk-agent-claim" data-author-kind="agent" data-run-id="run-1" data-status="needs_review">
        Runway claim needs source <a href="https://source.example/runway">runway memo</a>.
      </p>
    `),
  },
};

const pmNotebook: Artifact = {
  id: "art-pm-note",
  roomId: "room-1",
  kind: "note",
  title: "Synced notebook",
  version: 2,
  createdBy: human,
  updatedAt: 36,
  order: ["doc"],
  elements: {
    doc: cell("doc", {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, blockId: "pm-title" }, content: [{ type: "text", text: "Board memo" }] },
        { type: "paragraph", attrs: { blockId: "pm-agent", authorKind: "agent", status: "needs_review" }, content: [{ type: "text", text: "Founder quote is missing a transcript link." }] },
      ],
    }),
  },
};

const executionNotebook: Artifact = {
  id: "art-exec-note",
  roomId: "room-1",
  kind: "note",
  title: "Execution notebook",
  version: 1,
  createdBy: human,
  updatedAt: 37,
  order: ["doc"],
  elements: {
    doc: cell("doc", `
      <h1 data-blockid="exec-title">Notebook execution preview</h1>
      <p data-blockid="exec-calc">Calculation: runway score = 12 + 8 * 2</p>
      <pre data-blockid="exec-sql">select company, funding from diligence</pre>
      <p data-blockid="exec-chart">Chart: line revenue over month</p>
    `),
  },
};

const trace: TraceEvent = {
  id: "trace-1",
  roomId: "room-1",
  ts: 40,
  actor: agent,
  type: "edit_proposed",
  summary: "NodeAgent proposed a source-backed risk update",
  detail: "update_notebook_block -> pending approval",
  refs: { artifactId: "art-research", elementId: "r1__risk", proposalId: "proposal-1" },
};

const proposal: Proposal = {
  id: "proposal-1",
  roomId: "room-1",
  artifactId: "art-research",
  jobId: "job-1",
  op: { opId: "op-1", artifactId: "art-research", elementId: "r1__risk", kind: "set", value: "HIPAA source added", baseVersion: 1 },
  author: agent,
  status: "pending",
  createdAt: 50,
  review: { kind: "agent_edit", reason: "Needs host approval before changing diligence risk." },
};

describe("work artifact adapters", () => {
  it("wraps an engine sheet as a spreadsheet artifact with evidence, review, proposal, and trace receipts", () => {
    const artifact = mapEngineArtifactToWorkArtifact(researchSheet, { traces: [trace], proposals: [proposal] });

    expect(artifact.kind).toBe("spreadsheet");
    expect(artifact.status).toBe("needs_review");
    expect(artifact.receipt.evidenceCount).toBe(1);
    expect(artifact.receipt.unresolvedCount).toBe(1);
    expect(artifact.receipt.traceIds).toEqual(["trace-1"]);
    expect(artifact.receipt.proposalIds).toEqual(["proposal-1"]);
    expect(artifact.actions.map((action) => action.id)).toEqual(expect.arrayContaining(["open", "ask_nodeagent", "propose_patch", "view_trace"]));
  });

  it("derives notebook structure from legacy HTML without mutating the editor model", () => {
    const structure = buildNotebookArtifactStructure(structuredNotebook, { traces: [trace], proposals: [] });

    expect(structure.blockCount).toBe(4);
    expect(structure.sectionCount).toBe(2);
    expect(structure.agentBlockCount).toBe(2);
    expect(structure.needsReviewCount).toBe(1);
    expect(structure.citationCount).toBe(1);
    expect(structure.sourceIds).toEqual(["https://source.example/runway"]);
    expect(structure.sections.map((section) => section.title)).toEqual(["CardioNova diligence", "Agent notes"]);
    expect(structure.status).toBe("needs_review");
    expect(structure.summary).toContain("4 blocks");
  });

  it("shows a human quick-capture object as a notebook block instead of mistaking it for a cell wrapper", () => {
    const capturedNote: Artifact = {
      ...structuredNotebook,
      id: "art-quick-capture-note",
      order: ["capture-1"],
      elements: {
        "capture-1": cell("capture-1", {
          text: "Call out the unresolved hospital deployment reference.",
          status: "draft",
          capturedAt: "2026-07-30T05:00:00.000Z",
          capturedBy: { id: human.id, name: human.name, kind: human.kind },
        }),
      },
    };

    const structure = buildNotebookArtifactStructure(capturedNote);

    expect(structure.blockCount).toBe(1);
    expect(structure.humanBlockCount).toBe(1);
    expect(structure.blocks[0]).toMatchObject({
      elementId: "capture-1",
      text: "Call out the unresolved hospital deployment reference.",
      status: "draft",
    });
  });

  it("summarizes notebook digest stats for the openable workbench", () => {
    const structure = buildNotebookArtifactStructure(structuredNotebook, { traces: [trace], proposals: [proposal] });
    const stats = notebookDigestStats(structure);

    expect(stats).toMatchObject({
      blocks: 4,
      sections: 2,
      agentBlocks: 2,
      humanBlocks: 2,
      reviewBlocks: 1,
      sources: 1,
      proposals: 0,
      statusLabel: "Needs review",
    });
  });

  it("builds notebook block-level patch previews from existing proposals", () => {
    const noteProposal: Proposal = {
      ...proposal,
      id: "proposal-note",
      artifactId: "art-structured-note",
      op: {
        ...proposal.op,
        artifactId: "art-structured-note",
        elementId: "blk-agent-claim",
        value: "Runway claim now cites the board-approved source.",
      },
      createdAt: 90,
    };
    const structure = buildNotebookArtifactStructure(structuredNotebook, { traces: [], proposals: [noteProposal] });
    const previews = buildNotebookPatchPreviewItems(structure, [noteProposal]);

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      proposalId: "proposal-note",
      status: "pending",
      blockId: "blk-agent-claim",
      valuePreview: "Runway claim now cites the board-approved source.",
    });
    expect(previews[0].blockText).toContain("Runway claim needs source");
    expect(previews[0].diff.changed).toBe(true);
    expect(previews[0].diff.removedText).toContain("needs source");
    expect(previews[0].diff.addedText).toContain("now cites");
    expect(buildNotebookPatchDiff("alpha beta", "alpha gamma beta").parts.some((part) => part.kind === "added" && part.text === "gamma")).toBe(true);
  });

  it("extracts nested notebook proposal text for inline ProseMirror diffs", () => {
    expect(notebookPatchValueText("plain")).toBe("plain");
    expect(notebookPatchValueText({ value: { text: "agent revision" } })).toBe("agent revision");
    expect(notebookPatchValueText({ content: "replacement block" })).toBe("replacement block");
  });

  it("classifies typed notebook blocks without changing the editor model", () => {
    const typedNotebook: Artifact = {
      ...structuredNotebook,
      id: "art-typed-note",
      elements: {
        doc: cell("doc", `
          <h1 data-blockid="typed-title">Typed analysis</h1>
          <p data-blockid="typed-calc">Runway calculation: $4.1M cash / $0.45M burn = 9.1 months.</p>
          <p data-blockid="typed-evidence">Evidence: cited transcript https://source.example/transcript</p>
          <p data-blockid="typed-question">Open question: who approved the burn assumption?</p>
          <p data-blockid="typed-decision">Decision: approve the sourced revenue claim.</p>
        `),
      },
    };
    const structure = buildNotebookArtifactStructure(typedNotebook);
    const typed = classifyNotebookTypedBlocks(structure);
    const byId = new Map(typed.map((block) => [block.blockId, block.type]));
    const summary = summarizeNotebookTypedBlocks(structure);

    expect(byId.get("typed-calc")).toBe("calculation");
    expect(byId.get("typed-evidence")).toBe("evidence");
    expect(byId.get("typed-question")).toBe("open_question");
    expect(byId.get("typed-decision")).toBe("decision");
    expect(summary.counts.calculation).toBe(1);
    expect(summary.counts.evidence).toBe(1);
    expect(summary.total).toBe(5);
    expect(typedNotebook.elements.doc.value).toContain("<h1");
  });

  it("builds read-only execution previews for calculation, SQL, and chart notebook blocks", () => {
    const structure = buildNotebookArtifactStructure(executionNotebook);
    const preview = buildNotebookExecutionPreview(structure);
    const byKind = new Map(preview.items.map((item) => [item.kind, item]));

    expect(preview.previewVersion).toBe(1);
    expect(preview.executableCount).toBe(3);
    expect(preview.readyCount).toBe(3);
    expect(preview.blockedCount).toBe(0);
    expect(byKind.get("calculation")).toMatchObject({ status: "ready", input: "12 + 8 * 2", result: "28" });
    expect(byKind.get("sql")?.result).toBe("Parsed 2 columns from diligence.");
    expect(byKind.get("chart")?.result).toContain("line chart intent");
    expect(executionNotebook.elements.doc.value).toContain("Calculation: runway score");
  });

  it("bridges sorted live notebook rows into a stable Pyodide-ready Python block", () => {
    const rows = [
      { blockId: "live-python", blockIndex: 2, blockType: "paragraph", text: "Python: print((2400 - 1100) - 450)" },
      { blockId: "live-body", blockIndex: 1, blockType: "paragraph", text: "Current variance analysis" },
      { blockId: "live-title", blockIndex: 0, blockType: "heading", text: "Q3 variance" },
    ];

    const structure = buildNotebookArtifactStructureFromReadModel(structuredNotebook, rows);
    const typed = classifyNotebookTypedBlocks(structure);
    const preview = buildNotebookExecutionPreview(structure);
    const python = preview.items.find((item) => item.kind === "python");

    expect(structure.blocks.map((block) => block.blockId)).toEqual(["live-title", "live-body", "live-python"]);
    expect(structure.blocks.map((block) => block.id)).toEqual(["live-title", "live-body", "live-python"]);
    expect(typed.find((block) => block.blockId === "live-python")?.type).toBe("python");
    expect(python).toMatchObject({
      blockId: "live-python",
      status: "ready",
      input: "print((2400 - 1100) - 450)",
      reason: "pyodide_worker_required",
    });

    const afterTextEdit = buildNotebookArtifactStructureFromReadModel(structuredNotebook, [
      { ...rows[0], text: "Python: print((2400 - 1100) - 400)" },
      rows[2],
      rows[1],
    ]);
    expect(afterTextEdit.blocks.map((block) => block.id)).toEqual(["live-title", "live-body", "live-python"]);
    expect(structuredNotebook.elements.doc.value).toContain("CardioNova diligence");
  });

  it("derives notebook structure from ProseMirror JSON blocks", () => {
    const structure = buildNotebookArtifactStructure(pmNotebook);

    expect(structure.blockCount).toBe(2);
    expect(structure.agentBlockCount).toBe(1);
    expect(structure.needsReviewCount).toBe(1);
    expect(structure.blocks[1]).toMatchObject({
      blockId: "pm-agent",
      role: "agent",
      status: "needs_review",
      text: "Founder quote is missing a transcript link.",
    });
  });

  it("decodes named HTML entities in HTML and ProseMirror notebook blocks", () => {
    const htmlArtifact: Artifact = {
      ...structuredNotebook,
      id: "art-entity-note",
      elements: {
        doc: cell("doc", '<h1 data-blockid="entity-title">CardioNova &mdash; diligence</h1><p data-blockid="entity-copy">Funding &middot; &ldquo;$14M&rdquo;&hellip;</p>'),
      },
    };
    const pmArtifact: Artifact = {
      ...pmNotebook,
      id: "art-entity-pm-note",
      elements: {
        doc: cell("doc", {
          type: "doc",
          content: [{ type: "paragraph", attrs: { blockId: "entity-pm" }, content: [{ type: "text", text: "Evidence &bull; reviewed &ndash; approved" }] }],
        }),
      },
    };

    expect(buildNotebookArtifactStructure(htmlArtifact).blocks.map((block) => block.text)).toEqual([
      "CardioNova - diligence",
      'Funding · "$14M"...',
    ]);
    expect(buildNotebookArtifactStructure(pmArtifact).blocks[0]?.text).toBe("Evidence • reviewed - approved");
  });

  it("uses notebook structure in the work-artifact receipt for notes", () => {
    const workpaper = mapEngineArtifactToWorkArtifact(structuredNotebook, { traces: [trace], proposals: [] });

    expect(workpaper.kind).toBe("notebook");
    expect(workpaper.status).toBe("needs_review");
    expect(workpaper.summary).toContain("4 blocks");
    expect(workpaper.receipt.evidenceCount).toBe(1);
    expect(workpaper.receipt.sourceIds).toEqual(["https://source.example/runway"]);
    expect(workpaper.meta?.blockCount).toBe(4);
    expect(workpaper.meta?.agentBlockCount).toBe(2);
    expect(workpaper.refs.some((ref) => ref.elementId === "blk-agent-root")).toBe(true);
  });

  it("maps pending proposals to reviewable workpapers without applying the change", () => {
    const workpaper = mapProposalToWorkArtifact(proposal, researchSheet, [trace]);

    expect(workpaper.kind).toBe("proposal");
    expect(workpaper.status).toBe("pending");
    expect(workpaper.summary).toContain("Needs host approval");
    expect(workpaper.receipt.unresolvedCount).toBe(1);
    expect(workpaper.refs[0]).toMatchObject({ proposalId: "proposal-1", jobId: "job-1" });
    expect(workpaper.meta?.jobId).toBe("job-1");
    expect(workpaper.actions.map((action) => action.id)).toEqual(["open", "accept", "reject", "view_trace"]);
  });

  it("builds proposal review center items from existing proposals without applying changes", () => {
    const semanticProposal: Proposal = {
      ...proposal,
      id: "proposal-2",
      op: { ...proposal.op, elementId: "r1__funding", value: { value: "Funding source needs rebase" } },
      createdAt: 80,
      review: { kind: "semantic_rebase", reason: "Business-value conflict", status: "needs_review" },
    };

    const items = buildProposalReviewItems({ proposals: [proposal, semanticProposal], artifacts: [researchSheet], traces: [trace] });
    const counts = countProposalReviewItems(items);

    expect(items.map((item) => item.proposalId)).toEqual(["proposal-2", "proposal-1"]);
    expect(items[0]).toMatchObject({
      artifactTitle: "Company research",
      reviewKind: "semantic_rebase",
      valuePreview: "Funding source needs rebase",
      jobId: "job-1",
    });
    expect(counts).toMatchObject({ total: 2, pending: 2, agentEdit: 1, semanticRebase: 1 });
    expect(filterProposalReviewItems(items, "semantic_rebase")).toHaveLength(1);
    expect(filterProposalReviewItems(items, "agent_edit")).toHaveLength(1);
  });

  it("keeps proposal review feedback honest about conflicts and host gates", () => {
    expect(proposalValuePreview({ value: " ".repeat(4) + "manual claim" })).toBe("manual claim");
    expect(proposalReviewFeedbackMessage({ ok: true }, true)).toBe("Proposal approved.");
    expect(proposalReviewFeedbackMessage({ ok: false, reason: "conflict" }, true)).toContain("source cell changed");
    expect(proposalReviewFeedbackMessage({ ok: false, reason: "host_required" }, false)).toContain("Only the host");
    expect(proposalReviewFeedbackMessage({ ok: false, reason: "invalid_deck_object" }, true)).toContain("malformed");
  });

  it("maps traces as proof artifacts with review status for proposal events", () => {
    const traceArtifact = mapTraceToWorkArtifact(trace);

    expect(traceArtifact.kind).toBe("trace");
    expect(traceArtifact.status).toBe("needs_review");
    expect(traceArtifact.receipt.traceIds).toEqual(["trace-1"]);
    expect(traceArtifact.refs[0]).toMatchObject({ artifactId: "art-research", elementId: "r1__risk", traceId: "trace-1" });
  });

  it("wraps the semantic proof graph and preserves linked proposal and trace receipts", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], proposals: [proposal], traces: [trace] });
    const graphArtifact = mapSemanticGraphToWorkArtifact("room-1", graph);

    expect(graphArtifact.kind).toBe("graph");
    expect(graphArtifact.title).toBe("Proof graph");
    expect(graphArtifact.receipt.evidenceCount).toBeGreaterThan(0);
    expect(graphArtifact.receipt.traceIds).toContain("trace-1");
    expect(graphArtifact.receipt.proposalIds).toContain("proposal-1");
    expect(graphArtifact.meta?.companies).toBeGreaterThan(0);
  });

  it("builds a deterministic graph relationship review plan from source-backed and review edges", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, structuredNotebook],
      traces: [trace],
      proposals: [proposal],
    });
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, structuredNotebook], proposals: [proposal], traces: [trace], decks: [storyboard] });
    const plan = buildGraphRelationshipReviewPlan(graph, "room-1:semantic-graph");
    const second = buildGraphRelationshipReviewPlan(graph, "room-1:semantic-graph");

    expect(plan.reviewVersion).toBe(1);
    expect(plan.integrityHash).toBe(second.integrityHash);
    expect(graphRelationshipReviewJson(plan)).toBe(graphRelationshipReviewJson(second));
    expect(plan.relationshipCount).toBe(graph.edges.length);
    expect(plan.confirmedCount + plan.needsConfirmationCount).toBe(plan.relationshipCount);
    expect(plan.confirmedCount).toBeGreaterThan(0);
    expect(plan.needsConfirmationCount).toBeGreaterThan(0);
    expect(plan.proposalIds).toContain("proposal-1");
    expect(plan.traceIds).toContain("trace-1");
    expect(plan.sourceArtifactIds).toContain("art-research");
    expect(plan.items.some((item) => item.edgeKind === "supported_by" && item.reviewStatus === "confirmed")).toBe(true);
    expect(plan.items.some((item) => item.edgeKind === "reviewed" && item.reviewStatus === "needs_confirmation")).toBe(true);
    expect(graphRelationshipReviewFileName("room-1:semantic-graph", plan.integrityHash)).toBe(`room-1-semantic-graph-relationship-review-${plan.integrityHash}.json`);
  });

  it("supports storyboard-first deck artifacts before a full deck editor exists", () => {
    const deck = mapDeckArtifactToWorkArtifact({
      id: "deck-1",
      roomId: "room-1",
      title: "Board diligence readout",
      storyboardStatus: "needs_review",
      sections: [
        { id: "s1", title: "Thesis", evidenceCount: 2 },
        { id: "s2", title: "Risks", evidenceCount: 1, unresolvedCount: 1 },
      ],
      traceIds: ["trace-1"],
      proposalIds: ["proposal-1"],
    });

    expect(deck.kind).toBe("deck");
    expect(deck.status).toBe("needs_review");
    expect(deck.summary).toContain("2 storyboard sections");
    expect(deck.receipt.evidenceCount).toBe(3);
    expect(deck.refs.map((ref) => ref.elementId)).toEqual(["s1", "s2"]);
    expect(deck.refs.every((ref) => ref.artifactId === undefined)).toBe(true);
    expect(deck.actions.map((action) => action.id)).toEqual(expect.arrayContaining(["ask_nodeagent", "propose_patch", "export"]));
  });

  it("maps export bundles with receipt sidecar metadata", () => {
    const exported = mapExportToWorkArtifact({
      id: "export-1",
      roomId: "room-1",
      title: "Diligence proof bundle",
      format: "zip",
      artifactCount: 4,
      evidenceCount: 7,
      unresolvedCount: 0,
      traceIds: ["trace-1"],
    });

    expect(exported.kind).toBe("export");
    expect(exported.summary).toContain("ZIP export");
    expect(exported.receipt.evidenceCount).toBe(7);
    expect(exported.actions.map((action) => action.id)).toContain("export");
  });

  it("builds a mixed work-artifact bundle from existing room objects", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], proposals: [proposal], traces: [trace] });
    const bundle = buildWorkArtifacts({
      artifacts: [researchSheet, notebook],
      proposals: [proposal],
      traces: [trace],
      graph,
      decks: [{ id: "deck-1", roomId: "room-1", title: "Board readout", sections: [] }],
      exports: [{ id: "export-1", roomId: "room-1", title: "Proof bundle", format: "zip" }],
    });

    expect(bundle.map((artifact) => artifact.kind)).toEqual([
      "spreadsheet",
      "notebook",
      "graph",
      "deck",
      "proposal",
      "trace",
      "export",
    ]);
  });

  it("builds a stable proof-bundle receipt from mixed work artifacts", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, structuredNotebook], proposals: [proposal], traces: [trace] });
    const bundle = buildWorkArtifacts({
      artifacts: [researchSheet, structuredNotebook],
      proposals: [proposal],
      traces: [trace],
      graph,
      decks: [{ id: "deck-1", roomId: "room-1", title: "Board readout", sections: [{ id: "s1", title: "Summary", unresolvedCount: 1 }] }],
      exports: [{ id: "export-1", roomId: "room-1", title: "Proof bundle", format: "zip" }],
    });

    const receipt = buildProofBundleReceipt({ roomId: "room-1", artifacts: bundle, generatedAt: 123 });
    const second = buildProofBundleReceipt({ roomId: "room-1", artifacts: [...bundle].reverse(), generatedAt: 456 });

    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.receiptId).toBe(`room-1:proof-bundle:${receipt.integrityHash}`);
    expect(receipt.integrityHash).toBe(second.integrityHash);
    expect(receipt.artifactCount).toBe(bundle.length);
    expect(receipt.kindCounts.notebook).toBe(1);
    expect(receipt.kindCounts.deck).toBe(1);
    expect(receipt.statusCounts.needs_review).toBeGreaterThan(0);
    expect(receipt.traceIds).toContain("trace-1");
    expect(receipt.proposalIds).toContain("proposal-1");
    expect(receipt.sourceIds).toContain("https://source.example/runway");
    expect(receipt.knownGaps.some((gap) => gap.reason === "human_review_required")).toBe(true);
  });

  it("builds a deterministic proof-bundle export manifest sidecar", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, structuredNotebook], proposals: [proposal], traces: [trace] });
    const bundle = buildWorkArtifacts({
      artifacts: [researchSheet, structuredNotebook],
      proposals: [proposal],
      traces: [trace],
      graph,
      decks: [{ id: "deck-1", roomId: "room-1", title: "Board readout", sections: [{ id: "s1", title: "Summary", unresolvedCount: 1 }] }],
      exports: [{ id: "export-1", roomId: "room-1", title: "Proof bundle", format: "zip" }],
    });
    const receipt = buildProofBundleReceipt({ roomId: "room-1", artifacts: bundle, generatedAt: 123 });
    const replay = buildTraceReplaySummary({ roomId: "room-1", traces: [trace], proposals: [proposal] });

    const manifest = buildProofBundleExportManifest({ roomId: "room-1", artifacts: bundle, receipt, traceReplay: replay, generatedAt: 123 });
    const second = buildProofBundleExportManifest({ roomId: "room-1", artifacts: [...bundle].reverse(), receipt, traceReplay: replay, generatedAt: 456 });
    const parsed = JSON.parse(proofBundleManifestJson(manifest));

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.integrityHash).toBe(second.integrityHash);
    expect(manifest.manifestId).toContain(receipt.receiptId);
    expect(manifest.exportIntents[0]).toMatchObject({ format: "json", receiptId: receipt.receiptId, replayHash: replay.replayHash });
    expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual([...manifest.artifacts.map((artifact) => artifact.id)].sort());
    expect(parsed.receipt.integrityHash).toBe(receipt.integrityHash);
    expect(proofBundleManifestFileName("Startup diligence / Q3", manifest)).toBe(`startup-diligence-q3-proof-bundle-${manifest.integrityHash}.json`);
  });

  it("builds a deterministic trace replay summary from existing trace rows", () => {
    const traces: TraceEvent[] = [
      { id: "trace-room", roomId: "room-1", ts: 1, actor: human, type: "room_created", summary: "Room created" },
      { id: "trace-chat", roomId: "room-1", ts: 2, actor: human, type: "message", summary: "Asked NodeAgent to reconcile funding" },
      { id: "trace-agent", roomId: "room-1", ts: 3, actor: agent, type: "agent_status", summary: "NodeAgent working on funding evidence" },
      { id: "trace-edit", roomId: "room-1", ts: 4, actor: agent, type: "edit_proposed", summary: "Funding update proposed", refs: { artifactId: "art-research", elementId: "r1__funding", proposalId: "proposal-1" } },
      { id: "trace-note", roomId: "room-1", ts: 5, actor: agent, type: "notebook_read_model", summary: "Notebook read model updated", refs: { artifactId: "art-note" } },
    ];

    const replay = buildTraceReplaySummary({ roomId: "room-1", traces, proposals: [proposal] });
    const second = buildTraceReplaySummary({ roomId: "room-1", traces: [...traces].reverse(), proposals: [proposal] });

    expect(replay.replayHash).toBe(second.replayHash);
    expect(replay.eventCount).toBe(5);
    expect(replay.traceIds).toEqual(["trace-room", "trace-chat", "trace-agent", "trace-edit", "trace-note"]);
    expect(replay.proposalIds).toContain("proposal-1");
    expect(replay.artifactIds).toEqual(["art-note", "art-research"]);
    expect(replay.phases.map((phase) => phase.id)).toEqual(["room", "chat", "agent", "edit", "notebook"]);
    expect(replay.phases.find((phase) => phase.id === "edit")?.status).toBe("needs_review");
    expect(replay.criticalPath.map((phase) => phase.id)).toContain("edit");
    expect(replay.status).toBe("running");

    const stats = traceReplayStats(replay);
    expect(stats).toMatchObject({
      events: 5,
      phases: 5,
      criticalPhases: 2,
      artifacts: 2,
      proposals: 1,
      statusLabel: "Running",
    });
    expect(traceReplayPhaseForTrace(replay, "trace-edit")?.id).toBe("edit");
  });

  it("summarizes public chat and NodeAgent live performance telemetry", () => {
    const messages: Message[] = [
      { id: "msg-human", roomId: "room-1", channel: "public", author: human, text: "@nodeagent reconcile funding", clientMsgId: "human-1", kind: "chat", createdAt: 10 },
      { id: "msg-agent", roomId: "room-1", channel: "public", author: agent, text: "Funding reconciliation complete.", clientMsgId: "final-run-1", kind: "agent", createdAt: 20 },
    ];

    const summary = buildLivePerformanceSummary({
      roomId: "room-1",
      messages,
      traces: [trace],
      run: { model: "openrouter/free", steps: 4, toolCalls: 3, inputTokens: 1200, outputTokens: 320, costUsd: 0.012, costKind: "estimated", ms: 1800 },
      job: {
        id: "job-1",
        status: "running",
        attempts: 1,
        maxAttempts: 3,
        modelPolicy: "free_auto",
        runtime: "workflow_sliced",
        updatedAt: 30,
        toolCallCount: 3,
        modelCallCount: 1,
        receiptCount: 2,
      },
      attempts: [{ attempt: 1, status: "running", resolvedModel: "openrouter/free", stopReason: "in_progress", ms: 900, inputTokens: 600, outputTokens: 120, costUsd: 0.004, costKind: "estimated" }],
      detail: {
        operations: [{ sequence: 1, kind: "mutation", name: "patch_bundle_cas", status: "completed" }],
        streamEvents: [{ sequence: 1, kind: "message_done", status: "completed", createdAt: 20, text: "done" }],
        streamParts: [],
        reasoningFrames: [{ frameId: "frame-1", sequence: 1, frameKind: "phase", phase: "synthesis", status: "running", goal: "reconcile funding", toolAllowlist: [] }],
        receipts: [{ id: "receipt-1", mutationName: "patch_bundle_cas", affectedIds: ["r1__funding"], createdAt: 22 }],
        leases: [],
        draftOperations: [],
        latestSteps: [{ idx: 1, tool: "patch_bundle_cas", status: "done" }],
      },
    });

    expect(summary.status).toBe("running");
    expect(summary.messageCount).toBe(2);
    expect(summary.humanMessageCount).toBe(1);
    expect(summary.agentMessageCount).toBe(1);
    expect(summary.runCount).toBe(1);
    expect(summary.agentTraceCount).toBe(1);
    expect(summary.latestActivityAt).toBe(40);
    expect(summary.job?.modelPolicy).toBe("free_auto");
    expect(summary.detailCounts).toMatchObject({ operations: 1, streamEvents: 1, reasoningFrames: 1, receipts: 1, latestSteps: 1 });
  });

  it("derives a stable storyboard-first deck plan from room artifacts before slide generation", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, notebook],
      traces: [trace],
      proposals: [proposal],
    });
    const second = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, notebook],
      traces: [trace],
      proposals: [proposal],
    });

    expect(storyboard.title).toBe("Startup diligence readout");
    expect(storyboard.planHash).toBe(second.planHash);
    expect(storyboard.slides.map((slide) => slide.title)).toEqual(["Company research", "Diligence notebook"]);
    expect(storyboard.storyboardStatus).toBe("needs_review");
    expect(storyboard.unresolvedGaps.some((gap) => gap.includes("Missing HIPAA source"))).toBe(true);
    expect(storyboard.traceIds).toContain("trace-1");
    expect(storyboard.proposalIds).toContain("proposal-1");
    expect(storyboard.slides[0].claims.some((claim) => claim.status === "verified")).toBe(true);
    expect(storyboard.slides[0].claims.some((claim) => claim.status === "needs_review")).toBe(true);
  });

  it("decodes named HTML entities before storyboard text reaches the deck UI and exports", () => {
    const encodedNotebook: Artifact = {
      ...notebook,
      id: "art-note-encoded",
      title: "Encoded note",
      elements: {
        b1: {
          ...notebook.elements.b1,
          value: "CardioNova &mdash; diligence brief &middot; $14M &amp; growing",
        },
      },
    };
    const storyboard = buildDeckStoryboardFromRoom({ roomId: "room-1", artifacts: [encodedNotebook] });
    const text = JSON.stringify(storyboard);

    expect(text).toContain("CardioNova - diligence brief · $14M & growing");
    expect(text).not.toMatch(/&(mdash|middot|amp);/);
  });

  it("converts a storyboard into a deck artifact input with receipt-ready sections", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, notebook],
      traces: [trace],
      proposals: [proposal],
    });
    const deckInput = deckArtifactInputFromStoryboard(storyboard);

    expect(deckInput.id).toBe("room-1:storyboard");
    expect(deckInput.status).toBe("needs_review");
    expect(deckInput.sections).toHaveLength(2);
    expect(deckInput.sections[0]).toMatchObject({ title: "Company research" });
    expect(deckInput.traceIds).toContain("trace-1");
    expect(deckInput.proposalIds).toContain("proposal-1");
    expect(deckInput.sourceIds).toEqual(["art-research", "art-note"]);
  });

  it("round-trips a collaborative deck through an ordinary CAS-backed note artifact", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, notebook],
      traces: [trace],
      proposals: [proposal],
    });
    const input = collaborativeDeckArtifactInput(storyboard);
    const deckArtifact: Artifact = {
      id: "art-deck",
      roomId: "room-1",
      kind: "note",
      title: input.title,
      version: 4,
      createdBy: human,
      updatedAt: 50,
      order: input.seed.map((item) => item.id),
      elements: Object.fromEntries(input.seed.map((item) => [item.id, cell(item.id, item.value)])),
      meta: input.meta,
    };

    expect(isCollaborativeDeckArtifact(deckArtifact)).toBe(true);
    const snapshot = readCollaborativeDeckArtifact(deckArtifact);
    expect(input.seed.some((item) => item.id === "deck_storyboard")).toBe(false);
    expect(snapshot).toMatchObject({ artifactId: "art-deck", elementVersion: 1, storageMode: "object-v2", comments: [] });
    expect(snapshot?.objectVersions[deckSlideElementId(storyboard.slides[0].slideId)]).toBe(1);
    expect(snapshot?.storyboard.slides).toHaveLength(2);
    const wrappedDeckArtifact = JSON.parse(JSON.stringify(deckArtifact)) as Artifact;
    const firstSlideElementId = deckSlideElementId(storyboard.slides[0].slideId);
    const firstSlideValue = wrappedDeckArtifact.elements[firstSlideElementId].value;
    wrappedDeckArtifact.elements[firstSlideElementId].value = {
      value: JSON.stringify(firstSlideValue),
      status: "complete",
      confidence: 1,
      evidence: [{ kind: "manual", label: "Reviewed agent result" }],
    };
    const wrappedSnapshot = readCollaborativeDeckArtifact(wrappedDeckArtifact);
    expect(wrappedSnapshot?.storyboard.slides).toHaveLength(2);
    expect(wrappedSnapshot?.storyboard.slides[0].title).toBe(storyboard.slides[0].title);

    wrappedDeckArtifact.elements[firstSlideElementId].value = { status: "complete", value: "not-json" };
    const malformedSnapshot = readCollaborativeDeckArtifact(wrappedDeckArtifact);
    expect(malformedSnapshot?.storyboard.slides).toHaveLength(2);
    expect(malformedSnapshot?.storyboard.slides[0]).toMatchObject({
      slideId: storyboard.slides[0].slideId,
      title: "Unresolved slide object",
      status: "needs_review",
    });
    const persisted = resolveRoomDeckStoryboard({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, notebook, deckArtifact],
      traces: [trace],
      proposals: [proposal],
    });
    expect(persisted?.planHash).toBe(snapshot?.storyboard.planHash);
    expect(persisted?.slides).toHaveLength(2);
  });

  it("accepts governed full-storyboard and object-level deck proposals", () => {
    const storyboard = buildDeckStoryboardFromRoom({ roomId: "room-1", artifacts: [researchSheet, notebook] });
    const proposed = normalizeCollaborativeDeck({ ...storyboard, objective: "Approve the board decision." }, storyboard.version + 1);
    const deckProposal: Proposal = {
      ...proposal,
      id: "proposal-deck",
      artifactId: "art-deck",
      status: "pending",
      op: {
        ...proposal.op,
        artifactId: "art-deck",
        elementId: "deck_storyboard",
        kind: "set",
        value: proposed,
        baseVersion: 4,
      },
    };

    expect(readCollaborativeDeckProposal(deckProposal, "art-deck")).toMatchObject({
      proposalId: "proposal-deck",
      status: "pending",
      baseVersion: 4,
      storyboard: { objective: "Approve the board decision." },
    });
    expect(readCollaborativeDeckProposal({ ...deckProposal, artifactId: "other" }, "art-deck")).toBeNull();
    expect(readCollaborativeDeckProposal({ ...deckProposal, op: { ...deckProposal.op, elementId: "doc" } }, "art-deck")).toBeNull();
    expect(readCollaborativeDeckProposal({ ...deckProposal, op: { ...deckProposal.op, value: { text: "not a deck" } } }, "art-deck")).toBeNull();
    const slideObjectId = deckSlideElementId(storyboard.slides[0].slideId);
    const slideObject = collaborativeDeckArtifactInput(storyboard).seed.find((item) => item.id === slideObjectId)?.value;
    const objectProposal = { ...deckProposal, op: { ...deckProposal.op, elementId: slideObjectId, value: slideObject, baseVersion: 2 } };
    expect(readCollaborativeDeckProposal(objectProposal, "art-deck")).toMatchObject({
      proposalId: "proposal-deck",
      baseVersion: 2,
      objectPatch: { elementId: slideObjectId },
    });
    expect(readCollaborativeDeckProposal({
      ...objectProposal,
      op: { ...objectProposal.op, value: { ...(slideObject as Record<string, unknown>), status: "invented" } },
    }, "art-deck")).toBeNull();
    const slidePatch = {
      schema: "2",
      kind: "slide_patch",
      objectId: slideObjectId,
      slideId: storyboard.slides[0].slideId,
      changes: { purpose: "Lead with verified findings." },
    };
    expect(readCollaborativeDeckProposal({
      ...objectProposal,
      op: { ...objectProposal.op, value: { value: JSON.stringify(slidePatch), status: "complete" } },
    }, "art-deck")).toMatchObject({ objectPatch: { elementId: slideObjectId, value: slidePatch } });
  });

  it("contracts NodeAgent to propose the exact slide object instead of a detached workpaper", () => {
    const storyboard = buildDeckStoryboardFromRoom({ roomId: "room-1", artifacts: [researchSheet, notebook] });
    const slide = storyboard.slides[0];
    const goal = buildDeckObjectProposalGoal({
      artifactId: "art-deck",
      storyboard,
      slide,
      baseVersion: 4,
      reviewerRequest: "Emphasize verified findings.",
    });
    expect(goal).toContain(`Proposal elementId: ${deckSlideElementId(slide.slideId)}`);
    expect(goal).toContain("Proposal baseVersion: 4");
    expect(goal).toContain('"schema":2');
    expect(goal).toContain('"kind":"slide_patch"');
    expect(goal).toContain("Call write_locked_cell (never write_locked_cell_result or write_locked_cell_results)");
    expect(goal).toContain("do not create a separate *_patch_workpaper element");
    const titleGoal = buildDeckObjectProposalGoal({
      artifactId: "art-deck",
      storyboard,
      slide,
      baseVersion: 4,
      reviewerRequest: "Tighten the heading.",
      targetField: "title",
    });
    expect(titleGoal).toContain("Requested field: title.");
    expect(titleGoal).toContain('"changes":{"title":"REPLACE_WITH_REVIEWED_TITLE"}');
  });

  it("plans slide, claim, and structural changes as independent CAS objects", () => {
    const storyboard = buildDeckStoryboardFromRoom({ roomId: "room-1", artifacts: [researchSheet, notebook] });
    const input = collaborativeDeckArtifactInput(storyboard);
    const artifact: Artifact = {
      id: "art-deck-objects",
      roomId: "room-1",
      kind: "note",
      title: input.title,
      version: 1,
      createdBy: human,
      updatedAt: 50,
      order: input.seed.map((item) => item.id),
      elements: Object.fromEntries(input.seed.map((item) => [item.id, cell(item.id, item.value)])),
      meta: input.meta,
    };
    const snapshot = readCollaborativeDeckArtifact(artifact)!;

    const purposeEdit = normalizeCollaborativeDeck({ ...snapshot.storyboard, slides: snapshot.storyboard.slides.map((slide, index) => index === 0 ? { ...slide, purpose: "Prove the investment decision." } : slide) }, snapshot.storyboard.version + 1);
    const purposePlan = planDeckObjectMutations({ storageMode: snapshot.storageMode, current: snapshot.storyboard, objectVersions: snapshot.objectVersions, next: purposeEdit });
    expect(purposePlan).toEqual([expect.objectContaining({ elementId: deckSlideElementId(storyboard.slides[0].slideId), kind: "set", baseVersion: 1 })]);

    const verified = snapshot.storyboard.slides.flatMap((slide) => slide.claims).find((claim) => claim.status === "verified")!;
    const claimEdit = normalizeCollaborativeDeck({
      ...snapshot.storyboard,
      slides: snapshot.storyboard.slides.map((slide) => ({ ...slide, claims: slide.claims.map((claim) => claim.claimId === verified.claimId ? { ...claim, text: `${claim.text} verified` } : claim) })),
    }, snapshot.storyboard.version + 1);
    const claimPlan = planDeckObjectMutations({ storageMode: snapshot.storageMode, current: snapshot.storyboard, objectVersions: snapshot.objectVersions, next: claimEdit });
    expect(claimPlan).toEqual([expect.objectContaining({ elementId: deckClaimElementId(verified.claimId), kind: "set", baseVersion: 1 })]);

    const added = addCollaborativeDeckSlide(snapshot.storyboard, snapshot.storyboard.slides[0].slideId);
    const structuralPlan = planDeckObjectMutations({ storageMode: snapshot.storageMode, current: snapshot.storyboard, objectVersions: snapshot.objectVersions, next: added });
    expect(structuralPlan.at(-1)?.elementId).toBe("deck:order");
    expect(structuralPlan.find((mutation) => mutation.elementId === deckSlideElementId(added.slides[1].slideId))).toMatchObject({ kind: "create", baseVersion: 0 });
  });

  it("keeps deck comments as independent resolvable objects", () => {
    const comment = createDeckComment({ commentId: "comment-1", slideId: "slide-1", body: "  Verify the revenue bridge.  ", author: human, createdAt: 10 });
    expect(deckCommentElementId(comment.commentId)).toBe("deck:comment:comment-1");
    expect(comment).toMatchObject({ body: "Verify the revenue bridge.", status: "open", targetObjectId: "deck:slide:slide-1" });
    expect(resolveDeckComment(comment, agent, 20)).toMatchObject({ status: "resolved", resolvedAt: 20, resolvedBy: agent });
  });

  it("supports deterministic add, duplicate, move, delete, and normalization for deck collaboration", () => {
    const storyboard = buildDeckStoryboardFromRoom({ roomId: "room-1", artifacts: [researchSheet, notebook] });
    const added = addCollaborativeDeckSlide(storyboard, storyboard.slides[0].slideId);
    const newSlide = added.slides[1];
    const duplicated = duplicateCollaborativeDeckSlide(added, newSlide.slideId);
    const moved = moveCollaborativeDeckSlide(duplicated, duplicated.slides[2].slideId, -1);
    const deleted = deleteCollaborativeDeckSlide(moved, newSlide.slideId);
    const normalized = normalizeCollaborativeDeck({ ...deleted, objective: "  Board decision  " }, deleted.version + 1);

    expect(added.slides).toHaveLength(3);
    expect(duplicated.slides).toHaveLength(4);
    expect(new Set(duplicated.slides.map((slide) => slide.slideId)).size).toBe(4);
    expect(moved.slides[1].title).toContain("copy");
    expect(deleted.slides).toHaveLength(3);
    expect(normalized.objective).toBe("Board decision");
    expect(normalized.version).toBeGreaterThan(storyboard.version);
    expect(normalized.planHash).not.toBe(storyboard.planHash);
    expect(normalized.requiredEvidence.length).toBeGreaterThan(0);
  });

  it("builds a deterministic reviewer deck patch plan from storyboard gaps and proposals", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, structuredNotebook],
      traces: [trace],
      proposals: [proposal],
    });

    const patchPlan = buildDeckPatchPlan(storyboard);
    const second = buildDeckPatchPlan(storyboard);

    expect(patchPlan.patchVersion).toBe(1);
    expect(patchPlan.integrityHash).toBe(second.integrityHash);
    expect(deckPatchPlanJson(patchPlan)).toBe(deckPatchPlanJson(second));
    expect(patchPlan.patchCount).toBeGreaterThan(0);
    expect(patchPlan.readyForReviewCount).toBeGreaterThan(0);
    expect(patchPlan.needsSourceCount).toBeGreaterThan(0);
    expect(patchPlan.proposalIds).toContain("proposal-1");
    expect(patchPlan.sourceArtifactIds).toEqual(expect.arrayContaining(["art-research", "art-structured-note"]));
    expect(patchPlan.items.some((item) => item.kind === "proposal_review" && item.proposalId === "proposal-1")).toBe(true);
    expect(patchPlan.items.some((item) => item.kind === "gap_resolution" && item.beforeText.includes("Missing HIPAA source"))).toBe(true);
    expect(patchPlan.items.every((item) => item.afterText.length > item.beforeText.length)).toBe(true);
    expect(deckPatchPlanFileName(storyboard.title, patchPlan.integrityHash)).toBe(`startup-diligence-readout-deck-patch-plan-${patchPlan.integrityHash}.json`);
  });

  it("builds a deterministic HTML deck preview export from the storyboard plan", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, structuredNotebook],
      traces: [trace],
      proposals: [proposal],
    });

    const preview = buildDeckPreviewExport(storyboard, 123);
    const second = buildDeckPreviewExport(storyboard, 456);

    expect(preview.exportVersion).toBe(1);
    expect(preview.integrityHash).toBe(second.integrityHash);
    expect(preview.slideCount).toBe(2);
    expect(preview.needsReviewCount).toBeGreaterThan(0);
    expect(preview.html).toContain("<!doctype html>");
    expect(preview.html).toContain("Startup diligence readout");
    expect(preview.html).toContain("NodeRoom deck preview");
    expect(deckPreviewFileName(storyboard.title, preview.integrityHash)).toBe(`startup-diligence-readout-deck-preview-${preview.integrityHash}.html`);
  });

  it("builds a deterministic portable PPTX deck export from the storyboard plan", async () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, structuredNotebook],
      traces: [trace],
      proposals: [proposal],
    });

    const pptx = await buildDeckPptxExport(storyboard, 123);
    const second = await buildDeckPptxExport(storyboard, 456);
    const zip = await JSZip.loadAsync(pptx.bytes);
    const presentation = await zip.file("ppt/presentation.xml")!.async("string");
    const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    const core = await zip.file("docProps/core.xml")!.async("string");
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(pptx.exportVersion).toBe(1);
    expect(pptx.integrityHash).toBe(second.integrityHash);
    expect(Buffer.from(pptx.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(Object.values(zip.files).some((entry) => entry.dir)).toBe(false);
    expect(new Set(Object.values(zip.files).map((entry) => entry.date.getTime())).size).toBe(1);
    expect([...pptx.bytes.slice(0, 2)].map((value) => String.fromCharCode(value)).join("")).toBe("PK");
    expect(pptx.slideCount).toBe(2);
    expect(pptx.needsReviewCount).toBeGreaterThan(0);
    expect(deckPptxFileName(storyboard.title, pptx.integrityHash)).toBe(`startup-diligence-readout-deck-${pptx.integrityHash}.pptx`);
    expect(presentation).toContain('r:id="rId2"');
    expect(presentationRels).toContain("slides/slide1.xml");
    expect(core).toContain("<dc:creator>NodeRoom</dc:creator>");
    expect(slide1).toContain("Company research");
  });

  it("builds a deterministic portable PDF deck export from the storyboard plan", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, structuredNotebook],
      traces: [trace],
      proposals: [proposal],
    });

    const pdf = buildDeckPdfExport(storyboard, 123);
    const second = buildDeckPdfExport(storyboard, 456);
    const text = new TextDecoder().decode(pdf.bytes);

    expect(pdf.exportVersion).toBe(1);
    expect(pdf.integrityHash).toBe(second.integrityHash);
    expect(Buffer.from(pdf.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? [])).toHaveLength(2);
    expect(pdf.slideCount).toBe(2);
    expect(pdf.needsReviewCount).toBeGreaterThan(0);
    expect(deckPdfFileName(storyboard.title, pdf.integrityHash)).toBe(`startup-diligence-readout-deck-${pdf.integrityHash}.pdf`);
    expect(text).toContain("Company research");
    expect(text).toContain("Missing HIPAA source");
  });
});
