# Non-BTB generalization slice

> **Copy of `docs/eval/nonbtb/` — committed here because Vite bundles `src/` but
> `.vercelignore` excludes `docs/`.** Update both copies if the rubrics change, or
> set up a `prebuild` sync script later. The `docs/eval/nonbtb/` tree remains the
> canonical source; this `src/benchmarks/nonbtb/` mirror exists only so the Vite
> production bundle on Vercel can resolve the prompts/rubrics/fixtures at runtime.

The off-distribution tripwire for the BTB diagnostic (see
`../../../docs/eval/BTB_GENERALIZATION_DIAGNOSTIC.md`). Same primitive class as BankerToolBench —
messy sources → a correct, cited Office/PDF deliverable — but **not** BTB tasks. If a
harness fix lifts tuned/held-out BTB but **not** this slice, the fix is overfit.

## Tasks
- `nb-01-company-profile` — xlsx with live financial-ratio formulas + cell citations.
- `nb-02-vendor-pricing` — xlsx pricing table with computed totals + citations.
- `nb-03-reconciliation` — memo flagging ledger-vs-bank discrepancies (no false positives).

## Grading (deterministic, no LLM)
`grade.py` scores four dimensions per task — **correctness** (value within tolerance),
**formula** (live formula, not a hardcoded literal), **cited** (citation resolves to a real
source file), and **fabrication** (penalty for out-of-rubric keys / citations to non-sources).

```bash
# grade one task's output dir
python grade.py nb-01-company-profile <output_dir>
# grade the whole slice (expects <outputs_root>/<task>/outputs.json)
python grade.py --all . <outputs_root>
```

## Self-test (proves the grader, no agent run)
```bash
python grade.py --all . _selftest_good   # -> mean ~1.0
python grade.py nb-01-company-profile _selftest_bad/nb-01-company-profile   # -> low score
```

## How the agent plugs in
Run NodeAgent on each `prompt.md` with that folder's source files mounted; have it write the
deliverable + `outputs.json` into an output dir; then `grade.py`. This is the **non-BTB OFF**
column of the diagnostic scorecard.
