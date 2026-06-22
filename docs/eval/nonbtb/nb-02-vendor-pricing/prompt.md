# NB-02 — Vendor pricing comparison

Source: `quotes.csv` — columns `vendor, unit_price, quantity`.

Produce in the output directory:
1. **`pricing.xlsx`** — a table with each vendor's total = `unit_price × quantity` **as a live
   formula**, and highlight the lowest total.
2. **`outputs.json`** — gradeable totals (and the lowest total), each citing `quotes.csv`:
   `acme_total`, `bolt_total`, `cobalt_total`, `lowest_total`.

Rules: use only vendors present in the source. Do not invent vendors or prices.
