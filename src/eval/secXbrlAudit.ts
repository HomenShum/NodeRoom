/**
 * SEC/XBRL financial-audit scorer — deterministic, no LLM judge.
 *
 * Audits the US-GAAP cross-statement tie-out identities that MUST hold in a
 * valid filing, checked with pure arithmetic on SEC EDGAR `companyfacts` values.
 * This is the numeric-inconsistency lane FinAuditing (arXiv:2510.08886) builds
 * on — it grounds its labels in the XBRL-US Data Quality Committee (DQC) rules
 * (DQC_0004 calc-consistency, DQC_0015 negative values). We are NOT reproducing
 * the official FinAuditing score (its FinMR task uses an LLM judge + their HF
 * dataset); this is a DQC-identity-based deterministic audit on real public
 * filings — officialScoreClaim MUST stay false everywhere this is surfaced.
 *
 * Real-data gotchas handled here (verified live against Apple/MSFT 10-Ks):
 *  - a filing tags BOTH current + prior balance sheets → callers align facts to
 *    one (accn, end); this module operates on already-aligned facts.
 *  - not every filer tags every subtotal (MSFT omits AssetsNoncurrent) → an
 *    identity whose required tags are absent is INAPPLICABLE, never a violation.
 *  - independent line-item rounding means a sum can miss by a few units → each
 *    identity carries a tolerance; equality is |delta| <= tolerance, not ===.
 */

export type XbrlFact = { val: number; end: string; start?: string | null };

/** Aligned consolidated facts for ONE filing period: tag -> fact (or null if untagged). */
export type CompanyXbrlFacts = {
  cik?: string;
  name?: string;
  accn?: string;
  facts: Record<string, XbrlFact | null>;
};

export type IdentityResult = {
  id: string;
  label: string;
  /** false when a required tag is missing — cannot be checked, is NOT a violation. */
  applicable: boolean;
  /** true only when applicable AND within tolerance. */
  holds: boolean;
  expected: number | null;
  actual: number | null;
  delta: number | null;
  tolerance: number | null;
  missingTags: string[];
};

type IdentitySpec = {
  id: string;
  label: string;
  /** tags that must all be present for the identity to apply. */
  required: string[];
  /** compute { actual, expected } from the present facts. */
  compute: (v: (tag: string) => number) => { actual: number; expected: number };
  /** absolute tolerance; defaults to relToleranceOf(magnitude). */
  tolerance?: (v: (tag: string) => number) => number;
};

/** Rounding band: filers round line items independently, so a sum of N terms
 * can drift. Scale tolerance with the value's magnitude (proxy for XBRL
 * `decimals`), floored so tiny statements still get a sane band. */
export function relTolerance(magnitude: number, terms = 2): number {
  return Math.max(1, Math.abs(magnitude) * 5e-7 * terms);
}

const IDENTITIES: IdentitySpec[] = [
  {
    id: "balance_sheet_equation",
    label: "Assets = Liabilities + StockholdersEquity",
    required: ["Assets", "Liabilities", "StockholdersEquity"],
    compute: (v) => ({ actual: v("Assets"), expected: v("Liabilities") + v("StockholdersEquity") }),
  },
  {
    id: "assets_equal_liabilities_and_equity_total",
    label: "Assets = LiabilitiesAndStockholdersEquity (reported total)",
    required: ["Assets", "LiabilitiesAndStockholdersEquity"],
    compute: (v) => ({ actual: v("Assets"), expected: v("LiabilitiesAndStockholdersEquity") }),
  },
  {
    id: "assets_current_noncurrent_subtotal",
    label: "AssetsCurrent + AssetsNoncurrent = Assets",
    required: ["AssetsCurrent", "AssetsNoncurrent", "Assets"],
    compute: (v) => ({ actual: v("AssetsCurrent") + v("AssetsNoncurrent"), expected: v("Assets") }),
  },
  {
    id: "liabilities_current_noncurrent_subtotal",
    label: "LiabilitiesCurrent + LiabilitiesNoncurrent = Liabilities",
    required: ["LiabilitiesCurrent", "LiabilitiesNoncurrent", "Liabilities"],
    compute: (v) => ({ actual: v("LiabilitiesCurrent") + v("LiabilitiesNoncurrent"), expected: v("Liabilities") }),
  },
  {
    id: "eps_reconciliation",
    label: "NetIncomeLoss / WeightedAvgDilutedShares ≈ EarningsPerShareDiluted",
    required: ["NetIncomeLoss", "WeightedAverageNumberOfDilutedSharesOutstanding", "EarningsPerShareDiluted"],
    compute: (v) => ({
      actual: v("NetIncomeLoss") / v("WeightedAverageNumberOfDilutedSharesOutstanding"),
      expected: v("EarningsPerShareDiluted"),
    }),
    // EPS is dollars-per-share: share-count rounding makes ±$0.02 legitimate.
    tolerance: () => 0.02,
  },
];

/** The identity definitions an auditor is asked to check (no compute fns). */
export const IDENTITY_CATALOG: ReadonlyArray<{ id: string; label: string; required: string[] }> =
  IDENTITIES.map((i) => ({ id: i.id, label: i.label, required: [...i.required] }));

/** Run every identity against one filing's aligned facts. Pure, deterministic. */
export function auditIdentities(company: CompanyXbrlFacts): IdentityResult[] {
  return IDENTITIES.map((spec) => {
    const missingTags = spec.required.filter((t) => {
      const f = company.facts[t];
      return !f || typeof f.val !== "number" || !Number.isFinite(f.val);
    });
    if (missingTags.length > 0) {
      return { id: spec.id, label: spec.label, applicable: false, holds: false, expected: null, actual: null, delta: null, tolerance: null, missingTags };
    }
    const v = (tag: string) => (company.facts[tag] as XbrlFact).val;
    const { actual, expected } = spec.compute(v);
    const tolerance = spec.tolerance ? spec.tolerance(v) : relTolerance(Math.max(Math.abs(actual), Math.abs(expected)), spec.required.length);
    const delta = actual - expected;
    return { id: spec.id, label: spec.label, applicable: true, holds: Math.abs(delta) <= tolerance, expected, actual, delta, tolerance, missingTags: [] };
  });
}

/** The identity ids that are applicable AND violated — the ground-truth an auditor must flag. */
export function violatedIdentityIds(company: CompanyXbrlFacts): string[] {
  return auditIdentities(company).filter((r) => r.applicable && !r.holds).map((r) => r.id);
}

export type AuditScore = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  /** exact set match: flagged the violations, nothing spurious. */
  perfect: boolean;
};

/** Score an auditor's flagged identity ids against the deterministic ground truth. */
export function scoreAudit(flaggedIds: readonly string[], groundTruthViolatedIds: readonly string[]): AuditScore {
  const flagged = new Set(flaggedIds);
  const truth = new Set(groundTruthViolatedIds);
  let tp = 0;
  for (const id of flagged) if (truth.has(id)) tp += 1;
  const fp = flagged.size - tp;
  const fn = truth.size - tp;
  const precision = flagged.size === 0 ? (truth.size === 0 ? 1 : 0) : tp / flagged.size;
  const recall = truth.size === 0 ? (flagged.size === 0 ? 1 : 0) : tp / truth.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1, perfect: fp === 0 && fn === 0 };
}

export const SEC_XBRL_AUDIT = {
  officialScoreClaim: false as const,
  benchmarkInspiration: "FinAuditing (arXiv:2510.08886) + XBRL-US DQC rules DQC_0004/DQC_0015",
  identityCount: IDENTITIES.length,
  identityIds: IDENTITIES.map((i) => i.id),
};
