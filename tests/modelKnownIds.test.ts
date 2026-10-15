/**
 * SPEC A.0.4 + A.0.10 - the fail-closed resolver refuses only ids the repo truly does not know.
 *
 * Persona: a banker opens the mobile app and picks "Claude Fable 5" (one of the six shipped picker choices); an
 * evaluator runs `ladder:free --free-auto-top` and the benchmark with a frozen route. Failures to prevent:
 *   1. the resolver treats "no price row" as "unknown", so a shipped or frozen id throws before it reaches the provider;
 *   2. a concrete `:free` id the repo names is silently rewritten to `openrouter/free-auto`, so the run measures the
 *      auto router under the concrete label.
 * Every list below is read from its owning source, so a new id added there without a catalog entry fails here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "../src/landing/modelRegistry";
import { SUPPORTED_MODEL_ROUTES } from "../scripts/benchmark/modelEvalConfig";
import { model } from "../src/nodeagent/models/adapter";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { llmModelCatalog, lookupModelAlias, resolveModelAlias, UnknownModelError } from "../src/nodeagent/models/modelCatalog";
import { OPENROUTER_FREE_AUTO_MODEL, OPENROUTER_KNOWN_FREE_IDS } from "../src/nodeagent/models/openRouterFreeModels";

/** Frozen benchmark identity: the default of bankertoolbench-nodeagent-clean-sequential.mjs (SPEC A.2.9 freeze row). */
const btbDefault = /const modelId = args\.modelId \?\? "([^"]+)"/.exec(readFileSync("scripts/bankertoolbench-nodeagent-clean-sequential.mjs", "utf8"))?.[1] ?? "";

/** Every other FREEZE / DEFER id in SPEC A.2.9 that a resolver can reach. */
const FROZEN_SITE_IDS = ["z-ai/glm-5.2", "moonshotai/kimi-k3", "gpt-5.4", "minimax/minimax-m3", "deepseek/deepseek-v4-flash", "gpt-5-mini", "google/gemini-3-flash-preview", "gemini-3.1-flash-lite", "z-ai/glm-4.7-flash", "cohere/north-mini-code:free"];

const llmCatalogIds = Object.values(llmModelCatalog).flatMap((byTask) => Object.values(byTask).flat());

function expectUnchanged(id: string) {
  const resolved = resolveModelAlias(id);
  expect(resolved, `resolveModelAlias(${id}) must not reroute`).toBe(lookupModelAlias(id));
  if (lookupModelAlias(id) !== OPENROUTER_FREE_AUTO_MODEL) expect(resolved).not.toBe(OPENROUTER_FREE_AUTO_MODEL);
  expect(model(id).name).toBe(resolved);
  expect(convexModel(id).name).toBe(resolved);
}

describe("every id the repo ships, freezes or lists resolves as itself", () => {
  it("the BTB default was read from the frozen script", () => expect(btbDefault).toBe("gpt-4.1-mini"));

  it.each(MODEL_REGISTRY.map((m) => m.id))("mobile picker choice %s", expectUnchanged);
  it.each(SUPPORTED_MODEL_ROUTES.map((r) => r.route))("benchmark route %s", expectUnchanged);
  it.each([...new Set(llmCatalogIds)])("tier-map id %s (Chat.tsx resolves all of these at render)", expectUnchanged);
  it.each([...OPENROUTER_KNOWN_FREE_IDS])("known free id %s is never rerouted to the auto router", expectUnchanged);
  it.each([btbDefault, `openai/${btbDefault}`, ...FROZEN_SITE_IDS])("frozen site id %s", expectUnchanged);

  it("the spec's live :free list is known (13 of the 15 used to be rewritten)", () => {
    for (const id of ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-26b-a4b-it:free", "poolside/laguna-xs-2.1:free", "poolside/laguna-s-2.1:free", "liquid/lfm-2.5-2.6b:free"]) {
      expect(resolveModelAlias(id)).toBe(id);
    }
    expect(OPENROUTER_KNOWN_FREE_IDS.size).toBeGreaterThanOrEqual(15);
  });
});

describe("what is still refused or rerouted (A.0.10 is intact)", () => {
  it.each(["gemini-9-flash-unknown", "acme/paid-unknown-model", "claude-opus-4.9", "gpt-9-unknown"])("%s throws", (id) => {
    expect(() => resolveModelAlias(id)).toThrow(UnknownModelError);
  });

  it("an unknown free-looking id still resolves to the verified free route, a known one to itself", () => {
    expect(resolveModelAlias("vendor/not-in-catalog:free")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("nvidia/nemotron-3-super-120b-a12b:free")).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });
});
