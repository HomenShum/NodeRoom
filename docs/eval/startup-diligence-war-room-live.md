# Startup Diligence War Room Live Eval

Status: captured startup media plus passing Convex contract and provider-produced evals. The live-join path and the richer war-room synthesis clip are both rendered; the executable contract proof validates the room/job/artifact invariants, and `npm run eval:startup-diligence:provider` proves one real model-generated CellPayload/final-copy path through the same contract. The next hard gate is repeated N=5/p95 provider stability. The machine-readable proof boundary is tracked in `docs/eval/startup-diligence-war-room-live.json`.

## Goal

Verify that the public demo is not just a UI animation. The live eval must prove the flow:

`account intake -> concurrent agent work -> evidence-bearing sheet updates -> no-clobber preservation -> review/proposal -> trace -> downstream drafts`

## Required Checks

| Check | Evidence Required |
|---|---|
| Account import upserts instead of duplicating | Browser state plus trace row |
| Company research uses citations | Cell payload contains source refs |
| Human edit during agent work is preserved | CAS conflict or draft/proposal evidence |
| Multiple lanes run concurrently | Work queue has distinct lane ids, statuses, and receipts |
| Private agent output stays private | Second user cannot read private channel |
| Proposal approval is in-context | Host-reviewed proposal commits an evidence-bearing cell payload |
| Downstream handoff has no side effect | Draft card/export only, no OAuth call |
| Trace includes model route | agent run or job row records model/resolved model |

## Latest Evidence

- Unit/runtime floor: 89 test files, 501 tests passed on 2026-06-14.
- Build floor: `npm run build` passed on 2026-06-14 with only existing Vite chunk-size warnings.
- Startup walkthrough specs: `startup-diligence-live-join` captures the live create/code/join path; `startup-diligence-war-room` captures the richer scripted synthesis story.
- Fresh-room join path: rendered to `docs/walkthroughs/startup-diligence-live-join.mp4` and `.gif` on 2026-06-14.
- War-room synthesis path: rendered to `docs/walkthroughs/startup-diligence-war-room.mp4` and `.gif`; the current checked media was regenerated and rejudged on 2026-06-17.
- Product/demo alignment update: the walkthrough scripts now use the latest startup-banking story from the 2026-06-14 deep review: CardioNova intake, five-company bulk diligence, runway/milestone ownership, no-clobber proof, private banker lane, and draft-only downstream handoff.
- Startup-specific workbench: `/demo multi-agent startup diligence ...` now renders research, finance, and review lanes instead of the generic public-gold benchmark lanes; the original benchmark workbench remains available for non-startup prompts.
- Live-join path: the capture script now includes three users: Maya creates the room, Priya submits the CardioNova/bulk diligence ask, and Alex owns runway/milestone questions.
- Proof manifest: `docs/eval/startup-diligence-war-room-live.json` records what each clip proves, what the contract eval proves, what the provider-produced eval proves, and what still requires N=5/p95 provider stability.
- Final target capture: `npm run walkthroughs -- startup-diligence-war-room` and `npm run walkthroughs -- startup-diligence-live-join` passed on 2026-06-14 against `http://127.0.0.1:5178`, producing 19 war-room segments and 13 live-join segments.
- Final target render: `npm run walkthroughs:render -- startup-diligence-live-join` and `npm run walkthroughs:render -- startup-diligence-war-room` passed on 2026-06-14; Remotion emitted a nonfatal zod version warning.
- Media judges: live-join remains covered by run `20260614T233419Z`
  (`publish`, `10.9/16`, one P2 perspective-transition note). The current
  war-room asset is covered by run `20260617T2015Z` (`publish`, `10.4/16`, no
  reported defects). These are media/UX reviews only; they do not replace
  backend, browser, privacy, provider, or load gates.
- Live-root guard: bad persisted live sessions and unusable room ids are rejected/skipped before Convex room-scoped queries.
- Browser/Playwright visual evidence: isolated two-client create/join verification renders the Startup Banking Diligence War Room with Mercury/Ramp/Brex research rows, all six handoff targets, Maya and Priya in room `NR2TY6MLO9T`, Priya's chat message, and no guided-tour overlay.
- Convex contract eval: `npm run eval:startup-diligence:live` passed 9/9 on
  2026-06-15 and wrote
  `docs/eval/startup-diligence-war-room-live-results.json`. It proves account
  upsert, host-reviewed evidence-bearing `CellPayload`, stale-agent no-clobber
  conflict/proposal, private boundary, runway chart artifact, downstream
  draft-only handoff, multi-lane job request, and route/cost/runtime trace
  metadata. `providerProducedContent` is intentionally `false`.
- Provider-produced eval: `npm run eval:startup-diligence:provider` passed 9/9
  on 2026-06-15 and wrote
  `docs/eval/startup-diligence-provider-results.json`. It succeeded on
  `gpt-5.4-nano` in 2914ms at `$0.00042775`; the model-generated CardioNova
  `CellPayload` and final text flowed through the same host-reviewed proposal,
  no-clobber, private-boundary, route receipt, token/cost, and job trace
  contract.

## Next Capture Command

Use the existing walkthrough pipeline first:

```bash
npm run walkthroughs -- startup-diligence-live-join
npm run walkthroughs:render -- startup-diligence-live-join
npm run walkthroughs -- startup-diligence-war-room
npm run walkthroughs:render -- startup-diligence-war-room
npm run media:gemini-judge -- --only startup-diligence --include-ignored
```

The live-join spec proves fresh room creation and three-user startup-diligence coordination. The `startup-diligence-war-room` spec covers the scripted research/enrichment/private/downstream story. The contract eval proves the Convex write/review/privacy/trace path. The provider eval proves one real model-generated CellPayload/final-copy path through that contract. The next hard gate is repeating the provider-produced eval N=5 and promoting only if p95 latency, route/path fingerprint drift, and pass rate meet the live collaboration SLO.
