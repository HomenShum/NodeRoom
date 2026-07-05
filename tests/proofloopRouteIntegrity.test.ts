import { describe, expect, it } from "vitest";
import { evaluateProofloopRouteIntegrity } from "../src/eval/proofloopRouteIntegrity";

describe("ProofLoop route integrity", () => {
  it("accepts a concrete free model only when telemetry matches and cost is zero", () => {
    expect(evaluateProofloopRouteIntegrity({
      requestedModel: "cohere/north-mini-code:free",
      telemetry: [{ model: "cohere/north-mini-code:free", costUsd: 0 }],
    })).toMatchObject({
      status: "matched",
      failures: [],
    });
  });

  it("rejects a free request routed to a paid different model", () => {
    const result = evaluateProofloopRouteIntegrity({
      requestedModel: "qwen/qwen3-coder:free",
      telemetry: [{ model: "z-ai/glm-4.7-flash", costUsd: 0.012 }],
    });

    expect(result.status).toBe("model_route_mismatch");
    expect(result.failures).toContain("model_route_mismatch");
    expect(result.failures).toContain("free_route_used_paid_model");
    expect(result.failures).toContain("free_route_billed_nonzero_cost");
  });

  it("lets free-auto resolve to any free concrete model with zero cost", () => {
    expect(evaluateProofloopRouteIntegrity({
      requestedModel: "openrouter/free-auto",
      telemetry: [{ model: "nvidia/nemotron-3-super-120b-a12b:free", costUsd: 0 }],
    })).toMatchObject({
      status: "matched",
      telemetryModels: ["nvidia/nemotron-3-super-120b-a12b:free"],
    });
  });
});
