# Shipped Tools And RoomTools

NodeRoom ships agent tools as product controls, not as raw database handles.
The model can ask for a tool call, but the runtime validates the schema, runs
the call through `RoomTools`, and lets Convex queries/mutations/actions enforce
the real policy.

## Why This Exists

The real user flow is not "ask an LLM to edit a spreadsheet." The flow is:

```text
human asks for work
  -> NodeAgent reads only the relevant room state
  -> tools expose narrow operations
  -> RoomTools maps operations to checked backend functions
  -> Convex writes receipts, traces, locks, drafts, and reactive updates
```

That is how the app can let agents help in a live room without silently
overwriting the human, leaking private data, or hiding the evidence trail.

## Tool Classes

| Class | Examples | Backend language | Purpose |
|---|---|---|---|
| Read tools | `snapshot`, `list_artifacts`, `read_range`, `search_sheet_context`, `fetch_source` | Convex `query` / `internalQuery` | Give the model scoped context with versions and evidence references. |
| Checked write tools | `write_locked_cells`, `write_locked_cell_results`, `edit_cell`, `update_wiki`, `create_draft` | Convex `mutation` / `internalMutation` | Apply bounded writes through auth, lock, CAS, proposal, draft, and receipt checks. |
| Coordination tools | `propose_lock`, `release_lock` | Convex `mutation` / `internalMutation` | Reserve ranges and release them with trace evidence. Production composite tools hide most of this from the model. |
| Capture and external tools | `capture_source`, provider parser calls, model-router calls | Convex `action` | Perform outside-network or model work, then return durable writes through mutations. |
| Review tools | proposal approve/dismiss, passive research, Coach Mode practice | Convex `mutation` plus optional `action` | Keep human approval as the bridge between agent sidecars and source surfaces. |
| Agent Artifact tools | shipped: create/approve work plan; target: edit scope, run read-only, render planned-vs-actual | Convex `mutation` plus queries | Approve structured payload hashes now; compare execution receipts to the approved plan when planned-vs-actual lands. |

## RoomTools Port

`RoomTools` is the seam that keeps the harness portable. The same NodeAgent loop
can run against:

- `InMemoryRoomTools` for no-key deterministic demos and tests;
- `ConvexRoomTools` for the live app;
- future adapters for other ledgers, as long as they preserve the same result
  contract.

The tools themselves do not know whether the backend is Convex or in-memory.
They call methods like `readRange`, `editCell`, `writeLockedCells`, or
`createDraft`. The adapter decides how to enforce the real backend rules.

## Composite Write Pattern

Early evals exposed explicit coordination tools:

```text
read_range -> propose_lock -> edit_cell -> release_lock
```

Production uses composite write tools where possible:

```text
read_range -> write_locked_cells
```

The runtime expands that one call into:

1. acquire the affected-range lock;
2. verify the base versions;
3. apply CAS writes;
4. create drafts or proposals when blocked;
5. release in `finally`;
6. return coordination evidence.

This reduces model burden while preserving the no-clobber proof.

## Security Rule

No shipped tool should bypass the checked backend function for its surface.

- Spreadsheet cells go through versioned artifact mutations.
- Notebook source text goes through the checked commit path.
- Private outputs stay private until promoted.
- Capture/source claims must write evidence references.
- Actions that call providers do not directly mutate source surfaces.
- Visual plans, MDX, and HTML exports are renderings only. Executable work is
  approved by structured payload hash.

## Main Files

| Area | Files |
|---|---|
| Tool types | `src/nodeagent/core/types.ts` |
| Base loop | `src/nodeagent/core/runtime.ts` |
| Spreadsheet tools | `src/nodeagent/skills/spreadsheet/cellMutator.ts` |
| In-memory adapter | `src/nodeagent/skills/integration/noderoomAdapter.ts` |
| Convex adapter | `convex/convexRoomTools.ts` |
| Live action entrypoint | `convex/agent.ts`, `convex/agentJobRunner.ts` |
| Tool/evidence docs | `docs/AGENT_RUNTIME.md`, `docs/NODEAGENT_SOURCE_MAP.md` |

## Backend Translation

If NodeRoom moved away from Convex, the tool contract should stay the same and
only the `RoomTools` adapter should change:

| Backend | Adapter responsibility |
|---|---|
| PostgreSQL | Run writes in transactions with row locks or optimistic version columns, append receipts/outbox rows, and publish changes through LISTEN/NOTIFY or CDC. |
| Firestore | Use transactions and security rules for membership; write receipts and draft rows beside source documents. |
| DynamoDB | Use conditional writes and idempotency keys; emit streams only for committed domain events. |
| Rails/Django | Service objects become the checked mutations; background jobs become action equivalents; ActionCable/server-sent events replace reactive queries. |

The model-facing tools remain stable because the product invariant is stable:
read scoped context, propose or write through checked operations, and leave a
reviewable trace.

## Agent Artifact Readiness

The shipped backend exposes the first Agent Artifact path:

```text
create_agent_work_plan
approve_agent_work_plan
```

The next tool layer should add richer reviewable workflow inputs:

```text
edit_agent_work_plan_scope
run_agent_work_plan_read_only
write_planned_vs_actual
```

These tools should not execute from rendered MDX/HTML. They should read the
structured `agentArtifacts.payload`, verify its canonical hash, start or update
an `agentJob`, and later write planned-vs-actual receipts after execution.
