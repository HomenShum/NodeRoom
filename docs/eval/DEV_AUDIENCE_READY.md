# Dev Audience Ready

Generated: 2026-07-09T07:37:00.762Z
Status: pass

This proof is for intended developers and customer technical evaluators. It is separate from official benchmark score claims.

## What This Proves

- Local ProofLoop doctor can run.
- Codex, Claude Code, Cursor, Windsurf, Devin, and generic CLI setup receipts can be generated.
- Native launch/session-export plumbing works using dry-run or local fake workers, without paid model calls.
- Free-first route policy is active and paid fallback flags are not enabled by default.

## Customer Smoke

```bash
npm run proofloop -- goal init dev-audience-ready --template dev-audience-ready
npm run proofloop -- supervise --goal dev-audience-ready
npm run proofloop -- gate --goal dev-audience-ready
```

## Official Scores

This goal does not prove SpreadsheetBench, Finch, FinAuditing, or WorkstreamBench official scores. Those still require full task/model/scorer receipts in the `official-scores` goal.
