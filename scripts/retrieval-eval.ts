import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  OkfConceptStore,
  createOkfConcept,
  retrieveUntilSufficient,
  type OkfConcept,
} from "../src/nodeagent";

function concepts(): OkfConcept[] {
  return [
    createOkfConcept({
      path: "companies/cardionova.md",
      frontmatter: {
        type: "Company",
        title: "CardioNova",
        description: "Cardiovascular device startup under diligence.",
        tags: ["startup-diligence", "runway"],
        timestamp: "2026-06-15T00:00:00Z",
        visibility: "public",
      },
      body: "CardioNova depends on the [runway estimate](/cells/cardionova_runway.md).",
    }),
    createOkfConcept({
      path: "sources/cardionova_cash.md",
      frontmatter: {
        type: "Source",
        title: "CardioNova uploaded cash schedule",
        description: "Literal source for current cash.",
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
        resource: "noderoom://rooms/demo/artifacts/company-research/elements/rc_cardionova__runway",
        tags: ["runway", "finance", "needs-review"],
        timestamp: "2026-06-15T00:00:00Z",
        visibility: "public",
        noderoom: {
          roomId: "demo",
          artifactId: "company-research",
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

async function main() {
  const roomContextOnly = {
    answerAccuracy: false,
    evidenceAccuracy: false,
    retrievalRecall: false,
    note: "Room context names CardioNova but lacks the literal cash source and computed runway concept.",
  };
  const okfPacket = await retrieveUntilSufficient({
    retrieval: new OkfConceptStore(concepts()),
    query: "CardioNova runway cash burn source",
    claim: "CardioNova runway is 12 months.",
    clientReadyRequired: true,
  });
  const okfHybrid = {
    answerAccuracy: okfPacket.sufficiency.enoughToAnswer,
    evidenceAccuracy: okfPacket.literalSources.some((source) => source.ok),
    retrievalRecall: okfPacket.hits.some((hit) => hit.concept.id === "cells/cardionova_runway"),
    retrievalPrecision: okfPacket.hits.length <= 5,
    sufficiency: okfPacket.sufficiency,
    caveat: okfPacket.caveat,
  };
  const result = {
    generatedAt: new Date().toISOString(),
    task: "Explain CardioNova runway and identify supporting source evidence.",
    variants: {
      roomContextOnly,
      okfHybrid,
    },
  };
  const jsonPath = "docs/eval/retrieval/okf-vs-room-context.json";
  const mdPath = "docs/eval/retrieval/okf-vs-room-context.md";
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(mdPath, [
    "# OKF vs Room Context Retrieval Eval",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "Task: Explain CardioNova runway and identify supporting source evidence.",
    "",
    "| Variant | Answer | Evidence | Recall | Precision | Client ready |",
    "|---|---:|---:|---:|---:|---:|",
    `| Room context only | ${roomContextOnly.answerAccuracy ? "pass" : "fail"} | ${roomContextOnly.evidenceAccuracy ? "pass" : "fail"} | ${roomContextOnly.retrievalRecall ? "pass" : "fail"} | n/a | fail |`,
    `| OKF hybrid retrieval | ${okfHybrid.answerAccuracy ? "pass" : "fail"} | ${okfHybrid.evidenceAccuracy ? "pass" : "fail"} | ${okfHybrid.retrievalRecall ? "pass" : "fail"} | ${okfHybrid.retrievalPrecision ? "pass" : "fail"} | ${okfHybrid.sufficiency.enoughForClientReady ? "pass" : "fail"} |`,
    "",
    `Caveat: ${okfHybrid.caveat ?? "none"}`,
    "",
  ].join("\n"));
  console.log(JSON.stringify(result, null, 2));
}

await main();

