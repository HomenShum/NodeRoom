# Finch Recovery And Cost Ledger

The accepted Finch score uses direct OpenAI, not Azure, and binds all 172 judge
rows to the exact canonical task-record hashes. The accepted run scored 15 of
172 tasks (`0.0872093`) with zero parse errors and cost `$1.368019`.

Total direct-OpenAI cost across the recovery was `$3.842859`:

| Run | Result | Cost | Why |
|---|---|---:|---|
| Original canonical | Invalidated | `$1.113033` | Its input hash no longer matched the rebuilt canonical scorer input. |
| Regenerated, unbound | Rejected | `$1.361807` | It completed without per-task prompt hashes; the new promoter rejected it and wrote no score. |
| Regenerated, hash-bound | Accepted | `$1.368019` | 172/172 task hashes, exact global input hash, signed judge-output hash, zero errors. |
| OpenRouter free shadow | Availability only | `$0` estimated billing | Seven task rows exhausted the `$2` failure reserve after quota, context, and image-endpoint errors. |

The second run continued in its child process after the orchestration session
was asked to terminate. That cost is retained here rather than omitted from the
accepted-score receipt. Only the final hash-bound run is promoted.

Machine-readable detail: [finch-recovery-cost-ledger.json](finch-recovery-cost-ledger.json).
