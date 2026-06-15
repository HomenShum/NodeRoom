import { describe, expect, it } from "vitest";
import {
  OKF_RETRIEVAL_TOOLS,
  OkfConceptStore,
  createOkfConcept,
  retrieveUntilSufficient,
  serializeOkfConcept,
  parseOkfConcept,
  validateOkfBundleFiles,
  writeOkfBundleFiles,
  type OkfConcept,
} from "@nodeagent/index";
import type { RoomTools } from "@nodeagent/core/types";

function fixtureConcepts(): OkfConcept[] {
  return [
    createOkfConcept({
      path: "companies/cardionova.md",
      frontmatter: {
        type: "Company",
        title: "CardioNova",
        description: "CardioNova is a cardiovascular device startup.",
        tags: ["startup-diligence", "runway"],
        timestamp: "2026-06-15T00:00:00Z",
        visibility: "public",
      },
      body: "CardioNova uses the [runway estimate](/cells/cardionova_runway.md) and cites [cash source](/sources/cardionova_cash.md).",
    }),
    createOkfConcept({
      path: "sources/cardionova_cash.md",
      frontmatter: {
        type: "Source",
        title: "CardioNova data room cash schedule",
        description: "Uploaded workbook row supporting current cash.",
        resource: "noderoom://storage/cash-schedule.xlsx#Sheet1!B14",
        tags: ["source", "cash", "runway"],
        timestamp: "2026-06-15T00:00:00Z",
        visibility: "public",
        noderoom: { sourceKind: "upload", status: "complete", confidence: 0.9 },
      },
      body: "# Source Snippet\nCash balance is $4.8M as of 2026-05-31.\n",
    }),
    createOkfConcept({
      path: "cells/cardionova_runway.md",
      frontmatter: {
        type: "Spreadsheet Cell",
        title: "CardioNova runway estimate",
        description: "Runway estimate from cash and monthly burn.",
        resource: "noderoom://rooms/r1/artifacts/a1/elements/rc_cardionova__runway",
        tags: ["runway", "finance", "needs-review"],
        timestamp: "2026-06-15T00:00:00Z",
        visibility: "public",
        noderoom: {
          roomId: "r1",
          artifactId: "a1",
          elementId: "rc_cardionova__runway",
          status: "needs_review",
          confidence: 0.62,
          sourceKind: "computed",
        },
      },
      body: "# Calculation\nRunway = $4.8M cash / $400k monthly burn = 12 months.\n\n# Citations\n[1] [Cash schedule](/sources/cardionova_cash.md)\n",
    }),
  ];
}

describe("OKF concept and retrieval layer", () => {
  it("serializes, parses, and validates OKF concepts with required type", () => {
    const concept = fixtureConcepts()[2];
    const raw = serializeOkfConcept(concept);
    const parsed = parseOkfConcept(concept.path, raw);
    expect(parsed.id).toBe("cells/cardionova_runway");
    expect(parsed.frontmatter.type).toBe("Spreadsheet Cell");
    expect(parsed.citations[0]).toMatchObject({ id: "1", conceptId: "sources/cardionova_cash" });
    expect(validateOkfBundleFiles(writeOkfBundleFiles(fixtureConcepts()))).toEqual([]);
  });

  it("supports full-text, semantic, filter, glob, regex, backlinks, and literal source lookup", async () => {
    const store = new OkfConceptStore(fixtureConcepts());
    expect((await store.fullTextSearch({ query: "CardioNova runway cash", limit: 2 }))[0]?.concept.id).toBe("cells/cardionova_runway");
    expect((await store.semanticSearch({ query: "which source supports the runway assumption", limit: 2 })).map((h) => h.concept.id)).toContain("cells/cardionova_runway");
    expect((await store.filter({ type: "Spreadsheet Cell", status: "needs_review" })).map((c) => c.id)).toEqual(["cells/cardionova_runway"]);
    expect((await store.glob({ pattern: "sources/*.md" })).map((c) => c.id)).toEqual(["sources/cardionova_cash"]);
    expect((await store.regex({ pattern: "rc_cardionova__runway" }))[0]?.concept.id).toBe("cells/cardionova_runway");
    expect((await store.backlinks({ conceptId: "sources/cardionova_cash" })).map((c) => c.id)).toContain("companies/cardionova");
    expect(await store.resolveCitation({ evidenceId: "cells/cardionova_runway#1" })).toMatchObject({ ok: true, conceptId: "sources/cardionova_cash" });
  });

  it("exposes OKF retrieval through AgentTool definitions", async () => {
    const rt = { okf: new OkfConceptStore(fixtureConcepts()) } as unknown as RoomTools;
    const names = OKF_RETRIEVAL_TOOLS.map((tool) => tool.name);
    expect(names).toContain("okf_semantic_search");
    const tool = OKF_RETRIEVAL_TOOLS.find((item) => item.name === "source_compare_claim");
    expect(tool).toBeTruthy();
    const result = await tool?.execute({
      claim: "CardioNova runway is 12 months from cash and burn.",
      evidenceRefs: [{ evidenceId: "cells/cardionova_runway#1" }],
    }, rt);
    expect(result).toMatchObject({ support: "partial" });
  });

  it("runs an investigate-until-sufficient loop and marks missing review evidence", async () => {
    const packet = await retrieveUntilSufficient({
      retrieval: new OkfConceptStore(fixtureConcepts()),
      query: "CardioNova runway cash burn source",
      claim: "CardioNova runway is 12 months.",
      clientReadyRequired: true,
    });
    expect(packet.hits[0]?.concept.id).toBe("cells/cardionova_runway");
    expect(packet.literalSources[0]?.ok).toBe(true);
    expect(packet.sufficiency.enoughToAnswer).toBe(true);
    expect(packet.sufficiency.enoughForClientReady).toBe(false);
    expect(packet.caveat).toContain("Needs review");
  });
});
