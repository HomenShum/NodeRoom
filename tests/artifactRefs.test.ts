import { describe, expect, it } from "vitest";
import { artifactRefContextSuffix, artifactRefKey, displayArtifactRefMessage, encodeArtifactRefLine, parseArtifactRefMessage, type ArtifactRef } from "../src/ui/artifactRefs";

describe("artifact refs", () => {
  it("round-trips id, title, and kind from persisted reference links", () => {
    const refs: ArtifactRef[] = [{ id: "sheet:Q3 variance/1", title: "Q3 variance", kind: "sheet" }];
    const parsed = parseArtifactRefMessage(`${encodeArtifactRefLine(refs)}\n\n/ask reconcile this`);

    expect(parsed.refs).toEqual(refs);
    expect(parsed.body).toBe("/ask reconcile this");
  });

  it("keeps bare References text visible when no artifact refs parse", () => {
    const text = "References: see the deck\nFollow up tomorrow.";

    expect(parseArtifactRefMessage(text)).toEqual({ refs: [], body: text });
  });

  it("keeps mixed manual text visible instead of dropping it from a references line", () => {
    const refs: ArtifactRef[] = [{ id: "a1", title: "Q3 variance", kind: "sheet" }];
    const text = `${encodeArtifactRefLine(refs)} see the deck\nFollow up tomorrow.`;

    expect(parseArtifactRefMessage(text)).toEqual({ refs: [], body: text });
  });

  it("displays artifact reference messages without exposing the hidden marker", () => {
    const refs: ArtifactRef[] = [{ id: "memo:1", title: "Diligence memo", kind: "note" }];

    expect(displayArtifactRefMessage(`${encodeArtifactRefLine(refs)}\n\nPlease review this.`)).toBe("Please review this.");
    expect(displayArtifactRefMessage(encodeArtifactRefLine(refs))).toBe("Diligence memo");
  });

  it("round-trips scoped deck, proposal, and trace context on a real backing artifact", () => {
    const refs: ArtifactRef[] = [
      { id: "deck-note-1", title: "Slide 2: Market evidence", kind: "note", contextKind: "deck_slide", contextId: "slide-2", elementId: "deck_storyboard" },
      { id: "deck-note-1", title: "Proposal: claim-3", kind: "note", contextKind: "proposal", contextId: "proposal-3", elementId: "claim-3" },
    ];
    const parsed = parseArtifactRefMessage(`${encodeArtifactRefLine(refs)}\n\n@nodeagent review these`);

    expect(parsed.refs).toEqual(refs);
    expect(new Set(parsed.refs.map(artifactRefKey)).size).toBe(2);
    expect(artifactRefContextSuffix(parsed.refs)).toContain("deck slide: Slide 2: Market evidence");
    expect(artifactRefContextSuffix(parsed.refs)).toContain("target proposal-3");
  });
});
