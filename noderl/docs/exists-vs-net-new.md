# NodeRL — exists vs net-new

The honest spine. Each package is an *extraction* of code that already runs in production, plus a
small amount of net-new work to make it RL-ready. Source paths are in the originating NodeRoom repo.

| NodeRL package | % exists today | Extracted from | Net-new to add | Effort |
|---|---|---|---|---|
| `nodetrace` | ~80% | `src/nodeagent/capture/{types,pipeline,reasoning,guards,pdfBox,index}.ts`, `capture/substrate/{index,firecrawl,browserbase}.ts` | per-step `reward` + `cost {tokensIn,tokensOut,latencyMs}`, `episode_id`/`step_index`, `truncated`/`resumeFrom`, **JSONL export** | S |
| `nodemem` | ~70% core + failure store BUILT | `src/nodemem/core/{memoryCompiler,retrievalPlanner,classifier,types}.ts` (pure) + `src/nodemem/failureMemory.ts` (file-backed `NodeMemFailurePattern` store + repair targeting, wired into the live-suite gate) | Convex persistence of the failure store (optional), success/failure outcome tagging on episodes, honest re-run benchmark | S |
| `nodeeval` | ~75% | `packages/walkthrough-review-cli` (standalone), `scripts/gemini-demo-media-judge.ts`, `scripts/judge-demo-gif.ts`, `src/eval/*Scorer.ts`, proof-registry schema | generic judge-fn contract, `proof-schema` package, citation-verifier extraction | M |
| `noderl-loop` (spec) | ~90% as prose | `.claude/skills/solo-founder-nodes/*` (attempt ledger, failure taxonomy, strategy delta, promotion gate, fresh-context judge all already specified) | machine-readable RALPH anchors + optional thin runtime | S–M |
| anti-cheat substrate (S9–S16) | **spec only** | `docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md` | recorder/verifier **not implemented** — ship as spec, label clearly | (defer) |

## What is deliberately NOT extracted

- Convex bindings (`convex/captures.ts`, `convex/nodemem*.ts`) — DB + auth glue.
- NodeRoom UI (`src/ui/traceLens/*`) — product surfaces.
- `btb_noderoom_agent/harbor_adapter.py` — BankerToolBench-specific **and** carries unreverted
  answer-key contamination; reference only, never as shipping code.
- Task-family materializers / Room backend.

## Stripped before publish

- Default SEC user-agent email in `secFacts.ts`.
- Any real NodeMem episode corpus (raw text carries PII) — synthetic seeds only.
- Client/financial PDFs under `docs/eval/fresh-room/*/evidence/*.pdf` — replace with links to the
  official BankerToolBench dataset.
