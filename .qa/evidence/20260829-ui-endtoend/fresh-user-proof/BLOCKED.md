# Fresh-user vertical proof rerun — RESOLVED 2026-08-29 (same day)

This file briefly documented a blocker: the proofStaleness gate flagged the
marketed fresh-user proof as 48 days stale, and the rerun was blocked because the
production sign-in funnel was dead.

## Root cause (found and fixed the same day)

NOT a GitHub/app-level auth failure. The Vercel production env had
`VITE_CONVEX_URL` pointed at the standby Convex deployment (`aromatic-bass-102`)
while `VITE_CONVEX_SITE_URL` and every convex deploy pointed at
`zealous-goshawk-766`. The crossed pair made `auth:signIn` throw a redacted
Server Error for every visitor before any redirect to GitHub; zero
github-provider accounts had ever been created on the serving backend.

Diagnosis trail: the identical signIn call succeeded via raw HTTP and the
WebSocket client against goshawk; the live bundle's baked env exposed the split
(`import.meta.env` inlined bass-102 + site URL goshawk + provider github).

## Fix + permanent guard

- Vercel prod `VITE_CONVEX_URL` repointed to goshawk; rebuild verified live
  (chunk graph: goshawk present, bass-102 absent across 393 chunks).
- `ship:prod` now always runs `ship-prod-verify --chunk-signal
  zealous-goshawk-766.convex.cloud --chunk-absent aromatic-bass-102` — the gate
  was dry-run against the broken build first and correctly failed it.

## Proof rerun (completed)

Cold-visitor funnel verified end to end, then the authenticated fresh-user run
executed on the free route (cohere/north-mini-code:free, 3 turns, 2 tools, 9.0s
trace, $0.000, read-only, block IDs legacy-dac84c29-1..5 matching the July
baseline). Receipts regenerated:
- `docs/eval/noderoom-fresh-user-vertical-proof.json` (generatedAt 2026-08-29)
- `docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md`
proofStaleness gate: GREEN.
