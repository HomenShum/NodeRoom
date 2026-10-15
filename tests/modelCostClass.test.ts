/**
 * SPEC A.0.10 - cost class is preserved and unknown ids fail closed (NodeRoom, PR model-refresh/noderoom).
 *
 * Persona: an operator who runs rooms on free OpenRouter models and keeps AGENT_FALLBACK_MODEL (or the Convex
 * AGENT_FALLBACK_MODELS list) pointing at a paid Gemini for the day OpenRouter is down. Failures to prevent:
 *   1. a typo or a made-up id (`gemini-9-flash-unknown`, `claude-opus-4.9`) is dispatched to a paid provider
 *      instead of being refused;
 *   2. an outage on a FREE model silently bills the operator by falling back to a paid model nobody reserved against.
 * Every test drives the repo's own builders (`resolveModelAlias`, adapter `model()`, `convexModel()`) with a fake
 * `fetch`, so "no request was made" is observed on the wire, not read off the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpendMeter, model } from "../src/nodeagent/models/adapter";
import { convexModel } from "../src/nodeagent/models/convexModel";
import {
  isFreeModelId,
  lookupModelAlias,
  resolveModelAlias,
  UnknownModelError,
} from "../src/nodeagent/models/modelCatalog";
import { OPENROUTER_FREE_AUTO_MODEL } from "../src/nodeagent/models/openRouterFreeModels";

const FREE = "cohere/north-mini-code:free"; // a concrete, catalog-priced free model
const PAID = "gemini-3.8-flash";
const TURN = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [] };
const UNKNOWN_PAID = ["gemini-9-flash-unknown", "acme/paid-unknown-model", "claude-opus-4.9", "gpt-9-unknown", "made-up"];

type Call = { url: string; provider: "openrouter" | "google" | "anthropic" | "openai" | "other" };
let calls: Call[] = [];
const providerOf = (url: string): Call["provider"] =>
  url.includes("openrouter.ai") ? "openrouter" : url.includes("googleapis.com") ? "google" : url.includes("anthropic.com") ? "anthropic" : url.includes("openai.com") ? "openai" : "other";

/** OpenRouter is down (503) while Google answers; every request is recorded by provider. */
function openRouterDownGoogleUp() {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, provider: providerOf(url) });
    if (providerOf(url) === "google") {
      return new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { message: "Service unavailable", code: 503 } }), { status: 503, headers: { "content-type": "application/json" } });
  });
}
const paidCalls = () => calls.filter((c) => c.provider === "google" || c.provider === "anthropic" || c.provider === "openai");

const ENV = ["AGENT_FALLBACK_MODEL", "AGENT_FALLBACK_MODELS", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("unknown ids fail closed at the resolver and at both public boundaries", () => {
  it.each(UNKNOWN_PAID)("resolveModelAlias(%s) throws UnknownModelError", (id) => {
    expect(() => resolveModelAlias(id)).toThrow(UnknownModelError);
    expect(lookupModelAlias(id), "the lenient lookup used by pricing readers still returns the input").toBe(id);
  });

  it.each(UNKNOWN_PAID)("adapter model(%s) and convexModel(%s) throw before any request, metered or not", async (id) => {
    openRouterDownGoogleUp();
    expect(() => model(id)).toThrow(UnknownModelError);
    expect(() => model(id, { meter: createSpendMeter(10) })).toThrow(UnknownModelError);
    expect(() => convexModel(id)).toThrow(UnknownModelError);
    expect(calls).toHaveLength(0);
  });

  it("an unknown id configured as the fallback is refused too, after the primary's own failed request", async () => {
    openRouterDownGoogleUp();
    process.env.AGENT_FALLBACK_MODEL = "gemini-9-flash-unknown";
    await expect(model(FREE, { dispatch: { maxRetries: 0, crossModelFallback: true } }).next(TURN)).rejects.toBeInstanceOf(UnknownModelError);
    expect(calls.map((c) => c.provider)).toEqual(["openrouter"]); // only the primary's request; the unknown fallback was never dispatched

    expect(() => convexModel(FREE, { fallbackModelIds: ["gemini-9-flash-unknown"] })).toThrow(UnknownModelError);
  });

  it.each([
    ["vendor/not-in-catalog:free", "a :free suffix"],
    ["made-up-free", "a -free suffix"],
    ["Acme/New-Model:FREE", "a :free suffix in any case"],
  ])("the unknown free-looking id %s (%s) resolves to the verified free route, never a paid default", async (id) => {
    openRouterDownGoogleUp();
    expect(resolveModelAlias(id)).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(isFreeModelId(resolveModelAlias(id))).toBe(true);
    expect(model(id).name).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(convexModel(id).name).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(calls).toHaveLength(0);
  });

  it("catalog ids, aliases and old persisted strings still resolve (nothing the catalog knows is refused)", () => {
    expect(resolveModelAlias(PAID)).toBe(PAID);
    expect(resolveModelAlias("free")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("openrouter-auto")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("claude-sonnet")).toBe("claude-sonnet-4-6");
    expect(resolveModelAlias("claude-sonnet-4.5")).toBe("claude-sonnet-4-5"); // priced under its dotted id only
    expect(resolveModelAlias("nodeagent/free-auto")).toBe("nodeagent/free-auto");
    expect(resolveModelAlias(FREE)).toBe(FREE);
  });

  it("Object.prototype keys are not catalog ids", () => {
    for (const id of ["constructor", "__proto__", "toString"]) expect(() => resolveModelAlias(id), id).toThrow(UnknownModelError);
  });
});

describe("a free request never becomes a paid request (adapter path)", () => {
  beforeEach(() => { process.env.AGENT_FALLBACK_MODEL = PAID; });
  const POLICY = { maxRetries: 0, crossModelFallback: true };

  it("the default policy: a concrete :free model that is down does NOT fall through to AGENT_FALLBACK_MODEL; the free model's error surfaces", async () => {
    vi.useFakeTimers();
    openRouterDownGoogleUp();
    const outcome = model(FREE).next(TURN).then(() => null, (e: unknown) => e); // DEFAULT_DISPATCH_POLICY: 3 retries, fallback allowed
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(calls.length).toBeGreaterThan(0);
    expect(paidCalls()).toEqual([]);
  });

  it("allowPaidFallback alone is not enough: without a meter nothing reserves the paid model, so it is not dispatched", async () => {
    openRouterDownGoogleUp();
    await expect(model(FREE, { dispatch: { ...POLICY, allowPaidFallback: true } }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("a meter alone is not enough either: the caller must say allowPaidFallback", async () => {
    openRouterDownGoogleUp();
    const meter = createSpendMeter(10);
    await expect(model(FREE, { dispatch: POLICY, meter }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
    expect(meter.dispatches.every((d) => !d.fallbackUsed)).toBe(true);
  });

  it("allowPaidFallback AND a meter: the paid fallback is reserved against the meter and then dispatched", async () => {
    openRouterDownGoogleUp();
    const meter = createSpendMeter(10);
    const step = await model(FREE, { dispatch: { ...POLICY, allowPaidFallback: true }, meter }).next(TURN);
    expect(step.text).toBe("ok");
    expect(paidCalls()).toHaveLength(1);
    const paid = meter.dispatches.find((d) => d.fallbackUsed);
    expect(paid).toMatchObject({ resolvedModel: PAID, fallbackUsed: true });
    expect(paid!.costUsd).toBeGreaterThan(0);
    expect(meter.spentUsd).toBeGreaterThanOrEqual(paid!.costUsd);
  });

  it("a paid fallback the meter cannot afford is refused before it is sent, even with allowPaidFallback", async () => {
    openRouterDownGoogleUp();
    const meter = createSpendMeter(1e-9);
    await expect(model(FREE, { dispatch: { ...POLICY, allowPaidFallback: true }, meter }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("a free -> free fallback is the same cost class and needs nothing", async () => {
    openRouterDownGoogleUp();
    process.env.AGENT_FALLBACK_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
    await expect(model(FREE, { dispatch: POLICY }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(calls.map((c) => c.provider)).toEqual(["openrouter", "openrouter"]);
    expect(calls[1].url).toContain("openrouter.ai");
  });

  it("a paid primary keeps its fallback behaviour (paid -> paid, and paid -> free, are not free -> paid)", async () => {
    calls = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, provider: providerOf(url) });
      return new Response(JSON.stringify({ error: { code: 503, message: "Service unavailable" } }), { status: 503, headers: { "content-type": "application/json" } });
    });
    process.env.AGENT_FALLBACK_MODEL = FREE;
    await expect(model(PAID, { dispatch: POLICY }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(calls.map((c) => c.provider)).toEqual(["google", "openrouter"]);
  });
});

describe("a free request never becomes a paid request (Convex path)", () => {
  it("fallbackModelIds with a paid model on a free primary: dropped, the paid provider is never called", async () => {
    openRouterDownGoogleUp();
    await expect(convexModel(FREE, { fallbackModelIds: [PAID] }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("the deployment env list (AGENT_FALLBACK_MODELS) is held to the same rule", async () => {
    openRouterDownGoogleUp();
    process.env.AGENT_FALLBACK_MODELS = PAID;
    const { configuredConvexModelFallbacks } = await import("../src/nodeagent/models/convexModel");
    await expect(convexModel(FREE, { fallbackModelIds: configuredConvexModelFallbacks(FREE, process.env) }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("allowPaidFallback without a reservation budget (no maxCostUsd on next()) is still blocked", async () => {
    openRouterDownGoogleUp();
    await expect(convexModel(FREE, { fallbackModelIds: [PAID], allowPaidFallback: true }).next(TURN)).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("a finite maxCostUsd without allowPaidFallback is still blocked", async () => {
    openRouterDownGoogleUp();
    await expect(convexModel(FREE, { fallbackModelIds: [PAID] }).next({ ...TURN, maxCostUsd: 1 })).rejects.toBeInstanceOf(Error);
    expect(paidCalls()).toEqual([]);
  });

  it("allowPaidFallback with a finite maxCostUsd: the paid candidate is estimated against the budget and then dispatched", async () => {
    openRouterDownGoogleUp();
    const step = await convexModel(FREE, { fallbackModelIds: [PAID], allowPaidFallback: true }).next({ ...TURN, maxCostUsd: 1 });
    expect(step.text).toBe("ok");
    expect(paidCalls()).toHaveLength(1);
  });

  it("a paid primary keeps its paid fallback with no flag (cost class preserved, not narrowed)", async () => {
    openRouterDownGoogleUp();
    // PAID is Google, which is up; make the fallback list start from a model that fails: an OpenRouter paid model.
    const step = await convexModel("qwen/qwen3.7-plus", { fallbackModelIds: [PAID] }).next(TURN);
    expect(step.text).toBe("ok");
    expect(calls.map((c) => c.provider)).toEqual(["openrouter", "google"]);
  });
});
