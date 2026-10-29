# Fixtures: project templates and independent verifiers

**Everything in these fixtures is fictional and synthetic.** The companies, people, investors,
competitors, figures, market statistics and the regulatory scenario were invented for this exercise.
They describe no real company or person and contain no private data. Any resemblance to a real
entity is coincidental.

## Layout

```
fixtures/
  <template-id>/template.json   TemplateConfig (see src/contract.ts); never copied into a workspace
  <template-id>/**              starter files copied into each new project's workspace
  verifiers/<id>.verify.mjs     independent verifier; lives outside every workspace
```

## Templates

| id | What it is | Checks | Verifier |
|---|---|---|---|
| `blank` | empty workspace for quick experiments | none | none |
| `diligence-pack` | SMB-lending diligence for a Q3 2026 credit committee | `report` (`node --test` in `report/`) | `verifiers/diligence-pack.verify.mjs` |

### diligence-pack

A synthetic data room (41 documents, 40-150 lines each, one metric per line so line citations work):

- `sources/companies/` 8 profiles, `sources/financials/` 9 statements (one company has a preliminary
  v1 explicitly superseded by v2), `sources/diligence-calls/` 8 call notes (one restates ARR after
  removing one-time pilot revenue; another flags customer concentration above 40% of ARR),
  `sources/market/` 8 market, competitor, regulatory and committee notes, `sources/restricted/` 2
  documents blocked by `restrictedGlobs`, `sources/inbox/` 2 later companies (3 documents each).
- `report/`: a dependency-free Node project whose tests fail until `report/src/export.mjs` is
  implemented and `analysis/comparison.json` exists with cited rows.
- `.claude/skills/`: source-pack-review, diligence-notebook, report-export.
- `CLAUDE.md` and `AGENTS.md`: identical house rules for Claude Code and Codex.

Suggested tasks: `full-diligence` (the eight companies, notebook, export and a citation-validation
skill created through the Node skill lifecycle) and `inbox-update` (add the two inbox companies).

The documents are static files. Ground truth exists only in `verifiers/diligence-pack.verify.mjs`;
a complete reference solution used solely by `test/verifier.test.ts` lives in
`test/golden/diligence-pack/` and is never copied into a workspace.

## Running the verifier

```
node fixtures/verifiers/diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox] [--node-state <dir>]
```

- `--stage` defaults to `inbox` when the table has more than 8 rows or an inbox company, else `full`.
- `--node-state` defaults to `<workspaceDir>/../node-state` (the worker's project layout). When the
  skill ledger is found, the verifier also proves the active citation-validation skill is byte-identical
  to what Node activated; when it is not found, that check is skipped and the report says so.
- `--json` prints a `VerificationReport` (`src/api.ts`). Exit code 0 only when every check passes.
- It never writes into the workspace. It runs `node --test` in `report/` and the agent's skill script
  (under Node's permission model, read-only) with provider credentials removed from the environment.

Checks: `comparison.json`, `comparison.companies`, `metrics.values`, `metrics.restated-arr`,
`runway.formula`, `risks.exceptions`, `sources.no-restricted`, `sources.no-superseded`,
`citations.resolve`, `comparison-md.table`, `comparison-md.exceptions`, `report.tests-intact`,
`report.tests-pass`, `notebook.valid`, `skill.active`, `skill.ledger` (when a ledger exists),
`skill.accepts-table`, `skill.rejects-corrupted`.
