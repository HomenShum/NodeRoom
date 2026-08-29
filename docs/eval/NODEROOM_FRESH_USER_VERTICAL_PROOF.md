# NodeRoom Fresh-User Vertical Proof

Generated: 2026-08-29 (supersedes the 2026-07-12 receipt)

## Scope

This receipt follows a first-time visitor entering the product through the visible
funnel, running the zero-cost NodeAgent route read-only, and opening the
work-artifact, run-trace, and entity-graph surfaces. It is product-path evidence,
not a substitute for benchmark scorer receipts.

It also certifies the funnel itself, because on the morning of 2026-08-29 the
funnel was dead: the Vercel production env pointed the frontend at the standby
Convex deployment (`aromatic-bass-102`) while the site URL and every deploy
pointed at `zealous-goshawk-766`, so GitHub sign-in threw a Server Error for every
visitor and no GitHub account had ever been created. The env was repointed the
same day, and `ship:prod` now hard-fails if the served bundle ever bakes the
standby again (`--chunk-signal` / `--chunk-absent` in scripts/ship-prod-verify.mjs).

## Live Path (all steps through the visible product, 2026-08-29)

1. Cold-visitor probe (fresh browser, no storage): landing → "Try a sample" →
   synthetic-workspace consent dialog → "Sign in to start a sample room" →
   Continue with GitHub → **redirected to github.com's login page**
   (`.qa/evidence/20260829-ui-endtoend/fresh-user-proof/github-redirect.png`).
   Before the fix this click failed instantly with no redirect.
2. Authenticated entry: GitHub OAuth completed and landed in live room
   `NRSDDEYWAZI` ("Startup Banking Diligence War Room", live convex, sample-data
   banner shown honestly). First github-provider account on this deployment.
3. Route control: the visible picker offers Adaptive (recommended) / Free $0 /
   Top paid / Specific model. Selected **Free $0**; the composer pinned
   `openrouter/free-auto`.
4. Sent: `@nodeagent read the Open questions / workplan notebook and summarize
   its existing human blocks without changing anything. Cite exact block IDs.`
5. NodeAgent resolved `cohere/north-mini-code:free`, completed 3 model turns and
   2 tool calls (`list_artifacts`, `read_notebook`), trace wall-clock 9.0s,
   $0.000 cost, zero artifact changes.
6. The answer cited the five pre-existing human blocks by exact ID —
   `legacy-dac84c29-1` through `legacy-dac84c29-5` — matching the 2026-07-12
   baseline blocks, without an edit mutation.
7. Run Trace opened from the room: 4 spans with per-span durations
   (context.gather×2 330ms, list_artifacts 47ms, read_notebook 283ms).
8. Work Artifacts opened: proof bundle receipt `9cde9378` — 17 artifacts,
   16 review items, 8 traces; Review Center honestly reports 0 pending
   (the run was read-only). Live performance: 6 messages (2 human · 4 agent),
   2 tools, $0.0.
9. Entity Graph opened: 2 entities · 0 edges · 8 events, with the graph's
   honesty footnote about unmeasured counts rendered.

## What this receipt does NOT claim

The 2026-07-12 receipt's deeper feature proofs — collaborative deck versioning,
the notebook kernel's bounded expression, and the governed agent-edit approval
flow — were not rerun on 2026-08-29 and are retired from this claim rather than
carried forward under a fresh date. Re-prove them individually if a surface
claim needs them.

Machine-readable receipt: `docs/eval/noderoom-fresh-user-vertical-proof.json`.
Evidence: `.qa/evidence/20260829-ui-endtoend/fresh-user-proof/`.
