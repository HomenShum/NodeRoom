# Surface web-design audit — every surface vs the top-web bar (2026-06-28)

> Triggered by: *"is every surface following the top web designs, like how we changed the spreadsheet
> cell editing?"* Method: a 15-agent research→audit workflow — each surface's **web best-practices were
> researched first** (Airtable/Retool/Notion/Quadratic, Notion/Coda, Linear/Perplexity/Claude, Linear/
> Height/Raycast, Perplexity/Elicit, VS Code/Arc, Refactoring UI/Geist/Stripe/NN-g), then the NodeRoom
> surface was scored against it. Extends `DESIGN_BENCHMARK.md` + `open-design-redesign/DESIGN.md`.

## Verdict

**No — not every surface is at the bar, and the headline is uncomfortable: the spreadsheet cell-editing
fix you set as the reference standard is not actually shipped on this branch for the surface it names.**

The design **system** is at-bar (quiet UI, color-as-signal, honest empty/derived states, focus rings,
button hierarchy, master-detail trace). But several **surfaces** that compose from it stop one layer
short of the top-web bar — and the recurring root cause is *the right pattern already exists elsewhere in
the same file/CSS but hasn't been ported onto the surface that needs it* (an auto-grow `.r-cell-editor`
exists but the grid uses a single-line `<input>`; inbox status pills exist but Room Home inventory doesn't
use them; the `classifyEvidence` honesty gate exists but evidence cards don't call it).

## Scorecard

| Surface | Score | Headline |
| --- | --- | --- |
| **Spreadsheet / data-grid** | **3.5 / 10** | The reference fix isn't shipped here: primary grid is read-only, editor is a single-line input, cells nowrap + fixed 27px — no auto-grow, no soft-wrap, no dynamic row height, no keyboard grammar. |
| Work-surface tabs | 5 / 10 | Solid quiet tab skeleton, but close-X is keyboard-unreachable, rename is a `window.prompt`, no dirty indicator, no overflow dropdown. |
| Document / notebook editor | 5.5 / 10 | Calm chrome, but reads too small/dense (13–14px, paragraph gap ≈ line gap, px not ch) and typed links are invisible (no Tiptap Link). |
| Chat + AI composer | 5.5 / 10 | Excellent input mechanics, but transcript fails two load-bearing rules: no capped reading column (mobile = messenger bubbles) and no in-place Stop / Regenerate. |
| Room Home / command center | 6 / 10 | Right skeleton, but the inventory throws away the state a command center needs — no status pill / last-activity / owner, no triage groups, no needs-you sort. |
| Evidence / citations / trace | 7 / 10 | Top-bar structure undercut by one P0: confident quote + precise % shown on **unverified** citations (the honesty gate exists one layer down, unwired). |
| Global primitives | 7 / 10 | B+ system above the bar, but declared-vs-practiced gaps: 4/8/12 spacing scale used once (UI runs on a 7/9/11/13 micro-scale), blue `#2563eb` fallbacks leak into a terracotta product, Landing modals lack Escape/focus-trap. |

## Biggest wins (the cell-editing-fix tier)

1. **Actually land the cell-editing fix on the surface it names** — make GenericSheet editable and reuse
   the auto-grow `.r-cell-editor` textarea that already exists; drop `nowrap` + fixed 27px for soft-wrap +
   content-driven row height. Largest payoff: the primary grid (blank rooms, uploaded .xlsx, research) is
   the most-used data surface *and* it's your gold standard, currently half-shipped on one editor path.
2. **Make the chat transcript read like a 2024-2026 AI product** — cap the AI reply at ~68ch, kill the
   mobile messenger bubble for agent replies, add in-place Stop + Regenerate/Continue. Two P0s on the
   second-most-used surface; composer mechanics are already excellent (5.5 → ~8).
3. **Wire the existing honesty gate into evidence cards** — stop showing a confident quote + precise % on
   unverified citations; add an `unsupported` state. The machinery (`classifyEvidence`, `cite_in_file`)
   exists one layer down — a wiring job, on the cardinal trust surface of a diligence product.
4. **Make Room Home a real command center** — carry the `updatedAt`/status/owner the store already has
   (dropped at `Artifact.tsx:245`); add status pills + last-activity + triage groups + needs-you sort.
5. **Pay down global-primitive debt that compounds everywhere** — snap micro-spacing to the 4/8/12 token
   scale, delete the blue `#2563eb` foreign-system fallbacks, give Landing's modals the native `<dialog>`
   keyboard contract. Cheap, deterministic, every surface inherits the improvement.

## Prioritized fixes

| # | P | Effort | Surface | Fix |
| --- | --- | --- | --- | --- |
| 1 | P0 | L | Data-grid | Make GenericSheet cells editable through the existing `commit()`+CAS path; replace the single-line `<input class="r-cell-input">` (`Artifact.tsx:931`) with the auto-grow `<textarea>` already in repo (`.r-cell-editor`). Gate locked/proposed cells. |
| 2 | P0 | M | Data-grid | Soft-wrap + dynamic row height in display cells: `white-space:normal; word-break:break-word; overflow:visible; vertical-align:top`, drop fixed `height:27px` → `min-height` (`styles.css:696`). Ellipsis only behind a Compact density preset. |
| 3 | P0 | S | Chat | Cap AI reply at `max-width:68ch` (~720px) desktop; on mobile render `.na-bubble.agent` full-width (drop bubble radius/align), keep the gradient bubble only for `.me`. |
| 4 | P0 | M | Chat | In-place **Stop** during streaming (swap send→square, AbortController) + **Regenerate/Continue** on the last agent message after it ends. |
| 5 | P0 | M | Evidence | Gate the card's quote + confidence on a verbatim-quote-exists check; add `unsupported` to `EvidenceCardStatus`; suppress the % on unverified claims (`EvidenceCarouselArtifact.tsx:39`, `coachArtifacts.ts:59`). |
| 6 | P0 | L | Data-grid | Grid-level keyboard grammar: Arrow move, Enter/F2 edit, Tab/Enter commit+move, Esc cancel, Shift+Arrow extend, type-to-overwrite. |
| 7 | P0 | S | Tabs | Make the close-X a focusable `<button>` sibling (focus-within reveal) + middle-click + Ctrl/Cmd+W; keep it for the last tab. |
| 8 | P1 | M | Chat | Memoize markdown parse; buffer unclosed code fences mid-stream; add per-`<pre>` copy button. |
| 9 | P1 | S | Docs | Raise body to 15–16px; separate paragraph spacing from line spacing on `.r-wiki-doc`/`.r-brief-*`/`.r-note` (the Notion-2026 failure). |
| 10 | P1 | S | Docs | Add Tiptap Link extension + `a` styling so typed URLs are visible/clickable. |
| 11 | P1 | M | Room Home | Inventory: carry status pill + last-activity + owner; triage sections; sort by needs-you; row ellipsis. |
| 12 | P1 | S | Primitives | Landing modals → native `<dialog>` (Escape + focus trap + restore), or copy `GuidedTour` pattern. |
| 13 | P1 | S | Primitives | Kill token leaks: `var(--accent)`→`--accent-primary`; delete blue `#2563eb`/`rgba(59,130,246)` fallbacks. |
| 14 | P1 | L | Primitives | Snap ~80 micro-spacing literals (7/9/11/13/22) to the `--space-*` 4/8/12/16/24 scale, primitives first. |
| 15 | P1 | M | Chat | "Jump to latest" pill when scrolled up mid-stream; inline claim-bound `[n]` citations via the Trace Lens box. |
| 16 | P1 | M | Tabs | Replace `window.prompt` rename with inline edit; add per-tab dirty dot + confirm-before-close-dirty. |
| 17 | P2 | S | Docs | Move Note measure to ~68ch (`ch` on the prose container); tighten Wiki 76ch → ~68ch. |
| 18 | P1 | L | Data-grid | Density presets (Compact/Default/Comfortable, persisted) + name-box/value-bar (A1 + full value) + column resize. |
| 19 | P2 | M | Primitives | Port desktop skeleton screens for container loads (today bare "Loading room…"). |
| 20 | P2 | S | Evidence/Tabs | Bound the perpetual focus-box pulse to an arrival burst; add tab overflow dropdown + MAX (~12) eviction (BOUND). |

## Note
The cell-editing fix you described (auto-grow textarea, no maxHeight scroll) is **half-present**: an
auto-grow `.r-cell-editor` exists on one editor path, but the GenericSheet grid is read-only and the
`EditableCell` default editor is still a single-line `<input>` with `nowrap`/fixed-27px display cells.
Fixes #1, #2, #6, #18 finish it on the surface it names.
