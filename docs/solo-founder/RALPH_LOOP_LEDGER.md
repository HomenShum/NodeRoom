# RALPH Loop Ledger

Solo Founder Agent Builder work is tracked as a durable local-first loop, not as loose notes.

```text
R - Reality / Research
A - Acceptance Bar
L - Live Build
P - Proof Run
H - Harden
```

The operating rule is:

```text
No receipt, no number.
No live UI proof, no product claim.
No held-out task contents in memory.
```

## Local State

`npm run sfn -- loop init --goal "..."` creates:

```text
.solo/
  loop-state.json
  events.jsonl
  memory.db
  receipts/
    R-reality/
    A-acceptance-bar/
    L-live-build/
    P-proof-run/
    H-harden/
  proof-verdict.json
  rework-ledger.md
```

`.solo/` is intentionally gitignored. Receipts that must become project evidence should be copied or generated into `docs/eval/`, `docs/rework/`, or another tracked proof location.

## Commands

```bash
npm run sfn -- loop init --goal "build agent for this app"
npm run sfn -- loop resume --loop-id <id>
npm run sfn -- loop start --from A --project .
npm run sfn -- loop verify --milestone P
npm run sfn -- loop status
```

## Start Anywhere

A milestone can start only when its entry receipts exist. For example, `L` requires:

```text
receipts/R-reality/capability-spec.json
receipts/R-reality/research-spine.json
receipts/A-acceptance-bar/benchmark-choice.json
receipts/A-acceptance-bar/rubric-policy.json
receipts/A-acceptance-bar/held-out-split.json
receipts/A-acceptance-bar/memory-quarantine.json
```

If these are missing, the CLI blocks and prints the backfill milestone instead of pretending progress was made.

## Proof Run Contract

`P` verification requires `.solo/proof-verdict.json` and the proof-run receipts. The verdict must pass these gates:

```text
fresh_room
official_upload
real_composer
deterministic_readiness
real_export
official_scorer
ledger_row
```

This keeps benchmark/product claims derived from receipts rather than screenshots, memory-mode demos, or implied success.

## Memory Quarantine

Allowed memory:

```text
capability spec
benchmark choice
held-out split hashes
aggregate scorecards
environment provenance
in-app transfer verdicts
rework decisions
```

Forbidden memory:

```text
held-out task contents
answer keys
golden outputs
evaluator-only prompts
raw held-out rows
```

The implementation lives in `src/solo/ralphLoopLedger.ts`; regression coverage lives in `tests/ralphLoopLedger.test.ts`.
