import { describe, expect, it } from "vitest";
import { ModelSpendMeter } from "../convex/modelSpendMeter";
import type { AgentModel } from "../src/nodeagent/core/types";
import { convexPriceRun } from "../src/nodeagent/models/convexModel";

function model(name: string, inputTokens: number, outputTokens: number): AgentModel {
  return {
    name,
    async next() {
      return {
        text: "ok",
        toolCalls: [],
        done: true,
        usage: { inputTokens, outputTokens, cachedInputTokens: Math.floor(inputTokens / 4) },
      };
    },
  };
}

describe("model spend meter", () => {
  it("aggregates concurrent parent/child and phase-model calls with per-model pricing", async () => {
    const meter = new ModelSpendMeter();
    const orchestrator = meter.wrap(model("gemini-3.5-flash", 1_000, 100));
    const worker = meter.wrap(model("z-ai/glm-5.2", 2_000, 200));

    await Promise.all([
      orchestrator.next({ system: "", messages: [], tools: [] }),
      worker.next({ system: "", messages: [], tools: [] }),
      worker.next({ system: "", messages: [], tools: [] }),
    ]);
    const snapshot = meter.snapshot();

    expect(snapshot).toMatchObject({
      inputTokens: 5_000,
      outputTokens: 500,
      cachedInputTokens: 1_250,
      modelCalls: 3,
      unpricedModelCalls: 0,
    });
    expect(snapshot.models).toHaveLength(2);
    expect(snapshot.costUsd).toBeCloseTo(
      convexPriceRun("gemini-3.5-flash", 1_000, 100) + convexPriceRun("z-ai/glm-5.2", 4_000, 400),
      10,
    );
  });

  it("records missing usage and thrown provider attempts without inventing token counts", async () => {
    const meter = new ModelSpendMeter();
    const noUsage = meter.wrap({
      name: "no-usage",
      async next() {
        return { text: "ok", toolCalls: [], done: true };
      },
    });
    const failed = meter.wrap({
      name: "failed-provider",
      async next() {
        throw new Error("provider disconnected before usage");
      },
    });

    await noUsage.next({ system: "", messages: [], tools: [] });
    await expect(failed.next({ system: "", messages: [], tools: [] })).rejects.toThrow("provider disconnected");
    expect(meter.snapshot()).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 2,
      unpricedModelCalls: 2,
      costUsd: 0,
    });
  });
});
