# @noderl/nodemem

Deterministic **replay / context memory**: rule-based episode compilation + multi-factor ranked
retrieval. Pure functions — no database lock-in.

## Status

Core ~70% extracted. The compile + rank logic is pure and portable; the storage layer is left to
the adopter. Failure-pattern persistence and outcome tagging are the net-new work.

## Extraction manifest (from the NodeRoom repo)

| Source file | Role |
|---|---|
| `src/nodemem/core/memoryCompiler.ts` | `compileEpisode(episode, now)` — pure entity/fact extraction |
| `src/nodemem/core/retrievalPlanner.ts` | `planRetrieval(req)` + `rankFacts(facts, plan, now)` — pure |
| `src/nodemem/core/classifier.ts` | deterministic signal/entity detection |
| `src/nodemem/core/types.ts` | `NodeMemEpisode/Entity/Fact`, `TaskKind`, `FactStatus`, **`NodeMemFailurePattern`** |

**Leave behind:** `convex/nodemem.ts`, `convex/nodememCompile.ts` (mutations, room indexes, the
global `process.env.NODEMEM_MODE` read).

## Ranking model

Facts rank by **status order** (`source_backed` < `manual` < `graph_inferred` < `needs_review` <
`superseded`), then by confidence; age > 30d downgrades risk. Retrieval lanes: exact / bm25 /
semantic / graph / recent / visibility-filter, selected by task kind.

## Net-new (for RL replay)

- **Persist `NodeMemFailurePattern`** — the type exists (symptom / rootCause / regressionTest /
  fixSummary / affectedSystems / receiptRefs) but is never stored. This is the failure-memory
  that turns a repeated mistake into a one-time mistake.
- **Outcome tagging** on episodes (success / failure) so memory can serve contrastive examples.

## Honesty note (Debt 3)

No recall-lift number is published yet. The 4-variant A/B in the source repo ran only the "bare"
variant and has a known global-env-var isolation bug. NodeMem ships as "memory model + retrieval,
benchmark re-running with per-variant isolation" until that is fixed.

## Privacy

Episode `rawText` and context-pack JSON can carry PII — ship **synthetic seeds only**; adopters
redact before persisting real runs (`../../SECURITY.md`).
