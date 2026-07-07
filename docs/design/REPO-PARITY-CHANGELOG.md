# NodeRoom Repo → Room UI Contract — Parity Changelog

**What this is:** every change needed to bring the `noderoom` repo to UI parity with the
Room UI Contract (`docs/design/contract-spec-extracted.css`), mapped **contract region →
owning repo file → per-element delta → status**.

**Key finding:** the repo is mature — `src/ui/` already ships RoomShell, LeftRail, Chat,
PeoplePanel, TraceSurface, the mobile suite, and the receipts/notebook/trace CSS layers.
This is a **top-up, not a rebuild**. Most of it is **already applied on branch
`claude/inspiring-newton-187f71`** (3 commits ahead of `main`; tsc 0 src errors, design:audit
pass, 18/18 functional e2e). This changelog marks each item **DONE (branch)** or **REMAINING**.

**Memory Wall is present** (`.r-wall-inventory`/`.r-capture-card`, testids `wall-canvas`/
`postit-add`), implemented as an inventory/quick-capture surface — an **intentional divergence**
from the contract's pan/zoom post-it board, not a gap. Do NOT port `.mw-*`.

---

## Region 01 — Top bar (`.fx-top`) · owner `src/ui/RoomShell.tsx` + `src/app/styles.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| Brand mark `.fx-mark` | flat, no bloom | `.r-mark` box-shadow removed; `fx-mark` class added | **DONE (branch)** |
| Room code `.fx-invite` | bare code + copy | `.r-roomcode` dropped "invite"/Link2; `fx-invite` class | **DONE (branch)** |
| Icon buttons `.fx-iconbtn` | flat hover | `fx-iconbtn` on toggles + settings | **DONE (branch)** |
| Clean bar | mark·code·presence·settings only | agent-commits/focus/tour/theme/leave → settings panel; toggles → settings on wide (in bar on compact/mid) | **DONE (branch)** |
| Ground | near-black | `backgroundGlow` default `false` → `#09090b` | **DONE (branch)** |

## Region 02 — Room Binder (`.fx-side`) · owner `src/ui/LeftRail.tsx`

| Element | Contract | Change | Status |
|---|---|---|---|
| Search `.sc-search` | always-on | `.r-rail-search sc-search` always rendered | **DONE (#186, kept)** |
| Section headers `.sc-sec .fx-folder` | collapsible tree + chevron | `.r-tree-section` collapsible w/ `sc-sec fx-folder` | **DONE (#186, kept)** |
| Counts `.sc-count` | quiet ghost number | `em.sc-count` per section | **DONE (#186, kept)** |
| Item meta `.fx-item` | rests quiet, reveals on hover | `.r-file .fm` opacity .45→1 | already shipped |

## Region 03 — Center tabs (`.fx-tabs`) · owner `src/ui/panels/Artifact.tsx` + `styles.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| Active tab `.fx-tab.on` | underline not box | `.r-tab[data-active]` `box-shadow: inset 0 -2px 0 --accent-primary` | already shipped (**PASS**) |
| Active-icon ink | accent-ink tint | icon-scoped rule (exclude `.r-filetab-x`) | **REMAINING** (polish; low) |
| Resting-icon dim | `.55` opacity | icon-scoped, exclude pinned Home/Trace/Graph | **REMAINING** (polish; low) |

## Region 04 — Dataframe grid (`.fx-sheet`) · owner `src/ui/panels/Artifact.tsx` + `styles.css` + `panels/artifact-receipts.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| Status chips `.fx-st` | dot+word; correct semantic ink | pending amber→neutral; needs-review red→amber; failed red | **DONE (branch)** |
| Cell states | selection = terracotta ring, **never green** | draft/range green→terracotta ramp | **DONE (branch)** |
| Row affordances `.fx-src/.fx-lock/.fx-owner` | src popover, lock tint, owner-on-hover | verify present in `Artifact.tsx` | **REMAINING** (read `Artifact.tsx` → exact diff) |
| Rows / URLs | 44px rows, ellipsized URLs, in-cell `N src` popover, wet-ink on commit | audit `Artifact.tsx` cell render | **REMAINING** (read `Artifact.tsx`) |

## Region 05 — Public chat (`.fx-chat`) · owner `src/ui/Chat.tsx` + `styles.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| Agent-run receipt `.sc-run` | collapses to one line, expands to events + cite + vN→vN+1 | `.r-chat-run`/`-summary`/`-collapse` styled (were unstyled) | **DONE (branch)** |
| Day divider `.sc-day` | flanking hairlines + label | `.r-chat-day ::before/::after` + label type | **DONE (branch)** |
| Decision card | shows after research | dropped #186's `messages.length===0` gate | **DONE (branch)** |
| Composer/segmented | `.rm-chatin/.fx-seg` | existing `.r-lane` segmented is token-equivalent | no change |

## Region 06 — Pipeline status (`.fx-status`) · owner `styles.css` (`.r-spine`)

Verified **PASS** — `Intake·Evidence·Draft·Review·Export` with `done/now/next`. No change.

## Region 07 — Center views · owner `src/ui/panels/TraceSurface.tsx` + `src/ui/panels/trace-run.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| Trace cost `.trc-cost` | per-span cost + `.spike` | `.trc-cost` CSS added (staged; no fabricated per-span cost — `RunSpan` has no cost field) | **DONE (branch, staged)** |
| Trace cite `.trc-cite` | evidence quote card | prod cites on Records view (`.r-tracevu-*`) — per-view divergence | no change |
| Wall `.mw-note` / in-view `.rm-vhead` | post-it board / in-view header | prod inventory-wall + tabbed work-surface — intentional divergence | no change |

## Region 08 — People panel (`.sc-ppanel`) · owner `src/ui/PeoplePanel.tsx` + `src/ui/people-panel.css`

| Element | Contract | Change | Status |
|---|---|---|---|
| `viewing` status ink | `--info` (`#5E6AD2`) | `.r-people-st.viewing` `--info-ink`→`--info` | **DONE (branch)** ⚠ design sign-off |
| Person rows `.sc-prow/.sc-pst` | role groups + Follow | present + keyboard/pressed states | already shipped |

---

## Remaining work (in build order)

1. **Read `src/ui/panels/Artifact.tsx`** → exact diffs for Region 04 grid structure (44px rows,
   ellipsized URLs, `N src` popover, lock tint, wet-ink) and Region 03 tab-icon polish. *(1 file read.)*
2. **Region 03 icon polish** — icon-scoped accent-ink + resting-dim (avoid tinting `.r-filetab-x`).
3. **Region 08 sign-off** — confirm `viewing` = `--info` (saturated) vs the prior deliberate `--info-ink`.
4. **`:5301` visual baselines** — run `design-baseline` against a build; `--update-snapshots` intentional ones.
5. **Ship** — merge branch → `main`; live-DOM verify each region on `noderoom.live` (a populated room for 04/07 states).

## What is already on `main` vs the branch

- `main` (post-#186): binder tree + `fx-*` classes + opt-in tour (broken test) + `messages.length===0`
  decision gate (broken) — **top bar still crammed**.
- Branch `claude/inspiring-newton-187f71`: everything marked **DONE (branch)** above, + the two #186
  regressions fixed (tour auto-start restored, decision card ungated). This branch **is** the parity update.
