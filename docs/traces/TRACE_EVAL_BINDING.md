# Trace Eval Binding

Benchmark scores only count when linked to trace proof.

Bad:

```text
professional-live-catalog passed 21/21
```

Better:

```text
professional-live-catalog passed 21/21
-> each case has traceId
-> each trace has context pack, tool receipts, evidence, mutations, final artifact, DOM proof, screenshot, and verdict
```

## Binding Contract

Every eval row should store:

- `traceId`
- benchmark case id
- model and harness route
- context-pack hash
- tool receipt ids
- evidence receipt ids
- mutation receipt ids
- output artifact refs
- screenshot or DOM proof refs
- score, pass/fail, and failure class

## Anti-Contamination Rule

Trace may remember decisions, constraints, and failure classes. It must not store
held-out answer keys or leaked benchmark-specific outputs as durable memory.

Good memory:

```text
Use actor-authenticated dirty signals for passive notebook processing.
source: traceId + architecture decision
```

Forbidden memory:

```text
Held-out task btb-xyz expects output value 12.4.
```

## Verification

When adding eval behavior, add an assertion that the eval output links to a
trace and that the trace includes at least L6 proof in `traceExcellenceLevel`.
