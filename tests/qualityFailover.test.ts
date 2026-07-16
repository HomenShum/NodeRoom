import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  QualityFailoverController,
  QualityFailoverError,
  assessAgentToolTurnQuality,
  assessNonEmptyResult,
  classifyQualityFailoverProviderError,
  rejectTaskQuality,
  runQualityFailover,
  qualityFailoverRetryAt,
  type KnownTaskQualityFailureReason,
  type QualityFailoverCandidate,
} from "../src/nodeagent/models/qualityFailover";
import type { AgentTool } from "../src/nodeagent/core/types";

type Candidate = QualityFailoverCandidate & { response: string };

const candidate = (
  id: string,
  response = id,
  extra: Partial<QualityFailoverCandidate> = {},
): Candidate => ({ id, provider: "fake", response, ...extra });

describe("quality-aware bounded failover", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects schema-invalid, narrated-artifact, and redundant empty-read tool turns", () => {
    const readTool: AgentTool = {
      name: "read_range",
      description: "Read selected cells.",
      schema: z.object({ elementIds: z.array(z.string()).default([]), artifactId: z.string().optional() }),
      execute: async () => [],
    };
    const messages = [
      { role: "tool" as const, toolName: "list_artifacts", toolCallId: "list-1", content: JSON.stringify([{ id: "DCF" }, { id: "WACC" }]) },
      { role: "tool" as const, toolName: "inspect_workbook", toolCallId: "inspect-1", content: JSON.stringify({ ok: true, artifactId: "DCF" }) },
    ];

    expect(assessAgentToolTurnQuality({
      toolCalls: [{ tool: "read_range", args: { elementIds: "not-an-array", artifactId: "DCF" } }],
      tools: [readTool],
    })).toMatchObject({ ok: false, reason: "malformed_result" });
    expect(assessAgentToolTurnQuality({
      toolCalls: [{ tool: "read_range", args: { elementIds: [], artifactId: "DCF? Actually use the exact id" } }],
      tools: [readTool],
      messages,
    })).toMatchObject({ ok: false, reason: "malformed_result" });
    expect(assessAgentToolTurnQuality({
      toolCalls: [{ tool: "read_range", args: { elementIds: [], artifactId: "DCF" } }],
      tools: [readTool],
      messages,
    })).toMatchObject({ ok: false, reason: "incomplete_result" });
    expect(assessAgentToolTurnQuality({
      toolCalls: [{ tool: "read_range", args: { elementIds: ["I15"], artifactId: "DCF" } }],
      tools: [readTool],
      messages,
    })).toEqual({ ok: true });
  });

  it("rotates across every supported task-quality failure and accepts the first verified result", async () => {
    const reasons: KnownTaskQualityFailureReason[] = [
      "empty_result",
      "malformed_result",
      "preflight_rejected",
      "incomplete_result",
      "post_write_verification_failed",
    ];
    const candidates = [
      ...reasons.map((reason) => candidate(reason, reason)),
      candidate("verified", "complete and verified"),
    ];
    const execute = vi.fn(async (route: Candidate) => route.response);
    const observedOutcomes: string[] = [];

    const result = await runQualityFailover({
      candidates,
      budget: { maxAttempts: candidates.length },
      execute,
      assessResult: (response) => reasons.includes(response as KnownTaskQualityFailureReason)
        ? rejectTaskQuality(response, `${response} detail`)
        : { ok: true },
      onRouteAttempt: (attempt) => {
        observedOutcomes.push(attempt.outcome);
      },
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a verified route");
    expect(result.candidate.id).toBe("verified");
    expect(result.result).toBe("complete and verified");
    expect(execute.mock.calls.map(([route]) => route.id)).toEqual([
      ...reasons,
      "verified",
    ]);
    expect(result.receipt.routeAttempts.map((attempt) => ({
      outcome: attempt.outcome,
      decision: attempt.decision,
      reason: attempt.reason,
    }))).toEqual([
      ...reasons.map((reason) => ({ outcome: "quality_failure", decision: "rotate", reason })),
      { outcome: "accepted", decision: "accept", reason: "accepted" },
    ]);
    expect(observedOutcomes).toEqual([
      ...reasons.map(() => "quality_failure"),
      "accepted",
    ]);
    expect(result.receipt).toMatchObject({
      schema: "nodeagent-quality-failover-v1",
      policy: "bounded_quality_failover_v1",
      status: "succeeded",
      stopReason: "accepted",
      selectedRouteId: "verified",
      budget: { attemptsUsed: 6, attemptsRemaining: 0 },
    });
  });

  it("keeps transient provider failures separate from task-quality failures", async () => {
    const execute = vi.fn(async (route: Candidate) => {
      if (route.id === "provider-down") throw new Error("Provider request failed 503: overloaded");
      return route.response;
    });

    const result = await new QualityFailoverController({
      candidates: [
        candidate("provider-down"),
        candidate("bad-task", "malformed"),
        candidate("good-task", "valid"),
      ],
      budget: { maxAttempts: 3 },
      execute,
      assessResult: (response) => response === "malformed"
        ? rejectTaskQuality("malformed_result")
        : { ok: true },
      now: () => 2_000,
    }).run();

    expect(result.ok).toBe(true);
    expect(result.receipt.routeAttempts).toMatchObject([
      {
        routeId: "provider-down",
        outcome: "provider_failure",
        decision: "rotate",
        reason: "provider_transient_failure",
        providerFailureScope: "candidate",
        providerFailureCategory: "transient",
      },
      {
        routeId: "bad-task",
        outcome: "quality_failure",
        decision: "rotate",
        reason: "malformed_result",
      },
      {
        routeId: "good-task",
        outcome: "accepted",
        decision: "accept",
      },
    ]);
  });

  it.each([
    {
      label: "auth",
      error: new Error("Provider request failed 401: Unauthorized"),
      reason: "provider_auth_required",
      category: "auth",
    },
    {
      label: "quota",
      error: new Error('Provider request failed 429: {"error":{"message":"Rate limit exceeded: free-models-per-day-high-balance","metadata":{"headers":{"X-RateLimit-Remaining":"0"}}}}'),
      reason: "provider_free_quota_exhausted",
      category: "quota",
    },
    {
      label: "wrapped quota",
      error: new Error("AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded: free-models-per-day-high-balance."),
      reason: "provider_quota_exhausted",
      category: "quota",
    },
    {
      label: "policy",
      error: new Error("provider_route_blocked:provider_not_allowed"),
      reason: "provider_not_allowed",
      category: "policy",
    },
  ])("stops immediately on a global $label failure", async ({ error, reason, category }) => {
    const execute = vi.fn(async () => {
      throw error;
    });

    const result = await runQualityFailover({
      candidates: [candidate("first"), candidate("must-not-run")],
      budget: { maxAttempts: 2 },
      execute,
      now: () => 3_000,
    });

    expect(result.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.receipt).toMatchObject({
      status: "blocked",
      stopReason: "global_provider_failure",
      terminalFailure: {
        failureClass: "provider",
        reason,
        providerFailureScope: "global",
        providerFailureCategory: category,
      },
      routeAttempts: [{
        routeId: "first",
        outcome: "provider_failure",
        decision: "stop",
        reason,
      }],
    });
  });

  it("does not treat an ordinary route-specific 429 as global quota exhaustion", () => {
    expect(classifyQualityFailoverProviderError(new Error("Provider request failed 429: rate limited")))
      .toMatchObject({
        scope: "candidate",
        category: "transient",
        reason: "provider_transient_failure",
      });
  });

  it("skips cooling and unaffordable routes without consuming attempts or their spend", async () => {
    const execute = vi.fn(async (route: Candidate) => route.response);
    const result = await runQualityFailover({
      candidates: [
        candidate("cooling", "unused", { cooldownUntil: 2_000, estimatedCostUsd: 0.1 }),
        candidate("too-expensive", "unused", { estimatedCostUsd: 0.8 }),
        candidate("eligible", "accepted", { estimatedCostUsd: 0.2 }),
      ],
      budget: { maxAttempts: 1, maxCostUsd: 1, spentCostUsd: 0.6 },
      execute,
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    expect(execute.mock.calls.map(([route]) => route.id)).toEqual(["eligible"]);
    expect(result.receipt.skippedRoutes).toMatchObject([
      { routeId: "cooling", reason: "cooldown", cooldownUntil: 2_000 },
      { routeId: "too-expensive", reason: "spend_budget", estimatedCostUsd: 0.8 },
    ]);
    expect(result.receipt.budget).toMatchObject({
      maxAttempts: 1,
      attemptsUsed: 1,
      initialSpentCostUsd: 0.6,
      spentCostUsd: 0.8,
      remainingCostUsd: 0.2,
    });
  });

  it("charges rejected work and stops before the next route would exceed the enclosing spend cap", async () => {
    const execute = vi.fn(async (route: Candidate) => route.response);
    const result = await runQualityFailover({
      candidates: [
        candidate("incomplete", "partial", { estimatedCostUsd: 0.25 }),
        candidate("next", "complete", { estimatedCostUsd: 0.25 }),
      ],
      budget: { maxAttempts: 2, maxCostUsd: 0.7, spentCostUsd: 0.2 },
      execute,
      assessResult: (response) => response === "partial"
        ? rejectTaskQuality("incomplete_result")
        : { ok: true },
      measureCostUsd: () => 0.3,
      now: () => 4_000,
    });

    expect(result.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.receipt).toMatchObject({
      status: "blocked",
      stopReason: "spend_budget",
      routeAttempts: [{
        routeId: "incomplete",
        outcome: "quality_failure",
        costUsd: 0.3,
      }],
      skippedRoutes: [{ routeId: "next", reason: "spend_budget" }],
      budget: {
        attemptsUsed: 1,
        initialSpentCostUsd: 0.2,
        spentCostUsd: 0.5,
        remainingCostUsd: 0.2,
      },
    });
  });

  it("retains the pre-call reservation when measured provider cost is unavailable", async () => {
    const result = await runQualityFailover({
      candidates: [candidate("usage-missing", "accepted", { estimatedCostUsd: 0.25 })],
      budget: { maxAttempts: 1, maxCostUsd: 0.5 },
      execute: async (route) => route.response,
      measureCostUsd: () => undefined,
      now: () => 4_500,
    });

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      routeAttempts: [{
        routeId: "usage-missing",
        estimatedCostUsd: 0.25,
        costUsd: 0.25,
        outcome: "accepted",
      }],
      budget: { spentCostUsd: 0.25, remainingCostUsd: 0.25 },
    });
  });

  it("enforces the attempt ceiling before calling another candidate", async () => {
    const execute = vi.fn(async (route: Candidate) => route.response);
    const result = await runQualityFailover({
      candidates: [candidate("one"), candidate("two"), candidate("three")],
      budget: { maxAttempts: 2 },
      execute,
      assessResult: () => rejectTaskQuality("incomplete_result"),
      now: () => 5_000,
    });

    expect(result.ok).toBe(false);
    expect(execute.mock.calls.map(([route]) => route.id)).toEqual(["one", "two"]);
    expect(result.receipt.stopReason).toBe("attempt_budget");
    expect(result.receipt.budget).toMatchObject({ attemptsUsed: 2, attemptsRemaining: 0 });
  });

  it("returns a cooldown receipt with the earliest retry time when no route is available", async () => {
    const execute = vi.fn(async (route: Candidate) => route.response);
    const result = await runQualityFailover({
      candidates: [
        candidate("later", "unused", { cooldownUntil: 9_000 }),
        candidate("sooner", "unused", { cooldownUntil: 7_000 }),
      ],
      budget: { maxAttempts: 2 },
      execute,
      now: () => 6_000,
    });

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({
      status: "blocked",
      stopReason: "cooldown",
      retryAt: 7_000,
      budget: { attemptsUsed: 0 },
    });
    const wrapped = new Error("agent run failed", { cause: new QualityFailoverError("routes cooling", result.receipt) });
    expect(qualityFailoverRetryAt(wrapped)).toBe(7_000);
    expect(qualityFailoverRetryAt(new Error("unrelated"))).toBeUndefined();
  });

  it("honors caller cancellation before any route call", async () => {
    const abort = new AbortController();
    abort.abort();
    const execute = vi.fn(async (route: Candidate) => route.response);

    const result = await runQualityFailover({
      candidates: [candidate("unused")],
      budget: { maxAttempts: 1 },
      execute,
      signal: abort.signal,
      now: () => 7_000,
    });

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipt.stopReason).toBe("aborted");
  });

  it("rotates after a provider failure and a hung candidate, then accepts a later route", async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async (route: Candidate) => {
      if (route.id === "provider-down") throw new Error("Provider request failed 503: unavailable");
      if (route.id === "hung") return new Promise<string>(() => undefined);
      return route.response;
    });
    const pending = runQualityFailover({
      candidates: [candidate("provider-down"), candidate("hung"), candidate("fast", "done")],
      budget: { maxAttempts: 3 },
      attemptTimeoutMs: 25,
      execute,
      now: () => 8_000,
    });

    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(execute.mock.calls.map(([route]) => route.id)).toEqual(["provider-down", "hung", "fast"]);
    expect(result.receipt.routeAttempts).toMatchObject([
      {
        routeId: "provider-down",
        outcome: "provider_failure",
        decision: "rotate",
        reason: "provider_transient_failure",
      },
      {
        routeId: "hung",
        outcome: "provider_failure",
        decision: "rotate",
        reason: "candidate_timeout",
      },
      { routeId: "fast", outcome: "accepted" },
    ]);
  });

  it("captures usage that an aborted provider attaches while settling the timeout", async () => {
    vi.useFakeTimers();
    const onRouteAttempt = vi.fn();
    const pending = runQualityFailover({
      candidates: [candidate("partial-timeout")],
      budget: { maxAttempts: 1 },
      attemptTimeoutMs: 25,
      execute: async (_route, context) => new Promise<string>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          setTimeout(() => reject(Object.assign(new Error("aborted after partial usage"), {
            usage: { inputTokens: 19, outputTokens: 4, modelCalls: 1, costUsd: 0.125, costKind: "exact" },
          })), 5);
        }, { once: true });
      }),
      measureCostUsd: ({ error }) => Number((error as { usage?: { costUsd?: number } } | undefined)?.usage?.costUsd ?? 0),
      onRouteAttempt,
      now: () => 9_000,
    });

    await vi.advanceTimersByTimeAsync(30);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.receipt).toMatchObject({
      stopReason: "candidates_exhausted",
      budget: { spentCostUsd: 0.125 },
      routeAttempts: [{ routeId: "partial-timeout", reason: "candidate_timeout", costUsd: 0.125 }],
    });
    expect(onRouteAttempt).toHaveBeenCalledTimes(1);
  });

  it("uses the default non-empty quality floor without a provider", () => {
    expect(assessNonEmptyResult(undefined)).toEqual({ ok: false, reason: "empty_result" });
    expect(assessNonEmptyResult("   ")).toEqual({ ok: false, reason: "empty_result" });
    expect(assessNonEmptyResult([])).toEqual({ ok: false, reason: "empty_result" });
    expect(assessNonEmptyResult({ text: "" })).toEqual({ ok: true });
  });
});
