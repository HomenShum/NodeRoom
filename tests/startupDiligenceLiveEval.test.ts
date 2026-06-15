// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { runStartupDiligenceConvexContractEval } from "../scripts/startup-diligence-live-eval";

const requiredChecks = [
  "account_upsert",
  "cited_cellpayloads",
  "human_edit_preserved",
  "concurrent_lanes",
  "private_boundary",
  "runway_milestone_chart",
  "downstream_draft_only",
  "banker_coach_harness_tools",
  "route_trace_cost_runtime",
];

const modules = import.meta.glob("../convex/**/*.ts");

describe("startup diligence live eval contract", () => {
  it("proves every manifest check against the Convex contract without claiming provider-produced content", async () => {
    const report = await runStartupDiligenceConvexContractEval(modules);

    expect(report.pass).toBe(true);
    expect(report.mode).toBe("convex-test-contract");
    expect(report.summary.providerProducedContent).toBe(false);
    expect(report.summary.convexContractProven).toBe(true);
    expect(report.checks.map((check) => check.id).sort()).toEqual([...requiredChecks].sort());
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);

    const payload = report.checks.find((check) => check.id === "cited_cellpayloads");
    expect(JSON.stringify(payload?.evidence ?? {})).toContain("CellPayload");

    const route = report.checks.find((check) => check.id === "route_trace_cost_runtime");
    expect(JSON.stringify(route?.evidence ?? {})).toContain("startup-contract-eval");

    const coach = report.checks.find((check) => check.id === "banker_coach_harness_tools");
    expect(JSON.stringify(coach?.evidence ?? {})).toContain("generate_banker_coach_cues");
  });

  it("can prove provider-produced CellPayload and route receipts through the same contract", async () => {
    const report = await runStartupDiligenceConvexContractEval({
      convexModules: modules,
      providerGenerated: {
        requestedModel: "gemini-3.5-flash",
        resolvedModel: "gemini-3.5-flash",
        providerRoute: {
          policy: "provider_route_v1",
          requestedModel: "gemini-3.5-flash",
          resolvedModel: "gemini-3.5-flash",
          provider: "gemini",
          entrypoint: "public_ask",
          allowedProviders: ["gemini"],
          noTrainingRequired: false,
          basis: ["test"],
        },
        responseText: JSON.stringify({
          cellPayload: {
            kind: "CellPayload",
            value: "Provider-generated CardioNova diligence summary with cited hospital-triage evidence.",
            confidence: 0.83,
            status: "needs_review",
            evidence: [{ source: "CardioNova intake packet", sourceRef: "cardionova-intake.pdf#page=1", quote: "AI triage workflow for hospital intake" }],
          },
          finalText: "Provider-generated final room update: CardioNova summary is ready for host review with source evidence.",
        }),
        cellPayload: {
          kind: "CellPayload",
          value: "Provider-generated CardioNova diligence summary with cited hospital-triage evidence.",
          confidence: 0.83,
          status: "needs_review",
          evidence: [{ source: "CardioNova intake packet", sourceRef: "cardionova-intake.pdf#page=1", quote: "AI triage workflow for hospital intake" }],
        },
        finalText: "Provider-generated final room update: CardioNova summary is ready for host review with source evidence.",
        usage: { inputTokens: 123, outputTokens: 45 },
        costUsd: 0.00042,
        ms: 321,
      },
    });

    expect(report.pass).toBe(true);
    expect(report.mode).toBe("provider-produced-convex-contract");
    expect(report.summary.providerProducedContent).toBe(true);

    const payload = report.checks.find((check) => check.id === "cited_cellpayloads");
    expect(payload?.manifestStatus).toBe("provider-produced-convex-contract-proven");
    expect(JSON.stringify(payload?.evidence ?? {})).toContain("Provider-generated CardioNova");

    const route = report.checks.find((check) => check.id === "route_trace_cost_runtime");
    expect(route?.manifestStatus).toBe("provider-produced-route-trace-proven");
    expect(JSON.stringify(route?.evidence ?? {})).toContain("provider_route_v1");
  });
});
