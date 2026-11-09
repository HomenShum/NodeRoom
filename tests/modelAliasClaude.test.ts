/**
 * Claude model-id normalization (the live blank-sheet populate 404'd because the registry's dotted
 * display ids reached the Anthropic direct API, which needs hyphenated ids). resolveModelAlias must
 * turn every Claude shortcut / dotted display id into the valid hyphenated API id.
 */
import { describe, it, expect } from "vitest";
import { lookupModelAlias, resolveModelAlias, UnknownModelError } from "../src/nodeagent/models/modelCatalog";

describe("resolveModelAlias — Claude dotted -> hyphenated API ids", () => {
  it("maps dotted display ids to the hyphenated API ids the Anthropic API accepts", () => {
    expect(resolveModelAlias("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("claude-haiku-4.5")).toBe("claude-haiku-4-5");
    // Was "claude-opus-4-8" (the display id lagged the API id, so a 4.7 request silently ran 4.8). SPEC A.2.9 makes the
    // mapping exact: modelCatalog.ts:612-620's regex is replaced by an explicit table with claude-opus-4.7 -> claude-opus-4-7.
    expect(resolveModelAlias("claude-opus-4.7")).toBe("claude-opus-4-7");
  });

  it("maps the 5.5 display ids and rewrites no id that is not in the table", () => {
    expect(resolveModelAlias("claude-haiku-5.5")).toBe("claude-haiku-5-5");
    expect(resolveModelAlias("claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(resolveModelAlias("claude-opus-5.5")).toBe("claude-opus-5-5");
    // no regex: an unlisted dotted id passes through unchanged instead of being rewritten into a guess. Round 3 (SPEC A.0.10):
    // resolveModelAlias also REFUSES it (it was `.toBe("claude-future-9.9")` and was then dispatched); the no-rewrite
    // property is asserted on lookupModelAlias, the alias table read that does not route.
    expect(lookupModelAlias("claude-future-9.9")).toBe("claude-future-9.9");
    expect(() => resolveModelAlias("claude-future-9.9")).toThrow(UnknownModelError);
    // OpenRouter slugs keep their dots (A.0.5: wire ids per transport)
    expect(resolveModelAlias("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
  });

  it("resolves shortcuts through to the hyphenated API id (2-hop)", () => {
    expect(resolveModelAlias("claude-sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("claude-opus")).toBe("claude-opus-4-8"); // shortcut unchanged: still the newest 4.x
    expect(resolveModelAlias("claude-haiku")).toBe("claude-haiku-4-5");
  });

  it("leaves already-hyphenated ids and non-Claude ids unchanged", () => {
    expect(resolveModelAlias("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("z-ai/glm-5.2")).toBe("z-ai/glm-5.2");
  });
});
