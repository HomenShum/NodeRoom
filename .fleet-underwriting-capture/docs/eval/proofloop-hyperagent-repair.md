# ProofLoop HyperAgent Repair Pattern

Date checked: 2026-07-06

## Live Failure

Receipt: `docs/eval/underwriting-hmda-live-proof.json`

The HMDA live run used a fresh production room, uploaded the public HMDA feature packet, invoked `@nodeagent`, and left memory mode off. The failure was not upload, browser automation, or scoring. The job reached `running 2/1000` with zero matched rows and no Sheet 1 writes. The observed class of failure is:

1. required-write benchmark goal;
2. first slice exhausts model/tool spend;
3. no room-write receipt exists;
4. durable runner schedules another broad attempt instead of repairing or terminating.

## Research Pattern

Meta HyperAgents describe a self-referential agent design where the task agent and meta agent live in a single editable program, and the meta-level improvement procedure is itself editable. The key operational ideas relevant to ProofLoop are:

1. the evaluator must modify the future task-solving process, not just score the final output;
2. persistent performance tracking and memory should transfer across runs;
3. self-improvement should run with sandboxing and human oversight.

Primary sources:

- Meta AI Research, "HyperAgents", 2026-03-24: https://ai.meta.com/research/publications/hyperagents/
- arXiv:2603.19461, "Hyperagents": https://arxiv.org/abs/2603.19461
- facebookresearch/HyperAgents code: https://github.com/facebookresearch/hyperagents
- Andrej Karpathy context-engineering framing: https://x.com/karpathy/status/1937902205765607626

## Noderoom Implementation

`src/nodeagent/core/proofloopSupervisor.ts` is the bounded meta-controller for live benchmark completion jobs.

It now detects:

- `runtimeProfile === "benchmark_completion"`;
- `stopReason === "spend_budget"`;
- the user goal requires a material write;
- no `edit_cell`, `create_draft`, `write_locked_cells`, `write_locked_cell_results`, or equivalent room-write receipt exists.

Decision policy:

- First no-write spend-budget slice: append one `PROOFLOOP VERIFIER REPAIR:` message into the durable cursor. The next slice is constrained to identify artifacts, use compact reads, and write the required output table.
- Second no-write spend-budget slice or already-issued repair prompt: fail the job with `proofloop_no_progress_after_repair` instead of drifting through hundreds of attempts.

This is the practical HyperAgent move for ProofLoop: the verifier changes the next context packet and retry policy based on live failure evidence, while keeping the repair bounded and auditable.

## Final Production State

The live HMDA underwriting proof is now separated from the synthetic Proximitty suite and has its own repeatable ProofLoop command:

```bash
npm run proofloop:live:underwriting
```

The final contract is documented in `docs/eval/UNDERWRITING_LIVE_PROOFLOOP.md` and written into each receipt under:

- `harness.version`
- `harness.proofContractVersion`
- `iterationLedger`
- `liveSignals.outputRowsComplete`
- `backend.job.status`
- `backend.frames`
- `backend.operations`

Final acceptance requires both visible browser output and Convex backend completion. A score-only pass is no longer enough.
