# NodeRoom Production Dogfood Receipt

Run ID: `google-to-live-room-dogfood-20260709-final-proof`

Status: product path pass; clean signed-out Google discovery blocked by Google's unusual-traffic challenge.

Deployment:

- Vercel: `dpl_GEgmBF4Db4XoJCGeqLEQYB7Nx3sz`
- URL: `https://noderoom.live`
- Convex: `zealous-goshawk-766`
- Commit at deploy: `4dff2703b88be78533f836cf6e5c5adaa42457d6` (dirty workspace deploy)

Proof:

- Receipt: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/raw/google-to-live-room-dogfood.json`
- Desktop proof: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/videos/google-to-live-room-desktop.webm`
- Gemini review: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/gemini-video-judge/20260710T001230Z-google-to-live-room-desktop-review.md`
- XLSX: `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/downloads/q3-variance-export.xlsx` (`6559` bytes, `PK` magic)
- Room: `NRGLMRE6KRT8`

Gates:

- Build: pass
- SEO audit: `116 pass / 0 warn / 0 fail`
- Security gate: pass
- Production Playwright: `9 passed / 1 skipped`
- Vercel error scan: no error rows
- Gemini critical issues: none

Remaining external blockers:

- Google clean Chrome from IP `67.188.230.47` receives `/sorry/` unusual-traffic pages for all four discovery queries. No CAPTCHA bypass was used.
- Search Console live API was unavailable because credentials were not present in the shell.
