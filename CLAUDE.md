# CLAUDE.md — Coding Agent Instructions

## Self-Scaffolding Proof-Looping

When you see a scaffold handoff document (posted as a PR comment or at
`docs/eval/scaffold-handoff.md`), apply the **Accepted Proposals** section
to the scaffold files. These are safe changes that passed all checks.

### What you MAY edit (scaffold)

- `AGENTS.md`
- `proofloop/scenarios/*.yaml`
- `proofloop/rubrics/*.yaml`
- `proofloop/subagents/*.md`
- `proofloop/adapters/*.js`
- `.proofloop/memory.jsonl`
- `src/nodeagent/models/prompts/systemPrompt.ts`

### What you may NOT edit during scaffold repair

- `scripts/proofloop.mjs`
- `scripts/agent-improvement-loop.ts`
- `tests/harnessChangeEval.test.ts`
- `.github/workflows/`
- `src/eval/evalTrustPolicy.ts`
- `src/eval/architectureBudget.ts`
- `evals/evalStore.ts`

### Rules

1. Only apply proposals marked **accepted** in the handoff.
2. Never apply proposals marked **rejected** or **needs adversarial review**.
3. Never modify immutable files while applying scaffold proposals.
4. After applying scaffold changes, run `npm run scaffold:check -- --strict-immutability` to verify.
5. Commit scaffold changes separately from code changes for clarity.

### Commands

```bash
npm run agent:improve     # run the full improvement loop
npm run scaffold:check    # check current diff + generate handoff
npm run scaffold:check -- --strict-immutability  # hard gate for scaffold-repair PRs
```

## Proximitty Proof Loop

`npm run proofloop:proximitty` runs the local/staging Proximitty underwriting
Proof Loop demo. It uses synthetic demo data only and must keep completion proof
separate from any official semantic benchmark score. If a policy fails, produce
scaffold suggestions in `model-delta.md`; do not lower the verifier or evidence
gate.

Use `npm run proofloop -- memory doctor` to verify the local-first recall layer,
and `npm run proofloop -- memory search "<query>"` to inspect compacted proof
episodes. Generated `.proofloop/memory/` stores stay local and uncommitted.
