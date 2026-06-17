---
name: liveflow
description: Consolidate a multi-entity ledger (QuickBooks, Xero, NetSuite, or any per-entity JSON) into one close, reconcile it against a golden reference, catch mis-keyed entries that cross-foots miss, and gate on "shippable without review?" before numbers go to a board, investor, lender, or downstream report. Use for month/quarter close, multi-entity roll-ups, or any time figures from more than one accounting source must agree before they are trusted.
---

# liveflow — multi-entity close, verified before it ships

The finance agent for a one-person company: it pulls every entity's ledger, rolls them into one
period close, checks the result against a golden reference, catches the entry someone mis-keyed,
and refuses to call the numbers "done" until they actually reconcile.

## When to use
- Month / quarter / year close across more than one accounting system (QuickBooks + Xero + NetSuite, …).
- Any roll-up where totals from multiple sources must agree before they reach a board deck, investor
  update, lender, or a downstream model.
- You want a hard **"shippable without review?"** gate, not a vibe check.

## The loop
1. **Ingest** — read each entity's ledger (one JSON per source; see `examples/`).
2. **Consolidate** — sum by category (Revenue / COGS / OpEx / …) across entities.
3. **Golden-reference verify** — compare the consolidation to a trusted reference (prior reviewed
   close + board plan) within tolerance, and confirm each entity foots. Reconcile % = passed / total.
4. **Catch mis-keys** — flag costs booked to the wrong category (e.g. marketing in COGS). An entity
   can foot perfectly and the consolidation still be wrong; only the golden reference catches a
   mis-categorization.
5. **Gate** — `Shippable without review?` = reconcile % ≥ the ship bar (default 95%). If not, it says
   **NO** and exits non-zero — usable directly as a close / CI gate.
6. **Queue** — emit the exact follow-ups: re-key each mis-key, plus a variance task for any residual
   category miss that remains after the re-keys.

## Run it
```bash
node scripts/reconcile.mjs                 # examples/ → the Q3 demo
node scripts/reconcile.mjs ./my-ledgers    # your own per-entity JSON + a golden.*.json
node scripts/reconcile.mjs --json          # machine-readable (pipe into the next agent step)
node scripts/reconcile.mjs --ship-bar 99   # stricter gate
node scripts/reconcile.mjs --trace-out trace.json   # also emit a visual trace bundle
```
Exit code is `0` only when shippable — so it drops into a CI step or a pre-send hook unchanged.

## Input shape
Source ledger (`examples/quickbooks.q3.json`, …):
```json
{ "entity": "QuickBooks", "period": "Q3-2025", "reportedTotal": 2270000,
  "entries": [ { "id": "QB-COGS", "desc": "Q3 cost of goods sold", "category": "COGS", "amount": 500000 } ] }
```
Golden reference (`examples/golden.q3.json`):
```json
{ "period": "Q3-2025", "reference": "FY24 reviewed close + Q3 board plan",
  "targets": { "Revenue": 4200000, "COGS": 1550000, "OpEx": 1100000 }, "shipBarPct": 95, "tolerance": 1000 }
```

## The demo (`examples/`) — what judges see
A 3-entity Q3 close. One mis-keyed entry hides in NetSuite: a $90K brand-marketing cost booked to
COGS instead of OpEx. Every entity foots; the consolidation still misses the golden reference on
**two** lines → **67% reconcile → "Shippable without review? NO"** → it queues the re-key and a
−$50K COGS variance. The reconcile %, the caught entry, and the verdict are all **computed**, not
scripted. See `references/reconciliation-rules.md` for the check + mis-key rules.

## Extending
- Mis-key rules (which descriptions read as OpEx- vs COGS-natured) are at the top of `reconcile.mjs`.
- Swap the golden reference for last quarter's reviewed close, a board plan, or a tax basis.
- `--trace-out` emits a bundle the **NodeRoom Trace tab** renders as a step-by-step provenance view
  (screenshots/logs per step), so the close is auditable, not just asserted.

## Activate as a Claude Code skill
Copy or symlink this folder into `.claude/skills/liveflow/` (project or `~/.claude/skills/`), then it
is invocable as `/liveflow`. It is self-contained — no install, no keys, no network.
