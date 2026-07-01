import { test, expect } from "@playwright/test";
import {
  assertNoUnexpectedErrors,
  captureScenarioScreenshot,
  invokeVisibleAgent,
  openFreshWorkspace,
  uploadDemoInputs,
  writeJsonArtifact,
} from "./proximittyHarness";

test("Scenario 1 - underwriting intake uploads synthetic inputs through the real UI", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = await openFreshWorkspace(page);
  const uploadedFiles = await uploadDemoInputs(page);
  const agentInvocation = await invokeVisibleAgent(
    page,
    "/free organize these synthetic Proximitty underwriting inputs into an evidence checklist and mark unsupported items needs_review",
  );
  const screenshot = await captureScenarioScreenshot(page, testInfo, "01-intake");

  writeJsonArtifact("proximitty-intake-receipt.json", {
    scenario: "underwriting-intake",
    suite: "proximitty-underwriting-pr0",
    baseUrl: workspace.baseUrl,
    roomUrl: workspace.roomUrl,
    mode: workspace.mode,
    uploadedFiles,
    gates: {
      liveOrStagingUrl: /^https?:\/\//.test(workspace.baseUrl),
      freshWorkspace: true,
      browserUpload: uploadedFiles.length >= 5,
      publicUiLanded: true,
      visibleAgentInvocation: agentInvocation.thinkingVisible || agentInvocation.jobStatusVisible || agentInvocation.streamVisible,
      visibleAgentProgress: agentInvocation.thinkingVisible || agentInvocation.jobStatusVisible || agentInvocation.streamVisible || agentInvocation.streamPartVisible,
      visualProof: screenshot,
    },
    agentInvocation,
    demoSafety: "Synthetic inputs only. No real underwriting decision is made.",
  });

  expect(uploadedFiles).toEqual([
    "company-profile.json",
    "underwriting-policy.md",
    "synthetic-financials.csv",
    "risk-notes.md",
    "source-pack.md",
  ]);
  expect(agentInvocation.thinkingVisible || agentInvocation.jobStatusVisible || agentInvocation.streamVisible).toBe(true);
  expect(agentInvocation.agentErrorCount).toBe(0);
  assertNoUnexpectedErrors(workspace);
});
