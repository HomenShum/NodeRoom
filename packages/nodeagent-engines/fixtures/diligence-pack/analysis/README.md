# analysis/

Outputs the credit committee expects in this folder. Nothing here is pre-filled.

## comparison.json

The machine-readable table. Schema `diligence.comparison/v1`; the row model is documented in
`report/src/table.mjs` and checked by `report/test/`.

```json
{
  "schema": "diligence.comparison/v1",
  "asOf": "2026-06-30",
  "currency": "USD",
  "rows": [
    {
      "company": "Example Lending",
      "arrUsdM": { "value": 12.5, "citations": ["[src:sources/financials/example-financials.md#L11]"] },
      "yoyGrowthPct": { "value": 40, "citations": ["[src:...#L13]"] },
      "grossMarginPct": { "value": 52, "citations": ["[src:...#L24]"] },
      "monthlyBurnUsdM": { "value": 1.2, "citations": ["[src:...#L36]"] },
      "cashUsdM": { "value": 18.0, "citations": ["[src:...#L37]"] },
      "runwayMonths": { "value": 15.0, "citations": ["<cash citation>", "<burn citation>"] },
      "topRisk": { "text": "...", "citations": ["[src:sources/diligence-calls/example-call-notes.md#L41]"] }
    }
  ]
}
```

- Units: USD millions for ARR, monthly burn and cash; percent for growth and gross margin.
- ARR and growth are the restated figures when a diligence call restates them.
- `runwayMonths` = `cashUsdM / monthlyBurnUsdM`, one decimal, citing the cash and burn lines.
- `topRisk` is the top risk recorded in the company's diligence call notes.
- The cited line of every numeric metric must contain that number.

## comparison.md

The same table for people:

1. A markdown table, one row per company, each value followed by its citation, e.g.
   `| Example Lending | 12.5 [src:sources/financials/example-financials.md#L11] | ... |`.
   Runway is shown without a citation (it is derived from the cited cash and burn cells).
2. A section `## Exceptions and data availability` naming: every restated figure and why, every
   superseded document (by path) and that nothing was taken from it, and every restricted document
   (by path) as unavailable.
3. A ranking by runway, longest first.

## diligence.ipynb

A Jupyter notebook (nbformat 4, at least 6 cells, markdown and code) that loads `comparison.json`,
recomputes runway as cash / monthly burn, ranks the companies and explains the ranking and the
committee thresholds in markdown. See `.claude/skills/diligence-notebook/SKILL.md`.

## Validating citations

`.claude/skills/citation-validation/` does not exist until you create it through the Node skill
tools. Its script must take the markdown file as its first argument, resolve citation paths against
the current working directory (the workspace root) and exit non-zero on any citation whose line does
not contain the number written before it.
