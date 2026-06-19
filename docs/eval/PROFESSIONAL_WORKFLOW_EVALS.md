# Professional Workflow Evals

This document turns the reviewed local CSV/XLSX corpus into a practical NodeRoom
eval plan. It is intentionally redacted: the repo stores workflow shape,
headers-level signals, and fixture strategy, not private row values.

## Reviewed File Shape

Local profiler result from the user-provided manifest:

| Signal | Count |
|---|---:|
| Files reviewed | 70 |
| CSV files | 23 |
| XLSX files | 47 |
| GTM/company research | 46 |
| Finance/ops | 11 |
| Eval harness | 2 |
| Analytics/optimization | 3 |
| Legacy agent outputs | 3 |
| Mixed/uncategorized | 5 |
| Header-level PII signals | 47 |
| Files with sampled formulas | 16 |
| Files with merged cells | 18 |

The dominant work is company research: PitchBook uploads, ParselyFi outputs,
healthtech/JPM lists, sector classification, and company reports. The second
cluster is finance/ops: cost exports, timecards, timesheets, business income and
expense, and transaction-style exports. That is exactly the surface NodeRoom is
meant to support: spreadsheet-first professional workflows with evidence,
review, and safe mutation.

## What The Suite Proves

The professional suite extends the L1-L6 collaboration ladder from synthetic Q3
variance into real workflow shapes:

```text
chat note | file upload | selected artifact | mixed room state
  -> intent + entity extraction
  -> evidence plan: manual chat claim, artifact row, fetched source, computed value
  -> artifact creation or artifact refs
  -> evidence-bearing CellPayload/wiki writes
  -> lock/CAS/draft/no-clobber
  -> trace/eval result
```

For large or slow work:

```text
/free goal -> durable job -> workflow/workpool slice
  -> compact context -> checkpoint
  -> resume -> final artifact/wiki update
```

## Proof Tiers

The professional catalog is no longer a describe-only backlog. It has two
separate ledgers:

| Tier | What it proves | Command |
|---|---|---|
| Deterministic catalog proof | Every case has enough specified contract to be judged: intake surface, output surface, provenance, trajectory, privacy/long-running/private-gold rules, and named requirement evidence. | `npm run eval:professional:catalog-proofs` |
| Live-provider catalog proof | A real route can produce the structured workflow contract for every professional case. This proves route comprehension, not full tool execution. | `npm run eval:professional:live-catalog -- --real <route> --require-full` |
| Live-provider runtime smoke | A real route creates a room, reads fixture state, writes evidence-bearing outputs through `PRODUCTION_ROOM_TOOLS`, and proves managed lock coordination/no active lock leaks for every catalog case. This is runtime execution, but not a substitute for each domain's deeper gold tests. | `npm run eval:professional:live-runtime -- --strict` |
| Deterministic runtime proof | A local harness executes real NodeRoom logic and checks final artifact state plus trace behavior. | targeted vitest suites such as `tests/workflowEvals.test.ts` |
| Partial live-provider proof | A real model cleared a subset of a catalog case, while other modes remain blockers. | `npm run eval:finance-model` |
| Live-provider proof | A real route produced the required trace/output for the full promoted workflow. | route-specific live eval |

Current generated evidence:

```text
professional-catalog-proofs: 21/21 fully proofed, 0 failed
professional-live-catalog (deepseek/deepseek-v4-flash): 21/21, 0 failed
professional-live-catalog (ibm-granite/granite-4.1-8b): 19/21; failed validCaseId and reviewIfNeeded checks
professional-live-catalog smokes: z-ai/glm-4.7-flash 3/3; nex-agi/nex-n2-pro:free 1/1
chat-intake-live-managed (deepseek/deepseek-v4-flash): 16/16 runtime checks, 4 tool calls, runtime-managed write locks
professional-live-runtime (deepseek/deepseek-v4-flash): 21/21 runtime smoke cases passed through production-managed room tools
professional-proof-ledger: 5 live-provider, 16 partial live-provider, 0 live-provider catalog, 0 deterministic runtime, 0 contract-shape; runtime smoke = 21/21; lock modes = 21 runtime-managed, 0 explicit-agent-lock, 0 catalog-only
```

This is intentionally strict. A catalog-proofed case is no longer a vague idea.
The live-provider runtime smoke now proves every catalog case can execute through
the real room runtime and managed write tools, but cases with remaining blockers
still require deeper domain-specific runners before they become full product
claims. The live-provider catalog runner remains planner-only and does not
execute `write_locked_*` tools. Route-specific failures are kept as evidence: IBM
Granite is not promoted for the full professional catalog yet, and the slower
GLM/Nex sweeps require per-case aborts before they can be used as unattended
full-catalog runs.

## Eval Cases

The typed catalog lives in `evals/professionalWorkflows.ts`.

Intake is flexible by design. A user can start with a sentence in chat
("just spoke with X; their startup Y does Z"), an upload, a selected artifact,
or a room full of existing context. The eval must prove that NodeAgent preserves
provenance strength instead of flattening everything into one source: user-said
facts are manual evidence until a fetched or artifact source verifies them.

| Case | Workflow | Primary Assertions |
|---|---|---|
| `gtm-pitchbook-company-match-enrich` | Match uploaded companies against PitchBook-style results | preserve CRM fields, cite source rows, flag ambiguous matches |
| `gtm-healthtech-sector-classification` | Classify healthtech/JPM/PitchBook company sectors | CellPayload evidence, needs_review for weak evidence, bulk `/free` checkpointing |
| `gtm-intent-classifier-golden` | Score query/company classification fixtures | allowed labels, macro-F1, cited reasons, ambiguity review |
| `gtm-amo-signal-scorer` | Apply AMO scoring rubric to company rows | allowed tier bands, evidence for non-unknown tiers, aggregate score consistency |
| `gtm-jpm-market-map-joins` | Join company/product/partnership workbook tabs | no entity conflation, cited joins, unknowns for missing fields |
| `gtm-sbb-one-column-extraction` | Segment one-column extracted content into entities | boundary accuracy, line-span evidence, malformed block review |
| `gtm-company-deep-report` | Produce a company brief from multi-sheet reports | clickable citations, conflict callouts, no private context leak |
| `gtm-chat-lead-capture-enrich` | Convert a chat-only call/funding note into a watchlist row and grounded wiki note | chat entity extraction, manual-vs-fetched evidence, duplicate-row prevention |
| `gtm-chat-to-background-diligence-job` | Start a checkpointed company research job from a chat-only mention | idempotency, artifact creation, source fusion, resume without duplicate writes |
| `gtm-pii-masking-and-public-private-boundary` | Summarize contact/event files safely | mask public PII, preserve private boundary, audit redaction |
| `finance-cost-reconciliation` | Reconcile model/vendor spend and output variances | skip correct cells, CAS-correct wrong cells, cite source rows |
| `finance-three-statement-modeling-private-gold` | Complete or coach a private 3-statement modeling-test workbook | answer-key formula oracle, solve/guide/collaborate modes, balance-sheet tie-outs |
| `finance-accountant-template-population` | Fill a fixed income/expense form from source transactions | preserve layout, cite mapped categories, flag unmapped categories |
| `finance-timesheet-invoice-review` | Review timecards/timesheets with formulas and merged layout | preserve formulas, detect exceptions, cite row evidence |
| `finance-transaction-activity-summary` | Summarize account/brokerage transaction exports | aggregate without line-item leakage, preserve signs/blanks |
| `eval-template-to-harness-run` | Convert NodeBench-style templates into harness cases | each case has state, task, tools, expected state, trace, budget |
| `eval-ui-action-execution-map` | Convert UI action mapping into browser/runtime checks | action, execution layer, artifact state, and trace checkpoints |
| `analytics-weighted-ranking` | Rank options with adjustable weights | update only dependent score/rank cells, cite weight set |
| `analytics-workout-progress-dashboard` | Join workout logs to exercise metadata | preserve unit semantics, avoid raw-log disclosure |
| `legacy-output-migration` | Migrate old generated outputs into room wiki | idempotent wiki sections, clickable source refs, public PII masking |

## Harness Engineering Lessons

- **Header detection is not enough.** Several workbooks have banners, merged
  cells, search-link rows, or multi-sheet layouts. The parser must identify the
  real data region and preserve coordinates.
- **Professional output must be evidence-bearing.** ENRICH, CLASSIFY, RESOLVE,
  RECONCILE, and REPORT writes should produce `CellPayload` values with source
  artifact id, row/column/page evidence, confidence, and status.
- **Chat is evidence, not a file substitute.** Chat-only intake should be parsed
  into entities and claims, but those claims stay `manual` evidence until an
  uploaded artifact or fetched source verifies them. Ambiguous entity identity
  should ask a clarifying question or mark `needs_review`.
- **Raw files stay canonical.** Convex/NodeRoom artifact ids are the durable
  system of record. Provider file ids are cache metadata only.
- **PII is common.** Public summaries must avoid emails, phones, addresses,
  contact names, account identifiers, messages, and transaction details unless
  the actor and channel are authorized.
- **Formulas and merged cells need conservative mutation.** Formula cells should
  not be overwritten with scalar text by default; dependency-expanded locks
  should protect derived cells when parent inputs change.
- **Answer-key workbooks are private gold packs.** A modeling-test workbook with
  its own answer sheet is deterministic gold, but the workbook and answer key
  stay outside the public repo unless the rights holder grants permission. The
  repo stores only the contract and runs a local validator when the path is
  provided.
- **Large sheets are context-engineering tests.** The 9,000+ row classification
  shape should run through chunking, semantic search, compaction, checkpoints,
  and resolved-model audit, not one giant prompt.
- **Interview-ready evals need outcome and trajectory checks.** A case passes
  only when the final artifact is correct and the trace proves safe reads,
  locks/CAS/drafts, evidence, privacy, and budget behavior.

## Production Support Map

| Requirement | Current NodeRoom Support | Next Deep Review |
|---|---|---|
| CSV/XLSX upload and view | Browser parser and artifact rendering; CSV stays dataframe-shaped, XLSX renders as a coordinate grid with true Excel addresses like `F7` | Convex File Storage as canonical raw-file backend for every upload |
| Spreadsheet semantic context | Cell/chunk/dependency index | Add fixture coverage for large sparse and multi-sheet workbooks |
| Evidence-bearing writes | `CellPayload`, provider parser adapter, research workflow tests | Require all production ENRICH/CLASSIFY/RESOLVE writes to use the same payload contract |
| Cross-file work | Multi-artifact tools and artifact refs | Add real redacted multi-file fixtures from PitchBook/ParselyFi shapes |
| Long-running free models | `/free` workflow/workpool slices, checkpoints, resolved model audit | Add bulk classification smoke with tiny slice budget and duplicate-slice test |
| Parser/OCR/layout | Provider-first parser adapter plus LiteParse fallback smoke | Add PDF/DOCX/PPTX/image OCR fixtures when those files are available |
| Wiki | Grounded update tool and self-updating wiki skill rules | Add agent-generated wiki run from professional fixtures |
| Privacy | Public/private room boundary and PII-aware eval cases | Add redaction tests for fake contact/event/transaction fixtures |
| Private finance gold packs | `eval:finance-model-private` validates local workbook shape and answer-key formulas; `eval:finance-model` runs the NodeAgent lock/read/CAS/release solve workflow; `evals/financeModelLive.ts --level=full` has a live 16-cell pass on `deepseek/deepseek-v4-flash` | Add Guide and Collaborate mode runtime evals, then export/import completed model workbooks |

## Private Finance Modeling Gold Pack

The Ben Chon / RareLiquid-style 3-statement modeling workbook is the first
private finance-modeling gold pack. It should not be committed to the public
repo. The eval uses only a local workbook path and a content hash.

The workflow has three modes:

| Mode | Contract |
|---|---|
| Solve | NodeAgent fills the forecast model with formulas, and the grader compares formulas and outputs against the answer key. |
| Guide | NodeAgent coaches the user through a mistake and writes no forecast answer cells. |
| Collaborate | NodeAgent and teammates split sections; locks, drafts, CAS, and final tie-outs are graded. |

Run the local private-pack readiness check:

```bash
npm run eval:finance-model-private -- --gold "C:\path\to\modeling-test.xlsx"
```

Run the NodeAgent solve workflow against the committed synthetic gold pack:

```bash
npm run eval:finance-model
```

Run the same NodeAgent solve workflow against the local private workbook:

```bash
npm run eval:finance-model -- --gold "C:\path\to\modeling-test.xlsx"
```

The committed trace and README GIF use the synthetic gold pack. The private
live run writes full traces under gitignored `docs/eval/finance-model-runs/`;
the committed `docs/eval/finance-model-live.json` summary contains only
redacted booleans, labels, route, cost, and timing.

Current live promotion: `deepseek/deepseek-v4-flash` clears the full 16-cell
Solve lane across the committed N=5 aggregate: 5/5 passed, median 105007ms,
p95 cost `$0.106829`, total cost `$0.442385`. `nex-agi/nex-n2-pro:free`
clears the income rung but is not promoted for full solve until it clears
without provider failure.

Or set:

```bash
set NODEAGENT_FINANCE_MODEL_GOLD_XLSX=C:\path\to\modeling-test.xlsx
npm run eval:finance-model-private
```

## Interview Notes

Use this language:

> I took real spreadsheet workflow evidence and converted it into a harness
> backlog. The important move is not committing private data. It is extracting
> the workflow shape: schema detection, source references, evidence-bearing
> writes, no-clobber mutation, privacy boundaries, long-running handoff, and
> eval assertions.

The strongest examples to discuss:

- GTM sales: PitchBook company matching and healthtech sector classification.
- Finance: cost reconciliation and timesheet/invoice review.
- Harness engineering: converting NodeBench eval templates into typed,
  trace-checked cases.
- Context engineering: making a 9,000+ row sheet work through semantic chunks,
  context compaction, and workflow checkpoints.

## Verification

Run the professional catalog checks:

```bash
npm test -- tests/professionalWorkflows.test.ts
npm run eval:professional:catalog-proofs
npm run eval:professional:live-runtime -- --strict
npm run eval:professional:proofs
```

Run the broader baseline:

```bash
npm run typecheck -- --pretty false
npm test
npm run ladder
```
