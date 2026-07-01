import { test, expect } from "@playwright/test";
import {
  assertNoUnexpectedErrors,
  buildEvidenceClaims,
  captureScenarioScreenshot,
  openFreshWorkspace,
  uploadDemoInputs,
  writeJsonArtifact,
} from "./proximittyHarness";

test("Scenario 2 - risk research creates source-backed claims or needs_review flags", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await openFreshWorkspace(page);
  const uploadedFiles = await uploadDemoInputs(page);
  const claims = buildEvidenceClaims();
  const unsupported = claims.filter((claim) => !claim.evidenceRef && claim.status !== "needs_review");
  const screenshot = await captureScenarioScreenshot(page, testInfo, "02-risk-research");

  writeJsonArtifact("proximitty-risk-research.json", {
    scenario: "risk-research-and-evidence",
    suite: "proximitty-underwriting-pr0",
    baseUrl: workspace.baseUrl,
    roomUrl: workspace.roomUrl,
    uploadedFiles,
    claims,
    verifier: {
      name: "claim_source_or_needs_review",
      passed: unsupported.length === 0,
      unsupportedClaims: unsupported,
    },
    screenshot,
  });

  expect(unsupported).toEqual([]);
  expect(claims.some((claim) => claim.status === "needs_review")).toBe(true);
  assertNoUnexpectedErrors(workspace);
});
