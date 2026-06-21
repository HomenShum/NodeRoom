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
npm run qa:ui:scorecard
npm run qa:ui:scorecard -- --functional=passed --performance=passed --accessibility=passed
npm run qa:ui:perf -- --use-design-floor
npm run qa:ui:a11y -- --use-design-floor
npm run qa:ui:references
npm run qa:ui:virality
```

The default command does not pretend functional gates ran in the current process.
Pass `--functional=passed` only after `npm run prod:gate` and
`npm run test:product:live` have actually passed for the same commit.

The `capture`, `perf`, `a11y`, `judge`, `references`, and `virality` commands
write command-specific layer JSON next to the full scorecard. Today, `perf` and
`a11y` are only attached when `--use-design-floor` is passed after a fresh
`scripts/design-qa/floor.ts` run; otherwise they remain `not_run`.
