/**
 * Debouncer — sliding-window debounce for activity scanning.
 */

export interface DebounceState {
  quietUntil: number;
  maxWaitAt: number;
}

export const DEFAULT_QUIET_MS = 12_000;
export const MAX_QUIET_MS = 60_000;

export function clampQuietMs(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_QUIET_MS)) return DEFAULT_QUIET_MS;
  return Math.max(1_000, Math.min(value ?? DEFAULT_QUIET_MS, MAX_QUIET_MS));
}

export function computeDebounce(
  now: number,
  existing: DebounceState | null,
  quietMs: number,
): { state: DebounceState; effectiveDelay: number } {
  const delay = clampQuietMs(quietMs);
  const maxWaitAt = existing
    ? existing.maxWaitAt
    : now + MAX_QUIET_MS;
  const effectiveDelay = Math.max(1, Math.min(delay, maxWaitAt - now));
  return {
    state: { quietUntil: now + effectiveDelay, maxWaitAt },
    effectiveDelay,
  };
}
