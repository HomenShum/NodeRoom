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

  it("(b) the same outage under the default policy reserves once per attempt and never crosses the cap", async () => {
    vi.useFakeTimers();
    fakeTransport(() => unavailable());
    const meter = createSpendMeter(RESERVE * 2.5); // room for two reservations, not three
    const m = model(PRICED, { meter }); // default policy: 3 retries, fallback allowed (no AGENT_FALLBACK_MODEL set)

    const outcome = m.next(TURN).then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const error = await outcome;

    expect(error).toBeInstanceOf(SpendBudgetError);
    expect((error as SpendBudgetError).receipt.stopReason).toBe("spend_budget");
    expect(calls).toHaveLength(2); // the attempt whose reservation would cross the cap is never issued
    expect(meter.requests).toBe(2);
    expect(meter.spentUsd).toBeLessThanOrEqual(meter.maxUsd);
    expect(meter.stoppedBy).toBe("spend_budget");
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

  it("(e) a grid driven through the adapter stops before the cap; budget.requests equals the fetch count; a stop is not a receipt", async () => {
    // Every answer is a valid tool call (list_artifacts takes no arguments, so the loop keeps going) that bills ~$2.25
    // of input (3M tokens at $0.75/M), far above its reservation: the cap is crossed by settlement, and every later
    // dispatch must be refused instead of issued.
    const cap = 5;
    fakeTransport(() => {
      billedUsd += 2.25;
      return new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "list_artifacts", args: {} } }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 3_000_000, candidatesTokenCount: 10, totalTokenCount: 3_000_010 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    let issuedAfterCap = 0;
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => { if (billedUsd >= cap) issuedAfterCap += 1; return base(...args); });

    const { exitCode, report } = await runMain(["--real", PRICED, "--levels=1-4", `--max-cost-usd=${cap}`]);
    expect(calls.length).toBeGreaterThan(2); // the cap is crossed by settlement, not before the first answers
    expect(issuedAfterCap).toBe(0);
    expect(report?.budget.requests).toBe(calls.length);
    expect(report?.budget.stoppedBy).toBe("spend_budget");
    expect(report?.dispatchPolicy).toEqual(RECEIPT);
    expect(report?.testedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(exitCode).toBe(1);
  });
});
