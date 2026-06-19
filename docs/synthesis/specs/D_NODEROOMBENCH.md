# Four-layer eval stack + NodeRoomBench + harness-honesty reporting standard

## Decision

Do **not** re-spec Layers 1/2/4 or the honesty standard — they already exist and are solid
(`evals/financeModelRuntime.ts`, `evals/financeModelGold.ts`, `evals/financeModelLive.ts`,
`evals/evalStore.ts`, `evals/professionalProofLedger.ts`, `docs/eval/MODEL_EVAL_MATRIX.md`).
This workstream is **naming + thin packaging + two genuinely-missing graders**, gated by
`src/eval/architectureBudget.ts` (no new framework layer, no new UI surface, no new tables).

Ship four net-new things, in order: (1) a `validators/` library that makes the names already
written in `docs/demo/public-gold-demo-manifest.json` (`formula_ast_match`, `numeric_exact_match`,
`scale_match`, `source_text_match`, `bbox_or_page_match`, `answer_exact_or_normalized_match`,
`no_clobber`, `privacy_boundary`, `cellpayload_evidence_present`) into importable,
deterministic functions; (2) **Layer 3** as two
distinct checks — a deterministic format/usability rubric over `src/app/numberFormat.ts`, and a
**dynamic-correctness perturbation** check that mutates one assumption and asserts downstream cells
recalc (the defensible differentiator, currently absent); (3) a **benchmark-faithful adapter** that
turns `scripts/validate-public-gold-demo.ts` from a manifest-shape checker into a fetch→cache→run
runner with an egress allowlist; (4) `NodeRoomBench` as a **thin re-export index + a reporting-template
doc-lint**, not a parallel harness. Everything writes through the existing `evalStore.ts` substrate.
Guide/Collaborate/dependency-lock runtime evals are scoped here but flagged as their own follow-on
because each requires runtime behavior `harnessStatus.ts` currently marks `contract`.

## Current state (do NOT re-spec — cite-only)

- **Layer 1 Outcome** — final-state-vs-gold on cells/notes: `evals/runEval.ts`, `evals/cases.ts`,
  `evals/financeModelRuntime.ts:218-258`. **solid.**
- **Layer 2 Formula** — AST/equivalence (`normalizeExcelFormula` + `formulaMentionsAllRefs/Tokens`,
  `evals/financeModelGold.ts:204-223`) **and** real value-recompute
  (`evaluateFormulaValue`, `evals/financeModelLive.ts:219-264`, sandboxed `Function` over
  SUM/IF/MIN/MAX/AVG/ABS). **solid.**
- **Layer 4 Trajectory** — read/write/lock/draft/release/CAS/no-clobber/privacy/cost:
  `evals/financeModelRuntime.ts:238-258`, `evals/ladder.ts` L1-L7,
  `evals/multiUserCoordinationProof.ts`, `docs/AGENT_EVAL.md:226-242`. **solid.**
- **Harness-honesty** — `LiveReport` + `classifyRunFailure`/`classifyFinanceFailure`
  (`evals/financeModelLive.ts:429-501`), `PROVIDER_INCONCLUSIVE_SHARE=0.4`,
  `evals/professionalProofLedger.ts:16-22` proof levels, `docs/eval/MODEL_EVAL_MATRIX.md:97-110`.
  **The standard exists — codify the template, do not re-derive it.**
- **Public-source case definitions** — `docs/demo/public-gold-demo-manifest.json` (TAT-DQA / FinanceBench /
  SEC XBRL / no-clobber overlay) with gold constants + named validators. Net-new is **execution**, not the case list.
- **Append-only store + diff** — `evals/evalStore.ts` (`EvalRunRecord`, `computeCaseSetHash`, `diffByCase`),
  `evals/evalDiff.ts`, `docs/eval/eval-runs.jsonl`.
- **Per-case professional contract + proof-level taxonomy** — `evals/professionalWorkflows.ts`,
  `evals/professionalCatalogProofs.ts:22-46`, `evals/harnessStatus.ts`.
- **Architecture budget gate** — `src/eval/architectureBudget.ts` forbids new services/framework
  layers/UI/tables without evidence; `forbiddenPatterns` blocks `src/ui/**` and `convex/schema.ts`.
  All net-new code here lands under `validators/`, `evals/`, `docs/eval/` (evidence dirs) or
  `NodeRoomBench/` (re-export only) to stay inside the budget.

## Net-new work (sequenced)

### Step 1 — `validators/` library (effort L)
**Targets:** `validators/index.ts`, `validators/formula.ts`, `validators/numeric.ts`,
`validators/evidence.ts`, `validators/trajectory.ts`, `tests/validators.test.ts`.

Wrap existing logic; add only what is genuinely new:
- `formula_ast_match` → wraps `normalizeExcelFormula` + `formulaMentionsAllRefs/Tokens` from
  `evals/financeModelGold.ts`. **Decide the open question first**: keep normalized-string match
  (default, cheapest) OR add a commutative-aware comparator that treats `F49+F48 == F48+F49`. Recommend
  shipping normalized match now and adding `commutative: true` opt-in flag later — do not silently
  change existing match semantics (would regress `tests/professionalWorkflows.test.ts`).
- `numeric_exact_match`, `scale_match` → new, tiny: exact-equals with a `scale` enum
  (`thousand`/`million`/`unit`) normalizing both sides to base units before compare.
- `source_text_match`, `bbox_or_page_match`, `cellpayload_evidence_present` → wrap `CellPayload`
  (`src/engine/types.ts`); `source_text_match` is substring-after-normalize over fetched page text;
  `bbox_or_page_match` checks `evidencePage`/bbox presence + range.
- `no_clobber`, `privacy_boundary`, `trace_readset_present`, `trace_writeset_present` → wrap the
  invariants already computed in `evals/multiUserCoordinationProof.ts` and the `financeModelRuntime`
  trajectory checks; expose them as pure `(trace) => CheckResult`.

**DoD:** every validator name in the manifest resolves to an exported function; `tests/validators.test.ts`
proves each fires true on a passing fixture and false on a deliberately-broken one (saboteur per validator,
mirroring `chatIntakeRuntime` naive-saboteur pattern). No validator returns `true` on missing input.

### Step 2 — Layer 3: format/usability rubric (effort M)
**Targets:** `evals/formatUsability.ts`, `validators/format.ts`, per-case `formatAssertions` field added
to the `professionalWorkflows.ts` case schema, `tests/formatUsability.test.ts`.

Deterministic rubric only (no LLM judge — `docs/AGENT_EVAL.md` reserves judges for P2 narration; this would
be the first non-deterministic core gate, which is out of scope). Grade over `formatExcelNumber`
(`src/app/numberFormat.ts`): currency/percent/thousands applied where the case declares it,
no raw float dumps in display cells, labeled-assumption rows carry a label, no unformatted plug in a
formatted column. Output a 0..1 sub-score, never a hard floor.

**DoD:** a model that produces correct values with no number formats scores < 1.0 on format and the run
records `formatScore` in `checks`; a correctly-formatted model scores 1.0; the check is additive (never
flips an otherwise-passing outcome to fail unless the case opts in via `formatRequired: true`).

### Step 3 — Layer 3: dynamic-correctness perturbation (effort M) — **the differentiator**
**Targets:** extend `evals/financeModelLive.ts` (`evaluateFormulaValue` → two-shot recompute),
new check `brittleFormulaResists` in the `LiveReport.checks` map, `tests/dynamicCorrectness.test.ts`.

Two-shot: after the agent writes formulas, the grader (1) records baseline downstream values via the
existing `evaluateFormulaValue` value map, (2) mutates ONE Historical Data assumption seed cell, (3)
re-runs the recompute, (4) asserts each dependent forecast cell **moved** (a hardcoded plug stays put →
fails `brittleFormulaResists`). Decouple from exact-match per the conflict note: this is an **additional**
check, so a legitimate non-brittle formula variant that does not byte-match gold still passes.

**DoD:** a case where the agent pastes a literal value instead of a linked formula fails
`brittleFormulaResists` while still passing `formula_ast_match` would have been impossible (it cannot),
proving the two checks are independent; a correctly-linked formula passes both. Perturbation is
deterministic (fixed delta per assumption, seeded).

### Step 4 — Benchmark-faithful public-source adapter (effort L)
**Targets:** `NodeRoomBench/runners/publicSource.ts`, `scripts/fetch-public-gold-fixtures.ts`,
`NodeRoomBench/fixtures/.gitignore`, upgrade `scripts/validate-public-gold-demo.ts` to call the runner.

Convert the manifest-shape checker into fetch→hashed-gitignored-cache→extract→compute→cite→validate.
Fetch TAT-DQA PDF / FinanceBench JSONL / SEC companyfacts JSON into `NodeRoomBench/fixtures/<sha256>/`
(gitignored). Verify each downloaded blob against `sourceRecordFingerprint`. Run the agent through the
real room path, then execute the Step-1 validators named per case. **Egress is fenced** (allowlist:
`nextplusplus.github.io`, `raw.githubusercontent.com`, `data.sec.gov`, `www.sec.gov`) — see SSRF below.

**DoD:** `npm run noderoombench:public -- --case sec-aapl-fy2023-xbrl` fetches once, caches, and the
SEC case passes `numeric_exact_match` against `383285000000`/`96995000000`/`110543000000`; offline rerun
hits cache and still passes; a tampered cache blob (wrong hash) is rejected with a non-zero exit, never
silently re-fetched into a pass. Result appends to `eval-runs.jsonl` with `failureOwner`.

### Step 5 — `NodeRoomBench` thin index + reporting-template doc-lint (effort M)
**Targets:** `NodeRoomBench/index.ts`, `NodeRoomBench/gold/` (symlink/re-export of manifest + ladder cases),
`docs/eval/REPORTING_TEMPLATE.md`, `evals/reportingLint.ts`, `tests/reportingLint.test.ts`.

`NodeRoomBench/index.ts` RE-EXPORTS existing surfaces (`financeModelGold`, `ladder` cases,
`professionalWorkflows`, `evalStore`, the validators from Step 1) + the public-gold manifest as `gold/`.
**No new logic, no parallel harness** — this satisfies the "named package" ask within the architecture
budget. The doc-lint scans `docs/eval/*.md` and fails CI if any bare score string (`\d+/\d+`,
`\d+(\.\d+)?%`) is not adjacent (same line or the line above) to a harness/budget annotation
(model name + harness/proof-level + budget). Wire into `proofs:staleness`.

**DoD:** `NodeRoomBench/index.ts` imports cleanly and re-exports without duplicating any grader;
`reportingLint` flags the existing bare `18/28 routes 9/9` / `5/5` strings called out in the grounding
conflicts, and passes once they carry the template annotation.

### Step 6 — Convert contract-only modes to runnable (follow-on; scoped, not blocking)
**Targets:** `evals/financeModelGuide.ts` (guide_mode_no_write), `evals/financeModelCollaborate.ts`
(section_collaboration_locks), `formula_dependency_locks` in the runtime/lock layer.
Each flips a `harnessStatus.ts` entry from `contract` → `implemented`. `formula_dependency_locks`
(lock/flag children of an edited parent) is the single biggest gap behind Track (d) claims — land it
first of the three. Gate each behind a failing eval per the architecture budget.

**DoD:** the `harnessStatus.ts` entry's `status` is changed only in the same commit that adds a passing
runtime eval proving the behavior; `professionalCaseReadiness` for the dependent cases flips to `runnable`.

## Interfaces / types

```ts
// validators/index.ts — one shape for every validator named in the manifest.
export type CheckResult = {
  id: ValidatorId;
  passed: boolean;
  /** 0..1 sub-score where graded (format, brittleness); booleans collapse to 0/1. */
  score: number;
  /** HONEST_STATUS: must be set on any non-pass — no silent true. */
  reason?: string;
};

export type ValidatorId =
  | "formula_ast_match" | "numeric_exact_match" | "scale_match"
  | "source_text_match" | "bbox_or_page_match" | "cellpayload_evidence_present"
  | "no_clobber" | "privacy_boundary"
  | "trace_readset_present" | "trace_writeset_present"
  | "format_usability" | "brittle_formula_resists";

export type Scale = "unit" | "thousand" | "million" | "billion";

// validators/numeric.ts
export function numericExactMatch(actual: number, expected: number, opts?: { tolerance?: number }): CheckResult;
export function scaleMatch(actual: number, actualScale: Scale, expected: number, expectedScale: Scale): CheckResult;

// validators/format.ts — Layer 3a, deterministic over numberFormat.ts
export type FormatAssertion = {
  cell: string;
  expect: "currency" | "percent" | "thousands" | "labeled_assumption" | "no_raw_plug";
};
export function gradeFormatUsability(cells: CellPayload[], assertions: FormatAssertion[]): CheckResult;

// evals/financeModelLive.ts — Layer 3b, additive check (NOT a tightening of formula_ast_match)
export type PerturbationCase = {
  assumptionCellId: string;      // a 'Historical Data'! seed cell
  delta: number;                 // fixed, deterministic
  dependents: string[];          // forecast cells that MUST move
};
export function brittleFormulaResists(
  writtenFormulas: Map<string, string>,
  baselineValues: Map<string, number>,
  perturb: PerturbationCase,
): CheckResult; // passed iff every dependent value changes after re-recompute

// NodeRoomBench/runners/publicSource.ts — fetch→cache→run→validate
export type PublicSourceRunResult = {
  caseId: string;
  modelName: string;
  fixtureHash: string;           // sha256 of the cached source blob
  checks: Record<ValidatorId, CheckResult>;
  costUsd: number;
  ms: number;
  failureOwner?: FinanceFailureOwner; // reuse evals/financeModelLive.ts taxonomy
};

// evals/reportingLint.ts — doc-lint, not a runtime gate
export type ScoreLintFinding = { file: string; line: number; score: string; reason: string };
export function lintReportingDocs(files: string[]): ScoreLintFinding[]; // empty => pass
```

The per-case budget field (open question) is hoisted as an optional `budget?: { maxCostUsd; maxMs }`
on the professional case schema and on `PublicSourceRunResult`, defaulting to the existing
`DEFAULT_LEVEL_BUDGETS` rung when unset — backward compatible, no forced migration.

## Risks & mitigations (8-point agentic-reliability checklist)

- **BOUND** — the fixture cache (`NodeRoomBench/fixtures/`) is unbounded across cases over time. Cap to
  the manifest's case set (4) + an LRU evict by mtime; reject blobs over a per-kind size cap (PDF 50MB,
  JSON 100MB) before write. The validators operate on bounded slices, not whole-PDF in memory.
- **HONEST_STATUS** — `CheckResult.passed=false` MUST carry a `reason`; the runner exits non-zero on any
  failed validator and on fetch/hash failure. No 2xx-style "ran fine" on a tamper or network failure —
  classify via the existing `classifyRunFailure` (provider vs model vs harness vs tool_contract).
- **HONEST_SCORES** — format and brittleness are graded 0..1 with no hardcoded floor; `brittle_formula_resists`
  is additive so it cannot inflate a failing outcome into a pass, and cannot be satisfied by a literal plug.
- **TIMEOUT** — every fetch in the public-source runner uses `AbortController` with a budget gate
  (default 30s/source); the recompute is synchronous and bounded by the existing token whitelist in
  `evaluateFormulaValue` (no unbounded eval).
- **SSRF** — the public-source fetch is the only net-new external egress. Enforce a host **allowlist**
  (`nextplusplus.github.io`, `raw.githubusercontent.com`, `data.sec.gov`, `www.sec.gov`); reject
  redirects off-allowlist; resolve+validate the URL before fetch. The disallowed-behavior rule (no
  web-searching benchmark answers) is enforced by this fence — only manifest source URLs are reachable.
- **BOUND_READ** — cap response body size (above) and stream-hash; never buffer an unbounded body.
- **ERROR_BOUNDARY** — every runner path and validator is wrapped so a single bad case records a
  `failed` row with `failureOwner` and continues; one fetch failure never aborts the batch silently.
- **DETERMINISTIC** — fixture identity is `sha256(blob)`; perturbation deltas are fixed constants;
  the reporting-lint regex set is sorted and stable; cache keys and `caseSetHash` use the existing
  sorted-key hashing in `evalStore.ts`. Same inputs → same verdict, offline.

## Definition of done (scenario-based)

1. **Banker fills the SEC watchlist (happy path, public source):**
   `noderoombench:public --case sec-aapl-fy2023-xbrl` fetches once into the gitignored cache,
   the agent writes B12/C12/D12, and `numeric_exact_match` + `scale_match` + `cellpayload_evidence_present`
   all pass against the exact XBRL digits; the run appends to `eval-runs.jsonl` with model+harness+budget.
2. **Adversarial — hardcoded plug (Layer 3b):** an agent that pastes literal forecast values passes
   `formula_ast_match`-style linkage poorly AND fails `brittle_formula_resists` after the assumption
   perturbation; a correctly-linked model passes both. The two checks are provably independent.
3. **Degraded — network down / tampered cache:** offline rerun serves from cache and still passes;
   a corrupted cache blob (wrong sha256) exits non-zero with a `harness`/`environment` failureOwner,
   never a silent re-fetch into a green run.
4. **Format dimension (Layer 3a):** an unformatted-but-correct model scores < 1.0 on `format_usability`
   and the sub-score is recorded; it does not flip an otherwise-passing outcome to fail unless
   `formatRequired: true`.
5. **Reporting honesty (doc-lint):** `reportingLint` fails on a bare `5/5` in any `docs/eval/*.md`
   and passes once the score carries route+harness+budget; wired into `proofs:staleness`.
6. **Architecture budget held:** `checkArchitectureBudget` over the changed-file set returns
   `requiresHumanApproval=false` — all new code lives under `validators/`, `evals/`, `NodeRoomBench/`
   (re-export), and evidence dirs; no `src/ui/**`, no `convex/schema.ts`, no parallel harness.
7. **NodeRoomBench is a name, not a fork:** `import { ... } from "NodeRoomBench"` resolves to the SAME
   grader functions used by the existing evals (proven by reference-equality test), with zero duplicated
   scoring logic.
