# Design → Prod UI/UX Parity Plan

## Status refresh — after the parity ship (`298fa06f` on main, 2026-07-03)

A large parity push landed after this plan was first written. Re-verified
against the new main; the picture now:

**CLOSED by the ship (visible in the scale-demo room):** status chips, owner
avatar chips, "6 of 14 cols" label, grid filter chips, in-cell `N src` cite
chips, in-grid lock rows/badges, fixed 44px rows + internal column scrolling,
receipts in chat (`v1 → v2` pill, "lock released", View row), binder search +
section counts, people & agents panel with live count, consolidated status
bar + pipeline footer, tabs overflow menu (`r-tab-overflow-menu`,
Artifact.tsx:218), `npm run design:audit` gate + scale-demo route
("NodeRoom at scale"). The Convex deploy follow-up also landed (generated
API regenerated, `as any` cast removed) and the private-notebook ACL was
tightened (owner's **private-scoped** agent required).

**REMAINING punch list (the real "fix prod" queue, in priority order):**

| # | Item | Verdict | Notes |
|---|---|---|---|
| 1 | Evidence chip hover POPOVER (quoted source + checkedAt) | MISSING | chips exist; popover is the differentiator's payoff |
| 2 | Per-cell version history + Restore (desktop) | MISSING | mobile has a stub Restore (MobileGrid.tsx:583, empty onClick); needs `elementVersions` log |
| 3 | Cell diff view ("View diff") | MISSING | receipts carry before/after; no UI |
| 4 | Stale/recheck chip on cells | PARTIAL | `staleAfter` typed, never rendered |
| 5 | True row virtualization | PARTIAL | hand-rolled 23-row render window (`SCALE_SHEET_RENDER_WINDOW`), no windowed scrolling |
| 6 | Landing: H1 "Diligence that shows its work" + looping demo + live metrics pill | MISSING | current H1 "Bring people and agents into the same room"; no metrics query |
| 7 | Calm mode (hover-reveals-apparatus layer) | MISSING | |
| 8 | Chat day dividers + agent-run collapse | MISSING | |
| 9 | Trace filters by kind AND person, grouped by run | MISSING | |
| 10 | Presence cursor ladder (2–3 stacked / 4+ cluster) + Follow-cursor | PARTIAL | flags + a Follow button exist; no ladder/cluster |
| 11 | ⌘K palette + j/k keyboard layer | MISSING | |
| 12 | Notifications/watch (instant/hourly/daily; watch row) | MISSING | net-new backend |
| 13 | Offline queue + `saving → synced · vN` indicator | MISSING | |
| 14 | Audit/evidence bundle export | MISSING | reuse `createFileArtifacts` |
| 15 | Mobile gap screens (Review tab, share/people/settings sheets, first-join, offline) | PARTIAL | Mobile base + settings exist; gap screens unenumerated |

The workstream sections below predate the ship — read them for the *how*
(file targets, backend inventory), filtered through the table above for the
*what's left*.

Sources: the six design artifacts in the Claude Design project (`NodeAgent Room`,
`NodeRoom Prod Fix Pack`, `NodeRoom States & Scale`, `NodeRoom Mobile at Scale`
+ `Mobile Gap Pack`, `NodeRoom Feature Map`, `NodeRoom Landing Directions`) as
summarized by the **Prod Parity Handoff** (2026-07-03), cross-checked item by
item against prod (`main` @ `9ec8b1a8`) by a repo verifier. 27 checklist facts
verified; verdicts inline below.

**The headline**: most of the "Prod needs" the designs call out already exist
as Convex data — evidence entries with url/snippet per cell (`CellPayload.
evidence`), lock/commit/presence events (`presenceClaims`, `locks`, `traces`),
mutation receipts with before/after versions, entity freshness windows
(`entityResearchCache.staleAfter`). Parity is ~70% a **surfacing** problem
(UI reads data that's already there), ~30% net-new systems (metrics endpoint,
per-cell version log, notifications, offline queue, command palette).

Two design rules govern everything:

> Desktop: **default state shows data, hover shows apparatus.**
> Mobile: **what desktop reveals on hover, mobile reveals in a bottom sheet.**

---

## P0-A · Grid fixes (bugs; data already exists)

Target: the desktop sheet in `src/ui/panels/Artifact.tsx` + `.r-sheet/.r-cell`
in `src/app/styles.css`. (The mobile grid already has #1/#2 — port, don't
reinvent: `src/ui/mobile/mobile.css:34,386`.)

| # | Design requirement | Prod verdict | Work |
|---|---|---|---|
| 1 | Fixed 44px row height; badges never stretch rows | mobile-only | Fixed row height + vertical clipping on `.r-sheet tr`; badges absolutely positioned |
| 2 | URLs ellipsize, full value on hover | mobile-only | `text-overflow: ellipsis` + `title` attr on cell text; kill any `word-break: break-all` |
| 3 | Status = dry chips (`complete · enriching · pending · needs_review · failed`) | MISSING | Status-value detector in cell renderer → chip component (reuse needs-review chip pattern from the notebook) |
| 4 | Selection ring terracotta, never green | MISSING (only overlay boxes have it) | Cell `:focus-within`/selected ring = `--accent-border`; audit for green rings |
| 5 | Owner column = avatar chips (chat identity language) | MISSING (initials exist elsewhere) | Owner-column detector → avatar chip (reuse member initials component) |
| 6 | Grid ends at data + "Add row"; hidden cols labeled "6 of 14 cols" | MISSING | Trailing add-row affordance; column-count label chip in sheet header |
| 7 | Invite code = accent object, one-tap copy | **BUILT** (`RoomShell.tsx:357`) | — |
| 8 | ONE status bar; walkthrough = dismissible toast | PARTIAL (bar is consolidated, `RoomShell.tsx:373`) | Verify pipeline+credits live in the one bar; make any walkthrough strip a toast |
| 9 | Single labeled Focus control; "auto-allow" labeled | **BUILT** (`RoomShell.tsx:377-379`) | — |

Effort: 1–2 days, CSS + cell-renderer work, no backend.

## P0-B · Receipts layer (the differentiator)

Backend mostly exists; this is surfacing.

| Design requirement | Prod data that already exists | UI to build |
|---|---|---|
| In-cell `N src` chip → hover popover (quoted source + checked time) | `CellPayload.evidence[] {label,url,snippet,confidence}`; cells already carry `data-evidence-class` | Evidence-count chip in cell corner; popover on hover listing quotes + links |
| Lock badges in-grid (`🔒 NA` + row tint) while agent writes; wet-ink commit pulse | `presenceClaims` (agent_intent/commit_lease) + `locks` — intent boxes already render | Add row tint + holder badge to the existing presence overlay; commit pulse animation on version bump |
| Agent chat messages carry receipts: quote + `v246 → v247` pill + View diff + "lock released" | `agentMutationReceipts {beforeVersions, afterVersions, affectedIds}`, `traces` | Receipt pill component in the unified agent stream parts; wire to receipts by jobId |
| Per-cell version history + Restore | **GAP**: only current version stored on `elements`; receipts capture agent befores only | New `elementVersions` append log (write in `applyCellEditCore`) + history popover + Restore (a normal CAS write); prune via retention |
| Stale chip (`3d`) for recheck-due cells | `entityResearchCache {staleAfter, validUntil}` per entity-facet | Join facet freshness → cell chip; "pull-down recheck" = re-enqueue research |
| Cell diff view | before/after in receipts (agent writes) + new version log (human writes) | Diff modal from version log |

Effort: 3–5 days. One schema addition (`elementVersions`), rest surfacing.

## P1-A · Calm mode (Linear-grade density)

Rule: default shows data, hover shows apparatus. Prod already did subtraction
passes; calm mode is the systematic version:

- Flat surfaces: hairlines instead of tinted panels; dot+word statuses;
  underline tabs.
- Hover-revealed: src chips, owner names, add-row, chat quick-actions;
  binder names-only with meta on hover.
- Implementation: a `data-calm` attribute on the room shell + a CSS layer;
  keep focus rings visible (a11y floor). Ship as the default, not a toggle,
  per the handoff's framing ("the prod screen corrected + Calm mode").

Effort: 2–3 days, almost entirely CSS.

## P1-B · Scale systems (grid + panels under load)

| Design requirement | Prod verdict | Work |
|---|---|---|
| Grid virtualization (windowed rows) | PARTIAL (`GENERIC_SHEET_CELL_WINDOW = 5_000` cap, no row windowing) | Windowed row rendering (hand-rolled or `@tanstack/react-virtual`) |
| Filter chips on grid | MISSING (exists in KnowledgeGraph — reuse pattern) | Status/owner/intent filter chips above sheet |
| Column/field manager (human) | MISSING (agents have `define_columns`) | Field sheet UI → calls the same governed columns mutation with actor proof |
| Binder search-first; sections collapse to counts | MISSING | Search input over artifacts; collapsed section counts; Pinned/Recent always open |
| Tabs: 4 visible + overflow menu | MISSING | Overflow "+N" menu on work-surface tabs |
| Chat: day dividers · agent runs collapse to one line · jump-to-latest | MISSING (jump exists partially) | Divider rows; run-group collapse using existing jobId grouping; jump button |
| Trace: drawer, filter by kind AND person, grouped by run | MISSING | Filters over existing `traces` (actor + type indexes exist) |
| Latency: optimistic `saving → synced · vN` | PARTIAL (optimistic ids exist, no indicator) | Tiny sync-state chip on edited cells/messages |

Effort: 1.5–2 weeks.

## P2 · Presence at scale + people panel

- Cursor ladder: 1 = flag, 2–3 = stacked, 4+ = cluster count (`presenceClaims`
  already carries everything; this is a renderer).
- Room facepile → people panel: role groups, live location (which artifact),
  **Follow** (subscribe camera to another member's focus events — new
  lightweight `focusEvents` or reuse presence rows).
- Human-vs-human conflict UX: last-write + notify loser + history restore
  (restore comes free with `elementVersions` from P0-B).

Effort: ~1 week.

## P3 · Permissions · notifications · audit · offline

| Item | Prod verdict | Work |
|---|---|---|
| Permissions: bulk guest select, role/expiry/revoke, view-as-guest | PARTIAL (members + revocation exist server-side) | Manage-people UI over existing tables; expiry field; view-as-guest = render with guest actor |
| Notifications: instant (mentions, watched rows) / hourly (run digests) / daily; watch = `W`/swipe | MISSING | `watches` + `notificationPrefs` tables, digest cron, in-app inbox first (email later) |
| Audit: signed evidence bundle (CSV + sources + trace) | MISSING (BTB file packages exist — reuse `createFileArtifacts`) | Bundle builder: sheet CSV + evidence list + trace excerpt + content hash ("signed" = hash manifest) |
| Offline: edits held, visible, never lost | MISSING | Queue CAS ops in IndexedDB when offline; replay with conflict-as-data on reconnect; visible "held" state |
| Keyboard: ⌘K palette · j/k/↵ / / w / f / g-t · rings survive calm mode | MISSING | Command palette (cmdk or hand-rolled); shortcut layer in room shell |

Effort: 2–3 weeks combined; each independently shippable.

## P4 · Mobile parity (terracotta app)

Prod has a real base (`#mobile` route: MobileApp/MobileGrid/MobileDeck/
MobileChat + bottom sheets; version Restore already exists in `MobileDeck`).
The designs add 13 screens + 9 gap screens:

- Grid card list: status dot + intent + owner; tap = **cell detail sheet**
  (value, sync state, quotes, history, Watch/Edit/Diff) — the mobile twin of
  the receipts layer.
- Gestures: long-press edit · swipe-right watch · swipe-left needs_review ·
  pull-down recheck (no gesture handlers in prod today).
- Gap screens: Home binder+FAB · Review tab (pipeline checklist) · trace sheet
  · field sheet · share sheet (QR/role/expiry) · manage people · settings
  (auto-allow + tiers) · first-join overlay · offline state.
- "N viewing" strip + Follow; facepile → people sheet (shares P2 backend).

Effort: 2–3 weeks after P0–P2 land (mobile reuses their components/data).

## P0-Landing (parallel track)

- H1 **"Diligence that shows its work."**, workflow-language lede, eyebrow
  "live diligence rooms".
- Key visual = looping product demo (lock → cite → commit → draft →
  smart-merge → vN) — front-end only, scripted like the memory-mode demo.
- Live-proof pill: **needs the one new backend piece** — a public metrics
  query (`roomsLive`, `cellsCommittedToday`, per-hour velocity; velocity
  sparkline only past a threshold). Cheap aggregate over `rooms`/`traces`
  with a cached counter row (never a full scan per request).
- Feature strip with UI micro-shots.

Effort: 2–3 days + the metrics query.

## Net-new backend inventory (everything the designs need that prod lacks)

1. `elementVersions` per-cell append log (+ retention pruning) — powers
   history, Restore, diff, human-conflict recovery.
2. Public metrics query + cached counters (landing pill).
3. `watches` + notification prefs + digest cron.
4. Offline op queue (client-side IndexedDB; server unchanged — CAS already
   handles replay honestly).
5. Cell↔facet freshness join for stale chips (data exists; needs a query).
Everything else is rendering data that already exists.

## Design-token reconciliation (blocked on one click)

The design files import `assets/colors_and_type.css` (DM Sans + DM Serif
Display; desktop `#101317/#171B20/#D97757`; mobile terracotta-on-cream
`#13100D/#FBF4E7/#C56A3C`) from the Claude Design project. Reading those
files (plus `feature-map/fmap-app.jsx` — the 55-feature × 12-system parity
checklist with live specimens — and the `scale/` state specimens) requires
granting the Claude Design connector: **claude.ai/design/settings → Connect
to Claude Design**. Until then this plan is component-accurate but not
pixel-exact; after consent, each workstream should start by lifting the
exact CSS from the corresponding design source directory.

## Build order (per the handoff)

**P0** grid fixes + receipts surfacing → **P1** calm mode + virtualization/
collapse → **P2** presence + people panel → **P3** permissions · notifications
· audit · offline → **P4** mobile parity per gap pack. Landing runs parallel
to P0. Every workstream gates on: typecheck + full vitest + memory-mode
Playwright green, plus a live-DOM/screenshot proof against the built preview
before "shipped" is claimed.
