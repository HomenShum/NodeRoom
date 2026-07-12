import type { AgentModel } from "../src/nodeagent/core/types";
import { convexPriceRun } from "../src/nodeagent/models/convexModel";

export type ModelSpendSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  modelCalls: number;
  unpricedModelCalls: number;
  costUsd: number;
  models: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    modelCalls: number;
    unpricedModelCalls: number;
    costUsd: number;
  }>;
};

export class ModelSpendMeter {
  private readonly byModel = new Map<string, ModelSpendSnapshot["models"][number]>();

  wrap(model: AgentModel): AgentModel {
    const meter = this;
    return {
      get name() {
        return model.name;
      },
      async next(input) {
        try {
          const step = await model.next(input);
          meter.record(step.providerRoute?.resolvedModel || model.name, step.usage);
          return step;
        } catch (error) {
          meter.record(model.name);
          throw error;
        }
      },
    };
  }

  private record(modelName: string, usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }): void {
    const current = this.byModel.get(modelName) ?? {
      model: modelName,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      modelCalls: 0,
      unpricedModelCalls: 0,
      costUsd: 0,
    };
    current.modelCalls += 1;
    if (!usage) {
      current.unpricedModelCalls += 1;
    } else {
      current.inputTokens += Math.max(0, usage.inputTokens);
      current.outputTokens += Math.max(0, usage.outputTokens);
      current.cachedInputTokens += Math.max(0, usage.cachedInputTokens ?? 0);
      current.costUsd += convexPriceRun(modelName, usage.inputTokens, usage.outputTokens);
    }
    this.byModel.set(modelName, current);
  }

  snapshot(): ModelSpendSnapshot {
    const models = [...this.byModel.values()].map((entry) => ({ ...entry }));
    return models.reduce<ModelSpendSnapshot>((total, entry) => ({
      inputTokens: total.inputTokens + entry.inputTokens,
      outputTokens: total.outputTokens + entry.outputTokens,
      cachedInputTokens: total.cachedInputTokens + entry.cachedInputTokens,
      modelCalls: total.modelCalls + entry.modelCalls,
      unpricedModelCalls: total.unpricedModelCalls + entry.unpricedModelCalls,
      costUsd: total.costUsd + entry.costUsd,
      models: [...total.models, entry],
    }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, modelCalls: 0, unpricedModelCalls: 0, costUsd: 0, models: [] });
  }
}
