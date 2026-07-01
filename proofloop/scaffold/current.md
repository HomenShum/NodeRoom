# Self-Scaffolding Proof-Looping — Current Scaffold

> **Thesis:** Proof-looping runs the proof. Self-scaffolding proof-looping
> improves the proof process itself — while keeping the verifier immutable.

## Loop

```
patch app
→ run proofloop
→ analyze failure
→ propose scaffold improvement
→ propose code improvement
→ run proofloop again
→ keep only changes that improve score
→ promote fixed failure into regression
```

## Scaffold (agent MAY edit)

- `AGENTS.md` — agent instructions
- `CLAUDE.md` — coding-agent notes
- `proofloop/scenarios/*.yaml` — test scenarios
- `proofloop/rubrics/*.yaml` — scoring rubrics
- `proofloop/subagents/*.md` — subagent role definitions
- `proofloop/adapters/*.js` — scaffold review/apply adapters
- `.proofloop/memory.jsonl` — repair strategy memory
- `src/nodeagent/models/prompts/systemPrompt.ts` — system prompt guidance

## Immutable (agent may NOT edit during repair)

- `scripts/agent-improvement-loop.ts` — the proof loop itself
- `scripts/proofloop.mjs` — the verifier runner
- `tests/harnessChangeEval.test.ts` — hidden regression tests
- `.github/workflows/` — CI workflow gate
- `src/eval/evalTrustPolicy.ts` — proof score calculation
- `src/eval/architectureBudget.ts` — architecture budget gate
- `evals/evalStore.ts` — evidence requirement checker

## Accept rule

Accept scaffold changes only if:

1. proofloop score improves, OR
2. evidence coverage improves, OR
3. repeated failure becomes a regression,

AND

4. no verifier/gate was weakened,
5. no hidden/protected file was modified,
6. adversarial reviewer approves.

## Reject rule

Reject if the scaffold change:

- removes required checks
- lowers minScore
- skips evidence capture
- hides failing steps
- edits the verifier
- edits CI gate
- only makes the benchmark easier

## Safety boundary

> Agent may improve the scaffold.
> Agent may NOT weaken the proof gate.
>
> Let the agent improve the playbook, but never let it move the goalpost.

## Gate mode

`npm run scaffold:check` is advisory for normal PRs, because harness owners may
intentionally edit proof machinery. Scaffold-repair PRs must run:

```bash
npm run scaffold:check -- --strict-immutability
```

Strict mode fails if any immutable file is touched.

## Source

- [Ornith-1.0: Self-Scaffolding LLMs for Agentic Coding](https://deep-reinforce.com/ornith_1_0.html)
- NeoSigma: [Self-Improving Agentic Systems](https://neosigma.ai/blog/self-improving-agentic-systems)
