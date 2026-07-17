# NodeRoom Mobile Header Contract

Approved: 2026-07-09

## Purpose

The header must establish NodeRoom and room context immediately without
competing with the work. It is an adapter over existing callbacks. It owns no
store, Convex, auth, proposal, or routing logic.

## Geometry

- Production height: `52px + env(safe-area-inset-top)`.
- Production top padding: `calc(env(safe-area-inset-top) + 6px)`.
- Horizontal application inset: 15px, acceptable range 14-16px.
- Header row: 52px with 44px minimum interactive targets.
- Default background: flat `--mobile-bg-app`.
- Default divider and shadow: none.
- Scrolled state: one `1px` bottom hairline only; no drop shadow.
- No decorative gradient, translucent capsule, or persistent telemetry row.

## Room Context

- One coherent transparent control occupies the left flexible track.
- The mark is 29x29px with an 8px radius and no gradient or shadow.
- Mark text is `N`; product naming elsewhere remains NodeRoom.
- Room title is 15px/600, single line, ellipsized, and `min-width: 0`.
- Chevron is 14px, quiet but visible.
- A 6px success dot may indicate a live room. It is not the brand accent.
- The room control always opens room switching. It never changes meaning.
- A long title may shrink only its text track. It may not move, hide, or
  overlap the right-side actions at 320px.

## Commands

- Review is a dedicated 44x44 ghost button and always opens Review/Inbox.
- Review count belongs only to Review. It is amber/attention, not terracotta.
- Badge diameter is 17px; values display as `1` through `9` and `9+`.
- Overflow is a dedicated 44x44 ghost button and never carries a count.
- Overflow always opens secondary commands with stable meanings: Jobs, People,
  room activity, usage, Trace, Share, and Settings.
- Primary tabs remain in bottom navigation and are not duplicated in overflow.
- No command silently changes among Jobs, History, Notifications, or Review in
  response to an unrelated tab or count.

## Color Semantics

- Terracotta: primary, active selection, or provenance only.
- Green: live, healthy, or completed only.
- Amber: review, held, or attention only.
- Red: error, failure, or destructive only.
- Neutral ink/surfaces: navigation, overflow, ordinary metadata.

## States

| State | Required result |
|---|---|
| Zero reviews | Review button remains a stable Inbox command; no badge. |
| Four reviews | Badge reads `4` and has accessible name `Review inbox, 4 items`. |
| 99+ reviews | Badge reads `9+`; accessible name reports the real count. |
| Offline | Header geometry is unchanged; offline details stay in the existing banner/sheet. |
| Long title | Title ellipsizes before either command moves. |
| Scrolled content | One hairline appears; no elevation jump. |
| Dark theme | Same geometry and semantic token names; only token values change. |
| Production phone | No synthetic clock, signal, battery, island, or home indicator. |
| Device preview | Synthetic device chrome is allowed only with explicit preview mode. |

## Accessibility And Test Contract

- All controls are native buttons with visible `:focus-visible` treatment.
- Minimum target is 44x44 CSS pixels.
- Required stable selectors:
  `mobile-header`, `mobile-room-context`, `mobile-room-title`,
  `mobile-review-action`, `mobile-review-badge`, `mobile-overflow-action`, and
  `mobile-overflow-menu`.
- Escape closes overflow. Selecting an item closes it before invoking the
  callback.
- At 320, 375, 390, and 430px: body overflow is at most 1px and header actions
  remain fully inside the viewport.

