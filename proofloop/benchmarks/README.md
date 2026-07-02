# Proof Loop Benchmark Adapters

Proof Loop proves real agent work on real app UI, stores the proof in memory, and uses it to improve the next run.

These adapters are the strict live-user contract layer for external finance/accounting benchmarks. The `proofloop` CLI is the command surface; proof-looping is the operating loop; NodeTrace is the proof object; NodeEval is the reward; NodeMem is memory; Trace Storybook is the viewer; Cockpit is the live dashboard.

Every adapter keeps two scores separate:

- `productPathCompletion`: whether NodeRoom completed the live product path with public UI, visible progress, exports, reopen proof, trace, cost/latency, and receipt.
- `officialSemanticScore`: the benchmark's official task score when its verifier is available.

No live-user proof, no benchmark claim.

Do not write `100% official benchmark score` unless the official scorer produced that score. Write `100% product-path completion proof` when the proof only covers app flow, export/reopen, and verifier handoff.

`proofloop run <adapter>` resolves registered adapters from `proofloop/benchmarks/<adapter>/adapter.json` and forces `--prod --cockpit --user-emulation strict`. It also writes `official-scorer-receipt.json`; if the adapter, official scorer, live browser scenario, or scorer receipt is missing or failing, the run fails instead of downgrading to a product-path-only claim.

Supervisor rule: a worker can stop, but the loop cannot stop until the proof ledger reaches `passed`, `blocked_external`, `needs_human_approval`, `budget_exhausted`, or `failed`. Use `proofloop supervise --goal <goal-id>` to continue unblocked work and `proofloop gate --goal <goal-id>` before any completion claim.
