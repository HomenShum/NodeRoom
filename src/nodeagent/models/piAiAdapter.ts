import { model } from "./adapter";
import type { AgentModel } from "../core/types";
import { DEFAULT_AGENT_MODEL } from "../../../convex/modelDefaults";

export interface PiAdapterOptions {
  modelName?: string;
}

export function createPiAiAdapter(options: PiAdapterOptions = {}): AgentModel {
  return model(options.modelName ?? DEFAULT_AGENT_MODEL);
}