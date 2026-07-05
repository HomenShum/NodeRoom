import { describe, expect, it } from "vitest";
import {
  assertProofloopModelTracked,
  proofloopModelRouteForRun,
  type ProofloopModelRoute,
} from "../src/eval/proofloopModelTracking";

describe("Proof Loop model tracking", () => {
  it("serializes strict model identity, routing, cost, token, latency, and selection fields", () => {
    const route = proofloopModelRouteForRun({
      suite: "finch",
      cmd: "npm run benchmark:proofloop:external-adapter-live-room -- --id finch",
      env: {
        PROOFLOOP_MODEL_ID: "deepseek/deepseek-v4-pro",
        PROOFLOOP_MODEL_COST_USD: "0.0123",
        PROOFLOOP_TOKENS_IN: "1200",
        PROOFLOOP_TOKENS_OUT: "320",
        PROOFLOOP_MODEL_LATENCY_MS: "9876",
        PROOFLOOP_MODEL_SELECTION_REASON: "cheap structured proxy route for Finch triage",
      },
    });

    expect(route).toMatchObject({
      id: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      role: "planner",
      routePolicy: "specific",
      costUsd: 0.0123,
      tokensIn: 1200,
      tokensOut: 320,
      costAccounting: {
        status: "actual",
        source: "env",
      },
      latencyMs: 9876,
      selectionReason: "cheap structured proxy route for Finch triage",
      source: "env",
    });
    expect(assertProofloopModelTracked(route)).toEqual([]);
  });

  it("marks model-comparison routes incomplete when required fields are missing", () => {
    const route: ProofloopModelRoute = {
      id: "",
      provider: "",
      role: "planner",
      routePolicy: "specific",
      costUsd: Number.NaN,
      tokensIn: 0,
      tokensOut: 0,
      costAccounting: {
        status: "unknown",
        source: "unknown",
        note: "missing",
      },
      latencyMs: Number.NaN,
      selectionReason: "",
      source: "env",
    };

    expect(assertProofloopModelTracked(route)).toEqual(expect.arrayContaining([
      "missing_model_id",
      "missing_model_provider",
      "missing_model_cost_usd",
      "missing_model_latency_ms",
      "unknown_paid_provider_cost_accounting",
      "missing_model_selection_reason",
    ]));
  });

  it("records explicit orchestration roles and deterministic local routes", () => {
    const route = proofloopModelRouteForRun({
      suite: "proofloop-orchestrator-evaluator",
      cmd: "judge long-running state receipts",
      role: "judge",
      env: {
        PROOFLOOP_MODEL_ID: "local/deterministic",
        PROOFLOOP_MODEL_SELECTION_REASON: "detached evaluator reads receipts instead of executor transcript",
      },
    });

    expect(route).toMatchObject({
      id: "local/deterministic",
      provider: "local",
      role: "judge",
      routePolicy: "deterministic",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      costAccounting: {
        status: "free",
        source: "free_local",
      },
      selectionReason: "detached evaluator reads receipts instead of executor transcript",
    });
    expect(assertProofloopModelTracked(route)).toEqual([]);
  });

  it("does not silently zero paid/provider routes when usage telemetry is absent", () => {
    const route = proofloopModelRouteForRun({
      suite: "bankertoolbench-live-room",
      cmd: "npx playwright test proofloop/live-browser-proof.spec.ts",
      env: {},
    });

    expect(route).toMatchObject({
      id: "z-ai/glm-5.2",
      provider: "openrouter",
      costAccounting: {
        status: "unknown",
        source: "unknown",
      },
    });
    expect(Number.isNaN(route.costUsd)).toBe(true);
    expect(Number.isNaN(route.tokensIn)).toBe(true);
    expect(Number.isNaN(route.tokensOut)).toBe(true);
    expect(assertProofloopModelTracked(route)).toEqual(expect.arrayContaining([
      "missing_model_cost_usd",
      "missing_model_tokens_in",
      "missing_model_tokens_out",
      "unknown_paid_provider_cost_accounting",
    ]));
  });

  it("estimates paid/provider cost from token telemetry when provider cost is missing", () => {
    const route = proofloopModelRouteForRun({
      suite: "finch",
      cmd: "npm run benchmark:proofloop:external-adapter-live-room -- --id finch",
      env: {
        PROOFLOOP_MODEL_ID: "deepseek/deepseek-v4-pro",
        PROOFLOOP_TOKENS_IN: "1200",
        PROOFLOOP_TOKENS_OUT: "320",
      },
    });

    expect(route.costAccounting).toMatchObject({
      status: "estimated",
      source: "catalog_estimate",
    });
    expect(route.costUsd).toBeGreaterThan(0);
    expect(route.tokensIn).toBe(1200);
    expect(route.tokensOut).toBe(320);
    expect(assertProofloopModelTracked(route)).toEqual([]);
  });
});
