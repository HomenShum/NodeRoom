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
import { allAgentLlmRoutes, OPENROUTER_TOP_PAID_AGENT_ROUTES, resolveRouteSet, SUPPORTED_MODEL_ROUTES } from "../scripts/benchmark/modelEvalConfig";
import { DEFAULT_TOP_PAID_MODEL } from "../convex/modelDefaults";
import { model } from "../src/nodeagent/models/adapter";
import { chooseNodeAgentRoute, type NodeAgentTaskType } from "../src/nodeagent/core/adaptiveRouter";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { getModelPricing, llmModelCatalog, lookupModelAlias, modelPricing, resolveModelAlias, UnknownModelError } from "../src/nodeagent/models/modelCatalog";
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

/**
 * SPEC-v9 section 1.2 wire ids, every transport (D1: an id in 1.2 is known). Typed here from the spec table on purpose:
 * the spec lives outside this repo, so this is the one place a reader checks the transcription.
 */
const SPEC_1_2_WIRE_IDS = [
  "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1",
  "anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1",
  "anthropic.claude-haiku-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-fable-5-1",
  "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-3.8-flash-tts", "gemini-3.8-live",
  "google/gemini-3.8-flash", "google/gemini-3.6-flash", "google/gemini-3.5-flash-lite", "google/gemini-3.1-pro-preview",
  "gpt-6.1-sol", "openai/gpt-6.1-sol", "gpt-6-luna", "openai/gpt-6-luna", "gpt-5.4-mini", "openai/gpt-5.4-mini",
  "moonshotai/kimi-k3", "z-ai/glm-5.3", "minimax/minimax-m3", "nvidia/nemotron-3-super-120b-a12b:free",
  // the spec's 2026-10-10 live :free list
  "apodex/apodex-1.1-mini:free", "dots-studio/dots-3-note-preview:free", "liquid/lfm-2.5-2.6b:free", "nvidia/nemotron-3.5-lightning:free",
  "thinkingmachines/inkling-small:free", "poolside/laguna-s-2.1:free", "thinkingmachines/inkling:free", "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free", "nvidia/nemotron-3.5-content-safety:free", "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free",
];

describe("every id the repo ships, freezes or lists resolves as itself", () => {
  it.each(OPENROUTER_TOP_PAID_AGENT_ROUTES.map((r) => r.route))("top-paid route %s (`model-eval-matrix --route-set top-paid` goes through model(id))", expectUnchanged);
  it.each([...new Set(allAgentLlmRoutes().map((r) => r.route))])("agent route %s", expectUnchanged);
  // Review round 6, defect 4: the benchmark lane labels its decision `openrouter/auto`, and main resolved it as itself.
  const ROUTER_TASKS: NodeAgentTaskType[] = ["collaboration", "research", "private_consult", "analysis", "router", "spreadsheet", "finance", "benchmark"];
  it.each(ROUTER_TASKS)("the model chooseNodeAgentRoute names for task %s (any risk, latency or free setting)", (task) => {
    for (const risk of ["low", "medium", "high"] as const) for (const latency of ["interactive", "batch", "overnight"] as const) for (const freeAllowed of [true, false]) {
      expectUnchanged(chooseNodeAgentRoute({ task, risk, latency, freeAllowed }).model);
    }
  });
  // Review round 6, defect 4: the old regex hyphenated every dotted claude id. Every dotted claude id the catalog still prices or
  // chains is kept (retired models stay valid for persisted rows), so each must still map to the hyphenated wire form.
  it.each(Object.keys(modelPricing).filter((id) => /^claude-[a-z]+-[0-9]+\.[0-9]+$/.test(id)))("dotted retained id %s resolves to its hyphenated wire id and the wire id is priced", (id) => {
    const wire = id.replace(/\./g, "-");
    expect(resolveModelAlias(id)).toBe(wire);
    expect(getModelPricing(wire), `${wire} has no price row`).not.toBeNull();
  });
  it.each(["top-paid", "supported", "champions", "free", "research", "collaboration"])("every id of route set %s", (set) => {
    for (const id of resolveRouteSet(set)) expectUnchanged(id);
  });
  it.each(SPEC_1_2_WIRE_IDS)("SPEC section 1.2 wire id %s", expectUnchanged);

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

describe("SPEC-v9 D2: the top_paid default is the newest qualifying :free row of the recorded public OpenRouter list", () => {
  const snapshot = JSON.parse(readFileSync("docs/eval/openrouter-free-models-2026-10-16.json", "utf8")) as {
    fetchedAt: string; selected: string; rows: Array<{ id: string; created: number; contextLength: number; outputModalities: string[]; tools: boolean; toolChoice: boolean; structuredOutputs: boolean; expirationDate: string | null }>;
  };

  it("DEFAULT_TOP_PAID_MODEL is the row a re-selection by the stated criteria returns, and the snapshot records its fetch time", () => {
    const qualifying = snapshot.rows
      .filter((r) => r.tools && r.toolChoice && r.structuredOutputs && r.contextLength >= 256_000 && r.outputModalities.includes("text") && r.id.endsWith(":free"))
      .sort((a, b) => b.created - a.created);
    expect(qualifying[0].id).toBe(DEFAULT_TOP_PAID_MODEL);
    expect(snapshot.selected).toBe(DEFAULT_TOP_PAID_MODEL);
    expect(snapshot.fetchedAt).toBe("2026-10-16T11:32:04Z");
  });

  it("it resolves as itself, is a free route, and is never rerouted to the auto router", () => {
    expectUnchanged(DEFAULT_TOP_PAID_MODEL);
    expect(OPENROUTER_KNOWN_FREE_IDS.has(DEFAULT_TOP_PAID_MODEL)).toBe(true);
  });
});

describe("SPEC-v9 D1: an operator-selected id in an eval or smoke script is passed through", () => {
  // Persona: an evaluator runs `ladder:free --free-auto-top` or `benchmark/run.ts <id>` with a :free row picked from the live
  // OpenRouter list, or a CLI id this catalog has never seen. origin/main measured it under its own label; the fail-closed
  // resolver threw (unknown paid id) or measured the auto router under the concrete label (unknown :free id).
  it.each(["openrouter/owl-alpha:free", "qwen/qwen3.9-coder:free", "acme/paid-unknown-model"])("model(%s, { operatorSelected }) keeps the id as written", (id) => {
    expect(model(id, { operatorSelected: true }).name).toBe(id);
  });

  it("server code (no option) is unchanged: an unknown paid id throws, an unknown :free id goes to the verified free route", () => {
    expect(() => model("acme/paid-unknown-model")).toThrow(UnknownModelError);
    expect(model("qwen/qwen3.9-coder:free").name).toBe(OPENROUTER_FREE_AUTO_MODEL);
  });

  it("the alias table still applies to an operator-selected id", () => {
    expect(model("claude-sonnet", { operatorSelected: true }).name).toBe(lookupModelAlias("claude-sonnet"));
  });

  it("convexModel keeps the same contract: an operator-selected unknown id is passed through, server code still throws", () => {
    expect(convexModel("vendor/unknown-x", { operatorSelected: true }).name).toBe("vendor/unknown-x");
    expect(convexModel("foo/bar:free", { operatorSelected: true }).name).toBe("foo/bar:free");
    expect(convexModel("claude-sonnet", { operatorSelected: true }).name).toBe(lookupModelAlias("claude-sonnet"));
    expect(() => convexModel("vendor/unknown-x")).toThrow(UnknownModelError);
    expect(convexModel("foo/bar:free").name).toBe(OPENROUTER_FREE_AUTO_MODEL);
  });

  // Source pin: these are CLI entry points whose model id is typed by an operator (flag or env). Every call into the
  // adapter or convexModel resolver must carry the option, wherever the call sits and however many lines it spans.
  const OPERATOR_ENTRY_POINTS = [
    "scripts/benchmark/run.ts", "scripts/proofloop-free-model-gauge.ts", "evals/ladder.ts", "scripts/spreadsheetbench-run.ts",
    "evals/chatIntakeRuntime.ts", "evals/financeModelLive.ts", "evals/managedLockPerf.ts", "evals/professionalRuntimeLive.ts",
    "scripts/halo-live-path-calibration.ts", "scripts/startup-diligence-provider-eval.ts", "scripts/sfn-nonbtb-nodeagent-runner.ts",
    "src/eval/bankerToolBenchNodeAgentGeneral.ts",
  ];
  const resolverCalls = (src: string): string[] => {
    const calls: string[] = [];
    const callStart = /(?<![\w$])(?:\.)?(?:model|realModel|routedModel|convexModel)\(/g;
    for (let m = callStart.exec(src); m; m = callStart.exec(src)) {
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const prefix = src.slice(lineStart, m.index);
      if (/^\s*(?:\/\/|\*|import\b|(?:export\s+)?(?:async\s+)?function\b)/.test(prefix) || (prefix.split("`").length - 1) % 2 === 1) continue; // comment, declaration, or inside a template string
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      calls.push(src.slice(m.index, i + 1));
    }
    return calls;
  };

  it.each(OPERATOR_ENTRY_POINTS)("%s passes operatorSelected on every resolver call", (file) => {
    const calls = resolverCalls(readFileSync(file, "utf8"));
    expect(calls.length, `${file}: no resolver call found, the pin is not looking at anything`).toBeGreaterThan(0);
    for (const call of calls) expect(call, `${file}: ${call.slice(0, 80)}`).toContain("operatorSelected: true");
  });
});
