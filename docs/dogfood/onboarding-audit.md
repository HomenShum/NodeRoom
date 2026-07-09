# Proof Loop Onboarding Audit

Dogfood date: 2026-07-08

## Audiences

| Audience | Best first command | Current result | Friction |
|---|---|---|---|
| Hackathon beginner | `npx proofloop init --agent auto --live` | Works in fresh fixture and writes docs/scripts. | Browser/CI readiness still requires follow-up setup; first `npx` prompt needs explicit `--yes` in automation. |
| Experienced engineer | `npm run proofloop -- manifest --json` | Strong machine-readable command surface. | Proposed dogfood command aliases now exist for `brief`, `graph ingest`, `memory recall`, and hybrid search. |
| Claude Code user | `npm run proofloop -- agents setup claude-code` | Ready with local hooks receipt. | Needs a clear "what changed in `.claude/settings.local.json`" section. |
| Codex user | `npm run proofloop -- agents setup codex` | Ready with local hooks receipt and launch command. | `proofloop-gate` is now a suite alias for closed-loop dry runs. |
| Cursor/Windsurf user | `npm run proofloop -- agents setup cursor` / `windsurf` | Honest `needs_adapter`. | Needs wrapper/extension docs before this can be marketed as frictionless. |
| Enterprise evaluator | `npm run proofloop -- providers setup all` and `npm run proofloop -- ci install github --goal official-scores` | Provider receipts are clean and CI workflow installs. | `official-scores` is now initialized by `proofloop init`; legacy `default` gate/resume commands resolve to it. |

## What Proof Loop Will Not Claim

- Proxy proof is not an official benchmark score.
- Missing external credentials block only that provider or service layer.
- Live browser proof is required for UI/UX production-readiness claims.
- Coding-agent prose is not a terminal state.
- Unsupported agents must remain `needs_adapter`, not `ready`.
- A generated chart is only credible when its rows map back to source files and source fields.

## Launch Readiness Takeaway

The fresh-user, Codex, Claude Code, local graph, local memory, Nebius smoke, report, chart, dashboard export, and compatibility-alias paths are usable. The public marketing line should not yet say fully frictionless for Cursor, Windsurf, Devin, Opsera, or managed Neo4j/Cognee backends.
