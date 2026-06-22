# NB-01 — Company profile with live ratios

You are given two source files in this folder:
- `source_financials.csv` — columns: `year, revenue, cogs, net_income` (USD millions)
- `source_shares.txt` — shares outstanding (millions)

Produce, in the output directory:

1. **`company_profile.xlsx`** — place the raw inputs in cells, then compute, **as live
   spreadsheet formulas that reference those input cells** (not typed-in numbers):
   - revenue growth % (latest year vs prior year)
   - gross margin % for each year  = (revenue − cogs) / revenue × 100
   - EPS for each year = net_income / shares_outstanding
2. **`outputs.json`** — the gradeable summary, one entry per metric:
   ```json
   {
     "revenue_growth_pct": {"value": 25.0, "formula": "=(B3-B2)/B2*100", "cite": {"file": "source_financials.csv", "locator": "revenue 2024,2025"}},
     "gross_margin_2024":  {"value": 40.0, "formula": "=(B2-C2)/B2*100", "cite": {"file": "source_financials.csv", "locator": "row 2024"}},
     "gross_margin_2025":  {"value": 44.0, "formula": "...", "cite": {"file": "source_financials.csv", "locator": "row 2025"}},
     "eps_2024": {"value": 2.40, "formula": "...", "cite": {"file": "source_shares.txt", "locator": "shares"}},
     "eps_2025": {"value": 3.50, "formula": "...", "cite": {"file": "source_shares.txt", "locator": "shares"}}
   }
   ```

Rules: every figure must trace to a source file. Do **not** invent any metric not asked for.
If a value is not derivable from the sources, omit it rather than guessing.
