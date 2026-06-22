# Trace Rework Ledger

The rework ledger records failed approaches that shaped the current design.
This is not a graveyard. It is provenance for future humans and coding agents.

## Entry Shape

```ts
type ReworkLedgerEntry = {
  id: string;
  date: string;
  oldApproach: string;
  whyItSeemedRight: string;
  failureObserved: string;
  traceRefs: string[];
  decision: "reverted" | "reworked" | "kept_with_limits";
  newApproach: string;
  whyNewApproachIsBetter: string;
  lesson: string;
  affectedFiles: string[];
  testOrEvalProof: string[];
};
```

## Seed Entries To Preserve

| Old approach | Replacement | Lesson |
|---|---|---|
| Client-led SSE memory dump | Convex server-led trace ledger | Memory needs durable provenance, not transcript residue. |
| Hot HTML notebook commits | ProseMirror source + dirty signal + read model | Content sync is not domain intent. |
| Raw `onSnapshot` passive trigger | Actor-authenticated dirty event | Passive work needs actor, visibility, and domain-event semantics. |
| Per-task benchmark materializers | Materializers-off held-out/generalization eval | Do not hide benchmark answers in harness code. |
| Media judge as product correctness | Functional gate plus media quality score | A pretty demo is not proof of product behavior. |
| Agent direct notebook edits | Sidecar proposals and approved insertions | Human approval is part of the workpaper. |
| Token-to-cell streaming | Persistent stream chunks plus final CellPayload commit | Streaming text is not a committed artifact mutation. |
| Single vector search RAG | Hybrid retrieval plus evidence memo plus literal source open | Retrieval is only useful when it produces inspectable source evidence. |

## Rule

When replacing behavior, name the old approach, link the trace that showed the
failure, state the new approach, and list the tests or evals that proved the
change survived.
