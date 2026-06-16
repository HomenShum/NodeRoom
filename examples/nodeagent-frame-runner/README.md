# Minimal NodeAgent Frame Runner

This example is the smallest runnable proof of the harness-native frame layer.
It does not need Convex, provider keys, Omnigent, or the browser app.

Run from the repo root:

```bash
npm run nodeagent:frame:smoke
```

Expected shape:

```text
nodeagent frame smoke: PASS frame=rf_adopt_minimal_write_note status=completed steps=5
tools=read_range,propose_lock,edit_cell,release_lock
cell="Frame smoke proof: managed by NodeAgent."
```

The example lives in `minimal.ts` and proves:

- `runReasoningFrame(...)` can run one explicit frame above `runAgent`.
- The frame context pack is independent of hidden transcript memory.
- The tool allowlist is enforced before the model sees tools.
- The write path uses the `RoomTools` port: read current version, lock, CAS edit,
  release.
- The caller receives a receipt with status, trace tools, delta, and verifier
  result.

## Adapting Into Another Project

Implement these ports first:

1. `AgentModel`: your model adapter. For tests, start with `scriptedModel`.
2. `RoomTools`: your state/backend adapter. Keep conflict/lock failures as data.
3. `AgentTool[]`: typed tools with zod schemas that call `RoomTools`.
4. `ReasoningFrame`: one task frame with a `ContextPack` and `toolAllowlist`.

Then call:

```ts
const receipt = await runReasoningFrame({
  rt,
  frame,
  model,
  tools,
  maxSteps: 6,
});
```

Persist `receipt.updatedFrame`, `receipt.stateDelta`, and
`receipt.verification` wherever your project stores job state.

## Coding Agent Checklist

- Run `npm run nodeagent:frame:smoke` before editing the frame runner.
- Run `npm test -- --run tests/frameRunner.test.ts` after frame-runner changes.
- Do not bypass `RoomTools` by writing directly to the backend in examples.
- Do not place durable memory in prompt text or Omnigent YAML.
- Do not mark a frame complete without a verifier receipt.
