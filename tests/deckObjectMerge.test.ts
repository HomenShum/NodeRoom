import { describe, expect, it } from "vitest";
import {
  DECK_META_ELEMENT_ID,
  DECK_ORDER_ELEMENT_ID,
  changedDeckObjectIds,
  deckClaimElementId,
  deckSlideElementId,
  findDeckObjectConflicts,
  mergeCollaborativeDeckObjectChanges,
  normalizeCollaborativeDeck,
  planDeckObjectMutations,
  type DeckStoryboard,
} from "../src/ui/workArtifacts";

function storyboard(): DeckStoryboard {
  return normalizeCollaborativeDeck({
    deckId: "deck-merge",
    roomId: "room-merge",
    title: "Board readout",
    audience: "board",
    objective: "Explain the decision.",
    privacy: "room",
    storyboardStatus: "draft",
    slides: [
      {
        slideId: "slide-1",
        title: "Decision",
        purpose: "State the decision.",
        claims: [{ claimId: "claim-1", text: "Revenue reconciles.", status: "manual", sourceArtifactId: "sheet-1" }],
        sourceArtifactIds: ["sheet-1"],
        evidenceIds: ["evidence-1"],
        unresolvedGaps: [],
        status: "draft",
      },
      {
        slideId: "slide-2",
        title: "Risks",
        purpose: "Explain the risks.",
        claims: [{ claimId: "claim-2", text: "Runway needs review.", status: "manual" }],
        sourceArtifactIds: [],
        evidenceIds: [],
        unresolvedGaps: ["Verify runway."],
        status: "needs_review",
      },
    ],
    requiredEvidence: [],
    unresolvedGaps: [],
    sourceArtifactIds: ["sheet-1"],
    traceIds: [],
    proposalIds: [],
    planHash: "seed",
    version: 1,
  }, 1);
}

function copy(value: DeckStoryboard): DeckStoryboard {
  return structuredClone(value);
}

function versions(): Record<string, number> {
  return {
    [DECK_META_ELEMENT_ID]: 3,
    [DECK_ORDER_ELEMENT_ID]: 2,
    [deckSlideElementId("slide-1")]: 4,
    [deckSlideElementId("slide-2")]: 7,
    [deckClaimElementId("claim-1")]: 2,
    [deckClaimElementId("claim-2")]: 2,
  };
}

describe("collaborative deck three-way object merge", () => {
  it("allows disjoint object edits and plans only the local object against latest CAS versions", () => {
    const base = storyboard();
    const local = copy(base);
    const current = copy(base);
    local.slides[0].title = "Local decision title.";
    current.slides[1].title = "Remote risk title.";

    expect(findDeckObjectConflicts({ base, current, next: local })).toEqual([]);
    const merged = mergeCollaborativeDeckObjectChanges({ base, current, next: local });
    expect(merged.slides.map((slide) => slide.title)).toEqual(["Local decision title.", "Remote risk title."]);
    expect(merged.requiredEvidence).toEqual(expect.arrayContaining([
      "Local decision title.: Revenue reconciles.",
      "Remote risk title.: Runway needs review.",
    ]));
    const localObjectIds = new Set(changedDeckObjectIds(current, merged));
    const mutations = planDeckObjectMutations({
      storageMode: "object-v2",
      current,
      objectVersions: versions(),
      next: merged,
      changedObjectIds: localObjectIds,
    });

    expect(mutations).toHaveLength(2);
    expect(mutations).toContainEqual(expect.objectContaining({
      elementId: deckSlideElementId("slide-1"),
      kind: "set",
      baseVersion: 4,
    }));
    expect(mutations).toContainEqual(expect.objectContaining({ elementId: DECK_META_ELEMENT_ID, baseVersion: 3 }));
    expect(mutations.some((mutation) => mutation.elementId === deckSlideElementId("slide-2"))).toBe(false);
  });

  it("reports the stable object id when local and remote edits overlap", () => {
    const base = storyboard();
    const local = copy(base);
    const current = copy(base);
    local.slides[0].purpose = "Local decision narrative.";
    current.slides[0].title = "Remote decision title.";

    expect(findDeckObjectConflicts({ base, current, next: local })).toEqual([deckSlideElementId("slide-1")]);
  });
});
