# NodeRoom Mobile Component Map

Captured: 2026-07-09

| Region | Current owner | Approved owner | Behavior boundary |
|---|---|---|---|
| Universal entry | `src/ui/App.tsx` | unchanged | Normalize phone URLs while preserving `surface=desktop` QA escape. |
| Live/memory bootstrap | `MobileRoot.tsx` | unchanged except NodeRoom naming | Memory mode, live query/mutations, consent, create/join/demo/session/leave. |
| Live projection | `MobileAppLive.tsx` | unchanged | Store reads/writes, Convex watches, proposals, traces, governed storyboard, honest fallback state. |
| Theme | duplicated blocks in `mobile.css` | `mobile.tokens.css` | One semantic token vocabulary with light default and explicit dark selector. |
| Header | inline `MobileApp.tsx` markup | `shell/MobileHeader.tsx` | Callback-only room, Review, Jobs, People, activity, usage, Trace, Share, Settings adapter. |
| Shell/safe area | `mobile.css`, `MobileFrame.tsx` | `mobile.shell.css`, `MobileFrame.tsx` | 52px header, real safe areas, full-bleed production, explicit device preview. |
| Feature surfaces | `MobileScreens.tsx`, `MobileChat.tsx`, `MobileFiles.tsx`, `MobileDeck.tsx`, `MobileGrid.tsx` | existing owners | No state/store rewrite; presentation uses semantic tokens and calmer container rules. |
| Governance sheets | `MobileGapSheets.tsx`, `MobileSheets.tsx` | existing owners | Proposal review, trace, people, share, settings, watches, offline holds, auto-allow. |
| Settings | `MobileSettings.tsx` | existing owner | Theme remains primary; design-iteration variants move under Advanced while policy controls stay visible. |
| Design audit | `src/design/designSystem.ts` | same owner | Parse/check canonical token and shell files; reject late theme overrides and synthetic production chrome. |
| Proof | Vitest and Playwright | focused mobile suites | Component semantics, callback reachability, computed styles, geometry, screenshots, console/network/overflow receipts. |

## Import Order

`mobile.tokens.css` is imported first, feature CSS second, and
`mobile.shell.css` last. Correctness does not depend on that order: feature CSS
must not redeclare theme tokens, and the design audit rejects later token
blocks that do.

## Non-Owners

This migration does not move logic into the header or CSS and does not modify
`convex/**`, `src/nodeagent/**`, `src/app/store.tsx`, room-store contracts,
proofloop, trace persistence, auth, schema, or durable collaboration behavior.
