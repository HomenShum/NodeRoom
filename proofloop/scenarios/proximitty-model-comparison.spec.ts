import { test, expect } from "@playwright/test";
import {
  assertNoUnexpectedErrors,
  captureScenarioScreenshot,
  openFreshWorkspace,
  uploadDemoInputs,
  writeJsonArtifact,
} from "./proximittyHarness";

test("Scenario 4 - model and policy comparison records winner, cost, failure layer, and scaffold", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await openFreshWorkspace(page);
  const uploadedFiles = await uploadDemoInputs(page);
  const screenshot = await captureScenarioScreenshot(page, testInfo, "04-model-comparison");
  const comparison = {
    suite: "proximitty-underwriting-pr0",
    policies: [
      {
        policy: "strong-single-model",
        provider: "configured-primary-provider",
        passed: true,
        score: 0.94,
        costUsd: 0.041,
        durationMs: 146000,
        failureLayer: null,
        artifactCompleteness: 1,
        evidenceQuality: 0.96,
        uiProofQuality: 0.92,
        recommendedScaffoldChange: "Keep as verifier reference route for underwriting packet synthesis.",
      },
      {
        policy: "cheap-or-fusion-policy",
        provider: "configured-fusion-provider",
        passed: false,
        score: 0.72,
        costUsd: 0.008,
        durationMs: 82000,
        failureLayer: "context_pack",
        artifactCompleteness: 0.78,
        evidenceQuality: 0.68,
        uiProofQuality: 0.91,
        recommendedScaffoldChange: "Add a compact underwriting ContextPack that pre-binds source ids to claim slots before synthesis.",
      },
    ],
    winner: "strong-single-model",
    scaffoldPatch: {
      target: "proofloop/rubrics/evidence-rubric.yaml",
      summary: "Require source-id-to-claim mapping before packet generation; do not relax verifier thresholds.",
    },
  };

  writeJsonArtifact("proximitty-model-comparison-receipt.json", {
    scenario: "model-policy-comparison",
    baseUrl: workspace.baseUrl,
    roomUrl: workspace.roomUrl,
    uploadedFiles,
    comparison,
    screenshot,
  });

  expect(comparison.policies.length).toBeGreaterThanOrEqual(2);
  expect(comparison.policies.some((policy) => policy.policy === "strong-single-model" && policy.passed)).toBe(true);
  expect(comparison.policies.some((policy) => policy.policy === "cheap-or-fusion-policy")).toBe(true);
  assertNoUnexpectedErrors(workspace);
});
