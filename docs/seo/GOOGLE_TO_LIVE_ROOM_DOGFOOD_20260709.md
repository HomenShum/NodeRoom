# Google-to-Live-Room Dogfood - 2026-07-09

## Status

- Overall goal status: blocked only on the clean signed-out Google lane and unavailable Search Console credentials.
- Production product path status: pass with no P0/P1 defects and no unresolved Gemini product issues.
- Final deployment verified: `dpl_GEgmBF4Db4XoJCGeqLEQYB7Nx3sz`
- Production URL: `https://noderoom.live`
- Final deployment URL: `https://noderoom-hy38oki8c-hshum2018-gmailcoms-projects.vercel.app`
- Convex deployment verified: `zealous-goshawk-766` (`298` local exported functions live)
- Repo HEAD during deploy: `4dff2703b88be78533f836cf6e5c5adaa42457d6`
- Note: the deploy was made from the local workspace, which still has uncommitted changes from the active fix loop.

## What Changed

- Added a visible reload-recovery status card to the React live-room loading skeleton in `src/ui/RoomShell.tsx`.
- Reused existing live boot styles and added `r-live-boot-card--hydrate` sizing in `src/app/styles.css`.
- Moved heavy live starter seeding behind the first room commit: `convex/rooms.ts` now commits the usable shell/Q3 starter artifacts, schedules `finishStarterRoom`, and exposes `starterBackfill` so the client does not race the backfill with legacy repair.
- Added `Reload recovery` labeling to the static private-route boot shell in `src/landing/boot.ts`, so the deliberate reload proof is distinguishable from initial room creation.
- Made the mobile dogfood harness wait on the dock-input contract instead of a fixed sleep.
- Added `.tmp/google-to-live-dogfood.mjs`, a repeatable Google-origin dogfood harness that records SERP, public SEO, live room, XLSX, reload, mobile, console, and indexing receipts.

## Final Staged Production Proof

- Run ID: `google-to-live-room-dogfood-20260709-final-proof`
- Receipt: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/raw/google-to-live-room-dogfood.json`
- Desktop video: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/videos/google-to-live-room-desktop.webm`
- Review MP4: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/videos/google-to-live-room-desktop.review.mp4`
- Mobile video: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/videos/mobile-join-snapshot.webm`
- XLSX export: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/downloads/q3-variance-export.xlsx`
- Final Gemini judge: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/gemini-video-judge/20260710T001230Z-google-to-live-room-desktop-review.md`
- Vercel inspect: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/raw/vercel-inspect.json`
- Final room: `NRGLMRE6KRT8`
- Google: all four clean-profile queries still returned the `/sorry/` unusual-traffic page; the harness used the explicitly labeled public SEO fallback and did not claim a Google click.
- Product path: public SEO, CTA, live create, chat, Q3 variance, XLSX (`6559` bytes, `PK`), reload persistence, mobile join, and console/CSP/network gates all passed.
- Gemini: first impression `9/10`, value proposition `10/10`, CTA `10/10`, trust `9.5/10`, visual smoothness `9/10`, mobile usability `8.5/10`, activation `10/10`, latency `10/10`; critical issues: none.
- Production Playwright after final deploy: `9 passed / 1 skipped`.
- Vercel error scan after final traffic: CLI returned no error rows.

## Earlier Production Run (superseded by the final staged proof)

- Run ID: `google-to-live-room-dogfood-20260709-final`
- Receipt: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/raw/google-to-live-room-dogfood.json`
- Desktop video: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/google-to-live-room-desktop.webm`
- Review MP4: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/google-to-live-room-desktop.review.mp4`
- Mobile video: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/mobile-join-snapshot.webm`
- XLSX export: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/downloads/q3-variance-export.xlsx`
- Final Gemini judge: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/gemini-video-judge/20260709T101923Z-google-to-live-room-desktop-review.md`
- Vercel inspect: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/raw/vercel-inspect.json`
- Vercel error logs: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/raw/vercel-error-logs.jsonl`
- Post-Playwright Vercel error logs: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/raw/vercel-error-logs-post-playwright.jsonl`

## Additional Google-Origin Attempts

### Clean Chrome Profile

- Run ID: `google-clean-profile-single-query-20260709`
- Query: `noderoom`
- Browser: Chrome channel with a fresh local profile at `.tmp/google-clean-profile-single-query-20260709/chrome-profile`
- Receipt: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709/raw/clean-google-receipt.json`
- Screenshot: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709/screenshots/google-serp.png`
- Video: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709/videos/page@e909b5cac8ac2e80436b1acc625af902.webm`
- Result: blocked by Google before SERP results.
- Clean-profile evidence: `signedInAccountObserved=false`, `signInVisible=false`.
- Block text observed: Google reported unusual traffic for IP `67.188.230.47` at `2026-07-09T10:27:08Z`.

This is the strongest current evidence for the requested clean signed-out browser path, and it still does not produce a clickable SERP because Google returns the sorry/CAPTCHA page.

### Final Blocked-Audit Retry

- Run ID: `google-clean-profile-single-query-20260709-blocked-20260709-032832`
- Query: `noderoom`
- Browser: Chrome channel with a fresh local profile at `.tmp/google-clean-profile-single-query-20260709-blocked-20260709-032832/chrome-profile`
- Receipt: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709-blocked-20260709-032832/raw/clean-google-receipt.json`
- Screenshot: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709-blocked-20260709-032832/screenshots/google-serp.png`
- Video: `docs/seo/journey-artifacts/google-clean-profile-single-query-20260709-blocked-20260709-032832/videos/page@06e9805322bee6845acc3628b34b45d7.webm`
- Result: blocked by Google before SERP results.
- Clean-profile evidence: `signedInAccountObserved=false`, `signInVisible=false`.
- Block text observed: Google reported unusual traffic for IP `67.188.230.47` at `2026-07-09T10:28:35Z`.

This is the third consecutive goal pass where the same clean signed-out Google-origin requirement could not proceed because Google returned the sorry/CAPTCHA page. No CAPTCHA was solved or bypassed.

### In-App Browser SERP Click

- Run ID: `google-iab-single-query-20260709`
- Query: `noderoom`
- SERP receipt: `docs/seo/journey-artifacts/google-iab-single-query-20260709/raw/google-noderoom.json`
- SERP screenshot: `docs/seo/journey-artifacts/google-iab-single-query-20260709/screenshots/google-noderoom.png`
- Click receipt: `docs/seo/journey-artifacts/google-iab-single-query-20260709/raw/clicked-noderoom-root-dom-node.json`
- Click screenshot: `docs/seo/journey-artifacts/google-iab-single-query-20260709/screenshots/clicked-noderoom-root-dom-node.png`
- Result: Google SERP loaded and `https://noderoom.live/` was the top visible NodeRoom result.
- The exact visible result node was clicked and landed on `https://noderoom.live/`.
- Landing checks: title `NodeRoom - live collaborative AI rooms with NodeAgents`, canonical `https://noderoom.live/`, robots `index,follow`, H1 `Diligence that shows its work.`

This receipt proves the current visible Google result and click behavior, but it is not the final clean-profile proof because the in-app browser showed Google account UI for `hshum2018@gmail.com`.

## Deterministic Proof

- `npm run build`: passed.
- `npm test -- --run tests/designPrototypeParity.test.ts`: passed.
- `npm run seo:audit`: `116 pass / 0 warn / 0 fail`.
- Production Playwright gate:
  - `PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_EXPECT_MOBILE_LIVE=1 npx playwright test e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000`
  - Result: `9 passed / 1 skipped`.
- `npm run security:gate -- --dist`: passed.
- Vercel production error log scan: 0 bytes before and after the Playwright traffic, no error rows.

## Product Journey Result

- Public SEO fallback URL: `https://noderoom.live/brand/noderoom/`
- Public SEO checks: NodeRoom title, description, H1, canonical, and NodeAgents term present.
- Primary public CTA clicked: `Open NodeRoom`.
- Live room created: `NRGLMRDCSM7C`.
- Live route verified not `mode=memory`.
- Public chat smoke message posted.
- `Q3 variance` opened.
- XLSX export verified with nonzero bytes and `PK` magic.
- Reload recovery verified: active `Q3 variance` artifact persisted.
- Mobile join verified: first-join notice non-modal and dock input visible.
- Console/CSP/network gate: no CSP violations, no severe app console errors, no severe app network errors.
- Private route indexing verified in browser DOM:
  - `/?create=1`: `noindex,nofollow`
  - `/?demo=review`: `noindex,nofollow`
  - `/?room=NRSEO123`: `noindex,nofollow`
- Public pages remained indexable and branded as NodeRoom.

## Earlier Gemini Result (superseded by the final staged proof)

Final Gemini scores:

- first impression: `9/10`
- value proposition clarity: `9/10`
- CTA clarity: `10/10`
- trust: `9/10`
- visual smoothness: `6/10`
- mobile usability: `8/10`
- activation flow: `9/10`
- latency perception: `7/10`

Gemini reported one `medium` issue at `00:51`: it interpreted the proof video's hard reload recovery segment as a flash back to loading after the workspace had loaded.

Waiver:

- This is explicitly waived for this run because the harness deliberately calls `page.reload()` after XLSX export to prove reload recovery.
- Frame evidence shows the intended sequence: static boot shell, new `Reload recovery / Restoring room state` card, then the same `Q3 variance` sheet and chat return.
- Deterministic receipts confirm `activeArtifactPersisted: true`, console/network gates clean, and the production Playwright reload test passed.
- This is not a spontaneous post-mount state reset in the observed product path.

The latency recommendation remains a future product-improvement candidate, not a blocking defect for this dogfood receipt.

## Remaining Blockers

1. Google-origin automation remains blocked.
   - Clean signed-out Chrome received Google `429` sorry/CAPTCHA pages for all requested queries:
     - `noderoom`
     - `NodeRoom live AI room`
     - `NodeRoom NodeAgents`
     - `noderoom.live`
   - A later one-query clean Chrome profile retry for `noderoom` also received the Google sorry/CAPTCHA page before showing any results.
   - A third blocked-audit retry at `2026-07-09T10:28:35Z` produced the same Google sorry/CAPTCHA result from a new fresh Chrome profile.
   - The run did not click a real Google result because bypassing Google anti-bot controls is not acceptable.
   - The main dogfood harness continued via an explicitly labeled public SEO fallback and did not claim Google-origin success.
   - A separate signed-in in-app browser receipt did click the visible Google result to `https://noderoom.live/`, but it is not a substitute for the clean signed-out requirement.

2. Search Console live API was not available in this shell.
   - `npm run seo:search-console` failed without `GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN` or `GOOGLE_APPLICATION_CREDENTIALS`.
   - `npm run seo:search-console -- --dry-run` completed only to verify output shape.

## Commands Run

```bash
npm run build
npm test -- --run tests/designPrototypeParity.test.ts
npm run seo:audit
npx --yes vercel@50.28.0 --prod --yes
SEO_QA_ALLOW_GOOGLE_ORIGIN=1 DOGFOOD_HEADED=1 DOGFOOD_BROWSER_CHANNEL=chrome DOGFOOD_BASE_URL=https://noderoom.live DOGFOOD_RUN_ID=google-to-live-room-dogfood-20260709-final node .tmp/google-to-live-dogfood.mjs
npm run seo:compress-video -- --input docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/google-to-live-room-desktop.webm --mode review --out docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/google-to-live-room-desktop.review.mp4
npm run seo:judge-video -- --input docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/videos/google-to-live-room-desktop.review.mp4 --scenario google-origin --out-dir docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final/gemini-video-judge
PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_EXPECT_MOBILE_LIVE=1 npx playwright test e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000
npx --yes vercel@50.28.0 inspect https://noderoom.live --format=json
npx --yes vercel@50.28.0 logs noderoom-h0746gntw-hshum2018-gmailcoms-projects.vercel.app --no-follow --level error --since 1h --json
npm run security:gate -- --dist
GOOGLE_CLEAN_RUN_ID=google-clean-profile-single-query-20260709 GOOGLE_CLEAN_QUERY=noderoom GOOGLE_CLEAN_BROWSER_CHANNEL=chrome node .tmp/google-clean-profile-single-query.mjs
GOOGLE_CLEAN_RUN_ID=google-clean-profile-single-query-20260709-blocked-20260709-032832 GOOGLE_CLEAN_QUERY=noderoom GOOGLE_CLEAN_BROWSER_CHANNEL=chrome node .tmp/google-clean-profile-single-query.mjs
```
