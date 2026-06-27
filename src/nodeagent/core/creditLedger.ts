/**
 * creditLedger.ts — pure, framework-free credit ledger engine.
 *
 * The reserve→run→settle state machine, with no React/Convex dependency so it can be
 * unit-tested directly for the properties that matter: fail-closed on insufficient
 * credits, idempotent settle, bounded event log, never-negative balance. The store
 * (memory mode) and the Convex backend (post-deploy) both drive an instance of this.
 *
 * Invariant: available + reserved + lifetimeSpent == granted, AS LONG AS actual cost
 * never exceeds the hold. Actual CAN exceed the hold (a run runs hotter than its
 * estimate, up to the in-run hard cap) — settle() charges the overage from available,
 * clamps available at 0 (never negative), and records the uncovered remainder honestly.
 */
import {
  type AgentCreditMode,
  type CostEstimate,
  creditsToUsd,
  estimateCostFor,
  usdToCredits,
} from "./creditModel";

export type UsageEventKind = "grant" | "reserve" | "settle" | "refund" | "reject";

export interface UsageEvent {
  id: string;
  seq: number;
  kind: UsageEventKind;
  mode?: AgentCreditMode;
  /** Signed credit delta to `available` (negative = spent/held, positive = granted/refunded). */
  credits: number;
  usd: number;
  reservationId?: string;
  reason?: string;
  note?: string;
}

export interface CreditBalance {
  availableCredits: number;
  reservedCredits: number;
  lifetimeSpentCredits: number;
  availableUsd: number;
  reservedUsd: number;
  lifetimeSpentUsd: number;
  /** Memory-mode demo balance (labeled "demo credits" in the UI). */
  demo: boolean;
  /** Whether credits actually gate jobs here. Live is unenforced until the backend deploys. */
  enforced: boolean;
}

export interface ReserveArgs {
  mode: AgentCreditMode;
  /** Override the credits to hold (defaults to the mode's conservative high-estimate hold). */
  credits?: number;
  note?: string;
}

export interface ReserveResult {
  ok: boolean;
  reservationId?: string;
  heldCredits?: number;
  reason?: "insufficient_credits";
  /** Honest balance snapshot after the attempt (success or fail). */
  balance: CreditBalance;
}

export interface SettleArgs {
  reservationId: string;
  /** Actual USD spent by the run (LLM cost). If omitted, settles at the hold's worth. */
  actualUsd?: number;
  note?: string;
}

export interface SettleResult {
  ok: boolean;
  settledCredits?: number;
  refundedCredits?: number;
  overspentCredits?: number;
  reason?: "unknown_reservation";
  balance: CreditBalance;
}

export interface CreditLedgerOptions {
  startingCredits: number;
  demo: boolean;
  enforced: boolean;
  /** Max retained usage events (BOUND — oldest evicted). */
  maxEvents?: number;
}

export interface CreditLedger {
  balance(): CreditBalance;
  estimate(mode: AgentCreditMode): CostEstimate;
  reserve(args: ReserveArgs): ReserveResult;
  settle(args: SettleArgs): SettleResult;
  events(): UsageEvent[];
  /** Add credits (a grant). Returns the new balance. */
  grant(credits: number, note?: string): CreditBalance;
  reset(): void;
}

const DEFAULT_MAX_EVENTS = 200;

export function createCreditLedger(opts: CreditLedgerOptions): CreditLedger {
  const maxEvents = Math.max(10, opts.maxEvents ?? DEFAULT_MAX_EVENTS);
  let available = Math.max(0, opts.startingCredits);
  let reserved = 0;
  let lifetimeSpent = 0;
  let seq = 0;
  const reservations = new Map<string, { mode: AgentCreditMode; held: number }>();
  const log: UsageEvent[] = [];

  function pushEvent(e: Omit<UsageEvent, "id" | "seq">): void {
    seq += 1;
    log.push({ id: `ue_${seq}`, seq, ...e });
    // BOUND: evict oldest beyond the cap (CLAUDE.md #1).
    if (log.length > maxEvents) log.splice(0, log.length - maxEvents);
  }

  function snapshot(): CreditBalance {
    return {
      availableCredits: round2(available),
      reservedCredits: round2(reserved),
      lifetimeSpentCredits: round2(lifetimeSpent),
      availableUsd: round4(creditsToUsd(available)),
      reservedUsd: round4(creditsToUsd(reserved)),
      lifetimeSpentUsd: round4(creditsToUsd(lifetimeSpent)),
      demo: opts.demo,
      enforced: opts.enforced,
    };
  }

  function reserve(args: ReserveArgs): ReserveResult {
    const est = estimateCostFor(args.mode);
    const held = Math.max(1, args.credits ?? est.creditsRequired);
    // FAIL-CLOSED + HONEST: never start a job we can't back.
    if (available < held) {
      pushEvent({ kind: "reject", mode: args.mode, credits: 0, usd: 0, reason: "insufficient_credits", note: args.note });
      return { ok: false, reason: "insufficient_credits", balance: snapshot() };
    }
    available -= held;
    reserved += held;
    const reservationId = `res_${seq + 1}`;
    reservations.set(reservationId, { mode: args.mode, held });
    pushEvent({ kind: "reserve", mode: args.mode, credits: -held, usd: -creditsToUsd(held), reservationId, note: args.note });
    return { ok: true, reservationId, heldCredits: held, balance: snapshot() };
  }

  function settle(args: SettleArgs): SettleResult {
    const r = reservations.get(args.reservationId);
    // IDEMPOTENT: a second settle for the same id finds nothing and no-ops honestly.
    if (!r) {
      return { ok: false, reason: "unknown_reservation", balance: snapshot() };
    }
    reservations.delete(args.reservationId);
    // Release the hold first.
    reserved -= r.held;
    const actualUsd = args.actualUsd ?? creditsToUsd(r.held);
    const actualCredits = Math.max(0, usdToCredits(actualUsd));

    let settledCredits: number;
    let refundedCredits = 0;
    let overspentCredits = 0;

    if (actualCredits <= r.held) {
      // Cheaper than held → refund the difference to available.
      settledCredits = actualCredits;
      refundedCredits = r.held - actualCredits;
      available += refundedCredits;
      lifetimeSpent += settledCredits;
    } else {
      // Ran hotter than the hold → charge the overage from available, never go negative.
      const overage = actualCredits - r.held;
      const coverable = Math.min(overage, available);
      available -= coverable;
      overspentCredits = overage - coverable; // uncovered remainder (the cap is the real backstop)
      settledCredits = r.held + coverable;
      lifetimeSpent += settledCredits;
    }

    pushEvent({
      kind: "settle",
      mode: r.mode,
      credits: -round2(usdToCredits(actualUsd)),
      usd: -round4(actualUsd),
      reservationId: args.reservationId,
      note: args.note,
    });
    if (refundedCredits > 0) {
      pushEvent({ kind: "refund", mode: r.mode, credits: round2(refundedCredits), usd: round4(creditsToUsd(refundedCredits)), reservationId: args.reservationId });
    }
    return {
      ok: true,
      settledCredits: round2(settledCredits),
      refundedCredits: round2(refundedCredits),
      overspentCredits: round2(overspentCredits),
      balance: snapshot(),
    };
  }

  function grant(credits: number, note?: string): CreditBalance {
    const add = Math.max(0, credits);
    available += add;
    pushEvent({ kind: "grant", credits: add, usd: creditsToUsd(add), note });
    return snapshot();
  }

  function reset(): void {
    available = Math.max(0, opts.startingCredits);
    reserved = 0;
    lifetimeSpent = 0;
    seq = 0;
    reservations.clear();
    log.length = 0;
  }

  return {
    balance: snapshot,
    estimate: estimateCostFor,
    reserve,
    settle,
    events: () => log.slice(),
    grant,
    reset,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
