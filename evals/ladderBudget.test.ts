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
  priceRunStrict,
  requestInputTokenUpperBound,
  reserveDispatch,
  SpendBudgetError,
  UnpricedModelError,
  type DispatchPolicy,
} from "../src/nodeagent/models/adapter";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";

const PRICED = "gemini-3.8-flash";
const UNPRICED = "gemini-9.9-unpriced-test"; // routes to the Google provider, has no pricing row
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
    expect(meter.spentUsd).toBeCloseTo(priceRunStrict(PRICED, 1_000, 200), 12); // reservation replaced by the priced usage

    await expect(m.next(TURN)).rejects.toThrow(/ECONNRESET/);
    expect(calls).toHaveLength(2); // maxRetries 0: no retry, no SDK retry, no fallback
    expect(meter.requests).toBe(2);
    expect(meter.spentUsd).toBeCloseTo(priceRunStrict(PRICED, 1_000, 200) + RESERVE, 12); // the failed dispatch's reservation is retained
  });

  it("(b) the same sequence (charged response, then ECONNRESET) under the default policy reserves once per attempt and never crosses the cap", async () => {
    vi.useFakeTimers();
    fakeTransport((n) => {
      if (n === 1) return ok(1_000, 200);
      throw Object.assign(new Error("fetch failed: ECONNRESET"), { code: "ECONNRESET" }); // transient: the default policy retries it
    });
    const first = priceRunStrict(PRICED, 1_000, 200);
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
      costUsd: priceRunStrict(PRICED, 1_000, 200),
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
      const error = await model(UNPRICED, { dispatch: RECEIPT, meter }).next(TURN).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(UnpricedModelError);
      expect((error as UnpricedModelError).receipt.stopReason).toBe("spend_budget");
      expect(meter.requests).toBe(0);
      expect(meter.spentUsd).toBe(0);
      expect(meter.stoppedBy).toBe("unpriced_model");
    }
    expect(calls).toHaveLength(0);
  });

  it("a priced primary answering four 503s with an unpriced AGENT_FALLBACK_MODEL makes the primary's four requests and none for the fallback", async () => {
    vi.useFakeTimers();
    process.env.AGENT_FALLBACK_MODEL = UNPRICED;
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
    const error = await model(UNPRICED, { meter }).next(TURN).then(() => null, (e: unknown) => e); // default policy: fallback allowed
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
    fakeTransport(() => ok());
    const step = await model(UNPRICED).next(TURN); // no meter: legacy callers are not budget-gated
    expect(step.text).toBe("ok");
    expect(calls).toHaveLength(1);
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
      billedUsd += priceRunStrict(PRICED, tokens, 50);
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
  });

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
});
