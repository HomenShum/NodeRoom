import { describe, it, expect } from "vitest";
import { createCreditLedger } from "../src/nodeagent/core/creditLedger";
import { creditsToUsd, estimateCostFor, USD_PER_CREDIT } from "../src/nodeagent/core/creditModel";

// Persona: a pilot user with a 20-credit demo grant runs research, exhausts it,
// and the ledger must stay honest, bounded, and never go negative under every path.

function ledger(startingCredits = 20) {
  return createCreditLedger({ startingCredits, demo: true, enforced: true });
}

describe("creditLedger — reserve/settle happy path", () => {
  it("reserve holds credits, settle at estimate debits and refunds the unused hold", () => {
    const l = ledger(20);
    const before = l.balance();
    expect(before.availableCredits).toBe(20);

    const r = l.reserve({ mode: "standard" });
    expect(r.ok).toBe(true);
    const held = r.heldCredits!;
    expect(l.balance().reservedCredits).toBe(held);
    expect(l.balance().availableCredits).toBe(20 - held);

    // Settle cheaper than the hold → unused credits refunded to available.
    const cheapUsd = creditsToUsd(held) / 2;
    const s = l.settle({ reservationId: r.reservationId!, actualUsd: cheapUsd });
    expect(s.ok).toBe(true);
    expect(s.refundedCredits!).toBeGreaterThan(0);
    expect(l.balance().reservedCredits).toBe(0);
    // Conservation: available + spent == start (within rounding).
    const b = l.balance();
    expect(b.availableCredits + b.lifetimeSpentCredits).toBeCloseTo(20, 1);
  });
});

describe("creditLedger — fail-closed", () => {
  it("HONEST_STATUS: reserve over balance returns ok:false, does NOT debit, does NOT start", () => {
    const underStandardHold = estimateCostFor("standard").creditsRequired - 0.01;
    const l = ledger(underStandardHold);
    const r = l.reserve({ mode: "standard" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_credits");
    // Balance untouched on a rejected reserve.
    expect(l.balance().availableCredits).toBe(underStandardHold);
    expect(l.balance().reservedCredits).toBe(0);
    // The rejection is recorded honestly.
    expect(l.events().some((e) => e.kind === "reject")).toBe(true);
  });

  it("exhausting the grant eventually fails closed, never negative", () => {
    const l = ledger(20);
    let ok = 0;
    for (let i = 0; i < 50; i++) {
      const r = l.reserve({ mode: "standard" });
      if (r.ok) {
        ok++;
        l.settle({ reservationId: r.reservationId!, actualUsd: estimateCostFor("standard").estimateUsd });
      }
    }
    expect(ok).toBeGreaterThan(0);
    const b = l.balance();
    expect(b.availableCredits).toBeGreaterThanOrEqual(0); // NEVER negative
  });
});

describe("creditLedger — idempotency & concurrency", () => {
  it("IDEMPOTENT: settling the same reservation twice is a no-op the second time", () => {
    const l = ledger(20);
    const r = l.reserve({ mode: "quick" });
    const first = l.settle({ reservationId: r.reservationId!, actualUsd: 0.1 });
    expect(first.ok).toBe(true);
    const second = l.settle({ reservationId: r.reservationId!, actualUsd: 0.1 });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("unknown_reservation");
    // Balance unchanged by the duplicate settle.
    expect(second.balance.availableCredits).toBe(first.balance.availableCredits);
  });

  it("concurrent reserves cannot over-commit beyond the balance", () => {
    const l = ledger(10);
    const deepHold = estimateCostFor("deep").creditsRequired; // 12 > 10
    const a = l.reserve({ mode: "deep" });
    const b = l.reserve({ mode: "deep" });
    // 10 credits can't back even one 12-credit deep hold.
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(l.balance().reservedCredits).toBe(0);
    expect(deepHold).toBeGreaterThan(10);
  });

  it("two cheap reserves both succeed only while balance backs them", () => {
    const l = ledger(3);
    const a = l.reserve({ mode: "quick" }); // hold 1
    const b = l.reserve({ mode: "quick" }); // hold 1
    const c = l.reserve({ mode: "quick" }); // hold 1
    const d = l.reserve({ mode: "quick" }); // should fail — 0 left
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(d.ok).toBe(false);
    expect(l.balance().availableCredits).toBe(0);
  });
});

describe("creditLedger — overspend honesty & bound", () => {
  it("a run hotter than its hold charges overage from available and clamps at 0", () => {
    const l = ledger(20);
    const r = l.reserve({ mode: "quick" }); // small hold
    // Settle with a cost far above the hold (run ran to the hard cap).
    const s = l.settle({ reservationId: r.reservationId!, actualUsd: 5.0 });
    expect(s.ok).toBe(true);
    const b = l.balance();
    expect(b.availableCredits).toBeGreaterThanOrEqual(0); // never negative
    expect(b.reservedCredits).toBe(0);
  });

  it("overspend beyond the entire balance is recorded, not hidden, and clamps available at 0", () => {
    const l = ledger(2);
    const r = l.reserve({ mode: "quick" }); // hold 1, available now 1
    const s = l.settle({ reservationId: r.reservationId!, actualUsd: 100 }); // absurd overspend
    expect(s.ok).toBe(true);
    expect(s.overspentCredits!).toBeGreaterThan(0); // the uncovered remainder is surfaced
    expect(l.balance().availableCredits).toBe(0);
  });

  it("BOUND: the usage event log never exceeds maxEvents", () => {
    const l = createCreditLedger({ startingCredits: 100000, demo: true, enforced: true, maxEvents: 50 });
    for (let i = 0; i < 500; i++) {
      const r = l.reserve({ mode: "quick" });
      if (r.ok) l.settle({ reservationId: r.reservationId!, actualUsd: 0.05 });
    }
    expect(l.events().length).toBeLessThanOrEqual(50);
  });

  it("USD/credit views stay consistent with the $0.25 unit", () => {
    const l = ledger(20);
    const b = l.balance();
    expect(b.availableUsd).toBeCloseTo(20 * USD_PER_CREDIT, 4);
  });
});

describe("creditLedger — grant & reset", () => {
  it("grant adds credits and is logged; reset restores the starting state", () => {
    const l = ledger(5);
    l.grant(15, "pilot top-up");
    expect(l.balance().availableCredits).toBe(20);
    expect(l.events().some((e) => e.kind === "grant")).toBe(true);
    l.reset();
    expect(l.balance().availableCredits).toBe(5);
    expect(l.events().length).toBe(0);
  });
});
