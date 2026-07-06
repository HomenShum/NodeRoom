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

  // Regression: the live finauditing baseline (noderoom.live room NRN427VH0IZ)
  // had free-auto resolve to z-ai/glm-4.7-flash — a genuinely free model with
  // NO ":free" suffix — at $0. The checker used to false-flag it as a paid-model
  // mismatch. Ground truth is measured cost: a proven-$0 run satisfies free-auto.
  it("accepts free-auto resolving to a suffixless free model when cost is proven zero", () => {
    const result = evaluateProofloopRouteIntegrity({
      requestedModel: "openrouter/free-auto",
      telemetry: [{ model: "z-ai/glm-4.7-flash", costUsd: 0 }],
    });
    expect(result.status).toBe("matched");
    expect(result.failures).toEqual([]);
    expect(result.failures).not.toContain("free_route_used_paid_model");
  });

  // Guard: the fix must NOT weaken the check — a free-auto route that actually
  // bills money is still a violation, name allowlist or not.
  it("still flags free-auto that bills nonzero cost as a paid-model violation", () => {
    const result = evaluateProofloopRouteIntegrity({
      requestedModel: "openrouter/free-auto",
      telemetry: [{ model: "anthropic/claude-opus-4-8", costUsd: 0.05 }],
    });
    expect(result.status).toBe("model_route_mismatch");
    expect(result.failures).toContain("free_route_used_paid_model");
    expect(result.failures).toContain("free_route_billed_nonzero_cost");
  });
});
