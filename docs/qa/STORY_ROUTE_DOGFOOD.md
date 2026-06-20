# Story Route Dogfood Gate

This gate covers the low-commitment `/#story` demo path:

- the spreadsheet is editable before a visitor joins a room;
- the local story agent chat responds to the edit;
- the variance math and response copy remain deterministic;
- the same browser behavior can be checked locally and after production deploy.

## Local Pre-Deploy Gate

Run these before treating the slice as locally ready:

```bash
npm test -- --run tests/storyQuickDemo.test.tsx tests/chatReasoningFrames.test.tsx
npm run typecheck -- --pretty false
npm run qa:story
npm run test:product:memory
```

`npm run qa:story` builds the app, serves the production bundle with
`vite preview`, and runs `scripts/story-route-dogfood.mjs` against `/#story`.
This checks the artifact we ship, not only the Vite dev server.

`npm run test:product:memory` owns its local Vite dev server lifecycle, drives
Chromium through the memory-mode room, and exits after cleanup. It covers the
broader local behavior set: public chat, artifact references, file upload,
workbook formulas, keyboard/range editing, semantic rebase review, responsive
layouts, and Coach evidence split-view.

Expected behavior:

1. `/#story` renders the "Try the room in 20 seconds" sandbox.
2. Filling C2 with `13,250` updates D2 to `3,250`.
3. Sending "Recompute the revenue variance" shows an agent response that says
   it kept the human C2 edit and computed `D2 = C2 - B2 = 3,250`.

## Production Post-Deploy Gate

After deploying the built app, run the exact same browser spec against prod:

```bash
npm run qa:story:prod
```

`qa:story:prod` runs `scripts/story-route-dogfood.mjs --base-url
https://noderoom.live`, so the browser assertions are the same as the local
pre-deploy gate.

## Regression Coverage

- `tests/storyQuickDemo.test.tsx` covers the local React interaction and
  deterministic math model.
- `tests/chatReasoningFrames.test.tsx` covers the live-room public chat
  affordance: empty public chat exposes a one-click NodeAgent action, and
  durable agent job `finalText` is visible in chat even when no agent message
  row was posted.
- `scripts/story-route-dogfood.mjs` is the browser-level local/prod parity
  check for the `/#story` first-impression flow.
- `scripts/run-product-memory-playwright.mjs` is the browser-level local product
  gate. It starts Vite on a free port, runs the selected Playwright specs with
  `PLAYWRIGHT_REUSE_SERVER=1`, and tears down the server process tree so Windows
  runs do not hang after the tests pass.
