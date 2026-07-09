# Proof Loop Dogfood Friction Log

## Confirmed Working

- Fresh `npx proofloop` fixture reached a passing local gate through `npm test` fallback.
- `proofloop init` creates the canonical `official-scores` goal; legacy `--goal default` gate/resume commands resolve to it.
- Codex and Claude Code adapter setup wrote ready receipts and local hook config.
- Cursor, Windsurf, and Devin correctly reported `needs_adapter`.
- Generic CLI correctly reported `needs_command`.
- Provider setup receipts did not leak secrets.
- Opsera provider setup returns a structured `needs_adapter` receipt instead of an unknown-provider error.
- Nebius live smoke passed using the existing Convex-stored credential.
- Local code graph `index/search`, `graph ingest --backend neo4j`, and `graph query --failure latest` are wired.
- Local memory `init/compact/search/doctor`, `memory remember-run`, `memory recall`, and `search --hybrid` are wired.
- `memory seed-dogfood` seeds UI/fake-success and official-score-boundary recall examples.
- `report latest`, `charts latest`, `brief latest`, and `dashboard export latest` produce proof artifacts.
- `docs/dogfood/official-score-boundary.md` documents product proof versus official benchmark proof.

## Friction / Gaps

- Cursor, Windsurf, Devin, and Opsera remain honest `needs_adapter` lanes until real session/API adapters exist.
- Neo4j and Cognee managed backends are compatibility aliases/local exports, not live managed backend writes.
- Live dashboard proof is a deterministic JSON/HTML export, not a captured browser screenshot.
- Fresh fixture needed automation to run `npx --yes proofloop`; docs should mention first-run `npx` install prompt behavior.

## Launch Fixes

- Keep `official-scores` as the canonical launch goal and leave `default` only as a backward-compatible alias.
- Build real Cursor/Windsurf/Devin adapters before marketing those as one-command enforcement.
- Build real Opsera, Neo4j managed ingest, and Cognee managed memory integrations before claiming live backend writes.
- Add optional browser screenshot capture later if visual dashboard proof is required beyond the deterministic HTML export.
