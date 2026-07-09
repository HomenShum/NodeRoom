# Prod Dogfood CSP Follow-up

Generated raw run: `docs/qa/prod-dogfood/2026-07-08-2039/` (local only, gitignored because it contains large traces/videos).

## Pre-fix production findings

- `https://noderoom.live/` rendered the static landing, but console logs reported CSP violations for inline JSON-LD and inline font preload handlers.
- `https://noderoom.live/?demo=qamrcyorlt&name=QA-DOGFOOD-2026-07-08-2039` did not expose the core room selectors during the run: artifact panel, chat composer, left rail, room trace, and related room controls were all counted as `0`.
- The raw run generated four candidate issues: missing live-backend visibility, missing core room work surface, blocked chat send automation, and unreliable two-context collaboration visibility.

## Fix in this pass

- Moved executable landing/app boot logic out of inline scripts and into `src/landing/boot.ts`.
- Replaced CSP-blocked font preload `onload` handlers with normal stylesheet links.
- Kept structured data while preserving strict CSP by adding exact SHA-256 hashes for the three JSON-LD blocks in `vercel.json`.

## Local regression proof

- `npm run security:gate` passed.
- `npm run build` passed.
- `npm run security:gate -- --dist` passed.
- Built `dist/` was served with the production `vercel.json` CSP header and Playwright loaded `/`, `/?mode=memory&surface=desktop`, `/?demo=QA2039&name=QA`, `/brand/noderoom/`, and `/faq/` with no CSP console violations and no page errors.

## Remaining production proof

Rerun the prod dogfood suite after deployment to replace the pre-fix raw run with a post-deploy receipt. The local CSP proof validates the built artifact, but `https://noderoom.live` cannot prove the deployed behavior until this branch is live.
