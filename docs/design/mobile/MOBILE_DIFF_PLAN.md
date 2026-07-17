# NodeRoom Mobile Diff Plan

Captured: 2026-07-09

## Safe Sequence

1. Lock visual authority and behavioral inventory in `docs/design/mobile/`.
2. Add `mobile.tokens.css` and bridge existing legacy variable names to the
   semantic mobile token vocabulary.
3. Add `shell/MobileHeader.tsx` and `mobile.shell.css`; replace only the inline
   header markup in `MobileApp.tsx`.
4. Remove the persistent pulse strip and route its existing destinations into
   stable overflow actions. Keep bottom navigation as the only primary-nav set.
5. Make device preview explicit in `MobileFrame.tsx`; production becomes
   full-bleed with real safe-area insets.
6. Remove duplicate theme blocks, late token overlays, and the global
   `letter-spacing: 0 !important` reset from `mobile.css`/`mobileFrame.css`.
7. Rename the live join identity from NodeAgent Mobile to NodeRoom without
   changing mutations, consent, or session behavior.
8. Move experimental appearance/navigation/tone knobs under Advanced while
   leaving theme and governed agent policy controls direct.
9. Repair existing mobile adapters that already have live contracts but do not
   reach them: Inbox decisions, Jobs actions, live trace fallback, and Ask
   visibility/delivery alignment.
10. Harden `designSystem.ts`, Vitest, and Playwright checks before visual proof.
11. Run at most three implementation/proof/judge repair loops.

## File Scope

| File | Change class |
|---|---|
| `docs/design/UI_CONTRACT.md` | Authority clarification only. |
| `docs/design/COMPONENT_MAP.md` | Mobile shell ownership map only. |
| `docs/design/mobile/**` | Contracts, inventories, judgments, QA receipts. |
| `src/ui/mobile/mobile.tokens.css` | New canonical semantic tokens. |
| `src/ui/mobile/mobile.shell.css` | New shell/header/safe-area styles. |
| `src/ui/mobile/shell/MobileHeader.tsx` | New callback-only adapter. |
| `src/ui/mobile/MobileApp.tsx` | Header adapter wiring, scroll state, stable secondary actions, remove duplicate nav tier. |
| `src/ui/mobile/MobileFrame.tsx` | Explicit preview mode; no production synthetic status chrome. |
| `src/ui/mobile/mobile.css` | Remove duplicate tokens/header rules/late typography reset; retain feature styling. |
| `src/ui/mobile/mobileFrame.css` | Remove duplicate late route-theme overlay; use semantic frame tokens. |
| `src/ui/mobile/MobileRoot.tsx` | Product name correction only. |
| `src/ui/mobile/MobileSettings.tsx` | Advanced grouping only; callbacks unchanged. |
| `src/ui/mobile/MobileChat.tsx`, `MobileOverlay.tsx` | Existing live Jobs/trace adapter wiring only. |
| `src/design/designSystem.ts` | Structural mobile contract checks. |
| `tests/designSystemManifest.test.ts` | Regression fixtures for forbidden cascade/status/header patterns. |
| `tests/mobileHeader.test.tsx` | Header semantics, counts, stable callbacks, overflow actions. |
| `e2e/mobile-story-surfaces.spec.ts` | Multi-width production/preview geometry and computed-style proof. |

## Stop Conditions

No blocker/high mobile issue, topbar taste >= 8.5, overall taste >= 8,
contract adherence >= 9, no 320px overflow, 44px targets, no production
synthetic status bar, and typecheck/build/design audit/focused Vitest/mobile
Playwright all pass. A missing external judge or undeployed production build is
recorded honestly and cannot be converted into a passing external receipt.
