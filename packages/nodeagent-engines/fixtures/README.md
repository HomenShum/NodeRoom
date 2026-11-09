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
skill created through the Node skill lifecycle), `inbox-update` (add the two inbox companies) and
`deep-diligence` (from a fresh project: the full pack for all ten companies plus a cited credit memo
per company in `analysis/memos/`, `analysis/risk-matrix.md`, a burn +/-20% stress test in
`analysis/sensitivity.json` and the notebook, an `html` export format with the agent's own tests, and
a second skill, `memo-lint`; written to need parallel helpers and a goal plan over a long run).

The documents are static files. Ground truth exists only in `verifiers/diligence-pack.verify.mjs`;
complete reference solutions used solely by `test/verifier.test.ts` live in
`test/golden/diligence-pack/` (inbox stage) and `test/golden/diligence-pack-deep/` (deep stage) and
are never copied into a workspace.

## Running the verifier

```
node fixtures/verifiers/diligence-pack.verify.mjs <workspaceDir> [--json] [--stage full|inbox|deep] [--node-state <dir>]
```

- `--stage` defaults to `deep` when any deep deliverable exists (`analysis/memos/`,
  `analysis/risk-matrix.md`, `analysis/sensitivity.json` or `.claude/skills/memo-lint/`), else to
  `inbox` when the table has more than 8 rows or an inbox company, else `full`. The worker runs the
  verifier without `--stage`, so a deep-diligence run that produced none of the deep deliverables is
  graded as `inbox`; check that the report lists the deep check ids.
- `--node-state` defaults to `<workspaceDir>/../node-state` (the worker's project layout). When the
  skill ledger is found, the verifier also proves the active citation-validation skill is byte-identical
  to what Node activated; when it is not found, that check is skipped and the report says so.
- `--json` prints a `VerificationReport` (`src/api.ts`). Exit code 0 only when every check passes.
- It never writes into the workspace. It runs `node --test` in `report/`, the agent's skill scripts
  (under Node's permission model, read-only) and, in the deep stage, imports `report/src/export.mjs`
  in a child process (read access to `report/` only); provider credentials are removed from every
  child's environment.

Checks: `comparison.json`, `comparison.companies`, `metrics.values`, `metrics.restated-arr`,
`runway.formula`, `risks.exceptions`, `sources.no-restricted`, `sources.no-superseded`,
`citations.resolve`, `comparison-md.table`, `comparison-md.exceptions`, `report.tests-intact`,
`report.tests-pass`, `notebook.valid`, `skill.active`, `skill.ledger` (when a ledger exists),
`skill.accepts-table`, `skill.rejects-corrupted`.

The deep stage checks all ten companies with the checks above, then: `memos.present`,
`memos.sections`, `memos.citations` (at least 6 per memo; the figure written right before each
citation must be on the cited line; every memo states its ARR, burn and cash that way),
`memos.no-restricted`, `memos.restatement` (restated and reported ARR, both cited),
`memos.concentration`, `risk-matrix.table`, `risk-matrix.citations`, `risk-matrix.ratings`
(evidence-forced ratings only: concentration above the guideline, runway below 9 months, the
restatement and the superseded statement, and liquidity not `high` where runway stays at or above
12 months at +20% burn), `sensitivity.json`, `sensitivity.values`, `sensitivity.citations`,
`notebook.sensitivity` (the markdown names every company whose runway clearly crosses a threshold
at +20% burn; a base runway exactly on a threshold is not forced), `report.html-escape` (an independent probe with `<script>`, `&`, `"` and `'` in the data;
the template's column labels and Sources in `<th>`), `report.html-tests` (the agent's own html tests
pass), `memo-lint.active`, `memo-lint.ledger` (when a ledger exists), `memo-lint.accepts-memos` and
`memo-lint.rejects-corrupted` (altered figures, a removed Risks section and an added restricted
citation must each be rejected while a valid copy outside the workspace, the memo plus one plain
line, passes).

Deep-stage evidence rule (memos, risk matrix, sensitivity.json): a citation must name a document
under `sources/` after resolving `..`, not the superseded statement, and span at most 3 lines. Citing
the agent's own files (a memo citing itself, `analysis/comparison.md`) or a whole-file range fails.
