/**
 * 2026-10 model refresh (SPEC Part A §A.2.9): catalog invariants. Persisted rooms keep working (old strings stay
 * valid), while no live lane, tier list or fallback chain points at a retired, shut-down or prior-users-only id.
 */
import { describe, expect, it } from "vitest";
import {
  claudeDefaultEffort,
  forbidsForcedToolChoice,
  getModelPricing,
  getProviderForModel,
  isClaude55Id,
  isModelAllowedForTier,
  llmModelCatalog,
  modelFallbackChains,
  resolveModelAlias,
} from "../src/nodeagent/models/modelCatalog";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";

/** Ids that fail (retired / shut down) or are closed to new users (gemini-2.5-*, OpenRouter expiry 2026-10-20). */
const DEAD_IN_LIVE_LANES = [
  "claude-opus-4", "claude-opus-4.1", "claude-sonnet-4", "claude-haiku-3.5",
  "gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview",
];

describe("llmModelCatalog task lanes", () => {
  it("lists the 5.5 Claude ids first in every Anthropic lane, with the 4.x ids kept behind them", () => {
    for (const [task, ids] of Object.entries(llmModelCatalog.anthropic)) {
      expect(ids[0], task).toMatch(/^claude-(haiku|sonnet)-5-5$/);
    }
    expect(llmModelCatalog.anthropic.agent).toEqual(expect.arrayContaining(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4.5", "claude-opus-4.7"]));
  });

  it("no Gemini lane offers a dead id; chat is [gemini-3.8-flash, gemini-3.5-flash-lite]", () => {
    expect(llmModelCatalog.gemini.chat).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    for (const [task, ids] of Object.entries(llmModelCatalog.gemini)) {
      for (const dead of DEAD_IN_LIVE_LANES) expect(ids, `${task}: ${dead}`).not.toContain(dead);
    }
  });

  it("every id in every lane is routable and priced", () => {
    for (const [provider, lanes] of Object.entries(llmModelCatalog)) {
      for (const [task, ids] of Object.entries(lanes)) {
        for (const id of ids) {
          expect(getProviderForModel(id), `${provider}/${task}/${id} provider`).not.toBeNull();
          expect(getModelPricing(resolveModelAlias(id)), `${provider}/${task}/${id} price`).not.toBeNull();
        }
      }
    }
  });
});

describe("entitlement tiers (exact-string match)", () => {
  it("admit the new ids and still admit the old strings persisted rows carry", () => {
    for (const tier of ["anonymous", "free"] as const) {
      for (const id of ["claude-haiku-5-5", "gemini-3.5-flash-lite", "claude-haiku-4.5"]) expect(isModelAllowedForTier(id, tier), `${tier}/${id}`).toBe(true);
    }
    expect(isModelAllowedForTier("gemini-3.1-flash-lite-preview", "anonymous")).toBe(true); // old string, kept
    expect(isModelAllowedForTier("claude-opus-5-5", "anonymous")).toBe(false); // not on the cheap tier
    expect(isModelAllowedForTier("claude-opus-5-5", "pro")).toBe(true);
  });
});

describe("fallback chains", () => {
  const chains = Object.entries(modelFallbackChains);

  it("have no retired, shut-down or prior-users-only member", () => {
    for (const [key, chain] of chains) for (const dead of DEAD_IN_LIVE_LANES) expect(chain, `${key} -> ${dead}`).not.toContain(dead);
  });

  it("every member is routable, and the 5.5 ids have chains of their own", () => {
    for (const [key, chain] of chains) for (const id of chain) expect(getProviderForModel(id), `${key} -> ${id}`).not.toBeNull();
    for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]) {
      expect(modelFallbackChains[id]?.length, id).toBeGreaterThan(0);
    }
  });

  it("keeps a chain for each retired key so a persisted room on one of them still has an escape route", () => {
    for (const key of ["claude-opus-4.1", "claude-opus-4", "claude-sonnet-4", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite-preview"]) {
      expect(modelFallbackChains[key]?.length, key).toBeGreaterThan(0);
    }
  });
});

describe("§1.3 request-shape facts are keyed by exact id", () => {
  it("forbids a forced tool_choice for Sonnet/Opus 5.5 (both transports) but not Haiku 5.5 or 4.x", () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"]) expect(forbidsForcedToolChoice(id), id).toBe(true);
    for (const id of ["claude-haiku-5-5", "anthropic/claude-haiku-5.5", "claude-sonnet-4-6", "gemini-3.8-flash", "z-ai/glm-5.2"]) expect(forbidsForcedToolChoice(id), id).toBe(false);
  });

  it("pins the §1.3 default effort per 5.5 id and none elsewhere", () => {
    expect([claudeDefaultEffort("claude-haiku-5-5"), claudeDefaultEffort("claude-sonnet-5-5"), claudeDefaultEffort("claude-opus-5-5")]).toEqual(["medium", "high", "medium"]);
    expect(claudeDefaultEffort("claude-opus-4-8")).toBeUndefined();
    expect(isClaude55Id("claude-opus-4-8")).toBe(false);
  });

  it("floors the output cap at 2048 for 5.5 ids only", () => {
    const saved = process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS;
    process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS = "1024";
    try {
      expect(modelMaxOutputTokens("claude-sonnet-5-5")).toBe(2048);
      expect(modelMaxOutputTokens("anthropic/claude-haiku-5.5")).toBe(2048);
      expect(modelMaxOutputTokens("claude-haiku-4-5")).toBe(1024);
      expect(modelMaxOutputTokens()).toBe(1024);
    } finally {
      if (saved === undefined) delete process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS; else process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS = saved;
    }
  });
});
