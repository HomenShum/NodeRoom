/**
 * Claude model-id normalization (the live blank-sheet populate 404'd because the registry's dotted
 * display ids reached the Anthropic direct API, which needs hyphenated ids). resolveModelAlias must
 * turn every Claude shortcut / dotted display id into the valid hyphenated API id.
 */
import { describe, it, expect } from "vitest";
import { resolveModelAlias } from "../src/nodeagent/models/modelCatalog";

describe("resolveModelAlias — Claude dotted -> hyphenated API ids", () => {
  it("maps dotted display ids to the hyphenated API ids the Anthropic API accepts", () => {
    expect(resolveModelAlias("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("claude-haiku-4.5")).toBe("claude-haiku-4-5");
    // opus display lags (4.7) the latest available API id (4-8)
    expect(resolveModelAlias("claude-opus-4.7")).toBe("claude-opus-4-8");
  });

  it("resolves shortcuts through to the hyphenated API id (2-hop)", () => {
    expect(resolveModelAlias("claude-sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("claude-opus")).toBe("claude-opus-4-8");
    expect(resolveModelAlias("claude-haiku")).toBe("claude-haiku-4-5");
  });

  it("leaves already-hyphenated ids and non-Claude ids unchanged", () => {
    expect(resolveModelAlias("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("z-ai/glm-5.2")).toBe("z-ai/glm-5.2");
  });
});
