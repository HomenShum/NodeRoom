# NodeRoom -- Design QA as a Production Ladder

> Polish is a **feature-by-feature production ladder**, not "make it prettier." Each surface must pass the
> 3-question gate; if a control answers none of the three, it is hidden, merged, or delayed until relevant.
> This doc fuses that product stance with a design-QA *flow that converges* (the fix for the perpetual-critic
> Gemini loop). ASCII-only on purpose (survives decks / READMEs / Windows-1252 pastes).

## 0. The gate: 3 questions

Every surface/control must answer:

1. **What is happening?** -- the current state is legible (active stage, who/what is working, what changed).
2. **Why do I trust it?** -- provenance/evidence/review-state is inspectable; status is honest (no fake success).
3. **What can I do next?** -- the single most-useful next action is obvious; everything else recedes.

Answers none -> **hide / merge / delay**. This is simultaneously the *design test* and the *stop rule*: a
feature is "done" for its tier when its surfaces answer all three -- it does not earn open-ended "more polish."

## 1. Why the old Gemini loop never finished

capture -> gemini critique ("find issues") -> fix -> repeat. It bikeshedded forever because it had **none**
of the four professional convergence mechanisms below. A strict VLM asked "what's wrong?" always finds
something; "needs-work" is its fixed point. Professional design QA is a **gate that terminates**, not a critic.

## 2. The per-feature QA gate (the improved flow)

Run in order; fail-fast. The VLM is the *last and smallest* step, not the whole loop.

| Stage | Does | PASS gate |
|---|---|---|
| **1. Deterministic** (no VLM) | a11y (axe/WCAG AA: contrast, names, roles, focus); layout integrity (no horizontal overflow desktop+mobile, no clipped/overlapping controls, no hover layout-shift); **design-lint** (accent only on allowed roles; spacing on the 4/8/12 scale; radius <= system; letter-spacing 0; tabular-nums on finance tables); `prefers-reduced-motion` honored | all checks green (objective) |
| **2. Baseline diff** (visual regression) | capture each surface; diff vs the **approved baseline** (Playwright `toHaveScreenshot` / Chromatic-style) | matches baseline -> **settled, skip the VLM**; differs -> a reviewed change |
| **3. Rubric VLM** (changed surfaces only) | score the 3 questions + craft dims (0-2) **against the approved reference image**, judge **before-vs-after** (pairwise), via a **multi-lens panel** (a11y-visual / color-discipline / typography / hierarchy) aggregated -- not open-ended | all 3 questions >= 1 (>= 2 for P0 features); no craft dim = 0; zero P0/P1 issues |
| **4. Triage + ship** | P0 = broken/misleading/a11y-fail/fails a 3-question; P1 = fix before ship; P2 = backlog | **SHIP when P0 + P1 clear**; P2 deferred |

### Convergence rule (the fix)
A feature's loop **terminates** when: Stage 1 green **AND** Stage 2 matches the approved baseline (or the new
state is human-approved as the baseline) **AND** Stage 3 rubric >= bar **AND** zero open P0/P1. **P2 goes to a
backlog, never another round.** Guard: stop if no *new* P0/P1 appears in one round (anti-oscillation). The
system never self-certifies "polished" -- a human approves the baseline (Chromatic/Percy model).

## 3. CI shape

- **Hard gates (block merge):** Stage 1 deterministic (axe / Lighthouse CI / design-lint) and Stage 2
  visual-regression (an unapproved diff blocks). These are objective.
- **Advisory (PR comment, non-blocking):** Stage 3 VLM rubric critique -- it is subjective, so it informs, it
  does not gate.
- **Human in the loop:** baseline approval. The convergence comes from *approved baselines accreting*, not from
  the VLM ever saying "done."

## 4. Feature inventory x the ladder

The 14 features, each climbing the ladder by the tier's 3-question bar. P0 = product trust, P1 = UX parity,
P2 = product depth.

### P0 -- product trust (the demo must be true)
- **Private artifact write ACLs + Convex fetch-source SSRF parity** -- "why trust it": the privacy boundary is real.
- **Live agent pause/recovery, demo-safe** -- visible `Resume agent` / `Increase budget`; "what next" is obvious mid-run.
- **Document upload/OCR as a real flow** (not preview + parser-plan metadata) -- "what is happening" to my file.
- **One full live Playwright story:** fresh join -> provider startup diligence -> streaming -> coach evidence -> private boundary -> draft handoff. (This is also the Stage-2 baseline source.)

### P1 -- UX parity
- Desktop Binder honest (persistent or clearly collapsed, not hidden by a test fixture).
- Real breakpoint subscription + resize-in-place tests.
- Slash commands -> Notion/Linear-grade command menu.
- Refs-only chat send.
- Mobile drawer contract: close, scrim, Escape, focus, safe-area.
- Parser warnings, import receipts, provenance, skipped ranges surfaced ("why trust it").

### P2 -- product depth
- Uploaded dataframes -> Attio/Notion typed objects: sort, filter, group, saved views, dedupe, editable typed fields.
- XLSX as a workbook: sheet tabs, workbook receipt, cross-sheet nav.
- Figma-style object presence: click avatar/agent to follow the exact cell/range/artifact.
- Trace activity -> restorable checkpoints.
- Persist shell prefs, coach analytics, job/run correlation.

## 5. Benchmark lens (per feature)

| Reference | Borrow for | Source |
|---|---|---|
| Notion | calm workspace, sidebar, docs/wiki/database hierarchy | https://www.notion.com/product/wikis |
| Quadratic | spreadsheet-native AI, data/code/result adjacency | https://www.quadratichq.com/quadratic-101 |
| Attio | typed object model, CRM workflows, connected records | https://attio.com/platform/data |
| Duolingo | progression loops without hiding the core task | https://blog.duolingo.com/how-duolingo-streak-builds-habit/ |
| Figma | multiplayer presence tied to exact shared objects | https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ |
| Cursor / Claude | verifiable agent goals; artifacts beside chat | https://cursor.com/blog/agent-best-practices , https://support.claude.com/en/articles/9487310 |
| Linear / Vercel / Stripe | low-noise execution UI, systemized design, operational trust | https://linear.app/ , https://vercel.com/geist/introduction , https://docs.stripe.com/dashboard/basics |

## 6. Research basis (web-verified)

Every stage above maps to an established professional practice -- this is not invented, it is how top teams
+ the tooling ecosystem already run design QA.

- **Triage + ship bar (Stage 4) = NN/G 0-4 severity.** Each issue gets an integer (4 catastrophe ... 1 cosmetic)
  from frequency x impact x persistence; the explicit ship rule is "ship when no sev>=3 remain." Maps P0=4,
  P1=3, P2<=2. [nngroup.com/articles/how-to-rate-the-severity-of-usability-problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/)
- **Convergence = a Definition-of-Done checklist (Stage's stop rule) = Primer / Carbon component lifecycle.**
  "Done" is a maturity milestone whose criteria ALL pass (functional tokens, responsive, ZERO axe violations,
  visual-regression coverage, a11y review) -- finite, not a reviewer's mood.
  [primer.github.io/contribute/component-lifecycle](https://primer.github.io/contribute/component-lifecycle/) ,
  [primer.style designer checklist](https://primer.style/accessibility/tools-and-resources/checklists/designer-checklist/)
- **Baseline diff (Stage 2) = Chromatic / Playwright snapshots / Applitools.** Each state diffs against an
  approved baseline; a human accepts intentional diffs as the new baseline; settled pixels are never
  re-reviewed -- the dominant convergence exit. [chromatic.com/docs/visual-tests](https://www.chromatic.com/docs/visual-tests/) ,
  [chromatic baselines](https://www.chromatic.com/docs/branching-and-baselines/) ,
  [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots) ,
  [applitools.com/platform/eyes](https://applitools.com/platform/eyes/)
- **Deterministic gates (Stage 1) = axe-core / Lighthouse CI / token-lint.** Deque: automated checks cover
  ~57% of real a11y issues; contrast + name/role/value + lang = ~58.8% and are fully automatable -- so most of
  what we were eyeballing is computable. Token-lint (no rogue hex / off-scale spacing) is conformance a VLM
  can't do reliably. [deque.com/axe](https://www.deque.com/axe/) ,
  [Deque 57% study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/) ,
  [Lighthouse CI](https://github.com/treosh/lighthouse-ci-action) ,
  [stylelint strict-value](https://github.com/AndyOGo/stylelint-declaration-strict-value) ,
  [Style Dictionary tokens](https://styledictionary.com/info/tokens/) ,
  [font-variant-numeric (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)
- **VLM-as-critic done right (Stage 3) = rubric + reference + jury.** Score a FIXED rubric to a pass bar (not
  open-ended "find issues"); ground on the approved reference image; ask "how far from THIS reference"
  (reachable) not "is this polished" (unreachable); a 3-critic majority jury beat a single critic by +8.4ppt
  precision; control verbosity/position bias, temp 0.2, n=3 median at the bar.
  [LLM-as-jury (arXiv 2404.18796)](https://arxiv.org/abs/2404.18796) ,
  [G-Eval (arXiv 2310.08491)](https://arxiv.org/abs/2310.08491) ,
  [eugeneyan LLM evaluators](https://eugeneyan.com/writing/llm-evaluators/) ,
  [self-refine](https://learnprompting.org/docs/advanced/self_criticism/self_refine) ,
  [heuristic eval (multi-evaluator)](https://www.nngroup.com/articles/usability-problems-found-by-heuristic-evaluation/)
- **The ritual = async design critique + a dedicated Design-QA step** (build-vs-spec on a fixed checklist with
  computed evidence) -- how top teams (Stripe) ship quality. [Atlassian async critique](https://www.atlassian.com/blog/loom/asynchronous-design-critique) ,
  [Stripe quality (Katie Dill)](https://creatoreconomy.so/p/how-stripe-crafts-quality-products-katie-dill) ,
  [what is Design QA](https://overlayqa.com/blog/what-is-design-qa/)

### The convergence rule, precisely (the perpetual-critic kill switch)
STOP and ship when ANY of: (a) candidate **matches the approved baseline** within the perceptual threshold
(dominant exit -- a settled screen is never sent to the VLM); OR (b) the **SHIP bar** is met (count(P0)==0 AND
count(P1)==0; rubric mean >= 4/5, no dimension < 3/5), P2s auto-deferred to a selector-keyed backlog; OR (c)
the **bounded-round cap** fires (no new P0/P1 for K=2 rounds, or MAX_ROUNDS=3). Baseline promotion needs an
explicit human `--update-snapshots`. Finite by construction because the VLM is asked a *reachable* question
(distance from a reference), not an *unreachable* one (is this polished).

## 7. How this maps to what we already have

- Stage-1 design-lint: the color-as-signal / spacing / tabular-nums rules we just shipped become *assertions*,
  not eyeballing.
- Stage-2 baseline: the existing Playwright capture (`founder-loop-capture.ts` etc.) -> `toHaveScreenshot`
  baselines per surface.
- Stage-3 rubric VLM: replace the open-ended `gemini-visual-polish.ts` with a **rubric + reference + pairwise**
  judge that returns a score and P0/P1/P2 (and only runs on changed surfaces).
- Stage-4 triage + the HALO eval harness gate the merge.

## 8. Implement-first sequence

1. **Real capture (S1).** Replace the `founder-loop-capture.ts` stub with reused `e2e/state-captures.spec.ts`
   + `emulateMedia({reducedMotion:'reduce'})`, pinned viewport/DPR, dynamic-data masking, and a blank/render-
   failure hard-fail. Nothing downstream works until capture is real. (Also fixes the worktree node_modules
   junction issue we hit -- run capture from the real `node_modules`.)
2. **Deterministic floor (S2).** `@axe-core/playwright` (WCAG 2A+2AA) + computed contrast on the 4 state colors
   + overflow (`scrollWidth>clientWidth`) + spacing-in-{4,8,12,16,20,24,32,48,80} + off-token-color sweep, each
   auto-emitting P0/P1 with selector + computed value. Moves ~60% of today's VLM load to ground truth.
3. **Token snapshot (S0).** Parse `src/app/styles.css :root` -> `tokens.json` (accent, `--space-*`, fonts) so
   deterministic gates and the VLM prose share one versioned contract that cannot drift.
4. **Approved baselines (S3).** Commit one passing PNG per surface/theme/width (keyed by token hash); wire
   Playwright `toHaveScreenshot` (perceptual threshold + masks). The single biggest convergence cure --
   `diff==0` skips the VLM entirely.
5. **Rubric panel (S4).** Rewrite `gemini-visual-polish.ts` into 3-4 lens prompts; swap
   `overall: polished|needs-work` for per-lens 0-5 rubric scores + the 3-question checks; pass the baseline as a
   reference image with the before/after question; bias controls (<=5 findings, temp 0.2, n=3 median). Forbid
   re-flagging anything S2 passed.
6. **Triage + convergence (S5/S6).** NN/G 0-4 -> P-level; SHIP bar = zero P0/P1; P2 -> `backlog.md` keyed by
   selector; the OR-of-three stop rule with MAX_ROUNDS=3. The terminal state the loop never had.
7. **CI gate (S7).** `.github/workflows/design-gate.yml` as a required, merge-blocking check on `src/ui/**` /
   `styles.css` (stylelint -> baseline diff -> axe -> VLM-on-diff). Deterministic floor blocks from day one; keep
   the VLM **advisory** until calibrated against a ~50-100 human-labeled golden set.
