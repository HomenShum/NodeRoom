# liveflow — reconciliation rules

The policy `reconcile.mjs` enforces. Tune the constants at the top of the script.

## Checks (reconcile % = passed / total)
1. **Per-category vs golden** — for each target category (Revenue, COGS, OpEx, …), the consolidated
   total must be within `tolerance` of the golden reference. One check per category.
2. **Per-entity foots** — each source ledger's entries must sum to its `reportedTotal` within
   `tolerance`. One check per entity. (If a source omits `reportedTotal`, the foot check passes.)

A categorization error (a cost in the wrong bucket) **passes every foot check** but **fails the
golden-reference check** — that gap is exactly what makes the golden reference worth running.

## Ship gate
`Shippable without review? = reconcile% ≥ shipBarPct` (default **95%**, override `--ship-bar`).
Below the bar → **NO**, and the process exits non-zero so it can gate a close or a CI step.

## Mis-key detection
An entry is mis-keyed when its description reads like one category but it is booked to another:
- **OpEx-natured** (`marketing`, `advertising`, `payroll`, `rent`, `G&A`, `software`,
  `subscription`, `sales & marketing`, `travel`, `legal`, `insurance`) booked to **COGS** → expected OpEx.
- **COGS-natured** (`materials`, `freight`, `inbound`, `manufacturing`, `inventory`, `fulfillment`)
  booked to **OpEx** → expected COGS.

## Queue (the follow-ups)
- **reconcile** — one task per mis-key: re-key it to the expected category. The report shows the
  post-fix total it reconciles to.
- **variance** — after applying the re-keys, any category still outside `tolerance` of golden gets a
  variance task with the residual (so a genuine variance isn't masked by, or confused with, a mis-key).

## Why a golden reference (not just cross-foot)
Cross-footing proves a source is internally consistent. It cannot prove the source is *right*. The
golden reference (last reviewed close, board plan, or tax basis) is the external truth the close is
measured against — the difference between "the math adds up" and "the numbers are trustworthy."
