# NodeRoom UI Contract

Captured: 2026-07-07

This contract is grounded in the actual `NodeAgent-handoff_07062026` design bundle, not only the chat screenshot. The source bundle says `NodeRoom - Index.html` is the primary design index and `cross/feature-map/feature-map.html` is the parity checklist.

## Source Bundle

- Source root: `C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project`
- Primary index: `NodeRoom - Index.html`
- Parity checklist: `cross/feature-map/feature-map.html`
- Build handoff: `cross/handoff/PROD-PARITY-HANDOFF.md`
- Design-system kernel: `shared/colors_and_type.css`, `shared/page-shell.css`, `shared/chrome.css`, `shared/badges.css`, `shared/density.css`, `shared/nav.css`

## Screenshot Receipts

Screenshots were captured from the source HTML through a local-only static server at `http://127.0.0.1:4187`, because direct `file://` navigation is blocked by the browser security policy.

- Manifest: `docs/design/ui-contract/20260707-design-source/manifest.json`
- Screenshot root: `docs/design/ui-contract/20260707-design-source/`

## Contract Matrix

| Surface | Screenshot | Source | Viewport | Contract role |
|---|---|---|---:|---|
| Project index | `index-1456x940.png` | `NodeRoom - Index.html` | 1456x940 | Design inventory and source of truth for feature coverage. |
| Web / Console | `web-console-1456x940.png` | `web/console/console.html` | 1456x940 | Desktop operator shell. |
| Web / Rooms | `web-rooms-1456x940.png` | `web/rooms/rooms.html` | 1456x940 | Main collaborative room look and Q3 diligence state. |
| Web / States & Scale | `web-states-scale-1456x940.png` | `web/states-scale/states-scale.html` | 1456x940 | Scale behavior, binder, grid, chat, trace, and primitive states. |
| Web / Prod UI Fix Pack | `web-fix-pack-1456x940.png` | `web/fix-pack/fix-pack.html` | 1456x940 | Production corrections and calm-mode annotations. |
| Web / Trace UI | `web-trace-1456x940.png` | `web/trace/trace.html` | 1456x940 | Evidence, receipt, and trace UX. |
| Web / Notebook | `web-notebook-1456x940.png` | `web/notebook/notebook.html` | 1456x940 | Notebook/report reading UX. |
| Web / Memory Wall | `web-memory-wall-1456x940.png` | `web/memory-wall/memory-wall.html` | 1456x940 | Optimistic multiplayer canvas UX. |
| Web / Always-On Rooms | `web-always-on-1456x940.png` | `web/always-on/always-on.html` | 1456x940 | Recurring rooms, digests, and owner ops. |
| Web / Directions | `web-directions-1456x940.png` | `web/directions/directions.html` | 1456x940 | Landing/product direction references. |
| Cross / Feature Map | `cross-feature-map-1456x940.png` | `cross/feature-map/feature-map.html` | 1456x940 | Feature inventory and live specimen checklist. |
| Cross / Handoff | `cross-handoff-1456x940.png` | `cross/handoff/handoff.html` | 1456x940 | Styled parity handoff and build order. |
| Mobile / App | `mobile-app-390x844.png` | `mobile/app/app.html` | 390x844 | Primary mobile contract. |
| Mobile / Terracotta | `mobile-terracotta-390x844.png` | `mobile/app-terracotta/app-terracotta.html` | 390x844 | Warm mobile visual variant. |
| Mobile / At Scale | `mobile-at-scale-390x844.png` | `mobile/at-scale/at-scale.html` | 390x844 | Mobile density and scale. |
| Mobile / Gap Pack | `mobile-gap-pack-390x844.png` | `mobile/gap-pack/gap-pack.html` | 390x844 | Missing mobile states and flows. |
| Mobile / Capture Prototype | `mobile-capture-prototype-390x844.png` | `mobile/capture-prototype/capture-prototype.html` | 390x844 | Uploaded capture reference. |

## Production Parity Rules

The implementation should be judged against the source screenshots plus the feature map. The highest-priority web room parity target is the combined `Web / Rooms`, `Web / States & Scale`, and `Web / Prod UI Fix Pack` contract.

- Use the normal live room landing/create path for production proof. Do not use deterministic room codes or special demo-only routes.
- Match the app shell geometry: top bar, left binder, center work surface, right chat, and bottom status rail.
- Binder must be a nested tree with Pinned, Recent, Sheets, Docs, Notebooks, Uploads, counts, collapse states, search, and active selection.
- Grid rows must be compact and stable. Badges and provenance chips must not stretch row height.
- Spreadsheet states must include tab strip, filter input, hidden-column disclosure, selected cell ring, row tint for active/changed rows, and dataframe/version footer.
- Chat must include day dividers, compact human messages, collapsed NodeAgent receipt cards, room/private segmented control, and pinned composer.
- Trace/evidence must be visible as product UX, not hidden in logs: receipt cards, source count, version transition, diff, and trace drawer.
- Calm mode rule: default shows data; hover or focused state reveals apparatus.
- Mobile parity follows the mobile screenshots: desktop hover affordances become bottom-sheet details, card-list grid, people/presence sheet, trace sheet, share sheet, and settings.

## Proof Requirements

Design parity is not complete until both are true:

- Source-design screenshots exist in `docs/design/ui-contract/20260707-design-source/`.
- A separate live production proof opens `https://noderoom.live` with no room parameter, creates or lands in a real user room, captures the app screenshot, and records the parity comparison receipt without overwriting canonical verifier receipts.
