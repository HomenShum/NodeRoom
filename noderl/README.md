# NodeRL

**Turn failed agent runs into the next better attempt — and into training data.**

NodeRL records what your agent did (**NodeTrace**), scores the outcome with tests,
screenshots, a video judge, and proof receipts (**NodeEval**), remembers what worked and
failed (**NodeMem**), and feeds the loop that retries until the task is *proven*.

It works around your agent host — Codex, Claude Code, Windsurf, Devin, or your own runtime.
NodeRL is the **environment + reward + memory + dataset-exporter** layer that most agentic-RL
efforts are missing — not another model.

```
Goal → Act → Observe → Evaluate → Reward → Remember → Repair → Export
        │        │          │          │         │         │        │
     NodeTrace  NodeTrace  NodeEval   NodeEval  NodeMem  loop     JSONL
                                                                  (SFT/DPO/RLVR)
```

> **Status: pre-release scaffold.** This tree is staged inside the NodeRoom repo and will be
> split out to a standalone public repo once two honesty debts are settled
> (see `../docs/noderl/HONESTY_DEBTS_BEFORE_PUBLISH.md`). Nothing here asserts a benchmark
> number it cannot back.

---

## What's real today (honest)

- **NodeTrace** — a framework-free trajectory recorder: browser + PDF actions, per-step
  screenshots, normalized bounding boxes, extracted-field evidence, honest error status.
  ~80% extracted from a production capture pipeline; reward/cost/JSONL fields are being added.
- **NodeMem** — deterministic memory: rule-based `compileEpisode` + multi-factor ranked
  retrieval (`rankFacts`/`planRetrieval`). Pure functions, no DB lock-in.
- **NodeEval** — the `walkthrough-review` CLI + MCP server (capture → render → media judge →
  UX judge → report) and a reusable **proof-receipt contract**.

## What's coming

- RL trajectory export: per-step `reward` + `cost`, `episode_id`/`step_index` → JSONL.
- Failure-pattern replay store (the type exists; persistence is net-new).
- A re-run NodeMem recall benchmark with per-variant isolation.

## The proof story (honest scope)

**All 100 BankerToolBench tasks executed and officially scored (Gandalf), clean generic-only —
no answer-key writers — at mean reward 0.2519.** That is full-suite *completion + scoring*, not a
100% pass rate, and we say exactly that: the proof registry keeps "100% rubric pass rate" under `doesNotProve`. **All 100 tasks are ALSO proven through the live
product UI** (FR-020C: fresh room → upload → public @nodeagent → export → reopen → package
verifier → visual judge), with file-backed per-task receipts strictly validated. Both flips are
gate-driven, not hand-asserted (`bankertoolbench-fullsuite-gate.ts`,
`bankertoolbench-livesuite-gate.ts`), and the proof registry derives them from committed verdicts.
The
reusable artifacts are the **proof-receipt contract** (`spec/proof-receipt-contract.md`) and the
**anti-cheat doctrine** (`spec/anti-cheat-doctrine.md`).

## Packages

| Package | What it is | Maturity |
|---|---|---|
| [`packages/nodetrace`](packages/nodetrace) | Trajectory / evidence recorder | core extracted, +RL fields pending |
| [`packages/nodemem`](packages/nodemem) | Replay / context memory | core pure, +failure-store pending |
| [`packages/nodeeval`](packages/nodeeval) | Reward builder + visual/video judges + proof schema | walkthrough CLI standalone; judge contract pending |

## Spec

- [`spec/trajectory-schema.md`](spec/trajectory-schema.md)
- [`spec/reward-design.md`](spec/reward-design.md)
- [`spec/proof-receipt-contract.md`](spec/proof-receipt-contract.md)
- [`spec/anti-cheat-doctrine.md`](spec/anti-cheat-doctrine.md)
- [`docs/thesis.md`](docs/thesis.md) · [`docs/exists-vs-net-new.md`](docs/exists-vs-net-new.md)

## Related

- **Solo Founder Agent Builder** (`github.com/HomenShum/solo-founder-nodes`) — the curriculum +
  repair loop that *generates* the trajectories NodeRL records, scores, and trains on.

## License

MIT © 2026 Homen Shum. **Bring your own API keys** — this library bundles no secrets
(see `SECURITY.md`).
