/**
 * Ladder spend budget (SPEC Part A §A.2.9 "Ladder budget", Codex R1, v4-new-2, v5-new-1).
 *
 * Tests the ACTUAL adapter path, not a fake AgentModel: `model(id, { dispatch, meter })` runs the real AI-SDK
 * Google provider with `fetch` replaced by a fake transport that counts physical requests. The claims:
 *   - the meter moves at DISPATCHES (one reservation per physical request, retries and fallbacks included);
 *   - a request whose worst case would cross the cap is never issued;
 *   - the AI SDK's own retry loop adds no request of its own (pinned to 0);
 *   - an id the catalog cannot price is refused before any request, never reserved at a guessed price.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpendMeter,
  model,
  priceRequestStrict,
  requestInputTokenUpperBound,
  reserveDispatch,
  SpendBudgetError,
  UnpricedModelError,
  type DispatchPolicy,
} from "../src/nodeagent/models/adapter";
import { UnknownModelError } from "../src/nodeagent/models/modelCatalog";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";

const PRICED = "gemini-3.8-flash";
// Round 3 (SPEC A.0.10): an id the catalog has never heard of no longer reaches the adapter at all. `UNPRICED` was
// "routes to the Google provider, has no pricing row" and used to be dispatched; it now throws UnknownModelError at
// model() (see the A.0.10 test below). The (g) invariants - zero requests, meter untouched, terminal stop - are about an
// id the adapter CAN route but the catalog cannot price, which is now only an id the alias table declares without a
// price row: a persisted-room string such as "claude-sonnet-4.5" (resolves to claude-sonnet-4-5, priced nowhere).
const UNPRICED = "gemini-9.9-unpriced-test";
const UNPRICED_ALIAS = "claude-sonnet-4.5";
const RECEIPT: DispatchPolicy = { maxRetries: 0, crossModelFallback: false };
const TURN = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [] };
const BOUND = requestInputTokenUpperBound(TURN.system, TURN.messages, TURN.tools);
const RESERVE = reserveDispatch(PRICED, BOUND, Number.POSITIVE_INFINITY);

type Call = { url: string; body: Record<string, any> };
let calls: Call[] = [];
let billedUsd = 0;

function ok(inputTokens = 1_000, outputTokens = 200) {
  return new Response(JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens, totalTokenCount: inputTokens + outputTokens },
  }), { status: 200, headers: { "content-type": "application/json" } });
}
const unavailable = () => new Response(JSON.stringify({ error: { code: 503, message: "Service unavailable", status: "UNAVAILABLE" } }), { status: 503, headers: { "content-type": "application/json" } });

function fakeTransport(answer: (n: number, call: Call) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: Call = { url, body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") };
    calls.push(call);
    return answer(calls.length, call);
  });
}

const SAVED = { key: process.env.GOOGLE_GENERATIVE_AI_API_KEY, fb: process.env.AGENT_FALLBACK_MODEL, cap: process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS, ladderCap: process.env.LADDER_MAX_COST_USD };
beforeEach(() => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  delete process.env.AGENT_FALLBACK_MODEL;
  delete process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS;
  delete process.env.LADDER_MAX_COST_USD;
  billedUsd = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const [k, v] of [["GOOGLE_GENERATIVE_AI_API_KEY", SAVED.key], ["AGENT_FALLBACK_MODEL", SAVED.fb], ["AGENT_MODEL_MAX_OUTPUT_TOKENS", SAVED.cap], ["LADDER_MAX_COST_USD", SAVED.ladderCap]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("meter moves at dispatches (adapter path, fake transport)", () => {
  it("(a) a charged response then ECONNRESET under the receipt policy: exactly two dispatches, error propagates, failed reservation is kept", async () => {
    fakeTransport((n) => {
      if (n === 1) return ok(1_000, 200);
      throw Object.assign(new Error("fetch failed: ECONNRESET"), { code: "ECONNRESET" });
    });
    const meter = createSpendMeter(10);
    const m = model(PRICED, { dispatch: RECEIPT, meter });

    await m.next(TURN);
    expect(meter.requests).toBe(1);
    expect(meter.spentUsd).toBeCloseTo(priceRequestStrict(PRICED, 1_000, 200), 12); // reservation replaced by the priced usage

    await expect(m.next(TURN)).rejects.toThrow(/ECONNRESET/);
    expect(calls).toHaveLength(2); // maxRetries 0: no retry, no SDK retry, no fallback
    expect(meter.requests).toBe(2);
    expect(meter.spentUsd).toBeCloseTo(priceRequestStrict(PRICED, 1_000, 200) + RESERVE, 12); // the failed dispatch's reservation is retained
  });

  it("(b) the same sequence (charged response, then ECONNRESET) under the default policy reserves once per attempt and never crosses the cap", async () => {
    vi.useFakeTimers();
    fakeTransport((n) => {
      if (n === 1) return ok(1_000, 200);
      throw Object.assign(new Error("fetch failed: ECONNRESET"), { code: "ECONNRESET" }); // transient: the default policy retries it
    });
    const first = priceRequestStrict(PRICED, 1_000, 200);
    const meter = createSpendMeter(first + RESERVE * 2.5); // after the charged answer: room for two more reservations, not three
    const m = model(PRICED, { meter }); // default policy: 3 retries, fallback allowed (no AGENT_FALLBACK_MODEL set)

    await m.next(TURN);
    expect(calls).toHaveLength(1);
    expect(meter.spentUsd).toBeCloseTo(first, 12);

    const outcome = m.next(TURN).then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const error = await outcome;

    expect(error).toBeInstanceOf(SpendBudgetError);
    expect((error as SpendBudgetError).receipt.stopReason).toBe("spend_budget");
    expect(calls).toHaveLength(3); // the charged answer + two reset attempts; the attempt whose reservation would cross the cap is not issued
    expect(meter.requests).toBe(3);
    expect(meter.spentUsd).toBeCloseTo(first + RESERVE * 2, 12); // each issued attempt kept its own reservation
    expect(meter.spentUsd).toBeLessThanOrEqual(meter.maxUsd);
    expect(meter.stoppedBy).toBe("spend_budget");
  });

  it("every issued request leaves one receipt row: requested/resolved id, the provider's echoed model, usage, cost, fallbackUsed", async () => {
    fakeTransport(() => new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 200, totalTokenCount: 1_200 },
      modelVersion: "gemini-3.6-flash", // Google serving the request under another model than the one asked for
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const meter = createSpendMeter(10);
    await model(PRICED, { dispatch: RECEIPT, meter }).next(TURN);
    expect(meter.dispatches).toEqual([{
      requestedModel: PRICED,
      resolvedModel: PRICED,
      echoedModel: "gemini-3.6-flash",
      usage: { inputTokens: 1_000, outputTokens: 200 },
      costUsd: priceRequestStrict(PRICED, 1_000, 200),
      fallbackUsed: false,
    }]);
  });

  it("a cross-model fallback dispatch is marked fallbackUsed: true (the receipt rejects such a row)", async () => {
    vi.useFakeTimers();
    process.env.AGENT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
    fakeTransport((_n, call) => call.url.includes("/models/gemini-3.5-flash-lite:") ? ok(100, 10) : unavailable());
    const meter = createSpendMeter(10);
    const outcome = model(PRICED, { meter }).next(TURN); // default policy: 4 attempts on the primary, then the fallback model
    await vi.advanceTimersByTimeAsync(120_000);
    await outcome;
    expect(meter.dispatches.map((d) => [d.resolvedModel, d.requestedModel, d.fallbackUsed])).toEqual([
      [PRICED, PRICED, false], [PRICED, PRICED, false], [PRICED, PRICED, false], [PRICED, PRICED, false],
      ["gemini-3.5-flash-lite", PRICED, true],
    ]);
  });

  it("a request that throws keeps its full reservation as its row cost, with no echoed model or usage", async () => {
    fakeTransport(() => { throw Object.assign(new Error("fetch failed: ECONNRESET"), { code: "ECONNRESET" }); });
    const meter = createSpendMeter(10);
    await expect(model(PRICED, { dispatch: RECEIPT, meter }).next(TURN)).rejects.toThrow(/ECONNRESET/);
    expect(meter.dispatches).toEqual([{ requestedModel: PRICED, resolvedModel: PRICED, echoedModel: null, usage: null, costUsd: RESERVE, fallbackUsed: false }]);
  });

  it.each([
    ["usageMetadata {}", {}],
    ["only candidatesTokenCount", { candidatesTokenCount: 10 }],
    ["promptTokenCount 0", { promptTokenCount: 0, candidatesTokenCount: 10 }],
    // Round 3: @ai-sdk/google turns a missing candidatesTokenCount into 0, so input-only blocks used to settle as complete.
    ["only promptTokenCount", { promptTokenCount: 100 }],
    ["promptTokenCount + totalTokenCount, no candidatesTokenCount (total implies 8000 billed output tokens)", { promptTokenCount: 1_000, totalTokenCount: 9_000 }],
  ])("partial usage (%s) is unknown usage: the reservation is kept, never settled at ~$0 (SPEC A.2.9 accounting)", async (_label, usageMetadata) => {
    fakeTransport(() => new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
      usageMetadata,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const meter = createSpendMeter(10);
    await model(PRICED, { dispatch: RECEIPT, meter }).next(TURN);
    expect(meter.spentUsd).toBeCloseTo(RESERVE, 12);
    expect(meter.dispatches[0]).toMatchObject({ usage: null, costUsd: RESERVE });
  });

  it("sustained: unreported output keeps every reservation, so a cap that fits one worst case refuses dispatch two (round 3)", async () => {
    fakeTransport(() => new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const meter = createSpendMeter(RESERVE * 1.5);
    const m = model(PRICED, { dispatch: RECEIPT, meter });
    await m.next(TURN);
    await expect(m.next(TURN)).rejects.toMatchObject({ receipt: { stopReason: "spend_budget" } });
    expect(calls).toHaveLength(1);
    expect(meter.spentUsd).toBeCloseTo(RESERVE, 12);
  });

  it("(c) a reservation above the remaining budget before the first dispatch throws spend_budget with zero fetch calls", async () => {
    fakeTransport(() => ok());
    const meter = createSpendMeter(RESERVE / 2);
    await expect(model(PRICED, { dispatch: RECEIPT, meter }).next(TURN)).rejects.toMatchObject({ receipt: { stopReason: "spend_budget" } });
    expect(calls).toHaveLength(0);
    expect(meter.requests).toBe(0);
    expect(meter.spentUsd).toBe(0);
  });

  it("(d) every issued request body carries the output cap the reservation priced", async () => {
    fakeTransport(() => ok());
    const meter = createSpendMeter(10);
    const m = model(PRICED, { dispatch: RECEIPT, meter });
    await m.next(TURN);
    await m.next(TURN);
    expect(calls.map((c) => c.body.generationConfig?.maxOutputTokens)).toEqual([modelMaxOutputTokens(), modelMaxOutputTokens()]);
    process.env.AGENT_MODEL_MAX_OUTPUT_TOKENS = "2048";
    await m.next(TURN);
    expect(calls.at(-1)!.body.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("(f) retryable 503s under { maxRetries: 3 }: exactly four requests, four reservations; the SDK adds none", async () => {
    vi.useFakeTimers();
    fakeTransport(() => unavailable());
    const meter = createSpendMeter(10);
    const m = model(PRICED, { dispatch: { maxRetries: 3, crossModelFallback: false }, meter });
    const outcome = m.next(TURN).then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(calls).toHaveLength(4);
    expect(meter.requests).toBe(4);
    expect(meter.spentUsd).toBeCloseTo(RESERVE * 4, 12);
  });
});

describe("(g) zero requests for an unpriced id", () => {
  it("model() with a $10 meter and at the $0.01 equality case: UnpricedModelError, zero fetch calls, meter untouched", async () => {
    fakeTransport(() => ok()); // the transport would answer 200 if anything were sent
    for (const maxUsd of [10, 0.01]) {
      const meter = createSpendMeter(maxUsd);
      const error = await model(UNPRICED_ALIAS, { dispatch: RECEIPT, meter }).next(TURN).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(UnpricedModelError);
      expect((error as UnpricedModelError).receipt.stopReason).toBe("spend_budget");
      expect(meter.requests).toBe(0);
      expect(meter.spentUsd).toBe(0);
      expect(meter.stoppedBy).toBe("unpriced_model");
    }
    expect(calls).toHaveLength(0);
  });

  it("(A.0.10) an id the catalog has never heard of never reaches the adapter: model() throws before any request, metered or not", async () => {
    fakeTransport(() => ok());
    const meter = createSpendMeter(10);
    expect(() => model(UNPRICED, { dispatch: RECEIPT, meter })).toThrow(UnknownModelError);
    expect(() => model(UNPRICED)).toThrow(UnknownModelError); // the unmetered legacy caller is refused too: no paid default
    expect(calls).toHaveLength(0);
    expect(meter.requests).toBe(0);
    expect(meter.spentUsd).toBe(0);
  });

  it("a priced primary answering four 503s with an unpriced AGENT_FALLBACK_MODEL makes the primary's four requests and none for the fallback", async () => {
    vi.useFakeTimers();
    process.env.AGENT_FALLBACK_MODEL = UNPRICED_ALIAS;
    fakeTransport(() => unavailable());
    const meter = createSpendMeter(10);
    const outcome = model(PRICED, { meter }).next(TURN).then(() => null, (e: unknown) => e); // default policy
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toBeInstanceOf(UnpricedModelError);
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.url.includes(`/models/${PRICED}:`))).toBe(true);
    expect(meter.requests).toBe(4);
  });

  it("a terminal stop ends the dispatch: an unpriced primary never reaches a priced AGENT_FALLBACK_MODEL", async () => {
    process.env.AGENT_FALLBACK_MODEL = PRICED; // would be affordable and priced: must still not be dispatched
    fakeTransport(() => ok());
    const meter = createSpendMeter(10);
    const error = await model(UNPRICED_ALIAS, { meter }).next(TURN).then(() => null, (e: unknown) => e); // default policy: fallback allowed
    expect(error).toBeInstanceOf(UnpricedModelError);
    expect(meter.stoppedBy).toBe("unpriced_model");
    expect(calls).toHaveLength(0);
    expect(meter.requests).toBe(0);
  });

  it("a terminal stop ends the dispatch: a cap-refused primary never reaches a cheaper AGENT_FALLBACK_MODEL", async () => {
    process.env.AGENT_FALLBACK_MODEL = "gemini-3.5-flash-lite"; // its reservation would fit under the cap
    fakeTransport(() => ok());
    const cheap = reserveDispatch("gemini-3.5-flash-lite", BOUND, Number.POSITIVE_INFINITY);
    expect(cheap).toBeLessThan(RESERVE);
    const meter = createSpendMeter((RESERVE + cheap) / 2); // primary does not fit, the fallback would
    const error = await model(PRICED, { meter }).next(TURN).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(SpendBudgetError);
    expect(meter.stoppedBy).toBe("spend_budget");
    expect(calls).toHaveLength(0);
    expect(meter.requests).toBe(0);
    expect(meter.spentUsd).toBe(0);
  });

  it("after a stop the meter refuses every further dispatch, even a different model that would fit", async () => {
    fakeTransport(() => ok());
    const meter = createSpendMeter(10);
    meter.stoppedBy = "spend_budget";
    await expect(model("gemini-3.5-flash-lite", { dispatch: RECEIPT, meter }).next(TURN)).rejects.toBeInstanceOf(SpendBudgetError);
    expect(calls).toHaveLength(0);
  });

  it("an unmetered adapter is unchanged: no reservation, no refusal", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    try {
      fakeTransport(() => anthropicAnswer(10, 5));
      const step = await model(UNPRICED_ALIAS).next(TURN); // no meter: legacy callers are not budget-gated
      expect(step.text).toBe("done");
      expect(calls).toHaveLength(1);
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

describe("main(): pre-flight and the grid", () => {
  let dir: string;
  const argvBefore = process.argv;
  const exitBefore = process.exitCode;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ladder-budget-")); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { process.argv = argvBefore; process.exitCode = exitBefore; rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  async function runMain(args: string[]) {
    const out = join(dir, "report.json");
    process.argv = ["node", "ladder.ts", ...args, "--json-out", out];
    process.exitCode = undefined;
    const { main } = await import("./ladder");
    await main();
    const exitCode = process.exitCode;
    process.exitCode = exitBefore;
    let report: Record<string, any> | undefined;
    try { report = JSON.parse(readFileSync(out, "utf8")); } catch { /* refusal before any report */ }
    return { exitCode, report };
  }

  it("refuses --real without a dollar cap: exit 1, no request", async () => {
    fakeTransport(() => ok());
    const { exitCode } = await runMain(["--real", PRICED, "--levels=1-4"]);
    expect(exitCode).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("(g) --real with an unpriced id exits 1 at pre-flight: stoppedBy unpriced_model, no result rows, zero fetch calls", async () => {
    fakeTransport(() => ok());
    const { exitCode, report } = await runMain(["--real", UNPRICED, "--levels=1-4", "--max-cost-usd=1"]);
    expect(exitCode).toBe(1);
    expect(report?.budget).toMatchObject({ stoppedBy: "unpriced_model", requests: 0, spentUsd: 0 });
    expect(report?.results).toEqual([]);
    expect(report?.dispatchPolicy).toEqual(RECEIPT);
    expect(calls).toHaveLength(0);
  });

  it("refuses to start when the worst-case estimate exceeds the cap (the human raises the cap, never the check)", async () => {
    fakeTransport(() => ok());
    const { exitCode, report } = await runMain(["--real", PRICED, "--levels=1-4", "--max-cost-usd=0.0001"]);
    expect(exitCode).toBe(1);
    expect(report?.budget.estimateUsd).toBeGreaterThan(0.0001);
    expect(report?.budget).toMatchObject({ stoppedBy: "spend_budget", requests: 0 });
    expect(calls).toHaveLength(0);
  });

  it("(e) usage within each reservation, a context that outgrows the scripted pre-flight: the grid stops BEFORE the cap, spentUsd <= maxUsd, budget.requests equals the fetch count", async () => {
    // Pass the pre-flight with the smallest admissible cap (the estimate itself), then answer every step with a tool
    // call plus 20K characters of text so the real prompt outgrows the scripted dry run the estimate was built on.
    // Each answer bills half its request body in tokens (realistic, and below the 1-byte-per-token reservation), so
    // no settlement ever exceeds its reservation: the only thing that can end the grid is a refused reservation.
    fakeTransport(() => ok());
    const probe = await runMain(["--real", PRICED, "--levels=1-4", "--max-cost-usd=0.0001"]);
    const cap = Math.ceil(probe.report!.budget.estimateUsd * 1e4) / 1e4; // >= the estimate, so the pre-flight admits it
    expect(calls).toHaveLength(0);

    fakeTransport((_n, call) => {
      const tokens = Math.floor(JSON.stringify(call.body).length / 2);
      billedUsd += priceRequestStrict(PRICED, tokens, 50);
      return new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "x".repeat(20_000) }, { functionCall: { name: "list_artifacts", args: {} } }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: tokens, candidatesTokenCount: 50, totalTokenCount: tokens + 50 },
        modelVersion: PRICED,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const { exitCode, report } = await runMain(["--real", PRICED, "--levels=1-4", `--max-cost-usd=${cap}`]);
    const budget = report!.budget;
    expect(budget.stoppedBy).toBe("spend_budget"); // a reservation was refused...
    expect(budget.spentUsd).toBeLessThanOrEqual(budget.maxUsd); // ...so the cap was never crossed
    expect(budget.spentUsd).toBeLessThan(budget.maxUsd); // the grid stopped short of it, not on it
    expect(billedUsd).toBeLessThanOrEqual(budget.maxUsd);
    expect(calls.length).toBeGreaterThan(2);
    expect(budget.requests).toBe(calls.length); // nothing was issued after the stop
    expect(budget.requests).toBeLessThan(budget.requestCeiling);
    expect(exitCode).toBe(1); // a stop is not a receipt
  }, 30_000);

  it("the --json-out report carries what an A.0.3 review needs: command, candidateIds, echoedModels, rows, environment, requestCeiling", async () => {
    fakeTransport(() => new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20, totalTokenCount: 520 },
      modelVersion: "gemini-3.6-flash", // Google answering as another model: the receipt must show it
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const probe = await runMain(["--real", PRICED, "--levels=1-4", "--max-cost-usd=0.0001"]);
    const cap = Math.ceil(probe.report!.budget.estimateUsd * 1e4) / 1e4;

    const { report } = await runMain(["--real", PRICED, "--levels=1-4", `--max-cost-usd=${cap}`]);
    expect(report?.command).toContain(`--real ${PRICED}`);
    expect(report?.candidateIds).toEqual([PRICED]);
    expect(report?.echoedModels).toEqual(["gemini-3.6-flash"]);
    expect(report?.environment).toMatchObject({ node: process.version, platform: process.platform });
    expect(report?.rows.length).toBe(calls.length);
    expect(report?.rows[0]).toMatchObject({
      requestedModel: PRICED,
      resolvedModel: PRICED,
      echoedModel: "gemini-3.6-flash",
      usage: { inputTokens: 500, outputTokens: 20 },
      fallbackUsed: false,
    });
    expect(report?.budget.requests).toBeLessThanOrEqual(report?.budget.requestCeiling);
    expect(report?.results.every((r: { dispatches: unknown[] }) => Array.isArray(r.dispatches))).toBe(true);
  });

  it("a rung that issued charged dispatches and then failed on a provider error reports what it spent, not 0 (round 3)", async () => {
    // Persona: the operator runs the L1 rung on a paid route; the network resets on the second request. The rung row
    // used to say cost 0 while its own dispatch rows and the job-wide meter carried the charge (Codex: 0.05301075 vs 0).
    fakeTransport(() => ok());
    const probe = await runMain(["--real", PRICED, "--levels=1-1", "--max-cost-usd=0.0001"]);
    const cap = Math.ceil(probe.report!.budget.estimateUsd * 1e4) / 1e4;

    fakeTransport((n) => {
      if (n === 1) {
        return new Response(JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "list_artifacts", args: {} } }] }, finishReason: "STOP", index: 0 }],
          usageMetadata: { promptTokenCount: 2_000, candidatesTokenCount: 40, totalTokenCount: 2_040 },
          modelVersion: PRICED,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw Object.assign(new Error("fetch failed: ECONNRESET"), { code: "ECONNRESET" });
    });
    const { report } = await runMain(["--real", PRICED, "--levels=1-1", `--max-cost-usd=${cap}`]);
    expect(calls).toHaveLength(2); // the charged answer, then the reset (receipt policy: no retry, no fallback)
    const row = report!.results[0];
    expect(row.error).toMatch(/ECONNRESET/);
    expect(row.pass).toBe(false);
    const dispatchCost = row.dispatches.reduce((sum: number, d: { costUsd: number }) => sum + d.costUsd, 0);
    expect(dispatchCost).toBeGreaterThan(0);
    expect(row.cost).toBeCloseTo(dispatchCost, 12);
    expect(row.cost).toBeCloseTo(report!.budget.spentUsd, 12);
    expect(row.dispatches[0].costUsd).toBeCloseTo(priceRequestStrict(PRICED, 2_000, 40), 12); // the settled one
  });
});

// ───────────────────────────── review round 2 ─────────────────────────────

/** An Anthropic Messages answer reporting `inputTokens` / `outputTokens`; `toolUse` makes the step ask for a tool. */
function anthropicAnswer(inputTokens: number, outputTokens: number, toolUse = false) {
  return new Response(JSON.stringify({
    id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5",
    content: toolUse ? [{ type: "tool_use", id: "tu_1", name: "list_artifacts", input: {} }] : [{ type: "text", text: "done" }],
    stop_reason: toolUse ? "tool_use" : "end_turn", stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("the long-context tier belongs to one request, never to a sum of requests", () => {
  const HAIKU = "claude-haiku-5-5";
  const SAVED_ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-anthropic-key"; });
  afterEach(() => { if (SAVED_ANTHROPIC === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = SAVED_ANTHROPIC; });

  const base = (inTok: number, outTok: number) => (inTok * 0.10 + outTok * 0.50) / 1_000_000;

  it("meter settlement: two 60K/1K dispatches (120K prompt tokens in total) settle at the base tier, one 120K dispatch at the tier", async () => {
    fakeTransport(() => anthropicAnswer(60_000, 1_000));
    const meter = createSpendMeter(10);
    const m = model(HAIKU, { dispatch: RECEIPT, meter });
    await m.next(TURN);
    await m.next(TURN);
    expect(meter.dispatches.map((d) => d.costUsd)).toEqual([base(60_000, 1_000), base(60_000, 1_000)]);
    expect(meter.spentUsd).toBeCloseTo(0.013, 9); // was $0.065 when the sum was tiered

    fakeTransport(() => anthropicAnswer(120_000, 2_000));
    const long = createSpendMeter(10);
    await model(HAIKU, { dispatch: RECEIPT, meter: long }).next(TURN);
    expect(long.spentUsd).toBeCloseTo((120_000 * 0.50 + 2_000 * 2.50) / 1_000_000, 9); // 0.065: a real 120K prompt IS tiered
  });

  it("ladder rung cost is the sum of its settled dispatches (two sub-100K requests are not billed as one 120K request)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ladder-tier-"));
    const argvBefore = process.argv;
    const exitBefore = process.exitCode;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = async (cap: string) => {
        const out = join(dir, `report-${cap}.json`);
        process.argv = ["node", "ladder.ts", "--real", HAIKU, "--levels=1-1", `--max-cost-usd=${cap}`, "--json-out", out];
        process.exitCode = undefined;
        const { main } = await import("./ladder");
        await main();
        process.exitCode = exitBefore;
        try { return JSON.parse(readFileSync(out, "utf8")) as Record<string, any>; } catch { return undefined; }
      };
      fakeTransport(() => anthropicAnswer(1, 1));
      const probe = await run("0.0001");
      const cap = String(Math.ceil(probe!.budget.estimateUsd * 1e4) / 1e4);
      // Step 1 asks for a tool, step 2 answers: exactly two dispatches of 60K/1K.
      fakeTransport((n) => anthropicAnswer(60_000, 1_000, n === 1));
      const report = await run(cap);
      expect(calls).toHaveLength(2);
      const row = report!.results[0];
      expect(row.dispatches.map((d: { costUsd: number }) => d.costUsd)).toEqual([base(60_000, 1_000), base(60_000, 1_000)]);
      expect(row.cost).toBeCloseTo(0.013, 9); // was $0.065
      expect(row.cost).toBeCloseTo(report!.budget.spentUsd, 9);
    } finally {
      process.argv = argvBefore;
      process.exitCode = exitBefore;
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

describe("pre-flight request ceiling follows the candidate limit the adapter enforces", () => {
  const shapes = [{ maxSteps: 3, ctxTokens0: 1_000, growthTokens: 0 }, { maxSteps: 2, ctxTokens0: 1_000, growthTokens: 0 }] as never;
  const SAVED_LIMIT = process.env.OPENROUTER_FREE_AUTO_LIMIT;
  afterEach(() => { if (SAVED_LIMIT === undefined) delete process.env.OPENROUTER_FREE_AUTO_LIMIT; else process.env.OPENROUTER_FREE_AUTO_LIMIT = SAVED_LIMIT; });

  it("a free-auto route multiplies by OPENROUTER_FREE_AUTO_LIMIT (default 8, max 20), a concrete route by 1", async () => {
    const { ladderRequestCeiling, estimateLadderUsd } = await import("./ladder");
    const steps = 3 + 2;
    delete process.env.OPENROUTER_FREE_AUTO_LIMIT;
    expect(ladderRequestCeiling([PRICED], shapes)).toBe(steps);
    expect(ladderRequestCeiling(["openrouter/free-auto"], shapes)).toBe(8 * steps); // Codex observed 8 requests for one step whose ceiling was 1
    expect(ladderRequestCeiling([PRICED, "openrouter/free-auto"], shapes)).toBe(steps + 8 * steps);
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "5";
    expect(ladderRequestCeiling(["openrouter/free-auto"], shapes)).toBe(5 * steps);
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "99";
    expect(ladderRequestCeiling(["openrouter/free-auto"], shapes)).toBe(20 * steps);
    expect(estimateLadderUsd(["openrouter/free-auto"], shapes)).toBe(0); // free route: any fan-out costs nothing
  });

  it("an alias of a free-auto route fans out like the route it resolves to (dispatch resolves aliases first)", async () => {
    const { ladderRequestCeiling, estimateLadderUsd } = await import("./ladder");
    const steps = 3 + 2;
    delete process.env.OPENROUTER_FREE_AUTO_LIMIT;
    // 'free' and 'openrouter-auto' used to get a ceiling of 1 step each while one model("free").next() issues up to 8 requests.
    for (const alias of ["free", "free-auto", "openrouter-auto", "openrouter-free-auto", "FREE", "nodeagent-auto", "nodeagent/free-auto"]) {
      expect(ladderRequestCeiling([alias], shapes), alias).toBe(8 * steps);
      if (!alias.startsWith("nodeagent")) expect(() => estimateLadderUsd([alias], shapes), alias).not.toThrow(); // nodeagent/free-auto has no price row: main() refuses it at pre-flight
    }
    expect(ladderRequestCeiling(["openrouter/free"], shapes), "the single-model meta route does not fan out").toBe(steps);
    expect(ladderRequestCeiling(["claude-sonnet"], shapes), "a concrete alias does not fan out").toBe(steps);
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "3";
    expect(ladderRequestCeiling(["free", PRICED], shapes)).toBe(3 * steps + steps);
  });

  it("an unknown route is refused by the ceiling and the estimate instead of being counted as one request (A.0.10)", async () => {
    const { ladderRequestCeiling, estimateLadderUsd } = await import("./ladder");
    expect(() => ladderRequestCeiling(["gemini-9-flash-unknown"], shapes)).toThrow(/unknown model id/);
    expect(() => estimateLadderUsd(["gemini-9-flash-unknown"], shapes)).toThrow(/unknown model id/);
  });
});
