# NodeRL — public repo plan (what to publicize, grounded)

> Generated 2026-06-28. Read `HONESTY_DEBTS_BEFORE_PUBLISH.md` first — it gates this.

## Decision

Ship **NodeRL as a curated *extraction + reference* repo**, MIT, agent-host-agnostic — NOT a
fork of the private NodeRoom product and NOT a vendored monorepo of everything. It bundles the
genuinely-portable cores (NodeTrace, NodeMem, the visual-judge harness) plus the spec/proof
layer, and *links* the live product and the Solo Founder loop. It imports; it does not leak.

**One-liner:** *NodeRL turns agent runs into trajectories, trajectories into rewards, rewards
into repair loops, and repair loops into trainable data — for any coding/agent host.*

## Why (grounded, not aspirational)

- The portable cores **already exist** and are ~clean: NodeTrace pipeline is ~80% framework-free
  (injectable reasoner + substrate, no Convex); NodeMem's `compileEpisode`/`rankFacts`/`planRetrieval`
  are pure functions; `packages/walkthrough-review-cli` is already a zero-dep standalone CLI + MCP server.
- The expensive, rare parts of agentic RL — a real environment, durable traces, a proof-receipt
  contract, multimodal judges, anti-cheat doctrine — are what NodeRoom has and most teams lack.
- A single reference repo is the actual ask from the Inference.ai conversation: people want to
  point their coding agent at **one** repo that combines trace + memory + loop + judge.
- Honest-scoped, it is a *stronger* pitch than "100/100": one task proven through the live product
  path + a reusable contract beats an unverifiable headline (see honesty debts).

---

## What is genuinely portable (exact files, from the grounding pass)

### Package `nodetrace` — ~80% ready
Extract (pure / injectable, no Convex):
- `src/nodeagent/capture/{types,pipeline,reasoning,guards,pdfBox,index}.ts`
- `src/nodeagent/capture/substrate/{index,firecrawl,browserbase}.ts`
- `src/nodeagent/capture/secFacts.ts` — optional fallback lane

**Leave behind:** `convex/captures.ts`, `convex/capturesNode.ts`, `src/ui/traceLens/*`,
`src/nodeagent/skills/search/captureSourceFirecrawlTool.ts` (Convex/UI/AgentTool glue).

**Net-new for RL (small, ~1–2 days):** per-step `reward` field; `episode_id` + `step_index`;
optional `cost {tokensIn,tokensOut,latencyMs}`; `truncated`/`resumeFrom`; **JSONL trajectory export**.

**Strip before publish:** default SEC user-agent email `research@noderoom.app` in `secFacts.ts`;
document **BYO API keys** (reasoner/substrate injected, no bundled secrets).

### Package `nodemem` — core pure, storage stays
Extract (pure):
- `src/nodemem/core/{memoryCompiler,retrievalPlanner,classifier,types}.ts`
  (`compileEpisode`, `rankFacts`, `planRetrieval`, `classifyTask`)

**Leave behind:** `convex/nodemem.ts`, `convex/nodememCompile.ts` (mutations/queries, room indexes,
global env-var mode read).

**Net-new for RL:** persist the **`NodeMemFailurePattern`** type that already exists in `types.ts`
but is never stored (symptom/rootCause/regressionTest/fixSummary); add success/failure **outcome
tagging** on episodes so memory can serve failure-replay + contrastive examples.

**Blocked on Debt 3:** no recall-lift number until the 4-variant benchmark re-runs with per-variant isolation.

**Strip before publish:** raw episode `rawText` + `packJson` carry unredacted content → do **not**
export any real episode corpus; ship synthetic seeds only.

### Package `nodeeval` — reward builder + judges
Anchor on what's already standalone:
- `packages/walkthrough-review-cli/` → publish as `@noderl/walkthrough-review` (zero deps; MCP
  server `walkthrough_review_run`; orchestrates capture → render → media judge → UX judge → report).

Also extractable (EXISTS-RUNNABLE per grounding):
- Proof-receipt schema — from `docs/eval/fresh-room/proof-registry.json` → `spec/proof-receipt-contract.md`
- Citation verifier — the `boundary_box_receipts.json` locator contract
- Gemini media/video + GIF judges — `scripts/gemini-demo-media-judge.ts`, `scripts/judge-demo-gif.ts`
- Deterministic scorers — `src/eval/*Scorer.ts` / `*Runner.ts` (formula recompute, exact/semantic golden)
- Cost/latency ledger schema

**Leave behind:** `btb_noderoom_agent/harbor_adapter.py` (BTB-specific + contaminated), task-family
materializers, Room/RoomTools backend.

### Spec / doctrine layer (docs, high value, fast)
- `spec/trajectory-schema.md`, `spec/reward-design.md`
- `spec/proof-receipt-contract.md` (from fresh-room)
- `spec/anti-cheat-doctrine.md` (redacted from `docs/eval/BANKERTOOLBENCH_ANTI_CHEAT_DOCTRINE.md`)
- `docs/thesis.md` (trace→reward→memory→repair→data) + the exists-vs-net-new table below

---

## Honest "exists vs net-new" (the spine — put a version of this in the README)

| NodeRL package | % exists today | Net-new to add | Effort |
|---|---|---|---|
| `nodetrace` | ~80% (pure pipeline, substrates) | reward/cost/episode fields + JSONL export | S |
| `nodemem` | ~70% core (compile + rank pure) | failure-pattern persistence + outcome tagging; honest benchmark | M |
| `nodeeval` | ~75% (walkthrough-cli standalone; judges + scorers runnable) | judge-fn contract abstraction; proof-schema package | M |
| `noderl-loop` (spec) | ~90% as prose in Solo Founder skill | machine-readable anchors + thin runtime (optional) | S–M |
| anti-cheat substrate (S9–S16) | spec only, **not implemented** | recorder/verifier — keep as spec, label clearly | (defer) |

---

## What to publicize vs withhold

**Publicize:** the thesis + architecture diagram; `nodetrace` + `nodemem` cores (MIT);
`walkthrough-review` CLI; the proof-receipt **contract** as a reusable standard; the anti-cheat
doctrine; the **honest** BTB proof (1 task through the live path + generic-only baseline);
a link to the public `solo-founder-nodes` loop repo.

**Withhold / redact:** any "100/100" claim; the contaminated `harbor_adapter.py` as "shipping"
(reference only, labeled); client financial PDFs under `docs/eval/fresh-room/*/evidence/*.pdf`
(replace with links to the official BankerToolBench dataset); raw NodeMem episode corpus; Convex
actions + NodeRoom UI; API keys (BYO).

> Note: the company names in the eval corpus (Comcast, Salesforce, Okta…) are **public-company
> BTB fixtures**, not private clients — low risk, but cite them as official-benchmark fixtures.

---

## README skeleton (copy-first, literal — applying the landing-page lesson)

No abstract blobs. Hero = the pipeline as a real before/after, not a glowing brain.

```
# NodeRL
Turn failed agent runs into the next better attempt — and into training data.

NodeRL records what your agent did (NodeTrace), scores the outcome with tests,
screenshots, a video judge, and proof receipts (NodeEval), remembers what worked
and failed (NodeMem), and feeds the loop that retries until the task is proven.

Works around your agent host: Codex, Claude Code, Windsurf, Devin, or your own.

  Goal → Act → Observe → Evaluate → Reward → Remember → Repair → Export

[ diagram: a failed run becoming a reward packet + a repair ]

## What's real today (honest)
- nodetrace: framework-free trajectory recorder (browser + PDF, boxes, evidence)
- nodemem: deterministic memory compile + ranked retrieval
- nodeeval: walkthrough-review CLI + Gemini media/GIF judges + proof-receipt contract
- Proof: 100/100 BankerToolBench tasks executed + officially scored generic-only (mean reward
  0.2519, gate-driven flip); 1 task additionally proven through the live product path.

## What's coming
- RL trajectory export (reward/cost fields → JSONL), failure-pattern replay store
```

## Repo structure (only packages whose cores actually exist)

```
noderl/
  README.md  LICENSE(MIT)  SECURITY.md(BYO keys)
  packages/ nodetrace/  nodemem/  nodeeval/
  spec/ trajectory-schema.md  reward-design.md  proof-receipt-contract.md  anti-cheat-doctrine.md
  examples/ btb-one-task-proven/   (redacted FR-020 receipt — the honest hero)
  docs/ thesis.md  exists-vs-net-new.md
```

## First commits (sequenced)

1. Settle Debt 1 + Debt 2 in NodeRoom (claim swap + materializer default-off). **Gate.**
2. Scaffold `noderl/` (README skeleton, MIT, SECURITY.md, exists-vs-net-new table).
3. Extract `nodetrace` core; strip SEC email; add reward/cost/episode fields + JSONL export; unit test.
4. Extract `nodemem` core; persist `NodeMemFailurePattern`; ship synthetic seeds only.
5. Move `walkthrough-review-cli` in as `nodeeval/walkthrough-review`; add a generic judge-fn contract.
6. Write `spec/*` (trajectory schema, reward design, proof-receipt contract, redacted anti-cheat).
7. Add `examples/btb-one-task-proven/` with the redacted FR-020 receipt as the hero.
8. Publish; link from `solo-founder-nodes` and from the NodeRoom README.

## The Inference.ai ask (keep it narrow)

Not "train a giant agent." Ask for compute + help to **train a small policy from real
trajectories** (tool-selection or repair policy), measured on the honest BTB lane:
pass@1, retries, tool-error rate, cost/task, evidence-grounding. NodeRL is the environment +
reward + dataset exporter that makes that experiment cheap and credible.
