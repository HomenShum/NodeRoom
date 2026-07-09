---
name: seo-qa
description: Run NodeRoom's repeatable SEO and landing-flow QA workflow. Use when auditing or improving public SEO pages, metadata, sitemap/robots, Search Console metrics, Playwright landing journeys, Lighthouse/Core Web Vitals evidence, Gemini video judging, or Nebius-first text/JSON judging without scraping Google rankings.
---

# NodeRoom SEO QA

## Workflow

1. Confirm the target surface.
   - Public SEO pages are crawlable routes such as `/`, `/use-cases/`, `/compare/...`, `/learn/`, `/pricing/`, and `/faq/`.
   - Private or app surfaces include room/demo/create URLs, hash-app routes, live rooms, backend state, and benchmark fixtures.
2. Run the static audit:

```bash
npm run seo:audit
```

3. Run browser journeys when UI behavior is in scope:

```bash
PLAYWRIGHT_RECORD_VIDEO=1 npm run test:journeys
```

4. Compress a selected video before model judging:

4. Run the local performance budget check:

```bash
npm run seo:perf
```

5. Compress a selected video before model judging:

```bash
npm run seo:compress-video -- --input <video.webm> --mode review
```

6. Judge the compressed video with Gemini when `GOOGLE_GENERATIVE_AI_API_KEY` is available:

```bash
npm run seo:judge-video -- --input <video.mp4>
```

7. Pull Search Console data only when credentials are available:

```bash
npm run seo:search-console
```

8. Update `docs/seo/SEO_AUDIT.md` or `docs/seo/JOURNEY_QA_REPORT.md` with artifact links, before/after findings, and deferred fixes.

## Hard Rules

- Do not automate mass Google searches, fake clicks, ranking scrapes, or link spam.
- Use Search Console for query, impression, CTR, and average-position data.
- Keep public pages crawlable and fast.
- Keep room/demo/create/app-scoped URLs out of the sitemap and protected with noindex behavior.
- Do not print or commit API keys.
- Do not rewrite backend, auth, realtime, or room engine behavior for an SEO change unless the task explicitly requires a compatibility fix.
- Structured data must match visible page content.

## Scripts

- `scripts/audit-static.ts`: check metadata, sitemap, robots, route files, headings, canonicals, and private-route indexing guards.
- `scripts/search-console-report.ts`: query Google Search Console using an access token or service-account JSON and write JSON/Markdown reports.
- `scripts/performance-check.ts`: collect lab Core Web Vitals-style metrics and write a performance report.
- `scripts/compress-video.ts`: create readable or low-cost MP4 review copies with ffmpeg.
- `scripts/judge-video-gemini.ts`: produce structured Gemini visual QA JSON and Markdown summaries from a video.

## Browser QA Notes

- Use Playwright for repeatable journey tests, screenshots, traces, and videos.
- Use Chrome DevTools or Lighthouse separately for performance traces and Core Web Vitals evidence.
- The Google-origin journey is opt-in with `SEO_QA_ALLOW_GOOGLE_ORIGIN=1` and performs one target phrase only; default CI should use direct landing URL fallback.

## Model Policy

- Use Nebius first for text/JSON SEO judging, landing copy variants, app-side reasoning, fast chat, and code reasoning.
- Use Gemini first for video understanding.
- Use fallbacks only when the primary provider is unavailable or lacks the required capability.
- Record provider, model, routing reason, and missing-key blockers in the report without logging secret values.
