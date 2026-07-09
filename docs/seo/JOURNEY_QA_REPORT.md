# Journey QA Report

Generated: 2026-07-08

## Summary

The SEO landing-flow journey suite passes on desktop Chromium and mobile Chrome.

Command:

```bash
npm run test:journeys
```

Result:

- 6 passed
- 0 failed after fixing the desktop-only chat-panel assertion for mobile
- Projects: `chromium`, `mobile-chrome`

## Covered Journeys

| Spec | Project | Result | Evidence |
|---|---|---|---|
| `tests/journeys/landing-direct.spec.ts` | chromium | pass | screenshot, video, trace in `test-results/landing-direct-SEO-journey-962aa-nd-primary-CTA-opens-a-room-chromium/` |
| `tests/journeys/landing-direct.spec.ts` | mobile-chrome | pass | screenshot, video, trace in `test-results/landing-direct-SEO-journey-962aa-nd-primary-CTA-opens-a-room-mobile-chrome/` |
| `tests/journeys/landing-from-search.spec.ts` | chromium | pass | direct fallback by default; one-query Google-origin path remains opt-in |
| `tests/journeys/landing-from-search.spec.ts` | mobile-chrome | pass | direct fallback by default; one-query Google-origin path remains opt-in |
| `tests/journeys/node-room-agent.spec.ts` | chromium | pass | room load, chat prompt, agent progress/output visible |
| `tests/journeys/node-room-agent.spec.ts` | mobile-chrome | pass | room load, chat prompt, agent progress/output visible |

## Assertions

Direct landing:

- hero H1 visible
- primary CTA visible
- product demo loop visible
- proof pill visible
- major feature cards visible
- primary CTA opens the room surface
- desktop requires public chat panel; mobile requires room work surface without forcing the desktop chat layout
- unexpected console errors and failed requests fail the test

Google-origin QA:

- does not query Google by default
- records an annotation explaining the opt-in behavior
- with `SEO_QA_ALLOW_GOOGLE_ORIGIN=1`, performs one target phrase only and falls back to direct URL if NodeRoom is not visible

NodeRoom agent:

- opens deterministic memory-mode demo room
- verifies work surface and chat load
- sends one bounded `@nodeagent` prompt
- verifies progress or output appears
- unexpected console errors and failed requests fail the test

## Artifacts

Playwright writes screenshots, videos, traces, and error context under `test-results/`. That directory is gitignored because artifacts are regenerable and can be large.

Stable reports generated in this pass:

- `docs/seo/SEO_AUDIT.md`
- `docs/seo/PERFORMANCE_QA_REPORT.md`
- `docs/seo/performance-check.latest.json`
- `docs/seo/lighthouse-preview-root.report.html`
- `docs/seo/lighthouse-preview-root.report.json`
- `docs/seo/NEBIUS_LIVE_REPORT.md`
- `docs/seo/SEARCH_CONSOLE_LIVE_REPORT.md`
- `docs/seo/search-console-live.latest.json`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T065652Z-landing-direct-chromium-review.md`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T065652Z-landing-direct-chromium-review.json`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T070344Z-landing-direct-chromium-review.md`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T070344Z-landing-direct-chromium-review.json`
- `docs/seo/journey-artifacts/google-origin-fresh-search-chromium.review.mp4`
- `docs/seo/journey-artifacts/google-origin-fresh-search-chromium.webm`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T072843Z-google-origin-fresh-search-chromium-review.md`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T072843Z-google-origin-fresh-search-chromium-review.json`
- `docs/seo/journey-artifacts/chrome-google-origin-live-search.review.mp4`
- `docs/seo/journey-artifacts/chrome-google-origin-live-search.contact-sheet.png`
- `docs/seo/journey-artifacts/chrome-google-origin-smooth-frames/recording-state.json`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T074404Z-chrome-google-origin-live-search-review.md`
- `docs/seo/journey-artifacts/gemini-video-judges/20260708T074404Z-chrome-google-origin-live-search-review.json`

## Credential-Gated Checks

These checks were run live where current credentials allowed it:

- Nebius Token Factory: live model catalog and smoke call passed using `NEBIUS_API_KEY` from Convex env. Direct inference works; endpoint listing needs the current Nebius control-plane URL.
- Gemini video judge: live `gemini-3.5-flash` review completed against `docs/seo/journey-artifacts/landing-direct-chromium.review.mp4`.
- Search Console: Chrome/CDP reached the signed-in Google Search Console session. `https://noderoom.live/` was not accessible in the current account; fallback metrics were captured for `https://next-app-khaki-five.vercel.app/`.

Gemini live findings and repair:

- Initial live judge: high-severity blank white start for about 3 seconds, plus medium-severity onboarding background clutter.
- Repair: added a lightweight pre-rendered landing shell in `index.html`, deferred public-root React startup until user interaction, and kept app/query/hash routes loading React immediately.
- Follow-up live judge: first impression 9/10, value proposition clarity 9/10, CTA clarity 9.5/10, visual smoothness 8.5/10, latency perception 8/10.
- Remaining low-severity note: onboarding modal strongly dims and blurs the workspace; consider reducing overlay intensity only if product context feels too hidden.
- Playwright Google-origin video was not good enough: Google returned an anti-bot page in Playwright, and the compressed artifact began with blank browser pre-roll before the NodeRoom fallback.
- Corrected Chrome/CDP Google-origin video: real Chrome search for `NodeRoom collaborative AI room`, visible `noderoom.live` result, navigation to NodeRoom, no blank pre-roll.
- Gemini judge on corrected Chrome/CDP video: first impression 9.5/10, value proposition clarity 9.5/10, CTA clarity 9.5/10, trust 9/10, visual smoothness 9.5/10, latency perception 9.5/10.
- Corrected Chrome/CDP Gemini findings: no critical issues and no recommended fixes.

Performance repair result:

- Playwright lab `/` FCP: 232ms
- Playwright lab `/` LCP: 232ms
- Playwright lab `/` load event: 228ms
- Playwright lab `/` CLS: 0.016
- Lighthouse preview performance/accessibility/best-practices/SEO: 100/100/100/100
- Lighthouse preview FCP/LCP: 0.8s / 0.8s
- Lighthouse preview TBT/CLS: 0ms / 0.001

Search Console fallback property summary:

- 3-month range shown by UI: April 7, 2026 to July 6, 2026
- Total clicks: 1
- Total impressions: 75
- Average CTR: 1.3%
- Average position: 9.7
- Indexed pages: 2
- Not indexed pages: 0
- `/sitemap.xml` status: Success
