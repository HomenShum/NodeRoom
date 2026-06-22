/**
 * Golden grader — the Docker-free, UI-native verifier for the NodeRoom benchmark golden dataset.
 *
 * Faithful TypeScript port of docs/eval/nonbtb/grade.py so the SAME anti-cheat scoring runs in the
 * browser (the live room UI), in vitest (the prod gate), and — when wired — in a Convex
 * action. No Python, no openpyxl, no Docker/Harbor container required to verify a deliverable.
 *
 * Four scored dimensions per expected key (matching grade.py):
 *   1. correctness — numeric value within the rubric's tolerance of the golden value
 *   2. formula     — (if formula_required) the value is a live spreadsheet formula (starts with "=")
 *   3. cited       — (if citations_required) the citation resolves to a real rubric source file
 *   4. fabrication — keys outside allowed_keys, or allowed keys citing a non-source file, each cost 10%
 *
 * score = max(0, dims/denom - 0.1 * fabrications). A golden-correct deliverable scores 1.0; any
 * hallucinated value, hardcoded literal, or invented citation drives it down. This is the property
 * the self-test in tests/goldenDataset.test.ts pins: accept golden-good (1.0), reject golden-bad.
 */

export interface ExpectedSpec {
  value: number;
  /** Absolute tolerance; defaults to 0 (exact match) like grade.py's `spec.get("tol", 0.0)`. */
  tol?: number;
}

export interface GoldenRubric {
  task: string;
  deliverable?: string;
  allowed_keys: string[];
  expected: Record<string, ExpectedSpec>;
  formula_required?: boolean;
  citations_required?: boolean;
  sources?: string[];
}

export interface OutputCite {
  file?: unknown;
  locator?: unknown;
}
export interface OutputRecord {
  value?: unknown;
  formula?: unknown;
  cite?: OutputCite | null;
}
export type GoldenOutputs = Record<string, OutputRecord>;

export interface KeyBreakdown {
  key: string;
  present: boolean;
  okValue: boolean;
  okFormula: boolean;
  okCite: boolean;
}

export interface GradeResult {
  task: string;
  /** Fabrication-penalized score in [0, 1]. */
  score: number;
  /** Score before the fabrication penalty (dims / denom). */
  raw: number;
  n: number;
  correct: number;
  formula: number;
  cited: number;
  fabrication: number;
  needFormula: boolean;
  needCite: boolean;
  perKey: KeyBreakdown[];
  /** Reasons (one per fabrication / failed dimension) — surfaced in the UI grade panel. */
  flags: string[];
  /** score >= passThreshold. Default threshold is 0.6 (a real agent run); the self-test asserts exact scores. */
  ok: boolean;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const citeFileOf = (rec: OutputRecord | undefined): string | undefined => {
  const file = rec?.cite && typeof rec.cite === "object" ? (rec.cite as OutputCite).file : undefined;
  return typeof file === "string" ? file : undefined;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Grade a deliverable (`outputs`) against its rubric. Pure, deterministic, dependency-free. */
export function gradeGolden(rubric: GoldenRubric, outputs: GoldenOutputs, passThreshold = 0.6): GradeResult {
  const allowed = new Set(rubric.allowed_keys);
  const sources = new Set(rubric.sources ?? []);
  const needFormula = !!rubric.formula_required;
  const needCite = !!rubric.citations_required;
  const expectedKeys = Object.keys(rubric.expected);
  const n = expectedKeys.length;

  let correct = 0;
  let formula = 0;
  let cited = 0;
  let fabrication = 0;
  const perKey: KeyBreakdown[] = [];
  const flags: string[] = [];

  for (const key of expectedKeys) {
    const rec = outputs[key];
    const present = rec != null;
    const spec = rubric.expected[key];
    const tol = spec.tol ?? 0;

    const okValue = isFiniteNumber(rec?.value) && Math.abs((rec!.value as number) - spec.value) <= tol;
    const okFormula =
      !needFormula || (typeof rec?.formula === "string" && rec.formula.replace(/^\s+/, "").startsWith("="));
    const okCite = !needCite || (() => { const f = citeFileOf(rec); return !!f && sources.has(f); })();

    correct += okValue ? 1 : 0;
    formula += okFormula ? 1 : 0;
    cited += okCite ? 1 : 0;
    perKey.push({ key, present, okValue, okFormula, okCite });

    if (!present) flags.push(`missing key "${key}"`);
    else if (!okValue) flags.push(`wrong value for "${key}" (got ${JSON.stringify(rec?.value)}, want ${spec.value}±${tol})`);
    if (present && needFormula && !okFormula) flags.push(`"${key}" is a hardcoded literal, not a formula`);
    if (present && needCite && !okCite) flags.push(`"${key}" citation does not resolve to a rubric source`);
  }

  // Fabrication: any key outside allowed_keys, or an allowed key citing a file not in sources.
  for (const [key, rec] of Object.entries(outputs)) {
    if (!allowed.has(key)) {
      fabrication += 1;
      flags.push(`fabricated key "${key}" (not in allowed_keys)`);
      continue;
    }
    const f = citeFileOf(rec);
    if (f && !sources.has(f)) {
      fabrication += 1;
      flags.push(`"${key}" cites non-source file "${f}"`);
    }
  }

  const dims = correct + (needFormula ? formula : 0) + (needCite ? cited : 0);
  const denom = n * (1 + (needFormula ? 1 : 0) + (needCite ? 1 : 0));
  const raw = denom ? dims / denom : 0;
  const score = Math.max(0, raw - 0.1 * fabrication);

  return {
    task: rubric.task,
    score: round3(score),
    raw: round3(raw),
    n,
    correct,
    formula,
    cited,
    fabrication,
    needFormula,
    needCite,
    perKey,
    flags,
    ok: score >= passThreshold,
  };
}
