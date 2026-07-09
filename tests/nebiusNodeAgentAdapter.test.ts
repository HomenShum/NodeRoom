import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProviderForModel, resolveModelAlias } from "../src/nodeagent/models/modelCatalog";

describe("NodeAgent Nebius adapter", () => {
  it("keeps Nebius in the model catalog and runtime adapter", () => {
    expect(resolveModelAlias("nebius/minimax-m2.5")).toBe("nebius/MiniMaxAI/MiniMax-M2.5");
    expect(getProviderForModel("nebius/MiniMaxAI/MiniMax-M2.5")).toBe("nebius");

    const adapter = readFileSync(join(process.cwd(), "src", "nodeagent", "models", "adapter.ts"), "utf8");
    expect(adapter).toContain('apiKey: envValue("NEBIUS_API_KEY")');
    expect(adapter).toContain('baseURL: envValue("NEBIUS_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1"');
    expect(adapter).toContain('case "nebius": return nebius().chat(modelId.replace(/^nebius\\//i, ""));');
  });
});
