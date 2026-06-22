# BTB Generalization Diagnostic — the anti-self-gaming guardrail

Purpose: measure NodeAgent's **true general** capability and prove (or disprove) that
BankerToolBench gains are real general capability, not per-task overfitting. Every harness
fix must lift **held-out** and **non-BTB** slices with the per-task materializers **OFF** —
otherwise it is overfitting and must be reverted.

Authored from the sweep data in `docs/eval/bankertoolbench-nodeagent-full-sweep-pass*.json`.

2026-06-21 correction: materializers OFF is necessary but not sufficient. The stronger standard is
`docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md`: derive the clean gate from receipts the agent
cannot author. Any score whose gate inputs come from harness payloads or summary files is a
provisional clean-probe metric, not a substrate-secure headline.

## Finding that motivates this doc (data, not opinion)

Aggregating all 27 non-dryrun sweep passes (`candidateModel = noderoom/nodeagent-general`):

- **Only 5 unique tasks have ever been run** (not 100): `btb-067cb834`, `btb-096a6840`,
  `btb-07727295`, `btb-06c284ef`, `btb-0fc7bc3c`. The other ~95 have zero runs.
- Each task's reward climbs pass-by-pass as its hand-coded writer was built:
  - `btb-067cb834`: **0.009** → 0.986 → 0.927 → **1.000**
  - `btb-096a6840`: **0.351** → 0.902 → 0.985 → 0.993 → **1.000**
  - `btb-07727295`: **0.109** → 0.906 → **1.000**
  - `btb-06c284ef`: 0.872 → … → **0.996**
  - `btb-0fc7bc3c`: → **0.976**
- The cleanest pre-materializer signal (`btb-067cb834` pass1) is **0.009** — the true
  general agent is ~near-zero; the ~1.0 finals are per-task `write_*_package` writers.
- **"general mode" still runs the materializers** (`_materialize_general_outputs` contains
  the `is_*_task → write_*_package` dispatch in `btb_noderoom_agent/harbor_adapter.py:4717`).
  So the `nodeagent-general` label does **not** measure the general agent.

Conclusion: there is currently **no measurement of the true general agent**, because the
materializers cannot be turned off. That is the root reason "no general true score" exists.

## Blocker to fix first (one surgical change)

Add a materializers-off switch so the general agent can be measured at all:

```python
# btb_noderoom_agent/harbor_adapter.py, inside _materialize_general_outputs, before the
# is_*_task dispatch (~line 4715):
if os.environ.get("BTB_DISABLE_MATERIALIZERS") == "1":
    family = None   # skip every is_*_task → write_*_package branch; emit only what the
                    # general NodeAgent runner produced. Receipts/log path unchanged.
```

This file is fleet-contended — make the change in a git worktree (or hand it to the fleet),
never inline on `main`.

## The three slices (run all with `BTB_DISABLE_MATERIALIZERS=1`)

| Slice | Tasks | What it proves | Expectation today |
|---|---|---|---|
| **Tuned** | the 5 written tasks above | regression floor for the writers (with materializers ON) | ~1.0 ON, ~0.009–0.35 OFF |
| **Held-out (BTB)** | 5–10 `btb-*` ids NOT in the tuned set | on-distribution generalization | unknown — this is the real number |
| **Non-BTB** | the authored set below | off-distribution generalization (the product lane) | unknown |

A harness fix **counts only if held-out AND non-BTB rise with materializers OFF** and the scorecard
labels whether the clean gate was substrate-derived or provisional.

## Non-BTB slice (authored — the generalization tripwire)

Same primitive class as BTB (messy sources → correct, cited Office/PDF deliverable), but not
BTB tasks. Each task = prompt + source files + a machine-checkable rubric.

- **NB-1 (xlsx, live formulas):** "From the provided 10-K excerpt (PDF) and shares-outstanding
  figure, build a one-page company profile: revenue growth %, gross margin %, and EPS — as
  **live formulas**, each output cell cited to its source page/line."
  Rubric: values correct ±0.5%; ratio cells contain a **formula** (not a hardcoded literal);
  every output cell has a citation receipt resolving to a real source locator.
- **NB-2 (pptx, table + citations):** "From 3 short vendor-quote PDFs, build a 1-slide pricing
  comparison with a totals table and per-line source citations."
  Rubric: all 3 vendors present with correct unit price + total; totals = a computed sum;
  each figure cited; no invented vendor/price.
- **NB-3 (docx/pdf, reconciliation):** "From two CSVs (ledger vs bank export), write a memo
  flagging every discrepancy with the cited amounts from each side."
  Rubric: every true discrepancy flagged, no false positives; each cited to the source row;
  refuses to assert a figure not in either CSV.

Grading mirrors BTB's spirit: correctness + **formula-vs-hardcode** + **citation resolves** +
**no fabrication**. (Build step: materialize the source fixtures + a deterministic grader.)

## Scorecard the diagnostic must emit (side-by-side)

```
slice         materializers   n   mean_reward   formula%   cited%   fabrication
tuned         ON              5   ~1.00         …          …        …
tuned         OFF             5   ?             …          …        …
held-out      OFF             N   ?             …          …        …
non-BTB       OFF             3   ?             …          …        …
```

The headline number we optimize is **held-out OFF** and **non-BTB OFF**. Everything else is a
footnote. Never report "BTB score" without the materializers state and the slice.

## Run protocol

1. Worktree + add `BTB_DISABLE_MATERIALIZERS` guard.
2. Pick 5–10 held-out `btb-*` ids (exclude the 5 tuned). Materialize the 3 non-BTB fixtures.
3. Run each slice via the existing sweep wrapper with materializers OFF, traces ON.
4. Emit the scorecard above + cluster the OFF-mode failures (source-fidelity / writer /
   requirement-inference / context / verification).
5. Run the S9-S16 anti-cheat checklist from `BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md`; record missing
   receipts before publishing any headline.
6. Fix the **largest cluster in the shared `src/nodeagent` layer** (never a per-task writer),
   re-run held-out + non-BTB OFF, keep only fixes that move both.
