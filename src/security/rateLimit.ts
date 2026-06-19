export type FixedWindowState = {
  windowStart: number;
  count: number;
};

export type FixedWindowPolicy = {
  limit: number;
  windowMs: number;
  cost?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetAt: number;
  state: FixedWindowState;
};

export function evaluateFixedWindowLimit(
  state: FixedWindowState | undefined,
  policy: FixedWindowPolicy,
  now = Date.now(),
): RateLimitDecision {
  const limit = Math.max(0, Math.floor(policy.limit));
  const windowMs = Math.max(1, Math.floor(policy.windowMs));
  const cost = Math.max(1, Math.floor(policy.cost ?? 1));
  const activeState = state && now - state.windowStart < windowMs
    ? { ...state }
    : { windowStart: now, count: 0 };
  const nextCount = activeState.count + cost;
  const allowed = nextCount <= limit;
  const count = allowed ? nextCount : activeState.count;
  const resetAt = activeState.windowStart + windowMs;

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterMs: allowed ? 0 : Math.max(0, resetAt - now),
    resetAt,
    state: { windowStart: activeState.windowStart, count },
  };
}

export type TokenBucketState = {
  tokens: number;
  updatedAt: number;
};

export type TokenBucketPolicy = {
  capacity: number;
  refillPerMs: number;
  cost?: number;
};

export function evaluateTokenBucketLimit(
  state: TokenBucketState | undefined,
  policy: TokenBucketPolicy,
  now = Date.now(),
): { allowed: boolean; retryAfterMs: number; remaining: number; state: TokenBucketState } {
  const capacity = Math.max(0, policy.capacity);
  const refillPerMs = Math.max(0, policy.refillPerMs);
  const cost = Math.max(0, policy.cost ?? 1);
  const current = state ?? { tokens: capacity, updatedAt: now };
  const refilled = Math.min(capacity, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs);
  const allowed = refilled >= cost;
  const nextTokens = allowed ? refilled - cost : refilled;
  const retryAfterMs = allowed || refillPerMs === 0 ? 0 : Math.ceil((cost - refilled) / refillPerMs);
  return {
    allowed,
    retryAfterMs,
    remaining: Math.floor(nextTokens),
    state: { tokens: nextTokens, updatedAt: now },
  };
}
