# Trace System

Trace is NodeAgent's workpaper layer. It is not a log. It is the receipt that
proves the agent understood the user, used the right context, called the right
tools, preserved evidence, respected approval, and produced the right artifact.

## Product Spine

Every serious NodeAgent run should connect:

```text
user action
-> screen context
-> agent plan
-> context pack
-> tool calls
-> evidence capture
-> artifact or spreadsheet mutation
-> approval boundary
-> final output
-> eval score
-> replayable UI proof
```

The canonical TypeScript contract lives in `src/nodeagent/traces/`.

| Contract | File |
|---|---|
| Trace object, refs, receipts, rework entries | `src/nodeagent/traces/traceTypes.ts` |
| Runtime event -> receipt adapters | `src/nodeagent/traces/traceReceipts.ts` |
| Frame context pack provenance | `src/nodeagent/traces/traceContextPack.ts` |
| Trace construction and recorder | `src/nodeagent/traces/traceRecorder.ts` |
| Redaction and stable hashes | `src/nodeagent/traces/traceRedaction.ts` |
| Replay summaries and excellence ladder | `src/nodeagent/traces/traceReplay.ts` |

## Rule

Every durable memory, evidence card, mutation receipt, approval, eval result,
coach note, and changelog entry should point back to a `traceId`.

```text
Memory row -> traceId
Evidence card -> traceId
CellPayload -> traceId
Benchmark result -> traceId
Visual proof -> traceId
Rework ledger entry -> traceId
```

## Privacy Boundary

Trace records may contain hashes, refs, labels, bounded summaries, screenshot
refs, DOM boxes, and verifier receipts. Do not store raw API keys, private
prompts, cookies, full hidden documents, benchmark answer keys, or unrelated
workspace content in public trace state.

Use `redactTraceText`, `stableTraceJson`, and `stableTraceHash` when turning
tool args, model inputs, or output payloads into receipts.
