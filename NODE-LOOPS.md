# NODE-LOOPS.md — NodeRoom

> This repo's self-improving-loop manifest. Companion to CLAUDE.md. Spec: https://github.com/HomenShum/noderl/blob/main/spec/node-loops.md

`CLAUDE.md` / [`AGENTS.md`](AGENTS.md) describe **how the agent behaves** (the
harness map, the write rules, the smoke commands). This file describes **the
loop**: the goal it is climbing, the inner act/observe/judge cycle of a single
`@nodeagent` run, and the outer self-heal cycle where failure-memory and the
proof gates decide what gets promoted and what gets edited next.

NodeRoom is the high-context grounding repo for that loop: it carries a real
**memory** layer (NodeMem), a derived **codebase/knowledge graph**, an **OKF/RAG**
knowledge layer, and **eval/proof gates** — so every claim in this manifest links
to a substrate file that actually exists, not a template.

---

## 1. Goal & milestones

**Goal.** A server-side, durable, self-improving agent for multi-user rooms where
a human and a NodeAgent edit shared spreadsheet / notebook / post-it surfaces
**without silently clobbering each other**, and where every change is replayable
(permission check → version CAS → receipt → hash-chained trace) so the harness
can improve itself from real traces without a team. (Thesis verbatim in
[`docs/WHY_NODEAGENT_AND_HALO.md`](docs/WHY_NODEAGENT_AND_HALO.md) §0.)

**Milestone ladder (real, from the proof registry & eval ledgers):**

| ID | Lane | Claim (honest) | Source |
|----|------|----------------|--------|
| FR-010 | `spreadsheetbench` live room | One SpreadsheetBench task, export + graded sheet | [`docs/eval/fresh-room/FR-010/latest.json`](docs/eval/fresh-room/FR-010/latest.json) |
| FR-020 / FR-020A | `bankertoolbench_selective_live_task` | **One** BTB task through the full live-room path (upload → public @nodeagent → export → reopen → scorer → visual judge) | [`docs/eval/fresh-room/FR-020/latest.json`](docs/eval/fresh-room/FR-020/latest.json) |
| FR-020B | `bankertoolbench_full_suite` (isolated/Harbor, generic-only) | Full-suite **completion + official scoring** — 100/100 clean tasks, mean reward **0.2519**, pass-rate **0.0000** at reward ≥ 1 | [`fullsuite-gate-receipt.json`](docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json) |
| FR-020C | `bankertoolbench_full_suite` (live product UI) | All 100/100 tasks **completed through the product UI** with passing per-task fresh-room receipts | [`livesuite-gate-receipt.json`](docs/eval/fresh-room/FR-020/livesuite-gate-receipt.json) |

**Hard policy on the ladder** (from the registry's own `policy` block): FR-020B
(scoring) and FR-020C (completion) are **separate claims and may not be collapsed
into "100% pass".** A domain runtime pass does not imply live-browser completion;
a selective task proof does not imply a full-suite score. See §7 for receipts.

---

## 2. Inner loop — the `@nodeagent` run (act → observe → judge)

A single run is the base model/tool loop in
[`src/nodeagent/core/runtime.ts`](src/nodeagent/core/runtime.ts), wrapped by the
frame runner [`src/nodeagent/core/frameRunner.ts`](src/nodeagent/core/frameRunner.ts).

- **State** = the room and its artifacts: per-element-versioned cells / notebook
  blocks / post-its, advisory `presenceClaims` + intent claims, and the open
  file tabs. Durable state lives in **frames / cache / job rows + the trace
  spine — never in the prompt transcript** ([`AGENTS.md`](AGENTS.md) rules).
- **Action** = tool calls behind `RoomTools` (the agent never mutates engine /
  backend state directly). Writes are checked: they commit cleanly under CAS or
  become reviewable conflict proposals. Every durable mutation points back to a
  `traceId` ([`src/nodeagent/traces/`](src/nodeagent/traces/)).
- **Observation** = tool results, exported deliverables, screenshots, videos, and
  the hash-chained trace workpaper — all replayable.

**The JUDGE is a separate verifier**, never the actor that produced the work.
Per fresh-room task it runs four independent gates
([`docs/eval/fresh-room/proof-registry.json`](docs/eval/fresh-room/proof-registry.json)):

1. **Official scorer** — benchmark-faithful verifier handoff (`official_verifier`
   gate; BTB official contract in
   [`scripts/bankertoolbench-official-contract.ts`](scripts/bankertoolbench-official-contract.ts)).
2. **Evidence / citation verifier** — export-and-reopen of the deliverable
   (`export_reopen`) + package manifest; source-backed vs needs-review evidence is
   partitioned in [`src/nodemem/core/evidenceMemory.ts`](src/nodemem/core/evidenceMemory.ts).
3. **Visual judge** — Gemini media judge over the rendered screenshots/video
   (`visual_judge`; outputs under [`docs/eval/gemini-media-judges/`](docs/eval/gemini-media-judges/)).
4. **Fresh-room UI gate** — proves the run happened in a genuinely fresh live
   browser room on the public NodeAgent lane (`fresh_room_ui`).

Frame status + evidence receipts are produced by
[`src/nodeagent/core/frameVerifier.ts`](src/nodeagent/core/frameVerifier.ts).

---

## 3. Outer loop — failure-memory + proof gates decide promotion

The outer loop is HALO: **traces → feedback/evals → gate → coding-agent handoff →
next harness change** (the OpenAI cookbook loop, adapted —
[`docs/eval/agent-improvement-loop.md`](docs/eval/agent-improvement-loop.md), metrics
in [`src/eval/haloSelfImprovement.ts`](src/eval/haloSelfImprovement.ts)).

- **Failure-memory** turns each per-task proof failure into a
  `NodeMemFailurePattern` so a re-run targets **only** the unresolved failures and
  conditions the agent off known-bad paths — explicitly "the *memory → repair*
  half of the NodeRL loop"
  ([`src/nodemem/failureMemory.ts`](src/nodemem/failureMemory.ts);
  `classifyRootCause` maps scorer errors to stable categories like
  `room_not_fresh`, `deliverable_export_or_reopen`, `answer_key_contamination`).
  Per-milestone failure state: [`docs/eval/fresh-room/FR-020/failure-memory.json`](docs/eval/fresh-room/FR-020/failure-memory.json).
- **Proof gates decide promotion.** A milestone only "flips" when its gate
  receipt says `flipEligible: true`. The full-suite gate
  ([`scripts/bankertoolbench-fullsuite-gate.ts`](scripts/bankertoolbench-fullsuite-gate.ts) /
  [`src/eval/bankerToolBenchFullSuiteGate.ts`](src/eval/bankerToolBenchFullSuiteGate.ts))
  and the live-suite gate
  ([`scripts/bankertoolbench-livesuite-gate.ts`](scripts/bankertoolbench-livesuite-gate.ts) /
  [`src/eval/bankerToolBenchLiveSuiteGate.ts`](src/eval/bankerToolBenchLiveSuiteGate.ts))
  emit the receipts that the registry reads.
- **What gets edited.** Improvements are NOT prompt tweaks at runtime; they are
  harness changes handed to a coding agent (Codex / Claude Code) against the maps
  in [`AGENTS.md`](AGENTS.md). The regression diff
  ([`evals/evalDiff.ts`](evals/evalDiff.ts), `npm run eval:diff`) is the
  did-I-regress-a-workflow gate before any such change lands.

---

## 4. Context anchors — the four real substrates

> The point of grounding this manifest in NodeRoom: these files exist (verified
> against `HEAD`). The loop reads/writes them, not abstractions.

### Memory substrate — NodeMem (provenance-first memory control plane)
- [`src/nodemem/index.ts`](src/nodemem/index.ts) — barrel: passive detection +
  full memory system (episodes, entities, facts, ContextPacks).
- [`src/nodemem/core/episodeLog.ts`](src/nodemem/core/episodeLog.ts) — episode
  capture + content-hash dedupe (`createEpisode`, `episodeContentHash`).
- [`src/nodemem/core/memoryCompiler.ts`](src/nodemem/core/memoryCompiler.ts) —
  `compileEpisode` / `mergeEntities` (episode → compiled memories).
- [`src/nodemem/core/retrievalPlanner.ts`](src/nodemem/core/retrievalPlanner.ts) —
  `planRetrieval` / `rankFacts` (ranked, task-classified retrieval).
- [`src/nodemem/core/evidenceMemory.ts`](src/nodemem/core/evidenceMemory.ts) +
  [`freshness.ts`](src/nodemem/core/freshness.ts) +
  [`invalidation.ts`](src/nodemem/core/invalidation.ts) — source-backed gating,
  staleness, supersede/expire.
- [`src/nodemem/failureMemory.ts`](src/nodemem/failureMemory.ts) — failure-pattern
  records driving the outer-loop repair.
- Convex persistence: [`convex/nodemem.ts`](convex/nodemem.ts),
  [`convex/nodememCompile.ts`](convex/nodememCompile.ts),
  [`convex/memory.ts`](convex/memory.ts).

### Codebase / knowledge graph
- [`src/ui/panels/KnowledgeGraph.tsx`](src/ui/panels/KnowledgeGraph.tsx) —
  freely-traversable NotebookLM/Obsidian-style node-link view. **Derived, not
  stored** (reads `useStore()`, zero new Convex tables): artifact nodes, entity
  nodes (companies = research-sheet rows, people = owner/founder/CEO cells,
  **deduped** so a shared entity links artifacts multi-hop), edges =
  artifact↔artifact "mentions" + sheet→company + company→person.
- [`src/nodeagent/okf/graph.ts`](src/nodeagent/okf/graph.ts) +
  [`src/nodeagent/retrieval/indexes/graphIndex.ts`](src/nodeagent/retrieval/indexes/graphIndex.ts) +
  [`src/nodeagent/retrieval/okf/okfGraph.ts`](src/nodeagent/retrieval/okf/okfGraph.ts)
  — the agent-side OKF concept graph + retrieval graph index.

### OKF / knowledge layer (artifact metadata → RAG embedding)
- [`src/engine/artifactMeta.ts`](src/engine/artifactMeta.ts) —
  `deriveArtifactMeta`: derives a file's topic/summary/tags **from its content**
  at create/upload time, and that output is exactly the concept frontmatter
  (title/description/tags) that feeds the OKF/RAG embedding.
- [`src/nodeagent/okf/frontmatter.ts`](src/nodeagent/okf/frontmatter.ts),
  [`concept.ts`](src/nodeagent/okf/concept.ts),
  [`producers/cellProducer.ts`](src/nodeagent/okf/producers/cellProducer.ts) /
  [`roomProducer.ts`](src/nodeagent/okf/producers/roomProducer.ts) /
  [`sourceProducer.ts`](src/nodeagent/okf/producers/sourceProducer.ts) — OKF
  bundle producers; `set_artifact_meta` is the live-agent refine path.
- Retrieval: [`src/nodeagent/retrieval/okf/okfSemanticSearch.ts`](src/nodeagent/retrieval/okf/okfSemanticSearch.ts),
  [`okfFullTextSearch.ts`](src/nodeagent/retrieval/okf/okfFullTextSearch.ts),
  [`okfConceptStore.ts`](src/nodeagent/retrieval/okf/okfConceptStore.ts).
- Convex side: [`convex/okf.ts`](convex/okf.ts),
  [`convex/okfIndexer.ts`](convex/okfIndexer.ts),
  [`convex/okfEmbeddingProvider.ts`](convex/okfEmbeddingProvider.ts).

### Eval / proof gates
- **Registry (source of truth):** [`docs/eval/fresh-room/proof-registry.json`](docs/eval/fresh-room/proof-registry.json)
  — generated by [`scripts/fresh-room-proof-registry.ts`](scripts/fresh-room-proof-registry.ts),
  verified by [`scripts/fresh-room-proof-verify.ts`](scripts/fresh-room-proof-verify.ts)
  (`npm run fresh-room:proofs`).
- **BTB gates:** [`scripts/bankertoolbench-fullsuite-gate.ts`](scripts/bankertoolbench-fullsuite-gate.ts),
  [`scripts/bankertoolbench-livesuite-gate.ts`](scripts/bankertoolbench-livesuite-gate.ts),
  [`scripts/bankertoolbench-official-contract.ts`](scripts/bankertoolbench-official-contract.ts).
- **Eval modules:** [`src/eval/`](src/eval/) (BTB adapter, full/live suite gates,
  `benchmarkContamination.ts`, `freshRoomProofReceipts.ts`, `haloSelfImprovement.ts`)
  and [`evals/`](evals/) (`evalDiff.ts`, `runEval.ts`, `ladder.ts`, professional-workflow proofs).
- **Anti-cheat doctrine:** [`docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md`](docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md).
- **Portable extraction** (same loop, no Convex): [`packages/nodemem/`](packages/nodemem/),
  [`packages/nodeeval/`](packages/nodeeval/), [`packages/nodetrace/`](packages/nodetrace/),
  and the NodeRL spec dir [`noderl/spec/`](noderl/spec/) (`anti-cheat-doctrine.md`,
  `proof-receipt-contract.md`, `reward-design.md`, `trajectory-schema.md`).

---

## 5. Verification protocol

- **Separate verifier.** The judge is never the actor (§2). The scorer, the
  evidence/citation verifier, and the visual judge run independently of the run
  that produced the artifact.
- **No proof, no claim.** A claim must name the **exact lane, scorer, UI-proof
  status, export/reopen status, and verifier-handoff status** — collapsing a
  selective task into a full-suite score is forbidden by the registry policy.
  A claim is only "shipped" when its gate receipt says `flipEligible: true` and a
  re-run of `npm run fresh-room:proofs` passes; freshness is re-checked by
  [`scripts/proof-staleness-check.ts`](scripts/proof-staleness-check.ts).
- **Live-DOM verification.** Live claims go through the live product gate
  ([`scripts/live-product-gate.ts`](scripts/live-product-gate.ts),
  `npm run test:product:live`) — build-green / push-OK is not "shipped".
- **Runtime reliability checklist** (applied on every backend / tool-endpoint
  change; grep the repo for the receipts):
  - **BOUND** — every in-memory collection has a MAX + eviction (e.g.
    `MAX_NODES = 140` in [`KnowledgeGraph.tsx`](src/ui/panels/KnowledgeGraph.tsx);
    room noteworthy quota in [`dedup.ts`](src/nodemem/core/dedup.ts)).
  - **HONEST_STATUS / HONEST_SCORES** — no 2xx on failure paths; no hardcoded
    score floors (the full-suite gate reports `passRate: 0` honestly, §7).
  - **TIMEOUT / SSRF / BOUND_READ** — budget gates, URL validation, response
    size caps before fetching external bodies.
  - **ERROR_BOUNDARY / DETERMINISTIC** — async error handling on routes;
    sorted-key / content-hash CAS (`episodeContentHash`, `activityDedupeKey`).
- **Convex boundary review** ([`src/eval/convexBoundaryPolicy.ts`](src/eval/convexBoundaryPolicy.ts)):
  internal vs public exposure, auth gates, no unbounded reads, action/mutation discipline.

The full pre-ship floor is `npm run prod:gate` (security gate → qa matrix →
content fluency → proof staleness → fresh-room proofs → SLO gate → typecheck →
tests → build).

- **PROVE-BEFORE-CLAIM** (agent-side gate) — never assert done/pass/fixed/blocked/absent/"root cause" from a *proxy* (an affordance, a keyword/template echo, a rendered shell, or a prior-based hypothesis); name the artifact that proves it and check THAT, independent-confirm anything that "looks done", and treat no gate as real until the autonomous path is tried. Canonical gate + observed failure signals: https://github.com/HomenShum/noderl/blob/main/spec/prove-before-claim.md

---

## 6. Reward & safety

- **Reward design** is benchmark-faithful and anti-gamed: the official scorer's
  mean reward is reported raw (FR-020B = **0.2519**, pass-rate **0.0000** at
  reward ≥ 1) rather than floored. Generic-only execution means **no answer-key
  writers** in the suite ([`src/eval/benchmarkContamination.ts`](src/eval/benchmarkContamination.ts);
  doctrine in [`docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md`](docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md)).
  See [`noderl/spec/reward-design.md`](noderl/spec/reward-design.md).
- **Budget.** Per-run model/tool budget gates and an SLO gate
  ([`scripts/slo-gate.ts`](scripts/slo-gate.ts)); architecture/cost budget in
  [`src/eval/architectureBudget.ts`](src/eval/architectureBudget.ts).
- **Human-agent boundary.** The client submits *intent + preferences*; the
  **server** derives model policy, approval policy, evidence policy, allowlists,
  rate limits, and auto-allow — never the client (README "Collaboration
  Architecture Evolution"). An Agent Work Plan is approved by exact `planHash`
  before any job is queued.
- **No-clobber.** Committed edits carry per-element CAS versions; presence/intent
  is advisory (not a disabled overlay); agents draft/branch from the last
  committed tick; publish is an advisory short exact-target commit-lease + final
  CAS — conflicts surface as Compare-Reason-Swap proposals, never silent
  overwrite. This is the frozen product wedge.
- **No foreground starvation.** Indexing is incremental, coalesced, and
  backgrounded so the critical edit loop is never blocked. (The
  passive-intelligence classifier must run as a debounced background lane —
  [`src/nodemem/core/debouncer.ts`](src/nodemem/core/debouncer.ts),
  [`6-18-2026-passive-classifier-production-pattern.txt`](6-18-2026-passive-classifier-production-pattern.txt) —
  a synchronous passive scanner starves the foreground; keep it off the edit path.)

---

## 7. Status / receipts — HONEST

Read from [`docs/eval/fresh-room/proof-registry.json`](docs/eval/fresh-room/proof-registry.json)
(`generatedAt 2026-06-29`) and its gate receipts. **Verified against this repo's
`HEAD`** — the registry confirms the framing below verbatim:

- **FR-020 / FR-020A — PASSED (selective).** One BTB task (`a31173e3`) through the
  full live-room path: fresh-room UI, export/reopen, official verifier handoff,
  visual judge. Explicitly **does not prove** 100/100 completion, an aggregate
  score, or all task families.
- **FR-020B — PASSED = COMPLETION + SCORING, not a pass rate.** Isolated
  (Harbor), generic-only lane. `executedTaskCount: 100`, `cleanScoredTaskCount:
  100`, `meanCleanReward: 0.251875`, `passThreshold: 1`, `passCount: 0`,
  **`passRate: 0`**. The receipt's own claim: *"This proves full-suite COMPLETION
  + SCORING, not a 100% pass rate."*
- **FR-020C — PASSED = COMPLETION through the product UI, not a pass rate.**
  `evaluatedTaskCount: 100`, `passedTaskCount: 100` (passing **per-task
  fresh-room receipts**, i.e. the run completed the full UI path). The receipt's
  own claim: *"This proves COMPLETION through the product, not a 100% rubric pass
  rate."*

**Do not overclaim.** "100/100" means tasks **completed and scored**, with the
official rubric pass-rate at **0** (reward ≥ 1). The registry policy block
forbids collapsing the isolated-scoring claim (B) and the live-UI-completion
claim (C) into a single "100% pass". Both gate receipts report `flipEligible:
true`; both summarize completion, not perfection.

Re-verify anytime: `npm run fresh-room:proofs` (verifier) and the gate scripts in
[`scripts/`](scripts/).
