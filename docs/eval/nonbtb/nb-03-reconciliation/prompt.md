# NB-03 — Ledger vs bank reconciliation

Sources: `ledger.csv` and `bank.csv` — each has columns `id, amount`.

Find every discrepancy between the two and produce:
1. **`reconciliation.md`** — a short memo listing each discrepancy with the cited amounts.
2. **`outputs.json`** — gradeable discrepancies, each citing the source(s):
   - `inv2_amount_diff` : ledger amount − bank amount for the id that exists in both but differs
   - `inv3_missing_in_bank` : amount of the id present in ledger but absent from bank
   - `inv4_missing_in_ledger` : amount of the id present in bank but absent from ledger
   - `num_discrepancies` : count of distinct discrepancies

Rules: ids that match exactly are **not** discrepancies — do not report them (a false positive is
penalized). Do not assert any amount not present in a source file.
