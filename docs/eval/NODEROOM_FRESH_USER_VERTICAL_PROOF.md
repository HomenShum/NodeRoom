# NodeRoom Fresh-User Vertical Proof

Generated: 2026-10-31 (supersedes the 2026-08-29 receipt)

## Scope

This receipt follows a first-time visitor entering the product through the visible
funnel, running the zero-cost NodeAgent route read-only, and opening the
work-artifact, run-trace, and entity-graph surfaces. It is product-path evidence,
not a substitute for benchmark scorer receipts.

It was produced by an agent driving real browsers against production and
transcribing what the UI rendered: a fresh headless Playwright context for the
cold-visitor probe, and the owner's Chrome (Claude in Chrome) for the
authenticated run. The owner completed the GitHub sign-in; the agent typed no
credentials.

## Live Path (all steps through the visible product, 2026-10-30/31)

1. Cold-visitor probe (fresh browser, no storage, 2026-10-31T03:57Z): landing →
   "Try a sample room" → sample dialog → "Start sample room" → "Sign in to start
   a sample room" → Continue with GitHub → **github.com's login page, "to
   continue to NodeRoom Production"**, with the OAuth callback on
   `zealous-goshawk-766.convex.site` (the 2026-08-29 crossed-deployment fix
   still holds). Screenshots: `cold-sample-dialog.png`, `cold-signin-gate.png`,
   `github-redirect.png`.
2. Authenticated entry: GitHub OAuth sign-in, then the existing live room
   `NRSDDEYWAZI` ("Startup Banking Diligence War Room", sample-data banner shown)
   via `?room=NRSDDEYWAZI`. No new room was created. Before the run the room
   held 6 messages and 1 agent run.
3. Route control: the visible picker offers Adaptive (recommended) / Free /
   Top paid / Specific model. Selected **Free**; the composer showed Free $0.
4. Sent once (2026-10-31T18:07:02Z): `@nodeagent read the Open questions /
   workplan notebook and summarize its existing human blocks without changing
   anything. Cite exact block IDs.`
5. NodeAgent routed `openrouter/free-auto` → `cohere/north-mini-code:free` and
   finished "completed with recovered steps": 4 model turns and 3 tool calls.
   Its first `read_notebook` call failed with `artifact_not_notebook`; it then
   called `list_artifacts` (6 room artifacts) and retried `read_notebook`
   successfully. Trace wall-clock 16.7s, $0.000 cost, zero artifact changes.
6. The answer cited the five pre-existing human blocks by exact ID —
   `legacy-dac84c29-1` through `legacy-dac84c29-5` — matching the 2026-07-12
   baseline, and reported the notebook still at version 1.
7. Run Trace opened from the room (42 room events): 5 spans with per-span
   durations (context.gather×3 375ms, read_notebook error 110ms,
   list_artifacts 14ms, read_notebook retried ok 251ms). Screenshot:
   `run-trace.jpg`.
8. Work Artifacts opened: proof bundle receipt `ce81a0e6` — 9 artifacts,
   0 evidence, 16 review items, 0 traces; Review Center reports 0 pending,
   0 edits, 0 rebases (the run was read-only). Live performance: 8 messages
   (3 human · 5 agent), 3 tools, 0 agent traces, $0.000. Screenshot:
   `work-artifacts.jpg`.
9. Entity Graph opened (Entity view): 11 nodes and 18 edges; the live-session
   graph rail reports 0 entities. Screenshot: `entity-graph.jpg`.

## Differences from the 2026-08-29 receipt

- The agent hit one tool error (`read_notebook` → `artifact_not_notebook`)
  and recovered; on 2026-08-29 the same prompt ran cleanly in 3 turns and 2 tools.
- The proof bundle and live-performance counters report 0 traces even though the
  Run Trace view shows this run's 5 spans (2026-08-29: 8 traces, 1 agent trace).
- The proof bundle counts 9 artifacts (2026-08-29: 17).
- The entity graph renders a node graph instead of the earlier
  "2 entities · 0 edges · 8 events" counter.

These are recorded as observed, not explained; each needs its own investigation
before a surface claim depends on it.

## What this receipt does NOT claim

The 2026-07-12 receipt's deeper feature proofs — collaborative deck versioning,
the notebook kernel's bounded expression, and the governed agent-edit approval
flow — were not rerun and stay retired from this claim. Re-prove them
individually if a surface claim needs them.

Machine-readable receipt: `docs/eval/noderoom-fresh-user-vertical-proof.json`.
Evidence: `.qa/evidence/20261031-ui-endtoend/fresh-user-proof/`.
