import { describe, expect, it } from "vitest";
import { getProviderForModel, getModelPricing, llmModelCatalog } from "../src/nodeagent/models/modelCatalog";

/**
 * Kimi K3 is the default agentic route (replacing the GLM-Nebius default).
 * These pins guard three things a route needs to be honest AND load-bearing:
 * it must be priced (so cost/receipts are non-zero, not $0 phantom runs), it
 * must resolve to a real provider (OpenRouter, whose key ships in prod), and it
 * must LEAD the openrouter agent/chat/coding preference lists so the adaptive
 * router reaches for it first — with GLM demoted to a fallback, never dropped.
 */
describe("Kimi K3 default route", () => {
  const KIMI = "moonshotai/kimi-k3";
  const GLM = "z-ai/glm-5.2";

  it("is priced (non-zero in and out) so cost accounting stays honest", () => {
    const pricing = getModelPricing(KIMI);
    expect(pricing).not.toBeNull();
    expect(pricing!.inputPer1M).toBeGreaterThan(0);
    expect(pricing!.outputPer1M).toBeGreaterThan(0);
    expect(pricing!.contextWindow).toBe(1_048_576);
  });

  it("routes to OpenRouter (the provider whose key ships in prod)", () => {
    expect(getProviderForModel(KIMI)).toBe("openrouter");
  });

  it("leads the agentic openrouter lanes; GLM survives only as fallback", () => {
    for (const lane of ["agent", "chat", "coding"] as const) {
      const pref = llmModelCatalog.openrouter[lane];
      expect(pref[0]).toBe(KIMI);
      // GLM demoted, not deleted — still a valid fallback further down the ladder.
      const glmIndex = pref.indexOf(GLM);
      expect(glmIndex).toBeGreaterThan(0);
    }
  });
});
