import { providerNonRetryableReason } from "../guardrails/egressPolicy";
import type { AgentMessage, AgentTool, ToolCall } from "../core/types";

export const QUALITY_FAILOVER_SCHEMA = "nodeagent-quality-failover-v1" as const;
export const QUALITY_FAILOVER_POLICY = "bounded_quality_failover_v1" as const;

export type KnownTaskQualityFailureReason =
  | "empty_result"
  | "malformed_result"
  | "preflight_rejected"
  | "incomplete_result"
  | "post_write_verification_failed";

export type TaskQualityFailureReason = KnownTaskQualityFailureReason | (string & {});

export type TaskQualityAssessment =
  | { ok: true; detail?: string }
  | { ok: false; reason: TaskQualityFailureReason; detail?: string };

export type ProviderFailureScope = "candidate" | "global";
export type ProviderFailureCategory = "auth" | "quota" | "policy" | "transient" | "unknown";

export interface ProviderFailureClassification {
  scope: ProviderFailureScope;
  category: ProviderFailureCategory;
  reason: string;
  detail?: string;
}

export interface QualityFailoverCandidate {
  /** Stable model/route identifier written to the receipt. */
  id: string;
  provider?: string;
  /** Existing route-health cooldown. A skipped route does not consume attempt or spend budget. */
  cooldownUntil?: number;
  /** Conservative pre-call reservation. It is charged unless measureCostUsd overrides it. */
  estimatedCostUsd?: number;
}

export interface QualityFailoverBudget {
  /** Hard ceiling across actual calls. Cooldown and spend skips do not consume it. */
  maxAttempts: number;
  maxCostUsd?: number;
  /** Spend already consumed by the enclosing benchmark/job. */
  spentCostUsd?: number;
  deadlineAt?: number;
  /** Time reserved for the caller to persist a handoff/receipt after routing stops. */
  reserveMs?: number;
}

export interface QualityFailoverBudgetSnapshot {
  maxAttempts: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  initialSpentCostUsd: number;
  spentCostUsd: number;
  maxCostUsd?: number;
  remainingCostUsd?: number;
  overBudgetByCostUsd?: number;
  deadlineAt?: number;
  reserveMs: number;
}

export interface QualityFailoverAttemptContext<TCandidate extends QualityFailoverCandidate> {
  candidate: TCandidate;
  candidateIndex: number;
  attempt: number;
  signal: AbortSignal;
  budget: QualityFailoverBudgetSnapshot;
}

export type QualityFailoverAttemptOutcome =
  | "accepted"
  | "provider_failure"
  | "quality_failure"
  | "control_failure"
  | "aborted";

export type QualityFailoverAttemptDecision = "accept" | "rotate" | "stop";

export interface QualityFailoverRouteAttemptReceipt {
  attempt: number;
  candidateIndex: number;
  routeId: string;
  provider?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  estimatedCostUsd: number;
  costUsd: number;
  outcome: QualityFailoverAttemptOutcome;
  decision: QualityFailoverAttemptDecision;
  reason: string;
  detail?: string;
  providerFailureScope?: ProviderFailureScope;
  providerFailureCategory?: ProviderFailureCategory;
}

export type QualityFailoverSkipReason = "cooldown" | "spend_budget";

export interface QualityFailoverSkippedRouteReceipt {
  candidateIndex: number;
  routeId: string;
  provider?: string;
  reason: QualityFailoverSkipReason;
  cooldownUntil?: number;
  estimatedCostUsd?: number;
  detail: string;
}

export type QualityFailoverStopReason =
  | "accepted"
  | "no_candidates"
  | "candidates_exhausted"
  | "attempt_budget"
  | "spend_budget"
  | "time_budget"
  | "cooldown"
  | "aborted"
  | "global_provider_failure"
  | "quality_assessment_error";

export interface QualityFailoverTerminalFailure {
  failureClass: "provider" | "task_quality" | "control";
  reason: string;
  detail?: string;
  providerFailureScope?: ProviderFailureScope;
  providerFailureCategory?: ProviderFailureCategory;
}

export interface QualityFailoverReceipt {
  schema: typeof QUALITY_FAILOVER_SCHEMA;
  policy: typeof QUALITY_FAILOVER_POLICY;
  status: "succeeded" | "exhausted" | "blocked";
  stopReason: QualityFailoverStopReason;
  startedAt: number;
  completedAt: number;
  selectedRouteId?: string;
  retryAt?: number;
  routeAttempts: QualityFailoverRouteAttemptReceipt[];
  skippedRoutes: QualityFailoverSkippedRouteReceipt[];
  terminalFailure?: QualityFailoverTerminalFailure;
  budget: QualityFailoverBudgetSnapshot;
}

export class QualityFailoverError extends Error {
  constructor(
    message: string,
    readonly receipt: QualityFailoverReceipt,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "QualityFailoverError";
  }
}

export type QualityFailoverResult<TResult, TCandidate extends QualityFailoverCandidate> =
  | {
      ok: true;
      result: TResult;
      candidate: TCandidate;
      receipt: QualityFailoverReceipt;
    }
  | {
      ok: false;
      receipt: QualityFailoverReceipt;
      lastError?: unknown;
      lastResult?: TResult;
    };

export interface QualityFailoverCostContext<
  TCandidate extends QualityFailoverCandidate,
  TResult,
> {
  candidate: TCandidate;
  attempt: number;
  estimatedCostUsd: number;
  result?: TResult;
  error?: unknown;
  assessment?: TaskQualityAssessment;
}

export interface QualityFailoverOptions<
  TCandidate extends QualityFailoverCandidate,
  TResult,
> {
  candidates: readonly TCandidate[];
  budget: QualityFailoverBudget;
  /** Thrown errors are provider-call failures. Task-quality failures belong in assessResult. */
  execute: (
    candidate: TCandidate,
    context: QualityFailoverAttemptContext<TCandidate>,
  ) => Promise<TResult>;
  assessResult?: (
    result: TResult,
    context: QualityFailoverAttemptContext<TCandidate>,
  ) => TaskQualityAssessment | Promise<TaskQualityAssessment>;
  classifyProviderFailure?: (
    error: unknown,
    candidate: TCandidate,
  ) => ProviderFailureClassification;
  estimateCostUsd?: (candidate: TCandidate) => number;
  measureCostUsd?: (
    context: QualityFailoverCostContext<TCandidate, TResult>,
  ) => number;
  /** Receives provider and task-quality outcomes separately; use it to update existing health ledgers. */
  onRouteAttempt?: (
    attempt: Readonly<QualityFailoverRouteAttemptReceipt>,
    candidate: TCandidate,
  ) => void | Promise<void>;
  /** Optional per-route ceiling. The global deadline remains authoritative. */
  attemptTimeoutMs?: number | ((candidate: TCandidate) => number | undefined);
  signal?: AbortSignal;
  now?: () => number;
}

type AttemptWork<TResult> =
  | { kind: "assessed"; result: TResult; assessment: TaskQualityAssessment }
  | { kind: "provider_error"; error: unknown }
  | { kind: "assessment_error"; result: TResult; error: unknown };

type AttemptInterruptCause = "parent" | "time_budget" | "attempt_timeout";

class AttemptInterruptedError extends Error {
  constructor(readonly cause: AttemptInterruptCause) {
    super(cause);
    this.name = "AttemptInterruptedError";
  }
}

/** Default quality floor: nullish, blank-string, and empty-array results rotate. */
export function assessNonEmptyResult(result: unknown): TaskQualityAssessment {
  if (result === null || result === undefined) return rejectTaskQuality("empty_result");
  if (typeof result === "string" && result.trim().length === 0) return rejectTaskQuality("empty_result");
  if (Array.isArray(result) && result.length === 0) return rejectTaskQuality("empty_result");
  return { ok: true };
}

export function assessAgentToolTurnQuality(args: {
  text?: string;
  toolCalls: Array<Pick<ToolCall, "tool" | "args">>;
  tools: AgentTool[];
  messages?: AgentMessage[];
  requiredToolCall?: boolean;
}): TaskQualityAssessment {
  const text = args.text?.trim() ?? "";
  if (args.requiredToolCall && args.toolCalls.length === 0) {
    return rejectTaskQuality("incomplete_result", "runtime required a tool call but the route returned prose only");
  }
  if (args.toolCalls.length === 0) {
    return text ? { ok: true } : rejectTaskQuality("empty_result", "route returned neither text nor tool calls");
  }

  const tools = new Map(args.tools.map((tool) => [tool.name, tool]));
  const knownArtifacts = knownArtifactIds(args.messages ?? []);
  const emptyReadsInTurn = args.toolCalls.filter((call) =>
    call.tool === "read_range" && Array.isArray(asQualityRecord(call.args)?.elementIds)
      && (asQualityRecord(call.args)?.elementIds as unknown[]).length === 0).length;

  for (const call of args.toolCalls) {
    const tool = tools.get(call.tool);
    if (!tool) return rejectTaskQuality("malformed_result", `route called unknown tool ${call.tool}`);
    const rawArgs = (call as Pick<ToolCall, "tool"> & { args: unknown }).args;
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return rejectTaskQuality(
        "malformed_result",
        `${call.tool} arguments failed schema validation${issue ? ` at ${issue.path.join(".") || "root"}: ${issue.message}` : ""}`,
      );
    }
    const record = asQualityRecord(parsed.data) ?? {};
    const artifactId = typeof record.artifactId === "string" ? record.artifactId : undefined;
    if (artifactId && looksLikeArgumentNarration(artifactId)) {
      return rejectTaskQuality("malformed_result", `${call.tool} artifactId contains provider planning prose`);
    }
    if (artifactId && knownArtifacts.size > 0 && !knownArtifacts.has(artifactId.trim().toLowerCase())) {
      return rejectTaskQuality("malformed_result", `${call.tool} artifactId does not match a listed room artifact`);
    }
    if (call.tool === "read_range") {
      const elementIds = Array.isArray(record.elementIds) ? record.elementIds : [];
      if (elementIds.length === 0 && (
        emptyReadsInTurn > 1
        || hasPriorFocusedWorkbookContext(args.messages ?? [], artifactId)
      )) {
        return rejectTaskQuality(
          "incomplete_result",
          "read_range omitted elementIds after the same workbook artifact was already inspected or read",
        );
      }
    }
  }
  return { ok: true };
}

function asQualityRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function looksLikeArgumentNarration(value: string): boolean {
  return /[\r\n]|\b(?:actually|wait|let(?:'s| us)|need to|we (?:can|need|should)|separate calls?|the exact (?:id|artifact))\b/i.test(value);
}

function knownArtifactIds(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool" || message.toolName !== "list_artifacts") continue;
    try {
      const result = JSON.parse(message.content) as unknown;
      const record = asQualityRecord(result);
      const artifacts = Array.isArray(result) ? result : Array.isArray(record?.artifacts) ? record.artifacts : [];
      for (const artifact of artifacts) {
        const id = asQualityRecord(artifact)?.id;
        if (typeof id === "string" && id.trim()) ids.add(id.trim().toLowerCase());
      }
    } catch {
      // A malformed list result cannot establish an artifact allowlist.
    }
  }
  return ids;
}

function hasPriorFocusedWorkbookContext(messages: AgentMessage[], artifactId?: string): boolean {
  const target = artifactId?.trim().toLowerCase();
  for (const message of messages) {
    if (message.role === "tool" && message.toolName === "inspect_workbook") {
      try {
        const result = asQualityRecord(JSON.parse(message.content));
        const inspected = typeof result?.artifactId === "string" ? result.artifactId.trim().toLowerCase() : undefined;
        if (!target || inspected === target) return true;
      } catch {
        // Ignore malformed historical results.
      }
    }
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (call.tool !== "read_range") continue;
      const record = asQualityRecord(call.args);
      const priorArtifact = typeof record?.artifactId === "string" ? record.artifactId.trim().toLowerCase() : undefined;
      const priorIds = Array.isArray(record?.elementIds) ? record.elementIds : [];
      if (priorIds.length > 0 && (!target || priorArtifact === target)) return true;
    }
  }
  return false;
}

export function rejectTaskQuality(
  reason: TaskQualityFailureReason,
  detail?: string,
): TaskQualityAssessment {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new TypeError("Task-quality rejection requires a non-empty reason");
  return {
    ok: false,
    reason: normalizedReason,
    ...(detail ? { detail: shortDetail(detail) } : {}),
  };
}

/** Default provider classifier. Ordinary 429/5xx/network failures rotate; global gates stop. */
export function classifyQualityFailoverProviderError(error: unknown): ProviderFailureClassification {
  const detail = shortError(error);
  const nonRetryable = providerNonRetryableReason(error);
  if (nonRetryable) {
    if (/auth/i.test(nonRetryable)) return globalProviderFailure("auth", nonRetryable, detail);
    if (/quota|credit/i.test(nonRetryable)) return globalProviderFailure("quota", nonRetryable, detail);
    return globalProviderFailure("policy", nonRetryable, detail);
  }

  if (/\b(?:401|unauthori[sz]ed|invalid api key|authentication required)\b/i.test(detail)) {
    return globalProviderFailure("auth", "provider_auth_required", detail);
  }
  if (/\b(?:402|insufficient credits?|(?:daily|monthly|global)?\s*quota (?:exhausted|exceeded))\b/i.test(detail)) {
    return globalProviderFailure("quota", "provider_quota_exhausted", detail);
  }
  if (/\b(?:403|forbidden|content policy|policy violation|provider_(?:egress|route)_blocked)\b/i.test(detail)) {
    return globalProviderFailure("policy", "provider_policy_blocked", detail);
  }
  if (/\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable/i.test(detail)) {
    return { scope: "candidate", category: "transient", reason: "provider_transient_failure", detail };
  }
  return { scope: "candidate", category: "unknown", reason: "provider_failure", detail };
}

export class QualityFailoverController<
  TCandidate extends QualityFailoverCandidate,
  TResult,
> {
  constructor(private readonly options: QualityFailoverOptions<TCandidate, TResult>) {}

  run(): Promise<QualityFailoverResult<TResult, TCandidate>> {
    return runQualityFailover(this.options);
  }
}

export async function runQualityFailover<
  TCandidate extends QualityFailoverCandidate,
  TResult,
>(
  options: QualityFailoverOptions<TCandidate, TResult>,
): Promise<QualityFailoverResult<TResult, TCandidate>> {
  const config = validateOptions(options);
  const now = options.now ?? Date.now;
  const startedAt = readNow(now);
  const routeAttempts: QualityFailoverRouteAttemptReceipt[] = [];
  const skippedRoutes: QualityFailoverSkippedRouteReceipt[] = [];
  let spentCostUsd = config.initialSpentCostUsd;
  let lastError: unknown;
  let lastResult: TResult | undefined;
  let lastFailure: QualityFailoverTerminalFailure | undefined;

  const budgetSnapshot = (): QualityFailoverBudgetSnapshot => {
    const remainingCostUsd = config.maxCostUsd === undefined
      ? undefined
      : stableCost(Math.max(0, config.maxCostUsd - spentCostUsd));
    const overBudgetByCostUsd = config.maxCostUsd === undefined
      ? undefined
      : stableCost(Math.max(0, spentCostUsd - config.maxCostUsd));
    return {
      maxAttempts: config.maxAttempts,
      attemptsUsed: routeAttempts.length,
      attemptsRemaining: Math.max(0, config.maxAttempts - routeAttempts.length),
      initialSpentCostUsd: config.initialSpentCostUsd,
      spentCostUsd: stableCost(spentCostUsd),
      ...(config.maxCostUsd === undefined ? {} : { maxCostUsd: config.maxCostUsd }),
      ...(remainingCostUsd === undefined ? {} : { remainingCostUsd }),
      ...(overBudgetByCostUsd && overBudgetByCostUsd > 0 ? { overBudgetByCostUsd } : {}),
      ...(config.deadlineAt === undefined ? {} : { deadlineAt: config.deadlineAt }),
      reserveMs: config.reserveMs,
    };
  };

  const receipt = (
    status: QualityFailoverReceipt["status"],
    stopReason: QualityFailoverStopReason,
    args: {
      selectedRouteId?: string;
      terminalFailure?: QualityFailoverTerminalFailure;
      retryAt?: number;
    } = {},
  ): QualityFailoverReceipt => ({
    schema: QUALITY_FAILOVER_SCHEMA,
    policy: QUALITY_FAILOVER_POLICY,
    status,
    stopReason,
    startedAt,
    completedAt: readNow(now),
    ...(args.selectedRouteId ? { selectedRouteId: args.selectedRouteId } : {}),
    ...(args.retryAt === undefined ? {} : { retryAt: args.retryAt }),
    routeAttempts: [...routeAttempts],
    skippedRoutes: [...skippedRoutes],
    ...(args.terminalFailure ? { terminalFailure: args.terminalFailure } : {}),
    budget: budgetSnapshot(),
  });

  const failed = (
    status: QualityFailoverReceipt["status"],
    stopReason: QualityFailoverStopReason,
    terminalFailure?: QualityFailoverTerminalFailure,
    retryAt?: number,
  ): QualityFailoverResult<TResult, TCandidate> => ({
    ok: false,
    receipt: receipt(status, stopReason, { terminalFailure, retryAt }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(lastResult === undefined ? {} : { lastResult }),
  });

  if (options.candidates.length === 0) {
    return failed("exhausted", "no_candidates", controlFailure("no_candidates"));
  }
  if (config.maxAttempts === 0) {
    return failed("blocked", "attempt_budget", controlFailure("attempt_budget_exhausted"));
  }
  if (options.signal?.aborted) {
    return failed("blocked", "aborted", controlFailure("aborted"));
  }
  if (timeBudgetExhausted(config, startedAt)) {
    return failed("blocked", "time_budget", controlFailure("time_budget_exhausted"));
  }
  if (config.maxCostUsd !== undefined && exceedsBudget(spentCostUsd, config.maxCostUsd)) {
    return failed("blocked", "spend_budget", controlFailure("spend_budget_exhausted"));
  }

  for (let candidateIndex = 0; candidateIndex < options.candidates.length; candidateIndex += 1) {
    const candidate = options.candidates[candidateIndex];
    if (routeAttempts.length >= config.maxAttempts) {
      return failed("blocked", "attempt_budget", controlFailure("attempt_budget_exhausted"));
    }

    const candidateNow = readNow(now);
    if (options.signal?.aborted) {
      return failed("blocked", "aborted", controlFailure("aborted"));
    }
    if (timeBudgetExhausted(config, candidateNow)) {
      return failed("blocked", "time_budget", controlFailure("time_budget_exhausted"));
    }
    if (config.maxCostUsd !== undefined && exceedsBudget(spentCostUsd, config.maxCostUsd)) {
      return failed("blocked", "spend_budget", controlFailure("spend_budget_exhausted"));
    }
    if ((candidate.cooldownUntil ?? 0) > candidateNow) {
      skippedRoutes.push({
        candidateIndex,
        routeId: candidate.id,
        ...(candidate.provider ? { provider: candidate.provider } : {}),
        reason: "cooldown",
        cooldownUntil: candidate.cooldownUntil,
        detail: `route cooling down until ${candidate.cooldownUntil}`,
      });
      continue;
    }

    const estimatedCostUsd = estimateCost(options, candidate);
    if (
      config.maxCostUsd !== undefined
      && exceedsBudget(spentCostUsd + estimatedCostUsd, config.maxCostUsd)
    ) {
      skippedRoutes.push({
        candidateIndex,
        routeId: candidate.id,
        ...(candidate.provider ? { provider: candidate.provider } : {}),
        reason: "spend_budget",
        estimatedCostUsd,
        detail: `estimated cost ${estimatedCostUsd} would exceed remaining budget ${Math.max(0, config.maxCostUsd - spentCostUsd)}`,
      });
      continue;
    }

    const attempt = routeAttempts.length + 1;
    const attemptStartedAt = readNow(now);
    const scope = createAttemptScope({
      parent: options.signal,
      globalRemainingMs: config.effectiveDeadlineAt === undefined
        ? undefined
        : Math.max(0, config.effectiveDeadlineAt - attemptStartedAt),
      attemptTimeoutMs: readAttemptTimeout(options.attemptTimeoutMs, candidate),
    });
    const context: QualityFailoverAttemptContext<TCandidate> = {
      candidate,
      candidateIndex,
      attempt,
      signal: scope.signal,
      budget: budgetSnapshot(),
    };

    const work: Promise<AttemptWork<TResult>> = (async () => {
      let result: TResult;
      try {
        result = await options.execute(candidate, context);
      } catch (error) {
        return { kind: "provider_error", error };
      }
      if (context.signal.aborted) {
        return { kind: "provider_error", error: context.signal.reason ?? new Error("aborted") };
      }
      try {
        const assessment = options.assessResult
          ? await options.assessResult(result, context)
          : assessNonEmptyResult(result);
        return { kind: "assessed", result, assessment: validateAssessment(assessment) };
      } catch (error) {
        return { kind: "assessment_error", result, error };
      }
    })();

    let outcome: AttemptWork<TResult>;
    try {
      outcome = await scope.wait(work);
    } catch (error) {
      scope.dispose();
      if (!(error instanceof AttemptInterruptedError)) throw error;

      const costUsd = measureCost(options, {
        candidate,
        attempt,
        estimatedCostUsd,
        error,
      });
      spentCostUsd = stableCost(spentCostUsd + costUsd);
      if (error.cause === "attempt_timeout") {
        const providerFailure: ProviderFailureClassification = {
          scope: "candidate",
          category: "transient",
          reason: "candidate_timeout",
          detail: "candidate attempt exceeded its timeout",
        };
        const attemptReceipt = makeAttemptReceipt({
          candidate,
          candidateIndex,
          attempt,
          startedAt: attemptStartedAt,
          completedAt: readNow(now),
          estimatedCostUsd,
          costUsd,
          outcome: "provider_failure",
          decision: "rotate",
          reason: providerFailure.reason,
          detail: providerFailure.detail,
          providerFailure,
        });
        routeAttempts.push(attemptReceipt);
        await options.onRouteAttempt?.(attemptReceipt, candidate);
        lastError = error;
        lastFailure = providerTerminalFailure(providerFailure);
        continue;
      }

      const stopReason = error.cause === "parent" ? "aborted" : "time_budget";
      const reason = error.cause === "parent" ? "aborted" : "time_budget_exhausted";
      const attemptReceipt = makeAttemptReceipt({
        candidate,
        candidateIndex,
        attempt,
        startedAt: attemptStartedAt,
        completedAt: readNow(now),
        estimatedCostUsd,
        costUsd,
        outcome: "aborted",
        decision: "stop",
        reason,
      });
      routeAttempts.push(attemptReceipt);
      await options.onRouteAttempt?.(attemptReceipt, candidate);
      lastError = error;
      return failed("blocked", stopReason, controlFailure(reason));
    }
    scope.dispose();

    if (outcome.kind === "provider_error") {
      const providerFailure = classifyProviderFailure(options, outcome.error, candidate);
      const costUsd = measureCost(options, {
        candidate,
        attempt,
        estimatedCostUsd,
        error: outcome.error,
      });
      spentCostUsd = stableCost(spentCostUsd + costUsd);
      const decision: QualityFailoverAttemptDecision = providerFailure.scope === "global" ? "stop" : "rotate";
      const attemptReceipt = makeAttemptReceipt({
        candidate,
        candidateIndex,
        attempt,
        startedAt: attemptStartedAt,
        completedAt: readNow(now),
        estimatedCostUsd,
        costUsd,
        outcome: "provider_failure",
        decision,
        reason: providerFailure.reason,
        detail: providerFailure.detail,
        providerFailure,
      });
      routeAttempts.push(attemptReceipt);
      await options.onRouteAttempt?.(attemptReceipt, candidate);
      lastError = outcome.error;
      lastFailure = providerTerminalFailure(providerFailure);
      if (providerFailure.scope === "global") {
        return failed("blocked", "global_provider_failure", lastFailure);
      }
      continue;
    }

    if (outcome.kind === "assessment_error") {
      const costUsd = measureCost(options, {
        candidate,
        attempt,
        estimatedCostUsd,
        result: outcome.result,
        error: outcome.error,
      });
      spentCostUsd = stableCost(spentCostUsd + costUsd);
      const detail = shortError(outcome.error);
      const attemptReceipt = makeAttemptReceipt({
        candidate,
        candidateIndex,
        attempt,
        startedAt: attemptStartedAt,
        completedAt: readNow(now),
        estimatedCostUsd,
        costUsd,
        outcome: "control_failure",
        decision: "stop",
        reason: "quality_assessment_error",
        detail,
      });
      routeAttempts.push(attemptReceipt);
      await options.onRouteAttempt?.(attemptReceipt, candidate);
      lastError = outcome.error;
      lastResult = outcome.result;
      return failed(
        "blocked",
        "quality_assessment_error",
        controlFailure("quality_assessment_error", detail),
      );
    }

    const costUsd = measureCost(options, {
      candidate,
      attempt,
      estimatedCostUsd,
      result: outcome.result,
      assessment: outcome.assessment,
    });
    spentCostUsd = stableCost(spentCostUsd + costUsd);
    if (!outcome.assessment.ok) {
      const detail = outcome.assessment.detail ? shortDetail(outcome.assessment.detail) : undefined;
      const attemptReceipt = makeAttemptReceipt({
        candidate,
        candidateIndex,
        attempt,
        startedAt: attemptStartedAt,
        completedAt: readNow(now),
        estimatedCostUsd,
        costUsd,
        outcome: "quality_failure",
        decision: "rotate",
        reason: outcome.assessment.reason,
        detail,
      });
      routeAttempts.push(attemptReceipt);
      await options.onRouteAttempt?.(attemptReceipt, candidate);
      lastResult = outcome.result;
      lastFailure = {
        failureClass: "task_quality",
        reason: outcome.assessment.reason,
        ...(detail ? { detail } : {}),
      };
      continue;
    }

    const attemptReceipt = makeAttemptReceipt({
      candidate,
      candidateIndex,
      attempt,
      startedAt: attemptStartedAt,
      completedAt: readNow(now),
      estimatedCostUsd,
      costUsd,
      outcome: "accepted",
      decision: "accept",
      reason: "accepted",
      detail: outcome.assessment.detail,
    });
    routeAttempts.push(attemptReceipt);
    await options.onRouteAttempt?.(attemptReceipt, candidate);
    return {
      ok: true,
      result: outcome.result,
      candidate,
      receipt: receipt("succeeded", "accepted", { selectedRouteId: candidate.id }),
    };
  }

  const budgetSkips = skippedRoutes.filter((route) => route.reason === "spend_budget");
  if (budgetSkips.length > 0) {
    return failed("blocked", "spend_budget", controlFailure("spend_budget_exhausted"));
  }
  const cooldownSkips = skippedRoutes.filter((route) => route.reason === "cooldown");
  if (cooldownSkips.length > 0) {
    const retryAt = Math.min(...cooldownSkips.map((route) => route.cooldownUntil ?? Number.POSITIVE_INFINITY));
    return failed(
      "blocked",
      "cooldown",
      controlFailure("all_available_candidates_cooling_down"),
      Number.isFinite(retryAt) ? retryAt : undefined,
    );
  }
  return failed("exhausted", "candidates_exhausted", lastFailure ?? controlFailure("candidates_exhausted"));
}

function validateOptions<TCandidate extends QualityFailoverCandidate, TResult>(
  options: QualityFailoverOptions<TCandidate, TResult>,
): {
  maxAttempts: number;
  initialSpentCostUsd: number;
  maxCostUsd?: number;
  deadlineAt?: number;
  reserveMs: number;
  effectiveDeadlineAt?: number;
} {
  assertNonNegativeInteger(options.budget.maxAttempts, "budget.maxAttempts");
  const initialSpentCostUsd = options.budget.spentCostUsd ?? 0;
  assertNonNegativeFinite(initialSpentCostUsd, "budget.spentCostUsd");
  if (options.budget.maxCostUsd !== undefined) {
    assertNonNegativeFinite(options.budget.maxCostUsd, "budget.maxCostUsd");
  }
  if (options.budget.deadlineAt !== undefined) {
    assertNonNegativeFinite(options.budget.deadlineAt, "budget.deadlineAt");
  }
  const reserveMs = options.budget.reserveMs ?? 0;
  assertNonNegativeFinite(reserveMs, "budget.reserveMs");
  for (const [index, candidate] of options.candidates.entries()) {
    if (!candidate.id.trim()) throw new TypeError(`candidates[${index}].id must be non-empty`);
    if (candidate.cooldownUntil !== undefined) {
      assertNonNegativeFinite(candidate.cooldownUntil, `candidates[${index}].cooldownUntil`);
    }
    if (candidate.estimatedCostUsd !== undefined) {
      assertNonNegativeFinite(candidate.estimatedCostUsd, `candidates[${index}].estimatedCostUsd`);
    }
  }
  return {
    maxAttempts: options.budget.maxAttempts,
    initialSpentCostUsd,
    ...(options.budget.maxCostUsd === undefined ? {} : { maxCostUsd: options.budget.maxCostUsd }),
    ...(options.budget.deadlineAt === undefined ? {} : { deadlineAt: options.budget.deadlineAt }),
    reserveMs,
    ...(options.budget.deadlineAt === undefined
      ? {}
      : { effectiveDeadlineAt: options.budget.deadlineAt - reserveMs }),
  };
}

function validateAssessment(assessment: TaskQualityAssessment): TaskQualityAssessment {
  if (!assessment || typeof assessment !== "object" || typeof assessment.ok !== "boolean") {
    throw new TypeError("assessResult must return { ok: true } or { ok: false, reason }");
  }
  if (!assessment.ok && (typeof assessment.reason !== "string" || !assessment.reason.trim())) {
    throw new TypeError("assessResult rejection requires a non-empty reason");
  }
  return assessment.ok
    ? { ok: true, ...(assessment.detail ? { detail: shortDetail(assessment.detail) } : {}) }
    : rejectTaskQuality(assessment.reason, assessment.detail);
}

function estimateCost<TCandidate extends QualityFailoverCandidate, TResult>(
  options: QualityFailoverOptions<TCandidate, TResult>,
  candidate: TCandidate,
): number {
  const estimated = options.estimateCostUsd?.(candidate) ?? candidate.estimatedCostUsd ?? 0;
  assertNonNegativeFinite(estimated, `estimated cost for ${candidate.id}`);
  return estimated;
}

function measureCost<TCandidate extends QualityFailoverCandidate, TResult>(
  options: QualityFailoverOptions<TCandidate, TResult>,
  context: QualityFailoverCostContext<TCandidate, TResult>,
): number {
  const measured = options.measureCostUsd?.(context) ?? context.estimatedCostUsd;
  assertNonNegativeFinite(measured, `measured cost for ${context.candidate.id}`);
  return measured;
}

function classifyProviderFailure<TCandidate extends QualityFailoverCandidate, TResult>(
  options: QualityFailoverOptions<TCandidate, TResult>,
  error: unknown,
  candidate: TCandidate,
): ProviderFailureClassification {
  const classification = options.classifyProviderFailure?.(error, candidate)
    ?? classifyQualityFailoverProviderError(error);
  if (!classification.reason.trim()) throw new TypeError("Provider failure classification requires a reason");
  return {
    ...classification,
    reason: classification.reason.trim(),
    ...(classification.detail ? { detail: shortDetail(classification.detail) } : {}),
  };
}

function readAttemptTimeout<TCandidate extends QualityFailoverCandidate>(
  timeout: QualityFailoverOptions<TCandidate, unknown>["attemptTimeoutMs"],
  candidate: TCandidate,
): number | undefined {
  const value = typeof timeout === "function" ? timeout(candidate) : timeout;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("attemptTimeoutMs must be a positive finite number");
  }
  return value;
}

function createAttemptScope(args: {
  parent?: AbortSignal;
  globalRemainingMs?: number;
  attemptTimeoutMs?: number;
}): {
  signal: AbortSignal;
  wait: <T>(promise: Promise<T>) => Promise<T>;
  dispose: () => void;
} {
  const controller = new AbortController();
  let interruptCause: AttemptInterruptCause | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const interrupt = (cause: AttemptInterruptCause, reason?: unknown) => {
    if (controller.signal.aborted) return;
    interruptCause = cause;
    controller.abort(reason);
  };
  const onParentAbort = () => interrupt("parent", args.parent?.reason);
  if (args.parent?.aborted) onParentAbort();
  else args.parent?.addEventListener("abort", onParentAbort, { once: true });

  const timeout = selectTimeout(args.globalRemainingMs, args.attemptTimeoutMs);
  if (timeout) {
    timer = setTimeout(
      () => interrupt(timeout.cause, new Error(timeout.cause)),
      Math.max(0, timeout.ms),
    );
  }

  let onScopeAbort: (() => void) | undefined;
  return {
    signal: controller.signal,
    wait: async <T>(promise: Promise<T>): Promise<T> => {
      if (controller.signal.aborted) {
        throw new AttemptInterruptedError(interruptCause ?? "parent");
      }
      const interrupted = new Promise<never>((_resolve, reject) => {
        onScopeAbort = () => reject(new AttemptInterruptedError(interruptCause ?? "parent"));
        controller.signal.addEventListener("abort", onScopeAbort, { once: true });
      });
      return Promise.race([promise, interrupted]);
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (onScopeAbort) controller.signal.removeEventListener("abort", onScopeAbort);
      args.parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function selectTimeout(
  globalRemainingMs?: number,
  attemptTimeoutMs?: number,
): { ms: number; cause: Extract<AttemptInterruptCause, "time_budget" | "attempt_timeout"> } | undefined {
  if (globalRemainingMs === undefined && attemptTimeoutMs === undefined) return undefined;
  if (globalRemainingMs !== undefined && (attemptTimeoutMs === undefined || globalRemainingMs <= attemptTimeoutMs)) {
    return { ms: globalRemainingMs, cause: "time_budget" };
  }
  return { ms: attemptTimeoutMs ?? 0, cause: "attempt_timeout" };
}

function makeAttemptReceipt(args: {
  candidate: QualityFailoverCandidate;
  candidateIndex: number;
  attempt: number;
  startedAt: number;
  completedAt: number;
  estimatedCostUsd: number;
  costUsd: number;
  outcome: QualityFailoverAttemptOutcome;
  decision: QualityFailoverAttemptDecision;
  reason: string;
  detail?: string;
  providerFailure?: ProviderFailureClassification;
}): QualityFailoverRouteAttemptReceipt {
  return {
    attempt: args.attempt,
    candidateIndex: args.candidateIndex,
    routeId: args.candidate.id,
    ...(args.candidate.provider ? { provider: args.candidate.provider } : {}),
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs: Math.max(0, args.completedAt - args.startedAt),
    estimatedCostUsd: args.estimatedCostUsd,
    costUsd: args.costUsd,
    outcome: args.outcome,
    decision: args.decision,
    reason: args.reason,
    ...(args.detail ? { detail: shortDetail(args.detail) } : {}),
    ...(args.providerFailure
      ? {
          providerFailureScope: args.providerFailure.scope,
          providerFailureCategory: args.providerFailure.category,
        }
      : {}),
  };
}

function globalProviderFailure(
  category: Extract<ProviderFailureCategory, "auth" | "quota" | "policy">,
  reason: string,
  detail: string,
): ProviderFailureClassification {
  return { scope: "global", category, reason, detail };
}

function providerTerminalFailure(
  failure: ProviderFailureClassification,
): QualityFailoverTerminalFailure {
  return {
    failureClass: "provider",
    reason: failure.reason,
    ...(failure.detail ? { detail: failure.detail } : {}),
    providerFailureScope: failure.scope,
    providerFailureCategory: failure.category,
  };
}

function controlFailure(reason: string, detail?: string): QualityFailoverTerminalFailure {
  return {
    failureClass: "control",
    reason,
    ...(detail ? { detail: shortDetail(detail) } : {}),
  };
}

function timeBudgetExhausted(
  config: { effectiveDeadlineAt?: number },
  now: number,
): boolean {
  return config.effectiveDeadlineAt !== undefined && now >= config.effectiveDeadlineAt;
}

function exceedsBudget(value: number, limit: number): boolean {
  const tolerance = Math.max(1e-12, Math.abs(limit) * 1e-12);
  return value > limit + tolerance;
}

function stableCost(value: number): number {
  return Number(value.toFixed(12));
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
}

function readNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) throw new TypeError("now() must return a finite number");
  return value;
}

function shortError(error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return shortDetail(detail)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function shortDetail(detail: string): string {
  return detail.replace(/\s+/g, " ").trim().slice(0, 500);
}
