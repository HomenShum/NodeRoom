import { describe, expect, it } from "vitest";
import { displayArtifactRefMessage, encodeArtifactRefLine, parseArtifactRefMessage, type ArtifactRef } from "../src/ui/artifactRefs";

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
});
