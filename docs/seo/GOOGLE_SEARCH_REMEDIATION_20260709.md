# Google Search Remediation - 2026-07-09

## Current Search State

- Query tested in Chrome: `noderoom`
- Top visible Google result: `https://noderoom.live/brand/noderoom/`
- Additional visible NodeRoom result: `https://noderoom.live/solutions/collaborative-ai-workspace/`
- Search Console property: `https://noderoom.live/`
- Search Console observations:
  - `/` was indexed and re-submitted to the priority crawl queue.
  - `/brand/noderoom/` was indexed and re-submitted to the priority crawl queue.
  - `/sitemap.xml` was submitted successfully, last read on 2026-07-08, with 20 discovered pages.
  - Current reach stat observed during this pass: 0 total web search clicks.

## Product/SEO Fixes

- Added dark-mode support to static SEO pages so dark-mode Google users do not see a bright flash between Google and NodeRoom.
- Renamed the public landing brand label from `NodeAgent` to `NodeRoom`, while preserving `NodeAgents` as the term for agents inside the room.
- Added an immediate `noindex,nofollow` private-route guard for `room|demo|create` URLs in the root shell.
- Strengthened primary CTA hierarchy on static SEO pages and the app landing.

## Proof

- `npm run seo:audit`: pass=116, warn=0, fail=0
- `npm run build`: passed
- Gemini visual judge: `gemini-3.5-flash`
- Final judge scores:
  - first impression: 9/10
  - value proposition clarity: 9/10
  - CTA clarity: 8.5/10
  - trust: 9/10
  - visual smoothness: 9.5/10
  - mobile usability: 8/10
  - activation flow: 8.5/10
  - latency perception: 9.5/10
- Gemini critical issues: none

Local proof artifacts are under `docs/seo/journey-artifacts/`, which is intentionally gitignored:

- Fresh Google search video: `docs/seo/journey-artifacts/google-search-20260709/noderoom-google-search-20260709.mp4`
- Production click-through baseline video: `docs/seo/journey-artifacts/google-search-full-journey-20260709/noderoom-google-search-full-journey-20260709.mp4`
- Final remediated proof video: `docs/seo/journey-artifacts/google-search-remediated-final-20260709/noderoom-google-search-remediated-final-20260709.mp4`
- Final Gemini judge receipt: `docs/seo/journey-artifacts/google-search-remediated-final-20260709/gemini-video-judge/20260709T092522Z-noderoom-google-search-remediated-final-20260709.md`

The final remediated proof uses the fresh production Google search frames from Chrome and a local production build for the fixed NodeRoom pages before deployment.
