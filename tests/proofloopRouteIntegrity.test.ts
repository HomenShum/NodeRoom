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

  // Regression (corrects an earlier mistake): free-auto resolving to
  // z-ai/glm-4.7-flash — a PAID model with no ":free" suffix — is the
  // file-egress promotion bug (a /free request silently routed to a paid model,
  // which reads $0 until the account has credits, then 402s). It MUST be flagged
  // regardless of this-run cost; a $0 reading is an errored-run artifact, not
  // proof of free compliance. A prior version gave $0 a pass and silenced this
  // exact alarm — this pins that it stays flagged.
  it("flags free-auto that resolved to a non-free model even at $0 (the promotion signal)", () => {
    const result = evaluateProofloopRouteIntegrity({
      requestedModel: "openrouter/free-auto",
      telemetry: [{ model: "z-ai/glm-4.7-flash", costUsd: 0 }],
    });
    expect(result.status).toBe("model_route_mismatch");
    expect(result.failures).toContain("model_route_mismatch");
    expect(result.failures).toContain("free_route_used_paid_model");
  });

  // A genuinely free (":free") model at $0 is the ONLY thing that satisfies free-auto.
  it("accepts free-auto resolving to an actual :free model at zero cost", () => {
    const result = evaluateProofloopRouteIntegrity({
      requestedModel: "openrouter/free-auto",
      telemetry: [{ model: "nvidia/nemotron-3-super-120b-a12b:free", costUsd: 0 }],
    });
    expect(result.status).toBe("matched");
    expect(result.failures).toEqual([]);
  });

  // A free-auto route that actually bills money is flagged on BOTH signals.
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
