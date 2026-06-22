# Solo Founder Nodes — the anti-cheat IS the product

**For one-person companies whose AI agent demos beautifully but collapses on real benchmark tasks, Solo Founder Nodes is the portable Agent Skill suite that turns the user's coding agent into a benchmark-driven engineer — built around an anti-cheat substrate (held-out splits, no answer keys in the harness, in-app transfer, live-DOM verification) that publishes a model's true ceiling instead of paint-by-numbers leaderboard scores, with NodeRoom on noderoom.live as the worked example.**

---

## Hero claim — verifiable on the live URL right now

A solo founder shipped a portable Agent Skill suite that drives an honest model-frontier ledger on **noderoom.live** — where a reviewer can open one URL and see 8 documented model-capability ceilings from the same loop that ships the product.

**Live evidence (open the URL, grep the raw DOM yourself):**

- **`noderoom.live/#frontier`** → the Frontier Observations Panel renders an 8-row Convex-backed ledger (run id `model-frontier-2026-06-22`). Look for `data-testid="frontier-observations-panel"`, `data-testid="frontier-observations-runs"`, and the `.frontier-observations__table` verdict cells. This is the canonical honest-loop surface today.
- **`noderoom.live/#story`** → `LandingStory` + `StoryLab` — the seven-layer no-clobber walkthrough with a live engine-backed grid. 10+ `story-lab*` testids (`story-lab`, `story-lab-lease`, `story-lab-rebase`, `story-variance-cell`, `story-agent-send`, …) plus the `xl-grid` / `xl-cell` Excel-grid classes. Body length 7129 — the real walkthrough, not a screenshot.
- **`noderoom.live/`** → Landing with `data-testid="create-room"` / `"join-room"` / `"join-room-code"`. From here a real user can join a fresh room and watch `@nodeagent` (the cheap default model, routed adaptively) fill the visible sheet.

Anyone, anywhere, no auth:

```
curl -s https://noderoom.live/#frontier | grep -E 'frontier-observations-panel|frontier-observations-runs'
# expect: both testids present, table rendered, 8 rows of ledger verdicts
```

---

## The journey honestly — proof the loop works

We shipped a benchmark **dispatcher v1** in earlier rungs (R7–R11): `#bench/<task>` route, `BenchmarkDispatcherPanel`, `@bench:<id>` chat seam, a `convex/modelProxy.ts` action holding the OpenRouter key, and a 13-of-13 cells run across nb-01 / nb-02 / nb-03 with the model route stamped into the DOM. That was real, and it worked.

Then the audit loop did its job. R20–R26 surfaced that "type `@bench:` in a special route and grade the result" is **paint-by-numbers** — the harness shape itself is a shortcut. A more honest anti-cheat needs a **fresh-room → live-browser → real-user-flow** pattern, where the agent has to plan, call tools, and write into the same surface a real visitor sees, with no benchmark-only code path.

So in **PR #36** we removed the dispatcher v1 substrate (≈1,644 lines deleted across `benchmarkDispatcher.ts`, `BenchmarkDispatcherPanel.tsx`, `convex/modelProxy.ts`, the two dispatcher Playwright configs, three dispatcher-only specs, and the `#bench` route block in `App.tsx`). The golden dataset, the grader, and the `tests/goldenDataset.test.ts` self-test gate were kept on purpose — they're the verification primitive, not the harness shortcut. The live-browser benchmark UI lane (`codex/all-deliverable-benchmark-ui`, currently in flight) replaces the dispatcher with **deliverable-type coverage** driven from the real room UI.

This is what the four non-negotiables look like in practice: when the substrate found its own shortcut, the loop deleted the shortcut rather than tune around it.

---

## The 4 non-negotiables (judge-blessed)

1. **Held-out + no-answer-keys.** Rubrics in `src/benchmarks/golden/` (kept across PR #36) stay server-side; the model never sees the expected values. The honest-lane grader (Docker-free TS port of the original `grade.py`) is fronted by `tests/goldenDataset.test.ts` as an accept-good / reject-bad self-test gate.
2. **Live-DOM verification — not CI-green, not `git push`, not a build log.** Every shipped claim is grounded by fetching the live URL and grepping the raw DOM for the exact testid + content signal. The current verifiable signals are `frontier-observations-panel`, `frontier-observations-runs`, and the 10+ `story-lab*` testids on `#story`.
3. **Publish the frontier, don't hide it.** Eight rows on `/#frontier` document where measured model capability stops. The loop separates "harness wrong" from "model not strong enough" and terminates honestly instead of cheating the ceiling away.
4. **In-app transfer, real-user flow.** `tests/real-room-cheap-e2e.spec.ts` + `playwright.real-flow.config.ts` is the PR-#36-blessed replacement for the deleted dispatcher harness: a real user joins a fresh room, asks `@nodeagent` (the cheap default model, via the live OpenRouter proxy through the adaptive route — **not** a frontier flagship), and the test grades the **visible** `r<row>__<col>` sheet cells against the nb-01 rubric (`revenue_growth_pct=25.0±0.1`, `gross_margin_2024=40.0±0.1`, `gross_margin_2025=44.0±0.1`, `eps_2024=2.40±0.01`, `eps_2025=3.50±0.01`). Convex-connected only — the OpenRouter key never reaches the browser.

---

## What's shipped (current evidence today)

- **`/#frontier` live on prod.** `src/ui/FrontierObservationsPanel.tsx` renders the 8-row model-frontier ledger from Convex (run `model-frontier-2026-06-22`).
- **`/#story` live on prod.** `LandingStory` + the live engine-backed `StoryLab` grid — the seven-layer no-clobber walkthrough, including a real working Excel-grid surface.
- **Wedge engine invariant (vitest).** `tests/wedge-drill.test.ts` asserts the no-clobber drill: host lock on `r_rev__variance` + concurrent agent write → host's `+24%` survives in canonical state and the agent's stale `+19%` is routed via semantic-rebase to public channel. The wedge isn't a slogan; it's an executable invariant.
- **Real-user fresh-room graded e2e.** `tests/real-room-cheap-e2e.spec.ts` against a Convex-connected dev server. Cheap default model, single send (admitted server-side via `convex/agentJobs.startPublicAsk`), graded against the in-tree golden rubric.
- **Server-side keys, enforced.** OpenRouter credentials live behind Convex actions; `npm run security:gate` enforces no direct provider egress from the browser bundle (CSP rules + source-file scan + optional `--dist` scan over the built JS for the literal provider hostnames).
- **Convex evalRuns + model-frontier table.** The 8-row ledger is a real Convex table (`kind: "model-frontier"`), not a static fixture.
- **The Skill suite (the actual artifact).** Published MIT at **github.com/HomenShum/solo-founder-nodes**. One master `SKILL.md` + 7 phase playbooks in `nodes/`: `discover · benchmark · setup · build · adapter · iterate · verify`. Two standalone hero primitives ship with it:
  - **cited-sources** — verbatim-quote PDF/xlsx/pptx/docx provenance, 251 KB zip, AGPL-free (pdfplumber + pypdfium2 + Pillow).
  - **powerpoint** — HTML-first honest deck builder (every claim tagged `verified` / `manual` / `needs_review`; nothing fabricated).

---

## What's NOT yet (and why that's honest)

- **A graded benchmark surface as a single clickable prod URL.** The dispatcher route gave that, but only by being a benchmark-only code path. The graded "cheap model passes nb-01 end-to-end" claim is verifiable today via `tests/real-room-cheap-e2e.spec.ts` against a local Convex-connected server — not by clicking a URL on noderoom.live. The replacement clickable surface lands with the live-browser benchmark UI lane (`codex/all-deliverable-benchmark-ui`).
- **More benchmark families** beyond nb-01/02/03, the wedge no-clobber drill, and SpreadsheetBench. The substrate is generic; adding a row is a rubric + a fixture, not new architecture.
- **The model-capability ceiling on harder rows.** The 8-row ledger on `/#frontier` documents where capability stops. The loop terminates by design instead of chasing it.

---

## Closing

**The skill IS the artifact.** A solo founder can `git clone github.com/HomenShum/solo-founder-nodes`, point their own coding agent at their own app, and reproduce this loop — held-out splits, live-DOM verification, frontier published not hidden, anti-cheat baked into a real-user-flow Playwright run. NodeRoom is the worked example. The substrate is what ships, and the proof that the substrate works is that it ate its own dispatcher when the dispatcher became a shortcut.
