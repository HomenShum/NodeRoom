# Room UI Contract — Parity Audit (live prod)

**Contract:** `NodeRoom Web - Room UI Contract (standalone).html` — a component/state
spec: 8 regions keyed to `fx-*`/`sc-*`/`rm-*`/`trc-*` classes. Mandate (its own footer):
**"match tokens + behavior, not pixels."**

**Method:** rendered the contract (unpacked its bundler) to read the real spec, then
created a fresh live room on `https://noderoom.live` (room `NRZ14TO33N0`) and read the
real DOM/computed styles per region. No claim is made without a DOM receipt — the exact
failure mode of PR #186, which shipped the contract *doc + screenshots* but not the
implementation (verified: `origin/main:src/ui/RoomShell.tsx` still has the crammed bar).

**Date:** 2026-07-07 · Auditor: Claude (owns end-to-end; Codex #186 not trusted).

## Verdicts

| # | Region (contract class) | Verdict | Live-prod receipt |
|---|---|---|---|
| 01 | Top bar `.fx-top` | **GAP (definitive)** | 9-button bar: `invite <code>` (contract=bare code), `.r-pill-auto` agent-commits pill, `.r-focus-mode-control` focus pill, 3 toggles, bell — all IN the bar; `.r-app` `background-image: radial-gradient(...)` twin-glow ON; `.r-mark` `box-shadow: rgba(217,119,87,.32) 0 4px 12px` bloom ON. Contract 01 = brand mark, bare code pill, presence, icon button — clean. |
| 02 | Room Binder `.fx-side` | **Mostly aligned** | Nested tree w/ section headers + counts present (Pinned·Recent·Workbooks·Docs·Review·People). Finer: calm meta-floor (`.r-file .fm` opacity .45→1) + section naming vs contract — pending. |
| 03 | Center tabs `.fx-tabs` | **Pass (core)** | CORRECTION (workflow verify): prod tabs are `.r-tab` only — Artifact.tsx emits **no** `fx-tab` (earlier note was wrong). Active-tab UNDERLINE **is present** via `box-shadow: inset 0 -2px 0 var(--accent-primary)` (styles.css:788), not a filled box. Deferred polish (not shipped): active-icon accent-ink + resting-icon dim — naive rule tinted the close-X (selector-scope bug caught in verify); needs icon-scoping. |
| 04 | Dataframe grid `.fx-sheet` | **PENDING — needs populated room** | Status chips `.fx-st`, row affordances `.fx-src/.fx-lock/.fx-owner`, cell states `.fx-sel/.rm-cellin/.rm-wet` all require seeded data + agent activity a fresh room lacks. Won't fake. |
| 05 | Public chat `.fx-chat` | **Structurally present** | Composer + `Room`/`Private` segmented present. Receipt states (`.sc-run`, `.fx-vpill`, agent run/edit receipts) need agent activity — pending. |
| 06 | Pipeline status `.fx-status` | **PASS (structural)** | `.r-spine` present with `Intake(done)·Evidence(done)·Draft(now)·Review(next)·Export(next)` — matches contract step states done/on/pending. |
| 07 | Center views (wall·notebook·trace) | **PENDING — not inspected** | Requires opening the wall/notebook/trace surfaces (`.trc-row`, `.mw-note`, `.rm-vhead`). Pending. |
| 08 | People panel `.sc-ppanel` | **Structurally present** | People trigger present ("A◆ 1 live"); `.sc-prow/.sc-pst` person rows need the panel opened — pending. |

## Headline

"Far off from design parity" is **concentrated in Region 01 (top bar)** — the one
definitive, fully-verified gap, and the one PR #186 claimed but did not implement.
Regions 02/03/05/06/08 are structurally present / mostly-aligned (prod was built from the
same design handoff). Regions 04/07 need a *populated* room (agent activity + opened
views) to audit their states honestly — flagged, not faked.

## Fix order (per user: audit-all-then-fix)

1. **01 Top bar** — biggest, visible, verified. A complete fix already exists +
   e2e-verified on branch `claude/inspiring-newton-187f71` (clean bar, controls→settings,
   bare code, binder-open-on-wide, near-black bg, flat mark); needs rebase onto current
   `main` (post-#186) + live-DOM verification before "done".
2. **03** underline on active tab (if `::after` confirms the gap).
3. **02** calm meta-floor + section naming reconciliation.
4. **04 + 07** — re-audit in a populated room, then close.
5. **05/08** receipt + person-row states in a populated room.
