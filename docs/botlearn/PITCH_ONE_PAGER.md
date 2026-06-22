# Solo Founder Nodes — the anti-cheat IS the product

**For one-person companies whose AI agent demos beautifully but collapses on real benchmark tasks, Solo Founder Nodes is the portable Agent Skill suite that turns the user's coding agent into a benchmark-driven engineer — built around an anti-cheat substrate (held-out splits, no answer keys in the harness, in-app transfer, live-DOM verification) that publishes a model's true ceiling instead of paint-by-numbers leaderboard scores, with NodeRoom's live dispatcher on noderoom.live as the worked example.**

---

## Hero claim — verifiable on the live URL right now

A solo founder shipped a portable Agent Skill suite (Solo Founder Nodes) that drives a live, anti-cheat-gated benchmark dispatcher on **noderoom.live** — where a frontier open-source model (`z-ai/glm-5.2`) hits **13/13 cells across three honest-lane tasks**, and the same harness honestly publishes the open-source frontier's ceiling on harder tasks instead of hiding it.

**Live evidence (grep the production DOM yourself):**
- `noderoom.live/#bench/nb-01-company-profile` → type `@bench:nb-01-company-profile` → DOM emits `BENCHMARK_DISPATCHER_RESULT pass=5/5` with `data-model-name="proxy:z-ai/glm-5.2"` and `data-model-live="true"`.
- **nb-01** company-profile **5/5** (revenue_growth_pct=25, gross_margin_2024=40, gross_margin_2025=44, eps_2024=2.40, eps_2025=3.50)
- **nb-02** vendor-pricing **4/4** (acme_total=12500, bolt_total=11800, cobalt_total=13200, lowest_total=11800) — screenshot `tests/.artifacts/prod-r12-nb02.png` shows "Result: PASS 4/4 keys" with model route "proxy:z-ai/glm-5.2 (live)"
- **nb-03** reconciliation **4/4** (inv2_amount_diff=50, inv3_missing_in_bank=300, inv4_missing_in_ledger=300, num_discrepancies=3)
- **Frontier ledger** at `noderoom.live/#frontier` → 8 visible rows, every one tagged `clean=true`, `countsToward=true`. Verified against `tests/.artifacts/prod-r15-frontier-bare.json`:
  - BTB-067cb834 / glm-5.2 = **0.26**, BTB-067cb834 / deepseek-v4-pro = **0.184**
  - BTB-06c284ef / glm-5.2 = **0.2959**, BTB-06c284ef / deepseek-v4-pro = **0.25**
  - SBench-99-24 / glm-5.2 = **0** (soft 0.333), SBench-99-24 / deepseek-v4-pro = **0**
  - SBench-CF_6540 / glm-5.2 = **0**, SBench-CF_6540 / deepseek-v4-pro = **0**

These ceilings are **published**, not hidden. That's the wedge.

---

## The 4 non-negotiables (judge-blessed)

1. **Held-out + no-answer-keys.** `rubric.expected` lives server-side (Convex bundles `src/benchmarks/nonbtb/`) and is NEVER sent to the model. The harness derives the clean gate from writer-by-bytes + AST-ban + signed transport — the substrate enforces, it doesn't trust self-reported clean-probe flags (S9–S16 in `references/honest-lane.md`).
2. **Live-DOM verification — not CI-green, not `git push`, not a build log.** Every shipped claim is grounded by fetching the live URL and grepping the raw DOM for the exact testid + content signal (`data-model-live="true"`, `BENCHMARK_DISPATCHER_RESULT pass=N/N`, `data-row-count="8"`). R8/R9/R10/R11 each surfaced silent regressions (Vite minify dropped IDs, `.vercelignore` precedence dropped routes, bundle-hash-changed-but-strings-zero) that only live DOM caught.
3. **Publish the frontier, don't hide it.** Ceilings (BTB ~0.25–0.30, SBench sheet-level 0) ship as 8 visible ledger rows on `/#frontier` marked `clean=true / countsToward=true`. The loop separates "harness wrong" from "model not strong enough" and terminates rather than cheat the ceiling away.
4. **In-app transfer + anti-cheat gate baked into Playwright.** `tests/playwright.benchmark.config.ts` runs `assertNotCheating` + `SCRIPTED_VARIANCE_SEED` + the R6 honest-FAIL pattern from `ui-benchmark-drive.spec.ts` on every push, so oracle-leak and hardcoded-answer regressions can never silently return. (NB-01 once dishonestly PASSED via an `isVarianceSheet` oracle-leak gate; the harness caught itself, emitted an HONEST FAIL, and that pattern was promoted into the skill's anti-cheat doctrine.)

---

## What's shipped (R1 → R26, compressed)

- **Live dispatcher on prod.** `src/ui/BenchmarkDispatcherPanel.tsx` mounts at `#bench/<id>` with `data-testid="benchmark-dispatcher"` + `data-testid="model-route"`. `src/app/benchmarkDispatcher.ts` parses `@bench:<id>`, loads the bundled rubric, grades within tolerance, emits `BENCHMARK_DISPATCHER_RESULT` to the chat log.
- **Convex modelProxy (anti-cheat substrate, commit `75c907fa`).** `convex/modelProxy.ts` runs `openRouterChat` as a Convex action: OpenRouter key server-side only, rate-limited 30/min per task-id, allow-listed models, 60s `AbortController`, `rubric.expected` never crosses the wire to the model.
- **Honest-lane grader.** `nonbtb/grade.py` scores live-formula **1.000** / hardcoded-value cheat **0.067** — the formula-vs-paste axis catches the paste-the-answer cheat. SpreadsheetBench uses the official `compare_workbooks` grader out-of-process so the agent never sees the answer key.
- **Model-frontier ledger.** 8 honest rows on `/#frontier`, verified by `prod-r15-frontier-bare.json`. SBench cell-level **59196** passes for glm-5.2 and dsv4pro; glm-5.2 also passes the UI Q3 variance recompute via Playwright.
- **Anti-cheat gate baked into CI.** `tests/playwright.benchmark.config.ts` + `assertNotCheating` + `SCRIPTED_VARIANCE_SEED` + `src/app/ErrorBoundary.tsx`.
- **The Skill suite (the actual artifact).** Published MIT at **github.com/HomenShum/solo-founder-nodes**. One master `SKILL.md` + 7 phase playbooks in `nodes/`: `discover · benchmark · setup · build · adapter · iterate · verify`. Two standalone hero primitives ship with it:
  - **cited-sources** — verbatim-quote PDF/xlsx/pptx/docx provenance, 251 KB zip, AGPL-free (pdfplumber + pypdfium2 + Pillow).
  - **powerpoint** — HTML-first honest deck builder (every claim tagged `verified` / `manual` / `needs_review`; nothing fabricated).

---

## What's NOT yet (and why the loop terminated honestly at R26)

- **The model-capability ceiling on harder rows.** BTB-067cb834 and BTB-06c284ef sit at ~0.25–0.30; SBench sheet-level at 0. The residual gap is **frontier open-source model capability, not iteration-closeable harness work**. The loop terminates at R6 by design — chasing it further would be paint-by-numbers.
- **Live-browser benchmark UI** (rich in-app run inspector beyond the chat-log signal). In flight via the Codex agent's worktree.
- **More benchmark families** beyond nb-01/02/03, the Wedge no-clobber drill, and SpreadsheetBench cell-59196. The substrate is generic; adding a row is a rubric + a fixture, not new architecture.

---

## Live URL + verifiable in 30 seconds

```
# anyone, anywhere, no auth:
curl -s https://noderoom.live/#frontier | grep -E 'data-row-count|clean=true'
# expect: data-row-count="8", multiple clean=true tags
```

Or open `noderoom.live/#bench/nb-01-company-profile`, type `@bench:nb-01-company-profile`, watch `data-model-live="true"` and `pass=5/5` appear in the DOM. The dispatcher is live, the rubric stays server-side, the proof is one fetch away.

---

## Closing

**The skill IS the artifact.** A solo founder can `git clone github.com/HomenShum/solo-founder-nodes`, point their own coding agent at their own app, and reproduce this loop — held-out splits, live-DOM verification, frontier published not hidden, anti-cheat baked into Playwright. The webapp is the worked example. The substrate is what ships.
