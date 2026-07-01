# Proofloop Benchmark Adapters

These adapters are the strict live-user contract layer for external finance/accounting benchmarks.

Every adapter keeps two scores separate:

- `productPathCompletion`: whether NodeRoom completed the live product path with public UI, visible progress, exports, reopen proof, trace, cost/latency, and receipt.
- `officialSemanticScore`: the benchmark's official task score when its verifier is available.

No live-user proof, no benchmark claim.

