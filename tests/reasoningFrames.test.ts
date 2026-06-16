import { describe, expect, it } from "vitest";
import {
  REASONING_FRAME_PLAN_SCHEMA,
  buildRoomWorkReasoningPlan,
  roomWorkCacheKey,
  roomWorkFacetFrameId,
} from "../src/nodeagent/core/reasoningFrames";

describe("reasoning frame planner", () => {
  it("builds a cache-first multi-frame room-work plan without depending on a model", () => {
    const plan = buildRoomWorkReasoningPlan({
      framePlanId: "roomwork:test:cardionova",
      globalGoal: "Room work agent_fill: Fill diligence fields for CardioNova.",
      mode: "agent_fill",
      artifactId: "artifact_123",
      inputKind: "agent_request",
      entities: [{ entityType: "company", entityKey: "cardionova", displayName: "CardioNova" }],
      facets: ["company_profile", "funding"],
      cacheHitCount: 1,
      freshHitCount: 1,
      facetPlans: [
        {
          entityType: "company",
          entityKey: "cardionova",
          displayName: "CardioNova",
          facet: "company_profile",
          cachePolicy: "fresh_use_cache",
          status: "cached",
          cacheHit: { cacheId: "cache_1", fresh: true },
        },
        {
          entityType: "company",
          entityKey: "cardionova",
          displayName: "CardioNova",
          facet: "funding",
          cachePolicy: "missing_research_now",
          status: "queued",
        },
      ],
    });

    expect(plan.schema).toBe(REASONING_FRAME_PLAN_SCHEMA);
    expect(plan.capability).toBe("harness_recursive_reasoning");
    expect(plan.summary.phases).toEqual(["intake", "plan", "execute", "verify", "synthesize"]);
    expect(plan.summary.cachePolicyCounts).toMatchObject({ fresh_use_cache: 1, missing_research_now: 1 });
    expect(plan.decision).toMatchObject({ next: "spawn_children", childFrameCount: 1 });
    expect(plan.childFrames).toHaveLength(1);
    expect(plan.childFrames[0]).toMatchObject({
      entityKey: "cardionova",
      facet: "funding",
      cacheKey: roomWorkCacheKey({ entityType: "company", entityKey: "cardionova", facet: "funding" }),
      expectedOutputSchema: "entity_facet_result_with_evidence_v1",
    });
    expect(plan.childFrames[0].frameId).toBe(roomWorkFacetFrameId({
      framePlanId: "roomwork:test:cardionova",
      entityType: "company",
      entityKey: "cardionova",
      facet: "funding",
    }));
    expect(plan.frames.find((frame) => frame.phase === "execute")?.evidenceState).toMatchObject({
      availableRefs: ["cache_1"],
      missingRefs: [roomWorkCacheKey({ entityType: "company", entityKey: "cardionova", facet: "funding" })],
    });
  });

  it("marks frame decisions as blocked when PlanPreview blocks execution", () => {
    const plan = buildRoomWorkReasoningPlan({
      framePlanId: "roomwork:test:blocked",
      globalGoal: "Room work agent_fill: Fill funding for CardioNova.",
      mode: "agent_fill",
      artifactId: "artifact_123",
      entities: [{ entityType: "company", entityKey: "cardionova", displayName: "CardioNova" }],
      facets: ["funding"],
      cacheHitCount: 0,
      freshHitCount: 0,
      blockedReason: "plan_conflict: pending proposal touches the target range",
      facetPlans: [{
        entityType: "company",
        entityKey: "cardionova",
        displayName: "CardioNova",
        facet: "funding",
        cachePolicy: "missing_research_now",
        status: "queued",
      }],
    });

    expect(plan.decision).toMatchObject({ next: "block", blockedReason: "plan_conflict: pending proposal touches the target range" });
    expect(plan.frames.every((frame) => frame.status === "completed" || frame.status === "blocked")).toBe(true);
    expect(plan.childFrames[0]).toMatchObject({ status: "blocked" });
  });
});
