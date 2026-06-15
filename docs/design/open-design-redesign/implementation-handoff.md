# NodeRoom Open Design Redesign Handoff

## Open Design Prototype

- Project: `noderoom-banker-diligence-redesign`
- Run: `a3c689e5-2b03-4753-a7f4-1198717b1787`
- Preview: <http://127.0.0.1:7456/api/projects/noderoom-banker-diligence-redesign/raw/index.html>
- Source: `C:\Users\hshum\.codex\tools\open-design\.od\projects\noderoom-banker-diligence-redesign\index.html`

The prototype is a dense product work surface for a fictional Northstar MMB /
startup banking diligence demo, using JPM-style middle-market banking workflows
as reference without implying affiliation. It covers active room, fresh ask and
join, side-by-side evidence, stale/proposed chat references, and prepared
dry-run downstream handoff states from a bottom demo-path dock.

Browser verification on 2026-06-15 passed for:

- Resting layout: artifact `920px`, hidden evidence `0px`, banker coach `360px`.
- Evidence open: artifact `500px`, evidence `420px`, banker coach `360px`.
- Fresh join: modal covers the work surface and shows the first-run ask,
  upload, and live workflow path.
- Stale ref: `proposal #ref-198` exposes the expired-ref explanation.
- Export ready: chat banner appears, export count flips to `1`, and Slack,
  Notion, Gmail, Linear, CRM, and LinkedIn draft targets are visible as
  not-sent dry-run handoffs.
- Console: no warning or error logs reported by the in-app browser.

Polish pass on 2026-06-15:

- Reworked the first-pass dark dashboard palette into a lighter finance
  workbench palette: neutral shell, white panels, blue evidence, warm-orange
  agent activity, green approvals, amber review, red missing/expired state.
- Tightened the header, progress spine, table rows, sticky headers, row hover,
  coach cue, evidence cards, chat input, and export banner so each surface has
  a clearer job and hierarchy.
- Moved prototype-state controls out of the chat area and into a smaller
  floating inspector above the chat.
- Removed visible em dash copy from the prototype.
- Rechecked desktop states after polish:
  active `1207 / 0 / 360`, evidence-open `787 / 420 / 360`, fresh join,
  stale ref, and export-ready all pass.
- Rechecked mobile at `375x812`: no horizontal overflow, coach/evidence
  collapse, rows remain visible, and state controls remain above chat.

Deeper polish pass after user review:

- Re-ran Open Design refinement on project
  `noderoom-banker-diligence-redesign` with run
  `a12501f4-f85d-49c1-91b9-675cb357e4fa`. The run completed, but the output
  mostly preserved the existing light-theme artifact, so targeted structural
  edits were applied directly to `index.html`.
- Added a diligence summary band above the grid: active queue, coach cues,
  evidence gaps, export status, and current NodeAgent work.
- Added pinned row number/company behavior and a stronger active Helix row
  treatment for the financial grid.
- Reworked the demo controls from `Prototype states` into a quieter `Demo path`
  scrubber: `1 Ask`, `2 Queue`, `3 Evidence`, `4 Proposal`, `5 Proof`.
- Expanded Fresh Join into a room-entry surface with room context, join steps,
  connected data sources, invite link, and host context.
- Added Banker Coach review context: memo impact, evidence state, and next
  action.
- Added evidence lineage in the side-by-side drawer: pulled source, parsed OCR,
  and matched board-deck provenance.
- Wired the summary export metric to export-ready state (`0 prepared` to
  `1 ready`).
- Desktop verification passed via visible coordinate clicks because the browser
  locator click bridge timed out on the demo path controls:
  active, fresh, evidence, stale ref, and export states all passed.
- Mobile verification at `375x812` passed after compressing the summary band
  into a horizontal strip: no page-level horizontal overflow and rows remain
  visible.
- Added explicit bulk-intake and multi-agent activity polish:
  `Bulk intake` / `12 companies`, `Agent runs` / `3 live`, and room transcript
  messages showing Helena starting a 12-company batch and NodeAgent opening
  coordinated Evidence, Runway, and Coach runs with room-scoped source access.
- Re-verified active, fresh, evidence, stale-ref, and export states after the
  bulk-intake transcript changes. The visible state controls still pass via
  coordinate clicks in the in-app browser, no console warnings/errors.

Parallel review reconciliation on 2026-06-15:

- Ran parallel subagent reads against `6-14-2026-deep-review.txt` and
  `6-15-2026-deep-review.txt`; both reviews pointed to product-truth gaps more
  than pure visual polish.
- Removed public JPM-affiliation wording from the prototype. The current room is
  `Northstar MMB · Startup Diligence Pool`; owner copy uses
  `helena@northstar`.
- Added a proof/status strip with bulk intake, live agent runs, `Trace pass
  18/18`, `No-clobber 2 protected`, prepared handoff count, and current
  streaming proof status.
- Added an artifact preview band for runway model, workplan, and eval gate so
  the demo shows runway/milestones and source-coverage proof before opening the
  evidence drawer.
- Added source locator chips and highlighted source mocks in the evidence
  drawer: Salesforce row/cell support and MSA page/clause support.
- Made non-Helix evidence chips passive status chips so demo clicks cannot open
  mismatched Helix proof.
- Added visible no-clobber behavior: Pernod ARR shows a locked Tobias edit and
  `Proposal #ref-317`; chat explains the agent opened a proposal instead of
  overwriting the cell.
- Changed downstream handoff language to `Prepared dry-run package`, `not sent`,
  and staged target pills for Slack, Notion, Gmail, Linear, CRM, and LinkedIn.
- Added coach review-round proof, source coverage, talk-track status, and
  visible outcomes for `Request evidence` and `Dismiss cue`.
- Added `data-noderoom-surface` markers to the main surfaces for Trace Lens
  style inspection.
- In-app browser verification after this pass:
  active layout `1204 / 0 / 360`, evidence layout `784 / 420 / 360`, fresh
  overlay visible, stale proposal explanation visible, proof banner visible,
  summary handoff flips to `1 ready`, and no console warnings/errors.
- Targeted DOM checks confirmed Northstar/no-JPM copy, proof strip, no-clobber
  row, source locators, dry-run banner, runway/workplan/eval cards, and demo
  path labels.
- Mobile verification at `375x812` passed: no horizontal overflow, deal strip
  and insight band compact horizontally, coach/evidence hide, fresh card fits at
  `355px`, and the browser was returned to the active queue state.

Original NodeRoom mobile pass on 2026-06-15:

- Checked the real app at `http://localhost:5177/?mode=memory` with a
  `375x812` viewport. The landing/join screen has no horizontal overflow.
- After joining the memory demo room, the original shell intentionally keeps the
  Work Surface as the primary mobile surface. This matches
  `e2e/responsive-qa.spec.ts`; Copilot/Chat and Room Binder are reachable as
  overlays from the top pane switcher.
- Polished `src/ui/RoomShell.tsx` and `src/app/styles.css` so phone controls are
  visibly labeled `Room`, `Work`, and `Chat` instead of icon-only, while keeping
  the accessible button names used by tests.
- Fixed compact Binder behavior so opening the Room Binder hides the Work
  Surface behind it and clears the Work active state; returning to Work restores
  the artifact panel.
- Browser verification at `375x812` passed after the patch: no page overflow;
  Work default visible; Room overlay visible with Work inactive; Chat/Copilot
  overlay visible with public chat; no console warnings/errors.
- Ran `npx playwright test e2e/responsive-qa.spec.ts --workers=1`: all six
  responsive tiers passed.

Sidebar chat follow-up on 2026-06-15:

- Added a top-of-Binder `Live room chat` preview in `LeftRail`, showing the
  latest public room messages and message count.
- Wired the preview's `Open sidebar chat` action through `RoomShell`: on compact
  screens it closes the Binder and opens the public Chat/Copilot pane; on
  desktop it keeps the work surface and opens the right chat panel.
- Updated original app demo copy to say `startup-banking diligence` instead of
  visible JPM-affiliation wording. `rg` over `src/ui`, `src/engine`, and
  `convex` is clean for `JPM|jpm`.
- Browser verification at `375x812`: Binder shows sidebar chat at the top,
  tapping it opens public chat, hides the Binder, keeps no horizontal overflow,
  and rendered text contains no JPM wording.
- Added responsive QA assertions so sidebar chat is required in the Binder and
  the compact Binder-to-Chat flow is covered.
- Verification: `npx tsc --noEmit --pretty false` and
  `npx playwright test e2e/responsive-qa.spec.ts --workers=1` both passed.

Manual OD fixes applied after generation:

- Collapsed the evidence grid column in the resting state so the Banker Coach
  stays in the right rail.
- Made evidence-open deterministic with an explicit three-column grid.
- Moved export-ready styling to a body-level state because the banner lives in
  the chat rail, outside `main`.
- Expanded the fresh-room overlay to cover the work surface instead of only the
  artifact pane.

## Files To Read First

- `docs/design/open-design-redesign/DESIGN.md`
- `docs/design/open-design-redesign/design-contract.md`
- `docs/DESIGN.md`
- `docs/design/DESIGN_BENCHMARK.md`
- `src/ui/RoomShell.tsx`
- `src/ui/panels/Artifact.tsx`
- `src/ui/Chat.tsx`
- `src/ui/artifacts/BankerCoachPanel.tsx`
- `src/app/styles.css`

## Implementation Order

1. Clean the resting shell.
   - Hide idle telemetry.
   - Keep only useful room controls.
   - Remove theme/tour/secondary toggles from the always-on path.

2. Make workflow progress visible.
   - Add a compact progress spine for intake, evidence, coach review, approval,
     and export.
   - Show only state that is true now.

3. Make banker coach the trust layer.
   - One main cue at a time.
   - Evidence cards open side-by-side with the source artifact.
   - Accept/reject/ask-for-more are the primary actions.

4. Improve artifact and table clarity.
   - Sticky headers.
   - One-line clamped cells.
   - Source/status chips.
   - Exact-object focus for agent locks and proposal refs.

5. Gate downstream handoff.
   - Hide provider buttons until a draft exists.
   - Show one compact export/draft-ready state first.

6. Verify visually.
   - Fresh room.
   - Join flow.
   - Memory demo room.
   - Startup diligence demo.
   - Side-by-side evidence opening.
   - Stale chat ref error.
   - Mobile at 375px and desktop at 1440px.

## Token And Style Constraints

- Use existing CSS tokens where possible.
- Add tokens only for semantic roles that appear in multiple components.
- One warm agent accent.
- Amber only for pending review.
- Green only for complete/approved/exported.
- Red only for failed/blocked/missing evidence.
- Blue only for source/evidence/link state.
- Letter spacing stays 0.
- Cards stay at 8px radius or less unless preserving an existing system rule.
- No decorative orbs, blobs, generic gradients, or marketing hero patterns.

## Acceptance Notes

The first redesign artifact should prove three things:

1. A new user can join a room and understand where to act.
2. A banker can see progress, evidence, and review state without reading chat.
3. A coach cue can open the exact evidence side-by-side and resolve proposal refs
   from chat without confusion.

Do not start by adding a command palette. Start by subtracting, then improving
state hierarchy, then tightening evidence and progress surfaces.
