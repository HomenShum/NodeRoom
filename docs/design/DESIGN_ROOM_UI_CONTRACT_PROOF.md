# Design Room UI Contract Proof

Captured: 2026-07-07

This is the design contract for the live room UI. The contract source is:

`C:/Users/hshum/Downloads/NodeRoom Web - Room UI Contract (standalone).html`

The proof does not use a fixed room code, seeded screenshot path, or demo-only route. It starts at the normal app base URL, clicks Create room, lands in a fresh live room, drives real UI states, then records a browser receipt.

## Method

The standalone HTML is treated as a component/state contract, not as a full-page bitmap. The verifier extracts the named primitives and maps them to real app components:

| Contract area | Contract classes | Production component |
|---|---|---|
| Top bar | `fx-top`, `fx-mark`, `fx-invite`, `fx-avs`, `fx-live`, `fx-iconbtn` | `src/ui/RoomShell.tsx` |
| Room Binder | `fx-side`, `sc-search`, `fx-item`, `sc-sec`, `fx-folder`, `sc-count` | `src/ui/LeftRail.tsx` |
| Center tabs | `fx-tabs`, `fx-tab`, `sc-tabmore`, `fx-shared` | `src/ui/panels/Artifact.tsx` |
| Dataframe grid | `fx-sheet`, `fx-st`, `fx-src`, `fx-owner`, `fx-sel`, `rm-cellin`, `fx-shtool`, `fx-shfoot` | `src/ui/panels/Artifact.tsx` |
| Public chat | `fx-chat`, `fx-msg`, `fx-cmd`, `sc-run`, `rm-chatin`, `fx-seg`, `send` | `src/ui/Chat.tsx`, `src/ui/RoomShell.tsx` |
| Pipeline status | `fx-status`, `fx-step` | `src/ui/RoomShell.tsx` |
| People panel | `sc-ppanel`, `sc-prow`, `sc-pst` | `src/ui/PeoplePanel.tsx` |

## Component Inventory

The verifier extracts these component cards from the HTML contract and fails if they disappear:

| Design component | Selector contract | Production owner |
|---|---|---|
| Brand mark | `fx-mark` | `src/ui/RoomShell.tsx` |
| Room code pill | `fx-invite` | `src/ui/RoomShell.tsx` |
| Presence facepile + live | `fx-avs`, `fx-live` | `src/ui/RoomShell.tsx` |
| Icon button | `fx-iconbtn` | `src/ui/RoomShell.tsx` |
| Binder search | `sc-search` | `src/ui/LeftRail.tsx` |
| Binder item | `fx-item` | `src/ui/LeftRail.tsx` |
| Section / folder header | `sc-sec`, `fx-folder`, `sc-count` | `src/ui/LeftRail.tsx`, `src/ui/PeoplePanel.tsx` |
| Tab strip | `fx-tab`, `sc-tabmore`, `fx-shared` | `src/ui/panels/Artifact.tsx` |
| Status chips | `fx-st` | `src/ui/panels/Artifact.tsx` |
| Row affordances | `fx-src`, `fx-lock`, `fx-owner` | `src/ui/panels/Artifact.tsx` |
| Cell states | `fx-sel`, `rm-cellin`, `rm-wet` | `src/ui/panels/Artifact.tsx` |
| Sheet toolbar + footer | `fx-shtool`, `fx-shfoot` | `src/ui/panels/Artifact.tsx` |
| Message / command | `fx-msg`, `fx-cmd` | `src/ui/Chat.tsx` |
| Agent run + edit receipt | `sc-run`, `r-activity` | `src/ui/Chat.tsx`, trace surfaces |
| Composer + segmented | `rm-chatin`, `fx-seg`, `send` | `src/ui/Chat.tsx`, `src/ui/RoomShell.tsx` |
| Run pipeline | `fx-step`, `fx-status` | `src/ui/RoomShell.tsx` |
| Trace span row | `trc-row` | `src/ui/panels/TraceSurface.tsx` |
| Memory Wall note | `mw-note`, `mw-btn` | `src/ui/panels/Artifact.tsx` wall surface |
| In-view header | `rm-vhead`, `rm-vback` | center view surfaces |
| Person row | `sc-prow`, `sc-pst` | `src/ui/PeoplePanel.tsx` |

## Proof Command

```bash
npm run proofloop:design:room-contract
```

For local-only verification:

```bash
PROOFLOOP_DESIGN_ROOM_CONTRACT_BASE_URLS=http://127.0.0.1:5177 npm run proofloop:design:room-contract
```

## Passing Receipt

Local proof passed:

`.proofloop/runs/design-room-contract-20260707T084452Z/browser-receipts/design-room-ui-contract/receipt.json`

Fresh room created by that run:

`http://127.0.0.1:5177/?room=NR1HAZWL36E&name=Host`

Screenshot:

`.proofloop/runs/design-room-contract-20260707T084452Z/browser-receipts/design-room-ui-contract/local-5177-live-room-contract-state.png`

## What The Proof Checks

- Required component primitives exist on the real DOM, not only inside docs.
- A real fresh-room flow exposes top bar, binder, center tabs, sheet, chat, status bar, and people panel.
- Binder is tree-first with nested rows; the noisy summary-card group and left-rail chat peek are absent.
- Stateful interactions are observed across the sequence: people panel open, public message sent, selected cell, and cell editor.
- Basic layout geometry stays inside expected ranges for top bar, icon buttons, binder, chat rail, and bottom status.

Prod must be rerun after deployment because `https://noderoom.live` only passes once this branch is shipped.
