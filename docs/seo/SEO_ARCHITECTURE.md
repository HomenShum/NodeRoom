# NodeRoom SEO Architecture

## Boundary

NodeRoom has two different surfaces:

- Public SEO surface: crawlable marketing and education URLs that explain the product and route users into the app.
- Private or app surface: live rooms, demo/create/join URLs, authenticated or scoped work, trace-heavy app routes, and benchmark fixtures.

The public surface should be fast, crawlable, and stable. The app surface should preserve product behavior and should not be optimized for indexing.

## Current Implementation

- Root app shell: `index.html` with Vite/React mounted at `src/app/main.tsx`.
- Public root first paint: `index.html` includes a lightweight static landing shell. Bare `/` loads the full React app on user interaction; app/query/hash routes start React immediately.
- Main landing UI: `src/ui/Landing.tsx`.
- Static public SEO pages: `public/brand/`, `public/solutions/`, `public/use-cases/`, `public/compare/`, `public/blog/`, `public/learn/`, `public/pricing/`, and `public/faq/`.
- Crawl controls: `public/robots.txt` and `public/sitemap.xml`.
- Private route guard: `index.html` changes the robots meta tag to `noindex,nofollow` for room/demo/create and hash-app URLs.
- Social preview image: existing product screenshot at `/qa-trace/demo-room-desktop.png`.

## Route Policy

| Route | Purpose | Indexing |
|---|---|---|
| `/` | Primary landing and product entry | index |
| `/brand/noderoom/` | Exact-brand entity and disambiguation page | index |
| `/solutions/` | Solution cluster hub | index |
| `/solutions/collaborative-ai-workspace/` | Collaborative AI workspace intent | index |
| `/solutions/ai-agent-collaboration/` | AI agent collaboration intent | index |
| `/solutions/source-backed-ai-workflows/` | Source-backed AI workflow intent | index |
| `/solutions/ai-diligence-room/` | AI diligence room intent | index |
| `/solutions/ai-research-workspace/` | AI research workspace intent | index |
| `/use-cases/` | Use-case hub | index |
| `/use-cases/startups/` | Startup diligence intent | index |
| `/use-cases/sales/` | Sales research intent | index |
| `/use-cases/finance/` | Finance workflow intent | index |
| `/use-cases/students/` | Student project intent | index |
| `/compare/slack-ai/` | Comparison page | index |
| `/compare/notion-ai/` | Comparison page | index |
| `/compare/google-docs/` | Comparison page | index |
| `/blog/` | Blog index placeholder | index |
| `/learn/` | Workflow education | index |
| `/pricing/` | Pricing/status | index |
| `/faq/` | FAQ with visible FAQ structured data | index |
| `/?room=...`, `/?demo=...`, `/?create=...` | live/scoped room entry | noindex |
| `/#mobile`, `/#rooms/...`, `/#btb`, `/#story`, `/#frontier` | app/demo/hash surfaces | noindex where the app shell sees the fragment |

## Metadata Rules

- Every public SEO page needs one H1, a descriptive title, a meta description, a canonical URL, and an OG image.
- Structured data must describe visible page content only.
- Private app URLs must not be added to the sitemap.
- `llms.txt` is available at `/llms.txt` for AI search and agent-facing content guidance; it is not treated as a Google Search ranking mechanism.

## QA Loop

1. Run `npm run seo:audit` for static crawl and metadata checks.
2. Run `npm run test:journeys` with `PLAYWRIGHT_RECORD_VIDEO=1` for landing and app journey recordings.
3. Compress selected videos with `npm run seo:compress-video -- --input <video>`.
4. Judge recordings with `npm run seo:judge-video -- --input <video>` when `GOOGLE_GENERATIVE_AI_API_KEY` is available.
5. Pull Search Console metrics with `npm run seo:search-console` when Search Console credentials are available.
6. Record before/after findings in `docs/seo/SEO_AUDIT.md` and journey outcomes in `docs/seo/JOURNEY_QA_REPORT.md`.

## Model Routing

The SEO QA system uses `src/lib/models/modelRouter.ts`:

- Nebius first for text/JSON SEO judging, landing copy variants, app-side reasoning, fast chat, and code reasoning tasks.
- Gemini first for video understanding.
- Fallbacks are declared in route decisions and should be used only when the primary provider is unavailable or lacks the needed capability.
- Provider keys are read from environment variables and must never be printed.

## Non-Goals

- Do not scrape Google rankings or generate fake search traffic.
- Do not make live room data crawlable.
- Do not rewrite the app shell or backend to satisfy public-page SEO.
- Do not treat Gemini video feedback as a deterministic product gate; it is a visual QA input that must be paired with browser artifacts and product tests.
