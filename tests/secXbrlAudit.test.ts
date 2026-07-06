/**
 * SEC/XBRL audit scorer — scenario tests against REAL SEC EDGAR data
 * (proofloop/datasets/sec-xbrl/fixtures.json: Apple + Microsoft latest 10-Ks,
 * (accn,end)-aligned consolidated facts). Personas: an auditor NodeAgent facing
 * (a) a clean filing where every identity ties, (b) a filing with a planted
 * inconsistency it must catch, (c) a filer that simply doesn't tag a subtotal.
 *
 * These are the ground-truth arithmetic checks — no LLM judge — so the benchmark
 * cannot be gamed by pattern-matching; the answer only exists if you compute it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditIdentities,
  violatedIdentityIds,
  scoreAudit,
  SEC_XBRL_AUDIT,
  type CompanyXbrlFacts,
} from "../src/eval/secXbrlAudit";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "../proofloop/datasets/sec-xbrl/fixtures.json"), "utf8"),
) as { companies: CompanyXbrlFacts[] };

const apple = fixtures.companies.find((c) => c.name?.includes("Apple"))!;
const msft = fixtures.companies.find((c) => c.name?.includes("Microsoft"))!;

/** Deep-clone a filing and overwrite one tag's value — an "injected inconsistency". */
function perturb(company: CompanyXbrlFacts, tag: string, newVal: number): CompanyXbrlFacts {
  const clone: CompanyXbrlFacts = JSON.parse(JSON.stringify(company));
  clone.facts[tag] = { ...(clone.facts[tag] as object), val: newVal } as CompanyXbrlFacts["facts"][string];
  return clone;
}

describe("SEC/XBRL audit — real filings tie out", () => {
  it("Apple's latest 10-K: every applicable identity HOLDS (clean → zero violations)", () => {
    const results = auditIdentities(apple);
    const applicable = results.filter((r) => r.applicable);
    expect(applicable.length).toBeGreaterThanOrEqual(3); // balance eqn, reported total, subtotals, EPS
    for (const r of applicable) {
      expect(r.holds, `${r.id} should hold (delta ${r.delta} > tol ${r.tolerance})`).toBe(true);
    }
    expect(violatedIdentityIds(apple)).toEqual([]);
  });

  it("Microsoft: identities hold, and the un-tagged subtotal is INAPPLICABLE, not a violation", () => {
    const results = auditIdentities(msft);
    const subtotal = results.find((r) => r.id === "assets_current_noncurrent_subtotal")!;
    // MSFT does not tag AssetsNoncurrent — the identity cannot be checked.
    expect(subtotal.applicable).toBe(false);
    expect(subtotal.missingTags).toContain("AssetsNoncurrent");
    // ...and it is NOT reported as a violation (a missing tag must never false-flag).
    expect(violatedIdentityIds(msft)).not.toContain("assets_current_noncurrent_subtotal");
    // The balance-sheet equation and EPS still hold on real data.
    expect(results.find((r) => r.id === "balance_sheet_equation")!.holds).toBe(true);
    expect(results.find((r) => r.id === "eps_reconciliation")!.holds).toBe(true);
  });
});

describe("SEC/XBRL audit — injected inconsistencies are caught exactly", () => {
  it("breaking Assets by $1B flips ONLY the two Assets-side identities", () => {
    const assets = (apple.facts.Assets as { val: number }).val;
    const broken = perturb(apple, "Assets", assets + 1_000_000_000);
    const violated = violatedIdentityIds(broken);
    // Assets feeds: balance eqn, reported-total, and the current/noncurrent subtotal.
    expect(violated).toContain("balance_sheet_equation");
    expect(violated).toContain("assets_equal_liabilities_and_equity_total");
    expect(violated).toContain("assets_current_noncurrent_subtotal");
    // It must NOT spuriously flag the unrelated EPS identity.
    expect(violated).not.toContain("eps_reconciliation");
  });

  it("a sign error on NetIncomeLoss (DQC_0015 style) breaks EPS reconciliation", () => {
    const ni = (apple.facts.NetIncomeLoss as { val: number }).val;
    const broken = perturb(apple, "NetIncomeLoss", -ni); // wrong sign
    expect(violatedIdentityIds(broken)).toContain("eps_reconciliation");
  });

  it("a sub-tolerance rounding drift does NOT trip a violation (no false positives)", () => {
    const assets = (apple.facts.Assets as { val: number }).val;
    const nudged = perturb(apple, "Assets", assets + 1); // $1 on a $359B balance sheet
    expect(violatedIdentityIds(nudged)).not.toContain("balance_sheet_equation");
  });
});

describe("SEC/XBRL audit — scoring an auditor's flags", () => {
  const truth = ["balance_sheet_equation", "assets_equal_liabilities_and_equity_total"];

  it("a perfect audit scores F1 = 1", () => {
    const s = scoreAudit(truth, truth);
    expect(s).toMatchObject({ precision: 1, recall: 1, f1: 1, perfect: true });
  });

  it("a clean filing correctly flagged as clean scores perfect", () => {
    expect(scoreAudit([], [])).toMatchObject({ f1: 1, perfect: true });
  });

  it("a missed violation drops recall; a hallucinated flag drops precision", () => {
    const missed = scoreAudit(["balance_sheet_equation"], truth);
    expect(missed.recall).toBeCloseTo(0.5);
    expect(missed.perfect).toBe(false);
    const hallucinated = scoreAudit([...truth, "eps_reconciliation"], truth);
    expect(hallucinated.precision).toBeCloseTo(2 / 3);
    expect(hallucinated.falsePositives).toBe(1);
  });

  it("the benchmark honestly disclaims an official score", () => {
    expect(SEC_XBRL_AUDIT.officialScoreClaim).toBe(false);
    expect(SEC_XBRL_AUDIT.identityCount).toBeGreaterThanOrEqual(5);
  });
});
