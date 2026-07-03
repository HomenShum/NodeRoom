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
      cmd: "npm run benchmark:proofloop:external-adapter -- --id finch",
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
      latencyMs: Number.NaN,
      selectionReason: "",
      source: "env",
    };

    expect(assertProofloopModelTracked(route)).toEqual(expect.arrayContaining([
      "missing_model_id",
      "missing_model_provider",
      "missing_model_cost_usd",
      "missing_model_latency_ms",
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
      selectionReason: "detached evaluator reads receipts instead of executor transcript",
    });
    expect(assertProofloopModelTracked(route)).toEqual([]);
  });
});
