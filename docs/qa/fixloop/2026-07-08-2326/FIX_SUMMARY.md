# NodeRoom Fix Summary

Run: `2026-07-08-2326`
Target verified: `https://noderoom.live`
Final production deployment: `dpl_4YPmqoppf7XYKkeP89P54EEsEmVQ`

## Fixed

### QA-001: Create a room CTA routed to memory mode

The SSR fallback CTA in `index.html` routes to the live create flow:

`/?create=1&surface=desktop&name=Host&title=Startup%20diligence`

Production Playwright verifies the no-JS fallback link contains `create=1` and does not contain `mode=memory`.

### QA-002: Export XLSX produced no download or visible error

The sheet export path tracks busy/error state, prevents duplicate clicks, dispatches the browser download, keeps the blob URL alive long enough for Chromium, and shows `Downloaded <filename>` after success.

Production evidence verifies `Q3_variance.xlsx` downloaded with 6560 bytes and `PK` Office zip magic bytes.

### QA-003: First-run onboarding blocked fresh rooms

Desktop first-run opens the non-modal walkthrough dock instead of the full guided-tour overlay. Mobile first-join renders as a non-modal notice anchored above the dock; the room remains usable before tapping `Got it`.

### QA-004: Production CSP console errors

The production CSP console gate now passes across `/`, `/faq/`, `/brand/noderoom/`, and a live room route. `vercel.json` includes the current inline JSON-LD and private-route guard hashes.

### QA-005: Landing FCP was slow

Google Fonts are loaded through one stylesheet request and the production FCP budget gate passes.

### Gemini P2 follow-ups

The active-sheet reload reset, black-frame navigation/reload flicker, and follow-up sluggish boot skeleton findings are all closed in production. The final desktop Gemini run reports `publish`, `8/16`, and no P0/P1/P2 defects.

## Remaining

None tracked in this fix loop.
