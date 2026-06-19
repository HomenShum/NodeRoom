# Public-Gold Multi-Agent Demo

This demo turns `/demo multi-agent public-gold ...` style prompts into a
deterministic public-source proof board. The current rendered walkthrough asset
is `multi-agent-workbench`; plain `/demo multi-agent` launches the startup
diligence prompt path.
It is still a memory-mode walkthrough of the UI contract, but the cases are no
longer vague synthetic tasks. Each row cites a public dataset or official source,
an expected answer, and the validators the production eval must run.

Status: yellow in the QA matrix. This is deterministic public-source proof-board
evidence, not live parser/provider proof, until public fixtures are downloaded
into a gitignored cache and re-extracted through LiteParse/provider adapters
against the same validators.

## Demo Shape

The walkthrough shows one burst prompt split into three child jobs:

1. TAT-DQA PDF arithmetic: extract two financial-report facts, write a formula,
   and match the exact answer and scale.
2. FinanceBench citation QA: answer a 3M 2018 10-K question and match the human
   gold answer plus evidence page.
3. SEC XBRL watchlist fill: populate Apple FY2023 public-company facts from SEC
   companyfacts and match digits, period, unit, and accession.

The fourth proof row overlays NodeRoom's product invariant: a human edit during
the run is preserved because stale writes are rejected or converted to review
chips instead of silently clobbering the cell.

## What Is Committed

- `docs/demo/public-gold-demo-manifest.json`: small source URLs, expected values,
  validators, and stable source-record fingerprints.
- UI proof board state in `src/ui/Chat.tsx`.
- Walkthrough capture spec in `scripts/walkthroughs/specs.ts`.

## What Is Not Committed

Large PDFs, benchmark binaries, private spreadsheets, and licensed workbooks are
not committed. A future live parser eval should download public fixtures into a
gitignored cache, verify hashes, and then run provider/LiteParse extraction
against the same manifest.

## Local Check

```bash
npm run demo:public-gold:check
```

This check validates manifest shape, exact expected values, required validators,
and the source fingerprints used by the deterministic proof board.
