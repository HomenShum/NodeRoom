# State-capture vision judge — granular component/interaction audit

The execution of [`DESIGN_QA_HANDOFF_PLAN.md`](DESIGN_QA_HANDOFF_PLAN.md). Where the GIF judge
([`../eval/GIF_JUDGE.md`](../eval/GIF_JUDGE.md)) scores motion, this scores **every component in
every discrete state** — default, hover, focus, disabled, busy, error, empty, locked, proposal —
across themes and widths.

```bash
npm run qa:states        # drive the real memory-mode app to each state, screenshot it
npm run qa:judge-states  # gemini-3.5-flash scores each surface's state set
```

Captures → `docs/qa/state-captures/<surface>/<state>--<theme>--<width>.png` + `manifest.json`
(each capture carries a `mustBeTrue` line). Verdicts → `docs/qa/state-judge/<surface>.json`.
Five dimensions: `state_legibility`, `affordance_honesty`, `consistency`, `contrast`, `polish`.

## How this run was driven (and why it is trustworthy)

Two **independent** methods were run against the same UI and made to agree before any fix landed:

1. A **10-agent workflow** (`design-qa-execution`): 4 research lanes (tables/grids, chat/composer,
   motion, onboarding) reading open-codesign's 17 method skills + 25 brand refs + shadcn, then 6
   per-surface code auditors. Output: **64 findings (9 P0, 25 P1, 30 P2)** → `audit-fixes.json`.
2. The **vision judge** above, scoring the real captured pixels.

**They converged.** The judge's #1 landing finding (join code input has no visible focus ring) was
independently the workflow's #1 P0 ("CODE keyboard focus invisible; r-input-wrap:focus-within
exists at line 178; WCAG 2.4.7"), and a direct DOM probe confirmed it (`outline-style: none,
box-shadow: none`). Three methods, one bug. That triangulation is the trust: a finding that
survives a code audit, a vision judge, AND a computed-style check is real, not a model's vibe.

## What the loop FIXED (all cited to a convention)

**9 P0 (shipped):**
- Join code input had no focus ring (`outline:none`, no replacement) → `:focus-within` halo (WCAG 2.4.7)
- Join failure used a blocking `alert()` → inline `role="alert"` error (empty-states convention)
- Auto-allow switch — the highest-blast-radius control — was a bare `<button>` → `role="switch"` + `aria-checked`
- Upload busy was text-only → inline spinner + `aria-busy` (skeleton-vs-spinner rule)
- Upload error was a dead end → gained a **Retry** (empty-states error convention)
- Public-agent People row lacked the live-presence dot every human member had → added
- Failed/blocked long-job status rendered in neutral grey like a healthy job → `.r-tag.danger` (HONEST_STATUS)
- Guided-tour keydown ate Enter/Arrows while typing in a field → early-return when focus is in an input

**~18 P1 (shipped), each cited:** dead `.r-text-input` class given real styling; placeholder-is-not-
a-label (name field moved above its CTAs with a real label + example placeholder); send button
reflects the empty composer (muted + disabled, not a live accent button); send focus ring no longer
the same hue as its fill; inactive lane toggle gained a hover; `xl-cell` gained hover feedback;
keyboard-focusable research row gained a focus-visible ring; inert person rows stopped borrowing the
clickable hover; **selection grammar** — the open file row dropped its full accent border for a
background tint + a left accent bar + bold weight (Linear/shadcn: selection is a tint, never a hue
ring); **accent discipline** — three open-panel toggles stopped painting the top bar a row of orange
(active = a raised neutral surface); the agent-held lock badge stopped being a solid accent slab;
theme toggle + room-code copy gained accessible names/announcements; semantic `--danger`/`--warning`
tokens; metadata/timestamp/placeholder contrast lifted off `text-tertiary`.

## What the loop EXPOSED about the judge itself

A vision judge over multi-image state-sets has **higher variance than the single-GIF judge**
(±1–2 vs ±0.4): each surface bundles 3–7 images, and the model picks different nits each run
(`sheet` scored 6.8 one round and 5.6 the next on identical pixels). It also surfaced two
**capture-methodology** bugs that masqueraded as UI bugs until diagnosed:

- `:hover`/`:focus` do not survive `locator.screenshot()` (the element scrolls into view, moving
  the mouse off it). Fixed: capture hover/active states via a page screenshot clipped to the
  locator's box, which preserves mouse position.
- A `mustBeTrue` line that doesn't exactly match reality makes the judge truthfully penalize
  correctly-rendered UI (an early manifest claimed "Agent wiki is selected" when the open artifact
  was Q3 variance). The manifest is part of the test and must be accurate.
- Spring transitions caught mid-flight read as broken states (the auto-allow knob screenshotted at
  150ms of a 180ms transition looked stuck mid-travel). Fixed: settle wait > transition duration.

## Historical scoreboard seed (2026-06-11, regenerate with `npm run qa:judge-states`)

| Surface | States | Avg | Legibility | Affordance | Consistency | Contrast | Polish |
|---|---|---|---|---|---|---|---|
| landing | 3 | 6.2 | 6 | 7 | 6 | 5 | 7 |
| research | 3 | 6.2 | 7 | 7 | 6 | 5 | 6 |
| chat | 4 | 6.0 | 6 | 5 | 7 | 6 | 6 |
| leftrail | 3 | 6.0 | 6 | 5 | 6 | 7 | 6 |
| topbar | 7 | 6.0 | 7 | 6 | 6 | 5 | 6 |
| sheet | 5 | 5.6 | 5 | 4 | 6 | 7 | 6 |

This historical state-judge run seeded the design-quality work. The set climbed from a first-pass ~5.0 avg to ~6.0 after the cited fixes, then **plateaued in a
5.6–6.2 band that oscillates ±1 run-to-run** — the documented stop point (per the GIF judge's
plateau rule). The residual gap is dominated by judge variance and a few genuinely-hard
**light-theme** contrast items (the app is dark-first; ghost-button text and placeholders sit near
the AA line in light mode), not by unfixed P0/P1 defects. Honest call: ship the cited fixes,
document the plateau, do not inflate the rubric to clear a noisy 7.0.

Current UI/UX product-quality evidence now lives in
`docs/eval/design-quality/latest.json` and `docs/eval/design-quality/latest.md`.

## Residuals (named, not hidden)

- Light-theme ghost-button + placeholder contrast near the AA line (dark-first app; secondary theme).
- Editing-cell input text isn't sign-colored mid-type (the committed value is; the transient input isn't).
- Lock badges wear the agent's accent (the agent's brand color); the deeper fix is per-holder
  presence colors (plumbing `lk.holder` color through the badge) — tracked in the handoff register.
- ~30 P2 polish findings in `audit-fixes.json` deferred (touch-target escalations, slash-menu
  aria-selected, tour focus-return-on-close) — none block; ranked for a future pass.

## Related

- `e2e/state-captures.spec.ts` · `scripts/judge-state-captures.ts` — the runnable loop
- `docs/qa/audit-fixes.json` — the 64-finding audit (P0/P1/P2 with current→proposed)
- `docs/qa/DESIGN_QA_HANDOFF_PLAN.md` — the plan this executed
- `docs/eval/GIF_JUDGE.md` — the motion judge (the other half)
