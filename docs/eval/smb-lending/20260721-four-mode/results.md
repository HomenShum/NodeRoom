# SMB lending four-mode benchmark

Generated: 2026-07-21T09:03:54.791Z
Model-backed route: `gpt-4.1-mini`; repetitions per model-backed lane: 3.
The medical-practice case is held out. The evaluator was applied only after each candidate JSON was emitted.
No universal winner is claimed; dimensions are reported independently.

| Mode | Runs | Passes | Pass rate | Mean runtime ms | Mean cost USD | Required recall | False requirements | Blocker recall | Path exact | Authority exact | Source coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| manual | 1 | 1 | 100.0% | 0 | n/a | 1.000 | 0.000 | 1.000 | 100.0% | 100.0% | 1.000 |
| chat_only | 3 | 3 | 100.0% | 3328 | n/a | 1.000 | 0.000 | 1.000 | 100.0% | 100.0% | 1.000 |
| graph_agent | 3 | 3 | 100.0% | 7009 | n/a | 1.000 | 0.000 | 1.000 | 100.0% | 100.0% | 1.000 |
| memory_enhanced | 3 | 3 | 100.0% | 8367 | n/a | 1.000 | 0.000 | 1.000 | 100.0% | 100.0% | 1.000 |

Raw run IDs, candidates, provider usage, failures, and dimensional scores are in `benchmark-receipt.json`.