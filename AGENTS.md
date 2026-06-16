# Coding Agent Notes

NodeAgent is the canonical agent harness in this repo. Before changing it, run:

```bash
npm run nodeagent:frame:smoke
```

Use these files as the map:

- `src/nodeagent/core/runtime.ts` - base model/tool loop.
- `src/nodeagent/core/frameRunner.ts` - frame wrapper above `runAgent`.
- `src/nodeagent/core/contextPack.ts` - frame context envelope.
- `src/nodeagent/core/frameReducer.ts` - frame result to `FrameDelta`.
- `src/nodeagent/core/frameVerifier.ts` - frame status/evidence receipt.
- `src/nodeagent/core/types.ts` - `AgentModel`, `AgentTool`, `RoomTools`.
- `examples/nodeagent-frame-runner/minimal.ts` - smallest runnable adoption proof.
- `docs/NODEAGENT_ADOPTION.md` - porting checklist.

Rules:

- Keep writes behind `RoomTools`; do not mutate engine/backend state directly in
  harness examples.
- Keep durable memory in frames/cache/job rows, not prompt transcripts or
  Omnigent YAML.
- Add or update a deterministic test/smoke when changing frame behavior.
- Run `npm test -- --run tests/frameRunner.test.ts` after frame-runner edits.
