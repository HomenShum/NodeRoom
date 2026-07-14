import { describe, expect, it } from "vitest";
import { buildBoundedGraphAgentGoal, collectGraphAgentArtifactIds, formatGraphAgentNodeContext, GRAPH_AGENT_GOAL_MAX_CHARS } from "../src/ui/graph/graphAgentContext";
import type { SemanticGraphNode } from "../src/ui/graph/semanticGraphTypes";

const notebookBlock: SemanticGraphNode = {
  id: "notebook:block:cardionova",
  kind: "notebook_block",
  label: "CardioNova research brief",
  status: "manual",
  refs: [{ artifactId: "artifact_note_123", artifactTitle: "CardioNova diligence memo", elementId: "doc", rowId: "block_cardionova" }],
  clusterIds: ["company:cardionova"],
  weight: 1,
};

describe("graph agent context", () => {
  it("keeps exact artifact IDs distinct from graph and block IDs", () => {
    expect(formatGraphAgentNodeContext(notebookBlock)).toContain("artifactId=artifact_note_123");
    expect(formatGraphAgentNodeContext(notebookBlock)).toContain("artifactTitle=CardioNova diligence memo");
    expect(formatGraphAgentNodeContext(notebookBlock)).toContain("elementId=doc");
    expect(collectGraphAgentArtifactIds([notebookBlock])).toEqual(["artifact_note_123"]);
    expect(collectGraphAgentArtifactIds([notebookBlock])).not.toContain("notebook:block:cardionova");
  });

  it("keeps exact IDs while bounding the durable job goal", () => {
    const goal = buildBoundedGraphAgentGoal({
      roomId: "room-1",
      userPrompt: "Inspect attribution. ".repeat(200),
      visibleNodes: 88,
      visibleEdges: 177,
      backedFacts: 3,
      openQuestions: 2,
      selectedNode: notebookBlock,
      nearbyNodes: Array.from({ length: 20 }, (_, index) => ({
        ...notebookBlock,
        id: `${notebookBlock.id}:${index}`,
        label: `${notebookBlock.label} ${index}`,
      })),
    });

    expect(goal.length).toBeLessThanOrEqual(GRAPH_AGENT_GOAL_MAX_CHARS);
    expect(goal).toContain("artifact_note_123");
    expect(goal).toContain("Never derive an artifactId");
    expect(goal).toContain("call list_artifacts");
  });
});
