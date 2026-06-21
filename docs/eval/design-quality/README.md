# Design Quality Substrate

This directory stores NodeRoom UI/UX evidence separately from product correctness.

Product gates answer: does the app work?

Design-quality gates answer: can a human understand, trust, operate, share, and return to the product?

The scorecard intentionally keeps these layers separate:

- functional gates
- responsiveness checks
- accessibility checks
- media/VLM review
- professional reference comparison
- virality and collaboration-loop signals

Generated outputs:

- `latest.json` - machine-readable scorecard
- `latest.md` - human-readable scorecard
- `runs/<runId>/run.json` - immutable run snapshot
- `.nodeagent/design-quality/events.jsonl` - local-first design memory ledger
- `plans/design-quality/latest/plan.mdx` - design-fix handoff plan

Commands:

```bash
npm run qa:ui:capture
npm run qa:ui:perf
npm run qa:ui:a11y
npm run qa:ui:judge
npm run qa:ui:references
npm run qa:ui:virality
npm run qa:ui:scorecard -- --functional=passed
```

The default command does not pretend functional gates ran in the current process.
Pass `--functional=passed` only after `npm run prod:gate` and
`npm run test:product:live` have actually passed for the same commit.
Do not override `--performance` or `--accessibility` when current browser
evidence is attached; the browser evidence wins.

The `capture`, `perf`, `a11y`, `judge`, `references`, and `virality` commands
write command-specific layer JSON next to the full scorecard. `capture` writes
fresh Playwright screenshots, DOM snapshots, performance, and deterministic
accessibility evidence. `perf`, `a11y`, and `scorecard` reuse
`browser.latest.json` only when its runtime source-tree hash, app target, and
freshness window match the current run; otherwise they collect fresh browser
evidence. `--use-design-floor` remains a legacy/manual fallback, not the normal
proof path.
