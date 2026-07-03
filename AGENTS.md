# Coding Agent Notes

NodeAgent is the canonical agent harness in this repo. Before changing it, run:

```bash
npm run nodeagent:frame:smoke
npm run omnigent:nodeagent:smoke
```

Use these files as the map:

- `src/nodeagent/core/runtime.ts` - base model/tool loop.
- `src/nodeagent/core/frameRunner.ts` - frame wrapper above `runAgent`.
- `src/nodeagent/core/contextPack.ts` - frame context envelope.
- `src/nodeagent/core/frameReducer.ts` - frame result to `FrameDelta`.
- `src/nodeagent/core/frameVerifier.ts` - frame status/evidence receipt.
- `src/nodeagent/core/types.ts` - `AgentModel`, `AgentTool`, `RoomTools`.
- `src/nodeagent/traces/` - canonical trace workpaper types, receipts,
  redaction, context-pack provenance, and replay summaries.
- `examples/nodeagent-frame-runner/minimal.ts` - smallest runnable adoption proof.
- `examples/omnigent/nodeagent-room.yaml` - Omnigent outer-harness worker.
- `src/nodeagent/skills/integration/omnigentAdapter.ts` - Omnigent YAML compatibility checks.
- `docs/NODEAGENT_ADOPTION.md` - porting checklist.
- `docs/OMNIGENT_INTEGRATION.md` - Omnigent boundary and smoke command.

Rules:

- Keep writes behind `RoomTools`; do not mutate engine/backend state directly in
  harness examples.
- Keep durable memory in frames/cache/job rows, not prompt transcripts or
  Omnigent YAML.
- Add or update a deterministic test/smoke when changing frame behavior.
- Run `npm test -- --run tests/frameRunner.test.ts` after frame-runner edits.
- Trace is NodeAgent's workpaper layer. New durable memory, evidence, mutation,
  approval, eval, or rework behavior should point back to a `traceId`; update
  `tests/nodeagentTraceSpine.test.ts` when changing trace contracts.

## Proof Loop: two-loop architecture

Every proof-loop suite in this repo (Proximitty, BankerToolBench, the accounting proofloop, and any
new one) follows the same split, formalized in
[`noderl/spec/anti-reward-hacking-doctrine.md`](noderl/spec/anti-reward-hacking-doctrine.md):

- **Certification Loop** (locked): runs the real product UI, scores against an immutable verifier
  and held-out fixtures, produces a proof receipt. This is what `scaffold-check.ts
  --strict-immutability`, `fresh-room-proof-verify.ts`, and the `IMMUTABLE_FILES` list protect.
- **Exploration Loop** (open-ended): proposes new scenarios, red-team cases, and scaffold deltas —
  this is the `proofloop/scenarios/*.yaml` / `proofloop/rubrics/*.yaml` / `.proofloop/memory.jsonl`
  surface `CLAUDE.md`'s "Self-Scaffolding Proof-Looping" section already scopes as editable.

The rule that makes the split real is already coded in `src/eval/scaffoldProposal.ts`'s
`evaluateScaffoldAcceptance()`: a scaffold proposal cannot reach `"accepted"` unless
`ctx.adversarialReviewerApproved` was set by something outside the function — the loop proposes, it
does not self-promote. Never weaken that: a repair pass that grades its own homework is reward
hacking, not improvement.

Promoted proof failures are product-governance state and must be written to the tracked
`proofloop/regressions/promoted-regressions.json` ledger via `proofloop promote`; keep in-flight
memory and run output under `.proofloop/` gitignored.

## Proximitty Underwriting Proof Loop

The Proximitty demo suite is `proximitty-underwriting-pr0`. It is an
evaluation-only underwriting workflow using synthetic data; do not use it to
make real financial, legal, lending, or insurance decisions.

Run:

```bash
npm run proofloop:proximitty
```

The command must create `.proofloop/runs/<run-id>/scorecard.md`,
`live-user-contract.json`, `node-trace-v2.json`, `node-eval.json`,
`model-comparison.json`, `cost-ledger.json`, `verifier-receipt.json`, clips,
the legacy `.proofloop/memory.jsonl` receipt, and local-first recall memory in
`.proofloop/memory/` with SQLite/FTS indexing. Do not weaken proof gates to make
this suite pass, and do not commit generated local memory stores.

<!-- proofloop-agent-friendly:start -->
## ProofLoop Agent-Friendly CLI

These instructions are generated for Codex. Keep ProofLoop usage on-demand: ask the CLI for the slice you need instead of loading broad MCP state or stale transcripts.

Discovery:
- `npm run proofloop -- manifest --json` - machine-readable command surface.
- `npm run proofloop -- manifest --dense` - compact repo status, commands, suites, and UI contracts.
- `npm run proofloop -- docs agents --dense` - compact agent workflow.
- `npm run proofloop -- doctor --json` - read-only setup proof before claiming installed.
- `npm run proofloop -- ui contract --dense` - stable selectors/actions/assertions before browser work.

Long-running loop:
- `npm run proofloop -- this-repo --live` starts repo dogfooding with a persisted goal ledger.
- `npm run proofloop -- supervise --goal <goal-id>` continues the loop until pass/fail/blocker.
- `npm run proofloop -- gate --goal <goal-id>` is the completion gate; do not replace it with a transcript summary.
- `npm run proofloop -- resume --goal <goal-id> --dense` prints the next action when the loop stops.
- `npm run proofloop -- repair latest` converts a failed run into the next focused repair prompt.
- `npm run proofloop -- memory search "<failure or fixture>"` recalls compacted prior failures without dragging full logs into context.

Rules:
- Treat the user goal as the contract. Keep referencing what is not done until the gate passes.
- Do not claim done from chat, screenshots, or worker assertions. Claim done only from a deterministic gate, official scorer, or proof receipt.
- Keep certification-loop assets locked. Exploration can propose scenarios and scaffold changes, but it cannot grade or promote itself.
- Track harness versions, model routes, costs, blocked lanes, and official-score artifacts in receipts.
- Cheaper model routing is allowed for exploration and shadow runs; official scores require the official scorer or an explicitly recorded equivalent judge contract.
- If a local dependency is missing, run `npm run proofloop -- doctor --json` and fix local safe failures before blocking.
- If official scoring is blocked, keep proxy/product-path proof moving and label it honestly in receipts.
- Use the code graph and UI contracts before guessing files, selectors, or routes.

<!-- proofloop-agent-friendly:end -->
