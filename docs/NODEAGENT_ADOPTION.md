# NodeAgent Adoption Guide

Last updated: 2026-06-16

This guide is for people or coding agents adapting the NodeAgent frame harness
into another project. The baseline must be runnable before it is considered
adopted.

## One-Command Proof

From this repo:

```bash
npm run nodeagent:frame:smoke
```

This uses `examples/nodeagent-frame-runner/minimal.ts` to run a complete
frame through the real harness:

```text
ReasoningFrame -> ContextPack -> runReasoningFrame -> runAgent -> RoomTools -> FrameDelta -> verifier receipt
```

It writes one demo-room cell through the normal read/lock/CAS/release path and
fails the process if the final artifact state or frame receipt is wrong.
The checked-in proof artifact is `docs/eval/nodeagent-frame-smoke.json`.

## Minimum Files To Understand

| Concern | File |
|---|---|
| Harness loop | `src/nodeagent/core/runtime.ts` |
| Frame plan/types | `src/nodeagent/core/reasoningFrames.ts` |
| Frame context envelope | `src/nodeagent/core/contextPack.ts` |
| Frame runner | `src/nodeagent/core/frameRunner.ts` |
| Frame delta reducer | `src/nodeagent/core/frameReducer.ts` |
| Frame verifier | `src/nodeagent/core/frameVerifier.ts` |
| Backend port | `src/nodeagent/core/types.ts` (`RoomTools`) |
| In-memory adapter | `src/nodeagent/skills/integration/noderoomAdapter.ts` |
| Tool definitions | `src/nodeagent/skills/spreadsheet/cellMutator.ts` |
| Runnable minimal example | `examples/nodeagent-frame-runner/minimal.ts` |

## Porting Contract

A new project needs four pieces:

1. `AgentModel`: a model adapter that returns text/tool calls/done.
2. `RoomTools`: the backend state port. Conflicts, locks, review gates, and
   permission failures must return as data, not silent side effects.
3. `AgentTool[]`: zod-validated tool contracts backed by `RoomTools`.
4. `ReasoningFrame`: a bounded task frame with a `ContextPack`, evidence state,
   and tool allowlist.

Keep the base loop small. Add project-specific cognition above it as frames,
context packs, reducers, verifiers, and durable state.

## Coding-Agent Rules

- First run `npm run nodeagent:frame:smoke`; do not start from a blank prompt.
- Make the smallest failing test or smoke before changing the harness.
- Preserve the model/tool/backend separation in `src/nodeagent/core/types.ts`.
- Do not bypass `RoomTools` for writes in tests or examples.
- Do not hide durable memory in model transcript text, Omnigent YAML, or shell
  session state.
- When adding tools, include a zod schema and a deterministic test path.
- When changing frame status, verify the receipt and persisted state.

## Verification Ladder

Use this order while adapting:

```bash
npm run nodeagent:frame:smoke
npm test -- --run tests/frameRunner.test.ts
npm test -- --run tests/reasoningFrames.test.ts tests/roomWorkCache.test.ts
npm run typecheck -- --pretty false
npx tsc --noEmit --project convex/tsconfig.json --pretty false
npm test -- --run
npm run build
```

The Convex command is only required when the adopting project uses the current
NodeRoom durable backend. A pure library extraction should replace it with that
project's backend typecheck.
