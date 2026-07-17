# NodeRoom First-Run QA Matrix

Captured: 2026-07-10

## Journeys

| Journey | Required production proof |
|---|---|
| New desktop creator | Landing -> Create preflight -> empty room -> artifact -> governed action -> trace -> XLSX -> reload. |
| New mobile creator | Landing -> mobile Create -> policy -> empty room -> composer/artifact -> reload. |
| Invited desktop/mobile guest | Invite URL -> correct room -> guest name -> join without creating another room. |
| Sample desktop/mobile user | Explicit Sample preflight -> labeled synthetic room -> primary artifact -> proposal/trace. |
| Returning user | Reload/deep link restores session and does not replay creation or blocking onboarding. |
| Recovery user | Delayed/failing create, offline transition, expired/revoked session, room full, failed export. |

## Viewports And Inputs

- Desktop Chromium and WebKit-equivalent.
- 320x568, 375x812, 390x844, and 430x932.
- Keyboard-only, screen reader semantics, 200% zoom, reduced motion.
- Mobile software keyboard, browser Back, rotation/background/reload, download.
- Normal and delayed network; offline before and after confirmation.

## Blocking Assertions

- No production CTA contains `surface=desktop`.
- No Create or Sample mutation occurs before explicit confirmation.
- Review is selected by default.
- Sample and empty rooms are distinguishable after reload and invite join.
- Visible critical controls are at least 44x44 on phone widths.
- No body or app overflow beyond one pixel at 320px.
- Composer, send, audience, and navigation remain visible with the keyboard.
- Back closes a sheet/dialog before leaving the room.
- No console error, failed required request, duplicate room, or lost draft.
- Creation acknowledgement is under one second and room-ready p95 is under
  eight seconds across the recorded preview run set.
- Export receipt and downloaded workbook agree on filename and row count.
- Deployed asset/version receipt identifies exactly what was tested.

Agent persona audits and model taste reviews are supplementary. They are never
reported as unassisted human usability validation.

## 2026-07-10 Execution Status

- Local first-run and mobile live-development browser gate: pass, 28/28.
- Phone widths: pass at 320, 375, 390, and 430 CSS pixels in light and dark.
- Real Convex development sample create: pass; provenance survives an older
  backend that omits the new room `experience` field.
- Production fresh-origin inspection: fail; the deployed landing is stale and
  still emits `surface=desktop` from its Create CTA.
- Authenticated production first-user journey: blocked; the app mounts plain
  `ConvexProvider` and has no account auth adapter.
- Production release: blocked by the mixed 306-path worktree and the current
  Vercel-production-to-Convex-development topology. See the execution receipt.
