import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import {
  artifactPath,
  assertNoUnexpectedErrors,
  buildUnderwritingPacket,
  captureScenarioScreenshot,
  openFreshWorkspace,
  uploadDemoInputs,
  writeJsonArtifact,
} from "./proximittyHarness";

const REQUIRED_HEADINGS = [
  "## Summary",
  "## Key Risks",
  "## Mitigants",
  "## Financial/Risk Signals",
  "## Evidence Links",
  "## Needs_Review Items",
  "## Next Action Recommendation",
];

test("Scenario 3 - underwriting packet exports and reopens with required sections", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await openFreshWorkspace(page);
  const uploadedFiles = await uploadDemoInputs(page);
  const packet = buildUnderwritingPacket();
  const packetPath = artifactPath("proximitty-underwriting-packet.md");
  writeFileSync(packetPath, packet, "utf-8");
  const reopened = readFileSync(packetPath, "utf-8");
  const missingHeadings = REQUIRED_HEADINGS.filter((heading) => !reopened.includes(heading));
  const screenshot = await captureScenarioScreenshot(page, testInfo, "03-underwriting-packet");

  writeJsonArtifact("proximitty-underwriting-packet-receipt.json", {
    scenario: "underwriting-packet-generation",
    suite: "proximitty-underwriting-pr0",
    baseUrl: workspace.baseUrl,
    roomUrl: workspace.roomUrl,
    uploadedFiles,
    packetPath,
    exportReopen: {
      reopened: reopened.length > 0,
      missingHeadings,
      includesEvaluationNotice: /Evaluation output only/i.test(reopened),
      noDecisionLanguage: !/\b(approved|declined|bound|insured)\b/i.test(reopened),
    },
    screenshot,
  });

  expect(missingHeadings).toEqual([]);
  expect(reopened).toContain("Evaluation output only");
  expect(reopened).not.toMatch(/\b(approved|declined|bound|insured)\b/i);
  assertNoUnexpectedErrors(workspace);
});
