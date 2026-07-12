# Glossary — load-bearing repo jargon

One first-use expansion per term, with where to look. Authored 2026-07-12 (direction
audit). If you meet a term that isn't here and had to hunt for it, add it.

| Term | Meaning | Source |
|---|---|---|
| **NodeRoom** | The product: a live diligence room where humans and agents edit shared artifacts (sheet, notes, wall) without silent overwrites. | `docs/WEDGE.md` |
| **ProofLoop** | The certification harness that gates NodeRoom — deterministic gates, proof receipts, benchmark lanes. Also a standalone npm package (`npx proofloop`). | `NODE-LOOPS.md`, `scripts/proofloop.mjs` |
| **NodeAgent** | The canonical in-repo agent harness (model/tool loop, frames, traces). | `AGENTS.md` map, `src/nodeagent/core/` |
| **Omnigent** | The outer harness NodeAgent can run under, integrated via a YAML worker. (`omnigent` is the correct spelling; the `omniagent` npm alias was deleted 07-12.) | `examples/omnigent/nodeagent-room.yaml` |
| **OKF** | The agent's retrieval substrate — embedding-indexed concepts/chunks over room artifacts that the agent queries for context. The acronym's expansion is not recorded anywhere in the repo; treat it as a proper name. | `src/nodeagent/okf.ts`, `docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md` |
| **NodeMem** | The episodic memory layer: `recordEpisode` on chat turns, compaction, and recall injection into agent context. Prod chat path is `agentJobRunner`. | `convex/nodemem.ts`, memory `nodemem-zero-recall-lift` |
| **HALO** | The self-improvement loop lane (`halo:*` npm scripts: self-improve smoke, overnight runs, supervise). Named after context-labs/halo, one of its reference designs. | `scripts/` halo files, `npm run halo:status` |
| **CRS** | "Compare-Reason-Swap" — the Semantic Rebase conflict-resolution scheme that protects the *meaning* of concurrent edits rather than raw text. | `docs/architecture/SEMANTIC_REBASE_CRS.md` |
| **Harbor** | The upstream isolated (Docker) execution environment in which BankerToolBench's official verifier runs. NodeRoom imports its results; it does not wrap it. | `docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md` |
| **Gandalf** | BankerToolBench's official verifier component in that upstream stack ("Harbor/MCP/Gandalf" = execution env / tool protocol / verifier). Official BTB scores exist only when a Gandalf-side receipt is imported. | same, plus `docs/dogfood/official-score-boundary.md` |
| **fresh-room** | A live-browser proof performed in a fresh room with no seeded memory and a real upload/import path — the anti-"warm demo" gate. | `docs/eval/fresh-room/README.md` |
| **FR-0xx / PL-LIVE-\*** | Case ids for fresh-room proof receipts (`docs/eval/fresh-room/<case-id>/latest.json`), e.g. FR-020 = the BankerToolBench full-suite case. | `docs/eval/fresh-room/` |
| **flipEligible** | Boolean verdict on a gate receipt: the lane has EARNED the right to flip its board status. Not-flip-eligible lanes stay blocked regardless of what any summary says. | `scripts/bankertoolbench-fullsuite-gate.ts` |
| **"proven" (board status)** | An official scorer/verifier result was IMPORTED for the lane. It is NOT a pass claim — BTB is "proven" with mean reward 0.2519 and pass-rate 0.0000. Never write launch copy from the board summary line. | `docs/eval/PROOFLOOP_BENCHMARK_BOARD.md` interpretation section; `docs/eval/CERTIFICATION_GATES.md` |
| **Goal ids** | Named long-running proofloop goals for `gate/supervise/resume --goal`: `dev-audience-ready`, `official-scores`, `voice-agent-implementation`, `voice-agent-merge-packet`. | `docs/eval/PROOFLOOP_GOAL_LEDGER.md` |
| **Scaffold** | The editable self-improvement surface (scenario/rubric YAML, adapters, prompts, this-file-class docs) as opposed to the locked certification loop. | CLAUDE.md "Self-Scaffolding Proof-Looping" |
| **Wedge** | The frozen one-demo product scope. Scope expansion is refused by policy. | `docs/WEDGE.md`, memory `noderoom-wedge-compress` |
| **Floor** | `npm run floor` — the fast per-change gate (both typechecks + vitest). | CLAUDE.md "The two canonical gates" |
