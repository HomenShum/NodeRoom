# Journey QA Plan

## Goal

Record and judge the experience from public landing impression through first room activation and a NodeAgent action. The tests create artifacts for review; they are not search-rank automation.

## Rules

- Do not run mass Google searches.
- Do not scrape rankings.
- Do not generate fake clicks.
- Use Search Console for search metrics.
- Use browser journeys for UX regression proof.
- Store videos, traces, screenshots, console errors, and failed network request summaries with each test run.

## Journeys

### Direct Landing

Spec: `tests/journeys/landing-direct.spec.ts`

Checks:

- Root page loads in a clean browser context.
- Hero H1, CTA, product explanation, proof pill, demo loop, and feature cards are visible.
- Console errors and failed network requests are captured.
- Primary CTA opens the room surface.
- Screenshot artifacts are attached to the Playwright run.

### Google-Origin QA

Spec: `tests/journeys/landing-from-search.spec.ts`

Checks:

- Runs a single target phrase only when `SEO_QA_ALLOW_GOOGLE_ORIGIN=1`.
- Records whether a NodeRoom result is visible.
- Clicks the result only if present.
- Falls back to the direct URL otherwise.
- Continues through landing QA.

Default behavior does not query Google. This avoids brittle CI and avoids search-spam behavior.

### Node Room Agent

Spec: `tests/journeys/node-room-agent.spec.ts`

Checks:

- Opens a deterministic local demo room in memory mode.
- Verifies chat and work surface load.
- Sends one bounded `@nodeagent` prompt.
- Verifies progress or agent output appears.
- Captures screenshots and reports unexpected console/network failures.

## Visual Judge

Use:

```bash
npm run seo:compress-video -- --input <playwright-video.webm> --mode review
npm run seo:judge-video -- --input <compressed.mp4>
```

Judge dimensions:

- first impression
- value proposition clarity
- CTA clarity
- trust
- visual smoothness
- mobile usability
- confusing states
- broken UI
- latency perception
- timestamped issues
- recommended fixes

## Report

Write `docs/seo/JOURNEY_QA_REPORT.md` after a run with:

- command
- base URL
- browser
- screenshots
- videos
- traces
- console error summary
- failed network request summary
- visual judge JSON path
- accepted fixes and deferred fixes
